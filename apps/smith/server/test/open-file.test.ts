import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import type { Harness } from "@earendil-works/pi-durable"

import { DEFAULT_SETTINGS } from "../src/core/settings.ts"
import { HostBridge, type HostServices } from "../src/extensions/host.ts"
import {
  createOpenFileExtension,
  resolveOpenFile,
} from "../src/extensions/open-file.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
} from "./support.ts"

async function workspace() {
  const root = await tempDir("smith-open-file-test-")
  const cwd = join(root, "project")
  await mkdir(join(cwd, "src"), { recursive: true })
  await writeFile(
    join(cwd, "src", "app.ts"),
    Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
  )
  await writeFile(join(root, "outside.txt"), "outside")
  return { root, cwd }
}

void test("open_file checks the path and the lines", async () => {
  const { root, cwd } = await workspace()
  assert.deepEqual(
    await resolveOpenFile(cwd, {
      path: "./src/app.ts",
      line: 10,
      end_line: 12,
      note: "  the\nfix  ",
    }),
    { path: "src/app.ts", line: 10, endLine: 12, note: "the fix" }
  )
  // An absolute path inside the folder becomes relative.
  assert.deepEqual(
    await resolveOpenFile(cwd, { path: join(cwd, "src", "app.ts") }),
    { path: "src/app.ts" }
  )
  assert.deepEqual(
    await resolveOpenFile(cwd, { path: "src/app.ts", line: 5, end_line: 5 }),
    { path: "src/app.ts", line: 5 }
  )
  await assert.rejects(
    resolveOpenFile(cwd, { path: "src/missing.ts" }),
    /File not found: src\/missing\.ts/
  )
  await assert.rejects(resolveOpenFile(cwd, { path: "src" }), /Not a file/)
  await assert.rejects(
    resolveOpenFile(cwd, { path: "../outside.txt" }),
    /outside this agent's folder/
  )
  await assert.rejects(
    resolveOpenFile(cwd, { path: join(root, "outside.txt") }),
    /outside this agent's folder/
  )
  await assert.rejects(
    resolveOpenFile(cwd, { path: "src/app.ts", line: 31 }),
    /has 30 lines; line 31 is after its end/
  )
  await assert.rejects(
    resolveOpenFile(cwd, { path: "src/app.ts", line: 8, end_line: 4 }),
    /end_line must not be before line/
  )
  await assert.rejects(
    resolveOpenFile(cwd, { path: "src/app.ts", end_line: 4 }),
    /end_line needs line/
  )
  await assert.rejects(
    resolveOpenFile(cwd, { path: "src/app.ts", line: 0 }),
    /line must be a whole number/
  )
})

void test("open_file sends an open_file event to the viewers", async () => {
  const { cwd } = await workspace()
  const pushed: Array<{ payload: Record<string, unknown>; target?: unknown }> =
    []
  const host = new HostBridge()
  const calls: Array<Record<string, unknown>> = [
    { path: "src/app.ts", line: 3, end_line: 4, note: "here" },
    { path: "../outside.txt" },
  ]
  const results: string[] = []
  let harness: Harness | undefined
  harness = await openHarness(
    join(cwd, "..", "smith.sqlite"),
    [createOpenFileExtension(host)],
    (messages) => {
      const result = lastToolResult(messages)
      if (result !== undefined) results.push(result)
      const next = calls.shift()
      return next
        ? { tools: [{ name: "open_file", arguments: next }] }
        : { text: "done" }
    },
    cwd
  )
  host.bind({
    agents: {
      current: (id: string | undefined) => id,
      has: () => false,
    } as unknown as HostServices["agents"],
    events: {
      push: (payload, target) => {
        pushed.push({ payload, target })
      },
    },
    terminals: {} as HostServices["terminals"],
    harness,
    settings: () => ({ ...DEFAULT_SETTINGS }),
    dataDir: cwd,
  })
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL, cwd } },
      ctx
    )
    await (
      await conversation.submit({ type: "input", content: "show me" }, ctx)
    ).wait(ctx)
    const agentId = `s${conversation.id}`
    assert.equal(pushed.length, 1)
    const { callId, ...payload } = pushed[0]!.payload
    assert.equal(typeof callId, "string")
    assert.deepEqual(payload, {
      type: "open_file",
      agentId,
      cwd,
      path: "src/app.ts",
      line: 3,
      endLine: 4,
      note: "here",
    })
    assert.deepEqual(pushed[0]!.target, { agentId })
    assert.match(results[0]!, /Sent src\/app\.ts:3-4 to the user's file viewer/)
    assert.match(results[1]!, /outside this agent's folder/)
  } finally {
    await harness.close(ctx)
  }
})
