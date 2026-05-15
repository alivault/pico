import * as React from "react"
import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  Undo2Icon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { resizeRailPrimaryInteractiveClass } from "@/components/ui/resize-rail"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import {
  ProjectFileIconSprite,
  ProjectFileTypeIcon,
} from "@/features/pico/right-sidebar-file-icons"
import { GitCommitsSection } from "@/features/pico/right-sidebar-git-commits"
import {
  GIT_REVIEW_FULL_CONTEXT_CHANGED_LINE_THRESHOLD,
  GIT_REVIEW_FULL_CONTEXT_SIZE_THRESHOLD_BYTES,
  gitChangesQueryOptions,
  gitFileDiffQueryOptions,
  gitFileHasLineChanges,
  gitFileLineChangeValue,
  gitFileReviewQueryOptions,
  gitFileStatusCharacters,
  gitFileStatusTone,
  gitFileStatusToneClass,
  gitFileStatusTooltip,
  invalidateGitQueries,
  selectGitFiles,
} from "@/features/pico/right-sidebar-git-data"
import { GitPanelToolbar } from "@/features/pico/right-sidebar-git-toolbar"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  GitCommitDiffTabRequest,
  GitScopedProps,
} from "@/features/pico/right-sidebar-types"
import {
  getStuckScrollTriggerValue,
  hasScrolledContent,
  setDerivedScrollState,
} from "@/features/pico/scroll-shadow-utils"
import {
  RIGHT_SIDEBAR_HISTORY_HEIGHT_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico"
import type { GitActionResponse, GitChangeFile } from "@/lib/pico/api"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  getSidebarVerticalResizeCursor,
  installGlobalResizeCursor,
  type SidebarVerticalResizeCursor,
} from "@/hooks/use-sidebar-resize"
import { cn } from "@/lib/utils"

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

type ReviewDiffStyle = "unified" | "split"

const GIT_HISTORY_PANEL_MIN_HEIGHT = 160
const GIT_HISTORY_PANEL_MAX_STORED_HEIGHT = 1600

function clampStoredGitHistoryPanelHeight(height: number) {
  if (!Number.isFinite(height)) return undefined

  return Math.round(
    Math.min(
      GIT_HISTORY_PANEL_MAX_STORED_HEIGHT,
      Math.max(GIT_HISTORY_PANEL_MIN_HEIGHT, height)
    )
  )
}

function readStoredGitHistoryPanelHeight() {
  const storedHeight = safeLocalStorageGetItem(
    RIGHT_SIDEBAR_HISTORY_HEIGHT_STORAGE_KEY
  )
  if (storedHeight == null) return undefined

  return clampStoredGitHistoryPanelHeight(Number(storedHeight))
}

function storeGitHistoryPanelHeight(height: number) {
  const nextHeight = clampStoredGitHistoryPanelHeight(height)
  if (typeof nextHeight !== "number") return

  safeLocalStorageSetItem(
    RIGHT_SIDEBAR_HISTORY_HEIGHT_STORAGE_KEY,
    String(nextHeight)
  )
}

type FileReviewState = {
  diffStyle: ReviewDiffStyle
  historyOpen: boolean
  historyPanelHeight?: number
  defaultHistoryPanelHeight?: number
  openFiles: Array<string>
  stickyReviewFileValue: string
  historyHeaderShadowed: boolean
}

type FileReviewAction =
  | { type: "diffStyleChanged"; diffStyle: ReviewDiffStyle }
  | { type: "historyOpenToggled" }
  | { type: "historyPanelHeightChanged"; height: number }
  | {
      type: "historyPanelLayoutChanged"
      defaultHeight?: number
      maxHeight: number
      minHeight: number
    }
  | { type: "openFilesChanged"; openFiles: Array<string> }
  | { type: "cwdChanged"; historyPanelHeight?: number }
  | {
      type: "stickyReviewFileValueChanged"
      value: React.SetStateAction<string>
    }
  | {
      type: "historyHeaderShadowedChanged"
      value: React.SetStateAction<boolean>
    }

const initialFileReviewState: FileReviewState = {
  diffStyle: "unified",
  historyOpen: true,
  historyPanelHeight: undefined,
  defaultHistoryPanelHeight: undefined,
  openFiles: [],
  stickyReviewFileValue: "",
  historyHeaderShadowed: false,
}

function applyStateAction<T>(current: T, value: React.SetStateAction<T>) {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value
}

function fileReviewReducer(
  state: FileReviewState,
  action: FileReviewAction
): FileReviewState {
  switch (action.type) {
    case "diffStyleChanged":
      return state.diffStyle === action.diffStyle
        ? state
        : { ...state, diffStyle: action.diffStyle }
    case "historyOpenToggled":
      return { ...state, historyOpen: !state.historyOpen }
    case "historyPanelHeightChanged":
      return Object.is(state.historyPanelHeight, action.height)
        ? state
        : { ...state, historyPanelHeight: action.height }
    case "historyPanelLayoutChanged": {
      const historyPanelHeight =
        typeof state.historyPanelHeight === "number"
          ? Math.min(
              action.maxHeight,
              Math.max(action.minHeight, state.historyPanelHeight)
            )
          : state.historyPanelHeight

      if (
        Object.is(state.defaultHistoryPanelHeight, action.defaultHeight) &&
        Object.is(state.historyPanelHeight, historyPanelHeight)
      ) {
        return state
      }

      return {
        ...state,
        defaultHistoryPanelHeight: action.defaultHeight,
        historyPanelHeight,
      }
    }
    case "openFilesChanged":
      return state.openFiles === action.openFiles
        ? state
        : { ...state, openFiles: action.openFiles }
    case "cwdChanged":
      return {
        ...state,
        historyOpen: true,
        historyPanelHeight: action.historyPanelHeight,
        defaultHistoryPanelHeight: undefined,
        openFiles: [],
        stickyReviewFileValue: "",
        historyHeaderShadowed: false,
      }
    case "stickyReviewFileValueChanged": {
      const stickyReviewFileValue = applyStateAction(
        state.stickyReviewFileValue,
        action.value
      )
      return Object.is(state.stickyReviewFileValue, stickyReviewFileValue)
        ? state
        : { ...state, stickyReviewFileValue }
    }
    case "historyHeaderShadowedChanged": {
      const historyHeaderShadowed = applyStateAction(
        state.historyHeaderShadowed,
        action.value
      )
      return Object.is(state.historyHeaderShadowed, historyHeaderShadowed)
        ? state
        : { ...state, historyHeaderShadowed }
    }
    default:
      return state
  }
}

function subscribeSidebarVerticalResizeCursor() {
  return () => {}
}

function getServerSidebarVerticalResizeCursor(): SidebarVerticalResizeCursor {
  return "row-resize"
}

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

type FileReviewContentProps = GitScopedProps & {
  onOpenCommitDiff?: (request: GitCommitDiffTabRequest) => void
  showEmbeddedHistory?: boolean
}

export function FileReviewContent(props: FileReviewContentProps) {
  return useFileReviewContentView(props)
}

function useFileReviewContentView({
  viewerContextId,
  cwd,
  active,
  onOpenCommitDiff,
  onOpenFile,
  showEmbeddedHistory = true,
}: FileReviewContentProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [state, dispatch] = React.useReducer(
    fileReviewReducer,
    initialFileReviewState,
    (initialState) => ({
      ...initialState,
      historyPanelHeight: readStoredGitHistoryPanelHeight(),
    })
  )
  const {
    diffStyle,
    historyOpen,
    historyPanelHeight,
    defaultHistoryPanelHeight,
    openFiles,
    stickyReviewFileValue,
    historyHeaderShadowed,
  } = state
  const verticalResizeCursor = React.useSyncExternalStore(
    subscribeSidebarVerticalResizeCursor,
    getSidebarVerticalResizeCursor,
    getServerSidebarVerticalResizeCursor
  )
  const setStickyReviewFileValue: React.Dispatch<
    React.SetStateAction<string>
  > = (value) => {
    dispatch({ type: "stickyReviewFileValueChanged", value })
  }
  const setHistoryHeaderShadowed: React.Dispatch<
    React.SetStateAction<boolean>
  > = (value) => {
    dispatch({ type: "historyHeaderShadowedChanged", value })
  }
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

    dispatch({
      type: "cwdChanged",
      historyPanelHeight: readStoredGitHistoryPanelHeight(),
    })
  }, [normalizedCwd])

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
    let latestHeight = Math.min(maxHeight, Math.max(minHeight, startHeight))

    Object.assign(document.body.style, {
      cursor,
      userSelect: "none",
    })

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY)
      latestHeight = Math.min(maxHeight, Math.max(minHeight, nextHeight))
      dispatch({ type: "historyPanelHeightChanged", height: latestHeight })
    }
    const handlePointerUp = () => {
      storeGitHistoryPanelHeight(latestHeight)
      cleanupGlobalResizeCursor()
      Object.assign(document.body.style, {
        cursor: previousCursor,
        userSelect: previousUserSelect,
      })
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

      dispatch({
        type: "historyPanelLayoutChanged",
        defaultHeight:
          defaultHeight > 0
            ? Math.min(maxHeight, Math.max(minHeight, defaultHeight))
            : undefined,
        maxHeight,
        minHeight,
      })
    }

    updateDefaultHistoryPanelHeight()
    window.addEventListener("resize", updateDefaultHistoryPanelHeight)
    return () => {
      window.removeEventListener("resize", updateDefaultHistoryPanelHeight)
    }
  }, [historyOpen, isMobile, normalizedCwd])

  const hasOpenFile = openFiles.length > 0
  const toggleAll = () => {
    dispatch({
      type: "openFilesChanged",
      openFiles: hasOpenFile ? [] : changedFiles.map(reviewFileValue),
    })
  }

  return (
    <div
      ref={reviewContentRef}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <ProjectFileIconSprite />
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
          <TitleTooltip title={hasOpenFile ? "Collapse all" : "Expand all"}>
            <Button
              variant="outline"
              size="icon"
              aria-label={hasOpenFile ? "Collapse all" : "Expand all"}
              disabled={changedFiles.length === 0}
              onClick={toggleAll}
            >
              {hasOpenFile ? (
                <ChevronsDownUpIcon className="size-4" />
              ) : (
                <ChevronsUpDownIcon className="size-4" />
              )}
            </Button>
          </TitleTooltip>
          <ToggleGroup
            variant="outline"
            value={[diffStyle]}
            onValueChange={(values) => {
              const value = values[0]
              if (value === "unified" || value === "split") {
                dispatch({ type: "diffStyleChanged", diffStyle: value })
              }
            }}
          >
            {(["unified", "split"] as const).map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {value === "unified" ? "Unified" : "Split"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
            onValueChange={(nextOpenFiles) => {
              dispatch({
                type: "openFilesChanged",
                openFiles: nextOpenFiles,
              })
            }}
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
      {showEmbeddedHistory &&
      normalizedCwd &&
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
              dispatch({ type: "historyOpenToggled" })
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
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
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
                onOpenCommitDiff={onOpenCommitDiff}
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
  const queryClient = useQueryClient()
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
  const [indexStatus, worktreeStatus] = gitFileStatusCharacters(file.status)
  const canStage = worktreeStatus !== " " || indexStatus === "?"

  const invalidateChangedFileQueries = async () => {
    await invalidateGitQueries({
      queryClient,
      viewerContextId,
      cwd: normalizedCwd,
    })
  }

  const stageMutation = useMutation({
    mutationFn: async () =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-stage", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: normalizedCwd,
            path: file.path,
            previousPath: file.previousPath,
          }),
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, normalizedCwd),
        exact: true,
        refetchType: "active",
      })
      await invalidateChangedFileQueries()
      toast.success("Staged changes", { description: file.path })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to stage changes"))
    },
  })

  const discardMutation = useMutation({
    mutationFn: async () =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-discard", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: normalizedCwd,
            path: file.path,
            previousPath: file.previousPath,
            status: file.status,
          }),
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, normalizedCwd),
        exact: true,
        refetchType: "active",
      })
      await invalidateChangedFileQueries()
      toast.success("Discarded changes", { description: file.path })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to discard changes"))
    },
  })
  const actionPending = stageMutation.isPending || discardMutation.isPending

  const openFile = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation()
    onOpenFile?.(file.path, { pin: true })
  }

  const discardFileChanges = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation()
    discardMutation.mutate()
  }

  const stageFileChanges = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation()
    stageMutation.mutate()
  }

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
          <span className="grid min-w-0 flex-1 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2">
            <GitFileStatus status={file.status} />
            <ProjectFileTypeIcon path={file.path} />
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
          <ChevronRightIcon
            data-slot="accordion-trigger-icon"
            className="pointer-events-none size-4 shrink-0 group-aria-expanded/review-file-trigger:hidden"
          />
          <ChevronDownIcon
            data-slot="accordion-trigger-icon"
            className="pointer-events-none hidden size-4 shrink-0 group-aria-expanded/review-file-trigger:inline"
          />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionContent className="bg-background p-0">
        <div className="flex gap-2 border-b border-border/70 bg-card/40 p-2">
          {onOpenFile ? (
            <Button
              type="button"
              variant="outline"
              aria-label={`Open ${file.path}`}
              className="min-w-0 flex-1"
              onClick={openFile}
            >
              <ArrowUpRightIcon className="size-3.5" />
              <span>Open file</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            aria-label={`Discard changes to ${file.path}`}
            className="min-w-0 flex-1 text-muted-foreground hover:text-destructive"
            disabled={actionPending || !viewerContextId || !normalizedCwd}
            onClick={discardFileChanges}
          >
            <Undo2Icon className="size-3.5" />
            <span>Discard</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label={`Stage changes to ${file.path}`}
            className="min-w-0 flex-1 text-muted-foreground hover:text-emerald-500"
            disabled={
              actionPending || !canStage || !viewerContextId || !normalizedCwd
            }
            onClick={stageFileChanges}
          >
            <PlusIcon className="size-3.5" />
            <span>Stage</span>
          </Button>
        </div>
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
