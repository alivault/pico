import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"

import { HostBridge } from "../src/extensions/host.ts"
import {
  formatDuration,
  parseDuration,
  posixShell,
  textResult,
} from "../src/extensions/util.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
} from "./support.ts"

void test("durations parse common forms and reject others", () => {
  assert.equal(parseDuration("90s"), 90_000)
  assert.equal(parseDuration("20m"), 1_200_000)
  assert.equal(parseDuration("1h30m"), 5_400_000)
  assert.equal(parseDuration("2d"), 172_800_000)
  assert.equal(parseDuration("45"), 45_000)
  assert.equal(parseDuration(10), 10_000)
  assert.equal(parseDuration("soon"), undefined)
  assert.equal(parseDuration("5 parsecs"), undefined)
  assert.equal(formatDuration(90_000), "2m")
  assert.equal(formatDuration(5_400_000), "1h30m")
})

void test("commands run in a POSIX shell", () => {
  assert.equal(posixShell("/bin/zsh"), "/bin/zsh")
  assert.match(posixShell("/opt/homebrew/bin/fish"), /\/(bash|sh)$/)
})

void test("the host bridge waits for bind and honors abort", async () => {
  const bridge = new HostBridge()
  const aborted = new AbortController()
  const cancelled = bridge.ready(aborted.signal)
  aborted.abort(new Error("stop"))
  await assert.rejects(cancelled, /stop/)
  const waiting = bridge.ready()
  const services = { dataDir: "/tmp" } as never
  bridge.bind(services)
  assert.equal(await waiting, services)
  assert.equal(await bridge.ready(), services)
})

void test("the scripted model drives a tool turn", async () => {
  const dir = await tempDir()
  const echo = defineTool({
    name: "echo",
    description: "Echo text",
    parameters: Type.Object({ text: Type.String() }),
    execute: async (args) => textResult(`echo: ${args.text}`),
  })
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [defineExtension({ name: "echo", tools: [echo] })],
    (messages) => {
      const result = lastToolResult(messages)
      return result
        ? { text: `got ${result}` }
        : { tools: [{ name: "echo", arguments: { text: "hi" } }] }
    }
  )
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    const submission = await conversation.submit(
      { type: "input", content: "go" },
      ctx
    )
    await submission.wait(ctx)
    const context = await conversation.context(ctx)
    const last = context.entries.at(-1)
    assert.equal(last?.kind, "pi.assistant")
    assert.match(JSON.stringify(last?.model), /got echo: hi/)
  } finally {
    await harness.close(ctx)
  }
})
