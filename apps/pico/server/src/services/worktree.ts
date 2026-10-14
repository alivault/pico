/**
 * Git worktrees for sessions.
 *
 * A session can work in its own worktree, so parallel sessions do not edit
 * the same files. Worktrees go to `<data>/worktrees/<repository>/<slug>`,
 * outside the repository, so tools in one worktree do not see the others.
 */
import { randomBytes } from "node:crypto"
import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"

import { runCommand } from "../extensions/util.ts"

export type Worktree = { repoRoot: string; path: string; branch: string }

async function git(cwd: string, args: string[], timeoutMs = 60_000) {
  const result = await runCommand(["git", ...args], { cwd, timeoutMs })
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() || `git ${args[0]} failed`
    )
  }
  return result.stdout.trim()
}

/** The top directory of the main repository of `cwd`, or undefined outside git. */
export async function repoRoot(cwd: string) {
  try {
    const common = await git(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
    // The common dir of a worktree is the main repository's .git directory.
    if (basename(common) === ".git") return join(common, "..")
    return await git(cwd, ["rev-parse", "--show-toplevel"])
  } catch {
    return undefined
  }
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9._/-]+/g, "-")
      .replace(/^[-./]+|[-./]+$/g, "")
      .slice(0, 48) || "work"
  )
}

async function branchExists(root: string, branch: string) {
  try {
    await git(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ])
    return true
  } catch {
    return false
  }
}

/** Copy top-level files that git ignores but the project needs, such as `.env`. */
async function copyIgnoredFiles(
  root: string,
  target: string,
  patterns: readonly string[]
) {
  if (patterns.length === 0) return []
  const matchers = patterns.map(
    (pattern) =>
      new RegExp(
        `^${pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`
      )
  )
  const copied: string[] = []
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!matchers.some((matcher) => matcher.test(name))) continue
    const info = await stat(join(root, name)).catch(() => undefined)
    if (!info?.isFile()) continue
    const exists = await stat(join(target, name)).catch(() => undefined)
    if (exists) continue
    await copyFile(join(root, name), join(target, name))
    copied.push(name)
  }
  return copied
}

/**
 * Make a worktree for a new session. `cwd` may be a subdirectory of the
 * repository; the returned `cwd` is the same subdirectory in the worktree.
 */
export async function createWorktree(
  cwd: string,
  options: {
    dataDir: string
    branch?: string
    base?: string
    copy?: readonly string[]
    name?: string
  }
): Promise<Worktree & { cwd: string; copied: string[] }> {
  const root = await repoRoot(cwd)
  if (!root) throw new Error(`${cwd} is not in a git repository`)
  const suffix = randomBytes(3).toString("hex")
  const requested = options.branch?.trim()
  const slug = slugify(requested ?? options.name ?? "session")
  const branch = requested || `pico/${slug}-${suffix}`
  const path = join(
    options.dataDir,
    "worktrees",
    slugify(basename(root)),
    `${slug.replace(/\//g, "-")}-${suffix}`
  )
  await mkdir(join(path, ".."), { recursive: true })
  if (await branchExists(root, branch)) {
    await git(root, ["worktree", "add", path, branch], 120_000)
  } else {
    await git(
      root,
      ["worktree", "add", "-b", branch, path, options.base?.trim() || "HEAD"],
      120_000
    )
  }
  const copied = await copyIgnoredFiles(root, path, options.copy ?? [])
  const inside = relative(root, cwd)
  const sessionCwd =
    inside && !inside.startsWith("..") && !inside.startsWith(sep)
      ? join(path, inside)
      : path
  await mkdir(sessionCwd, { recursive: true })
  return { repoRoot: root, path, branch, cwd: sessionCwd, copied }
}

export async function worktreeClean(path: string) {
  try {
    return (await git(path, ["status", "--porcelain"])) === ""
  } catch {
    return false
  }
}

/** Remove a worktree. Without `force`, refuse when it has changes. The branch stays. */
export async function removeWorktree(
  worktree: Worktree,
  options: { force?: boolean } = {}
) {
  if (!options.force && !(await worktreeClean(worktree.path))) {
    throw new Error(
      `The worktree ${worktree.path} has uncommitted changes. Keep it, or remove it with force.`
    )
  }
  await git(
    worktree.repoRoot,
    [
      "worktree",
      "remove",
      ...(options.force ? ["--force"] : []),
      worktree.path,
    ],
    120_000
  )
}
