import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { HostBridge } from "../src/extensions/host.ts"
import { createLspExtension, findPosition } from "../src/extensions/lsp.ts"
import { summarizeChecks } from "../src/extensions/watch.ts"
import {
  detectRunner,
  formatReport,
  parseCargo,
  parseGoJson,
  parseJestJson,
  parseJunit,
  runTests,
} from "../src/extensions/tests.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
  type Script,
} from "./support.ts"

/** Run one scripted turn: call `calls` in order, then answer with the results. */
async function runTools(
  dir: string,
  extensions: Parameters<typeof openHarness>[1],
  calls: Array<{ name: string; arguments: Record<string, unknown> }>
) {
  let step = 0
  const results: string[] = []
  const script: Script = (messages) => {
    const result = lastToolResult(messages)
    if (result !== undefined) results.push(result)
    const call = calls[step++]
    return call ? { tools: [call] } : { text: "done" }
  }
  const database = join(await tempDir("pico-db-"), "db.sqlite")
  const harness = await openHarness(database, extensions, script, dir)
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: TEST_MODEL,
          cwd: dir,
          // Load deferred tools, as tool_search does.
          modelTools: {
            add: extensions
              .flatMap((extension) => extension.tools ?? [])
              .filter((tool) => calls.some((call) => call.name === tool.name)),
          },
        },
      },
      ctx
    )
    await (
      await conversation.submit({ type: "input", content: "go" }, ctx)
    ).wait(ctx)
  } finally {
    await harness.close(ctx)
  }
  return results
}

void test("CI checks summarize by bucket", () => {
  const summary = summarizeChecks([
    { name: "lint", state: "SUCCESS", bucket: "pass" },
    { name: "test", state: "FAILURE", bucket: "fail", link: "https://x" },
    { name: "build", state: "IN_PROGRESS", bucket: "pending" },
  ])
  assert.deepEqual(
    [summary.passed, summary.failed, summary.pending, summary.done],
    [1, 1, 1, false]
  )
  assert.deepEqual(summary.failures, [{ name: "test", link: "https://x" }])
})

void test("test reports parse for each runner", async () => {
  const jest = parseJestJson(
    {
      numPassedTests: 3,
      numFailedTests: 1,
      numPendingTests: 1,
      numTotalTests: 5,
      testResults: [
        {
          name: "/repo/src/a.test.ts",
          status: "failed",
          assertionResults: [
            {
              fullName: "adds numbers",
              status: "failed",
              failureMessages: ["\u001b[31mExpected 3, got 4\u001b[0m"],
              location: { line: 7 },
            },
          ],
        },
      ],
    },
    "/repo"
  )
  assert.deepEqual(jest.failures, [
    {
      name: "adds numbers",
      file: "src/a.test.ts",
      line: 7,
      message: "Expected 3, got 4",
    },
  ])
  const junit = parseJunit(
    `<testsuite><testcase classname="t" name="ok"/><testcase classname="t" name="bad" file="t.py" line="3"><failure message="assert 1 == 2">trace &amp; more</failure></testcase><testcase classname="t" name="skip"><skipped/></testcase></testsuite>`
  )
  assert.deepEqual([junit.passed, junit.failed, junit.skipped], [1, 1, 1])
  assert.match(junit.failures[0]!.message, /assert 1 == 2\ntrace & more/)
  const go = parseGoJson(
    [
      '{"Action":"output","Package":"p","Test":"TestB","Output":"b_test.go:9: wrong\\n"}',
      '{"Action":"pass","Package":"p","Test":"TestA"}',
      '{"Action":"fail","Package":"p","Test":"TestB"}',
    ].join("\n")
  )
  assert.deepEqual([go.passed, go.failed], [1, 1])
  assert.match(go.failures[0]!.message, /wrong/)
  const cargo = parseCargo(
    "test a::works ... ok\ntest a::breaks ... FAILED\n\nfailures:\n\n---- a::breaks stdout ----\nboom\n\nfailures:\n"
  )
  assert.deepEqual([cargo.passed, cargo.failed], [1, 1])
  assert.equal(cargo.failures[0]!.message, "boom")

  const dir = await tempDir()
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ devDependencies: { vitest: "1" } })
  )
  assert.equal(detectRunner(dir), "vitest")
  const empty = {
    runner: "vitest",
    command: "vitest run -t nothing",
    exitCode: 0,
    passed: 0,
    failed: 0,
    skipped: 3,
    total: 3,
    durationMs: 10,
    failures: [],
    outputTail: "",
  }
  assert.match(formatReport(empty), /^NO TESTS/)
  const failing = await runTests(dir, { command: "echo nope; exit 2" })
  assert.equal(failing.exitCode, 2)
  assert.match(formatReport(failing), /^FAIL/)
  assert.match(formatReport(failing), /nope/)
})

void test("positions come from lines, columns, or symbols", () => {
  const text = "const a = 1\nfunction greet(name) {}\n"
  assert.deepEqual(findPosition(text, { line: 2, symbol: "greet" }), {
    line: 1,
    character: 9,
  })
  assert.deepEqual(findPosition(text, { symbol: "name" }), {
    line: 1,
    character: 15,
  })
  assert.deepEqual(findPosition(text, { line: 1, column: 7 }), {
    line: 0,
    character: 6,
  })
  assert.throws(() => findPosition(text, { symbol: "missing" }), /not found/)
})

void test("the TypeScript language server finds errors, definitions, and renames", async () => {
  const dir = await tempDir("pico-lsp-test-")
  await mkdir(join(dir, "src"))
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true } })
  )
  await writeFile(
    join(dir, "src", "math.ts"),
    "export function addNumbers(a: number, b: number) {\n  return a + b\n}\n"
  )
  await writeFile(
    join(dir, "src", "main.ts"),
    'import { addNumbers } from "./math"\nconst total: string = addNumbers(1, 2)\nconsole.log(total)\n'
  )
  const lsp = createLspExtension(new HostBridge())
  try {
    const results = await runTools(
      dir,
      [lsp.extension],
      [
        {
          name: "lsp",
          arguments: { action: "diagnostics", paths: ["src/main.ts"] },
        },
        {
          name: "lsp",
          arguments: {
            action: "definition",
            path: "src/main.ts",
            line: 2,
            symbol: "addNumbers",
          },
        },
        {
          name: "lsp",
          arguments: {
            action: "rename",
            path: "src/math.ts",
            line: 1,
            symbol: "addNumbers",
            new_name: "sum",
          },
        },
      ]
    )
    assert.match(results[0]!, /src\/main\.ts:2:\d+ error 2322/)
    assert.match(
      results[1]!,
      /src\/math\.ts:1:\d+ {2}export function addNumbers/
    )
    assert.match(results[2]!, /Renamed to sum in 2 file/)
    assert.match(
      await readFile(join(dir, "src", "main.ts"), "utf8"),
      /import \{ sum \}/
    )
    assert.match(
      await readFile(join(dir, "src", "math.ts"), "utf8"),
      /function sum\(/
    )
  } finally {
    await lsp.pool.shutdown()
  }
})
