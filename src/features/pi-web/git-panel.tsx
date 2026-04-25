import * as React from "react"
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { piWebQueryKeys } from "@/features/pi-web/query-keys"
import type {
  GitChangeFile,
  GitChangesResponse,
  GitLocalBranch,
  GitRemoteBranch,
  GitStatusResponse,
  GitStatusSummary,
} from "@/lib/pi-web-api"
import { cn } from "@/lib/utils"

type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>
type GitStatusValue = GitStatusSummary | null
type BranchScope = "local" | "remote"

type GitPanelProps = {
  viewerContextId: string
  cwd?: string
  active: boolean
}

type GitScopedProps = GitPanelProps

type GitSectionProps = {
  title: string
  meta?: string
  controls?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}

const GIT_QUERY_STALE_TIME_MS = 1000 * 30
const GIT_QUERY_GC_TIME_MS = 1000 * 60 * 10

function normalizeCwd(cwd: string | undefined) {
  return cwd?.trim() || ""
}

function formatDisplayPath(value: string | undefined) {
  const path = value?.trim() || ""
  if (!path) return ""

  return path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

function formatFolderName(value: string | undefined) {
  const path = value?.trim().replace(/\/+$/, "") || ""
  if (!path) return ""
  if (path === "/") return "/"

  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function gitStatusQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: piWebQueryKeys.gitStatus(viewerContextId, cwd),
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

function gitChangesQueryOptions({
  viewerContextId,
  cwd,
  scope,
}: {
  viewerContextId: string
  cwd: string
  scope: "files" | "branches" | "commits"
}) {
  const queryKey =
    scope === "files"
      ? piWebQueryKeys.gitFiles(viewerContextId, cwd)
      : scope === "branches"
        ? piWebQueryKeys.gitBranches(viewerContextId, cwd)
        : piWebQueryKeys.gitCommits(viewerContextId, cwd)

  return {
    queryKey,
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(
          `/api/git-changes?cwd=${encodeURIComponent(cwd)}&scope=${scope}`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: GIT_QUERY_STALE_TIME_MS,
    gcTime: GIT_QUERY_GC_TIME_MS,
  }
}

function selectGitStatusSummary(data: GitStatusData): GitStatusValue {
  return data.gitStatus
}

function selectGitFiles(data: GitChangesData) {
  return data.files
}

function selectGitLocalBranches(data: GitChangesData) {
  return data.localBranches
}

function selectGitRemoteBranches(data: GitChangesData) {
  return data.remoteBranches
}

function selectGitCommits(data: GitChangesData) {
  return data.commits
}

function selectGitUnpushedCommitShortHashes(data: GitChangesData) {
  return data.unpushedCommitShortHashes
}

function formatHeaderGitStatusText(gitStatus: GitStatusValue | undefined) {
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

function formatGitWorkingTreeSummary(gitStatus: GitStatusValue | undefined) {
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

function selectGitWorkingTreeSummary(data: GitStatusData) {
  return formatGitWorkingTreeSummary(data.gitStatus)
}

function gitFileStatusCharacters(status: string | undefined) {
  const normalized =
    typeof status === "string" ? status.slice(0, 2).padEnd(2, " ") : "  "
  return [normalized[0] ?? " ", normalized[1] ?? " "] as const
}

function gitFileStatusTone(column: "index" | "worktree", character: string) {
  if (character === " ") return "muted"
  if (character === "?") return "untracked"
  if (character === "U" || character === "!") return "conflict"
  return column === "index" ? "staged" : "unstaged"
}

function gitFileStatusToneClass(tone: string) {
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

function gitFileLineChangeValue(value: number | undefined) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? (value ?? 0) : 0
}

function gitFileHasLineChanges(file: GitChangeFile) {
  return (
    gitFileLineChangeValue(file.linesAdded) > 0 ||
    gitFileLineChangeValue(file.linesDeleted) > 0
  )
}

function gitFilesSummaryText(files: Array<GitChangeFile>) {
  if (!files.length) return ""

  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0

  for (const file of files) {
    const [indexCharacter, worktreeCharacter] = gitFileStatusCharacters(
      file.status
    )
    if (indexCharacter === "?" || worktreeCharacter === "?") {
      untrackedCount += 1
      continue
    }
    if (indexCharacter !== " " && indexCharacter !== "!") {
      stagedCount += 1
    }
    if (worktreeCharacter !== " " && worktreeCharacter !== "!") {
      unstagedCount += 1
    }
  }

  const parts = [`${files.length} file${files.length === 1 ? "" : "s"}`]
  if (stagedCount > 0) parts.push(`${stagedCount} staged`)
  if (unstagedCount > 0) parts.push(`${unstagedCount} unstaged`)
  if (untrackedCount > 0) parts.push(`${untrackedCount} untracked`)
  return parts.join(" · ")
}

function gitLocalBranchTrackText(branch: GitLocalBranch) {
  if (!branch.upstream) return ""
  if (branch.upstreamGone) return "gone"
  const ahead = Number.isInteger(branch.ahead) ? branch.ahead : 0
  const behind = Number.isInteger(branch.behind) ? branch.behind : 0
  if (ahead > 0 && behind > 0) return `↓${behind} ↑${ahead}`
  if (behind > 0) return `↓${behind}`
  if (ahead > 0) return `↑${ahead}`
  return "synced"
}

function gitLocalBranchTrackClass(branch: GitLocalBranch, trackText: string) {
  if (branch.upstreamGone) return "text-red-500"
  if (trackText === "synced") return "text-emerald-500"
  return "text-amber-500"
}

function formatGitRelativeDateCompact(value: string | undefined) {
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

function gitLocalBranchesForRender(
  branches: Array<GitLocalBranch> | null | undefined,
  gitStatus: GitStatusValue | undefined
) {
  if (Array.isArray(branches) && branches.length > 0) {
    return branches
  }

  const branchName = gitStatus?.branch?.trim()
  if (!branchName) {
    return Array.isArray(branches) ? branches : []
  }

  const fallbackBranch = {
    name: branchName,
    current: true,
    ahead: gitStatus?.ahead || 0,
    behind: gitStatus?.behind || 0,
    upstreamGone: false,
    ...(gitStatus?.revision ? { hash: gitStatus.revision } : {}),
  } satisfies GitLocalBranch

  return [fallbackBranch]
}

function gitRemoteBranchParts(name: string | undefined) {
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

function gitCommitEntryCount(commits: Array<string>) {
  return commits.reduce(
    (count, line) => count + (line.includes("\t") ? 1 : 0),
    0
  )
}

function gitCommitsSummaryText(
  gitStatus: GitStatusValue | undefined,
  commits: Array<string>
) {
  const parts = []
  if (gitStatus?.detached) {
    parts.push(`detached ${gitStatus.revision || "HEAD"}`.trim())
  } else if (gitStatus?.branch) {
    parts.push(gitStatus.branch)
  }

  const count = gitCommitEntryCount(commits)
  if (count > 0) {
    parts.push(`${count} commit${count === 1 ? "" : "s"}`)
  }

  return parts.join(" · ")
}

function parseGitCommitGraphLine(line: string) {
  const text = typeof line === "string" ? line : ""
  if (!text.includes("\t")) {
    return { graph: text, hash: "", subject: "" }
  }

  const [lead = "", ...subjectParts] = text.split("\t")
  const hashMatch = lead.match(/^(.*?)([0-9a-f]{5,40})$/i)
  return {
    graph: hashMatch ? hashMatch[1] : lead,
    hash: hashMatch ? hashMatch[2] : "",
    subject: subjectParts.join("\t").trim(),
  }
}

function GitSection({
  title,
  meta,
  controls,
  className,
  bodyClassName,
  children,
}: GitSectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card/50",
        className
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
            {title}
          </div>
          {meta ? (
            <div className="min-w-0 truncate text-xs text-muted-foreground/80">
              {meta}
            </div>
          ) : null}
        </div>
        {controls ? <div className="shrink-0">{controls}</div> : null}
      </div>
      <div className={cn("grid gap-2 px-3 py-2.5", bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

function GitSectionNote({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "destructive"
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center gap-2 text-sm leading-6",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {children}
    </div>
  )
}

function GitPanelErrorToasts({ viewerContextId, cwd, active }: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const enabled = Boolean(active && viewerContextId && normalizedCwd)
  const statusErrorQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })
  const changesErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })

  React.useEffect(() => {
    if (!active) return

    const error = changesErrorQuery.error || statusErrorQuery.error
    if (!error) return

    toast.error(getErrorMessage(error, "Failed to load git view"))
  }, [
    active,
    changesErrorQuery.error,
    changesErrorQuery.errorUpdatedAt,
    statusErrorQuery.error,
    statusErrorQuery.errorUpdatedAt,
  ])

  return null
}

function GitRepositorySummary({
  viewerContextId,
  cwd,
  active,
}: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const enabled = Boolean(active && viewerContextId && normalizedCwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled,
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })

  if (!normalizedCwd) {
    return <GitSectionNote>No directory selected.</GitSectionNote>
  }

  if (!viewerContextId) {
    return <GitSectionNote>Waiting for viewer context…</GitSectionNote>
  }

  if (statusQuery.isPending && typeof statusQuery.data === "undefined") {
    return (
      <GitSectionNote>
        <Spinner /> Loading repository status…
      </GitSectionNote>
    )
  }

  if (statusQuery.error) {
    return (
      <GitSectionNote tone="destructive">
        {getErrorMessage(statusQuery.error, "Failed to load repository status")}
      </GitSectionNote>
    )
  }

  const gitStatus = statusQuery.data
  if (!gitStatus) {
    return <GitSectionNote>No git repository detected.</GitSectionNote>
  }

  const branchLabel = gitStatus.detached
    ? `Detached HEAD${gitStatus.revision ? ` (${gitStatus.revision})` : ""}`
    : gitStatus.branch || gitStatus.label

  const folderName = formatFolderName(normalizedCwd)
  const synced = gitStatus.ahead === 0 && gitStatus.behind === 0
  const title = [formatDisplayPath(normalizedCwd), gitStatus.title]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      className="flex min-w-0 items-center gap-2 text-lg leading-7"
      title={title}
    >
      {synced ? (
        <CheckIcon className="size-4 shrink-0 text-emerald-500" />
      ) : null}
      {gitStatus.behind > 0 ? (
        <span className="shrink-0 font-semibold text-sky-500 tabular-nums">
          ↓{gitStatus.behind}
        </span>
      ) : null}
      {gitStatus.ahead > 0 ? (
        <span className="shrink-0 font-semibold text-amber-500 tabular-nums">
          ↑{gitStatus.ahead}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-semibold">
        {folderName || "No cwd"}
      </span>
      {branchLabel ? (
        <>
          <span className="shrink-0 text-muted-foreground">→</span>
          <span className="min-w-0 truncate">{branchLabel}</span>
        </>
      ) : null}
    </div>
  )
}

function GitPanelToolbar({ viewerContextId, cwd, active }: GitScopedProps) {
  const queryClient = useQueryClient()
  const normalizedCwd = normalizeCwd(cwd)
  const statusFetchCount = useIsFetching({
    queryKey: piWebQueryKeys.gitStatus(viewerContextId, normalizedCwd),
    exact: true,
  })
  const filesFetchCount = useIsFetching({
    queryKey: piWebQueryKeys.gitFiles(viewerContextId, normalizedCwd),
    exact: true,
  })
  const branchesFetchCount = useIsFetching({
    queryKey: piWebQueryKeys.gitBranches(viewerContextId, normalizedCwd),
    exact: true,
  })
  const commitsFetchCount = useIsFetching({
    queryKey: piWebQueryKeys.gitCommits(viewerContextId, normalizedCwd),
    exact: true,
  })
  const refreshing =
    statusFetchCount +
      filesFetchCount +
      branchesFetchCount +
      commitsFetchCount >
    0

  const refreshGit = async () => {
    if (!viewerContextId || !normalizedCwd) return

    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: piWebQueryKeys.gitStatus(viewerContextId, normalizedCwd),
          exact: true,
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: piWebQueryKeys.gitFiles(viewerContextId, normalizedCwd),
          exact: true,
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: piWebQueryKeys.gitBranches(viewerContextId, normalizedCwd),
          exact: true,
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: piWebQueryKeys.gitCommits(viewerContextId, normalizedCwd),
          exact: true,
          refetchType: "active",
        }),
      ])
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load git view"))
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitRepositorySummary
          viewerContextId={viewerContextId}
          cwd={normalizedCwd}
          active={active}
        />
        {active && refreshing ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Updating
          </span>
        ) : null}
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={!viewerContextId || !normalizedCwd || refreshing}
        onClick={() => {
          void refreshGit()
        }}
      >
        <RefreshCwIcon className={cn(refreshing && "animate-spin")} /> Refresh
      </Button>
    </div>
  )
}

function GitFileStatus({ status }: { status: string | undefined }) {
  const [indexCharacter, worktreeCharacter] = gitFileStatusCharacters(status)

  return (
    <span className="inline-flex w-[2ch] shrink-0 items-center whitespace-pre text-muted-foreground/70">
      {(
        [
          ["index", indexCharacter],
          ["worktree", worktreeCharacter],
        ] as const
      ).map(([column, character]) => (
        <span
          key={column}
          className={cn(
            "w-[1ch] text-center whitespace-pre",
            gitFileStatusToneClass(gitFileStatusTone(column, character))
          )}
        >
          {character}
        </span>
      ))}
    </span>
  )
}

function GitFileDiff({ file }: { file: GitChangeFile }) {
  if (!gitFileHasLineChanges(file)) {
    return <span className="min-w-0" />
  }

  const linesAdded = gitFileLineChangeValue(file.linesAdded)
  const linesDeleted = gitFileLineChangeValue(file.linesDeleted)

  return (
    <span className="inline-flex min-w-0 gap-2 justify-self-end whitespace-nowrap tabular-nums">
      {linesAdded > 0 ? (
        <span className="text-emerald-500">+{linesAdded}</span>
      ) : null}
      {linesDeleted > 0 ? (
        <span className="text-red-500">-{linesDeleted}</span>
      ) : null}
    </span>
  )
}

function GitFileRow({ file }: { file: GitChangeFile }) {
  const title = file.previousPath
    ? `${file.status} ${file.previousPath} -> ${file.path}`
    : `${file.status} ${file.path}`

  return (
    <li
      title={title}
      className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-border/70 py-1.5 font-mono text-[13px] leading-5 first:border-t-0"
    >
      <GitFileStatus status={file.status} />
      <span className="min-w-0 truncate">
        {file.previousPath ? (
          <>
            <span className="text-muted-foreground">{file.previousPath}</span>
            <span className="text-muted-foreground/70"> → </span>
            <span>{file.path}</span>
          </>
        ) : (
          file.path
        )}
      </span>
      <GitFileDiff file={file} />
    </li>
  )
}

function GitFilesSection({ viewerContextId, cwd, active }: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitFiles,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const files = filesQuery.data
  const meta = Array.isArray(files) ? gitFilesSummaryText(files) : ""

  return (
    <GitSection title="Files" meta={meta}>
      {!normalizedCwd ? (
        <GitSectionNote>No directory selected.</GitSectionNote>
      ) : !viewerContextId ? (
        <GitSectionNote>Waiting for viewer context…</GitSectionNote>
      ) : filesQuery.isPending && typeof files === "undefined" ? (
        <GitSectionNote>
          <Spinner /> Loading files…
        </GitSectionNote>
      ) : filesQuery.error ? (
        <GitSectionNote tone="destructive">
          {getErrorMessage(filesQuery.error, "Failed to load files")}
        </GitSectionNote>
      ) : files === null ? (
        <GitSectionNote>No git repository detected.</GitSectionNote>
      ) : Array.isArray(files) && files.length > 0 ? (
        <ul className="m-0 grid list-none gap-0 p-0">
          {files.map((file) => (
            <GitFileRow
              key={`${file.status}:${file.previousPath || ""}:${file.path}`}
              file={file}
            />
          ))}
        </ul>
      ) : (
        <GitSectionNote>Working tree clean.</GitSectionNote>
      )}
    </GitSection>
  )
}

function GitBranchesControls({
  branchScope,
  countLabel,
  setBranchScope,
}: {
  branchScope: BranchScope
  countLabel: string
  setBranchScope: React.Dispatch<React.SetStateAction<BranchScope>>
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {countLabel ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground/80">
          {countLabel}
        </span>
      ) : null}
      <div className="inline-flex items-center rounded-md border border-border/80 bg-background/70 p-0.5">
        {(
          [
            ["local", "Local"],
            ["remote", "Remote"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={branchScope === value}
            className={cn(
              "min-h-6 rounded-[calc(var(--radius-sm)-1px)] px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground",
              branchScope === value &&
                "bg-muted text-foreground shadow-xs dark:bg-input/40"
            )}
            onClick={() => {
              setBranchScope(value)
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function GitLocalBranchRow({ branch }: { branch: GitLocalBranch }) {
  const trackText = gitLocalBranchTrackText(branch)
  const relativeDateText = branch.current
    ? "*"
    : formatGitRelativeDateCompact(branch.relativeDate)
  const title =
    [branch.name, branch.upstream, branch.subject]
      .filter(Boolean)
      .join(" · ") || branch.name

  return (
    <li
      title={title}
      className="flex min-h-7 min-w-0 items-center gap-2 border-t border-border/70 py-1.5 font-mono text-[13px] leading-5 first:border-t-0"
    >
      <span
        className={cn(
          "w-[4ch] shrink-0 text-right text-muted-foreground/70 tabular-nums",
          branch.current && "text-emerald-500"
        )}
      >
        {relativeDateText}
      </span>
      <span className="min-w-0 truncate">
        <span className={cn(branch.current && "text-emerald-500")}>
          {branch.name}
        </span>
      </span>
      {trackText ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center whitespace-nowrap",
            gitLocalBranchTrackClass(branch, trackText)
          )}
          title={trackText}
        >
          {trackText === "synced" ? (
            <CheckIcon className="size-3.5" />
          ) : (
            trackText
          )}
        </span>
      ) : null}
    </li>
  )
}

function GitRemoteBranchRow({ branch }: { branch: GitRemoteBranch }) {
  const parts = gitRemoteBranchParts(branch.name)
  const title =
    [branch.name, branch.subject].filter(Boolean).join(" · ") || branch.name

  return (
    <li
      title={title}
      className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-border/70 py-1.5 font-mono text-[13px] leading-5 first:border-t-0"
    >
      <span className="min-w-0 truncate">
        {parts.remote ? (
          <span className="text-muted-foreground/70">{parts.remote}/</span>
        ) : null}
        <span>{parts.branch || branch.name}</span>
      </span>
      <span className="inline-flex min-w-0 gap-2 justify-self-end whitespace-nowrap" />
    </li>
  )
}

function GitBranchesSection({ viewerContextId, cwd, active }: GitScopedProps) {
  const [branchScope, setBranchScope] = React.useState<BranchScope>("local")
  const normalizedCwd = normalizeCwd(cwd)
  const branchesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "branches",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select:
      branchScope === "remote"
        ? selectGitRemoteBranches
        : selectGitLocalBranches,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(
      active && branchScope === "local" && viewerContextId && normalizedCwd
    ),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const selectedBranches = branchesQuery.data
  const localBranches =
    branchScope === "local"
      ? gitLocalBranchesForRender(
          selectedBranches as Array<GitLocalBranch> | null | undefined,
          statusQuery.data
        )
      : []
  const remoteBranches =
    branchScope === "remote" && Array.isArray(selectedBranches)
      ? (selectedBranches as Array<GitRemoteBranch>)
      : []
  const visibleCount =
    branchScope === "remote" ? remoteBranches.length : localBranches.length
  const countLabel = Array.isArray(selectedBranches)
    ? `${visibleCount} ${branchScope === "remote" ? "remote" : "local"}`
    : ""

  return (
    <GitSection
      title="Branches"
      controls={
        <GitBranchesControls
          branchScope={branchScope}
          countLabel={countLabel}
          setBranchScope={setBranchScope}
        />
      }
    >
      {!normalizedCwd ? (
        <GitSectionNote>No directory selected.</GitSectionNote>
      ) : !viewerContextId ? (
        <GitSectionNote>Waiting for viewer context…</GitSectionNote>
      ) : branchesQuery.isPending && typeof selectedBranches === "undefined" ? (
        <GitSectionNote>
          <Spinner /> Loading branches…
        </GitSectionNote>
      ) : branchesQuery.error ? (
        <GitSectionNote tone="destructive">
          {getErrorMessage(branchesQuery.error, "Failed to load branches")}
        </GitSectionNote>
      ) : selectedBranches === null ? (
        <GitSectionNote>No git repository detected.</GitSectionNote>
      ) : branchScope === "remote" ? (
        remoteBranches.length > 0 ? (
          <ul className="m-0 grid list-none gap-0 p-0">
            {remoteBranches.map((branch) => (
              <GitRemoteBranchRow key={branch.name} branch={branch} />
            ))}
          </ul>
        ) : (
          <GitSectionNote>No remote branches.</GitSectionNote>
        )
      ) : localBranches.length > 0 ? (
        <ul className="m-0 grid list-none gap-0 p-0">
          {localBranches.map((branch) => (
            <GitLocalBranchRow key={branch.name} branch={branch} />
          ))}
        </ul>
      ) : (
        <GitSectionNote>No local branches.</GitSectionNote>
      )}
    </GitSection>
  )
}

function GitCommitRow({
  line,
  unpushedCommitShortHashes,
}: {
  line: string
  unpushedCommitShortHashes: Set<string>
}) {
  const parsed = parseGitCommitGraphLine(line)
  const isUnpushed = Boolean(
    parsed.hash && unpushedCommitShortHashes.has(parsed.hash)
  )

  return (
    <div
      title={line.replace(/\t+/g, " ").trim()}
      className="flex min-w-max items-baseline font-mono text-[13px] leading-5"
    >
      <span
        className={cn(
          "whitespace-pre text-muted-foreground/70",
          isUnpushed && "text-red-400"
        )}
      >
        {parsed.graph}
      </span>
      {parsed.hash ? (
        <span
          className={cn(
            "whitespace-pre text-sky-500",
            isUnpushed && "text-red-400"
          )}
        >
          {parsed.hash}
        </span>
      ) : null}
      {parsed.subject ? (
        <span className="whitespace-pre text-foreground">
          {` ${parsed.subject}`}
        </span>
      ) : null}
    </div>
  )
}

function GitCommitsSection({ viewerContextId, cwd, active }: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const commitsQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitCommits,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const unpushedQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitUnpushedCommitShortHashes,
    notifyOnChangeProps: ["data"],
  })
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const commits = commitsQuery.data
  const meta = Array.isArray(commits)
    ? gitCommitsSummaryText(statusQuery.data, commits)
    : ""
  const unpushedCommitShortHashes = new Set(unpushedQuery.data ?? [])

  return (
    <GitSection
      title="Commits"
      meta={meta}
      className="overflow-x-auto"
      bodyClassName="overflow-x-auto"
    >
      {!normalizedCwd ? (
        <GitSectionNote>No directory selected.</GitSectionNote>
      ) : !viewerContextId ? (
        <GitSectionNote>Waiting for viewer context…</GitSectionNote>
      ) : commitsQuery.isPending && typeof commits === "undefined" ? (
        <GitSectionNote>
          <Spinner /> Loading commits…
        </GitSectionNote>
      ) : commitsQuery.error ? (
        <GitSectionNote tone="destructive">
          {getErrorMessage(commitsQuery.error, "Failed to load commits")}
        </GitSectionNote>
      ) : commits === null ? (
        <GitSectionNote>No git repository detected.</GitSectionNote>
      ) : Array.isArray(commits) && commits.length > 0 ? (
        <div className="grid min-w-max gap-0.5">
          {commits.map((line, index) => (
            <GitCommitRow
              key={`${index}:${line}`}
              line={line}
              unpushedCommitShortHashes={unpushedCommitShortHashes}
            />
          ))}
        </div>
      ) : (
        <GitSectionNote>No commits on this branch yet.</GitSectionNote>
      )}
    </GitSection>
  )
}

export function GitTabStatusText({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitWorkingTreeSummary,
    notifyOnChangeProps: ["data"],
  })
  const text = statusQuery.data || "Git"

  return <span className="max-w-48 truncate">{text}</span>
}

export function HeaderGitStatusText({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const text = formatHeaderGitStatusText(statusQuery.data)

  if (!text) return null

  return <span title={statusQuery.data?.title || text}>• {text}</span>
}

export function DraftGitStatusBadge({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })

  if (!statusQuery.data?.label) return null

  return <Badge variant="outline">{statusQuery.data.label}</Badge>
}

export function GitPanel({ viewerContextId, cwd, active }: GitPanelProps) {
  const normalizedCwd = normalizeCwd(cwd)

  return (
    <div className="mx-auto grid w-full max-w-[80ch] gap-3">
      <GitPanelErrorToasts
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
      />
      <GitPanelToolbar
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
      />
      <GitFilesSection
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
      />
      <GitBranchesSection
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
      />
      <GitCommitsSection
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
      />
    </div>
  )
}
