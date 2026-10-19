#!/usr/bin/env node
/**
 * Every client request names its machine. Requests go through
 * `buildRequestUrl` (with a `machineId`), `buildHubRequestUrl`, `hubUrl`, or
 * `machineApiUrl` (see `src/lib/pico/machine.ts`), which add the
 * `/m/<machine>` prefix of the hub proxy. This check fails on:
 *
 * - a raw `fetch`, `EventSource`, or `WebSocket` with a server path;
 * - a read of the machine that the page shows (`pageMachine`) outside the
 *   files that may use it;
 * - a direct use of `machineStorageKey`, which skips the sidebar sync.
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

const RULES = [
  {
    pattern: RAW_REQUEST,
    allowed: [],
    message:
      "Raw server paths skip the machine prefix. Use buildRequestUrl or hubUrl",
  },
  {
    pattern: /\bpageMachine\(/g,
    allowed: [
      "src/lib/pico/machine.ts",
      "src/routes/index.tsx",
      "src/features/pico/app-shell-utils.ts",
    ],
    message:
      "Code must not read the machine of the page. Use useMachineId() or a machineId argument",
  },
  {
    pattern: /\bmachineStorageKey\(/g,
    allowed: ["src/lib/pico/machine.ts", "src/lib/pico/storage.ts"],
    message:
      "Use machineLocalStorageGetItem or machineLocalStorageSetItem, not machineStorageKey",
  },
]

let failed = false
for (const rule of RULES) {
  const problems = []
  for (const file of files(source)) {
    const path = relative(root, file)
    if (rule.allowed.includes(path)) continue
    const text = readFileSync(file, "utf8")
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split("\n").length
      problems.push(`${path}:${line}: ${match[0]}`)
    }
  }
  if (problems.length === 0) continue
  failed = true
  console.error(`${rule.message}:`)
  for (const problem of problems) console.error(`  ${problem}`)
}
if (failed) process.exit(1)
