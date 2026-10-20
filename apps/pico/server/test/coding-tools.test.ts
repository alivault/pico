import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { createPicoCodingTools } from "../src/core/coding-tools.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
} from "./support.ts"

/** Run one bash command through the coding tools; return the tool's result text. */
async function runBash(
  dir: string,
  prefix: string | undefined,
  command: string
) {
  let result: string | undefined
  let step = 0
  const harness = await openHarness(
    join(dir, `db-${Math.random()}.sqlite`),
    [createPicoCodingTools({ shellPrefix: () => prefix })],
    (messages) => {
      step += 1
      if (step === 1)
        return { tools: [{ name: "bash", arguments: { command } }] }
      result = lastToolResult(messages)
      return { text: "done" }
    },
    dir
  )
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    await (
      await conversation.submit({ type: "input", content: "run" }, ctx)
    ).wait(ctx)
  } finally {
    await harness.close(ctx)
  }
  return result ?? ""
}

void test("the shell prefix comes before every bash command", async () => {
  const dir = await tempDir()
  assert.match(
    await runBash(dir, "MARK=prefixed", 'echo "[$MARK]"'),
    /\[prefixed\]/
  )
  assert.match(await runBash(dir, undefined, 'echo "[${MARK:-}]"'), /\[\]/)
})

void test("with set -u, a variable from an earlier call stops rm before it runs", async () => {
  // Each bash call is a new shell: T set in one call is empty in the next.
  // Without the prefix, `rm -rf "$T"/*` would be `rm -rf /*`; here the
  // target is a scratch directory, so the test shows only which one runs.
  const dir = await tempDir()
  const scratch = join(dir, "scratch")
  await mkdir(scratch)
  await writeFile(join(scratch, "keep"), "x")
  const command = `cd "${scratch}" && rm -rf ./"$T"*`

  const guarded = await runBash(dir, "set -u", command)
  assert.match(guarded, /T: unbound variable/)
  assert.ok(existsSync(join(scratch, "keep")), "set -u stopped rm")

  await runBash(dir, undefined, command)
  assert.ok(
    !existsSync(join(scratch, "keep")),
    "without it, rm ran with T empty"
  )
})
