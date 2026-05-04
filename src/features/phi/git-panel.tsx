import * as React from "react"
import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react"
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react"
import {
  useIsFetching,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  GitBranchIcon,
  GitCommitIcon,
  UploadIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/phi/app-shell-utils"
import {
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/phi/keyboard-shortcuts"
import { phiQueryKeys } from "@/features/phi/query-keys"
import type {
  GitActionResponse,
  GitChangeFile,
  GitChangesResponse,
  GitCommitMessageResponse,
  GitCommitResponse,
  GitFileDiffResponse,
  GitFileReviewResponse,
  GitLocalBranch,
  GitRemoteBranch,
  GitStatusResponse,
  GitStatusSummary,
  HighlightResponse,
  ProjectFileReadResponse,
  ProjectFileTreeResponse,
} from "@/lib/phi/api"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>
type GitCommitMessageData = Extract<GitCommitMessageResponse, { ok: true }>
type GitFileDiffData = Extract<GitFileDiffResponse, { ok: true }>
type GitFileReviewData = Extract<GitFileReviewResponse, { ok: true }>
type ProjectFileTreeData = Extract<ProjectFileTreeResponse, { ok: true }>
type ProjectFileReadData = Extract<ProjectFileReadResponse, { ok: true }>
type GitStatusValue = GitStatusSummary | null
type BranchScope = "local" | "remote"
type GitRemoteAction = "push" | "force-push" | "pull"

type GitPanelProps = {
  viewerContextId: string
  cwd?: string
  active: boolean
  activeFilePath?: string
  onOpenFile?: (path: string) => void
  showToolbar?: boolean
}

type GitScopedProps = GitPanelProps

export type GitCommitDialogControllerHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

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
const GIT_COMMITS_PAGE_SIZE = 50
const GIT_REVIEW_FULL_CONTEXT_SIZE_THRESHOLD_BYTES = 10_000
const GIT_REVIEW_FULL_CONTEXT_CHANGED_LINE_THRESHOLD = 100

const fileHighlightCache = new Map<
  string,
  Promise<HighlightResponse> | HighlightResponse
>()

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c",
  cc: "c",
  cpp: "c",
  cs: "c",
  css: "css",
  go: "go",
  h: "c",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  mjs: "javascript",
  mdx: "mdx",
  py: "python",
  rs: "rust",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
}

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

function codeLanguageFromPath(path: string) {
  const cleanPath = path.split(/[?#]/)[0] || ""
  const extension = cleanPath.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase()
  if (!extension) return undefined

  return CODE_LANGUAGE_BY_EXTENSION[extension]
}

function hasHighlightHtml(
  payload: HighlightResponse | null
): payload is Extract<HighlightResponse, { html: string }> {
  return Boolean(payload && "html" in payload && payload.html)
}

async function getHighlightedProjectFile(code: string, language?: string) {
  if (!language) {
    return {
      ok: true,
      skipped: true,
    } satisfies HighlightResponse
  }

  const cacheKey = `${language}\u0000${code}`
  const cached = fileHighlightCache.get(cacheKey)
  if (cached) return await cached

  const promise = fetchJson<HighlightResponse>("/api/highlight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, language }),
  })

  fileHighlightCache.set(cacheKey, promise)
  const payload = await promise
  fileHighlightCache.set(cacheKey, payload)
  return payload
}

function gitStatusQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: phiQueryKeys.gitStatus(viewerContextId, cwd),
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
  commitsLimit,
}: {
  viewerContextId: string
  cwd: string
  scope: "files" | "branches" | "commits"
  commitsLimit?: number
}) {
  const queryKey =
    scope === "files"
      ? phiQueryKeys.gitFiles(viewerContextId, cwd)
      : scope === "branches"
        ? phiQueryKeys.gitBranches(viewerContextId, cwd)
        : [
            ...phiQueryKeys.gitCommits(viewerContextId, cwd),
            commitsLimit ?? GIT_COMMITS_PAGE_SIZE,
          ]

  return {
    queryKey,
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(
          `/api/git-changes?cwd=${encodeURIComponent(cwd)}&scope=${scope}${
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

function gitFileDiffQueryOptions({
  viewerContextId,
  cwd,
  path,
}: {
  viewerContextId: string
  cwd: string
  path: string
}) {
  return {
    queryKey: phiQueryKeys.gitFileDiff(viewerContextId, cwd, path),
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

function gitFileReviewQueryOptions({
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
    queryKey: phiQueryKeys.gitFileReview(
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

function projectFileTreeQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: phiQueryKeys.projectFileTree(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<ProjectFileTreeData>(
        buildRequestUrl(`/api/files/tree?cwd=${encodeURIComponent(cwd)}`, {
          contextId: viewerContextId,
        })
      ),
    staleTime: GIT_QUERY_STALE_TIME_MS,
    gcTime: GIT_QUERY_GC_TIME_MS,
  }
}

function projectFileReadQueryOptions({
  viewerContextId,
  cwd,
  path,
}: {
  viewerContextId: string
  cwd: string
  path: string
}) {
  return {
    queryKey: phiQueryKeys.projectFileRead(viewerContextId, cwd, path),
    queryFn: () =>
      fetchJson<ProjectFileReadData>(
        buildRequestUrl(
          `/api/files/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
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

async function invalidateGitQueries({
  queryClient,
  viewerContextId,
  cwd,
}: {
  queryClient: ReturnType<typeof useQueryClient>
  viewerContextId: string
  cwd: string
}) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.gitStatus(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.gitFiles(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.gitFileDiffs(viewerContextId, cwd),
      exact: false,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.gitFileReviews(viewerContextId, cwd),
      exact: false,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.projectFileTree(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.gitBranches(viewerContextId, cwd),
      exact: true,
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: phiQueryKeys.gitCommits(viewerContextId, cwd),
      exact: false,
      refetchType: "active",
    }),
  ])
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

function gitStatusHasDiverged(gitStatus: GitStatusValue | undefined) {
  return Boolean(
    gitStatus &&
    !gitStatus.detached &&
    (gitStatus.ahead || 0) > 0 &&
    (gitStatus.behind || 0) > 0
  )
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

function gitFilesLineSummary(files: Array<GitChangeFile>) {
  let additions = 0
  let deletions = 0

  for (const file of files) {
    additions += gitFileLineChangeValue(file.linesAdded)
    deletions += gitFileLineChangeValue(file.linesDeleted)
  }

  if (additions === 0 && deletions === 0) return ""
  return `+${additions} -${deletions}`
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

function gitCommitsSummaryText(commits: Array<string>) {
  const count = gitCommitEntryCount(commits)
  return count > 0 ? `${count} commit${count === 1 ? "" : "s"}` : ""
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
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 py-2">
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
  const filesErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })
  const branchesErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "branches",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })
  const commitsErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })

  React.useEffect(() => {
    if (!active) return

    const error =
      filesErrorQuery.error ||
      branchesErrorQuery.error ||
      commitsErrorQuery.error ||
      statusErrorQuery.error
    if (!error) return

    toast.error(getErrorMessage(error, "Failed to load git view"))
  }, [
    active,
    branchesErrorQuery.error,
    branchesErrorQuery.errorUpdatedAt,
    commitsErrorQuery.error,
    commitsErrorQuery.errorUpdatedAt,
    filesErrorQuery.error,
    filesErrorQuery.errorUpdatedAt,
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
      className="flex min-w-0 items-center gap-1.5 text-xs leading-5"
      title={title}
    >
      {synced ? (
        <CheckIcon className="size-3 shrink-0 text-emerald-500" />
      ) : null}
      {gitStatus.behind > 0 ? (
        <span className="shrink-0 font-medium text-sky-500 tabular-nums">
          ↓{gitStatus.behind}
        </span>
      ) : null}
      {gitStatus.ahead > 0 ? (
        <span className="shrink-0 font-medium text-amber-500 tabular-nums">
          ↑{gitStatus.ahead}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-medium">
        {folderName || "No cwd"}
      </span>
      {branchLabel ? (
        <>
          <span className="shrink-0 text-muted-foreground">→</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {branchLabel}
          </span>
        </>
      ) : null}
    </div>
  )
}

export function GitPanelToolbar({
  viewerContextId,
  cwd,
  active,
}: GitScopedProps) {
  const queryClient = useQueryClient()
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const statusFetchCount = useIsFetching({
    queryKey: phiQueryKeys.gitStatus(viewerContextId, normalizedCwd),
    exact: true,
  })
  const filesFetchCount = useIsFetching({
    queryKey: phiQueryKeys.gitFiles(viewerContextId, normalizedCwd),
    exact: true,
  })
  const branchesFetchCount = useIsFetching({
    queryKey: phiQueryKeys.gitBranches(viewerContextId, normalizedCwd),
    exact: true,
  })
  const commitsFetchCount = useIsFetching({
    queryKey: phiQueryKeys.gitCommits(viewerContextId, normalizedCwd),
    exact: false,
  })
  const refreshing =
    statusFetchCount +
      filesFetchCount +
      branchesFetchCount +
      commitsFetchCount >
    0

  const gitStatus = statusQuery.data
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : []
  const hasRepository = Boolean(gitStatus)
  const hasChanges = Boolean(gitStatus?.dirty || files.length > 0)
  const canPush = Boolean(
    hasRepository && !gitStatus?.detached && (gitStatus?.ahead || 0) > 0
  )
  const canForcePush = gitStatusHasDiverged(gitStatus)
  const canPull = Boolean(
    hasRepository && !gitStatus?.detached && (gitStatus?.behind || 0) > 0
  )

  const gitActionMutation = useMutation({
    mutationFn: async (action: GitRemoteAction) => {
      const endpoint = action === "pull" ? "/api/git-pull" : "/api/git-push"
      return await fetchJson<GitActionResponse>(
        buildRequestUrl(endpoint, { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: normalizedCwd,
            force: action === "force-push",
          }),
        }
      )
    },
    onSuccess: async () => {
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
    },
    onError: (error, action) => {
      toast.error(
        getErrorMessage(
          error,
          action === "pull"
            ? "Failed to pull changes"
            : action === "force-push"
              ? "Failed to force push changes"
              : "Failed to push changes"
        )
      )
    },
  })

  const shortcutPushMutatingCount = useIsMutating({
    mutationKey: phiQueryKeys.gitAction(viewerContextId, normalizedCwd, "push"),
  })
  const shortcutForcePushMutatingCount = useIsMutating({
    mutationKey: phiQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "force-push"
    ),
  })
  const shortcutPullMutatingCount = useIsMutating({
    mutationKey: phiQueryKeys.gitAction(viewerContextId, normalizedCwd, "pull"),
  })
  const pushing =
    (gitActionMutation.isPending && gitActionMutation.variables === "push") ||
    shortcutPushMutatingCount > 0
  const forcePushing =
    (gitActionMutation.isPending &&
      gitActionMutation.variables === "force-push") ||
    shortcutForcePushMutatingCount > 0
  const pulling =
    (gitActionMutation.isPending && gitActionMutation.variables === "pull") ||
    shortcutPullMutatingCount > 0
  const gitActionBusy =
    gitActionMutation.isPending || pushing || forcePushing || pulling
  const showCommitAction = Boolean(
    isMobile && viewerContextId && normalizedCwd && hasChanges
  )
  const showPushAction = Boolean(
    isMobile &&
    viewerContextId &&
    normalizedCwd &&
    canPush &&
    (!gitActionBusy || pushing)
  )
  const showForcePushAction = Boolean(
    isMobile &&
    viewerContextId &&
    normalizedCwd &&
    canForcePush &&
    (!gitActionBusy || forcePushing)
  )
  const showPullAction = Boolean(
    isMobile &&
    viewerContextId &&
    normalizedCwd &&
    canPull &&
    (!gitActionBusy || pulling)
  )
  const showActions =
    showCommitAction || showPushAction || showForcePushAction || showPullAction

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
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

      {showActions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 md:hidden">
          {showCommitAction ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon /> Commit…
              </Button>
            </TitleTooltip>
          ) : null}
          {showPushAction ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="outline"
                size="xs"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("push")
                }}
              >
                {pushing ? <Spinner /> : <UploadIcon />}
                Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showForcePushAction ? (
            <TitleTooltip
              title="Force push"
              kbd={formatShortcutLabel("Control+Shift+P")}
            >
              <Button
                variant="outline"
                size="xs"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("force-push")
                }}
              >
                {forcePushing ? <Spinner /> : <UploadIcon />}
                Force Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showPullAction ? (
            <TitleTooltip title="Pull" kbd={formatShortcutLabel("Alt+P")}>
              <Button
                variant="outline"
                size="xs"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("pull")
                }}
              >
                {pulling ? <Spinner /> : <DownloadIcon />}
                Pull
              </Button>
            </TitleTooltip>
          ) : null}
        </div>
      ) : null}

      <GitCommitDialog
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        files={files}
        gitStatus={gitStatus}
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
      />
    </div>
  )
}

type GitCommitCommand = {
  id: string
  title: string
  description: string
  keywords: Array<string>
  valueLabel?: string
  disabled?: boolean
  onSelect: () => void | Promise<void>
}

function gitCommitCommandKeywords(command: GitCommitCommand) {
  return [
    command.title,
    command.description,
    command.valueLabel ?? "",
    ...command.keywords,
  ]
}

function GitCommitDialog({
  viewerContextId,
  cwd,
  files,
  gitStatus,
  open,
  onOpenChange,
}: {
  viewerContextId: string
  cwd: string
  files: Array<GitChangeFile>
  gitStatus: GitStatusValue | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [message, setMessage] = React.useState("")
  const [includeUnstaged, setIncludeUnstaged] = React.useState(true)
  const [generatedReason, setGeneratedReason] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [selectedCommandId, setSelectedCommandId] = React.useState("commit")
  const [stage, setStage] = React.useState<"browse" | "message">("browse")
  const [pendingRun, setPendingRun] = React.useState<
    "commit" | "push" | "force-push" | null
  >(null)
  const blockNextCloseRef = React.useRef(false)
  const fileSummary = `${files.length} file${files.length === 1 ? "" : "s"}`
  const lineSummary = gitFilesLineSummary(files)
  const branchName = gitStatus?.detached
    ? `Detached ${gitStatus.revision || "HEAD"}`
    : gitStatus?.branch || "Unknown branch"
  const canForcePush = gitStatusHasDiverged(gitStatus)

  const generateMutation = useMutation({
    mutationFn: async () =>
      await fetchJson<GitCommitMessageData>(
        buildRequestUrl("/api/git-commit-message", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ),
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to generate commit message"))
    },
  })

  const commitMutation = useMutation({
    mutationFn: async ({
      push,
      forcePush,
      commitMessage,
    }: {
      push: boolean
      forcePush: boolean
      commitMessage: string
    }) =>
      await fetchJson<GitCommitResponse>(
        buildRequestUrl("/api/git-commit", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd,
            message: commitMessage,
            push,
            forcePush,
            includeUnstaged,
          }),
        }
      ),
    onSuccess: async () => {
      setMessage("")
      setGeneratedReason("")
      onOpenChange(false)
      await invalidateGitQueries({ queryClient, viewerContextId, cwd })
    },
    onError: (error, variables) => {
      toast.error(
        getErrorMessage(
          error,
          variables.forcePush
            ? "Failed to commit and force push changes"
            : variables.push
              ? "Failed to commit and push changes"
              : "Failed to commit changes"
        )
      )
    },
    onSettled: () => {
      setPendingRun(null)
    },
  })

  const committing = commitMutation.isPending
  const generating = generateMutation.isPending
  const busy = committing || generating

  React.useEffect(() => {
    if (!open) {
      if (query) setQuery("")
      setStage("browse")
    }
  }, [open, query])

  const applyGeneratedMessage = (generated: GitCommitMessageData) => {
    setMessage(generated.message)
    setGeneratedReason(generated.reason || "")
    if (generated.source !== "ai" && generated.reason) {
      toast.info(`Using heuristic message: ${generated.reason}`)
    }
  }

  const generateCommitMessage = () => {
    if (busy || !cwd || files.length === 0) return

    generateMutation.mutate(undefined, {
      onSuccess: applyGeneratedMessage,
    })
  }

  const continueCommit = async (push: boolean, forcePush = false) => {
    if (busy || files.length === 0) return

    setPendingRun(forcePush ? "force-push" : push ? "push" : "commit")

    let commitMessage = message.trim()
    if (!commitMessage) {
      try {
        const generated = await generateMutation.mutateAsync()
        commitMessage = generated.message.trim()
        applyGeneratedMessage(generated)
      } catch {
        setPendingRun(null)
        return
      }
    }

    if (!commitMessage) {
      setPendingRun(null)
      return
    }
    commitMutation.mutate({
      push,
      forcePush,
      commitMessage,
    })
  }

  const openCommitMessage = () => {
    setQuery("")
    setStage("message")
  }

  const returnToCommitActions = () => {
    blockNextCloseRef.current = true
    setStage("browse")
  }

  const commandGroups: Array<{
    heading: string
    commands: Array<GitCommitCommand>
  }> = [
    {
      heading: "Run",
      commands: [
        {
          id: "commit",
          title: "Commit",
          description: message.trim()
            ? "Commit with the current message."
            : "Generate a message automatically, then commit.",
          keywords: ["continue", "run", "save", "stage", "git"],
          valueLabel: "Commit",
          disabled: busy || files.length === 0,
          onSelect: () => continueCommit(false),
        },
        {
          id: "commit-push",
          title: "Commit and push",
          description: message.trim()
            ? "Commit with the current message, then push."
            : "Generate a message automatically, then commit and push.",
          keywords: ["continue", "run", "save", "stage", "git", "push"],
          valueLabel: "Push",
          disabled: busy || files.length === 0,
          onSelect: () => continueCommit(true),
        },
        ...(canForcePush
          ? [
              {
                id: "commit-force-push",
                title: "Commit and force push",
                description: message.trim()
                  ? "Commit with the current message, then force push with --force-with-lease."
                  : "Generate a message automatically, then commit and force push with --force-with-lease.",
                keywords: [
                  "continue",
                  "run",
                  "save",
                  "stage",
                  "git",
                  "push",
                  "force",
                  "lease",
                ],
                valueLabel: "Force push",
                disabled: busy || files.length === 0,
                onSelect: () => continueCommit(true, true),
              },
            ]
          : []),
      ],
    },
    {
      heading: "Message",
      commands: [
        {
          id: "edit-message",
          title: "Edit commit message",
          description: message.trim()
            ? message.trim()
            : "Leave it blank to autogenerate before committing.",
          keywords: ["message", "subject", "body", "focus", "edit"],
          valueLabel: message.trim() ? "Custom" : "Blank",
          disabled: busy,
          onSelect: openCommitMessage,
        },
      ],
    },
    {
      heading: "Options",
      commands: [
        {
          id: "include-unstaged",
          title: "Include unstaged changes",
          description: "Stage unstaged files before committing.",
          keywords: ["stage", "unstaged", "files", "working tree"],
          valueLabel: includeUnstaged ? "On" : "Off",
          disabled: busy,
          onSelect: () => setIncludeUnstaged(!includeUnstaged),
        },
      ],
    },
  ]

  const commandBrowseBody = (
    <Command
      shouldFilter
      loop
      value={selectedCommandId}
      onValueChange={setSelectedCommandId}
      onKeyDown={(event) => {
        if (matchesShortcutEvent(event.nativeEvent, "Control+Enter")) {
          event.preventDefault()
          void continueCommit(false)
        }
      }}
      className="min-h-0 flex-1 rounded-none md:rounded-xl"
    >
      <CommandInput
        autoFocus={!isMobile}
        value={query}
        onValueChange={setQuery}
        placeholder="Search commit actions"
        className="text-base md:text-sm"
      />
      <div className="grid gap-3 px-3 py-4 text-sm md:px-4 md:text-base">
        <div className="grid gap-3">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-4">
            <div className="font-semibold">Branch</div>
            <div className="flex min-w-0 items-center gap-3 text-muted-foreground">
              <GitBranchIcon className="size-5 shrink-0" />
              <span className="truncate font-medium text-foreground">
                {branchName}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-4">
            <div className="font-semibold">Changes</div>
            <div className="flex min-w-0 items-center gap-3 text-muted-foreground tabular-nums">
              <span className="shrink-0">{fileSummary}</span>
              {lineSummary ? (
                <span>
                  <span className="text-emerald-500">
                    {lineSummary.split(" ")[0]}
                  </span>{" "}
                  <span className="text-red-500">
                    {lineSummary.split(" ")[1]}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(50vh,24rem)]">
        <CommandEmpty>No commit actions found.</CommandEmpty>
        {commandGroups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.commands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                keywords={gitCommitCommandKeywords(command)}
                disabled={command.disabled}
                onSelect={() => {
                  void Promise.resolve(command.onSelect()).catch(
                    (error: unknown) => {
                      toast.error(
                        getErrorMessage(error, "Failed to run commit action")
                      )
                    }
                  )
                }}
                className="items-start py-2"
              >
                {command.id === "commit" ? (
                  pendingRun === "commit" ? (
                    <Spinner />
                  ) : (
                    <GitCommitIcon />
                  )
                ) : command.id === "commit-push" ? (
                  pendingRun === "push" ? (
                    <Spinner />
                  ) : (
                    <UploadIcon />
                  )
                ) : command.id === "commit-force-push" ? (
                  pendingRun === "force-push" ? (
                    <Spinner />
                  ) : (
                    <UploadIcon />
                  )
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{command.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </div>
                {command.valueLabel ? (
                  <CommandShortcut className="inline shrink-0 tracking-normal normal-case">
                    {command.valueLabel}
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
        Use ↑/↓ to select, Enter to run, Esc to close. Press{" "}
        {formatShortcutLabel("Control+Enter")} to continue.
      </div>
    </Command>
  )

  const commitMessageBody = (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return

        event.preventDefault()
        event.stopPropagation()
        returnToCommitActions()
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={returnToCommitActions}
          aria-label="Back to commit actions"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Commit message</div>
          <div className="truncate text-xs text-muted-foreground">
            Leave blank to autogenerate before committing.
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || !cwd || files.length === 0}
          onClick={generateCommitMessage}
        >
          {generating ? <Spinner /> : <WandSparklesIcon />}
          Generate
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <Textarea
          autoFocus={!isMobile}
          id="git-commit-message"
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setGeneratedReason("")
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              returnToCommitActions()
              return
            }

            if (matchesShortcutEvent(event.nativeEvent, "Control+G")) {
              event.preventDefault()
              event.stopPropagation()
              generateCommitMessage()
              return
            }

            if (matchesShortcutEvent(event.nativeEvent, "Control+Enter")) {
              event.preventDefault()
              event.stopPropagation()
              void continueCommit(false)
            }
          }}
          placeholder="Leave blank to autogenerate a commit message"
          className="min-h-40 flex-1 resize-none rounded-xl bg-muted/20 px-4 py-3 text-base"
          disabled={busy}
        />
        {generatedReason ? (
          <p className="text-xs text-muted-foreground">
            AI message unavailable, using heuristic fallback: {generatedReason}
          </p>
        ) : null}
      </div>
      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
        <span>{formatShortcutLabel("Control+G")} Generate</span>
        <span>{formatShortcutLabel("Control+Enter")} Continue</span>
        <span>Esc Back</span>
      </div>
    </div>
  )

  const body = stage === "message" ? commitMessageBody : commandBrowseBody
  const handleSurfaceOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (stage === "message" || blockNextCloseRef.current)) {
      blockNextCloseRef.current = false
      setStage("browse")
      return
    }

    onOpenChange(nextOpen)
  }

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={handleSurfaceOpenChange}
        autoFocus={false}
      >
        <DrawerContent className="max-h-[92svh] overflow-hidden">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Commit your changes</DrawerTitle>
            <DrawerDescription>
              Stage and commit changes in this repository.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleSurfaceOpenChange}
      title="Commit your changes"
      description="Search commit actions, edit the message, and choose whether to push."
      className="sm:max-w-2xl"
      initialFocus
    >
      {body}
    </CommandDialog>
  )
}

export const GitCommitDialogController = React.forwardRef<
  GitCommitDialogControllerHandle,
  {
    viewerContextId: string
    cwd?: string
    openStateRef: React.RefObject<boolean>
  }
>(function GitCommitDialogControllerImpl(
  { viewerContextId, cwd, openStateRef },
  ref
) {
  const normalizedCwd = normalizeCwd(cwd)
  const [open, setOpen] = React.useState(false)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(open && viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(open && viewerContextId && normalizedCwd),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : []

  const setDialogOpen = React.useCallback(
    (nextOpen: boolean) => {
      openStateRef.current = nextOpen
      setOpen(nextOpen)
    },
    [openStateRef]
  )

  React.useEffect(() => {
    openStateRef.current = open
  }, [open, openStateRef])

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!viewerContextId || !normalizedCwd) {
          toast.error("Open a session in a repository before committing.")
          return
        }

        setDialogOpen(true)
      },
      close: () => {
        setDialogOpen(false)
      },
      isOpen: () => openStateRef.current,
    }),
    [normalizedCwd, openStateRef, setDialogOpen, viewerContextId]
  )

  return (
    <GitCommitDialog
      viewerContextId={viewerContextId}
      cwd={normalizedCwd}
      files={files}
      gitStatus={statusQuery.data}
      open={open}
      onOpenChange={setDialogOpen}
    />
  )
})

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

const GIT_FILE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: var(--background);
    --trees-fg-override: var(--foreground);
    --trees-border-color-override: var(--border);
    --trees-muted-fg-override: var(--muted-foreground);
    --trees-selected-bg-override: var(--accent);
    --trees-selected-fg-override: var(--accent-foreground);
    --trees-padding-inline-override: 0px;
  }
`

function ProjectFileTree({
  paths,
  selectedPath,
  onSelectFile,
}: {
  paths: Array<string>
  selectedPath: string
  onSelectFile: (path: string) => void
}) {
  const validPathsRef = React.useRef(new Set(paths))
  const onSelectFileRef = React.useRef(onSelectFile)
  validPathsRef.current = new Set(paths)
  onSelectFileRef.current = onSelectFile

  const { model } = useFileTree({
    paths,
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange: (selectedPaths) => {
      const [path] = selectedPaths
      if (!path || !validPathsRef.current.has(path)) return
      onSelectFileRef.current(path)
    },
    search: true,
    unsafeCSS: GIT_FILE_TREE_UNSAFE_CSS,
  })

  React.useEffect(() => {
    model.resetPaths(paths)
  }, [model, paths])

  React.useEffect(() => {
    if (!selectedPath) return
    const item = model.getItem(selectedPath)
    if (!item) return
    item.select()
    item.focus()
  }, [model, selectedPath])

  const openFocusedFile = () => {
    window.requestAnimationFrame(() => {
      const path = model.getFocusedPath()
      if (!path || !validPathsRef.current.has(path)) return
      onSelectFileRef.current(path)
    })
  }

  return (
    <PierreFileTree
      model={model}
      className="block h-full min-h-0 w-full overflow-hidden"
      onClick={openFocusedFile}
      onKeyUp={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        openFocusedFile()
      }}
    />
  )
}

type ProjectFilesPreviewMode = "external" | "inline"

function ProjectFilesWorkspace({
  viewerContextId,
  cwd,
  active,
  activeFilePath,
  onCloseFile,
  onOpenFile,
  previewMode = "external",
}: GitScopedProps & {
  activeFilePath: string
  onCloseFile?: () => void
  onOpenFile: (path: string) => void
  previewMode?: ProjectFilesPreviewMode
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const [openFileDialogOpen, setOpenFileDialogOpen] = React.useState(false)
  const showInlinePreview = previewMode === "inline" && Boolean(activeFilePath)
  const fileTreeQuery = useQuery({
    ...projectFileTreeQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: (data) => data.paths,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const paths = fileTreeQuery.data ?? []
  const canOpenFile = paths.length > 0

  const renderOpenFileDialogButton = () => (
    <Button
      variant="outline"
      size="sm"
      disabled={!canOpenFile}
      onClick={() => {
        setOpenFileDialogOpen(true)
      }}
    >
      Open File
    </Button>
  )

  return (
    <div
      className={cn(
        "h-full min-h-0 overflow-hidden",
        showInlinePreview
          ? "grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
          : "flex flex-col"
      )}
    >
      <div
        className={cn(
          "flex min-h-0 flex-col bg-background",
          showInlinePreview
            ? "border-b border-border/70"
            : "flex-1 overflow-hidden"
        )}
      >
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 text-xs font-medium text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">File tree</span>
            {paths.length ? <span>{paths.length}</span> : null}
          </div>
          {renderOpenFileDialogButton()}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          {!normalizedCwd ? (
            <GitSectionNote>No directory selected.</GitSectionNote>
          ) : !viewerContextId ? (
            <GitSectionNote>Waiting for viewer context…</GitSectionNote>
          ) : fileTreeQuery.isPending &&
            typeof fileTreeQuery.data === "undefined" ? (
            <GitSectionNote>
              <Spinner /> Loading files…
            </GitSectionNote>
          ) : fileTreeQuery.error ? (
            <GitSectionNote tone="destructive">
              {getErrorMessage(fileTreeQuery.error, "Failed to load files")}
            </GitSectionNote>
          ) : paths.length > 0 ? (
            <ProjectFileTree
              paths={paths}
              selectedPath={activeFilePath}
              onSelectFile={onOpenFile}
            />
          ) : (
            <GitSectionNote>No files found.</GitSectionNote>
          )}
        </div>
      </div>
      {showInlinePreview ? (
        <div className="flex min-h-0 flex-col overflow-hidden bg-background">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 text-xs font-medium text-muted-foreground">
            <span className="min-w-0 truncate" title={activeFilePath}>
              {activeFilePath}
            </span>
            <TitleTooltip title="Close file preview">
              <button
                type="button"
                aria-label="Close file preview"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={onCloseFile}
              >
                <XIcon className="size-4" />
              </button>
            </TitleTooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ProjectFileContent
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active}
              path={activeFilePath}
            />
          </div>
        </div>
      ) : null}
      <ProjectOpenFileDialog
        open={openFileDialogOpen}
        onOpenChange={setOpenFileDialogOpen}
        paths={paths}
        onOpenFile={onOpenFile}
      />
    </div>
  )
}

function ProjectOpenFileDialog({
  open,
  onOpenChange,
  paths,
  onOpenFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  paths: Array<string>
  onOpenFile: (path: string) => void
}) {
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search files…"
        />
        <CommandList>
          <CommandEmpty>No files found.</CommandEmpty>
          <CommandGroup heading="Files">
            {paths.map((path) => (
              <CommandItem
                key={path}
                value={path}
                keywords={[path]}
                onSelect={() => {
                  onOpenFile(path)
                  onOpenChange(false)
                }}
              >
                <span className="min-w-0 truncate font-mono text-xs">
                  {path}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function ProjectFileContent({
  viewerContextId,
  cwd,
  active,
  path,
}: GitScopedProps & {
  path: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const fileQuery = useQuery({
    ...projectFileReadQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      path,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd && path),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const content = fileQuery.data?.content ?? ""
  const language = codeLanguageFromPath(path)
  const [highlighted, setHighlighted] =
    React.useState<HighlightResponse | null>(null)

  React.useEffect(() => {
    let cancelled = false

    if (!active || !content || !language) {
      setHighlighted(null)
      return
    }

    setHighlighted(null)
    void getHighlightedProjectFile(content, language)
      .then((payload) => {
        if (!cancelled) setHighlighted(payload)
      })
      .catch(() => {
        if (!cancelled) setHighlighted({ ok: true, unavailable: true })
      })

    return () => {
      cancelled = true
    }
  }, [active, content, language])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a file to preview it.
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-auto bg-background">
      {fileQuery.isPending && !fileQuery.data ? (
        <div className="p-4">
          <GitSectionNote>
            <Spinner /> Loading file…
          </GitSectionNote>
        </div>
      ) : fileQuery.error ? (
        <div className="p-4">
          <GitSectionNote tone="destructive">
            {getErrorMessage(fileQuery.error, "Failed to load file")}
          </GitSectionNote>
        </div>
      ) : hasHighlightHtml(highlighted) ? (
        <pre className="m-0 min-h-full p-4 font-mono text-[13px] leading-5 whitespace-pre-wrap text-foreground">
          <code
            className={cn(language && `language-${language}`)}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: syntax highlighting HTML is generated by sugar-high
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        </pre>
      ) : (
        <pre className="m-0 min-h-full p-4 font-mono text-[13px] leading-5 whitespace-pre-wrap text-foreground">
          <code>{content}</code>
        </pre>
      )}
    </div>
  )
}

type RightSidebarTabValue = "branches" | "files" | "history" | "review"

function RightSidebarTabStrip({
  activeTab,
  onActiveTabChange,
  showReview = false,
}: {
  activeTab: RightSidebarTabValue
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  showReview?: boolean
}) {
  const renderTab = ({
    label,
    value,
  }: {
    label: string
    value: RightSidebarTabValue
  }) => {
    const active = activeTab === value
    return (
      <button
        key={value}
        type="button"
        aria-pressed={active}
        className={cn(
          "inline-flex h-7 shrink-0 items-center rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          active && "bg-muted text-foreground"
        )}
        onClick={() => {
          onActiveTabChange(value)
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-background px-2">
      {showReview ? renderTab({ label: "Review", value: "review" }) : null}
      {renderTab({ label: "Files", value: "files" })}
      {renderTab({ label: "Branches", value: "branches" })}
      {renderTab({ label: "History", value: "history" })}
    </div>
  )
}

function FileViewerTabStrip({
  activeFilePath,
  fileTabs,
  onActiveFileChange,
  onCloseFile,
  onOpenFileDialog,
  reviewCount,
}: {
  activeFilePath: string
  fileTabs: Array<string>
  onActiveFileChange: (path: string) => void
  onCloseFile: (path: string) => void
  onOpenFileDialog: () => void
  reviewCount: number
}) {
  const reviewActive = !activeFilePath

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-background px-2">
      <button
        type="button"
        aria-pressed={reviewActive}
        className={cn(
          "inline-flex h-7 shrink-0 items-center rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          reviewActive && "bg-muted text-foreground"
        )}
        onClick={() => {
          onActiveFileChange("")
        }}
      >
        Review{reviewCount > 0 ? ` ${reviewCount}` : ""}
      </button>
      {fileTabs.map((path) => {
        const active = activeFilePath === path
        return (
          <div
            key={path}
            className={cn(
              "inline-flex h-7 max-w-56 shrink-0 items-center rounded-md border border-transparent text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted text-foreground"
            )}
          >
            <button
              type="button"
              title={path}
              className="min-w-0 flex-1 px-2 text-left"
              onClick={() => {
                onActiveFileChange(path)
              }}
            >
              <span className="block min-w-0 truncate">{path}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${path}`}
              className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                onCloseFile(path)
              }}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )
      })}
      <TitleTooltip title="Open another file">
        <button
          type="button"
          aria-label="Open another file"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onOpenFileDialog}
        >
          +
        </button>
      </TitleTooltip>
    </div>
  )
}

type ReviewDiffStyle = "unified" | "split"

function reviewFileValue(file: GitChangeFile) {
  return `${file.status}:${file.previousPath || ""}:${file.path}`
}

function gitFileChangedLineCount(file: GitChangeFile) {
  return (
    gitFileLineChangeValue(file.linesAdded) +
    gitFileLineChangeValue(file.linesDeleted)
  )
}

function gitFileShouldPreviewPatch(file: GitChangeFile) {
  return (
    (typeof file.sizeBytes === "number" &&
      file.sizeBytes > GIT_REVIEW_FULL_CONTEXT_SIZE_THRESHOLD_BYTES) ||
    gitFileChangedLineCount(file) >
      GIT_REVIEW_FULL_CONTEXT_CHANGED_LINE_THRESHOLD
  )
}

function FileReviewContent({ viewerContextId, cwd, active }: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const [diffStyle, setDiffStyle] = React.useState<ReviewDiffStyle>("unified")
  const [openFiles, setOpenFiles] = React.useState<Array<string>>([])
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
  const changedFiles = Array.isArray(files) ? files : []
  const meta = changedFiles.length > 0 ? gitFilesSummaryText(changedFiles) : ""

  React.useEffect(() => {
    setOpenFiles([])
  }, [normalizedCwd])

  const hasOpenFile = openFiles.length > 0
  const toggleAll = () => {
    setOpenFiles(hasOpenFile ? [] : changedFiles.map(reviewFileValue))
  }

  return (
    <div className="h-full min-h-0 overflow-auto bg-background p-3">
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span>Git changes</span>
          {meta ? (
            <span className="text-xs font-medium text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            variant="outline"
            value={[diffStyle]}
            onValueChange={(values) => {
              const value = values[0]
              if (value === "unified" || value === "split") {
                setDiffStyle(value)
              }
            }}
          >
            {(["unified", "split"] as const).map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="text-xs font-medium"
              >
                {value === "unified" ? "Unified" : "Split"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            disabled={changedFiles.length === 0}
            className="h-8 gap-2"
            onClick={toggleAll}
          >
            <ChevronsUpDownIcon className="size-4" />
            {hasOpenFile ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      </div>
      {!normalizedCwd ? (
        <GitSectionNote>No directory selected.</GitSectionNote>
      ) : !viewerContextId ? (
        <GitSectionNote>Waiting for viewer context…</GitSectionNote>
      ) : filesQuery.isPending && typeof files === "undefined" ? (
        <GitSectionNote>
          <Spinner /> Loading changes…
        </GitSectionNote>
      ) : filesQuery.error ? (
        <GitSectionNote tone="destructive">
          {getErrorMessage(filesQuery.error, "Failed to load changes")}
        </GitSectionNote>
      ) : files === null ? (
        <GitSectionNote>No git repository detected.</GitSectionNote>
      ) : changedFiles.length > 0 ? (
        <Accordion
          multiple
          value={openFiles}
          onValueChange={setOpenFiles}
          className="overflow-hidden rounded-xl border border-border/80"
        >
          {changedFiles.map((file) => (
            <ReviewFileAccordionItem
              key={reviewFileValue(file)}
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active}
              diffStyle={diffStyle}
              file={file}
              open={openFiles.includes(reviewFileValue(file))}
            />
          ))}
        </Accordion>
      ) : (
        <GitSectionNote>Working tree clean.</GitSectionNote>
      )}
    </div>
  )
}

function ReviewFileAccordionItem({
  viewerContextId,
  cwd,
  active,
  diffStyle,
  file,
  open,
}: GitScopedProps & {
  diffStyle: ReviewDiffStyle
  file: GitChangeFile
  open: boolean
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const value = reviewFileValue(file)
  const [fullContextRequested, setFullContextRequested] = React.useState(false)
  const previewPatch = gitFileShouldPreviewPatch(file) && !fullContextRequested
  const diffQuery = useQuery({
    ...gitFileDiffQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      path: file.path,
    }),
    enabled: Boolean(
      previewPatch && open && active && viewerContextId && normalizedCwd
    ),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const reviewQuery = useQuery({
    ...gitFileReviewQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      path: file.path,
      previousPath: file.previousPath,
    }),
    enabled: Boolean(
      !previewPatch && open && active && viewerContextId && normalizedCwd
    ),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const oldContent = reviewQuery.data?.oldContent ?? ""
  const newContent = reviewQuery.data?.newContent ?? ""
  const patch = diffQuery.data?.patch ?? ""

  React.useEffect(() => {
    setFullContextRequested(false)
  }, [value])

  return (
    <AccordionItem value={value} className="border-border/70">
      <AccordionTrigger className="min-h-10 items-center gap-3 rounded-none px-3 py-2 font-mono text-[13px] hover:no-underline">
        <span className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3">
          <GitFileStatus status={file.status} />
          <span className="min-w-0 truncate text-left">
            {file.previousPath ? (
              <>
                <span className="text-muted-foreground">
                  {file.previousPath}
                </span>
                <span className="text-muted-foreground/70"> → </span>
                <span>{file.path}</span>
              </>
            ) : (
              file.path
            )}
          </span>
          <GitFileDiff file={file} />
        </span>
      </AccordionTrigger>
      <AccordionContent className="border-t border-border/70 bg-background p-0">
        {previewPatch ? (
          diffQuery.isPending && !diffQuery.data ? (
            <div className="p-3">
              <GitSectionNote>
                <Spinner /> Loading hunk…
              </GitSectionNote>
            </div>
          ) : diffQuery.error ? (
            <div className="p-3">
              <GitSectionNote tone="destructive">
                {getErrorMessage(diffQuery.error, "Failed to load hunk")}
              </GitSectionNote>
            </div>
          ) : patch ? (
            <div>
              <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground">
                <span>Showing changed hunks only for this large change.</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => {
                    setFullContextRequested(true)
                  }}
                >
                  Load full context
                </Button>
              </div>
              <PatchDiff
                patch={patch}
                disableWorkerPool
                options={{
                  diffStyle,
                  disableFileHeader: true,
                  overflow: "wrap",
                }}
              />
            </div>
          ) : (
            <div className="p-3">
              <GitSectionNote>No line changes.</GitSectionNote>
            </div>
          )
        ) : reviewQuery.isPending && !reviewQuery.data ? (
          <div className="p-3">
            <GitSectionNote>
              <Spinner /> Loading hunk…
            </GitSectionNote>
          </div>
        ) : reviewQuery.error ? (
          <div className="p-3">
            <GitSectionNote tone="destructive">
              {getErrorMessage(reviewQuery.error, "Failed to load hunk")}
            </GitSectionNote>
          </div>
        ) : oldContent !== newContent ? (
          <MultiFileDiff
            oldFile={{
              name: file.previousPath || file.path,
              contents: oldContent,
            }}
            newFile={{
              name: file.path,
              contents: newContent,
            }}
            disableWorkerPool
            options={{
              diffStyle,
              disableFileHeader: true,
              overflow: "wrap",
            }}
          />
        ) : (
          <div className="p-3">
            <GitSectionNote>No line changes.</GitSectionNote>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

export function GitFileViewerPanel({
  viewerContextId,
  cwd,
  active,
  activeFilePath,
  fileTabs,
  onActiveFileChange,
  onCloseFile,
  onOpenFile,
}: {
  viewerContextId: string
  cwd?: string
  active: boolean
  activeFilePath: string
  fileTabs: Array<string>
  onActiveFileChange: (path: string) => void
  onCloseFile: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const [openFileDialogOpen, setOpenFileDialogOpen] = React.useState(false)
  const fileTreeQuery = useQuery({
    ...projectFileTreeQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: (data) => data.paths,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const reviewFilesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const paths = fileTreeQuery.data ?? []
  const reviewCount = Array.isArray(reviewFilesQuery.data)
    ? reviewFilesQuery.data.length
    : 0

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/50">
      <FileViewerTabStrip
        activeFilePath={activeFilePath}
        fileTabs={fileTabs}
        onActiveFileChange={onActiveFileChange}
        onCloseFile={onCloseFile}
        onOpenFileDialog={() => {
          setOpenFileDialogOpen(true)
        }}
        reviewCount={reviewCount}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeFilePath ? (
          <ProjectFileContent
            viewerContextId={viewerContextId}
            cwd={normalizedCwd}
            active={active}
            path={activeFilePath}
          />
        ) : (
          <FileReviewContent
            viewerContextId={viewerContextId}
            cwd={normalizedCwd}
            active={active}
          />
        )}
      </div>
      <ProjectOpenFileDialog
        open={openFileDialogOpen}
        onOpenChange={setOpenFileDialogOpen}
        paths={paths}
        onOpenFile={onOpenFile}
      />
    </div>
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
      <ToggleGroup
        variant="outline"
        size="sm"
        value={[branchScope]}
        onValueChange={(values) => {
          const value = values[0]
          if (value === "local" || value === "remote") {
            setBranchScope(value)
          }
        }}
      >
        {(
          [
            ["local", "Local"],
            ["remote", "Remote"],
          ] as const
        ).map(([value, label]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="text-xs font-semibold"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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

function GitBranchesSection({
  viewerContextId,
  cwd,
  active,
  flush = false,
}: GitScopedProps & {
  flush?: boolean
}) {
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

  const controls = (
    <GitBranchesControls
      branchScope={branchScope}
      countLabel={countLabel}
      setBranchScope={setBranchScope}
    />
  )
  const content = !normalizedCwd ? (
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
  )

  if (flush) {
    return (
      <section className="min-h-full bg-background">
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-3">
          <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
            Branches
          </div>
          <div className="shrink-0">{controls}</div>
        </div>
        <div className="grid gap-2 px-3 py-2.5">{content}</div>
      </section>
    )
  }

  return (
    <GitSection title="Branches" controls={controls}>
      {content}
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

function GitCommitsSection({
  viewerContextId,
  cwd,
  active,
  flush = false,
}: GitScopedProps & {
  flush?: boolean
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const [commitsLimit, setCommitsLimit] = React.useState(GIT_COMMITS_PAGE_SIZE)
  React.useEffect(() => {
    setCommitsLimit(GIT_COMMITS_PAGE_SIZE)
  }, [normalizedCwd])
  const commitsQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
      commitsLimit,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    notifyOnChangeProps: ["data", "isFetching", "isPending", "error"],
  })
  const commitsData = commitsQuery.data
  const commits = commitsData?.commits
  const commitsHasMore = Boolean(commitsData?.commitsHasMore)
  const meta = Array.isArray(commits) ? gitCommitsSummaryText(commits) : ""
  const unpushedCommitShortHashes = new Set(
    commitsData?.unpushedCommitShortHashes ?? []
  )

  const content = !normalizedCwd ? (
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
    <div className="grid min-w-max gap-3">
      <div className="grid gap-0.5">
        {commits.map((line, index) => (
          <GitCommitRow
            key={`${index}:${line}`}
            line={line}
            unpushedCommitShortHashes={unpushedCommitShortHashes}
          />
        ))}
      </div>
      {commitsHasMore ? (
        <button
          type="button"
          className="inline-flex h-8 w-fit items-center justify-center rounded-md border border-border/80 bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={commitsQuery.isFetching}
          onClick={() => {
            setCommitsLimit((value) => value + GIT_COMMITS_PAGE_SIZE)
          }}
        >
          {commitsQuery.isFetching ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  ) : (
    <GitSectionNote>No commits on this branch yet.</GitSectionNote>
  )

  if (flush) {
    return (
      <section className="min-h-full overflow-x-auto bg-background">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
              History
            </div>
            {meta ? (
              <div className="min-w-0 truncate text-xs text-muted-foreground/80">
                {meta}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid gap-2 overflow-x-auto px-3 py-2.5">{content}</div>
      </section>
    )
  }

  return (
    <GitSection
      title="Commits"
      meta={meta}
      className="overflow-x-auto"
      bodyClassName="overflow-x-auto"
    >
      {content}
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
    select: (data) =>
      data.gitStatus === null
        ? "Files"
        : formatGitWorkingTreeSummary(data.gitStatus) || "Changes",
    notifyOnChangeProps: ["data"],
  })
  const text = statusQuery.data || "Changes"

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

  return (
    <span
      className="inline-flex items-center text-xs text-muted-foreground"
      title={statusQuery.data?.title || text}
    >
      <span>{text}</span>
    </span>
  )
}

export function HeaderGitActions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const queryClient = useQueryClient()
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const gitStatus = statusQuery.data
  const hasRepository = Boolean(gitStatus)
  const canCommit = Boolean(
    viewerContextId && normalizedCwd && gitStatus?.dirty
  )
  const canPush = Boolean(
    viewerContextId &&
    normalizedCwd &&
    hasRepository &&
    !gitStatus?.detached &&
    (gitStatus?.ahead || 0) > 0
  )
  const canForcePush =
    Boolean(viewerContextId && normalizedCwd) && gitStatusHasDiverged(gitStatus)
  const canPull = Boolean(
    viewerContextId &&
    normalizedCwd &&
    hasRepository &&
    !gitStatus?.detached &&
    (gitStatus?.behind || 0) > 0
  )
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(canCommit),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : []

  const gitActionMutation = useMutation({
    mutationFn: async (action: GitRemoteAction) => {
      const endpoint = action === "pull" ? "/api/git-pull" : "/api/git-push"
      return await fetchJson<GitActionResponse>(
        buildRequestUrl(endpoint, { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: normalizedCwd,
            force: action === "force-push",
          }),
        }
      )
    },
    onSuccess: async () => {
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
    },
    onError: (error, action) => {
      toast.error(
        getErrorMessage(
          error,
          action === "pull"
            ? "Failed to pull changes"
            : action === "force-push"
              ? "Failed to force push changes"
              : "Failed to push changes"
        )
      )
    },
  })

  const shortcutPushMutatingCount = useIsMutating({
    mutationKey: phiQueryKeys.gitAction(viewerContextId, normalizedCwd, "push"),
  })
  const shortcutForcePushMutatingCount = useIsMutating({
    mutationKey: phiQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "force-push"
    ),
  })
  const shortcutPullMutatingCount = useIsMutating({
    mutationKey: phiQueryKeys.gitAction(viewerContextId, normalizedCwd, "pull"),
  })
  const pushing =
    (gitActionMutation.isPending && gitActionMutation.variables === "push") ||
    shortcutPushMutatingCount > 0
  const forcePushing =
    (gitActionMutation.isPending &&
      gitActionMutation.variables === "force-push") ||
    shortcutForcePushMutatingCount > 0
  const pulling =
    (gitActionMutation.isPending && gitActionMutation.variables === "pull") ||
    shortcutPullMutatingCount > 0
  const gitActionBusy =
    gitActionMutation.isPending || pushing || forcePushing || pulling
  const showPush = !isMobile && canPush && (!gitActionBusy || pushing)
  const showForcePush =
    !isMobile && canForcePush && (!gitActionBusy || forcePushing)
  const showPull = !isMobile && canPull && (!gitActionBusy || pulling)
  const showActions = canCommit || showPush || showForcePush || showPull

  if (!showActions && !commitDialogOpen) return null

  return (
    <>
      {showActions ? (
        <div className="flex items-center gap-1">
          {canCommit ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Commit changes"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon />
              </Button>
            </TitleTooltip>
          ) : null}
          {canCommit ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="ghost"
                size="xs"
                className="hidden md:inline-flex"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon /> Commit…
              </Button>
            </TitleTooltip>
          ) : null}
          {showPush ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="ghost"
                size="xs"
                className="hidden md:inline-flex"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("push")
                }}
              >
                {pushing ? <Spinner /> : <UploadIcon />} Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showForcePush ? (
            <TitleTooltip
              title="Force push"
              kbd={formatShortcutLabel("Control+Shift+P")}
            >
              <Button
                variant="ghost"
                size="xs"
                className="hidden md:inline-flex"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("force-push")
                }}
              >
                {forcePushing ? <Spinner /> : <UploadIcon />} Force Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showPull ? (
            <TitleTooltip title="Pull" kbd={formatShortcutLabel("Alt+P")}>
              <Button
                variant="ghost"
                size="xs"
                className="hidden md:inline-flex"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("pull")
                }}
              >
                {pulling ? <Spinner /> : <DownloadIcon />} Pull
              </Button>
            </TitleTooltip>
          ) : null}
        </div>
      ) : null}
      <GitCommitDialog
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        files={files}
        gitStatus={gitStatus}
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
      />
    </>
  )
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

export function GitPanel({
  viewerContextId,
  cwd,
  active,
  activeFilePath = "",
  onOpenFile,
  showToolbar = true,
}: GitPanelProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = React.useState<RightSidebarTabValue>(() =>
    isMobile ? "review" : "files"
  )
  const [inlineActiveFilePath, setInlineActiveFilePath] = React.useState("")
  const previewMode: ProjectFilesPreviewMode = isMobile ? "inline" : "external"
  const panelHasCardChrome = showToolbar && !isMobile
  const currentFilePath =
    previewMode === "inline" ? inlineActiveFilePath : activeFilePath

  const openFile = (path: string) => {
    if (!path) return
    if (previewMode === "inline") {
      setInlineActiveFilePath(path)
      return
    }
    onOpenFile?.(path)
  }

  React.useEffect(() => {
    setActiveTab(isMobile ? "review" : "files")
    setInlineActiveFilePath("")
  }, [isMobile, normalizedCwd])

  return (
    <div className="h-full min-h-[520px] w-full min-w-0">
      <GitPanelErrorToasts
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
      />
      <div
        className={cn(
          "flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden bg-card/50",
          panelHasCardChrome
            ? "rounded-xl border border-border/80"
            : "rounded-none border-0"
        )}
      >
        {showToolbar ? (
          <div className="shrink-0 border-b border-border/70 bg-background p-2">
            <GitPanelToolbar
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active}
            />
          </div>
        ) : null}
        <RightSidebarTabStrip
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          showReview={isMobile}
        />
        {activeTab === "review" && isMobile ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileReviewContent
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "review"}
            />
          </div>
        ) : activeTab === "branches" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <GitBranchesSection
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "branches"}
              flush
            />
          </div>
        ) : activeTab === "history" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <GitCommitsSection
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "history"}
              flush
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ProjectFilesWorkspace
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "files"}
              activeFilePath={currentFilePath}
              onCloseFile={() => {
                setInlineActiveFilePath("")
              }}
              onOpenFile={openFile}
              previewMode={previewMode}
            />
          </div>
        )}
      </div>
    </div>
  )
}
