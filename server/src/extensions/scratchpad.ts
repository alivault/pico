/**
 * The `scratchpad` extension: large intermediate text kept out of the model's
 * context and read back by ID.
 *
 * Entries are files in `<data>/scratch/<conversation>/`, each with a small
 * JSON file of metadata. Files, not a document, because a tool hook (the
 * output spill below) can read documents but not commit them. IDs are random
 * and global, so `scratch_get` also finds an entry from before a fork.
 *
 * When the `scratchSpillKb` setting is above 0, an `afterTool` hook saves
 * tool output larger than that to the scratchpad and gives the model the head
 * of it and the scratch ID.
 */
import { randomBytes } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  hook,
  ToolTask,
  type ConversationId,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"
import { clip, errorResult, registerState, textResult } from "./util.ts"

export type ScratchEntry = {
  id: string
  name: string
  bytes: number
  lines: number
  createdAt: number
  /** The tool whose output was spilled here, if any. */
  source?: string
}

const ID = /^x[a-z0-9]{6,12}$/
const SPILL_HEAD_CHARS = 2000
const NEVER_SPILL = new Set([
  "scratch_get",
  "scratch_put",
  "scratch_list",
  "scratch_delete",
  "codemode",
])

export class Scratchpad {
  readonly #root: string

  constructor(dataDir: string) {
    this.#root = join(dataDir, "scratch")
  }

  #dir(conversationId: ConversationId | number) {
    return join(this.#root, String(conversationId))
  }

  static newId() {
    return `x${randomBytes(5).toString("hex").slice(0, 8)}`
  }

  async put(
    conversationId: ConversationId | number,
    content: string,
    options: { id?: string; name?: string; source?: string } = {}
  ): Promise<ScratchEntry> {
    const id = options.id ?? Scratchpad.newId()
    const dir = this.#dir(conversationId)
    await mkdir(dir, { recursive: true })
    const entry: ScratchEntry = {
      id,
      name: (options.name ?? options.source ?? "note").slice(0, 120),
      bytes: Buffer.byteLength(content),
      lines: content.split("\n").length,
      createdAt: Date.now(),
      ...(options.source ? { source: options.source } : {}),
    }
    await writeFile(join(dir, `${id}.txt`), content)
    await writeFile(join(dir, `${id}.json`), JSON.stringify(entry))
    return entry
  }

  async list(conversationId: ConversationId | number) {
    const dir = this.#dir(conversationId)
    const names = await readdir(dir).catch(() => [] as string[])
    const entries: ScratchEntry[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      try {
        entries.push(
          JSON.parse(await readFile(join(dir, name), "utf8")) as ScratchEntry
        )
      } catch {
        // A partly written entry; skip it.
      }
    }
    return entries.sort((left, right) => left.createdAt - right.createdAt)
  }

  /** The directory of an entry: the conversation's own, or any other. */
  async #find(conversationId: ConversationId | number, id: string) {
    if (!ID.test(id)) return undefined
    const own = this.#dir(conversationId)
    const ownText = await readFile(join(own, `${id}.txt`), "utf8").catch(
      () => undefined
    )
    if (ownText !== undefined) return { dir: own, text: ownText }
    for (const name of await readdir(this.#root).catch(() => [] as string[])) {
      const dir = join(this.#root, name)
      const text = await readFile(join(dir, `${id}.txt`), "utf8").catch(
        () => undefined
      )
      if (text !== undefined) return { dir, text }
    }
    return undefined
  }

  async get(conversationId: ConversationId | number, id: string) {
    return (await this.#find(conversationId, id))?.text
  }

  async delete(conversationId: ConversationId | number, id: string) {
    if (!ID.test(id)) return false
    const dir = this.#dir(conversationId)
    const existed = await readFile(join(dir, `${id}.json`)).then(
      () => true,
      () => false
    )
    await rm(join(dir, `${id}.txt`), { force: true })
    await rm(join(dir, `${id}.json`), { force: true })
    return existed
  }
}

function resultText(result: ToolExecutionResult) {
  if (!result.output) return undefined
  if (result.output.some((part) => part.type !== "text")) return undefined
  return result.output
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

export function createScratchpadExtension(host: HostBridge, dataDir: string) {
  const scratch = new Scratchpad(dataDir)

  registerState({
    key: "scratch",
    kinds: [],
    async read(_reader, conversationId) {
      const entries = await scratch.list(conversationId)
      return entries.length > 0 ? entries : undefined
    },
  })

  const putTool = defineTool({
    name: "scratch_put",
    description:
      "Save large text (notes, data, intermediate results) to the scratchpad, out of your context. Returns an ID to read it back with scratch_get.",
    parameters: Type.Object({
      content: Type.String(),
      name: Type.Optional(Type.String()),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const id = await api.memo("scratch-id", Scratchpad.newId(), context)
      const entry = await scratch.put(api.conversationId, args.content, {
        id,
        ...(args.name ? { name: args.name } : {}),
      })
      host.current?.sessions.extensionStateChanged(
        `s${api.conversationId}`,
        "pico.scratch"
      )
      return textResult(
        `Saved scratch ${entry.id} (${entry.lines} lines, ${entry.bytes} bytes).`,
        { details: entry }
      )
    },
  })

  const getTool = defineTool({
    name: "scratch_get",
    description:
      "Read a scratchpad entry by ID: a line range (offset, limit; default the first 200 lines), or only lines that match grep.",
    parameters: Type.Object({
      id: Type.String(),
      offset: Type.Optional(Type.Number({ description: "First line, from 1" })),
      limit: Type.Optional(Type.Number()),
      grep: Type.Optional(Type.String()),
    }),
    replay: "safe",
    async execute(args, api) {
      const text = await scratch.get(api.conversationId, args.id.trim())
      if (text === undefined) return errorResult(`No scratch entry ${args.id}`)
      const lines = text.split("\n")
      if (args.grep) {
        let pattern: RegExp
        try {
          pattern = new RegExp(args.grep, "i")
        } catch {
          return errorResult(`Invalid grep pattern: ${args.grep}`)
        }
        const matches = lines
          .map((line, index) => `${index + 1}: ${line}`)
          .filter((line) => pattern.test(line))
        return textResult(
          `${matches.length} matching line(s) of ${lines.length}\n${clip(matches.slice(0, 500).join("\n"), 30_000)}`
        )
      }
      const start = Math.max(1, Math.floor(args.offset ?? 1))
      const limit = Math.min(2000, Math.max(1, Math.floor(args.limit ?? 200)))
      const slice = lines.slice(start - 1, start - 1 + limit)
      const end = start + slice.length - 1
      return textResult(
        `Lines ${start}-${end} of ${lines.length}${end < lines.length ? ` (next: offset ${end + 1})` : ""}\n${clip(slice.join("\n"), 40_000)}`
      )
    },
  })

  const listTool = defineTool({
    name: "scratch_list",
    description: "List the scratchpad entries of this session.",
    parameters: Type.Object({}),
    replay: "safe",
    async execute(_args, api) {
      const entries = await scratch.list(api.conversationId)
      return textResult(
        entries.length > 0
          ? entries
              .map(
                (entry) =>
                  `${entry.id} ${entry.name} (${entry.lines} lines, ${entry.bytes} bytes)`
              )
              .join("\n")
          : "The scratchpad is empty."
      )
    },
  })

  const deleteTool = defineTool({
    name: "scratch_delete",
    description: "Delete a scratchpad entry by ID.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    async execute(args, api) {
      const deleted = await scratch.delete(api.conversationId, args.id.trim())
      host.current?.sessions.extensionStateChanged(
        `s${api.conversationId}`,
        "pico.scratch"
      )
      return deleted
        ? textResult(`Deleted scratch ${args.id}.`)
        : errorResult(`No scratch entry ${args.id} in this session`)
    },
  })

  const spill = hook(ToolTask, {
    afterTool: async (call, result, api) => {
      const limitKb = host.current?.settings().scratchSpillKb ?? 0
      if (limitKb <= 0 || call.parent || NEVER_SPILL.has(call.name))
        return undefined
      const text = resultText(result)
      if (text === undefined || Buffer.byteLength(text) <= limitKb * 1024)
        return undefined
      const entry = await scratch.put(api.conversationId, text, {
        source: call.name,
        name: `${call.name} output`,
      })
      return {
        ...result,
        output: [
          {
            type: "text",
            text: `${text.slice(0, SPILL_HEAD_CHARS)}\n…\n[The full output (${entry.lines} lines, ${entry.bytes} bytes) is in scratch ${entry.id}. Read more with scratch_get { id: "${entry.id}", offset, limit, grep }.]`,
          },
        ],
      }
    },
  })

  return {
    scratch,
    extension: defineExtension({
      name: "scratchpad",
      tools: [putTool, getTool, listTool, deleteTool],
      hooks: [spill],
    }),
  }
}
