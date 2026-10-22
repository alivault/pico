import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import type { Message } from "@earendil-works/pi-ai"
import type { Harness } from "@earendil-works/pi-durable"

import { DEFAULT_SETTINGS } from "../src/core/settings.ts"
import {
  HostBridge,
  sessionIdOf,
  conversationOf,
  type HostServices,
  type HostSessionMeta,
} from "../src/extensions/host.ts"
import {
  createSessionsExtension,
  lastAnswer,
  normalizeSessionId,
  STOPPED_ANSWER,
} from "../src/extensions/sessions.ts"
import {
  createWorktree,
  removeWorktree,
  repoRoot,
} from "../src/services/worktree.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
  type Script,
} from "./support.ts"

function lastUser(messages: readonly Message[]) {
  const message = [...messages].reverse().find((item) => item.role === "user")
  if (!message) return ""
  return typeof message.content === "string"
    ? message.content
    : message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
}

/** A small session store on the Harness, in place of Pico's `Sessions`. */
function fakeSessions(harness: Harness) {
  const metas = new Map<string, HostSessionMeta & { createdAt: number }>()
  const unread = new Set<string>()
  const sessions = {
    has: (id: string | undefined): id is string => Boolean(id && metas.has(id)),
    current: (id: string | undefined) => id,
    meta: (id: string) => metas.get(id)!,
    isBusy: () => false,
    children: (id: string) =>
      [...metas.entries()]
        .filter(([, meta]) => meta.parent === id)
        .map(([key]) => key),
    list: (filter: { parent?: string }) =>
      [...metas.entries()]
        .filter(
          ([, meta]) =>
            filter.parent === undefined || meta.parent === filter.parent
        )
        .map(([id, meta]) => ({
          id,
          title: meta.name ?? id,
          cwd: meta.cwd,
          busy: false,
          needsInput: false,
          unread: unread.has(id),
          ...(meta.parent ? { parent: meta.parent } : {}),
          messageCount: 0,
        })),
    async create(
      cwd: string,
      options: {
        parent?: string
        spawnedByCall?: string
        name?: string
        worktree?: HostSessionMeta["worktree"]
        limits?: HostSessionMeta["limits"]
        profile?: string
      } = {}
    ) {
      const conversation = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { model: TEST_MODEL, cwd },
        },
        ctx
      )
      const id = sessionIdOf(conversation.id)
      metas.set(id, {
        cwd,
        firstMessage: "",
        messageCount: 0,
        createdAt: Date.now(),
        ...(options.parent ? { parent: options.parent, depth: 1 } : {}),
        ...(options.spawnedByCall
          ? { spawnedByCall: options.spawnedByCall }
          : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.worktree ? { worktree: options.worktree } : {}),
        ...(options.limits ? { limits: options.limits } : {}),
        ...(options.profile ? { profile: options.profile } : {}),
      })
      return id
    },
    async prompt(
      id: string,
      input: {
        message: string
        requestId?: string
        streamingBehavior?: "steer" | "followUp"
      }
    ) {
      const conversation = await harness.conversation(conversationOf(id), ctx)
      await conversation!.submit(
        {
          type: "input",
          content: input.message,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          whenBusy: input.streamingBehavior ?? "followUp",
        },
        ctx
      )
      return { queued: false }
    },
    async followUp(id: string, message: string, requestId: string) {
      const conversation = await harness.conversation(conversationOf(id), ctx)
      await conversation!.submit(
        { type: "input", content: message, requestId, whenBusy: "followUp" },
        ctx
      )
    },
    async changeLimits(
      id: string,
      change: { add?: string[]; remove?: string[] }
    ) {
      const meta = metas.get(id)!
      meta.limits = {
        add: [...(meta.limits?.add ?? []), ...(change.add ?? [])],
        remove: [...(meta.limits?.remove ?? []), ...(change.remove ?? [])],
      }
      return meta.limits
    },
    abort: async () => undefined,
    rename: (_id: string, name: string) => name,
    setRead: (id: string, read: boolean) => {
      if (read) unread.delete(id)
      else unread.add(id)
    },
    archive: (id: string) => {
      metas.get(id)!.archived = true
    },
    restore: (id: string) => {
      delete metas.get(id)!.archived
    },
    archivedSessions: () =>
      [...metas.entries()]
        .filter(([, meta]) => meta.archived)
        .map(([id, meta]) => ({ id, title: id, cwd: meta.cwd })),
    publishStateIfWatched: async () => undefined,
    extensionStateChanged: () => undefined,
    availableModels: () => [{ id: "test", provider: "test" }],
  }
  return { sessions, metas, unread }
}

function bind(host: HostBridge, harness: Harness, dataDir: string) {
  const fake = fakeSessions(harness)
  host.bind({
    sessions: fake.sessions as unknown as HostServices["sessions"],
    events: { push: () => undefined },
    terminals: {} as HostServices["terminals"],
    harness,
    settings: () => ({ ...DEFAULT_SETTINGS }),
    dataDir,
  })
  return fake
}

async function eventually<T>(read: () => Promise<T | undefined>, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error("Timed out")
}

void test("session ids normalize", () => {
  assert.equal(normalizeSessionId("12"), "s12")
  assert.equal(normalizeSessionId("pico:s12"), "s12")
  assert.equal(normalizeSessionId(" s3 "), "s3")
})

void test("spawn_session starts a child and reports its answer back", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Compute the answer"))
      return { text: "The answer is 42." }
    if (user.startsWith("[Finished work from child session"))
      return { text: "Thanks, child." }
    if (lastToolResult(messages)) return { text: "spawned" }
    return {
      tools: [
        {
          name: "spawn_session",
          arguments: { goal: "Compute the answer", name: "Helper" },
        },
      ],
    }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createSessionsExtension(host)],
    script,
    dir
  )
  const fake = bind(host, harness, dir)
  try {
    const parent = await fake.sessions.create(dir)
    const conversation = (await harness.conversation(
      conversationOf(parent),
      ctx
    ))!
    await conversation.submit({ type: "input", content: "delegate" }, ctx)
    const report = await eventually(async () => {
      const view = await conversation.context(ctx)
      const found = view.entries.find(
        (entry) =>
          entry.kind === "pi.user" &&
          JSON.stringify(entry.model).includes(
            "[Finished work from child session"
          )
      )
      return found ? JSON.stringify(found.model) : undefined
    })
    assert.match(report, /The answer is 42\./)
    const children = fake.sessions.children(parent)
    assert.equal(children.length, 1)
    assert.equal(fake.metas.get(children[0]!)?.name, "Helper")
    await conversation.waitForIdle(ctx)
    const view = await conversation.context(ctx)
    assert.equal(
      view.entries.filter(
        (entry) =>
          entry.kind === "pi.user" &&
          JSON.stringify(entry.model).includes(
            "[Finished work from child session"
          )
      ).length,
      1
    )
  } finally {
    await harness.close(ctx)
  }
})

void test("a child's question goes to the parent's follow-up queue, marked as a question", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Pick a database"))
      return { text: "Question: SQLite or Postgres?\nI recommend SQLite." }
    if (user.startsWith("[Question from child session"))
      return { text: "Use SQLite." }
    if (lastToolResult(messages)) return { text: "spawned" }
    return {
      tools: [
        {
          name: "spawn_session",
          arguments: {
            goal: "Pick a database",
            profile: "builder",
            add: ["notify"],
            remove: ["todo"],
            deny_commands: ["npm publish"],
          },
        },
      ],
    }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createSessionsExtension(host)],
    script,
    dir
  )
  const fake = bind(host, harness, dir)
  try {
    const parent = await fake.sessions.create(dir)
    const conversation = (await harness.conversation(
      conversationOf(parent),
      ctx
    ))!
    await conversation.submit({ type: "input", content: "delegate" }, ctx)
    const report = await eventually(async () => {
      const view = await conversation.context(ctx)
      const found = view.entries.find(
        (entry) =>
          entry.kind === "pi.user" &&
          JSON.stringify(entry.model).includes("[Question from child session")
      )
      return found ? JSON.stringify(found.model) : undefined
    })
    assert.match(report, /SQLite or Postgres/)
    const child = fake.sessions.children(parent)[0]!
    const meta = fake.metas.get(child)!
    assert.equal(meta.profile, "builder")
    assert.deepEqual(meta.limits, {
      add: ["notify"],
      remove: ["todo"],
      denyCommands: ["npm publish"],
    })
  } finally {
    await harness.close(ctx)
  }
})

void test("spawn_session with wait returns the answer, and read_session reads it", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let childId = ""
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Name a color")) return { text: "Blue." }
    const result = lastToolResult(messages)
    if (result?.includes("finished")) {
      childId = /session (s\d+)/.exec(result)?.[1] ?? ""
      return { tools: [{ name: "read_session", arguments: { id: childId } }] }
    }
    if (result) return { text: `read: ${result}` }
    return {
      tools: [
        {
          name: "spawn_session",
          arguments: { goal: "Name a color", wait: true },
        },
      ],
    }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createSessionsExtension(host)],
    script,
    dir
  )
  const fake = bind(host, harness, dir)
  try {
    const parent = await fake.sessions.create(dir)
    const conversation = (await harness.conversation(
      conversationOf(parent),
      ctx
    ))!
    await (
      await conversation.submit({ type: "input", content: "go" }, ctx)
    ).wait(ctx)
    const view = await conversation.context(ctx)
    const results = view.entries
      .filter((entry) => entry.kind === "pi.tool-result")
      .map((entry) => JSON.stringify(entry.model))
    assert.match(results[0]!, /finished.*Blue\./s)
    assert.match(results[1]!, /## User\\nName a color/)
    assert.match(results[1]!, /## Assistant\\nBlue\./)
  } finally {
    await harness.close(ctx)
  }
})

void test("a worktree is made outside the repository and removed when clean", async () => {
  const dir = await tempDir()
  const repo = join(dir, "repo")
  execFileSync("git", ["init", "-q", "-b", "main", repo])
  execFileSync("git", ["-C", repo, "config", "user.email", "t@example.com"])
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"])
  await writeFile(join(repo, "README.md"), "hi\n")
  await writeFile(join(repo, ".env"), "SECRET=1\n")
  await writeFile(join(repo, ".gitignore"), ".env\n")
  execFileSync("git", ["-C", repo, "add", "."])
  execFileSync("git", ["-C", repo, "commit", "-qm", "init"])
  const worktree = await createWorktree(repo, {
    dataDir: join(dir, "data"),
    copy: [".env*"],
    name: "Fix login bug",
  })
  assert.ok(worktree.path.startsWith(join(dir, "data", "worktrees", "repo")))
  assert.match(worktree.branch, /^pico\/fix-login-bug-/)
  assert.ok(existsSync(join(worktree.path, "README.md")))
  assert.deepEqual(worktree.copied, [".env"])
  assert.equal(await repoRoot(worktree.path), await repoRoot(repo))
  await writeFile(join(worktree.path, "new.txt"), "x")
  await assert.rejects(removeWorktree(worktree), /uncommitted changes/)
  await removeWorktree(worktree, { force: true })
  assert.equal(existsSync(worktree.path), false)
})

void test("the answer of a stopped run is not an earlier answer", async () => {
  const dir = await tempDir()
  const harness = await openHarness(join(dir, "db.sqlite"), [], () => ({
    text: "x",
  }))
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    const assistant = (text: string, stopReason: string) => ({
      kind: "pi.assistant",
      model: [
        {
          role: "assistant",
          content: text ? [{ type: "text", text }] : [],
          stopReason,
          timestamp: Date.now(),
        },
      ],
    })
    const user = (text: string) => ({
      kind: "pi.user",
      model: [{ role: "user", content: text, timestamp: Date.now() }],
    })
    await harness.commit(async (tx) => {
      await tx.appendEntry(conversation.id, user("first") as never)
      await tx.appendEntry(
        conversation.id,
        assistant("Old answer", "stop") as never
      )
    }, ctx)
    assert.equal(await lastAnswer(harness, conversation.id, ctx), "Old answer")
    await harness.commit(async (tx) => {
      await tx.appendEntry(conversation.id, user("second") as never)
      await tx.appendEntry(conversation.id, assistant("", "aborted") as never)
    }, ctx)
    assert.equal(
      await lastAnswer(harness, conversation.id, ctx),
      STOPPED_ANSWER
    )
  } finally {
    await harness.close(ctx)
  }
})

void test("agents mark sessions read and archive them", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let other = ""
  const script: Script = (messages) => {
    const step = messages.filter((m) => m.role === "toolResult").length
    const call = [
      { name: "mark_sessions_read", arguments: { ids: [other] } },
      { name: "mark_sessions_read", arguments: { ids: [other], unread: true } },
      { name: "archive_sessions", arguments: { ids: [other, "s999"] } },
      { name: "list_sessions", arguments: { scope: "archived" } },
      { name: "archive_sessions", arguments: { ids: [other], restore: true } },
    ][step]
    return call ? { tools: [call] } : { text: "done" }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createSessionsExtension(host)],
    script,
    dir
  )
  const fake = bind(host, harness, dir)
  try {
    const self = await fake.sessions.create(dir)
    other = await fake.sessions.create(dir)
    fake.unread.add(other)
    const conversation = (await harness.conversation(
      conversationOf(self),
      ctx
    ))!
    await (
      await conversation.submit({ type: "input", content: "tidy" }, ctx)
    ).wait(ctx)
    const view = await conversation.context(ctx)
    const results = view.entries
      .filter((entry) => entry.kind === "pi.tool-result")
      .map((entry) => JSON.stringify(entry.model))
    assert.equal(results.length, 5)
    assert.match(results[0]!, new RegExp(`Marked ${other} read`))
    assert.match(results[1]!, new RegExp(`Marked ${other} unread`))
    assert.match(results[2]!, new RegExp(`Archived ${other}`))
    assert.match(results[2]!, /s999: Unknown session/)
    assert.match(results[3]!, new RegExp(`${other} .*archived`))
    assert.match(results[4]!, new RegExp(`Restored ${other}`))
    assert.equal(fake.unread.has(other), true)
    assert.equal(fake.metas.get(other)?.archived, undefined)
  } finally {
    await harness.close(ctx)
  }
})

void test("an agent cannot archive itself", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let self = ""
  const script: Script = (messages) =>
    lastToolResult(messages)
      ? { text: "done" }
      : { tools: [{ name: "archive_sessions", arguments: { ids: [self] } }] }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createSessionsExtension(host)],
    script,
    dir
  )
  const fake = bind(host, harness, dir)
  try {
    self = await fake.sessions.create(dir)
    const conversation = (await harness.conversation(
      conversationOf(self),
      ctx
    ))!
    await (
      await conversation.submit({ type: "input", content: "go" }, ctx)
    ).wait(ctx)
    const view = await conversation.context(ctx)
    const result = view.entries.find((entry) => entry.kind === "pi.tool-result")
    assert.match(JSON.stringify(result?.model), /cannot archive itself/)
    assert.equal(fake.metas.get(self)?.archived, undefined)
  } finally {
    await harness.close(ctx)
  }
})
