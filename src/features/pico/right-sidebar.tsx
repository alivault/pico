import * as React from "react"
import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
  type FileTreeDirectoryHandle,
  type FileTreeItemHandle,
} from "@pierre/trees"
import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core"
import {
  horizontalListSortingStrategy,
  arrayMove,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
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
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronsDownUpIcon,
  CopyIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  GitBranchIcon,
  GitCommitIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SquareArrowOutUpRightIcon,
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { resizeRailPrimaryInteractiveClass } from "@/components/ui/resize-rail"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { showGitPushSuccessToast } from "@/features/pico/git-toast-utils"
import {
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import { picoQueryKeys } from "@/features/pico/query-keys"
import {
  getStuckScrollTriggerValue,
  hasScrolledContent,
  setDerivedScrollState,
} from "@/features/pico/scroll-shadow-utils"
import { useCommandSurfaceAutoFocus } from "@/features/pico/use-command-surface-autofocus"
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
} from "@/lib/pico/api"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  getSidebarVerticalResizeCursor,
  installGlobalResizeCursor,
  type SidebarVerticalResizeCursor,
} from "@/hooks/use-sidebar-resize"
import { cn } from "@/lib/utils"

type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>
type GitCommitMessageData = Extract<GitCommitMessageResponse, { ok: true }>
type GitFileDiffData = Extract<GitFileDiffResponse, { ok: true }>
type GitFileReviewData = Extract<GitFileReviewResponse, { ok: true }>
type ProjectFileTreeData = Extract<ProjectFileTreeResponse, { ok: true }>
type ProjectFileReadData = Extract<ProjectFileReadResponse, { ok: true }>
type GitStatusValue = GitStatusSummary | null
type GitRemoteAction = "push" | "force-push" | "pull"
type OpenProjectFileOptions = { pin?: boolean }

export type RightSidebarTabValue = "files" | "review"

type RightSidebarProps = {
  viewerContextId: string
  cwd?: string
  active: boolean
  activeFilePath?: string
  activeTab?: RightSidebarTabValue
  fileTabs?: Array<string>
  filePreviewPath?: string
  fileTreeCollapsed?: boolean
  onActiveFileChange?: (path: string) => void
  onActiveTabChange?: (tab: RightSidebarTabValue) => void
  onCloseAllFiles?: () => void
  onCloseFile?: (path: string) => void
  onCloseFilesToRight?: (path: string) => void
  onCloseOtherFiles?: (path: string) => void
  onFileTreeCollapsedChange?: (collapsed: boolean) => void
  onOpenFile?: (path: string, options?: OpenProjectFileOptions) => void
  onReorderFiles?: (paths: Array<string>) => void
  showToolbar?: boolean
}

type GitScopedProps = RightSidebarProps

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
const PROJECT_FILE_TREE_DEFAULT_WIDTH = 320
const PROJECT_FILE_TREE_MIN_WIDTH = 220
const PROJECT_FILE_TREE_MAX_WIDTH = 720
const restrictFileTabDragOverlayToHorizontalAxis: Modifier = ({
  transform,
}) => ({
  ...transform,
  y: 0,
})
const FILE_TAB_DRAG_OVERLAY_MODIFIERS = [
  restrictFileTabDragOverlayToHorizontalAxis,
]
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

function projectFileTreeQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: picoQueryKeys.projectFileTree(viewerContextId, cwd),
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
    queryKey: picoQueryKeys.projectFileRead(viewerContextId, cwd, path),
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

type GitFileStatusColumn = "index" | "worktree"

const GIT_CONFLICT_STATUS_DESCRIPTIONS: Record<string, string> = {
  AA: "Conflict: added by both sides",
  AU: "Conflict: added by us",
  DD: "Conflict: deleted by both sides",
  DU: "Conflict: deleted by us",
  UA: "Conflict: added by them",
  UD: "Conflict: deleted by them",
  UU: "Conflict: modified by both sides",
}

function gitFileStatusCharacters(status: string | undefined) {
  const normalized =
    typeof status === "string" ? status.slice(0, 2).padEnd(2, " ") : "  "
  return [normalized[0] ?? " ", normalized[1] ?? " "] as const
}

function gitFileStatusTooltip({
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

function gitFileStatusTone(column: GitFileStatusColumn, character: string) {
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

const GIT_COMMIT_FIELD_SEPARATOR = "\u001f"

function parseGitCommitGraphLine(line: string) {
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

function formatGitCommitDetailTime(value: string) {
  const text = value.trim()
  if (!text) return ""

  const compact = formatGitRelativeDateCompact(text)
  if (!compact || compact === "now" || !/\bago$/i.test(text)) return compact
  return `${compact} ago`
}

function formatGitCommitFullDate(value: string) {
  const text = value.trim()
  if (!text) return ""

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  }).format(date)
}

function gitCommitStatCount(stats: string, kind: "insertions" | "deletions") {
  const pattern =
    kind === "insertions" ? /(\d+) insertions?\(\+\)/ : /(\d+) deletions?\(-\)/
  const match = stats.match(pattern)
  return match ? Number(match[1]) : 0
}

async function copyRightSidebarTextToClipboard(text: string) {
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

async function copyGitCommitValue(text: string) {
  try {
    await copyRightSidebarTextToClipboard(text)
    return true
  } catch (error) {
    toast.error(getErrorMessage(error, "Failed to copy"))
    return false
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
  className,
}: {
  children: React.ReactNode
  tone?: "muted" | "destructive"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center gap-2 text-sm leading-6",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        className
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
  onBranchClick,
}: GitScopedProps & {
  onBranchClick?: () => void
}) {
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
          {onBranchClick ? (
            <button
              type="button"
              aria-label="Switch branch"
              className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onBranchClick}
            >
              <span className="min-w-0 truncate">{branchLabel}</span>
              <ChevronsUpDownIcon className="size-3 shrink-0" />
            </button>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground">
              {branchLabel}
            </span>
          )}
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
  const [branchDialogOpen, setBranchDialogOpen] = React.useState(false)
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
    queryKey: picoQueryKeys.gitStatus(viewerContextId, normalizedCwd),
    exact: true,
  })
  const filesFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitFiles(viewerContextId, normalizedCwd),
    exact: true,
  })
  const branchesFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitBranches(viewerContextId, normalizedCwd),
    exact: true,
  })
  const commitsFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitCommits(viewerContextId, normalizedCwd),
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
    onSuccess: async (response, action) => {
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
      if (action !== "pull") {
        showGitPushSuccessToast({
          response,
          force: action === "force-push",
        })
      }
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
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "push"
    ),
  })
  const shortcutForcePushMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "force-push"
    ),
  })
  const shortcutPullMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "pull"
    ),
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
    viewerContextId && normalizedCwd && hasChanges
  )
  const showPushAction = Boolean(
    viewerContextId && normalizedCwd && canPush && (!gitActionBusy || pushing)
  )
  const showForcePushAction = Boolean(
    viewerContextId &&
    normalizedCwd &&
    canForcePush &&
    (!gitActionBusy || forcePushing)
  )
  const showPullAction = Boolean(
    viewerContextId && normalizedCwd && canPull && (!gitActionBusy || pulling)
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
          onBranchClick={() => {
            setBranchDialogOpen(true)
          }}
        />
        {active && refreshing ? (
          <Spinner className="size-3 shrink-0 text-muted-foreground" />
        ) : null}
      </div>

      {showActions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showCommitAction ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="outline"
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

      <GitBranchDialog
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
        gitStatus={gitStatus}
        open={branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
      />
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
    onSuccess: async (_response, variables) => {
      setMessage("")
      setGeneratedReason("")
      onOpenChange(false)
      await invalidateGitQueries({ queryClient, viewerContextId, cwd })
      toast.success(
        variables.forcePush
          ? "Committed and force pushed changes"
          : variables.push
            ? "Committed and pushed changes"
            : "Committed changes",
        { description: variables.commitMessage }
      )
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
      <div className="grid gap-3 px-3 py-4 text-sm md:px-4">
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
          size="icon"
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
      ).map(([column, character]) => {
        const tooltip = gitFileStatusTooltip({ character, column, status })
        const statusCharacter = (
          <span
            key={column}
            aria-label={tooltip || undefined}
            className={cn(
              "w-[1ch] text-center whitespace-pre",
              tooltip && "cursor-help",
              gitFileStatusToneClass(gitFileStatusTone(column, character))
            )}
          >
            {character}
          </span>
        )

        if (!tooltip) return statusCharacter

        return (
          <TitleTooltip key={column} title={tooltip} side="top">
            {statusCharacter}
          </TitleTooltip>
        )
      })}
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

const PROJECT_FILE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet("complete")
const projectFileIconResolver = createFileTreeIconResolver({
  set: "complete",
  colored: true,
})

function ProjectFileIconSprite() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none block h-0 w-0 overflow-hidden"
      dangerouslySetInnerHTML={{ __html: PROJECT_FILE_ICON_SPRITE_SHEET }}
    />
  )
}

function ProjectFileTypeIcon({ path }: { path: string }) {
  const icon = projectFileIconResolver.resolveIcon("file-tree-icon-file", path)
  const color = icon.token ? getBuiltInFileIconColor(icon.token) : undefined

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
      data-icon-name={icon.remappedFrom ?? icon.name}
      data-icon-token={icon.token}
      focusable="false"
      style={color ? { color } : undefined}
      viewBox={icon.viewBox ?? `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`}
      width={icon.width ?? 16}
      height={icon.height ?? 16}
    >
      <use href={`#${icon.name.replace(/^#/, "")}`} />
    </svg>
  )
}

function isFileTreeDirectoryHandle(
  item: FileTreeItemHandle | null
): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true
}

function getProjectFileDirectoryPaths(paths: Array<string>) {
  const directoryPaths = new Set<string>()

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      directoryPaths.add(`${parts.slice(0, index).join("/")}/`)
    }
  }

  return [...directoryPaths].sort(
    (left, right) =>
      right.split("/").length - left.split("/").length ||
      right.length - left.length ||
      right.localeCompare(left)
  )
}

function ProjectFileTree({
  collapseAllRevision,
  paths,
  selectedPath,
  onSelectFile,
}: {
  collapseAllRevision: number
  paths: Array<string>
  selectedPath: string
  onSelectFile: (path: string) => void
}) {
  const validPathsRef = React.useRef(new Set(paths))
  const onSelectFileRef = React.useRef(onSelectFile)
  const lastCollapseAllRevisionRef = React.useRef(0)
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
    for (const path of model.getSelectedPaths()) {
      if (path === selectedPath) continue
      model.getItem(path)?.deselect()
    }
    item.select()
    item.focus()
  }, [model, selectedPath])

  React.useEffect(() => {
    if (
      collapseAllRevision <= 0 ||
      collapseAllRevision === lastCollapseAllRevisionRef.current ||
      paths.length === 0
    ) {
      return
    }

    lastCollapseAllRevisionRef.current = collapseAllRevision

    for (const directoryPath of getProjectFileDirectoryPaths(paths)) {
      const item = model.getItem(directoryPath)
      if (!isFileTreeDirectoryHandle(item) || !item.isExpanded()) continue
      item.collapse()
    }

    model.focusNearestPath(selectedPath || model.getFocusedPath())
  }, [collapseAllRevision, model, paths, selectedPath])

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
  onOpenFile: (path: string, options?: OpenProjectFileOptions) => void
  previewMode?: ProjectFilesPreviewMode
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const [openFileDialogOpen, setOpenFileDialogOpen] = React.useState(false)
  const [collapseAllRevision, setCollapseAllRevision] = React.useState(0)
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
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 p-2">
          <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
            {paths.length.toLocaleString()} files
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <TitleTooltip title="Collapse all folders">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Collapse all folders"
                disabled={paths.length === 0}
                onClick={() => {
                  setCollapseAllRevision((revision) => revision + 1)
                }}
              >
                <ChevronsDownUpIcon className="size-4" />
              </Button>
            </TitleTooltip>
            <TitleTooltip title="Open file">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpenFileDialogOpen(true)
                }}
              >
                Open File
              </Button>
            </TitleTooltip>
          </div>
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
              collapseAllRevision={collapseAllRevision}
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
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open Files"
      description="Search project files to open."
    >
      <Command shouldFilter>
        <ProjectFileIconSprite />
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
                <ProjectFileTypeIcon path={path} />
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

function FileViewerTabContent({
  active,
  dragging = false,
  dragListeners,
  dragAttributes,
  index,
  onActiveFileChange,
  onActiveTabChange,
  onCloseAllFiles,
  onCloseFile,
  onCloseFilesToRight,
  onCloseOtherFiles,
  path,
  preview,
  tabCount,
}: {
  active: boolean
  dragging?: boolean
  dragListeners?: ReturnType<typeof useSortable>["listeners"]
  dragAttributes?: ReturnType<typeof useSortable>["attributes"]
  index: number
  onActiveFileChange?: (path: string) => void
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  onCloseAllFiles?: () => void
  onCloseFile?: (path: string) => void
  onCloseFilesToRight?: (path: string) => void
  onCloseOtherFiles?: (path: string) => void
  path: string
  preview: boolean
  tabCount: number
}) {
  const tab = (
    <div
      className={cn(
        "inline-flex h-8 max-w-56 shrink-0 items-center rounded-md border border-transparent text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
        dragging && "border-transparent shadow-none ring-0"
      )}
      {...dragAttributes}
      {...dragListeners}
    >
      <button
        type="button"
        title={path}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left"
        onClick={() => {
          onActiveTabChange("files")
          onActiveFileChange?.(path)
        }}
      >
        <ProjectFileTypeIcon path={path} />
        <span className={cn("block min-w-0 truncate", preview && "italic")}>
          {fileNameFromPath(path)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${path}`}
        className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          onCloseFile?.(path)
        }}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger render={tab} />
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => onCloseFile?.(path)}>
          Close
        </ContextMenuItem>
        <ContextMenuItem
          disabled={tabCount <= 1}
          onClick={() => onCloseOtherFiles?.(path)}
        >
          Close others
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index >= tabCount - 1}
          onClick={() => onCloseFilesToRight?.(path)}
        >
          Close to the right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseAllFiles?.()}>
          Close all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SortableFileViewerTab(props: {
  active: boolean
  index: number
  onActiveFileChange?: (path: string) => void
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  onCloseAllFiles?: () => void
  onCloseFile?: (path: string) => void
  onCloseFilesToRight?: (path: string) => void
  onCloseOtherFiles?: (path: string) => void
  path: string
  preview: boolean
  tabCount: number
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.path })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } satisfies React.CSSProperties
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("shrink-0", isDragging && "opacity-0")}
    >
      <FileViewerTabContent
        {...props}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  )
}

function FileViewerTabOverlay({
  activeFilePath,
  activePath,
  filePreviewPath,
  fileTabs,
}: {
  activeFilePath?: string
  activePath: string
  filePreviewPath: string
  fileTabs: Array<string>
}) {
  const index = fileTabs.indexOf(activePath)
  if (index < 0) return null

  return (
    <FileViewerTabContent
      active={activeFilePath === activePath}
      dragging
      index={index}
      onActiveTabChange={() => {}}
      path={activePath}
      preview={filePreviewPath === activePath}
      tabCount={fileTabs.length}
    />
  )
}

function RightSidebarTabStrip({
  activeFilePath,
  activeTab,
  filePreviewPath = "",
  fileTabs = [],
  onActiveFileChange,
  onActiveTabChange,
  onCloseAllFiles,
  onCloseFile,
  onCloseFilesToRight,
  onCloseOtherFiles,
  onOpenFileDialog,
  onReorderFiles,
  showReview = false,
}: {
  activeFilePath?: string
  activeTab: RightSidebarTabValue
  filePreviewPath?: string
  fileTabs?: Array<string>
  onActiveFileChange?: (path: string) => void
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  onCloseAllFiles?: () => void
  onCloseFile?: (path: string) => void
  onCloseFilesToRight?: (path: string) => void
  onCloseOtherFiles?: (path: string) => void
  onOpenFileDialog?: () => void
  onReorderFiles?: (paths: Array<string>) => void
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
          "inline-flex h-8 shrink-0 items-center rounded-md border border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
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

  const [activeDragPath, setActiveDragPath] = React.useState("")
  const hasOpenFiles = fileTabs.length > 0
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragPath(String(event.active.id))
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""
    if (!activeId || !overId || activeId === overId) return

    const oldIndex = fileTabs.indexOf(activeId)
    const newIndex = fileTabs.indexOf(overId)
    if (oldIndex === -1 || newIndex === -1) return

    onReorderFiles?.(arrayMove(fileTabs, oldIndex, newIndex))
    setActiveDragPath("")
  }
  const handleDragCancel = () => {
    setActiveDragPath("")
  }

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border/70 bg-background p-2">
      {hasOpenFiles ? <ProjectFileIconSprite /> : null}
      {showReview ? renderTab({ label: "Changes", value: "review" }) : null}
      {!hasOpenFiles ? renderTab({ label: "Files", value: "files" }) : null}
      {hasOpenFiles ? (
        <span className="mx-1 shrink-0 text-xs text-border" aria-hidden="true">
          |
        </span>
      ) : null}
      {hasOpenFiles ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={fileTabs}
            strategy={horizontalListSortingStrategy}
          >
            {fileTabs.map((path, index) => (
              <SortableFileViewerTab
                key={path}
                active={activeTab === "files" && activeFilePath === path}
                index={index}
                onActiveFileChange={onActiveFileChange}
                onActiveTabChange={onActiveTabChange}
                onCloseAllFiles={onCloseAllFiles}
                onCloseFile={onCloseFile}
                onCloseFilesToRight={onCloseFilesToRight}
                onCloseOtherFiles={onCloseOtherFiles}
                path={path}
                preview={filePreviewPath === path}
                tabCount={fileTabs.length}
              />
            ))}
          </SortableContext>
          <DragOverlay
            dropAnimation={null}
            modifiers={FILE_TAB_DRAG_OVERLAY_MODIFIERS}
          >
            {activeDragPath ? (
              <FileViewerTabOverlay
                activeFilePath={activeFilePath}
                activePath={activeDragPath}
                filePreviewPath={filePreviewPath}
                fileTabs={fileTabs}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}
      {hasOpenFiles ? (
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
      ) : null}
    </div>
  )
}

function clampProjectFileTreeWidth(width: number) {
  if (!Number.isFinite(width)) return PROJECT_FILE_TREE_DEFAULT_WIDTH
  return Math.min(
    PROJECT_FILE_TREE_MAX_WIDTH,
    Math.max(PROJECT_FILE_TREE_MIN_WIDTH, width)
  )
}

function FileTreeResizeHandle({
  onResize,
  width,
}: {
  onResize: (width: number) => void
  width: number
}) {
  const resizeTo = (nextWidth: number) => {
    onResize(clampProjectFileTreeWidth(nextWidth))
  }

  return (
    <div
      role="separator"
      aria-label="Resize file tree"
      aria-orientation="vertical"
      tabIndex={0}
      className={cn(
        "absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize touch-none bg-transparent outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-border/70 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        resizeRailPrimaryInteractiveClass
      )}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const delta = event.shiftKey ? 48 : 16
        resizeTo(width + (event.key === "ArrowRight" ? delta : -delta))
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()

        const startX = event.clientX
        const startWidth = width
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        const cleanupGlobalResizeCursor =
          installGlobalResizeCursor("col-resize")

        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"

        const handlePointerMove = (moveEvent: PointerEvent) => {
          resizeTo(startWidth + moveEvent.clientX - startX)
        }
        const handlePointerUp = () => {
          cleanupGlobalResizeCursor()
          document.body.style.cursor = previousCursor
          document.body.style.userSelect = previousUserSelect
          document.removeEventListener("pointermove", handlePointerMove)
          document.removeEventListener("pointerup", handlePointerUp)
          document.removeEventListener("pointercancel", handlePointerUp)
        }

        document.addEventListener("pointermove", handlePointerMove)
        document.addEventListener("pointerup", handlePointerUp)
        document.addEventListener("pointercancel", handlePointerUp)
      }}
    />
  )
}

function ProjectFileTreePane({
  viewerContextId,
  cwd,
  active,
  activeFilePath,
  onOpenFile,
  previewMode,
}: GitScopedProps & {
  activeFilePath: string
  onOpenFile: (path: string, options?: OpenProjectFileOptions) => void
  previewMode: ProjectFilesPreviewMode
}) {
  const [fileTreeWidth, setFileTreeWidth] = React.useState(
    PROJECT_FILE_TREE_DEFAULT_WIDTH
  )

  return (
    <div
      className="relative min-h-0 shrink-0 overflow-visible border-r border-border/70"
      style={{
        width: `${fileTreeWidth}px`,
        maxWidth: "70%",
      }}
    >
      <div className="h-full min-h-0 overflow-hidden">
        <ProjectFilesWorkspace
          viewerContextId={viewerContextId}
          cwd={cwd}
          active={active}
          activeFilePath={activeFilePath}
          onCloseFile={() => {}}
          onOpenFile={onOpenFile}
          previewMode={previewMode}
        />
      </div>
      <FileTreeResizeHandle width={fileTreeWidth} onResize={setFileTreeWidth} />
    </div>
  )
}

function fileNameFromPath(path: string) {
  const parts = path.split("/").filter(Boolean)
  return parts.at(-1) || path
}

function FilePathBreadcrumb({
  fileTreeCollapsed = false,
  onFileTreeCollapsedChange,
  path,
}: {
  fileTreeCollapsed?: boolean
  onFileTreeCollapsedChange?: (collapsed: boolean) => void
  path: string
}) {
  const parts = path.split("/").filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3">
      {onFileTreeCollapsedChange ? (
        <TitleTooltip
          title={fileTreeCollapsed ? "Show file tree" : "Collapse file tree"}
        >
          <button
            type="button"
            aria-pressed={fileTreeCollapsed}
            aria-label={
              fileTreeCollapsed ? "Show file tree" : "Collapse file tree"
            }
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              onFileTreeCollapsedChange(!fileTreeCollapsed)
            }}
          >
            {fileTreeCollapsed ? (
              <PanelLeftOpenIcon className="size-4" />
            ) : (
              <PanelLeftCloseIcon className="size-4" />
            )}
          </button>
        </TitleTooltip>
      ) : null}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <Breadcrumb title={path}>
          <BreadcrumbList className="flex-nowrap gap-1 font-mono text-xs whitespace-nowrap">
            {parts.map((part, index) => {
              const isLast = index === parts.length - 1
              const key = `${index}:${part}`

              return (
                <React.Fragment key={key}>
                  {index > 0 ? (
                    <BreadcrumbSeparator className="text-muted-foreground/60" />
                  ) : null}
                  <BreadcrumbItem className="min-w-0 shrink-0">
                    {isLast ? (
                      <BreadcrumbPage className="max-w-80 truncate font-mono text-xs font-medium">
                        {part}
                      </BreadcrumbPage>
                    ) : (
                      <span className="max-w-40 truncate text-muted-foreground">
                        {part}
                      </span>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </div>
  )
}

function FileViewerTabStrip({
  activeFilePath,
  fileTabs,
  onActiveFileChange,
  onCloseFile,
  onOpenFileDialog,
}: {
  activeFilePath: string
  fileTabs: Array<string>
  onActiveFileChange: (path: string) => void
  onCloseFile: (path: string) => void
  onOpenFileDialog: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-background px-2">
      {fileTabs.map((path) => {
        const active = activeFilePath === path
        return (
          <div
            key={path}
            className={cn(
              "inline-flex h-8 max-w-56 shrink-0 items-center rounded-md border border-transparent text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted text-foreground"
            )}
          >
            <button
              type="button"
              title={path}
              className="min-w-0 flex-1 px-2.5 text-left"
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

const GIT_HISTORY_PANEL_MIN_HEIGHT = 160

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

function FileReviewContent({
  viewerContextId,
  cwd,
  active,
  onOpenFile,
}: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [diffStyle, setDiffStyle] = React.useState<ReviewDiffStyle>("unified")
  const [historyOpen, setHistoryOpen] = React.useState(true)
  const [historyPanelHeight, setHistoryPanelHeight] = React.useState<
    number | undefined
  >(undefined)
  const [defaultHistoryPanelHeight, setDefaultHistoryPanelHeight] =
    React.useState<number | undefined>(undefined)
  const [verticalResizeCursor, setVerticalResizeCursor] =
    React.useState<SidebarVerticalResizeCursor>("row-resize")
  const [openFiles, setOpenFiles] = React.useState<Array<string>>([])
  const [stickyReviewFileValue, setStickyReviewFileValue] = React.useState("")
  const [historyHeaderShadowed, setHistoryHeaderShadowed] =
    React.useState(false)
  const changesScrollRef = React.useRef<HTMLDivElement>(null)
  const reviewContentRef = React.useRef<HTMLDivElement>(null)
  const historyPanelRef = React.useRef<HTMLDivElement>(null)
  const historyScrollRef = React.useRef<HTMLDivElement>(null)
  const previousNormalizedCwdRef = React.useRef(normalizedCwd)
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

  React.useEffect(() => {
    if (previousNormalizedCwdRef.current === normalizedCwd) return
    previousNormalizedCwdRef.current = normalizedCwd

    setHistoryOpen(true)
    setHistoryPanelHeight(undefined)
    setDefaultHistoryPanelHeight(undefined)
    setOpenFiles([])
    setStickyReviewFileValue("")
    setHistoryHeaderShadowed(false)
  }, [normalizedCwd])

  React.useEffect(() => {
    setVerticalResizeCursor(getSidebarVerticalResizeCursor())
  }, [])

  const updateStickyReviewFileHeader = (
    scrollElement: HTMLDivElement | null
  ) => {
    setDerivedScrollState(
      setStickyReviewFileValue,
      getStuckScrollTriggerValue({
        getValue: (trigger) => trigger.dataset.reviewFileValue || "",
        scrollElement,
        selector: "[data-review-file-trigger]",
      })
    )
  }

  const updateHistoryHeaderShadow = (scrollElement: HTMLDivElement | null) => {
    setDerivedScrollState(
      setHistoryHeaderShadowed,
      hasScrolledContent(scrollElement)
    )
  }

  React.useEffect(() => {
    updateStickyReviewFileHeader(changesScrollRef.current)
  }, [openFiles])

  React.useEffect(() => {
    if (!historyOpen) {
      setDerivedScrollState<boolean>(setHistoryHeaderShadowed, false)
      return
    }
    updateHistoryHeaderShadow(historyScrollRef.current)
  }, [historyOpen])

  const getHistoryPanelHeightBounds = () => {
    const containerHeight =
      reviewContentRef.current?.getBoundingClientRect().height || 0
    if (containerHeight <= 0) {
      return {
        minHeight: GIT_HISTORY_PANEL_MIN_HEIGHT,
        maxHeight: Number.POSITIVE_INFINITY,
      }
    }

    const minHeight = Math.min(
      GIT_HISTORY_PANEL_MIN_HEIGHT,
      containerHeight / 2
    )
    return {
      minHeight,
      maxHeight: Math.max(minHeight, containerHeight - minHeight),
    }
  }

  const startHistoryResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile || event.button !== 0) return
    event.preventDefault()

    const { maxHeight, minHeight } = getHistoryPanelHeightBounds()
    const startHeight =
      historyPanelRef.current?.getBoundingClientRect().height || minHeight
    const startY = event.clientY
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    const cursor = getSidebarVerticalResizeCursor()
    const cleanupGlobalResizeCursor = installGlobalResizeCursor(cursor)

    document.body.style.cursor = cursor
    document.body.style.userSelect = "none"

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY)
      setHistoryPanelHeight(
        Math.min(maxHeight, Math.max(minHeight, nextHeight))
      )
    }
    const handlePointerUp = () => {
      cleanupGlobalResizeCursor()
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      document.removeEventListener("pointermove", handlePointerMove)
      document.removeEventListener("pointerup", handlePointerUp)
      document.removeEventListener("pointercancel", handlePointerUp)
    }

    document.addEventListener("pointermove", handlePointerMove)
    document.addEventListener("pointerup", handlePointerUp)
    document.addEventListener("pointercancel", handlePointerUp)
  }

  React.useEffect(() => {
    if (isMobile || !historyOpen) return

    const updateDefaultHistoryPanelHeight = () => {
      const containerHeight =
        reviewContentRef.current?.getBoundingClientRect().height || 0
      const { maxHeight, minHeight } = getHistoryPanelHeightBounds()
      const defaultHeight = containerHeight > 0 ? containerHeight * 0.5 : 0

      setDefaultHistoryPanelHeight(
        defaultHeight > 0
          ? Math.min(maxHeight, Math.max(minHeight, defaultHeight))
          : undefined
      )
      setHistoryPanelHeight((current) =>
        typeof current === "number"
          ? Math.min(maxHeight, Math.max(minHeight, current))
          : current
      )
    }

    updateDefaultHistoryPanelHeight()
    window.addEventListener("resize", updateDefaultHistoryPanelHeight)
    return () => {
      window.removeEventListener("resize", updateDefaultHistoryPanelHeight)
    }
  }, [historyOpen, isMobile, normalizedCwd])

  const hasOpenFile = openFiles.length > 0
  const toggleAll = () => {
    setOpenFiles(hasOpenFile ? [] : changedFiles.map(reviewFileValue))
  }

  return (
    <div
      ref={reviewContentRef}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <div className="flex min-h-12 shrink-0 flex-col justify-center gap-2 border-b border-border/70 bg-background p-2">
        <GitPanelToolbar
          viewerContextId={viewerContextId}
          cwd={normalizedCwd}
          active={active}
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background p-2">
        <div className="flex min-w-0 items-center">
          <span className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
            Diffs
          </span>
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
              <ToggleGroupItem key={value} value={value}>
                {value === "unified" ? "Unified" : "Split"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            disabled={changedFiles.length === 0}
            onClick={toggleAll}
          >
            {hasOpenFile ? (
              <ChevronsDownUpIcon className="size-4" />
            ) : (
              <ChevronsUpDownIcon className="size-4" />
            )}
            {hasOpenFile ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      </div>
      <div
        ref={changesScrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          updateStickyReviewFileHeader(event.currentTarget)
        }}
      >
        {!normalizedCwd ? (
          <GitSectionNote className="px-3 py-2.5">
            No directory selected.
          </GitSectionNote>
        ) : !viewerContextId ? (
          <GitSectionNote className="px-3 py-2.5">
            Waiting for viewer context…
          </GitSectionNote>
        ) : filesQuery.isPending && typeof files === "undefined" ? (
          <GitSectionNote className="px-3 py-2.5">
            <Spinner /> Loading changes…
          </GitSectionNote>
        ) : filesQuery.error ? (
          <GitSectionNote tone="destructive" className="px-3 py-2.5">
            {getErrorMessage(filesQuery.error, "Failed to load changes")}
          </GitSectionNote>
        ) : files === null ? (
          <GitSectionNote className="px-3 py-2.5">
            No git repository detected.
          </GitSectionNote>
        ) : changedFiles.length > 0 ? (
          <Accordion
            multiple
            value={openFiles}
            onValueChange={setOpenFiles}
            className="border-b border-border/80"
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
                stuck={stickyReviewFileValue === reviewFileValue(file)}
                onOpenFile={onOpenFile}
              />
            ))}
          </Accordion>
        ) : (
          <GitSectionNote className="px-3 py-2.5">
            Working tree clean.
          </GitSectionNote>
        )}
      </div>
      {normalizedCwd &&
      viewerContextId &&
      files !== null &&
      !filesQuery.error ? (
        <div
          ref={historyPanelRef}
          className="relative flex max-h-[50%] min-h-0 shrink-0 flex-col overflow-hidden border-t border-border/70 bg-card/50 md:max-h-none"
          style={
            !isMobile && historyOpen
              ? { height: historyPanelHeight ?? defaultHistoryPanelHeight }
              : undefined
          }
        >
          {historyOpen ? (
            <div
              role="separator"
              aria-label="Resize history panel"
              aria-orientation="horizontal"
              style={{ cursor: verticalResizeCursor }}
              className={cn(
                "absolute inset-x-0 top-0 z-10 hidden h-2 -translate-y-1/2 touch-none bg-transparent after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-transparent md:block",
                resizeRailPrimaryInteractiveClass,
                verticalResizeCursor === "ns-resize"
                  ? "cursor-ns-resize"
                  : "cursor-row-resize"
              )}
              onPointerDown={startHistoryResize}
            />
          ) : null}
          <button
            type="button"
            aria-expanded={historyOpen}
            className={cn(
              "flex min-h-10 w-full shrink-0 items-center justify-between gap-3 bg-background px-3 py-2 text-left transition-[background-color,box-shadow] hover:bg-muted/60",
              historyHeaderShadowed && "shadow-sm"
            )}
            onClick={() => {
              setHistoryOpen((open) => !open)
            }}
          >
            <span className="flex min-w-0 items-center">
              <span className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
                History
              </span>
            </span>
            {historyOpen ? (
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronUpIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
          </button>
          {historyOpen ? (
            <div
              ref={historyScrollRef}
              className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain border-t border-border/70"
              onScroll={(event) => {
                updateHistoryHeaderShadow(event.currentTarget)
              }}
            >
              <GitCommitsSection
                viewerContextId={viewerContextId}
                cwd={normalizedCwd}
                active={active && historyOpen}
                embedded
              />
            </div>
          ) : null}
        </div>
      ) : null}
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
  stuck,
  onOpenFile,
}: GitScopedProps & {
  diffStyle: ReviewDiffStyle
  file: GitChangeFile
  open: boolean
  stuck: boolean
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
      <AccordionPrimitive.Header
        className={cn(
          "group/review-file-header sticky top-0 z-20 flex bg-background transition-shadow",
          stuck && "shadow-sm"
        )}
      >
        <AccordionPrimitive.Trigger
          data-review-file-trigger
          data-review-file-value={value}
          className="group/review-file-trigger relative flex min-h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-none border border-transparent bg-background px-3 py-2 text-left font-mono text-[13px] font-medium transition-all outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground"
        >
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
          <ChevronDownIcon
            data-slot="accordion-trigger-icon"
            className="pointer-events-none size-4 shrink-0 group-aria-expanded/review-file-trigger:hidden"
          />
          <ChevronUpIcon
            data-slot="accordion-trigger-icon"
            className="pointer-events-none hidden size-4 shrink-0 group-aria-expanded/review-file-trigger:inline"
          />
        </AccordionPrimitive.Trigger>
        {onOpenFile ? (
          <TitleTooltip title="Open file" side="top">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Open ${file.path}`}
              className="mr-2 self-center"
              onClick={(event) => {
                event.stopPropagation()
                onOpenFile(file.path, { pin: true })
              }}
            >
              <SquareArrowOutUpRightIcon className="size-3.5" />
            </Button>
          </TitleTooltip>
        ) : null}
      </AccordionPrimitive.Header>
      <AccordionContent className="bg-background p-0">
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
                  className="shrink-0"
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
  const paths = fileTreeQuery.data ?? []

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
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeFilePath ? (
          <>
            <FilePathBreadcrumb path={activeFilePath} />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ProjectFileContent
                viewerContextId={viewerContextId}
                cwd={normalizedCwd}
                active={active}
                path={activeFilePath}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Select a file to view it.
          </div>
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

type GitBranchDialogStage = "browse" | "create"

function GitBranchDialogKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

type GitCheckoutBranchPayload = {
  branch: string
  create?: boolean
  startPoint?: string
  track?: boolean
}

function GitBranchDialog({
  viewerContextId,
  cwd,
  active,
  gitStatus,
  open,
  onOpenChange,
}: GitScopedProps & {
  gitStatus: GitStatusValue | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const shouldAutoFocus = useCommandSurfaceAutoFocus(isMobile)
  const normalizedCwd = normalizeCwd(cwd)
  const [query, setQuery] = React.useState("")
  const [stage, setStage] = React.useState<GitBranchDialogStage>("browse")
  const [selectedValue, setSelectedValue] = React.useState("")
  const [createBranchName, setCreateBranchName] = React.useState("")
  const branchesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "branches",
    }),
    enabled: Boolean(open && active && viewerContextId && normalizedCwd),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const branchData = branchesQuery.data
  const localBranches = gitLocalBranchesForRender(
    branchData?.localBranches,
    gitStatus
  )
  const remoteBranches = (branchData?.remoteBranches ?? []).filter(
    (branch) => !branch.name.endsWith("/HEAD")
  )
  const localBranchNames = new Set(localBranches.map((branch) => branch.name))

  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setStage("browse")
      setSelectedValue("")
      setCreateBranchName("")
    }
  }, [open])

  React.useEffect(() => {
    if (!open || selectedValue) return

    const currentBranch = localBranches.find((branch) => branch.current)
    setSelectedValue(
      currentBranch
        ? `local:${currentBranch.name}`
        : localBranches[0]
          ? `local:${localBranches[0].name}`
          : remoteBranches[0]
            ? `remote:${remoteBranches[0].name}`
            : "action:create"
    )
  }, [localBranches, open, remoteBranches, selectedValue])

  const checkoutMutation = useMutation({
    mutationFn: async (payload: GitCheckoutBranchPayload) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: normalizedCwd, ...payload }),
        }
      ),
    onSuccess: async (_response, payload) => {
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
      onOpenChange(false)
      toast.success(
        payload.create
          ? `Created and switched to ${payload.branch}`
          : `Switched to ${payload.branch}`
      )
    },
    onError: (error, payload) => {
      toast.error(
        getErrorMessage(
          error,
          payload.create ? "Failed to create branch" : "Failed to switch branch"
        )
      )
    },
  })

  const switchLocalBranch = (branch: GitLocalBranch) => {
    if (branch.current || checkoutMutation.isPending) return
    checkoutMutation.mutate({ branch: branch.name })
  }

  const switchRemoteBranch = (branch: GitRemoteBranch) => {
    if (checkoutMutation.isPending) return

    const parts = gitRemoteBranchParts(branch.name)
    const localName = parts.branch || branch.name
    if (localBranchNames.has(localName)) {
      checkoutMutation.mutate({ branch: localName })
      return
    }

    checkoutMutation.mutate({
      branch: localName,
      create: true,
      startPoint: branch.name,
      track: true,
    })
  }

  const createBranch = () => {
    const branch = createBranchName.trim()
    if (!branch || checkoutMutation.isPending) return
    checkoutMutation.mutate({ branch, create: true })
  }

  const browseBody = (
    <Command
      shouldFilter
      loop
      value={selectedValue}
      onValueChange={setSelectedValue}
      onKeyDown={(event) => {
        if (matchesShortcutEvent(event.nativeEvent, "Control+N")) {
          event.preventDefault()
          setStage("create")
        }
      }}
      className="min-h-0 flex-1"
    >
      <CommandInput
        autoFocus={shouldAutoFocus}
        value={query}
        onValueChange={setQuery}
        placeholder="Search branches"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,28rem)]">
        <CommandEmpty>
          {branchesQuery.isPending ? "Loading branches…" : "No branches found."}
        </CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            value="action:create"
            keywords={["new", "create", "branch"]}
            onSelect={() => {
              setStage("create")
            }}
          >
            <GitBranchIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">Create new branch…</span>
            <CommandShortcut>
              {formatShortcutLabel("Control+N")}
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={`Local branches · ${localBranches.length}`}>
          {branchesQuery.isPending && localBranches.length === 0 ? (
            <CommandItem value="loading:branches" disabled>
              <Spinner className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Loading branches…</span>
            </CommandItem>
          ) : null}
          {localBranches.map((branch) => {
            const trackText = gitLocalBranchTrackText(branch)
            const relativeDateText = branch.current
              ? "current"
              : formatGitRelativeDateCompact(branch.relativeDate)
            const title =
              [branch.name, branch.upstream, branch.subject]
                .filter(Boolean)
                .join(" · ") || branch.name

            return (
              <CommandItem
                key={branch.name}
                value={`local:${branch.name}`}
                keywords={[
                  branch.name,
                  branch.upstream ?? "",
                  branch.subject ?? "",
                ]}
                disabled={checkoutMutation.isPending}
                onSelect={() => switchLocalBranch(branch)}
                className="items-start py-2"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {branch.current ? (
                    <CheckIcon className="size-3.5 text-emerald-500" />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1" title={title}>
                  <div className="truncate font-mono text-[13px] font-medium">
                    {branch.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[branch.upstream, branch.subject]
                      .filter(Boolean)
                      .join(" · ") || "Local branch"}
                  </div>
                </div>
                <CommandShortcut
                  className={cn(
                    "shrink-0 tracking-normal normal-case",
                    trackText && gitLocalBranchTrackClass(branch, trackText)
                  )}
                >
                  {trackText || relativeDateText}
                </CommandShortcut>
              </CommandItem>
            )
          })}
        </CommandGroup>
        <CommandGroup heading={`Remote branches · ${remoteBranches.length}`}>
          {remoteBranches.map((branch) => {
            const parts = gitRemoteBranchParts(branch.name)
            const localName = parts.branch || branch.name
            const localExists = localBranchNames.has(localName)

            return (
              <CommandItem
                key={branch.name}
                value={`remote:${branch.name}`}
                keywords={[branch.name, localName, branch.subject ?? ""]}
                disabled={checkoutMutation.isPending}
                onSelect={() => switchRemoteBranch(branch)}
                className="items-start py-2"
              >
                <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1" title={branch.name}>
                  <div className="truncate font-mono text-[13px] font-medium">
                    {parts.remote ? (
                      <span className="text-muted-foreground/70">
                        {parts.remote}/
                      </span>
                    ) : null}
                    {parts.branch || branch.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {branch.subject || "Remote branch"}
                  </div>
                </div>
                <CommandShortcut className="shrink-0 tracking-normal normal-case">
                  {localExists ? "Switch" : "Track"}
                </CommandShortcut>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
      {isMobile ? null : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>Enter</GitBranchDialogKbd> Switch
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>
              {formatShortcutLabel("Control+N")}
            </GitBranchDialogKbd>{" "}
            New branch
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>Esc</GitBranchDialogKbd> Close
          </span>
        </div>
      )}
    </Command>
  )

  const createBody = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setStage("browse")}
          aria-label="Back to branches"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Create branch</div>
          <div className="truncate text-xs text-muted-foreground">
            From the current HEAD
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-2 p-3">
        <Input
          autoFocus={shouldAutoFocus}
          value={createBranchName}
          onChange={(event) => setCreateBranchName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setStage("browse")
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            createBranch()
          }}
          placeholder="branch-name"
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          disabled={!createBranchName.trim() || checkoutMutation.isPending}
          onClick={createBranch}
        >
          {checkoutMutation.isPending ? <Spinner /> : null}
          Create
        </Button>
      </div>
      {isMobile ? null : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>Enter</GitBranchDialogKbd> Create
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>Esc</GitBranchDialogKbd> Back
          </span>
        </div>
      )}
    </div>
  )

  const branchDialogBody = stage === "create" ? createBody : browseBody

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        autoFocus={shouldAutoFocus}
      >
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Branches</DrawerTitle>
            <DrawerDescription>
              Switch branches or create a new branch.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {branchDialogBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Branches"
      description="Switch branches or create a new branch."
      className="sm:max-w-2xl"
      initialFocus
    >
      {branchDialogBody}
    </CommandDialog>
  )
}

const GIT_GRAPH_LANE_COLORS = [
  "#0ea5e9",
  "#db2777",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#14b8a6",
]
const GIT_GRAPH_NULL_VERTEX_ID = -1
const GIT_GRAPH_ROW_HEIGHT = 20
const GIT_GRAPH_COMMIT_DETAILS_HEIGHT = 150
const GIT_GRAPH_LANE_WIDTH = 14
const GIT_GRAPH_OFFSET_X = 12

function gitGraphLaneColor(index: number, active = false) {
  if (active) return "#f87171"
  return GIT_GRAPH_LANE_COLORS[index % GIT_GRAPH_LANE_COLORS.length]
}

type GitCommitGraphParsed = ReturnType<typeof parseGitCommitGraphLine>

type GitCommitGraphPoint = {
  x: number
  y: number
}

type GitCommitGraphLine = {
  p1: GitCommitGraphPoint
  p2: GitCommitGraphPoint
}

type GitCommitGraphRow = {
  colour: number
  commitLane: number
  parsed: GitCommitGraphParsed
}

type GitCommitGraphConnection = {
  connectsTo: GitCommitGraphVertex | null
  onBranch: GitCommitGraphBranch
}

class GitCommitGraphBranch {
  private readonly colour: number
  private readonly lines: Array<GitCommitGraphLine> = []

  constructor(colour: number) {
    this.colour = colour
  }

  addLine(p1: GitCommitGraphPoint, p2: GitCommitGraphPoint) {
    this.lines.push({ p1, p2 })
  }

  getColour() {
    return this.colour
  }

  getLines() {
    return this.lines
  }
}

class GitCommitGraphVertex {
  readonly id: number
  private connections: Array<GitCommitGraphConnection | undefined> = []
  private nextParent = 0
  private nextX = 0
  private onBranch: GitCommitGraphBranch | null = null
  private parents: Array<GitCommitGraphVertex> = []
  private x = 0

  constructor(id: number) {
    this.id = id
  }

  addParent(vertex: GitCommitGraphVertex) {
    this.parents.push(vertex)
  }

  getNextParent() {
    return this.parents[this.nextParent] ?? null
  }

  registerParentProcessed() {
    this.nextParent += 1
  }

  isMerge() {
    return this.parents.length > 1
  }

  addToBranch(branch: GitCommitGraphBranch, x: number) {
    if (this.onBranch !== null) return

    this.onBranch = branch
    this.x = x
  }

  isNotOnBranch() {
    return this.onBranch === null
  }

  getBranch() {
    return this.onBranch
  }

  getPoint(): GitCommitGraphPoint {
    return { x: this.x, y: this.id }
  }

  getNextPoint(): GitCommitGraphPoint {
    return { x: this.nextX, y: this.id }
  }

  getPointConnectingTo(
    vertex: GitCommitGraphVertex | null,
    onBranch: GitCommitGraphBranch
  ) {
    for (let i = 0; i < this.connections.length; i++) {
      const connection = this.connections[i]
      if (
        connection?.connectsTo === vertex &&
        connection.onBranch === onBranch
      ) {
        return { x: i, y: this.id }
      }
    }

    return null
  }

  registerUnavailablePoint(
    x: number,
    connectsToVertex: GitCommitGraphVertex | null,
    onBranch: GitCommitGraphBranch
  ) {
    if (x !== this.nextX) return

    this.nextX = x + 1
    this.connections[x] = { connectsTo: connectsToVertex, onBranch }
  }
}

function buildGitCommitGraphRows(lines: Array<string>) {
  const parsedRows = lines.map((line) => parseGitCommitGraphLine(line))
  const commitLookup = new Map<string, number>()
  parsedRows.forEach((parsed, index) => {
    if (parsed.fullHash) commitLookup.set(parsed.fullHash, index)
  })

  const nullVertex = new GitCommitGraphVertex(GIT_GRAPH_NULL_VERTEX_ID)
  const vertices = parsedRows.map(
    (_parsed, index) => new GitCommitGraphVertex(index)
  )
  const branches: Array<GitCommitGraphBranch> = []
  const availableColours: Array<number> = []

  parsedRows.forEach((parsed, index) => {
    if (!parsed.fullHash) return

    const vertex = vertices[index]!
    parsed.parents.forEach((parentHash) => {
      const parentIndex = commitLookup.get(parentHash)
      if (typeof parentIndex === "number") {
        const parentVertex = vertices[parentIndex]!
        vertex.addParent(parentVertex)
      } else {
        vertex.addParent(nullVertex)
      }
    })
  })

  const getAvailableColour = (startAt: number) => {
    for (let i = 0; i < availableColours.length; i++) {
      if (startAt > (availableColours[i] ?? 0)) return i
    }

    availableColours.push(0)
    return availableColours.length - 1
  }

  const determinePath = (startAt: number) => {
    let i = startAt
    let vertex = vertices[i]!
    let parentVertex = vertex.getNextParent()
    let lastPoint = vertex.isNotOnBranch()
      ? vertex.getNextPoint()
      : vertex.getPoint()

    if (
      parentVertex !== null &&
      parentVertex.id !== GIT_GRAPH_NULL_VERTEX_ID &&
      vertex.isMerge() &&
      !vertex.isNotOnBranch() &&
      !parentVertex.isNotOnBranch()
    ) {
      const parentBranch = parentVertex.getBranch()!
      let processedParent = false

      for (i = startAt + 1; i < vertices.length; i++) {
        const currentVertex = vertices[i]!
        const pointToParent = currentVertex.getPointConnectingTo(
          parentVertex,
          parentBranch
        )
        const currentPoint = pointToParent ?? currentVertex.getNextPoint()
        parentBranch.addLine(lastPoint, currentPoint)
        currentVertex.registerUnavailablePoint(
          currentPoint.x,
          parentVertex,
          parentBranch
        )
        lastPoint = currentPoint

        if (pointToParent !== null) {
          vertex.registerParentProcessed()
          processedParent = true
          break
        }
      }

      if (!processedParent) vertex.registerParentProcessed()
      return
    }

    const branch = new GitCommitGraphBranch(getAvailableColour(startAt))
    vertex.addToBranch(branch, lastPoint.x)
    vertex.registerUnavailablePoint(lastPoint.x, vertex, branch)

    for (i = startAt + 1; i < vertices.length; i++) {
      const currentVertex = vertices[i]!
      const currentPoint =
        parentVertex === currentVertex && !parentVertex.isNotOnBranch()
          ? currentVertex.getPoint()
          : currentVertex.getNextPoint()
      branch.addLine(lastPoint, currentPoint)
      currentVertex.registerUnavailablePoint(
        currentPoint.x,
        parentVertex,
        branch
      )
      lastPoint = currentPoint

      if (parentVertex === currentVertex) {
        vertex.registerParentProcessed()
        const parentVertexOnBranch = !parentVertex.isNotOnBranch()
        parentVertex.addToBranch(branch, currentPoint.x)
        vertex = parentVertex
        parentVertex = vertex.getNextParent()
        if (parentVertex === null || parentVertexOnBranch) break
      }
    }

    if (
      i === vertices.length &&
      parentVertex !== null &&
      parentVertex.id === GIT_GRAPH_NULL_VERTEX_ID
    ) {
      vertex.registerParentProcessed()
    }

    branches.push(branch)
    availableColours[branch.getColour()] = i
  }

  let i = 0
  while (i < vertices.length) {
    const vertex = vertices[i]!
    const parsed = parsedRows[i]!
    if (
      parsed.fullHash &&
      (vertex.getNextParent() !== null || vertex.isNotOnBranch())
    ) {
      determinePath(i)
    } else {
      i += 1
    }
  }

  const rows: Array<GitCommitGraphRow> = parsedRows.map((parsed, index) => {
    const branch = vertices[index]?.getBranch() ?? null
    return {
      colour: branch?.getColour() ?? 0,
      commitLane:
        parsed.fullHash && branch ? vertices[index]!.getPoint().x : -1,
      parsed,
    }
  })
  const maxLaneCount = Math.max(
    1,
    ...vertices.map((vertex) => vertex.getNextPoint().x)
  )

  return { branches, maxLaneCount, rows }
}

function gitCommitGraphRowValue(row: GitCommitGraphRow, index: number) {
  return row.parsed.fullHash || `commit-row:${index}`
}

function gitCommitGraphRowHeights(
  rows: Array<GitCommitGraphRow>,
  openCommitValues: Array<string>
) {
  const openCommitValueSet = new Set(openCommitValues)

  return rows.map((row, index) =>
    openCommitValueSet.has(gitCommitGraphRowValue(row, index))
      ? GIT_GRAPH_ROW_HEIGHT + GIT_GRAPH_COMMIT_DETAILS_HEIGHT
      : GIT_GRAPH_ROW_HEIGHT
  )
}

function gitCommitGraphRowTops(rowHeights: Array<number>) {
  let top = 0
  return rowHeights.map((height) => {
    const rowTop = top
    top += height
    return rowTop
  })
}

function gitCommitGraphTotalHeight(rowHeights: Array<number>) {
  return rowHeights.reduce((total, height) => total + height, 0)
}

function gitCommitGraphRowCenter(rowTops: Array<number>, rowIndex: number) {
  return (
    (rowTops[rowIndex] ?? rowIndex * GIT_GRAPH_ROW_HEIGHT) +
    GIT_GRAPH_ROW_HEIGHT / 2
  )
}

function gitCommitGraphSegmentPath({
  line,
  rowTops,
}: {
  line: GitCommitGraphLine
  rowTops: Array<number>
}) {
  const x1 = line.p1.x * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_OFFSET_X
  const y1 = gitCommitGraphRowCenter(rowTops, line.p1.y)
  const x2 = line.p2.x * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_OFFSET_X
  const y2 = gitCommitGraphRowCenter(rowTops, line.p2.y)
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`

  const d = GIT_GRAPH_ROW_HEIGHT * 0.8
  return `M ${x1} ${y1} C ${x1} ${y1 + d}, ${x2} ${y2 - d}, ${x2} ${y2}`
}

function GitCommitPageGraph({
  lines,
  openCommitValues,
  unpushedCommitShortHashes,
}: {
  lines: Array<string>
  openCommitValues: Array<string>
  unpushedCommitShortHashes: Set<string>
}) {
  const { branches, maxLaneCount, rows } = buildGitCommitGraphRows(lines)
  const rowHeights = gitCommitGraphRowHeights(rows, openCommitValues)
  const rowTops = gitCommitGraphRowTops(rowHeights)
  const width = Math.max(24, maxLaneCount * GIT_GRAPH_LANE_WIDTH + 4)
  const height = Math.max(
    GIT_GRAPH_ROW_HEIGHT,
    gitCommitGraphTotalHeight(rowHeights)
  )
  const paths: Array<React.ReactElement> = []
  const circles: Array<React.ReactElement> = []

  branches.forEach((branch, branchIndex) => {
    branch.getLines().forEach((line, lineIndex) => {
      paths.push(
        <path
          key={`path:${branchIndex}:${lineIndex}`}
          d={gitCommitGraphSegmentPath({ line, rowTops })}
          fill="none"
          stroke={gitGraphLaneColor(branch.getColour())}
          strokeLinecap="round"
          strokeWidth="2"
        />
      )
    })
  })

  rows.forEach((row, rowIndex) => {
    if (row.commitLane < 0) return

    const x = row.commitLane * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_OFFSET_X
    const y = gitCommitGraphRowCenter(rowTops, rowIndex)
    const active = Boolean(
      row.parsed.hash && unpushedCommitShortHashes.has(row.parsed.hash)
    )
    circles.push(
      <circle
        key={`circle:${rowIndex}:${row.parsed.fullHash}`}
        cx={x}
        cy={y}
        r="4"
        fill={gitGraphLaneColor(row.colour, active)}
      />
    )
  })

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
      style={{ width, height }}
    >
      {paths}
      {circles}
    </svg>
  )
}

function GitCommitRow({
  graphWidth,
  line,
  value,
}: {
  graphWidth: number
  line: string
  value: string
}) {
  const parsed = parseGitCommitGraphLine(line)
  const [hashCopied, setHashCopied] = React.useState(false)
  const hashCopiedResetRef = React.useRef<number | undefined>(undefined)
  const title = parsed.subject.trim()
  const time = formatGitCommitDetailTime(parsed.relativeDate)
  const fullTime = formatGitCommitFullDate(parsed.fullDate)
  const insertions = gitCommitStatCount(parsed.stats, "insertions")
  const deletions = gitCommitStatCount(parsed.stats, "deletions")
  const shortHash = parsed.hash || parsed.fullHash.slice(0, 7)
  React.useEffect(() => {
    return () => {
      if (typeof hashCopiedResetRef.current === "number") {
        window.clearTimeout(hashCopiedResetRef.current)
      }
    }
  }, [])

  const copyFullHashInline = () => {
    if (!parsed.fullHash) return

    void copyGitCommitValue(parsed.fullHash).then((copied) => {
      if (!copied) return
      setHashCopied(true)
      if (typeof hashCopiedResetRef.current === "number") {
        window.clearTimeout(hashCopiedResetRef.current)
      }
      hashCopiedResetRef.current = window.setTimeout(() => {
        setHashCopied(false)
      }, 1200)
    })
  }

  if (!parsed.hash && !parsed.subject) {
    return (
      <div className="flex h-5 max-w-full min-w-0 items-center font-mono text-[13px] leading-5">
        {parsed.subject ? (
          <span className="min-w-0 flex-1 truncate text-foreground">
            {parsed.subject}
          </span>
        ) : null}
      </div>
    )
  }

  const trigger = (
    <AccordionTrigger
      headerClassName="min-w-0"
      className="h-5 min-h-5 w-full items-center gap-2 rounded-none px-1.5 py-0 font-mono text-[13px] leading-5 font-normal transition-colors hover:bg-muted/50 hover:text-foreground hover:no-underline focus-visible:ring-0 aria-expanded:bg-muted aria-expanded:text-foreground **:data-[slot=accordion-trigger-icon]:size-4"
    >
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        style={{ paddingLeft: graphWidth }}
      >
        {title || parsed.hash || "Commit"}
      </span>
    </AccordionTrigger>
  )

  return (
    <AccordionItem value={value} className="border-0">
      <ContextMenu>
        <ContextMenuTrigger render={trigger} />
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            disabled={!parsed.fullHash}
            onClick={() => {
              void copyGitCommitValue(parsed.fullHash)
            }}
          >
            <CopyIcon />
            Copy commit hash
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!parsed.subject}
            onClick={() => {
              void copyGitCommitValue(parsed.subject)
            }}
          >
            <CopyIcon />
            Copy commit message
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AccordionContent className="h-[150px] overflow-y-auto border-b border-border/70 bg-muted/20 pr-2 pb-2">
        <div
          className="grid content-start gap-1.5 pt-1 font-mono text-xs leading-4"
          style={{ paddingLeft: graphWidth }}
        >
          {parsed.author || time ? (
            <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              {parsed.author ? <span>{parsed.author}</span> : null}
              {parsed.author && time ? <span aria-hidden>·</span> : null}
              {time ? (
                <TitleTooltip title={fullTime} side="top">
                  <span>{time}</span>
                </TitleTooltip>
              ) : null}
            </div>
          ) : null}
          <div className="max-w-full break-words whitespace-normal text-foreground">
            {title || "No commit message"}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-emerald-500">
              +{insertions} addition{insertions === 1 ? "" : "s"}
            </span>
            <span className="text-red-400">
              -{deletions} deletion{deletions === 1 ? "" : "s"}
            </span>
          </div>
          {parsed.fullHash ? (
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className="min-w-0 truncate">{shortHash}</span>
              <button
                type="button"
                aria-label="Copy full commit hash"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  copyFullHashInline()
                }}
              >
                {hashCopied ? (
                  <CheckIcon className="size-3.5 text-emerald-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
              </button>
            </div>
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

function GitCommitRows({
  lines,
  unpushedCommitShortHashes,
}: {
  lines: Array<string>
  unpushedCommitShortHashes: Set<string>
}) {
  const { maxLaneCount, rows } = buildGitCommitGraphRows(lines)
  const graphWidth = Math.max(24, maxLaneCount * GIT_GRAPH_LANE_WIDTH + 4)
  const rowValues = rows.map((row, index) => gitCommitGraphRowValue(row, index))
  const [openCommitValues, setOpenCommitValues] = React.useState<Array<string>>(
    []
  )
  const visibleOpenCommitValues = openCommitValues.filter((value) =>
    rowValues.includes(value)
  )
  const rowHeights = gitCommitGraphRowHeights(rows, visibleOpenCommitValues)

  return (
    <div className="relative min-w-0">
      <GitCommitPageGraph
        lines={lines}
        openCommitValues={visibleOpenCommitValues}
        unpushedCommitShortHashes={unpushedCommitShortHashes}
      />
      <Accordion
        multiple
        value={visibleOpenCommitValues}
        onValueChange={(values) => {
          setOpenCommitValues(values.slice(-1))
        }}
        className="grid min-w-0 gap-0"
      >
        {lines.map((line, index) => (
          <div
            key={`${index}:${line}`}
            className="min-w-0"
            style={{
              minHeight: rowHeights[index] ?? GIT_GRAPH_ROW_HEIGHT,
            }}
          >
            <GitCommitRow
              graphWidth={graphWidth}
              line={line}
              value={rowValues[index] ?? `${index}`}
            />
          </div>
        ))}
      </Accordion>
    </div>
  )
}

function GitCommitsSection({
  viewerContextId,
  cwd,
  active,
  embedded = false,
  flush = false,
}: GitScopedProps & {
  embedded?: boolean
  flush?: boolean
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const [commitsLimit, setCommitsLimit] = React.useState(GIT_COMMITS_PAGE_SIZE)
  const commitsLoadMoreRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    setCommitsLimit(GIT_COMMITS_PAGE_SIZE)
  }, [normalizedCwd])
  const commitsScopeQueryKey = picoQueryKeys.gitCommits(
    viewerContextId,
    normalizedCwd
  )
  const commitsQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
      commitsLimit,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey
      const sameCommitScope = commitsScopeQueryKey.every(
        (part, index) => previousKey?.[index] === part
      )
      return sameCommitScope ? previousData : undefined
    },
    notifyOnChangeProps: ["data", "isFetching", "isPending", "error"],
  })
  const commitsData = commitsQuery.data
  const commits = commitsData?.commits
  const commitsHasMore = Boolean(commitsData?.commitsHasMore)
  const meta = Array.isArray(commits) ? gitCommitsSummaryText(commits) : ""
  const unpushedCommitShortHashes = new Set(
    commitsData?.unpushedCommitShortHashes ?? []
  )
  React.useEffect(() => {
    const target = commitsLoadMoreRef.current
    if (
      !target ||
      !active ||
      !commitsHasMore ||
      commitsQuery.isFetching ||
      typeof IntersectionObserver === "undefined"
    ) {
      return
    }

    let requestedNextPage = false
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || requestedNextPage) return

        requestedNextPage = true
        setCommitsLimit((value) => value + GIT_COMMITS_PAGE_SIZE)
      },
      { rootMargin: "320px 0px" }
    )
    observer.observe(target)

    return () => observer.disconnect()
  }, [active, commitsHasMore, commitsQuery.isFetching, normalizedCwd])
  const content = !normalizedCwd ? (
    <GitSectionNote className="px-3 py-2.5">
      No directory selected.
    </GitSectionNote>
  ) : !viewerContextId ? (
    <GitSectionNote className="px-3 py-2.5">
      Waiting for viewer context…
    </GitSectionNote>
  ) : (commitsQuery.isPending && typeof commits === "undefined") ||
    (commitsQuery.isFetching && commits === null) ? (
    <GitSectionNote className="px-3 py-2.5">
      <Spinner /> Loading commits…
    </GitSectionNote>
  ) : commitsQuery.error ? (
    <GitSectionNote tone="destructive" className="px-3 py-2.5">
      {getErrorMessage(commitsQuery.error, "Failed to load commits")}
    </GitSectionNote>
  ) : commits === null ? (
    <GitSectionNote className="px-3 py-2.5">
      No git repository detected.
    </GitSectionNote>
  ) : Array.isArray(commits) && commits.length > 0 ? (
    <div className="grid min-w-0 gap-3">
      <GitCommitRows
        lines={commits}
        unpushedCommitShortHashes={unpushedCommitShortHashes}
      />
      {commitsHasMore ? (
        <div ref={commitsLoadMoreRef} className="flex">
          <button
            type="button"
            className="inline-flex h-8 w-fit items-center justify-center rounded-md border border-border/80 bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={commitsQuery.isFetching}
            onClick={() => {
              setCommitsLimit((value) => value + GIT_COMMITS_PAGE_SIZE)
            }}
          >
            {commitsQuery.isFetching ? "Loading more…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  ) : (
    <GitSectionNote className="px-3 py-2.5">
      No commits on this branch yet.
    </GitSectionNote>
  )

  if (embedded) {
    return <div className="grid min-w-0 gap-2 overflow-x-hidden">{content}</div>
  }

  if (flush) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background">
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
        <div className="grid min-h-0 min-w-0 flex-1 gap-2 overflow-x-hidden overflow-y-auto">
          {content}
        </div>
      </section>
    )
  }

  return (
    <GitSection
      title="Commits"
      meta={meta}
      className="overflow-x-hidden"
      bodyClassName="min-w-0 overflow-x-hidden p-0"
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
    onSuccess: async (response, action) => {
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
      if (action !== "pull") {
        showGitPushSuccessToast({
          response,
          force: action === "force-push",
        })
      }
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
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "push"
    ),
  })
  const shortcutForcePushMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "force-push"
    ),
  })
  const shortcutPullMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "pull"
    ),
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
  const showMobilePush =
    isMobile && !canCommit && canPush && (!gitActionBusy || pushing)
  const showPush = !isMobile && canPush && (!gitActionBusy || pushing)
  const showForcePush =
    !isMobile && canForcePush && (!gitActionBusy || forcePushing)
  const showPull = !isMobile && canPull && (!gitActionBusy || pulling)
  const showActions =
    canCommit || showMobilePush || showPush || showForcePush || showPull

  if (!showActions && !commitDialogOpen) return null

  return (
    <>
      {showActions ? (
        <div className="flex items-center gap-1">
          {canCommit ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="ghost"
                size="icon"
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
                className="hidden md:inline-flex"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon /> Commit…
              </Button>
            </TitleTooltip>
          ) : null}
          {showMobilePush ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Push changes"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("push")
                }}
              >
                {pushing ? <Spinner /> : <UploadIcon />}
              </Button>
            </TitleTooltip>
          ) : null}
          {showPush ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="ghost"
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

export function RightSidebar({
  viewerContextId,
  cwd,
  active,
  activeFilePath = "",
  activeTab: controlledActiveTab,
  filePreviewPath = "",
  fileTabs = [],
  fileTreeCollapsed = false,
  onActiveFileChange,
  onActiveTabChange,
  onCloseAllFiles,
  onCloseFile,
  onCloseFilesToRight,
  onCloseOtherFiles,
  onFileTreeCollapsedChange,
  onOpenFile,
  onReorderFiles,
  showToolbar = true,
}: RightSidebarProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    React.useState<RightSidebarTabValue>("review")
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const setActiveTab = (tab: RightSidebarTabValue) => {
    setUncontrolledActiveTab(tab)
    onActiveTabChange?.(tab)
  }
  const [inlineActiveFilePath, setInlineActiveFilePath] = React.useState("")
  const [openFileDialogOpen, setOpenFileDialogOpen] = React.useState(false)
  const previewMode: ProjectFilesPreviewMode = isMobile ? "inline" : "external"
  const panelHasCardChrome = showToolbar && !isMobile
  const currentFilePath =
    previewMode === "inline" ? inlineActiveFilePath : activeFilePath
  const hasOpenFileTabs = fileTabs.length > 0
  const fileDialogTreeQuery = useQuery({
    ...projectFileTreeQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(
      active && hasOpenFileTabs && viewerContextId && normalizedCwd
    ),
    select: (data) => data.paths,
    notifyOnChangeProps: ["data"],
  })
  const fileDialogPaths = fileDialogTreeQuery.data ?? []

  const openFile = (path: string, options?: OpenProjectFileOptions) => {
    if (!path) return
    setActiveTab("files")
    if (previewMode === "inline") {
      setInlineActiveFilePath(path)
      return
    }
    onOpenFile?.(path, options)
    onActiveFileChange?.(path)
  }

  React.useEffect(() => {
    if (!controlledActiveTab) {
      setUncontrolledActiveTab("review")
    }
  }, [controlledActiveTab, isMobile, normalizedCwd])

  React.useEffect(() => {
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
        <RightSidebarTabStrip
          activeFilePath={currentFilePath}
          activeTab={activeTab}
          filePreviewPath={filePreviewPath}
          fileTabs={fileTabs}
          onActiveFileChange={onActiveFileChange}
          onActiveTabChange={setActiveTab}
          onCloseAllFiles={onCloseAllFiles}
          onCloseFile={onCloseFile}
          onCloseFilesToRight={onCloseFilesToRight}
          onCloseOtherFiles={onCloseOtherFiles}
          onOpenFileDialog={() => {
            setOpenFileDialogOpen(true)
          }}
          onReorderFiles={onReorderFiles}
          showReview
        />
        <React.Activity mode={activeTab === "review" ? "visible" : "hidden"}>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileReviewContent
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "review"}
              onOpenFile={openFile}
            />
          </div>
        </React.Activity>
        <React.Activity mode={activeTab === "files" ? "visible" : "hidden"}>
          <div className="min-h-0 flex-1 overflow-hidden">
            {previewMode === "external" && hasOpenFileTabs ? (
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                {currentFilePath ? (
                  <FilePathBreadcrumb
                    path={currentFilePath}
                    fileTreeCollapsed={fileTreeCollapsed}
                    onFileTreeCollapsedChange={onFileTreeCollapsedChange}
                  />
                ) : null}
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  {fileTreeCollapsed ? null : (
                    <ProjectFileTreePane
                      viewerContextId={viewerContextId}
                      cwd={normalizedCwd}
                      active={active && activeTab === "files"}
                      activeFilePath={currentFilePath}
                      onOpenFile={openFile}
                      previewMode={previewMode}
                    />
                  )}
                  {currentFilePath ? (
                    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                      <ProjectFileContent
                        viewerContextId={viewerContextId}
                        cwd={normalizedCwd}
                        active={active && activeTab === "files"}
                        path={currentFilePath}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
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
            )}
          </div>
        </React.Activity>
        <ProjectOpenFileDialog
          open={openFileDialogOpen}
          onOpenChange={setOpenFileDialogOpen}
          paths={fileDialogPaths}
          onOpenFile={(path) => {
            openFile(path, { pin: true })
          }}
        />
      </div>
    </div>
  )
}
