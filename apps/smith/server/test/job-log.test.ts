import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import {
  deleteJobLog,
  jobLogParts,
  JobLogWriter,
  plainText,
  readLogTailLines,
  readLogTailRaw,
  scanLogLines,
} from "../src/services/job-log.ts"
import { tempDir } from "./support.ts"

void test("a job log keeps its newest output in two parts", async () => {
  const dir = await tempDir()
  const writer = new JobLogWriter(dir, "jlog", 1000)
  for (let index = 1; index <= 300; index += 1)
    writer.write(`\x1b[32mline ${index}\x1b[0m\r\n`)
  writer.end()
  const parts = jobLogParts(dir, "jlog")
  assert.equal(parts.length, 2)
  // The oldest lines are gone; the newest are kept.
  const lines: string[] = []
  const total = await scanLogLines(parts, (line) => {
    lines.push(line)
  })
  assert.equal(total, lines.length)
  assert.ok(total < 200)
  assert.equal(lines.at(-1), "line 300")
  assert.deepEqual(await readLogTailLines(parts, 3), [
    "line 298",
    "line 299",
    "line 300",
  ])
  // A raw tail starts at a line break, not in an escape sequence.
  const raw = readLogTailRaw(parts, 50)
  assert.ok(raw.startsWith("\x1b[32mline"))
  assert.match(plainText(raw), /line 300/)
  deleteJobLog(dir, "jlog")
  assert.equal(existsSync(join(dir, "jobs", "jlog.log")), false)
  assert.deepEqual(jobLogParts(dir, "jlog"), [])
  assert.deepEqual(await readLogTailLines([], 5), [])
})

void test("a log scan counts a run of blank lines as one", async () => {
  const dir = await tempDir()
  const writer = new JobLogWriter(dir, "jblank")
  writer.write("a\n\n\n\nb\nc\n")
  writer.end()
  const lines: Array<[number, string]> = []
  await scanLogLines(jobLogParts(dir, "jblank"), (line, number) => {
    lines.push([number, line])
    if (line === "b") return false
  })
  assert.deepEqual(lines, [
    [1, "a"],
    [2, ""],
    [3, "b"],
  ])
  assert.throws(() => jobLogParts(dir, "../x"), /Invalid job id/)
})
