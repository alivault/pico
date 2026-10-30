/** Offline Pi JSONL import. Writes history only: no submissions or tool tasks. */
import { readFile, readdir, realpath } from "node:fs/promises"
import { join } from "node:path"

import type { JsonValue } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import type { Message, ModelThinkingLevel } from "@earendil-works/pi-ai"
import type {
  FileEntry,
  SessionEntry,
  SessionHeader,
} from "@earendil-works/pi-coding-agent"
import {
  defineDoc,
  type AgentChange,
  type Conversation,
  type ConversationId,
  type EntryDraft,
  type EntryId,
  type Harness,
} from "@earendil-works/pi-durable"

import { AgentMetaDoc, publicId, type AgentMeta } from "./agents.ts"
import { messageText } from "./items.ts"

const ImportDoc = defineDoc<{
  files: Record<
    string,
    {
      source: string
      root: number
      active: number
      entries: number
      complete: boolean
    }
  >
}>({
  kind: "pico.pi-imports",
  checkpointWhen: () => false,
  version: 1,
  scope: "session",
  initial: () => ({ files: {} }),
})
const thinkingLevels = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
function time(value: string) {
  return Date.parse(value) || 0
}

/** Strict parsing: a corrupt source must not silently lose history. */
export async function readPiFile(path: string) {
  const lines = (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
  const values = lines.map((line, index) => {
    try {
      return JSON.parse(line) as FileEntry
    } catch {
      throw new Error(`${path}:${index + 1}: invalid JSON`)
    }
  })
  const header = values.shift()
  if (!header || header.type !== "session" || !header.id || !header.cwd)
    throw new Error(`${path}: missing Pi session header or cwd`)
  if (header.version !== 3)
    throw new Error(`${path}: unsupported Pi session version ${header.version}`)
  const entries = values as SessionEntry[]
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id))
      throw new Error(`${path}: missing or duplicate entry ID`)
    if (entry.parentId && !seen.has(entry.parentId))
      throw new Error(
        `${path}: parent ${entry.parentId} is missing or out of order`
      )
    seen.add(entry.id)
  }
  return { header: header as SessionHeader, entries }
}

function ancestry(leaf: string | null, entries: Map<string, SessionEntry>) {
  const path: SessionEntry[] = []
  while (leaf) {
    const entry = entries.get(leaf)
    if (!entry) throw new Error(`Missing entry ${leaf}`)
    path.push(entry)
    leaf = entry.parentId
  }
  return path.reverse()
}

function agentFor(path: SessionEntry[], cwd: string): AgentChange {
  const agent: {
    cwd: string
    model?: { provider: string; modelId: string }
    thinkingLevel?: ModelThinkingLevel
  } = { cwd }
  for (const entry of path) {
    if (entry.type === "model_change")
      agent.model = { provider: entry.provider, modelId: entry.modelId }
    if (
      entry.type === "thinking_level_change" &&
      thinkingLevels.has(entry.thinkingLevel)
    )
      agent.thinkingLevel = entry.thinkingLevel as ModelThinkingLevel
    if (entry.type === "message" && entry.message.role === "assistant")
      agent.model = {
        provider: entry.message.provider,
        modelId: entry.message.model,
      }
  }
  return agent
}

function metadata(
  header: SessionHeader,
  path: SessionEntry[],
  name?: string
): AgentMeta {
  const messages = path.filter((entry) => entry.type === "message")
  const users = messages.filter((entry) => entry.message.role === "user")
  const first = users[0]
  const lastUser = users.at(-1)
  const last = messages.at(-1)
  const lastAssistant = messages.findLast(
    (entry) => entry.message.role === "assistant"
  )
  const text = (entry: typeof first | undefined) =>
    entry ? messageText(entry.message as never) : ""
  return {
    cwd: header.cwd,
    createdAt: time(header.timestamp),
    modifiedAt: time(path.at(-1)?.timestamp ?? header.timestamp),
    ...(name ? { name, nameSource: "user" } : {}),
    firstMessage: text(first),
    messageCount: messages.length,
    lastMessagePreview: (text(lastAssistant) || text(lastUser)).slice(0, 160),
    ...(lastUser ? { lastUserMessageAt: time(lastUser.timestamp) } : {}),
    ...(last ? { lastMessageAt: time(last.timestamp) } : {}),
  }
}

type Point = { conversation: Conversation; id: EntryId }

function draftFor(
  entry: SessionEntry,
  points: Map<string, Point>,
  originals: Map<string, SessionEntry>
): EntryDraft {
  const bookkeeping: EntryDraft = {
    kind: `pico.legacy.${entry.type}`,
    data: json(entry),
  }
  if (entry.type === "message") {
    const message = entry.message
    const kinds: Record<string, string> = {
      user: "pi.user",
      assistant: "pi.assistant",
      toolResult: "pi.tool-result",
      system: "pi.system",
    }
    const kind = kinds[message.role]
    if (kind)
      return {
        kind,
        model: [message as Message],
        data: { legacyId: entry.id, timestamp: entry.timestamp },
      }
    if (message.role === "bashExecution" && !message.excludeFromContext) {
      return {
        ...bookkeeping,
        model: [
          {
            role: "user",
            content: `Shell command: ${message.command}\n${message.output}`,
            timestamp: time(entry.timestamp),
          },
        ],
      }
    }
  }
  if (entry.type === "custom_message")
    return {
      ...bookkeeping,
      model: [
        {
          role: "user",
          content: entry.content,
          timestamp: time(entry.timestamp),
        },
      ],
    }
  if (entry.type === "compaction") {
    const kept = points.get(entry.firstKeptEntryId)
    if (!kept)
      throw new Error(
        `Compaction points to missing entry ${entry.firstKeptEntryId}`
      )
    return {
      kind: "pi.compaction",
      head: kept.id,
      model: [
        {
          role: "user",
          content: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`,
          timestamp: time(entry.timestamp),
        },
      ],
      data: json({ reason: "manual", legacy: entry }),
    }
  }
  if (entry.type === "branch_summary")
    return {
      ...bookkeeping,
      model: [
        {
          role: "user",
          content: entry.summary,
          timestamp: time(entry.timestamp),
        },
      ],
    }
  if (entry.type === "context_edit") {
    const target = points.get(entry.targetId)
    const original = originals.get(entry.targetId)
    if (!target || !original)
      throw new Error(`Context edit points to missing entry ${entry.targetId}`)
    if (entry.replacement === null)
      return { ...bookkeeping, edits: [{ target: target.id, action: "omit" }] }
    const model = draftFor(original, points, originals).model
    if (!model?.length)
      throw new Error(`Context edit target ${entry.targetId} has no message`)
    return {
      ...bookkeeping,
      edits: [
        {
          target: target.id,
          action: "replace",
          messages: model.map(
            (message) =>
              ({ ...message, content: entry.replacement!.content }) as Message
          ),
        },
      ],
    }
  }
  return bookkeeping
}

/** Import every branch; the last file entry selects the active branch, as in Pi. */
export async function importPiFile(harness: Harness, source: string) {
  const { header, entries } = await readPiFile(source)
  const index = await harness.snapshot(ImportDoc, ctx)
  if (index?.files[header.id]?.complete)
    return {
      skipped: true,
      entries: 0,
      branches: 0,
      agentId: publicId(index.files[header.id].active as ConversationId),
    }
  const root = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { cwd: header.cwd },
      init: async (tx, id) => {
        const imports = await tx.doc(ImportDoc)
        imports.files[header.id] = {
          source,
          root: id,
          active: id,
          entries: 0,
          complete: false,
        }
        // No cwd in AgentMetaDoc until complete: partially imported history stays hidden.
      },
    },
    ctx
  )
  const points = new Map<string, Point>()
  const originals = new Map(entries.map((entry) => [entry.id, entry]))
  const conversations = new Map<
    ConversationId,
    { conversation: Conversation; tip: string | null }
  >([[root.id, { conversation: root, tip: null }]])
  let current = root
  let tip: string | null = null
  let batch: SessionEntry[] = []
  const flush = async () => {
    if (!batch.length) return
    const pending = batch
    batch = []
    await harness.commit(async (tx) => {
      for (const entry of pending) {
        const appended = await tx.appendEntry(
          current.id,
          draftFor(entry, points, originals)
        )
        points.set(entry.id, { conversation: current, id: appended.id })
      }
    }, ctx)
  }
  for (const entry of entries) {
    if (entry.parentId !== tip) {
      await flush()
      if (entry.parentId === null) {
        // Independent roots cannot be forked at a nonexistent entry.
        current = await harness.createConversation(
          { ownership: { kind: "ownerless" }, agent: { cwd: header.cwd } },
          ctx
        )
      } else {
        const parent = points.get(entry.parentId)
        if (!parent) throw new Error(`Missing parent ${entry.parentId}`)
        const existing = [...conversations.values()].find(
          (branch) => branch.tip === entry.parentId
        )
        current =
          existing?.conversation ??
          (await parent.conversation.fork(
            parent.id,
            { ownership: { kind: "ownerless" } },
            ctx
          ))
      }
      if (!conversations.has(current.id))
        conversations.set(current.id, {
          conversation: current,
          tip: entry.parentId,
        })
    }
    batch.push(entry)
    tip = entry.id
    conversations.get(current.id)!.tip = tip
    if (batch.length >= 100) await flush()
  }
  await flush()
  const name = entries
    .filter((entry) => entry.type === "session_info")
    .findLast((entry) => entry.name)?.name
  const labels: Record<string, { label: string; timestamp: number }> = {}
  for (const entry of entries) {
    if (entry.type !== "label") continue
    const target = points.get(entry.targetId)
    if (!target) continue
    if (entry.label)
      labels[String(target.id)] = {
        label: entry.label,
        timestamp: time(entry.timestamp),
      }
    else delete labels[String(target.id)]
  }
  for (const branch of conversations.values())
    await branch.conversation.configure(
      agentFor(ancestry(branch.tip, originals), header.cwd),
      ctx
    )
  await harness.commit(async (tx) => {
    for (const branch of conversations.values()) {
      const meta = await tx.doc(AgentMetaDoc, branch.conversation.id)
      Object.assign(
        meta,
        metadata(header, ancestry(branch.tip, originals), name),
        { family: publicId(root.id), labels }
      )
      if (branch.conversation.id !== current.id)
        meta.replacedBy = publicId(current.id)
    }
    const imports = await tx.doc(ImportDoc)
    imports.files[header.id] = {
      source,
      root: root.id,
      active: current.id,
      entries: entries.length,
      complete: true,
    }
  }, ctx)
  return {
    skipped: false,
    entries: entries.length,
    branches: conversations.size,
    agentId: publicId(current.id),
  }
}

export async function importPiSessions(
  harness: Harness,
  directory: string,
  report = console.log
) {
  const files: string[] = []
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(child)
    }
  }
  await walk(await realpath(directory))
  files.sort()
  let imported = 0,
    skipped = 0,
    count = 0
  const failures: Array<{ source: string; error: string }> = []
  for (const [i, source] of files.entries()) {
    try {
      const result = await importPiFile(harness, source)
      if (result.skipped) skipped += 1
      else {
        imported += 1
        count += result.entries
      }
      report(
        `[${i + 1}/${files.length}] ${result.skipped ? "skip" : "import"} ${source} (${result.entries} entries, ${result.branches} branches)`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ source, error: message })
      report(`[${i + 1}/${files.length}] FAILED ${source}: ${message}`)
    }
  }
  return { imported, skipped, entries: count, failures }
}
