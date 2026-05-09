import type { QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { getErrorMessage } from "@/features/pico/right-sidebar-shared"
import type { GitStatusValue } from "@/features/pico/right-sidebar-types"
import type {
  GitChangeFile,
  GitChangesResponse,
  GitCommitMessageResponse,
  GitFileDiffResponse,
  GitFileReviewResponse,
  GitLocalBranch,
  GitStatusResponse,
} from "@/lib/pico/api"

export type GitStatusData = Extract<GitStatusResponse, { ok: true }>
export type GitChangesData = Extract<GitChangesResponse, { ok: true }>
export type GitCommitMessageData = Extract<
  GitCommitMessageResponse,
  { ok: true }
>
export type GitFileDiffData = Extract<GitFileDiffResponse, { ok: true }>
export type GitFileReviewData = Extract<GitFileReviewResponse, { ok: true }>
export const GIT_QUERY_STALE_TIME_MS = 1000 * 30
export const GIT_QUERY_GC_TIME_MS = 1000 * 60 * 10
export const GIT_COMMITS_PAGE_SIZE = 50
export const GIT_REVIEW_FULL_CONTEXT_SIZE_THRESHOLD_BYTES = 10_000
export const GIT_REVIEW_FULL_CONTEXT_CHANGED_LINE_THRESHOLD = 100

export function gitStatusQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitStatusData>(
        buildRequestUrl(`/api/git-status?cwd=${encodeURIComponent(cwd)}`, {
          contextId: viewerContextId,
        })
      ),
    staleTime: GIT_QUERY_STALE_TIME_MS,
    gcTime: GIT_QUERY_GC_TIME_MS,
  }
}

export function gitChangesQueryOptions({
  viewerContextId,
  cwd,
  scope,
  commitsLimit,
}: {
  viewerContextId: string
  cwd: string
  scope: "files" | "branches" | "commits"
  commitsLimit?: number
}) {
  const queryKey =
    scope === "files"
      ? picoQueryKeys.gitFiles(viewerContextId, cwd)
      : scope === "branches"
        ? picoQueryKeys.gitBranches(viewerContextId, cwd)
        : [
            ...picoQueryKeys.gitCommits(viewerContextId, cwd),
            commitsLimit ?? GIT_COMMITS_PAGE_SIZE,
          ]

  return {
    queryKey,
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(
          `/api/git-changes?cwd=${encodeURIComponent(cwd)}&gitScope=${scope}${
            scope === "commits"
              ? `&commitsLimit=${encodeURIComponent(
                  String(commitsLimit ?? GIT_COMMITS_PAGE_SIZE)
                )}`
              : ""
          }`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: GIT_QUERY_STALE_TIME_MS,
    gcTime: GIT_QUERY_GC_TIME_MS,
  }
}

export function gitFileDiffQueryOptions({
  viewerContextId,
  cwd,
  path,
}: {
  viewerContextId: string
  cwd: string
  path: string
}) {
  return {
    queryKey: picoQueryKeys.gitFileDiff(viewerContextId, cwd, path),
    queryFn: () =>
      fetchJson<GitFileDiffData>(
        buildRequestUrl(
          `/api/git-diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: GIT_QUERY_STALE_TIME_MS,
    gcTime: GIT_QUERY_GC_TIME_MS,
  }
}

export function gitFileReviewQueryOptions({
  viewerContextId,
  cwd,
  path,
  previousPath,
}: {
  viewerContextId: string
  cwd: string
  path: string
  previousPath?: string
}) {
  const previousPathParam = previousPath
    ? `&previousPath=${encodeURIComponent(previousPath)}`
    : ""

  return {
    queryKey: picoQueryKeys.gitFileReview(
      viewerContextId,
      cwd,
      path,
      previousPath
    ),
    queryFn: () =>
      fetchJson<GitFileReviewData>(
        buildRequestUrl(
          `/api/git-review?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}${previousPathParam}`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: GIT_QUERY_STALE_TIME_MS,
    gcTime: GIT_QUERY_GC_TIME_MS,
  }
}

export function selectGitStatusSummary(data: GitStatusData): GitStatusValue {
  return data.gitStatus
}

export function selectGitFiles(data: GitChangesData) {
  return data.files
}

export async function invalidateGitQueries({
  queryClient,
  viewerContextId,
  cwd,
}: {
  queryClient: QueryClient
  viewerContextId: string
  cwd: string
}) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.gitFiles(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.gitFileDiffs(viewerContextId, cwd),
      exact: false,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.gitFileReviews(viewerContextId, cwd),
      exact: false,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.projectFileTree(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.gitCommits(viewerContextId, cwd),
      exact: false,
      refetchType: "active",
    }),
  ])
}

export function formatHeaderGitStatusText(
  gitStatus: GitStatusValue | undefined
) {
  if (!gitStatus) return ""

  const inline =
    typeof gitStatus.inline === "string" ? gitStatus.inline.trim() : ""
  if (inline) return inline

  if (gitStatus.detached) {
    return typeof gitStatus.revision === "string" && gitStatus.revision.trim()
      ? `detached ${gitStatus.revision.trim()}`
      : "detached"
  }

  return typeof gitStatus.branch === "string" ? gitStatus.branch.trim() : ""
}

export function formatGitWorkingTreeSummary(
  gitStatus: GitStatusValue | undefined
) {
  if (!gitStatus) return ""

  const changedFileCount =
    Number.isInteger(gitStatus.changedFileCount) &&
    gitStatus.changedFileCount > 0
      ? gitStatus.changedFileCount
      : gitStatus.dirty
        ? 1
        : 0

  if (changedFileCount === 0) return "Working tree clean"

  return `${changedFileCount} file${changedFileCount === 1 ? "" : "s"} changed`
}

export function gitStatusHasDiverged(gitStatus: GitStatusValue | undefined) {
  return Boolean(
    gitStatus &&
    !gitStatus.detached &&
    (gitStatus.ahead || 0) > 0 &&
    (gitStatus.behind || 0) > 0
  )
}

export type GitFileStatusColumn = "index" | "worktree"

export const GIT_CONFLICT_STATUS_DESCRIPTIONS: Record<string, string> = {
  AA: "Conflict: added by both sides",
  AU: "Conflict: added by us",
  DD: "Conflict: deleted by both sides",
  DU: "Conflict: deleted by us",
  UA: "Conflict: added by them",
  UD: "Conflict: deleted by them",
  UU: "Conflict: modified by both sides",
}

export function gitFileStatusCharacters(status: string | undefined) {
  const normalized =
    typeof status === "string" ? status.slice(0, 2).padEnd(2, " ") : "  "
  return [normalized[0] ?? " ", normalized[1] ?? " "] as const
}

export function gitFileStatusTooltip({
  character,
  column,
  status,
}: {
  character: string
  column: GitFileStatusColumn
  status: string | undefined
}) {
  if (character === " ") return ""

  const normalizedStatus =
    typeof status === "string" ? status.slice(0, 2).padEnd(2, " ") : "  "
  const conflictDescription =
    GIT_CONFLICT_STATUS_DESCRIPTIONS[normalizedStatus.trim()]
  if (conflictDescription) return `${character}: ${conflictDescription}`

  if (character === "?") return "?: Untracked file"
  if (character === "!") return "!: Ignored file"
  if (character === "U") return "U: Unmerged conflict"

  const stagedDescriptions: Record<string, string> = {
    A: "Added and staged",
    C: "Copied and staged",
    D: "Deleted and staged",
    M: "Modified and staged",
    R: "Renamed and staged",
    T: "Type changed and staged",
  }
  const unstagedDescriptions: Record<string, string> = {
    A: "Added in the working tree",
    C: "Copied in the working tree",
    D: "Deleted but not staged",
    M: "Modified but not staged",
    R: "Renamed in the working tree",
    T: "Type changed but not staged",
  }
  const descriptions =
    column === "index" ? stagedDescriptions : unstagedDescriptions
  const columnDescription = column === "index" ? "staged/index" : "working tree"

  return `${character}: ${descriptions[character] ?? `Changed in ${columnDescription}`}`
}

export function gitFileStatusTone(
  column: GitFileStatusColumn,
  character: string
) {
  if (character === " ") return "muted"
  if (character === "?") return "untracked"
  if (character === "U" || character === "!") return "conflict"
  return column === "index" ? "staged" : "unstaged"
}

export function gitFileStatusToneClass(tone: string) {
  switch (tone) {
    case "staged":
      return "text-emerald-500"
    case "unstaged":
      return "text-amber-500"
    case "untracked":
      return "text-sky-500"
    case "conflict":
      return "text-red-500"
    default:
      return "text-muted-foreground/70"
  }
}

export function gitFileLineChangeValue(value: number | undefined) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? (value ?? 0) : 0
}

export function gitFileHasLineChanges(file: GitChangeFile) {
  return (
    gitFileLineChangeValue(file.linesAdded) > 0 ||
    gitFileLineChangeValue(file.linesDeleted) > 0
  )
}

export function gitFilesLineSummary(files: Array<GitChangeFile>) {
  let additions = 0
  let deletions = 0

  for (const file of files) {
    additions += gitFileLineChangeValue(file.linesAdded)
    deletions += gitFileLineChangeValue(file.linesDeleted)
  }

  if (additions === 0 && deletions === 0) return ""
  return `+${additions} -${deletions}`
}

export function gitLocalBranchTrackText(branch: GitLocalBranch) {
  if (!branch.upstream) return ""
  if (branch.upstreamGone) return "gone"
  const ahead = Number.isInteger(branch.ahead) ? branch.ahead : 0
  const behind = Number.isInteger(branch.behind) ? branch.behind : 0
  if (ahead > 0 && behind > 0) return `↓${behind} ↑${ahead}`
  if (behind > 0) return `↓${behind}`
  if (ahead > 0) return `↑${ahead}`
  return "synced"
}

export function gitLocalBranchTrackClass(
  branch: GitLocalBranch,
  trackText: string
) {
  if (branch.upstreamGone) return "text-red-500"
  if (trackText === "synced") return "text-emerald-500"
  return "text-amber-500"
}

export function formatGitRelativeDateCompact(value: string | undefined) {
  const text = value?.trim().toLowerCase() || ""
  if (!text) return ""
  if (text === "now") return "now"

  const match = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?/)
  if (!match) return text.replace(/\s+ago$/, "")

  const amount = match[1]
  const unit = match[2]
  const suffix =
    unit === "second"
      ? "s"
      : unit === "minute"
        ? "m"
        : unit === "hour"
          ? "h"
          : unit === "day"
            ? "d"
            : unit === "week"
              ? "w"
              : unit === "month"
                ? "mo"
                : "y"

  return `${amount}${suffix}`
}

export function gitLocalBranchesForRender(
  branches: Array<GitLocalBranch> | null | undefined,
  gitStatus: GitStatusValue | undefined
): Array<GitLocalBranch> {
  if (Array.isArray(branches) && branches.length > 0) {
    return branches
  }

  const branchName = gitStatus?.branch?.trim()
  if (!branchName) {
    return Array.isArray(branches) ? branches : []
  }

  const fallbackBranch: GitLocalBranch = {
    name: branchName,
    current: true,
    ahead: gitStatus?.ahead || 0,
    behind: gitStatus?.behind || 0,
    upstreamGone: false,
    ...(gitStatus?.revision ? { hash: gitStatus.revision } : {}),
  }

  return [fallbackBranch]
}

export function gitRemoteBranchParts(name: string | undefined) {
  const value = typeof name === "string" ? name.trim() : ""
  const slashIndex = value.indexOf("/")
  if (slashIndex <= 0) {
    return { remote: "", branch: value }
  }

  return {
    remote: value.slice(0, slashIndex),
    branch: value.slice(slashIndex + 1),
  }
}

export function gitCommitEntryCount(commits: Array<string>) {
  return commits.reduce(
    (count, line) => count + (line.includes("\t") ? 1 : 0),
    0
  )
}

export function gitCommitsSummaryText(commits: Array<string>) {
  const count = gitCommitEntryCount(commits)
  return count > 0 ? `${count} commit${count === 1 ? "" : "s"}` : ""
}

export const GIT_COMMIT_FIELD_SEPARATOR = "\u001f"

export function parseGitCommitGraphLine(line: string) {
  const text = typeof line === "string" ? line : ""
  const tabIndex = text.indexOf("\t")
  if (tabIndex < 0) {
    return {
      author: "",
      graph: text,
      hash: "",
      fullHash: "",
      parents: [] as Array<string>,
      relativeDate: "",
      fullDate: "",
      stats: "",
      subject: "",
    }
  }

  const lead = text.slice(0, tabIndex)
  const metadata = text.slice(tabIndex + 1)
  const hashMatch = lead.match(/^(.*?)([0-9a-f]{5,40})$/i)
  const metadataFields = metadata.split(GIT_COMMIT_FIELD_SEPARATOR)

  if (metadataFields.length >= 5) {
    const [
      fullHash = "",
      parentsText = "",
      author = "",
      relativeDate = "",
      maybeFullDate = "",
      ...rest
    ] = metadataFields
    const hasFullDate = /^\d{4}-\d{2}-\d{2}T/.test(maybeFullDate)
    const fullDate = hasFullDate ? maybeFullDate : ""
    const subjectAndStats = hasFullDate ? rest : [maybeFullDate, ...rest]
    const stats =
      subjectAndStats.length > 1
        ? subjectAndStats[subjectAndStats.length - 1] || ""
        : ""
    const subjectParts = stats ? subjectAndStats.slice(0, -1) : subjectAndStats

    return {
      author,
      graph: hashMatch ? hashMatch[1] : lead,
      hash: hashMatch ? hashMatch[2] : "",
      fullHash,
      parents: parentsText.split(/\s+/).filter(Boolean),
      relativeDate,
      fullDate,
      stats,
      subject: subjectParts.join(GIT_COMMIT_FIELD_SEPARATOR).trim(),
    }
  }

  if (metadataFields.length >= 4) {
    const [
      fullHash = "",
      author = "",
      relativeDate = "",
      maybeFullDate = "",
      ...rest
    ] = metadataFields
    const hasFullDate = /^\d{4}-\d{2}-\d{2}T/.test(maybeFullDate)
    const fullDate = hasFullDate ? maybeFullDate : ""
    const subjectAndStats = hasFullDate ? rest : [maybeFullDate, ...rest]
    const stats =
      subjectAndStats.length > 1
        ? subjectAndStats[subjectAndStats.length - 1] || ""
        : ""
    const subjectParts = stats ? subjectAndStats.slice(0, -1) : subjectAndStats

    return {
      author,
      graph: hashMatch ? hashMatch[1] : lead,
      hash: hashMatch ? hashMatch[2] : "",
      fullHash,
      parents: [],
      relativeDate,
      fullDate,
      stats,
      subject: subjectParts.join(GIT_COMMIT_FIELD_SEPARATOR).trim(),
    }
  }

  const subjectParts = metadata.split("\t")
  const [maybeFullHash = "", ...restSubjectParts] = subjectParts
  const hasFullHash = Boolean(
    hashMatch &&
    subjectParts.length > 1 &&
    /^[0-9a-f]{40}$/i.test(maybeFullHash)
  )
  return {
    author: "",
    graph: hashMatch ? hashMatch[1] : lead,
    hash: hashMatch ? hashMatch[2] : "",
    fullHash: hasFullHash ? maybeFullHash : hashMatch ? hashMatch[2] : "",
    parents: [],
    relativeDate: "",
    fullDate: "",
    stats: "",
    subject: (hasFullHash ? restSubjectParts : subjectParts).join("\t").trim(),
  }
}

export function formatGitCommitDetailTime(value: string) {
  const text = value.trim()
  if (!text) return ""

  const compact = formatGitRelativeDateCompact(text)
  if (!compact || compact === "now" || !/\bago$/i.test(text)) return compact
  return `${compact} ago`
}

export function formatGitCommitFullDate(value: string) {
  const text = value.trim()
  if (!text) return ""

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  }).format(date)
}

export function gitCommitStatCount(
  stats: string,
  kind: "insertions" | "deletions"
) {
  const pattern =
    kind === "insertions" ? /(\d+) insertions?\(\+\)/ : /(\d+) deletions?\(-\)/
  const match = stats.match(pattern)
  return match ? Number(match[1]) : 0
}

export async function copyRightSidebarTextToClipboard(text: string) {
  if (!text) throw new Error("Nothing to copy")

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the textarea fallback below.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  textarea.select()

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Unable to copy text")
    }
  } finally {
    textarea.remove()
  }
}

export async function copyGitCommitValue(text: string) {
  try {
    await copyRightSidebarTextToClipboard(text)
    return true
  } catch (error) {
    toast.error(getErrorMessage(error, "Failed to copy"))
    return false
  }
}
