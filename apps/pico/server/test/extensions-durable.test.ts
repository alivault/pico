import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import type { Message } from "@earendil-works/pi-ai"
import type { Conversation, Harness } from "@earendil-works/pi-durable"

import { DEFAULT_SETTINGS } from "../src/core/settings.ts"
import { HostBridge, type HostServices } from "../src/extensions/host.ts"
import {
  createJobsExtension,
  deleteOldJobLogs,
  jobNeedingUser,
  JobsDoc,
  plainText,
} from "../src/extensions/jobs.ts"
import {
  createScheduleExtension,
  firstFire,
  nextFire,
  TimersDoc,
} from "../src/extensions/schedule.ts"
import { createScratchpadExtension } from "../src/extensions/scratchpad.ts"
import { createWatchExtension, runCheck } from "../src/extensions/watch.ts"
import { Terminals } from "../src/services/terminal.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
  type Script,
} from "./support.ts"

function userTexts(messages: readonly Message[]) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("")
    )
}

async function eventually<T>(
  read: () => Promise<T | undefined>,
  ms = 8000
): Promise<T> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error("Timed out")
}

async function userEntries(conversation: Conversation) {
  const context = await conversation.context(ctx)
  return context.entries
    .filter((entry) => entry.kind === "pi.user")
    .map((entry) => JSON.stringify(entry.model))
}

/** Bind a host with stub sessions and real terminals. */
function bindHost(host: HostBridge, harness: Harness, dataDir: string) {
  const terminals = new Terminals()
  host.bind({
    sessions: {
      current: (id: string | undefined) => id,
      has: () => false,
      extensionStateChanged: () => undefined,
    } as unknown as HostServices["sessions"],
    events: { push: () => undefined },
    terminals,
    harness,
    settings: () => ({
      ...DEFAULT_SETTINGS,
      scratchSpillKb: 1,
      worktreeCopy: [],
    }),
    dataDir,
  })
  return terminals
}

void test("timer times: first fire, repeats, and cron", () => {
  const now = Date.parse("2026-01-05T10:00:00Z")
  assert.equal(firstFire({ in: "20m" }, now), now + 1_200_000)
  assert.equal(firstFire({ at: "2026-01-05T11:00:00Z" }, now), now + 3_600_000)
  assert.equal(firstFire({ at: "2020-01-01T00:00:00Z" }, now), now)
  assert.throws(() => firstFire({}, now), /Give at/)
  const input = { message: "", label: "", at: now, everyMs: 60_000 }
  assert.equal(nextFire(input, 1, now), now + 60_000)
  assert.equal(nextFire({ ...input, maxRuns: 1 }, 1, now), undefined)
  const cron = nextFire(
    { message: "", label: "", at: now, cron: "0 12 * * *", timezone: "UTC" },
    0,
    now
  )
  assert.equal(new Date(cron!).toISOString(), "2026-01-05T12:00:00.000Z")
})

void test("a timer fires once after a server restart", async () => {
  const dir = await tempDir()
  const database = join(dir, "db.sqlite")
  const script: Script = (messages) => {
    const users = userTexts(messages)
    if (users.at(-1)?.startsWith("[Scheduled]")) return { text: "woke up" }
    if (lastToolResult(messages)) return { text: "scheduled" }
    return {
      tools: [{ name: "schedule", arguments: { in: "1.2", message: "ping" } }],
    }
  }
  const open = async () => {
    const host = new HostBridge()
    const harness = await openHarness(
      database,
      [createScheduleExtension(host)],
      script
    )
    bindHost(host, harness, dir)
    return harness
  }
  let harness = await open()
  let id
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    id = conversation.id
    await (
      await conversation.submit({ type: "input", content: "later" }, ctx)
    ).wait(ctx)
    const timers = await harness.snapshot(TimersDoc, conversation.id, ctx)
    assert.equal(Object.values(timers!.items)[0]?.status, "pending")
  } finally {
    await harness.close(ctx)
  }
  await new Promise((done) => setTimeout(done, 1500))
  harness = await open()
  try {
    harness.resume()
    const conversation = (await harness.conversation(id!, ctx))!
    const users = await eventually(async () => {
      const entries = await userEntries(conversation)
      return entries.some((entry) => entry.includes("[Scheduled] ping"))
        ? entries
        : undefined
    })
    await conversation.waitForIdle(ctx)
    assert.equal(
      users.filter((entry) => entry.includes("[Scheduled] ping")).length,
      1
    )
    const timers = await eventually(async () => {
      const state = await harness.snapshot(TimersDoc, conversation.id, ctx)
      const item = Object.values(state?.items ?? {})[0]
      return item?.status === "done" ? item : undefined
    })
    assert.equal(timers.runs, 1)
  } finally {
    await harness.close(ctx)
  }
})

void test("a watch fires when its condition holds", async () => {
  const dir = await tempDir()
  const marker = join(dir, "ready.txt")
  await writeFile(marker, "ok")
  const met = await runCheck(
    { type: "file", path: marker, until: "exists" },
    dir,
    undefined
  )
  assert.equal(met.met, true)
  const failed = await runCheck(
    { type: "command", command: "exit 3" },
    dir,
    undefined
  )
  assert.equal(failed.met, false)
  assert.match(failed.output, /exit 3/)

  const host = new HostBridge()
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createWatchExtension(host)],
    (messages) => {
      const users = userTexts(messages)
      if (users.at(-1)?.startsWith("[Watch]")) return { text: "seen" }
      if (lastToolResult(messages)) return { text: "watching" }
      return {
        tools: [
          {
            name: "watch",
            arguments: {
              message: "The file is ready",
              check: { type: "file", path: "ready.txt", until: "exists" },
            },
          },
        ],
      }
    },
    dir
  )
  bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: TEST_MODEL, cwd: dir },
      },
      ctx
    )
    await conversation.submit({ type: "input", content: "watch it" }, ctx)
    await eventually(async () => {
      const entries = await userEntries(conversation)
      return entries.some((entry) =>
        entry.includes("[Watch] The file is ready")
      )
        ? true
        : undefined
    })
    const state = await eventually(async () => {
      const timers = await harness.snapshot(TimersDoc, conversation.id, ctx)
      const item = Object.values(timers?.items ?? {})[0]
      return item?.status === "done" ? item : undefined
    })
    assert.equal(state.kind, "watch")
  } finally {
    await harness.close(ctx)
  }
})

void test("a background job runs, logs, and reports its exit", async () => {
  assert.equal(plainText("\x1b[31mred\x1b[0m\r\nab\rcd\n"), "red\ncd\n")
  assert.equal(plainText("$ vite\n\n\n\n\n  ready  \n"), "$ vite\n\n  ready\n")
  const dir = await tempDir()
  const host = new HostBridge()
  const jobs = createJobsExtension(host, dir)
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [jobs.extension],
    (messages) => {
      const users = userTexts(messages)
      if (users.at(-1)?.startsWith("[Job")) return { text: "job done" }
      if (lastToolResult(messages)) return { text: "started" }
      return {
        tools: [
          {
            name: "job_start",
            arguments: {
              command:
                "for word in first second; do echo $word; sleep 0.2; done",
              wait_ms: 50,
            },
          },
        ],
      }
    },
    dir
  )
  const terminals = bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: TEST_MODEL, cwd: dir },
      },
      ctx
    )
    await conversation.submit({ type: "input", content: "run" }, ctx)
    const entries = await eventually(async () => {
      const users = await userEntries(conversation)
      return users.some((entry) => entry.includes("[Job finished]"))
        ? users
        : undefined
    })
    assert.match(entries.join("\n"), /second/)
    const state = await harness.snapshot(JobsDoc, conversation.id, ctx)
    const job = Object.values(state!.items)[0]!
    assert.equal(job.status, "exited")
    assert.equal(job.exitCode, 0)
    assert.match(await jobs.runner.log(job.id), /first\s+second/)
  } finally {
    terminals.shutdown()
    await harness.close(ctx)
  }
})

void test("a job that asks for a password waits, takes focus, and goes on after input", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const jobs = createJobsExtension(host, dir)
  let terminals: Terminals | undefined
  const results: string[] = []
  let jobId = ""
  let sawFocus = false
  let conversationId: Conversation["id"] | undefined
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [jobs.extension],
    (messages) => {
      // A steer can come after a tool result: read the newest result.
      const toolResults = messages.filter(
        (message) => message.role === "toolResult"
      )
      const result =
        toolResults.length > results.length
          ? lastToolResult([toolResults.at(-1)!])
          : undefined
      if (result === undefined) {
        if (toolResults.length > 0) return { text: "ok" }
        return {
          tools: [
            {
              name: "job_start",
              arguments: {
                command: "read -s -p 'Password: ' x; echo; echo got-$x",
                name: "login",
                wait_ms: 0,
              },
            },
          ],
        }
      }
      results.push(result)
      if (result.startsWith("Job ")) {
        jobId = /^Job (\S+)/.exec(result)![1]!
        return {
          tools: [
            { name: "job_wait", arguments: { id: jobId, timeout_ms: 10_000 } },
          ],
        }
      }
      if (result.includes("waits for input"))
        return {
          tools: [
            {
              name: "job_focus",
              arguments: { id: jobId, prompt: "Type the password" },
            },
          ],
        }
      if (result.startsWith("Asked the user")) {
        // The user types the password into the job's tab.
        setTimeout(() => {
          void harness.snapshot(JobsDoc, conversationId!, ctx).then((state) => {
            const job = state?.items[jobId]
            sawFocus = Boolean(job?.focus && job.waiting?.secret)
            const tab = terminals!.create("user", dir, `job:${jobId}`)
            terminals!.write("user", tab.id, "hunter2\r", 1, "viewer")
          })
        }, 200)
        return {
          tools: [
            {
              name: "job_wait",
              arguments: { id: jobId, pattern: "got-", timeout_ms: 10_000 },
            },
          ],
        }
      }
      return { text: "done" }
    },
    dir
  )
  terminals = bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: TEST_MODEL, cwd: dir },
      },
      ctx
    )
    conversationId = conversation.id
    await (
      await conversation.submit({ type: "input", content: "log in" }, ctx)
    ).wait(ctx)
    await eventually(async () =>
      results.some((result) => result.includes("got-hunter2"))
        ? true
        : undefined
    )
    assert.match(results[1]!, /waits for input with echo off/)
    assert.match(results[1]!, /Password:/)
    assert.ok(
      results.some((result) => /Matched new output: got-hunter2/.test(result))
    )
    assert.ok(sawFocus)
    const state = await eventually(async () => {
      const value = await harness.snapshot(JobsDoc, conversation.id, ctx)
      return value?.items[jobId]?.status === "exited" ? value : undefined
    })
    assert.equal(state.items[jobId]?.focus, undefined)
    assert.equal(state.items[jobId]?.waiting, undefined)
    // The steer about the wait did not come: job_wait reported it.
    const users = await userEntries(conversation)
    assert.ok(!users.some((entry) => entry.includes("[Job waits for input]")))
    // job_wait saw the exit right after the match: no exit message either.
    assert.ok(results.some((result) => /exited with code 0/.test(result)))
    assert.ok(!users.some((entry) => entry.includes("[Job finished]")))
  } finally {
    terminals.shutdown()
    await harness.close(ctx)
  }
})

void test("a running job that waits or has a focus request needs the user", () => {
  const base = {
    name: "login",
    command: "ssh asahi",
    cwd: "/",
    startedAt: 1,
    notifyOnExit: true,
  }
  assert.equal(jobNeedingUser({ items: {} }), undefined)
  assert.deepEqual(
    jobNeedingUser({
      items: {
        a: {
          ...base,
          id: "a",
          status: "exited",
          focus: { prompt: "x", at: 1 },
        },
        b: {
          ...base,
          id: "b",
          status: "running",
          waiting: { since: 1, prompt: "password:", secret: true },
        },
      },
    }),
    { jobId: "b", name: "login", prompt: "password:" }
  )
  assert.equal(
    jobNeedingUser({
      items: {
        c: {
          ...base,
          id: "c",
          status: "running",
          focus: { prompt: "Type your password", at: 2 },
        },
      },
    })?.prompt,
    "Type your password"
  )
})

void test("the scratchpad stores entries and spills large output", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const scratchpad = createScratchpadExtension(host, dir)
  const entry = await scratchpad.scratch.put(7, "a\nb\nc", { name: "abc" })
  assert.equal(entry.lines, 3)
  assert.equal(await scratchpad.scratch.get(99, entry.id), "a\nb\nc")
  assert.deepEqual(
    (await scratchpad.scratch.list(7)).map((item) => item.name),
    ["abc"]
  )
  const big = "line\n".repeat(600)
  const { defineExtension, defineTool } =
    await import("@earendil-works/pi-durable")
  const { Type } = await import("@earendil-works/pi-ai")
  const noisy = defineExtension({
    name: "noisy",
    tools: [
      defineTool({
        name: "noisy",
        description: "Print a lot",
        parameters: Type.Object({}),
        execute: async () => ({ output: [{ type: "text", text: big }] }),
      }),
    ],
  })
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [noisy, scratchpad.extension],
    (messages) =>
      lastToolResult(messages)
        ? { text: lastToolResult(messages)! }
        : { tools: [{ name: "noisy", arguments: {} }] }
  )
  bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    await (
      await conversation.submit({ type: "input", content: "go" }, ctx)
    ).wait(ctx)
    const context = await conversation.context(ctx)
    const result = JSON.stringify(
      context.entries.find((item) => item.kind === "pi.tool-result")?.model
    )
    assert.match(result, /The full output \(601 lines/)
    const id = /scratch (x[a-z0-9]+)/.exec(result)?.[1]
    assert.ok(id)
    assert.equal(await scratchpad.scratch.get(conversation.id, id), big)
  } finally {
    await harness.close(ctx)
  }
})

void test("running jobs of an earlier process become lost at startup", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const jobs = createJobsExtension(host, dir)
  const { JobIndexDoc } = await import("../src/extensions/jobs.ts")
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [jobs.extension],
    () => ({ text: "noted" }),
    dir
  )
  const terminals = bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    await harness.commit(async (tx) => {
      const draft = await tx.doc(JobsDoc, conversation.id)
      draft.items.jold = {
        id: "jold",
        name: "server",
        command: "npm run dev",
        cwd: dir,
        status: "running",
        startedAt: Date.now() - 1000,
        notifyOnExit: true,
      }
      const index = await tx.doc(JobIndexDoc)
      index.running.jold = Number(conversation.id)
    }, ctx)
    await host.started()
    const state = await harness.snapshot(JobsDoc, conversation.id, ctx)
    assert.equal(state?.items.jold?.status, "lost")
    assert.deepEqual((await harness.snapshot(JobIndexDoc, ctx))?.running, {})
    const users = await eventually(async () => {
      const entries = await userEntries(conversation)
      return entries.length > 0 ? entries : undefined
    })
    assert.match(users[0]!, /\[Job lost\] server/)
  } finally {
    terminals.shutdown()
    await harness.close(ctx)
  }
})

void test("a pruned job record takes its log file with it", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const jobs = createJobsExtension(host, dir)
  const { JobIndexDoc } = await import("../src/extensions/jobs.ts")
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [jobs.extension],
    () => ({ text: "noted" }),
    dir
  )
  const terminals = bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    await mkdir(join(dir, "jobs"), { recursive: true })
    await harness.commit(async (tx) => {
      const draft = await tx.doc(JobsDoc, conversation.id)
      for (let index = 0; index < 30; index += 1) {
        const id = `jdone${index}`
        draft.items[id] = {
          id,
          name: "old",
          command: "true",
          cwd: dir,
          status: "exited",
          exitCode: 0,
          startedAt: index,
          endedAt: index + 1,
          notifyOnExit: false,
        }
      }
      draft.items.jlive = {
        id: "jlive",
        name: "server",
        command: "npm run dev",
        cwd: dir,
        status: "running",
        startedAt: Date.now() - 1000,
        notifyOnExit: false,
      }
      const index = await tx.doc(JobIndexDoc)
      index.running.jlive = Number(conversation.id)
    }, ctx)
    for (const id of ["jdone0", "jdone1", "jlive"])
      await writeFile(join(dir, "jobs", `${id}.log`), "output\n")
    // The restart makes jlive lost: 31 finished jobs, so the oldest goes.
    await host.started()
    const state = await harness.snapshot(JobsDoc, conversation.id, ctx)
    assert.equal(state?.items.jdone0, undefined)
    assert.ok(state?.items.jdone1)
    assert.equal(existsSync(join(dir, "jobs", "jdone0.log")), false)
    assert.equal(existsSync(join(dir, "jobs", "jdone1.log")), true)
    assert.equal(existsSync(join(dir, "jobs", "jlive.log")), true)
  } finally {
    terminals.shutdown()
    await harness.close(ctx)
  }
})

void test("old job logs go, except the logs of running jobs", async () => {
  const dir = await tempDir()
  await mkdir(join(dir, "jobs"), { recursive: true })
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  for (const name of [
    "jold.log",
    "jold.1.log",
    "jrun.log",
    "jnew.log",
    "notes.txt",
  ]) {
    const path = join(dir, "jobs", name)
    await writeFile(path, "x")
    if (name !== "jnew.log") await utimes(path, old, old)
  }
  assert.equal(await deleteOldJobLogs(dir, new Set(["jrun"])), 2)
  assert.deepEqual((await readdir(join(dir, "jobs"))).sort(), [
    "jnew.log",
    "jrun.log",
    "notes.txt",
  ])
})

void test("a job that the server stops at shutdown is reported as lost, not finished", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const jobs = createJobsExtension(host, dir)
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [jobs.extension],
    (messages) =>
      lastToolResult(messages)
        ? { text: "started" }
        : userTexts(messages).at(-1)?.startsWith("[Job")
          ? { text: "seen" }
          : {
              tools: [
                {
                  name: "job_start",
                  arguments: { command: "sleep 30", wait_ms: 0 },
                },
              ],
            },
    dir
  )
  const terminals = bindHost(host, harness, dir)
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: TEST_MODEL, cwd: dir },
      },
      ctx
    )
    await (
      await conversation.submit({ type: "input", content: "run" }, ctx)
    ).wait(ctx)
    host.stopping = true
    terminals.shutdown()
    await new Promise((done) => setTimeout(done, 300))
    const before = await harness.snapshot(JobsDoc, conversation.id, ctx)
    assert.equal(Object.values(before!.items)[0]!.status, "running")
    host.stopping = false
    await host.started()
    const after = await harness.snapshot(JobsDoc, conversation.id, ctx)
    assert.equal(Object.values(after!.items)[0]!.status, "lost")
    const users = await eventually(async () => {
      const entries = await userEntries(conversation)
      return entries.some((entry) => entry.includes("[Job lost]"))
        ? entries
        : undefined
    })
    assert.ok(!users.some((entry) => entry.includes("[Job finished]")))
  } finally {
    await harness.close(ctx)
  }
})
