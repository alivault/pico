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
  command: string,
  options: { defaultTimeout?: number; timeout?: number } = {}
) {
  let result: string | undefined
  let step = 0
  const harness = await openHarness(
    join(dir, `db-${Math.random()}.sqlite`),
    [
      createPicoCodingTools({
        shellPrefix: () => prefix,
        ...(options.defaultTimeout === undefined
          ? {}
          : { defaultTimeout: options.defaultTimeout }),
      }),
    ],
    (messages) => {
      step += 1
      if (step === 1)
        return {
          tools: [
            {
              name: "bash",
              arguments: {
                command,
                ...(options.timeout === undefined
                  ? {}
                  : { timeout: options.timeout }),
              },
            },
          ],
        }
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

void test("a bash call cannot wait for input", async () => {
  const dir = await tempDir()
  const output = await runBash(
    dir,
    undefined,
    'echo "[$GIT_EDITOR $GIT_SEQUENCE_EDITOR $EDITOR $VISUAL $GIT_PAGER $PAGER $GIT_TERMINAL_PROMPT]"; read line; echo "read=$?"'
  )
  assert.match(output, /\[true true true true cat cat 0\]/)
  assert.match(output, /read=1/)
})

void test("git rebase -i does not open an editor", async () => {
  const dir = await tempDir()
  const git = "git -c user.name=t -c user.email=t@t -c commit.gpgsign=false"
  const output = await runBash(
    dir,
    undefined,
    `git init -q repo && cd repo && ${git} commit -q --allow-empty -m a && ${git} commit -q --allow-empty -m b && ${git} rebase -i HEAD~1 && echo rebased`,
    { defaultTimeout: 20 }
  )
  assert.match(output, /rebased/)
})

void test("a bash call stops at the default timeout and says to use job_start", async () => {
  const dir = await tempDir()
  const output = await runBash(dir, undefined, "echo started; sleep 10", {
    defaultTimeout: 1,
  })
  assert.match(output, /started/)
  assert.match(output, /timed out after 1 seconds \(the default timeout\)/)
  assert.match(output, /job_start/)
})

void test("a timeout of the call replaces the default timeout", async () => {
  const dir = await tempDir()
  const output = await runBash(dir, undefined, "sleep 2; echo finished", {
    defaultTimeout: 1,
    timeout: 10,
  })
  assert.match(output, /finished/)
})
