#!/usr/bin/env node
/**
 * Every client request must reach the machine of the page. Requests go
 * through `buildRequestUrl`, `fetchJson`, or `apiUrl` (see
 * `src/lib/pico/machine.ts`), which add the `/m/<machine>` prefix of the hub
 * proxy. This check fails on a raw `fetch`, `EventSource`, or `WebSocket`
 * with a server path.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, "src")
const RAW_REQUEST =
  /\b(?:fetch|new\s+EventSource|new\s+WebSocket)\(\s*["'`]\/(?:api\/|events\b)/g

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(ts|tsx)$/.test(name)) yield path
  }
}

const problems = []
for (const file of files(source)) {
  const text = readFileSync(file, "utf8")
  for (const match of text.matchAll(RAW_REQUEST)) {
    const line = text.slice(0, match.index).split("\n").length
    problems.push(`${relative(root, file)}:${line}: ${match[0]}`)
  }
}
if (problems.length > 0) {
  console.error(
    "Raw server paths skip the machine prefix. Use buildRequestUrl, fetchJson, or apiUrl:"
  )
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
