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
  waitingOn,
} from "../src/extensions/sessions.ts"
import { JobsDoc } from "../src/extensions/jobs.ts"
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
    if (user.includes(": done]")) return { text: "Thanks, child." }
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
          JSON.stringify(entry.model).includes(": done]")
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
          JSON.stringify(entry.model).includes(": done]")
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
    if (user.includes(": question]")) return { text: "Use SQLite." }
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
          JSON.stringify(entry.model).includes(": question]")
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

void test("a child that waits on a job sends nothing until it is done", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Build it")) return { text: "Started the build." }
    if (user.startsWith("[Job")) return { text: "The build passed." }
    if (user.includes(": done]")) return { text: "Thanks." }
    if (lastToolResult(messages)) return { text: "spawned" }
    return {
      tools: [{ name: "spawn_session", arguments: { goal: "Build it" } }],
    }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createSessionsExtension(host)],
    script,
    dir
  )
  const fake = bind(host, harness, dir)
  const setJob = (id: string, status: "running" | "exited") =>
    harness.commit(async (tx) => {
      const draft = await tx.doc(JobsDoc, conversationOf(id))
      draft.items.j1 = {
        id: "j1",
        name: "build",
        command: "make",
        cwd: dir,
        status,
        startedAt: Date.now(),
        notifyOnExit: true,
      }
    }, ctx)
  const create = fake.sessions.create.bind(fake.sessions)
  fake.sessions.create = async (cwd, options) => {
    const id = await create(cwd, options)
    if (options?.parent) await setJob(id, "running")
    return id
  }
  try {
    const parent = await fake.sessions.create(dir)
    const conversation = (await harness.conversation(
      conversationOf(parent),
      ctx
    ))!
    const reports = async () =>
      (await conversation.context(ctx)).entries.filter(
        (entry) =>
          entry.kind === "pi.user" &&
          JSON.stringify(entry.model).includes("[Child session")
      )
    await conversation.submit({ type: "input", content: "delegate" }, ctx)
    const child = await eventually(
      async () => fake.sessions.children(parent)[0]
    )
    const childConversation = (await harness.conversation(
      conversationOf(child),
      ctx
    ))!
    await eventually(async () =>
      (await lastAnswer(harness, conversationOf(child), ctx)) ===
      "Started the build."
        ? true
        : undefined
    )
    await new Promise((done) => setTimeout(done, 300))
    assert.equal((await reports()).length, 0)
    assert.equal(
      await waitingOn(harness, conversationOf(child), ctx),
      "a job (build)"
    )
    await setJob(child, "exited")
    await childConversation.submit(
      { type: "input", content: "[Job j1 exited]" },
      ctx
    )
    const report = await eventually(async () => {
      const found = (await reports())[0]
      return found ? JSON.stringify(found.model) : undefined
    }, 12_000)
    assert.match(report, /: done\]/)
    assert.match(report, /The build passed\./)
  } finally {
    await harness.close(ctx)
  }
})

void test("each message to a busy child gets its own answer back, one time", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let child = ""
  let release = false
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Slow work"))
      return release
        ? { text: "The work is done." }
        : { tools: [{ name: "sessions", arguments: { action: "list" } }] }
    const fyi = /\] (FYI \d)/.exec(user)
    if (fyi) return { text: `Noted ${fyi[1]}.` }
    if (lastToolResult(messages)) return { text: "ok" }
    if (user.includes(": done]")) return { text: "Thanks." }
    if (user.startsWith("fyi"))
      return {
        tools: [
          {
            name: "send_to_session",
            arguments: { id: child, message: user.replace("fyi", "FYI") },
          },
        ],
      }
    return {
      tools: [{ name: "spawn_session", arguments: { goal: "Slow work" } }],
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
    const reports = async () =>
      (await conversation.context(ctx)).entries
        .filter(
          (entry) =>
            entry.kind === "pi.user" &&
            JSON.stringify(entry.model).includes("[Child session")
        )
        .map(
          (entry) =>
            /(The work is done|Noted FYI \d)/.exec(
              lastUser(entry.model as Message[])
            )?.[1]
        )
    await conversation.submit({ type: "input", content: "delegate" }, ctx)
    child = await eventually(async () => fake.sessions.children(parent)[0])
    await conversation.waitForIdle(ctx)
    // The child is still busy: both messages wait in its follow-up queue.
    for (const message of ["fyi 1", "fyi 2"]) {
      await conversation.submit({ type: "input", content: message }, ctx)
      await conversation.waitForIdle(ctx)
    }
    release = true
    await eventually(
      async () => ((await reports()).length >= 3 ? true : undefined),
      12_000
    )
    await new Promise((done) => setTimeout(done, 300))
    await conversation.waitForIdle(ctx)
    // Each report waits for the child to be idle, so their order can vary.
    assert.deepEqual(
      (await reports()).toSorted((a, b) => String(a).localeCompare(String(b))),
      ["Noted FYI 1", "Noted FYI 2", "The work is done"]
    )
  } finally {
    await harness.close(ctx)
  }
})

void test("spawn_session with wait returns the answer, and sessions read reads it", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let childId = ""
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Name a color")) return { text: "Blue." }
    const result = lastToolResult(messages)
    if (result?.includes("finished")) {
      childId = /session (s\d+)/.exec(result)?.[1] ?? ""
      return { tools: [{ name: "sessions", arguments: { action: "read", id: childId } }] }
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
      { name: "sessions", arguments: { action: "mark_read", ids: [other] } },
      {
        name: "sessions",
        arguments: { action: "mark_unread", ids: [other] },
      },
      {
        name: "sessions",
        arguments: { action: "archive", ids: [other, "s999"] },
      },
      {
        name: "sessions",
        arguments: { action: "list", scope: "archived" },
      },
      {
        name: "sessions",
        arguments: { action: "restore", ids: [other] },
      },
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
      : { tools: [{
              name: "sessions",
              arguments: { action: "archive", ids: [self] },
            }] }
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

/** The user entries of a conversation that are reports of other sessions. */
async function reportsIn(harness: Harness, id: string) {
  const conversation = (await harness.conversation(conversationOf(id), ctx))!
  return (await conversation.context(ctx)).entries
    .filter((entry) => entry.kind === "pi.user")
    .map((entry) => lastUser(entry.model as Message[]))
    .filter((text) => /^\[(Child session|Session) s\d+: /.test(text))
}

void test("sessions wait and the report give an answer one time", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let child = ""
  let release = false
  const script: Script = (messages) => {
    const user = lastUser(messages)
    if (user.startsWith("Name a color"))
      return release
        ? { text: "Blue." }
        : { tools: [{ name: "sessions", arguments: { action: "list" } }] }
    if (user.startsWith("[Child session")) return { text: "Got a report." }
    const result = lastToolResult(messages)
    if (result?.includes("Started child session")) {
      child = /session (s\d+)/.exec(result)?.[1] ?? ""
      release = true
      return {
        tools: [
          {
            name: "sessions",
            arguments: { action: "wait", ids: [child], any: true },
          },
        ],
      }
    }
    if (result) return { text: "waited" }
    return {
      tools: [{ name: "spawn_session", arguments: { goal: "Name a color" } }],
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
    // Give the report task time to run.
    await new Promise((done) => setTimeout(done, 800))
    await conversation.waitForIdle(ctx)
    const wait = (await conversation.context(ctx)).entries
      .filter((entry) => entry.kind === "pi.tool-result")
      .map((entry) => JSON.stringify(entry.model))
      .at(-1)!
    assert.match(wait, /new answer/)
    const reports = await reportsIn(harness, parent)
    const shown = (wait.includes("Blue.") ? 1 : 0) + reports.length
    assert.equal(shown, 1, `wait: ${wait}\nreports: ${reports.join("\n")}`)
  } finally {
    await harness.close(ctx)
  }
})

void test("a child's message to its parent gets no report back", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let parent = ""
  const script: Script = (messages) => {
    const user = lastUser(messages)
    const result = lastToolResult(messages)
    if (user.startsWith("Work and tell")) {
      if (result?.includes("Sent to your parent"))
        return { text: "The work is done." }
      return {
        tools: [
          {
            name: "send_to_session",
            arguments: { id: parent, message: "Half done." },
          },
        ],
      }
    }
    if (user.startsWith("[Child session")) return { text: "Noted." }
    if (result) return { text: "ok" }
    return {
      tools: [{ name: "spawn_session", arguments: { goal: "Work and tell" } }],
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
    parent = await fake.sessions.create(dir)
    const conversation = (await harness.conversation(
      conversationOf(parent),
      ctx
    ))!
    await conversation.submit({ type: "input", content: "go" }, ctx)
    const child = await eventually(
      async () => fake.sessions.children(parent)[0]
    )
    await eventually(async () =>
      (await reportsIn(harness, parent)).some((text) =>
        text.includes("The work is done.")
      )
        ? true
        : undefined
    )
    await new Promise((done) => setTimeout(done, 800))
    await conversation.waitForIdle(ctx)
    const reports = await reportsIn(harness, parent)
    assert.equal(reports.length, 2)
    assert.match(reports.join("\n"), /Half done\./)
    // The parent's "Noted." does not go back to the child.
    assert.deepEqual(await reportsIn(harness, child), [])
  } finally {
    await harness.close(ctx)
  }
})
