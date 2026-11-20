import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import type { Message } from "@earendil-works/pi-ai"
import type {
  Conversation,
  ConversationId,
  Harness,
} from "@earendil-works/pi-durable"

import { DEFAULT_SETTINGS } from "../src/core/settings.ts"
import { HostBridge, type HostServices } from "../src/extensions/host.ts"
import {
  createScheduleExtension,
  firstFire,
  nextFire,
} from "../src/extensions/schedule.ts"
import {
  cancelConversationTimers,
  TimersDoc,
  type TimerItem,
} from "../src/extensions/timers.ts"
import {
  createWatchExtension,
  runCheck,
  summarizeChecks,
  untilOf,
} from "../src/extensions/watch.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
  TestClock,
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

/** The texts of the user entries of a conversation. */
async function userEntries(conversation: Conversation) {
  const context = await conversation.context(ctx)
  return context.entries
    .filter((entry) => entry.kind === "pi.user")
    .map((entry) => userTexts((entry.model ?? []) as Message[]).join("\n"))
}

/** Bind a host with stub agents. */
function bindHost(host: HostBridge, harness: Harness, dataDir: string) {
  host.bind({
    agents: {
      current: (id: string | undefined) => id,
      has: () => false,
      extensionStateChanged: () => undefined,
    } as unknown as HostServices["agents"],
    events: { push: () => undefined },
    terminals: {} as HostServices["terminals"],
    harness,
    settings: () => ({ ...DEFAULT_SETTINGS, worktreeCopy: [] }),
    dataDir,
  })
}

function extensions(host: HostBridge) {
  return [createScheduleExtension(host), createWatchExtension(host)]
}

/** A script that calls one tool for the first prompt, and answers text after it. */
function callOnce(
  name: string,
  args: Record<string, unknown>,
  replies: Record<string, string> = {}
): Script {
  return (messages) => {
    const last = userTexts(messages).at(-1) ?? ""
    for (const [prefix, text] of Object.entries(replies))
      if (last.startsWith(prefix)) return { text }
    if (lastToolResult(messages)) return { text: "set" }
    return { tools: [{ name, arguments: args }] }
  }
}

async function items(harness: Harness, id: ConversationId) {
  const state = await harness.snapshot(TimersDoc, id, ctx)
  return Object.values(state?.items ?? {})
}

async function itemWith(
  harness: Harness,
  id: ConversationId,
  match: (item: TimerItem) => boolean
) {
  return eventually(async () => (await items(harness, id)).find(match))
}

async function start(harness: Harness, cwd: string, prompt = "go") {
  const conversation = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL, cwd } },
    ctx
  )
  await (
    await conversation.submit({ type: "input", content: prompt }, ctx)
  ).wait(ctx)
  return conversation
}

void test("timer times: first fire, repeats, and cron", () => {
  const now = Date.parse("2026-01-05T10:00:00Z")
  assert.equal(firstFire({ in: "20m" }, now), now + 1_200_000)
  assert.equal(firstFire({ at: "2026-01-05T11:00:00Z" }, now), now + 3_600_000)
  assert.equal(firstFire({ at: "2020-01-01T00:00:00Z" }, now), now)
  assert.equal(firstFire({ every: "2h" }, now), now + 7_200_000)
  assert.throws(() => firstFire({}, now), /Give in/)
  assert.throws(() => firstFire({ in: "soon" }, now), /Not a duration/)
  assert.throws(() => firstFire({ cron: "nope" }, now), /Not a cron/)
  const input = { message: "", label: "", at: now, everyMs: 60_000 }
  // The next run counts from now, not from the missed time.
  assert.equal(nextFire(input, 1, now + 3_600_000), now + 3_660_000)
  assert.equal(nextFire({ ...input, maxRuns: 1 }, 1, now), undefined)
  const cron = nextFire(
    { message: "", label: "", at: now, cron: "0 12 * * *", timezone: "UTC" },
    0,
    now
  )
  assert.equal(new Date(cron!).toISOString(), "2026-01-05T12:00:00.000Z")
})

void test("watch checks: defaults, files, commands, and CI summaries", async () => {
  const dir = await tempDir()
  assert.equal(untilOf({ kind: "command" }), "success")
  assert.equal(untilOf({ kind: "url", pattern: "1\\.2" }), "match")
  assert.equal(untilOf({ kind: "file" }), "exists")
  assert.equal(untilOf({ kind: "pr_checks" }), "done")
  const marker = join(dir, "ready.txt")
  assert.equal(
    (await runCheck({ kind: "file", path: "ready.txt" }, dir, undefined)).met,
    false
  )
  await writeFile(marker, "version 1.2.3")
  assert.equal(
    (await runCheck({ kind: "file", path: marker }, dir, undefined)).met,
    true
  )
  assert.equal(
    (
      await runCheck(
        { kind: "file", path: "ready.txt", pattern: "1\\.2\\.3" },
        dir,
        undefined
      )
    ).met,
    true
  )
  const failed = await runCheck(
    { kind: "command", command: "echo nope; exit 3" },
    dir,
    undefined
  )
  assert.equal(failed.met, false)
  assert.match(failed.output, /exit 3\nnope/)
  const matched = await runCheck(
    { kind: "command", command: "echo v1.2.3", pattern: "v1\\.2" },
    dir,
    undefined
  )
  assert.equal(matched.met, true)
  const counts = summarizeChecks([
    { name: "lint", state: "SUCCESS", bucket: "pass" },
    { name: "test", state: "FAILURE", bucket: "fail", link: "https://ci/1" },
    { name: "e2e", state: "IN_PROGRESS", bucket: "pending" },
  ])
  assert.deepEqual(
    [counts.passed, counts.failed, counts.pending, counts.done],
    [1, 1, 1, false]
  )
})

void test("a timer fires and wakes the agent with its message", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    extensions(host),
    callOnce(
      "schedule",
      { in: "1", message: "check the build" },
      { "[Timer]": "woke up" }
    )
  )
  bindHost(host, harness, dir)
  try {
    const conversation = await start(harness, dir)
    const item = await itemWith(harness, conversation.id, () => true)
    assert.equal(item.status, "pending")
    assert.equal(item.kind, "timer")
    const done = await itemWith(
      harness,
      conversation.id,
      (entry) => entry.status === "done"
    )
    assert.equal(done.runs, 1)
    await conversation.waitForIdle(ctx)
    const users = await userEntries(conversation)
    assert.equal(
      users.filter((text) => text.startsWith("[Timer] check the build")).length,
      1
    )
  } finally {
    await harness.close(ctx)
  }
})

void test("a timer that came due while the server was down fires once", async () => {
  const dir = await tempDir()
  const database = join(dir, "db.sqlite")
  const clock = new TestClock()
  const script = callOnce(
    "schedule",
    { in: "1h", message: "ping" },
    { "[Timer]": "woke up" }
  )
  const open = async () => {
    const host = new HostBridge()
    const harness = await openHarness(
      database,
      extensions(host),
      script,
      dir,
      clock
    )
    bindHost(host, harness, dir)
    return harness
  }
  let harness = await open()
  let id: ConversationId
  try {
    const conversation = await start(harness, dir)
    id = conversation.id
    const item = await itemWith(harness, id, () => true)
    assert.equal(item.status, "pending")
  } finally {
    await harness.close(ctx)
  }
  // The server is down for two hours.
  clock.advance(2 * 3_600_000)
  harness = await open()
  try {
    harness.resume()
    const conversation = (await harness.conversation(id, ctx))!
    const done = await itemWith(harness, id, (item) => item.status === "done")
    assert.equal(done.runs, 1)
    await conversation.waitForIdle(ctx)
    const users = await userEntries(conversation)
    assert.equal(users.filter((text) => text.startsWith("[Timer]")).length, 1)
  } finally {
    await harness.close(ctx)
  }
})

void test("a repeating timer runs once after a long downtime, then from now", async () => {
  const dir = await tempDir()
  const database = join(dir, "db.sqlite")
  const clock = new TestClock()
  const script = callOnce(
    "schedule",
    { every: "10m", message: "tick" },
    { "[Timer": "ok" }
  )
  const open = async () => {
    const host = new HostBridge()
    const harness = await openHarness(
      database,
      extensions(host),
      script,
      dir,
      clock
    )
    bindHost(host, harness, dir)
    return harness
  }
  let harness = await open()
  let id: ConversationId
  try {
    id = (await start(harness, dir)).id
    await itemWith(harness, id, () => true)
  } finally {
    await harness.close(ctx)
  }
  // Down for a day: 144 missed runs.
  clock.advance(24 * 3_600_000)
  harness = await open()
  try {
    harness.resume()
    const conversation = (await harness.conversation(id, ctx))!
    const item = await itemWith(harness, id, (entry) => entry.runs === 1)
    assert.equal(item.status, "pending")
    assert.ok(
      Math.abs(item.nextAt! - (item.lastAt! + 600_000)) < 1000,
      "the next run is 10m after the run that fired"
    )
    await conversation.waitForIdle(ctx)
    // Give a flood a chance to show.
    await new Promise((done) => setTimeout(done, 300))
    const users = await userEntries(conversation)
    assert.equal(
      users.filter((text) => text.startsWith("[Timer, run")).length,
      1
    )
    // The next run comes 10 minutes later.
    clock.advance(600_000)
    await itemWith(harness, id, (entry) => entry.runs === 2)
    await cancelConversationTimers(harness, id, ctx)
    await itemWith(harness, id, (entry) => entry.status === "cancelled")
  } finally {
    await harness.close(ctx)
  }
})

void test("a command watch wakes the agent when the command succeeds", async () => {
  const dir = await tempDir()
  const clock = new TestClock()
  const host = new HostBridge()
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    extensions(host),
    callOnce(
      "watch",
      {
        kind: "command",
        command: "cat ready.txt",
        message: "The file is ready",
        interval: "5s",
      },
      { "[Watch]": "seen" }
    ),
    dir,
    clock
  )
  bindHost(host, harness, dir)
  try {
    const conversation = await start(harness, dir)
    // The first check runs at once and fails.
    const first = await itemWith(harness, conversation.id, (item) =>
      Boolean(item.lastOutput)
    )
    assert.equal(first.status, "pending")
    assert.match(first.lastOutput!, /^exit 1/)
    await writeFile(join(dir, "ready.txt"), "built at 12:00")
    clock.advance(5000)
    const done = await itemWith(
      harness,
      conversation.id,
      (item) => item.status === "done"
    )
    assert.equal(done.runs, 2)
    await conversation.waitForIdle(ctx)
    const wake = (await userEntries(conversation)).find((text) =>
      text.startsWith("[Watch] The file is ready")
    )
    assert.ok(wake)
    assert.match(wake, /Last check:\nexit 0\nbuilt at 12:00/)
  } finally {
    await harness.close(ctx)
  }
})

void test("a watch times out with its last check", async () => {
  const dir = await tempDir()
  const clock = new TestClock()
  const host = new HostBridge()
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    extensions(host),
    callOnce(
      "watch",
      {
        kind: "file",
        path: "never.txt",
        message: "It exists",
        interval: "5s",
        timeout: "12s",
      },
      { "[Watch": "noted" }
    ),
    dir,
    clock
  )
  bindHost(host, harness, dir)
  try {
    const conversation = await start(harness, dir)
    await itemWith(harness, conversation.id, (item) => item.runs === 1)
    clock.advance(20_000)
    await itemWith(harness, conversation.id, (item) => item.runs === 2)
    clock.advance(20_000)
    const failed = await itemWith(
      harness,
      conversation.id,
      (item) => item.status === "failed"
    )
    assert.equal(failed.kind, "watch")
    await conversation.waitForIdle(ctx)
    const wake = (await userEntries(conversation)).find((text) =>
      text.startsWith("[Watch timed out]")
    )
    assert.ok(wake)
    assert.match(wake, /never\.txt: missing/)
  } finally {
    await harness.close(ctx)
  }
})

void test("the cancel action stops a timer, and list shows it", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  let timerId = ""
  const script: Script = (messages) => {
    const users = userTexts(messages)
    const last = users.at(-1) ?? ""
    const result = lastToolResult(messages)
    if (last === "set") {
      if (result) {
        timerId = /Timer (\d+)/.exec(result)?.[1] ?? ""
        return { text: "set" }
      }
      return {
        tools: [{ name: "schedule", arguments: { in: "1h", message: "x" } }],
      }
    }
    if (last === "cancel") {
      if (result?.startsWith("Cancelled")) return { text: "cancelled" }
      if (result) return { text: `unexpected: ${result}` }
      return {
        tools: [
          { name: "schedule", arguments: { action: "cancel", id: timerId } },
        ],
      }
    }
    if (result) return { text: result }
    return { tools: [{ name: "schedule", arguments: { action: "list" } }] }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    extensions(host),
    script
  )
  bindHost(host, harness, dir)
  try {
    const conversation = await start(harness, dir, "set")
    assert.ok(timerId)
    const run = async (content: string) =>
      (await conversation.submit({ type: "input", content }, ctx)).wait(ctx)
    await run("list")
    let context = await conversation.context(ctx)
    assert.match(
      JSON.stringify(context.entries.at(-1)?.model),
      /\[timer\] x — fires in 1h/
    )
    await run("cancel")
    const item = await itemWith(
      harness,
      conversation.id,
      (entry) => entry.status === "cancelled"
    )
    assert.equal(item.id, timerId)
    await run("list")
    context = await conversation.context(ctx)
    assert.match(
      JSON.stringify(context.entries.at(-1)?.model),
      /1 finished: \d+ cancelled/
    )
  } finally {
    await harness.close(ctx)
  }
})
