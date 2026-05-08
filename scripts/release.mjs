#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import fs from "node:fs"

const allowedReleaseTypes = new Set(["patch", "minor", "major"])
const releaseType = process.argv[2]
const releaseBranch = process.env.RELEASE_BRANCH ?? "main"

function usage() {
  console.error(`Usage: pnpm release <patch|minor|major>

Runs local release checks, bumps package.json with pnpm version, creates the git tag, and pushes the branch plus tags. The GitHub release workflow publishes npm from the pushed tag.

Set RELEASE_BRANCH=<branch> to release from a branch other than main.`)
}

if (!releaseType || !allowedReleaseTypes.has(releaseType)) {
  usage()
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture
      ? `\n${result.stderr || result.stdout || ""}`.trimEnd()
      : ""
    throw new Error(
      `Command failed: ${[command, ...args].join(" ")}${detail ? `\n${detail}` : ""}`
    )
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  }
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync("package.json", "utf8"))
}

function ensureCleanWorkingTree() {
  const status = run("git", ["status", "--porcelain"], { capture: true }).stdout
  if (status) {
    throw new Error(
      `Working tree is not clean. Commit or stash changes before releasing.\n${status}`
    )
  }
}

function getNextVersion(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`)
  }

  let major = Number(match[1])
  let minor = Number(match[2])
  let patch = Number(match[3])

  if (type === "major") {
    major += 1
    minor = 0
    patch = 0
  } else if (type === "minor") {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }

  return `${major}.${minor}.${patch}`
}

function ensureOnReleaseBranch() {
  const branch = run("git", ["branch", "--show-current"], {
    capture: true,
  }).stdout

  if (branch !== releaseBranch) {
    throw new Error(
      `Releases must run from ${releaseBranch}. Current branch: ${branch || "detached HEAD"}`
    )
  }

  return branch
}

function ensureBasedOnRemote(branch) {
  run("git", ["fetch", "origin", branch, "--tags"])

  const result = run(
    "git",
    ["merge-base", "--is-ancestor", `origin/${branch}`, "HEAD"],
    {
      allowFailure: true,
      capture: true,
    }
  )

  if (result.status !== 0) {
    throw new Error(
      `Local ${branch} is not based on origin/${branch}. Pull/rebase before releasing.`
    )
  }
}

function ensureTagAvailable(tag) {
  const result = run(
    "git",
    ["rev-parse", "-q", "--verify", `refs/tags/${tag}`],
    {
      allowFailure: true,
      capture: true,
    }
  )

  if (result.status === 0) {
    throw new Error(`Tag already exists: ${tag}`)
  }
}

function ensureNpmVersionAvailable(name, version) {
  const result = run("npm", ["view", `${name}@${version}`, "version"], {
    allowFailure: true,
    capture: true,
  })

  if (result.status === 0) {
    throw new Error(`${name}@${version} is already published on npm.`)
  }
}

try {
  const branch = ensureOnReleaseBranch()
  ensureCleanWorkingTree()
  ensureBasedOnRemote(branch)
  ensureCleanWorkingTree()

  const packageJson = readPackageJson()
  const nextVersion = getNextVersion(packageJson.version, releaseType)
  const nextTag = `v${nextVersion}`

  ensureTagAvailable(nextTag)
  ensureNpmVersionAvailable(packageJson.name, nextVersion)

  console.log(
    `Releasing ${packageJson.name} ${packageJson.version} → ${nextVersion}`
  )
  run("pnpm", ["check"])
  run("pnpm", ["build"])
  ensureCleanWorkingTree()

  run("pnpm", ["version", releaseType, "-m", "release v%s"])
  run("git", ["push", "origin", branch, "--follow-tags"])

  console.log(
    `Released ${nextTag}. GitHub Actions will publish ${packageJson.name}@${nextVersion} to npm.`
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
