import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

import { loadPiAi } from "@/server/pi-sdk"
import type {
  MessageContentPartLike,
  ModelRegistryLike,
} from "@/server/pi-sdk-types"

export type GitStatusSummary = {
  branch?: string
  detached: boolean
  revision?: string
  dirty: boolean
  changedFileCount: number
  ahead: number
  behind: number
  inline: string
  label: string
  title: string
}

export type GitChangeFile = {
  status: string
  path: string
  previousPath?: string
  linesAdded?: number
  linesDeleted?: number
  sizeBytes?: number
}

export type GitLocalBranch = {
  name: string
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  upstreamGone: boolean
  hash?: string
  subject?: string
  relativeDate?: string
  committerDate?: string
}

export type GitRemoteBranch = {
  name: string
  hash?: string
  subject?: string
  relativeDate?: string
  committerDate?: string
}

export type GitBranchSummary = {
  localBranches: Array<GitLocalBranch>
  remoteBranches: Array<GitRemoteBranch>
}

export type GitCommitSummary = {
  commits: Array<string>
  commitsHasMore: boolean
  commitsLimit: number
  unpushedCommitShortHashes: Array<string>
}

export type GitChangesSummary = {
  files: Array<GitChangeFile>
  localBranches: Array<GitLocalBranch>
  remoteBranches: Array<GitRemoteBranch>
  commits: Array<string>
  commitsHasMore: boolean
  commitsLimit: number
  unpushedCommitShortHashes: Array<string>
}

export type GitRepositoryFingerprint = {
  statusKey: string
  filesKey: string
  refsKey: string
}

export type GitRepositoryInfo = {
  cwd: string
  root: string
  gitDir: string
  gitCommonDir: string
}

export type GitActionResult = {
  stdout: string
  stderr: string
  pushedCommitMessages?: Array<string>
}

export type GitCommitMessageResult = {
  message: string
  source: "ai" | "heuristic"
  reason?: string
}

export type GitFileDiffResult = {
  path: string
  patch: string
}

export type GitFileReviewResult = {
  path: string
  previousPath?: string
  oldContent: string
  newContent: string
}

const GIT_STATUS_CACHE_TTL_MS = 5_000
const GIT_CHANGES_CACHE_TTL_MS = 5_000
const GIT_COMMITS_DEFAULT_LIMIT = 50
const GIT_COMMITS_MAX_LIMIT = 500
const GIT_ACTION_TIMEOUT_MS = 120_000
const GIT_PUSH_COMMIT_MESSAGE_LIMIT = 20
const GIT_COMMIT_FIELD_SEPARATOR = "\u001f"
const GIT_COMMIT_MESSAGE_DIFF_MAX_CHARS = 18_000
const GIT_COMMIT_MESSAGE_SYSTEM_PROMPT = `You write concise Git commit messages.

Return only the commit message text.

Rules:
- Use imperative mood.
- First line must be 72 characters or less.
- Prefer one line unless a body is genuinely useful.
- No markdown, bullets, quotes, or code fences.
- Describe the user-visible intent of the changes, not implementation trivia.`

const gitStatusCache = new Map<
  string,
  { value: GitStatusSummary | null; expiresAt: number }
>()
const gitChangesCache = new Map<
  string,
  { value: GitChangesSummary | null; expiresAt: number }
>()
const gitFilesCache = new Map<
  string,
  { value: Array<GitChangeFile> | null; expiresAt: number }
>()
const gitBranchesCache = new Map<
  string,
  { value: GitBranchSummary | null; expiresAt: number }
>()
const gitCommitsCache = new Map<
  string,
  { value: GitCommitSummary | null; expiresAt: number }
>()

function normalizeGitCwd(cwd: string) {
  return typeof cwd === "string" ? cwd.trim() : ""
}

function normalizeGitCommitsLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return GIT_COMMITS_DEFAULT_LIMIT

  return Math.max(1, Math.min(GIT_COMMITS_MAX_LIMIT, Math.floor(limit || 0)))
}

function gitCommitsCacheKey(cwd: string, limit: number) {
  return `${cwd}\u0000${limit}`
}

function invalidateDirectoryGitCommitsCache(cwd: string) {
  const prefix = `${cwd}\u0000`
  for (const key of gitCommitsCache.keys()) {
    if (key === cwd || key.startsWith(prefix)) {
      gitCommitsCache.delete(key)
    }
  }
}

function normalizeGitPath(path: string, cwd: string) {
  const trimmed = typeof path === "string" ? path.trim() : ""
  if (!trimmed) return ""

  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed)
}

export function invalidateDirectoryGitCaches(cwd: string) {
  const normalizedCwd = normalizeGitCwd(cwd)
  if (!normalizedCwd) return

  gitStatusCache.delete(normalizedCwd)
  gitChangesCache.delete(normalizedCwd)
  gitFilesCache.delete(normalizedCwd)
  gitBranchesCache.delete(normalizedCwd)
  invalidateDirectoryGitCommitsCache(normalizedCwd)
}

export function invalidateAllDirectoryGitCaches() {
  gitStatusCache.clear()
  gitChangesCache.clear()
  gitFilesCache.clear()
  gitBranchesCache.clear()
  gitCommitsCache.clear()
}

async function runCommand(
  command: string,
  args: Array<string>,
  { cwd, timeoutMs = 2_000 }: { cwd?: string; timeoutMs?: number } = {}
) {
  return await new Promise<{
    code: number | undefined
    stdout: string
    stderr: string
    error?: unknown
    timedOut?: boolean
  }>((resolveResult) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      resolveResult({ code: undefined, stdout: "", stderr: "", error })
      return
    }

    let stdout = ""
    let stderr = ""
    let finished = false
    let timeoutId: NodeJS.Timeout | undefined

    const finish = (value: {
      code: number | undefined
      stdout: string
      stderr: string
      error?: unknown
      timedOut?: boolean
    }) => {
      if (finished) return
      finished = true
      if (timeoutId) clearTimeout(timeoutId)
      resolveResult(value)
    }

    const childStdout = child.stdout
    const childStderr = child.stderr
    if (!childStdout || !childStderr) {
      finish({ code: undefined, stdout, stderr })
      return
    }

    childStdout.setEncoding("utf8")
    childStderr.setEncoding("utf8")
    childStdout.on("data", (chunk) => {
      stdout += chunk
    })
    childStderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      finish({ code: undefined, stdout, stderr, error })
    })
    child.on("close", (code) => {
      finish({ code: code ?? undefined, stdout, stderr })
    })

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        child.kill("SIGTERM")
        finish({ code: undefined, stdout, stderr, timedOut: true })
      }, timeoutMs)
    }
  })
}

function formatDirectoryGitStatus(value: {
  branch?: string
  detached?: boolean
  revision?: string
  dirty?: boolean
  changedFileCount?: number
  ahead?: number
  behind?: number
}) {
  if (!value) return null

  const dirty = Boolean(value.dirty)
  const changedFileCount =
    Number.isInteger(value.changedFileCount) &&
    (value.changedFileCount ?? 0) > 0
      ? (value.changedFileCount ?? 0)
      : 0
  const ahead =
    Number.isInteger(value.ahead) && (value.ahead ?? 0) > 0
      ? (value.ahead ?? 0)
      : 0
  const behind =
    Number.isInteger(value.behind) && (value.behind ?? 0) > 0
      ? (value.behind ?? 0)
      : 0

  if (value.detached) {
    const revision =
      typeof value.revision === "string" ? value.revision.trim() : ""
    const inline = ["detached", revision || undefined].filter(Boolean).join(" ")
    const label = revision ? `Detached HEAD (${revision})` : "Detached HEAD"
    const titleParts = [label]
    if (dirty) titleParts.push("modified")
    if (ahead > 0) titleParts.push(`ahead ${ahead}`)
    if (behind > 0) titleParts.push(`behind ${behind}`)
    return {
      branch: undefined,
      detached: true,
      revision: revision || undefined,
      dirty,
      changedFileCount,
      ahead,
      behind,
      inline,
      label,
      title: titleParts.join(" · "),
    } satisfies GitStatusSummary
  }

  const branch = typeof value.branch === "string" ? value.branch.trim() : ""
  if (!branch) return null

  const label = `Main branch (${branch})`
  const inlineParts = [branch]
  if (dirty) inlineParts.push("*")
  if (ahead > 0) inlineParts.push(`↑${ahead}`)
  if (behind > 0) inlineParts.push(`↓${behind}`)
  const titleParts = [label]
  if (dirty) titleParts.push("modified")
  if (ahead > 0) titleParts.push(`ahead ${ahead}`)
  if (behind > 0) titleParts.push(`behind ${behind}`)

  return {
    branch,
    detached: false,
    revision:
      typeof value.revision === "string" && value.revision.trim()
        ? value.revision.trim()
        : undefined,
    dirty,
    changedFileCount,
    ahead,
    behind,
    inline: inlineParts.join(" "),
    label,
    title: titleParts.join(" · "),
  } satisfies GitStatusSummary
}

function countGitPorcelainStatusEntries(output: string) {
  return output
    .split(/\r?\n/)
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .length
}

function parseCommandNullList(output: string) {
  return output
    .split("\u0000")
    .filter((entry) => typeof entry === "string" && entry.length > 0)
}

function parseCommandLines(
  output: string,
  { trim = false }: { trim?: boolean } = {}
) {
  return output
    .split(/\r?\n/)
    .map((entry) => (trim ? entry.trim() : entry))
    .filter((entry) => Boolean(trim ? entry : entry.length))
}

function isGitCommitGraphLine(line: string) {
  const tabIndex = line.indexOf("\t")
  if (tabIndex < 0) return false

  const beforeSubject = line.slice(0, tabIndex).trim()
  const tokens = beforeSubject.split(/\s+/).filter(Boolean)
  const hash = tokens[tokens.length - 1] || ""

  return /^[0-9a-f]{4,}$/i.test(hash)
}

function limitGitCommitGraphLines(lines: Array<string>, limit: number) {
  let commitCount = 0
  const limitedLines: Array<string> = []

  for (const line of lines) {
    if (isGitCommitGraphLine(line)) {
      commitCount += 1
      if (commitCount > limit) {
        return { lines: limitedLines, hasMore: true }
      }
    }
    limitedLines.push(line)
  }

  return { lines: limitedLines, hasMore: false }
}

function parseGitCommitShortstatMap(output: string) {
  const statsByHash = new Map<string, string>()
  let currentHash = ""

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^[0-9a-f]{40}$/i.test(line)) {
      currentHash = line
      continue
    }

    if (!currentHash) continue
    if (
      /files? changed/.test(line) ||
      /insertions?\(\+\)/.test(line) ||
      /deletions?\(-\)/.test(line)
    ) {
      statsByHash.set(currentHash, line)
      currentHash = ""
    }
  }

  return statsByHash
}

function enrichGitCommitGraphLinesWithStats(
  lines: Array<string>,
  statsByHash: Map<string, string>
) {
  if (statsByHash.size === 0) return lines

  return lines.map((line) => {
    const tabIndex = line.indexOf("\t")
    if (tabIndex < 0) return line

    const metadata = line.slice(tabIndex + 1)
    const fullHash = metadata.split(GIT_COMMIT_FIELD_SEPARATOR)[0]?.trim()
    const stats = fullHash ? statsByHash.get(fullHash) : undefined
    return stats ? `${line}${GIT_COMMIT_FIELD_SEPARATOR}${stats}` : line
  })
}

function gitCommandErrorMessage(
  fallback: string,
  result: Awaited<ReturnType<typeof runCommand>>
) {
  const details = [result.stderr, result.stdout]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
  if (result.timedOut) return `${fallback}: command timed out`
  if (details) return `${fallback}: ${details}`
  return fallback
}

function cleanupCommitMessageCandidate(raw: unknown) {
  const text = typeof raw === "string" ? raw.trim() : ""
  if (!text) return ""

  const cleaned = text
    .replace(/^```(?:gitcommit|text)?\s*/i, "")
    .replace(/```$/i, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .replace(/^commit message\s*:\s*/i, "")
    .trim()

  const [title = "", ...body] = cleaned.split(/\r?\n/)
  const normalizedTitle = title
    .replace(/^[\s>*`"'#[\]-]+/, "")
    .replace(/[.!?…,:;\-–—\s]+$/g, "")
    .trim()
  if (!normalizedTitle) return ""

  const truncatedTitle =
    normalizedTitle.length <= 72
      ? normalizedTitle
      : normalizedTitle
          .slice(0, 72)
          .replace(/\s+\S*$/, "")
          .trim() || normalizedTitle.slice(0, 72).trim()
  const normalizedBody = body
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return normalizedBody
    ? `${truncatedTitle}\n\n${normalizedBody}`
    : truncatedTitle
}

function commitMessageLabelFromPath(path: string) {
  const name = path.split("/").filter(Boolean).pop() || path
  return name
    .replace(/\.[^.]+$/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim()
}

function deriveHeuristicCommitMessage(files: Array<GitChangeFile>) {
  if (!files.length) return "Update files"

  const addedCount = files.filter((file) => file.status.includes("A")).length
  const deletedCount = files.filter((file) => file.status.includes("D")).length
  const modifiedCount = files.length - addedCount - deletedCount
  const primary = files[0]
  const label = primary ? commitMessageLabelFromPath(primary.path) : "files"

  if (files.length === 1) {
    if (addedCount === 1) return `Add ${label}`
    if (deletedCount === 1) return `Remove ${label}`
    return `Update ${label}`
  }

  if (addedCount > modifiedCount && addedCount >= deletedCount) {
    return `Add ${files.length} files`
  }
  if (deletedCount > modifiedCount && deletedCount >= addedCount) {
    return `Remove ${files.length} files`
  }

  const commonDirectory = files
    .map((file) => file.path.split("/").slice(0, -1).join("/"))
    .filter(Boolean)
    .reduce<string | undefined>((common, directory) => {
      if (common === undefined) return directory
      return common === directory ? common : ""
    }, undefined)

  if (commonDirectory) {
    return `Update ${commitMessageLabelFromPath(commonDirectory)}`
  }

  return `Update ${files.length} files`
}

function parseGitStatusEntries(output: string) {
  const entries = parseCommandNullList(output)
  const files: Array<GitChangeFile> = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (typeof entry !== "string" || entry.length < 3) continue

    const status = entry.slice(0, 2)
    const filePath = entry.slice(3)
    let previousPath: string | undefined

    if (
      (status.startsWith("R") || status.startsWith("C")) &&
      typeof entries[index + 1] === "string"
    ) {
      previousPath = entries[index + 1]
      index += 1
    }

    files.push({
      status,
      path: filePath,
      previousPath,
    })
  }

  return files
}

function parseGitNumstatEntries(output: string) {
  const entries = parseCommandNullList(output)
  const diffs = new Map<
    string,
    {
      previousPath?: string
      linesAdded?: number
      linesDeleted?: number
    }
  >()

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (typeof entry !== "string" || !entry.includes("\t")) continue

    const [addedRaw = "", deletedRaw = "", ...pathParts] = entry.split("\t")
    let filePath = pathParts.join("\t")
    let previousPath: string | undefined

    if (!filePath) {
      previousPath =
        typeof entries[index + 1] === "string" ? entries[index + 1] : undefined
      filePath =
        typeof entries[index + 2] === "string" ? entries[index + 2] : ""
      if (filePath) {
        index += 2
      }
    }

    if (!filePath) continue

    const parsedAdded = Number.parseInt(addedRaw, 10)
    const parsedDeleted = Number.parseInt(deletedRaw, 10)
    diffs.set(filePath, {
      previousPath,
      linesAdded: Number.isFinite(parsedAdded) ? parsedAdded : undefined,
      linesDeleted: Number.isFinite(parsedDeleted) ? parsedDeleted : undefined,
    })
  }

  return diffs
}

function parseGitRefRows(output: string) {
  return parseCommandLines(output)
    .map((line) => line.split("\u0000"))
    .filter((fields) =>
      fields.some((field) => typeof field === "string" && field.length > 0)
    )
}

function parseGitBranchTrack(track: string, upstream: string) {
  const trackValue = typeof track === "string" ? track.trim() : ""
  const hasUpstream = typeof upstream === "string" && upstream.trim().length > 0

  if (!hasUpstream) {
    return {
      ahead: 0,
      behind: 0,
      upstreamGone: false,
    }
  }

  if (trackValue === "[gone]") {
    return {
      ahead: 0,
      behind: 0,
      upstreamGone: true,
    }
  }

  const aheadMatch = trackValue.match(/ahead\s+(\d+)/i)
  const behindMatch = trackValue.match(/behind\s+(\d+)/i)

  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1], 10) || 0 : 0,
    upstreamGone: false,
  }
}

function parseGitLocalBranches(output: string) {
  const branches: Array<GitLocalBranch> = []

  for (const fields of parseGitRefRows(output)) {
    const [
      headMarker = "",
      name = "",
      upstream = "",
      track = "",
      hash = "",
      subject = "",
      relativeDate = "",
      committerDate = "",
    ] = fields
    const branchName = typeof name === "string" ? name.trim() : ""
    if (!branchName) continue

    const trackInfo = parseGitBranchTrack(track, upstream)
    branches.push({
      name: branchName,
      current: headMarker.trim() === "*",
      upstream:
        typeof upstream === "string" && upstream.trim()
          ? upstream.trim()
          : undefined,
      ahead: trackInfo.ahead,
      behind: trackInfo.behind,
      upstreamGone: trackInfo.upstreamGone,
      hash: typeof hash === "string" && hash.trim() ? hash.trim() : undefined,
      subject:
        typeof subject === "string" && subject.trim()
          ? subject.trim()
          : undefined,
      relativeDate:
        typeof relativeDate === "string" && relativeDate.trim()
          ? relativeDate.trim()
          : undefined,
      committerDate:
        typeof committerDate === "string" && committerDate.trim()
          ? committerDate.trim()
          : undefined,
    })
  }

  branches.sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })

  return branches
}

function assertGitFilePath(path: string) {
  const normalizedPath = typeof path === "string" ? path.trim() : ""
  if (!normalizedPath) throw new Error("file path is required")
  if (isAbsolute(normalizedPath)) throw new Error("file path must be relative")
  if (normalizedPath.split(/[\\/]+/).some((part) => part === "..")) {
    throw new Error("file path must stay inside the repository")
  }
  return normalizedPath.replaceAll("\\", "/")
}

function parseGitRemoteBranches(output: string) {
  const branches: Array<GitRemoteBranch> = []

  for (const fields of parseGitRefRows(output)) {
    const [
      name = "",
      hash = "",
      subject = "",
      relativeDate = "",
      committerDate = "",
    ] = fields
    const branchName = typeof name === "string" ? name.trim() : ""
    if (
      !branchName ||
      !branchName.includes("/") ||
      /\/HEAD$/i.test(branchName)
    ) {
      continue
    }

    branches.push({
      name: branchName,
      hash: typeof hash === "string" && hash.trim() ? hash.trim() : undefined,
      subject:
        typeof subject === "string" && subject.trim()
          ? subject.trim()
          : undefined,
      relativeDate:
        typeof relativeDate === "string" && relativeDate.trim()
          ? relativeDate.trim()
          : undefined,
      committerDate:
        typeof committerDate === "string" && committerDate.trim()
          ? committerDate.trim()
          : undefined,
    })
  }

  return branches
}

async function isInsideWorkTree(cwd: string) {
  const insideWorkTree = await runCommand(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    {
      cwd,
      timeoutMs: 1_500,
    }
  )

  return insideWorkTree.code === 0 && insideWorkTree.stdout.trim() === "true"
}

export async function resolveDirectoryGitRepository(
  cwd: string
): Promise<GitRepositoryInfo | null> {
  const normalizedCwd = normalizeGitCwd(cwd)
  if (!normalizedCwd) return null

  if (!(await isInsideWorkTree(normalizedCwd))) {
    return null
  }

  const [rootResult, gitDirResult, gitCommonDirResult] = await Promise.all([
    runCommand("git", ["rev-parse", "--show-toplevel"], {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }),
    runCommand("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }),
    runCommand(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
  ])

  const root = normalizeGitPath(rootResult.stdout, normalizedCwd)
  const gitDir = normalizeGitPath(gitDirResult.stdout, normalizedCwd)
  const gitCommonDir = normalizeGitPath(
    gitCommonDirResult.code === 0 ? gitCommonDirResult.stdout : gitDir,
    normalizedCwd
  )

  if (rootResult.code !== 0 || gitDirResult.code !== 0 || !root || !gitDir) {
    return null
  }

  return {
    cwd: normalizedCwd,
    root,
    gitDir,
    gitCommonDir: gitCommonDir || gitDir,
  }
}

export async function readDirectoryGitStatus(
  cwd: string,
  { force = false }: { force?: boolean } = {}
) {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  if (!normalizedCwd) return null

  if (force) {
    gitStatusCache.delete(normalizedCwd)
  }

  const cached = gitStatusCache.get(normalizedCwd)
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  if (!(await isInsideWorkTree(normalizedCwd))) {
    gitStatusCache.set(normalizedCwd, {
      value: null,
      expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
    })
    return null
  }

  const [branchResult, revisionResult, dirtyResult, upstreamResult] =
    await Promise.all([
      runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }),
      runCommand("git", ["rev-parse", "--short", "HEAD"], {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }),
      runCommand("git", ["status", "--porcelain"], {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }),
      runCommand(
        "git",
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }
      ),
    ])

  const upstreamCounts = upstreamResult.stdout.trim().split(/\s+/)
  const ahead =
    upstreamResult.code === 0
      ? Number.parseInt(upstreamCounts[0] || "0", 10) || 0
      : 0
  const behind =
    upstreamResult.code === 0
      ? Number.parseInt(upstreamCounts[1] || "0", 10) || 0
      : 0

  const dirtyOutput = dirtyResult.code === 0 ? dirtyResult.stdout : ""
  const value = formatDirectoryGitStatus({
    branch: branchResult.code === 0 ? branchResult.stdout : "",
    detached: branchResult.code !== 0,
    revision: revisionResult.code === 0 ? revisionResult.stdout : "",
    dirty: Boolean(dirtyOutput.trim()),
    changedFileCount: countGitPorcelainStatusEntries(dirtyOutput),
    ahead,
    behind,
  })

  gitStatusCache.set(normalizedCwd, {
    value,
    expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
  })

  return value
}

export async function readDirectoryGitFiles(
  cwd: string,
  { force = false }: { force?: boolean } = {}
) {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  if (!normalizedCwd) return null

  if (force) {
    gitFilesCache.delete(normalizedCwd)
  }

  const cached = gitFilesCache.get(normalizedCwd)
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  if (!(await isInsideWorkTree(normalizedCwd))) {
    gitFilesCache.set(normalizedCwd, {
      value: null,
      expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
    })
    return null
  }

  const [statusResult, numstatResult] = await Promise.all([
    runCommand(
      "git",
      [
        "status",
        "--porcelain",
        "-z",
        "--find-renames=50%",
        "--untracked-files=all",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
    runCommand("git", ["diff", "--numstat", "-z", "HEAD"], {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }),
  ])

  const numstatByPath =
    numstatResult.code === 0
      ? parseGitNumstatEntries(numstatResult.stdout)
      : new Map()
  const value =
    statusResult.code === 0
      ? await Promise.all(
          parseGitStatusEntries(statusResult.stdout).map(async (file) => {
            const diff = numstatByPath.get(file.path)
            const sizeBytes = await readGitFileSizeBytes(normalizedCwd, file)
            return {
              ...file,
              ...(diff
                ? {
                    linesAdded: diff.linesAdded,
                    linesDeleted: diff.linesDeleted,
                  }
                : null),
              ...(typeof sizeBytes === "number" ? { sizeBytes } : null),
            }
          })
        )
      : []

  gitFilesCache.set(normalizedCwd, {
    value,
    expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
  })

  return value
}

async function readGitFileSizeBytes(cwd: string, file: GitChangeFile) {
  try {
    const fileStats = await stat(resolve(cwd, file.path))
    if (fileStats.isFile()) return fileStats.size
  } catch {
    // Fall back to HEAD for deleted files or paths that no longer exist.
  }

  const headPath = file.previousPath || file.path
  const result = await runCommand(
    "git",
    ["cat-file", "-s", `HEAD:${headPath}`],
    {
      cwd,
      timeoutMs: 1_500,
    }
  )
  if (result.code !== 0) return undefined

  const size = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(size) ? size : undefined
}

async function readGitHeadFileContent(cwd: string, path: string) {
  const result = await runCommand("git", ["show", `HEAD:${path}`], {
    cwd,
    timeoutMs: 10_000,
  })

  if (result.code === 0) return result.stdout
  return ""
}

async function readWorktreeFileContent(cwd: string, path: string) {
  try {
    const content = await readFile(resolve(cwd, path), "utf8")
    if (content.includes("\u0000")) {
      throw new Error("Binary files cannot be reviewed")
    }
    return content
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return ""
    throw error
  }
}

export async function readDirectoryGitFileReview(
  cwd: string,
  path: string,
  previousPath?: string
): Promise<GitFileReviewResult | null> {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  const normalizedPath = assertGitFilePath(path)
  const normalizedPreviousPath = previousPath
    ? assertGitFilePath(previousPath)
    : undefined
  if (!normalizedCwd) return null

  if (!(await isInsideWorkTree(normalizedCwd))) {
    return null
  }

  const oldContent = await readGitHeadFileContent(
    normalizedCwd,
    normalizedPreviousPath || normalizedPath
  )
  const newContent = await readWorktreeFileContent(
    normalizedCwd,
    normalizedPath
  )

  return {
    path: normalizedPath,
    previousPath: normalizedPreviousPath,
    oldContent,
    newContent,
  }
}

export async function readDirectoryGitFileDiff(
  cwd: string,
  path: string
): Promise<GitFileDiffResult | null> {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  const normalizedPath = assertGitFilePath(path)
  if (!normalizedCwd) return null

  if (!(await isInsideWorkTree(normalizedCwd))) {
    return null
  }

  const trackedDiff = await runCommand(
    "git",
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames=50%",
      "HEAD",
      "--",
      normalizedPath,
    ],
    {
      cwd: normalizedCwd,
      timeoutMs: 10_000,
    }
  )

  if (trackedDiff.code === 0 && trackedDiff.stdout.trim()) {
    return { path: normalizedPath, patch: trackedDiff.stdout }
  }
  if (trackedDiff.code !== 0) {
    throw new Error(
      gitCommandErrorMessage("Failed to read file diff", trackedDiff)
    )
  }

  const statusResult = await runCommand(
    "git",
    [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--",
      normalizedPath,
    ],
    {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }
  )
  const statusEntries =
    statusResult.code === 0 ? parseGitStatusEntries(statusResult.stdout) : []
  const isUntracked = statusEntries.some(
    (entry) => entry.path === normalizedPath && entry.status.includes("?")
  )
  if (!isUntracked) return { path: normalizedPath, patch: "" }

  const untrackedDiff = await runCommand(
    "git",
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-index",
      "--",
      "/dev/null",
      normalizedPath,
    ],
    {
      cwd: normalizedCwd,
      timeoutMs: 10_000,
    }
  )

  if (untrackedDiff.code === 0 || untrackedDiff.code === 1) {
    return { path: normalizedPath, patch: untrackedDiff.stdout }
  }

  throw new Error(
    gitCommandErrorMessage("Failed to read untracked file diff", untrackedDiff)
  )
}

export async function readDirectoryGitBranches(
  cwd: string,
  { force = false }: { force?: boolean } = {}
) {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  if (!normalizedCwd) return null

  if (force) {
    gitBranchesCache.delete(normalizedCwd)
  }

  const cached = gitBranchesCache.get(normalizedCwd)
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  if (!(await isInsideWorkTree(normalizedCwd))) {
    gitBranchesCache.set(normalizedCwd, {
      value: null,
      expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
    })
    return null
  }

  const [localBranchesResult, remoteBranchesResult] = await Promise.all([
    runCommand(
      "git",
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(objectname:short)%00%(subject)%00%(committerdate:relative)%00%(committerdate:iso-strict)",
        "refs/heads",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
    runCommand(
      "git",
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)%00%(objectname:short)%00%(subject)%00%(committerdate:relative)%00%(committerdate:iso-strict)",
        "refs/remotes",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
  ])

  const value = {
    localBranches:
      localBranchesResult.code === 0
        ? parseGitLocalBranches(localBranchesResult.stdout)
        : [],
    remoteBranches:
      remoteBranchesResult.code === 0
        ? parseGitRemoteBranches(remoteBranchesResult.stdout)
        : [],
  } satisfies GitBranchSummary

  gitBranchesCache.set(normalizedCwd, {
    value,
    expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
  })

  return value
}

export async function readDirectoryGitCommits(
  cwd: string,
  { force = false, limit }: { force?: boolean; limit?: number } = {}
) {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  if (!normalizedCwd) return null

  const normalizedLimit = normalizeGitCommitsLimit(limit)
  const cacheKey = gitCommitsCacheKey(normalizedCwd, normalizedLimit)

  if (force) {
    invalidateDirectoryGitCommitsCache(normalizedCwd)
  }

  const cached = gitCommitsCache.get(cacheKey)
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  if (!(await isInsideWorkTree(normalizedCwd))) {
    gitCommitsCache.set(cacheKey, {
      value: null,
      expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
    })
    return null
  }

  const [commitsResult, statsResult, unpushedResult] = await Promise.all([
    runCommand(
      "git",
      [
        "log",
        "--pretty=format:%h%x09%H%x1f%P%x1f%an%x1f%ar%x1f%s",
        "--topo-order",
        "-n",
        String(normalizedLimit + 1),
        "--no-color",
        "HEAD",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
    runCommand(
      "git",
      [
        "log",
        "--pretty=format:%H",
        "--shortstat",
        "--topo-order",
        "-n",
        String(normalizedLimit + 1),
        "--no-color",
        "HEAD",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
    runCommand(
      "git",
      ["rev-list", "--abbrev-commit", "--abbrev=7", "@{upstream}..HEAD"],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
  ])

  const statsByHash =
    statsResult.code === 0
      ? parseGitCommitShortstatMap(statsResult.stdout)
      : new Map<string, string>()
  const commitLines =
    commitsResult.code === 0
      ? enrichGitCommitGraphLinesWithStats(
          parseCommandLines(commitsResult.stdout),
          statsByHash
        )
      : []
  const limitedCommitLines = limitGitCommitGraphLines(
    commitLines,
    normalizedLimit
  )
  const value = {
    commits: limitedCommitLines.lines,
    commitsHasMore: limitedCommitLines.hasMore,
    commitsLimit: normalizedLimit,
    unpushedCommitShortHashes:
      unpushedResult.code === 0
        ? parseCommandLines(unpushedResult.stdout, { trim: true })
        : [],
  } satisfies GitCommitSummary

  gitCommitsCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
  })

  return value
}

export async function readDirectoryGitChanges(
  cwd: string,
  { force = false }: { force?: boolean } = {}
) {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  if (!normalizedCwd) return null

  if (force) {
    gitChangesCache.delete(normalizedCwd)
  }

  const cached = gitChangesCache.get(normalizedCwd)
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const [files, branches, commits] = await Promise.all([
    readDirectoryGitFiles(normalizedCwd, { force }),
    readDirectoryGitBranches(normalizedCwd, { force }),
    readDirectoryGitCommits(normalizedCwd, { force }),
  ])

  const value =
    files === null || branches === null || commits === null
      ? null
      : {
          files,
          localBranches: branches.localBranches,
          remoteBranches: branches.remoteBranches,
          commits: commits.commits,
          commitsHasMore: commits.commitsHasMore,
          commitsLimit: commits.commitsLimit,
          unpushedCommitShortHashes: commits.unpushedCommitShortHashes,
        }

  gitChangesCache.set(normalizedCwd, {
    value,
    expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
  })

  return value
}

export async function commitDirectoryGitChanges(
  cwd: string,
  message: string,
  {
    push = false,
    forcePush = false,
    includeUnstaged = true,
  }: {
    push?: boolean
    forcePush?: boolean
    includeUnstaged?: boolean
  } = {}
): Promise<GitActionResult> {
  const normalizedCwd = normalizeGitCwd(cwd)
  const normalizedMessage = cleanupCommitMessageCandidate(message)
  if (!normalizedCwd) throw new Error("cwd is required")
  if (!normalizedMessage) throw new Error("commit message is required")
  if (!(await isInsideWorkTree(normalizedCwd))) {
    throw new Error("No git repository detected")
  }

  const statusResult = await runCommand("git", ["status", "--porcelain"], {
    cwd: normalizedCwd,
    timeoutMs: 5_000,
  })
  if (statusResult.code !== 0) {
    throw new Error(
      gitCommandErrorMessage("Failed to read git status", statusResult)
    )
  }
  if (!statusResult.stdout.trim()) {
    throw new Error("Working tree is clean")
  }

  if (includeUnstaged) {
    const addResult = await runCommand("git", ["add", "-A"], {
      cwd: normalizedCwd,
      timeoutMs: GIT_ACTION_TIMEOUT_MS,
    })
    if (addResult.code !== 0) {
      throw new Error(
        gitCommandErrorMessage("Failed to stage changes", addResult)
      )
    }
  }

  const stagedResult = await runCommand(
    "git",
    ["diff", "--cached", "--quiet"],
    {
      cwd: normalizedCwd,
      timeoutMs: 5_000,
    }
  )
  if (stagedResult.code === 0) {
    throw new Error("No staged changes to commit")
  }

  const commitResult = await runCommand(
    "git",
    ["commit", "-m", normalizedMessage],
    {
      cwd: normalizedCwd,
      timeoutMs: GIT_ACTION_TIMEOUT_MS,
    }
  )
  if (commitResult.code !== 0) {
    throw new Error(
      gitCommandErrorMessage("Failed to commit changes", commitResult)
    )
  }

  let stdout = commitResult.stdout
  let stderr = commitResult.stderr
  let pushedCommitMessages: Array<string> | undefined
  if (push) {
    const pushResult = await pushDirectoryGitChanges(normalizedCwd, {
      force: forcePush,
    })
    stdout = [stdout, pushResult.stdout].filter(Boolean).join("\n")
    stderr = [stderr, pushResult.stderr].filter(Boolean).join("\n")
    pushedCommitMessages = pushResult.pushedCommitMessages
  }

  invalidateDirectoryGitCaches(normalizedCwd)
  return {
    stdout,
    stderr,
    ...(pushedCommitMessages ? { pushedCommitMessages } : {}),
  }
}

async function readUnpushedCommitMessages(cwd: string) {
  const result = await runCommand(
    "git",
    [
      "log",
      "--format=%s",
      "--no-color",
      "--max-count",
      String(GIT_PUSH_COMMIT_MESSAGE_LIMIT),
      "@{upstream}..HEAD",
    ],
    {
      cwd,
      timeoutMs: 1_500,
    }
  )

  return result.code === 0
    ? parseCommandLines(result.stdout, { trim: true }).filter(Boolean)
    : []
}

export async function pushDirectoryGitChanges(
  cwd: string,
  { force = false }: { force?: boolean } = {}
): Promise<GitActionResult> {
  const normalizedCwd = normalizeGitCwd(cwd)
  if (!normalizedCwd) throw new Error("cwd is required")
  if (!(await isInsideWorkTree(normalizedCwd))) {
    throw new Error("No git repository detected")
  }

  const pushedCommitMessages = await readUnpushedCommitMessages(normalizedCwd)
  const result = await runCommand(
    "git",
    force ? ["push", "--force-with-lease"] : ["push"],
    {
      cwd: normalizedCwd,
      timeoutMs: GIT_ACTION_TIMEOUT_MS,
    }
  )
  if (result.code !== 0) {
    throw new Error(
      gitCommandErrorMessage(
        force ? "Failed to force push changes" : "Failed to push changes",
        result
      )
    )
  }

  invalidateDirectoryGitCaches(normalizedCwd)
  return { stdout: result.stdout, stderr: result.stderr, pushedCommitMessages }
}

export async function pullDirectoryGitChanges(
  cwd: string
): Promise<GitActionResult> {
  const normalizedCwd = normalizeGitCwd(cwd)
  if (!normalizedCwd) throw new Error("cwd is required")
  if (!(await isInsideWorkTree(normalizedCwd))) {
    throw new Error("No git repository detected")
  }

  const result = await runCommand("git", ["pull", "--ff-only"], {
    cwd: normalizedCwd,
    timeoutMs: GIT_ACTION_TIMEOUT_MS,
  })
  if (result.code !== 0) {
    throw new Error(gitCommandErrorMessage("Failed to pull changes", result))
  }

  invalidateDirectoryGitCaches(normalizedCwd)
  return { stdout: result.stdout, stderr: result.stderr }
}

export async function checkoutDirectoryGitBranch(
  cwd: string,
  branch: string,
  options: {
    create?: boolean
    startPoint?: string
    track?: boolean
  } = {}
): Promise<GitActionResult> {
  const normalizedCwd = normalizeGitCwd(cwd)
  const normalizedBranch = typeof branch === "string" ? branch.trim() : ""
  const normalizedStartPoint =
    typeof options.startPoint === "string" ? options.startPoint.trim() : ""
  if (!normalizedCwd) throw new Error("cwd is required")
  if (!normalizedBranch) throw new Error("branch is required")
  if (normalizedBranch.startsWith("-")) throw new Error("Invalid branch name")
  if (normalizedStartPoint.startsWith("-")) {
    throw new Error("Invalid start point")
  }
  if (!(await isInsideWorkTree(normalizedCwd))) {
    throw new Error("No git repository detected")
  }

  const args = options.create
    ? [
        "switch",
        "-c",
        normalizedBranch,
        ...(options.track ? ["--track"] : []),
        ...(normalizedStartPoint ? [normalizedStartPoint] : []),
      ]
    : ["switch", normalizedBranch]
  const result = await runCommand("git", args, {
    cwd: normalizedCwd,
    timeoutMs: GIT_ACTION_TIMEOUT_MS,
  })
  if (result.code !== 0) {
    throw new Error(
      gitCommandErrorMessage(
        options.create ? "Failed to create branch" : "Failed to switch branch",
        result
      )
    )
  }

  invalidateDirectoryGitCaches(normalizedCwd)
  return { stdout: result.stdout, stderr: result.stderr }
}

export async function generateDirectoryGitCommitMessage(
  cwd: string,
  modelRegistry: ModelRegistryLike
): Promise<GitCommitMessageResult> {
  const normalizedCwd = normalizeGitCwd(cwd)
  if (!normalizedCwd) throw new Error("cwd is required")
  if (!(await isInsideWorkTree(normalizedCwd))) {
    throw new Error("No git repository detected")
  }

  const files =
    (await readDirectoryGitFiles(normalizedCwd, { force: true })) ?? []
  const heuristic = deriveHeuristicCommitMessage(files)
  if (!files.length) return { message: heuristic, source: "heuristic" }

  const model = modelRegistry.find("openai-codex", "gpt-5.5")
  if (!model) {
    return {
      message: heuristic,
      source: "heuristic",
      reason: "model openai-codex/gpt-5.5 is unavailable",
    }
  }

  const auth = await modelRegistry.getApiKeyAndHeaders(model)
  if (!auth?.ok) {
    return {
      message: heuristic,
      source: "heuristic",
      reason: auth?.error || "failed to authenticate openai-codex/gpt-5.5",
    }
  }

  const [statusResult, statResult, diffResult] = await Promise.all([
    runCommand("git", ["status", "--short"], {
      cwd: normalizedCwd,
      timeoutMs: 5_000,
    }),
    runCommand("git", ["diff", "--stat", "HEAD"], {
      cwd: normalizedCwd,
      timeoutMs: 10_000,
    }),
    runCommand("git", ["diff", "--no-color", "HEAD"], {
      cwd: normalizedCwd,
      timeoutMs: 10_000,
    }),
  ])

  const diff = diffResult.stdout.slice(0, GIT_COMMIT_MESSAGE_DIFF_MAX_CHARS)
  const userPrompt = [
    "Generate a Git commit message for these repository changes.",
    "",
    "Changed files:",
    files.map((file) => `${file.status} ${file.path}`).join("\n"),
    "",
    "Git status:",
    statusResult.stdout.trim(),
    "",
    "Diff stat:",
    statResult.stdout.trim(),
    "",
    "Diff:",
    diff,
    diffResult.stdout.length > diff.length ? "\n[diff truncated]" : "",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const piAi = await loadPiAi()
    const response = await piAi.complete(
      model,
      {
        systemPrompt: GIT_COMMIT_MESSAGE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: userPrompt }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        reasoningEffort: "low",
      }
    )

    const raw = Array.isArray(response?.content)
      ? response.content
          .filter(
            (block): block is MessageContentPartLike & { text: string } =>
              block?.type === "text" && typeof block.text === "string"
          )
          .map((block) => block.text)
          .join("\n")
      : ""
    const message = cleanupCommitMessageCandidate(raw)
    if (message) return { message, source: "ai" }

    return {
      message: heuristic,
      source: "heuristic",
      reason: "model returned no usable commit message",
    }
  } catch (error) {
    return {
      message: heuristic,
      source: "heuristic",
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function readDirectoryGitFingerprint(cwd: string) {
  const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
  if (!normalizedCwd) return null

  if (!(await isInsideWorkTree(normalizedCwd))) {
    return null
  }

  const [
    branchResult,
    revisionResult,
    upstreamResult,
    statusResult,
    numstatResult,
    refsResult,
  ] = await Promise.all([
    runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }),
    runCommand("git", ["rev-parse", "--short", "HEAD"], {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }),
    runCommand(
      "git",
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
    runCommand(
      "git",
      [
        "status",
        "--porcelain",
        "-z",
        "--find-renames=50%",
        "--untracked-files=all",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
    runCommand("git", ["diff", "--numstat", "-z", "HEAD"], {
      cwd: normalizedCwd,
      timeoutMs: 1_500,
    }),
    runCommand(
      "git",
      [
        "for-each-ref",
        "--sort=refname",
        "--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)",
        "refs/heads",
        "refs/remotes",
      ],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    ),
  ])

  return {
    statusKey: [
      branchResult.code,
      branchResult.stdout,
      revisionResult.code,
      revisionResult.stdout,
      upstreamResult.code,
      upstreamResult.stdout,
      statusResult.code,
      statusResult.stdout,
    ].join("\u0000"),
    filesKey: [
      statusResult.code,
      statusResult.stdout,
      numstatResult.code,
      numstatResult.stdout,
    ].join("\u0000"),
    refsKey: [refsResult.code, refsResult.stdout].join("\u0000"),
  } satisfies GitRepositoryFingerprint
}
