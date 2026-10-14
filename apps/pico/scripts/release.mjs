#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

// Prepare a local release. Publishing and pushing require explicit commands.
const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version ?? "")) {
  console.error("Usage: pnpm release <version> (for example 3.0.0-alpha.2)")
  process.exit(1)
}
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  })
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} failed: ${result.stderr ?? ""}`)
  return result.stdout?.trim()
}
if (run("git", ["status", "--porcelain"], true))
  throw new Error("Commit or stash changes before preparing a release")
run("pnpm", ["check"])
for (const path of ["package.json", "server/package.json"]) {
  const pkg = JSON.parse(readFileSync(path, "utf8"))
  pkg.version = version
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
}
run("pnpm", ["install", "--lockfile-only"])
run("pnpm", ["build"])
run("npm", ["pack", "--dry-run", "--ignore-scripts"])
console.log(
  `Release ${version} is prepared. Review and commit the changes before tagging or publishing.`
)
