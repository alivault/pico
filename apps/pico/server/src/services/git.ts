/**
 * Git for the workspace panel: status, changes, history, diffs, and
 * mutations, through the `git` command. Watched repositories are polled each
 * second and report `git_changed` events when HEAD or the work tree changes.
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import type { EventHub } from "../events.ts"
import { badRequest } from "../http.ts"

const OUTPUT_LIMIT = 16 * 1024 * 1024
const CACHE_TTL_MS = 750
const DEFAULT_COMMITS_LIMIT = 50
const MAX_COMMITS_LIMIT = 500

export type GitOutput = { stdout: string; stderr: string }

const cache = new Map<string, { expiresAt: number; value: unknown }>()

function invalidate() {
  cache.clear()
}

async function cached<T>(
  key: string,
  load: () => Promise<T | undefined>
): Promise<T | undefined> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value as T
  const value = await load()
  if (value !== undefined)
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value })
  return value
}

function run(
  cwd: string,
  args: string[],
  timeoutMs: number,
  allowFailure: boolean
): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: OUTPUT_LIMIT,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        const output = {
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        }
        if (error && !allowFailure) {
          const timedOut = (error as { killed?: boolean }).killed
          reject(
            badRequest(
              timedOut
                ? "git command timed out"
                : output.stderr.trim() || error.message || "git command failed"
            )
          )
          return
        }
        if (error && (error as { code?: unknown }).code === "ENOENT") {
          reject(badRequest("git is not installed"))
          return
        }
        resolve(output)
      }
    )
  })
}

const git = (cwd: string, args: string[], timeoutMs = 10_000) =>
  run(cwd, args, timeoutMs, false)
const gitAllowFailure = (cwd: string, args: string[], timeoutMs = 10_000) =>
  run(cwd, args, timeoutMs, true)

function combine(outputs: GitOutput[]): GitOutput {
  return {
    stdout: outputs
      .map((output) => output.stdout.trim())
      .filter(Boolean)
      .join("\n"),
    stderr: outputs
      .map((output) => output.stderr.trim())
      .filter(Boolean)
      .join("\n"),
  }
}

export function validateRelative(path: string) {
  const normalized = path.trim().replace(/\\/g, "/")
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw badRequest("git path must stay inside the repository")
  }
  return normalized
}

function validateRevision(revision: string) {
  if (
    !revision.trim() ||
    revision.startsWith("-") ||
    ["\0", "\n", "\r"].some((character) => revision.includes(character))
  ) {
    throw badRequest("invalid git revision")
  }
}

function validateRefName(reference: string) {
  validateRevision(reference)
  if (
    /[ ~^:?*[\\]/.test(reference) ||
    reference.includes("..") ||
    reference.endsWith(".")
  ) {
    throw badRequest("invalid git ref name")
  }
}

function actionPaths(
  path: string | undefined,
  previousPath: string | undefined
) {
  const paths = [
    ...new Set(
      [path, previousPath]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(validateRelative)
    ),
  ]
  if (paths.length === 0) throw badRequest("file path is required")
  return paths
}

async function insideWorkTree(cwd: string) {
  const output = await gitAllowFailure(
    cwd,
    ["rev-parse", "--is-inside-work-tree"],
    5000
  )
  return output.stdout.trim() === "true"
}

export async function status(cwd: string) {
  return (
    (await cached(`status:${cwd}`, async () => {
      if (!(await insideWorkTree(cwd))) return undefined
      const porcelain = await git(cwd, ["status", "--porcelain=v1"])
      const changed = porcelain.stdout.split("\n").filter(Boolean).length
      const branch = (
        await gitAllowFailure(
          cwd,
          ["symbolic-ref", "--short", "-q", "HEAD"],
          5000
        )
      ).stdout.trim()
      const revision = (
        await gitAllowFailure(cwd, ["rev-parse", "--short", "HEAD"], 5000)
      ).stdout.trim()
      const detached = !branch
      const label = detached ? revision : branch
      const counts = (
        await gitAllowFailure(
          cwd,
          ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
          5000
        )
      ).stdout
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value))
      const behind = counts[0] ?? 0
      const ahead = counts[1] ?? 0
      const inline = [label]
      if (changed > 0)
        inline.push(`${changed} ${changed === 1 ? "change" : "changes"}`)
      if (ahead > 0) inline.push(`↑${ahead}`)
      if (behind > 0) inline.push(`↓${behind}`)
      const title = [label]
      if (changed > 0)
        title.push(`${changed} changed ${changed === 1 ? "file" : "files"}`)
      if (ahead > 0)
        title.push(`${ahead} ${ahead === 1 ? "commit" : "commits"} ahead`)
      if (behind > 0)
        title.push(`${behind} ${behind === 1 ? "commit" : "commits"} behind`)
      return {
        ...(branch ? { branch } : {}),
        detached,
        ...(revision ? { revision } : {}),
        dirty: changed > 0,
        changedFileCount: changed,
        ahead,
        behind,
        inline: inline.join(" · "),
        label,
        title: title.join(", "),
      }
    })) ?? null
  )
}

async function files(cwd: string) {
  const output = await git(cwd, ["status", "--porcelain=v1", "-z"])
  const records = output.stdout.split("\0").filter(Boolean)
  const result: Array<{ status: string; path: string; previousPath?: string }> =
    []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    if (record.length < 3) continue
    const fileStatus = record.slice(0, 2)
    const path = record.slice(3)
    const renamed = fileStatus.includes("R") || fileStatus.includes("C")
    const previous = renamed ? records[index + 1] : undefined
    result.push({
      status: fileStatus,
      path,
      ...(previous ? { previousPath: previous } : {}),
    })
    if (renamed) index += 1
  }
  return result
}

function parseTrack(value: string, name: string) {
  const match = value.match(new RegExp(`${name} (\\d+)`))
  return match ? Number.parseInt(match[1]!, 10) : 0
}

const nonEmpty = (value: string | undefined) => (value ? value : undefined)

async function branches(cwd: string) {
  const local = await git(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(objectname:short)%1f%(subject)%1f%(committerdate:relative)%1f%(committerdate:iso-strict)",
    "refs/heads",
  ])
  const remote = await git(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)%1f%(objectname:short)%1f%(subject)%1f%(committerdate:relative)%1f%(committerdate:iso-strict)",
    "refs/remotes",
  ])
  const localBranches = local.stdout
    .split("\n")
    .map((line) => line.split("\u001f"))
    .filter((fields) => fields.length >= 8)
    .map((fields) => ({
      name: fields[0]!,
      current: fields[1] === "*",
      upstream: nonEmpty(fields[2]),
      ahead: parseTrack(fields[3]!, "ahead"),
      behind: parseTrack(fields[3]!, "behind"),
      upstreamGone: fields[3]!.includes("gone"),
      hash: nonEmpty(fields[4]),
      subject: nonEmpty(fields[5]),
      relativeDate: nonEmpty(fields[6]),
      committerDate: nonEmpty(fields[7]),
    }))
  const remoteBranches = remote.stdout
    .split("\n")
    .map((line) => line.split("\u001f"))
    .filter((fields) => fields.length >= 5 && !fields[0]!.endsWith("/HEAD"))
    .map((fields) => ({
      name: fields[0]!,
      hash: nonEmpty(fields[1]),
      subject: nonEmpty(fields[2]),
      relativeDate: nonEmpty(fields[3]),
      committerDate: nonEmpty(fields[4]),
    }))
  return { localBranches, remoteBranches }
}

async function commits(cwd: string, limit: number) {
  const output = await gitAllowFailure(
    cwd,
    [
      "log",
      "--pretty=format:%h%x09%H%x1f%P%x1f%an%x1f%ar%x1f%aI%x1f%s",
      "--date-order",
      "-n",
      String(limit + 1),
      "--no-color",
      "HEAD",
    ],
    15_000
  )
  const lines = output.stdout.split("\n").filter(Boolean)
  const hasMore = lines.length > limit
  const unpushed = (
    await gitAllowFailure(cwd, ["rev-list", "@{upstream}..HEAD"])
  ).stdout
    .split("\n")
    .filter(Boolean)
  return { commits: lines.slice(0, limit), hasMore, unpushed }
}

export async function changes(
  cwd: string,
  scope: string,
  commitsLimit: number | undefined
) {
  const empty = {
    files: null,
    localBranches: null,
    remoteBranches: null,
    commits: null,
    commitsHasMore: false,
    commitsLimit: 0,
    unpushedCommitHashes: null,
  }
  if (!(await insideWorkTree(cwd))) return empty
  const limit = Math.min(
    MAX_COMMITS_LIMIT,
    Math.max(1, commitsLimit ?? DEFAULT_COMMITS_LIMIT)
  )
  return (
    (await cached(`changes:${cwd}:${scope}:${limit}`, async () => {
      const wantFiles = scope === "all" || scope === "files"
      const wantBranches = scope === "all" || scope === "branches"
      const wantCommits = scope === "all" || scope === "commits"
      const changedFiles = wantFiles ? await files(cwd) : []
      const branchLists = wantBranches
        ? await branches(cwd)
        : { localBranches: [], remoteBranches: [] }
      const history = wantCommits
        ? await commits(cwd, limit)
        : { commits: [], hasMore: false, unpushed: [] }
      return {
        files: changedFiles,
        localBranches: branchLists.localBranches,
        remoteBranches: branchLists.remoteBranches,
        commits: history.commits,
        commitsHasMore: history.hasMore,
        commitsLimit: wantCommits ? limit : 0,
        unpushedCommitHashes: history.unpushed,
      }
    })) ?? empty
  )
}

export async function fileDiff(cwd: string, path: string) {
  const relative = validateRelative(path)
  let output = await git(cwd, ["diff", "--no-ext-diff", "--", relative])
  if (!output.stdout)
    output = await git(cwd, [
      "diff",
      "--cached",
      "--no-ext-diff",
      "--",
      relative,
    ])
  if (!output.stdout) {
    const fileStatus = await gitAllowFailure(
      cwd,
      ["status", "--porcelain=v1", "--", relative],
      5000
    )
    if (fileStatus.stdout.startsWith("??")) {
      output = await gitAllowFailure(cwd, [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--",
        "/dev/null",
        relative,
      ])
    }
  }
  return output.stdout
}

export async function fileReview(
  cwd: string,
  path: string,
  previousPath: string | undefined
) {
  const relative = validateRelative(path)
  const previous = previousPath ? validateRelative(previousPath) : undefined
  const old = await gitAllowFailure(cwd, [
    "show",
    `HEAD:${previous ?? relative}`,
  ])
  let newContent = ""
  try {
    const bytes = await readFile(join(cwd, relative))
    if (!bytes.includes(0) && bytes.length <= 4 * 1024 * 1024)
      newContent = bytes.toString("utf8")
  } catch {
    // Deleted or unreadable: the new side is empty.
  }
  return {
    path: relative,
    previousPath: previous,
    oldContent: old.stdout,
    newContent,
  }
}

function parseNameStatus(output: string) {
  return output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length >= 2)
    .map((fields) => {
      const renamed = /^[RC]/.test(fields[0]!) && fields.length >= 3
      return {
        status: fields[0]!,
        path: renamed ? fields[2]! : fields[1]!,
        ...(renamed ? { previousPath: fields[1]! } : {}),
      }
    })
}

export async function commitFiles(cwd: string, commit: string) {
  validateRevision(commit)
  const output = await git(cwd, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-M",
    "--root",
    commit,
  ])
  return parseNameStatus(output.stdout)
}

export async function commitDiff(
  cwd: string,
  commit: string,
  mode: string,
  path?: string,
  previousPath?: string
) {
  validateRevision(commit)
  const relative = path ? validateRelative(path) : undefined
  const previous = previousPath ? validateRelative(previousPath) : undefined
  const title =
    mode === "head"
      ? `Changes since ${commit}`
      : mode === "previous"
        ? `Changes in ${commit}`
        : (
            await gitAllowFailure(
              cwd,
              ["show", "-s", "--format=%h %s", commit],
              5000
            )
          ).stdout.trim() || commit
  const args =
    mode === "head"
      ? ["diff", `${commit}..HEAD`, "--no-ext-diff"]
      : mode === "previous"
        ? ["diff", `${commit}^`, commit, "--no-ext-diff"]
        : [
            "show",
            "--format=fuller",
            "--stat",
            "--patch",
            "--no-ext-diff",
            commit,
          ]
  if (relative || previous) {
    args.push("--")
    if (previous) args.push(previous)
    if (relative && relative !== previous) args.push(relative)
  }
  const output = await git(cwd, args, 15_000)
  return { title, patch: output.stdout, path: relative, previousPath: previous }
}

function remoteCommitUrl(remote: string, hash: string) {
  let base: string | undefined
  if (remote.startsWith("git@")) {
    const [host, path] = remote.slice(4).split(/:(.*)/s)
    if (host && path) base = `https://${host}/${path}`
  } else if (remote.startsWith("http://") || remote.startsWith("https://")) {
    base = remote
  } else if (remote.startsWith("ssh://git@")) {
    const rest = remote.slice("ssh://git@".length)
    const slash = rest.indexOf("/")
    if (slash > 0)
      base = `https://${rest.slice(0, slash)}/${rest.slice(slash + 1)}`
  }
  if (!base) return undefined
  return `${base.replace(/\/+$/, "").replace(/\.git$/, "")}/commit/${hash}`
}

export async function commitRemoteUrl(cwd: string, commit: string) {
  validateRevision(commit)
  const hash = (await git(cwd, ["rev-parse", commit], 5000)).stdout.trim()
  const remote = (
    await git(cwd, ["remote", "get-url", "origin"], 5000)
  ).stdout.trim()
  const url = remoteCommitUrl(remote, hash)
  if (!url) throw badRequest("No remote URL found")
  return url
}

export async function stage(
  cwd: string,
  action: string,
  all: boolean,
  path?: string,
  previousPath?: string
) {
  let output: GitOutput
  if (action === "unstage-all")
    output = await git(cwd, ["reset", "--", "."], 15_000)
  else if (action === "unstage")
    output = await git(
      cwd,
      ["reset", "HEAD", "--", ...actionPaths(path, previousPath)],
      15_000
    )
  else if (all || action === "stage-all")
    output = await git(cwd, ["add", "-A"], 15_000)
  else
    output = await git(
      cwd,
      ["add", "--", ...actionPaths(path, previousPath)],
      15_000
    )
  invalidate()
  return output
}

export async function discard(
  cwd: string,
  action: string,
  all: boolean,
  path?: string,
  previousPath?: string,
  fileStatus?: string
) {
  const outputs: GitOutput[] = []
  if (action === "nuke-working-tree") {
    outputs.push(await git(cwd, ["reset", "--hard", "HEAD"], 20_000))
    outputs.push(await git(cwd, ["clean", "-fd"], 20_000))
  } else if (all || action === "discard-all") {
    outputs.push(
      await git(cwd, ["restore", "--staged", "--worktree", "."], 20_000)
    )
    outputs.push(await git(cwd, ["clean", "-fd"], 20_000))
  } else if (fileStatus === "??") {
    outputs.push(
      await git(
        cwd,
        ["clean", "-f", "--", ...actionPaths(path, previousPath)],
        15_000
      )
    )
  } else {
    outputs.push(
      await git(
        cwd,
        [
          "restore",
          "--staged",
          "--worktree",
          "--",
          ...actionPaths(path, previousPath),
        ],
        15_000
      )
    )
  }
  invalidate()
  return combine(outputs)
}

export async function checkout(
  cwd: string,
  branch: string,
  create: boolean,
  startPoint?: string,
  track?: boolean
) {
  validateRefName(branch)
  if (startPoint) validateRevision(startPoint)
  const args = ["switch"]
  if (create) args.push("-c")
  if (track) args.push("--track")
  args.push(branch)
  if (startPoint) args.push(startPoint)
  const output = await git(cwd, args, 20_000)
  invalidate()
  return output
}

export async function push(cwd: string, force: boolean) {
  const before = (
    await gitAllowFailure(cwd, ["log", "--format=%s", "@{upstream}..HEAD"])
  ).stdout
    .split("\n")
    .filter(Boolean)
  const output = await git(
    cwd,
    force ? ["push", "--force-with-lease"] : ["push"],
    120_000
  )
  invalidate()
  return { ...output, pushedCommitMessages: before }
}

export async function pull(cwd: string) {
  const output = await git(cwd, ["pull", "--ff-only"], 120_000)
  invalidate()
  return output
}

export async function commit(
  cwd: string,
  message: string,
  includeUnstaged: boolean,
  shouldPush: boolean,
  forcePush: boolean
) {
  if (!message.trim()) throw badRequest("commit message is required")
  const outputs: GitOutput[] = []
  if (includeUnstaged) outputs.push(await git(cwd, ["add", "-A"], 20_000))
  outputs.push(await git(cwd, ["commit", "-m", message], 60_000))
  let pushed: string[] | undefined
  if (shouldPush) {
    const result = await push(cwd, forcePush)
    pushed = result.pushedCommitMessages
    outputs.push(result)
  }
  invalidate()
  return {
    ...combine(outputs),
    ...(pushed ? { pushedCommitMessages: pushed } : {}),
  }
}

export async function commitAction(
  cwd: string,
  action: string,
  target: string,
  options: { tagName?: string; resetMode?: string; message?: string }
) {
  validateRevision(target)
  let output: GitOutput
  switch (action) {
    case "checkout":
      output = await git(cwd, ["switch", "--detach", target], 30_000)
      break
    case "cherry-pick":
      output = await git(cwd, ["cherry-pick", target], 60_000)
      break
    case "revert":
      output = await git(cwd, ["revert", "--no-edit", target], 60_000)
      break
    case "tag": {
      const tag = options.tagName?.trim()
      if (!tag) throw badRequest("tagName is required")
      validateRefName(tag)
      output = await git(cwd, ["tag", tag, target], 20_000)
      break
    }
    case "reset": {
      const mode =
        options.resetMode === "soft"
          ? "--soft"
          : options.resetMode === "hard"
            ? "--hard"
            : "--mixed"
      output = await git(cwd, ["reset", mode, target], 30_000)
      break
    }
    case "rebase":
      output = await git(cwd, ["rebase", target], 120_000)
      break
    case "drop":
      output = await git(
        cwd,
        ["rebase", "--onto", `${target}^`, target],
        120_000
      )
      break
    case "squash": {
      const message = options.message?.trim()
      if (!message) throw badRequest("message is required")
      const reset = await git(cwd, ["reset", "--soft", `${target}^`], 30_000)
      const committed = await git(cwd, ["commit", "-m", message], 60_000)
      output = combine([reset, committed])
      break
    }
    default:
      throw badRequest("unsupported commit action")
  }
  invalidate()
  return output
}

export async function commitMessageContext(cwd: string) {
  const staged = await gitAllowFailure(
    cwd,
    ["diff", "--cached", "--stat", "--patch", "--no-ext-diff"],
    15_000
  )
  const working = await gitAllowFailure(
    cwd,
    ["diff", "--stat", "--patch", "--no-ext-diff"],
    15_000
  )
  const fileStatus = await gitAllowFailure(cwd, ["status", "--short"])
  return `STATUS:\n${fileStatus.stdout}\n\nSTAGED DIFF:\n${staged.stdout}\n\nWORKING DIFF:\n${working.stdout}`.slice(
    0,
    24_000
  )
}

export async function heuristicCommitMessage(cwd: string) {
  const changed = await files(cwd)
  if (changed.length === 0) throw badRequest("No changes to commit")
  if (changed.length === 1) return `Update ${changed[0]!.path}`
  return `Update ${changed.length} files`
}

/** Polls watched repositories and reports changes. */
export class GitWatcher {
  readonly #hub: EventHub
  readonly #watched = new Map<string, { signature: string; lastUsed: number }>()
  readonly #timer: NodeJS.Timeout
  #polling = false

  constructor(hub: EventHub) {
    this.#hub = hub
    this.#timer = setInterval(() => void this.#poll(), 1000)
    this.#timer.unref()
  }

  watch(cwd: string) {
    const watched = this.#watched.get(cwd)
    if (watched) watched.lastUsed = Date.now()
    else this.#watched.set(cwd, { signature: "", lastUsed: Date.now() })
  }

  async #poll() {
    if (this.#polling) return
    this.#polling = true
    try {
      for (const [cwd, watched] of this.#watched) {
        // Stop polling repositories no client asked about for ten minutes.
        if (Date.now() - watched.lastUsed > 10 * 60_000) {
          this.#watched.delete(cwd)
          continue
        }
        const signature = await signatureOf(cwd).catch(() => "")
        const previous = watched.signature
        watched.signature = signature
        if (!previous || previous === signature) continue
        invalidate()
        const root = (
          await gitAllowFailure(cwd, ["rev-parse", "--show-toplevel"], 5000)
        ).stdout.trim()
        this.#hub.push({
          type: "git_changed",
          cwd,
          ...(root ? { repositoryRoot: root } : {}),
          changedAt: Date.now(),
          scopes: ["status", "files", "refs"],
        })
      }
    } finally {
      this.#polling = false
    }
  }

  /** Report a change Pico made itself, at once. */
  mutated(cwd: string) {
    invalidate()
    this.#hub.push({
      type: "git_changed",
      cwd,
      repositoryRoot: cwd,
      changedAt: Date.now(),
      scopes: ["status", "files", "refs"],
    })
  }

  stop() {
    clearInterval(this.#timer)
  }
}

async function signatureOf(cwd: string) {
  const fileStatus = await gitAllowFailure(
    cwd,
    ["status", "--porcelain=v1", "-uno"],
    5000
  )
  const head = await gitAllowFailure(cwd, ["rev-parse", "HEAD"], 5000)
  return `${head.stdout}\0${fileStatus.stdout}`
}
