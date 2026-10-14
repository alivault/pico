#!/usr/bin/env node
// Release Pico: check, bump the version, build, commit, tag, and push.
// The tag push starts .github/workflows/release.yml, which publishes to npm
// and creates the GitHub release.
//
//   pnpm release patch|minor|major|<version> [--no-push]
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const args = process.argv.slice(2)
const push = !args.includes("--no-push")
const bump = args.find((arg) => !arg.startsWith("--"))

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  })
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} failed: ${result.stderr ?? ""}`)
  return result.stdout?.trim()
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(bump ?? "")) return bump
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current)
  if (!match) throw new Error(`Cannot read version ${current}`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  if (bump === "major") return `${major + 1}.0.0`
  console.error("Usage: pnpm release patch|minor|major|<version> [--no-push]")
  process.exit(1)
}

const packagePaths = ["package.json", "server/package.json"]
const current = JSON.parse(readFileSync("package.json", "utf8")).version
const version = nextVersion(current, bump)
const tag = `v${version}`

if (run("git", ["status", "--porcelain"], true))
  throw new Error("Commit or stash changes before a release")
const branch = run("git", ["branch", "--show-current"], true)
if (branch !== "main") throw new Error(`Release from main, not ${branch}`)
run("git", ["fetch", "--tags", "origin", "main"])
if (run("git", ["rev-list", "HEAD..origin/main"], true))
  throw new Error("main is behind origin/main. Pull first.")
if (run("git", ["tag", "--list", tag], true))
  throw new Error(`Tag ${tag} already exists`)

console.log(`Releasing ${current} -> ${version}`)
run("pnpm", ["check"])
for (const path of packagePaths) {
  const pkg = JSON.parse(readFileSync(path, "utf8"))
  pkg.version = version
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
}
run("pnpm", ["install", "--lockfile-only"])
run("pnpm", ["build"])
run("npm", ["pack", "--dry-run", "--ignore-scripts"])

run("git", ["add", ...packagePaths, "../../pnpm-lock.yaml"])
run("git", ["commit", "-m", `release ${tag}`])
run("git", ["tag", tag])
if (!push) {
  console.log(
    `Release ${tag} is committed and tagged. Push with: git push --atomic origin main ${tag}`
  )
  process.exit(0)
}
run("git", ["push", "--atomic", "origin", "main", tag])
console.log(
  `Pushed ${tag}. GitHub Actions publishes to npm and creates the release:\nhttps://github.com/alivault/pico/actions/workflows/release.yml`
)
