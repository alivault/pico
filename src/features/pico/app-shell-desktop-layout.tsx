import * as React from "react"

import { resizeRailPrimaryInteractiveClass } from "@/components/ui/resize-rail"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLatestRef, sameStringArray } from "@/features/pico/app-shell-common"
import {
  AppShellSessionContent,
  type AppShellSessionContentProps,
} from "@/features/pico/app-shell-session-content"
import type { ComposerDiffLineComment } from "@/features/pico/app-shell-composer-state"
import type { AppShellUiState } from "@/features/pico/app-shell-types"
import { GitTabStatusText } from "@/features/pico/right-sidebar-git-header-actions"
import { RightSidebar } from "@/features/pico/right-sidebar"
import {
  selectRightSidebarHasVisibleFiles,
  selectRightSidebarVisibleFileTabs,
  setRightSidebarActiveTab,
  type AppShellRightSidebarState,
  type OpenFileViewTabOptions,
} from "@/features/pico/app-shell-right-sidebar-state"
import {
  applyStoreAction,
  setStoreField,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  getSidebarHorizontalResizeCursor,
  getSidebarResizeTargetMinimumSize,
  installGlobalResizeCursor,
  type SidebarHorizontalResizeCursor,
} from "@/hooks/use-sidebar-resize"
import {
  RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico"
import type { SessionState } from "@/lib/pico"

function AppShellTabsList({
  sessionStore,
  viewerContextId,
}: {
  sessionStore: PicoStore<SessionState>
  viewerContextId: string
}) {
  const cwd = useSelector(sessionStore, (sessionState) => sessionState.cwd)

  return (
    <TabsList className="w-full gap-2 rounded-none border-b border-border/70 bg-background p-2 group-data-horizontal/tabs:h-auto md:hidden">
      <TabsTrigger
        value="session"
        className="h-8 data-active:bg-muted dark:data-active:bg-muted"
      >
        Session
      </TabsTrigger>
      <TabsTrigger
        value="git"
        className="h-8 data-active:bg-muted dark:data-active:bg-muted"
      >
        <GitTabStatusText viewerContextId={viewerContextId} cwd={cwd} />
      </TabsTrigger>
    </TabsList>
  )
}

const AppShellGitPanelController = React.memo(
  function AppShellGitPanelController({
    active,
    composerDiffLineComments,
    onAddDiffLineComment,
    onCloseAllFiles,
    onCloseFile,
    onCloseFilesToRight,
    onCloseOtherFiles,
    onOpenFile,
    onReorderFiles,
    rightSidebarStore,
    sessionStore,
    viewerContextId,
  }: {
    active: boolean
    composerDiffLineComments: Array<ComposerDiffLineComment>
    onAddDiffLineComment: (
      comment: Omit<ComposerDiffLineComment, "cwd" | "id">
    ) => void
    onCloseAllFiles: () => void
    onCloseFile: (path: string) => void
    onCloseFilesToRight: (path: string) => void
    onCloseOtherFiles: (path: string) => void
    onOpenFile: (path: string, options?: OpenFileViewTabOptions) => void
    onReorderFiles: (paths: Array<string>) => void
    rightSidebarStore: PicoStore<AppShellRightSidebarState>
    sessionStore: PicoStore<SessionState>
    viewerContextId: string
  }) {
    const cwd = useSelector(sessionStore, (sessionState) => sessionState.cwd)
    const activeFilePath = useSelector(
      rightSidebarStore,
      (state) => state.fileActivePath
    )
    const activeTab = useSelector(rightSidebarStore, (state) => state.activeTab)
    const filePreviewPath = useSelector(
      rightSidebarStore,
      (state) => state.filePreviewPath
    )
    const fileTabs = useSelector(
      rightSidebarStore,
      selectRightSidebarVisibleFileTabs,
      { compare: sameStringArray }
    )
    const fileTreeCollapsed = useSelector(
      rightSidebarStore,
      (state) => state.fileTreeCollapsed
    )

    return (
      <RightSidebar
        viewerContextId={viewerContextId}
        cwd={cwd}
        active={active}
        activeFilePath={activeFilePath}
        activeTab={activeTab}
        diffLineComments={composerDiffLineComments}
        filePreviewPath={filePreviewPath}
        fileTabs={fileTabs}
        fileTreeCollapsed={fileTreeCollapsed}
        onActiveFileChange={(path) => {
          setStoreField(rightSidebarStore, "fileActivePath", path)
        }}
        onActiveTabChange={(tab) => {
          setRightSidebarActiveTab(rightSidebarStore, tab)
        }}
        onAddDiffLineComment={onAddDiffLineComment}
        onCloseAllFiles={onCloseAllFiles}
        onCloseFile={onCloseFile}
        onCloseFilesToRight={onCloseFilesToRight}
        onCloseOtherFiles={onCloseOtherFiles}
        onFileTreeCollapsedChange={(collapsed) => {
          setStoreField(rightSidebarStore, "fileTreeCollapsed", collapsed)
        }}
        onOpenFile={onOpenFile}
        onReorderFiles={onReorderFiles}
      />
    )
  }
)

function AppShellDesktopGitPanel({
  active,
  composerDiffLineComments,
  onAddDiffLineComment,
  onCloseAllFiles,
  onCloseFile,
  onCloseFilesToRight,
  onCloseOtherFiles,
  onOpenFile,
  onReorderFiles,
  rightSidebarStore,
  sessionStore,
  viewerContextId,
}: {
  active: boolean
  composerDiffLineComments: Array<ComposerDiffLineComment>
  onAddDiffLineComment: (
    comment: Omit<ComposerDiffLineComment, "cwd" | "id">
  ) => void
  onCloseAllFiles: () => void
  onCloseFile: (path: string) => void
  onCloseFilesToRight: (path: string) => void
  onCloseOtherFiles: (path: string) => void
  onOpenFile: (path: string, options?: OpenFileViewTabOptions) => void
  onReorderFiles: (paths: Array<string>) => void
  rightSidebarStore: PicoStore<AppShellRightSidebarState>
  sessionStore: PicoStore<SessionState>
  viewerContextId: string
}) {
  const cwd = useSelector(sessionStore, (sessionState) => sessionState.cwd)
  const activeFilePath = useSelector(
    rightSidebarStore,
    (state) => state.fileActivePath
  )
  const activeTab = useSelector(rightSidebarStore, (state) => state.activeTab)
  const filePreviewPath = useSelector(
    rightSidebarStore,
    (state) => state.filePreviewPath
  )
  const fileTabs = useSelector(
    rightSidebarStore,
    selectRightSidebarVisibleFileTabs,
    { compare: sameStringArray }
  )
  const fileTreeCollapsed = useSelector(
    rightSidebarStore,
    (state) => state.fileTreeCollapsed
  )

  return (
    <aside
      aria-label="Right sidebar"
      aria-hidden={!active}
      data-state={active ? "open" : "closed"}
      className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border/70 bg-background data-[state=closed]:pointer-events-none data-[state=closed]:border-transparent"
    >
      <RightSidebar
        viewerContextId={viewerContextId}
        cwd={cwd}
        active={active}
        activeFilePath={activeFilePath}
        activeTab={activeTab}
        diffLineComments={composerDiffLineComments}
        filePreviewPath={filePreviewPath}
        fileTabs={fileTabs}
        fileTreeCollapsed={fileTreeCollapsed}
        onActiveFileChange={(path) => {
          setStoreField(rightSidebarStore, "fileActivePath", path)
        }}
        onActiveTabChange={(tab) => {
          setRightSidebarActiveTab(rightSidebarStore, tab)
        }}
        onAddDiffLineComment={onAddDiffLineComment}
        onCloseAllFiles={onCloseAllFiles}
        onCloseFile={onCloseFile}
        onCloseFilesToRight={onCloseFilesToRight}
        onCloseOtherFiles={onCloseOtherFiles}
        onFileTreeCollapsedChange={(collapsed) => {
          setStoreField(rightSidebarStore, "fileTreeCollapsed", collapsed)
        }}
        onOpenFile={onOpenFile}
        onReorderFiles={onReorderFiles}
        showToolbar={false}
      />
    </aside>
  )
}

const DESKTOP_DEFAULT_FILE_VIEW_WIDTH = 520
const DESKTOP_DEFAULT_GIT_PANEL_WIDTH = 320
const DESKTOP_MIN_SESSION_WIDTH = 320
const DESKTOP_MIN_SIDE_PANEL_WIDTH = 260
const DESKTOP_MAX_STORED_SIDE_PANEL_WIDTH = 1600

type DesktopSidePanelWidths = {
  fileViewWidth: number
  gitPanelWidth: number
}

function defaultDesktopSidePanelWidths(): DesktopSidePanelWidths {
  return {
    fileViewWidth: DESKTOP_DEFAULT_FILE_VIEW_WIDTH,
    gitPanelWidth: DESKTOP_DEFAULT_GIT_PANEL_WIDTH,
  }
}

function clampStoredDesktopPanelWidth(value: unknown, fallback: number) {
  const width = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(width)) return fallback

  return Math.round(
    Math.min(
      DESKTOP_MAX_STORED_SIDE_PANEL_WIDTH,
      Math.max(DESKTOP_MIN_SIDE_PANEL_WIDTH, width)
    )
  )
}

function normalizeDesktopSidePanelWidths(
  value: unknown
): DesktopSidePanelWidths {
  if (!value || typeof value !== "object")
    return defaultDesktopSidePanelWidths()

  const widths = value as Partial<Record<keyof DesktopSidePanelWidths, unknown>>
  return {
    fileViewWidth: clampStoredDesktopPanelWidth(
      widths.fileViewWidth,
      DESKTOP_DEFAULT_FILE_VIEW_WIDTH
    ),
    gitPanelWidth: clampStoredDesktopPanelWidth(
      widths.gitPanelWidth,
      DESKTOP_DEFAULT_GIT_PANEL_WIDTH
    ),
  }
}

function readStoredDesktopSidePanelWidths(): DesktopSidePanelWidths {
  try {
    const raw = safeLocalStorageGetItem(RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY)
    if (!raw) return defaultDesktopSidePanelWidths()

    return normalizeDesktopSidePanelWidths(JSON.parse(raw))
  } catch {
    return defaultDesktopSidePanelWidths()
  }
}

function storeDesktopSidePanelWidths(widths: DesktopSidePanelWidths) {
  safeLocalStorageSetItem(
    RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY,
    JSON.stringify(normalizeDesktopSidePanelWidths(widths))
  )
}

function sameDesktopSidePanelWidths(
  left: DesktopSidePanelWidths,
  right: DesktopSidePanelWidths
) {
  return (
    left.fileViewWidth === right.fileViewWidth &&
    left.gitPanelWidth === right.gitPanelWidth
  )
}

function clampDesktopPanelSize(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  if (max <= min) return Math.max(0, max)
  return Math.min(max, Math.max(min, value))
}

function fitDesktopSidePanelWidths({
  availableWidth,
  fileOpen,
  fileWidth,
  gitOpen,
  gitWidth,
}: {
  availableWidth: number
  fileOpen: boolean
  fileWidth: number
  gitOpen: boolean
  gitWidth: number
}) {
  const maxSideWidth = Math.max(0, availableWidth - DESKTOP_MIN_SESSION_WIDTH)

  if (!fileOpen && !gitOpen) {
    return { fileWidth: 0, gitWidth: 0, sideWidth: 0 }
  }

  if (fileOpen && !gitOpen) {
    const nextFileWidth = clampDesktopPanelSize(
      fileWidth,
      Math.min(DESKTOP_MIN_SIDE_PANEL_WIDTH, maxSideWidth),
      maxSideWidth
    )
    return { fileWidth: nextFileWidth, gitWidth: 0, sideWidth: nextFileWidth }
  }

  if (!fileOpen && gitOpen) {
    const nextGitWidth = clampDesktopPanelSize(
      gitWidth,
      Math.min(DESKTOP_MIN_SIDE_PANEL_WIDTH, maxSideWidth),
      maxSideWidth
    )
    return { fileWidth: 0, gitWidth: nextGitWidth, sideWidth: nextGitWidth }
  }

  const requestedTotal = Math.max(1, fileWidth + gitWidth)
  if (requestedTotal <= maxSideWidth) {
    return {
      fileWidth,
      gitWidth,
      sideWidth: fileWidth + gitWidth,
    }
  }

  const minWidth = Math.min(DESKTOP_MIN_SIDE_PANEL_WIDTH, maxSideWidth / 2)
  let nextFileWidth = Math.round((fileWidth / requestedTotal) * maxSideWidth)
  nextFileWidth = Math.max(
    minWidth,
    Math.min(maxSideWidth - minWidth, nextFileWidth)
  )
  const nextGitWidth = Math.max(0, maxSideWidth - nextFileWidth)

  return {
    fileWidth: nextFileWidth,
    gitWidth: nextGitWidth,
    sideWidth: nextFileWidth + nextGitWidth,
  }
}

function AppShellDesktopResizeHandle({
  label,
  max,
  min,
  onResize,
  onResizeEnd,
  onResizeStart,
  size,
}: {
  label: string
  max: number
  min: number
  onResize: (size: number) => void
  onResizeEnd?: () => void
  onResizeStart?: () => void
  size: number
}) {
  const propsRef = useLatestRef({
    max,
    min,
    onResize,
    onResizeEnd,
    onResizeStart,
    size,
  })
  const [horizontalResizeCursor, setHorizontalResizeCursor] =
    React.useState<SidebarHorizontalResizeCursor>("col-resize")
  const [resizeTargetMinimumSize, setResizeTargetMinimumSize] =
    React.useState(10)

  React.useEffect(() => {
    const updateResizeTarget = () => {
      setResizeTargetMinimumSize(getSidebarResizeTargetMinimumSize())
    }
    const coarsePointerQuery = window.matchMedia("(pointer:coarse)")

    setHorizontalResizeCursor(getSidebarHorizontalResizeCursor())
    updateResizeTarget()
    coarsePointerQuery.addEventListener("change", updateResizeTarget)
    return () => {
      coarsePointerQuery.removeEventListener("change", updateResizeTarget)
    }
  }, [])

  const horizontalResizeCursorClass =
    horizontalResizeCursor === "ew-resize"
      ? "cursor-ew-resize"
      : "cursor-col-resize"

  const resizeTo = (nextSize: number) => {
    const current = propsRef.current
    current.onResize(clampDesktopPanelSize(nextSize, current.min, current.max))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      style={
        {
          "--resize-target-width": `${resizeTargetMinimumSize}px`,
          cursor: horizontalResizeCursor,
        } as React.CSSProperties
      }
      className={`absolute inset-y-0 left-0 z-20 w-(--resize-target-width) -translate-x-1/2 touch-none bg-transparent outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 ${resizeRailPrimaryInteractiveClass} ${horizontalResizeCursorClass}`}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const delta = event.shiftKey ? 48 : 16
        resizeTo(
          propsRef.current.size + (event.key === "ArrowLeft" ? delta : -delta)
        )
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()

        const current = propsRef.current
        const startX = event.clientX
        const startSize = current.size

        const cursor = getSidebarHorizontalResizeCursor()
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        const cleanupGlobalResizeCursor = installGlobalResizeCursor(cursor)

        current.onResizeStart?.()
        Object.assign(document.body.style, {
          userSelect: "none",
          cursor,
        })

        const handlePointerMove = (moveEvent: PointerEvent) => {
          resizeTo(startSize + startX - moveEvent.clientX)
        }
        const handlePointerUp = () => {
          cleanupGlobalResizeCursor()
          Object.assign(document.body.style, {
            userSelect: previousUserSelect,
            cursor: previousCursor,
          })
          document.removeEventListener("pointermove", handlePointerMove)
          document.removeEventListener("pointerup", handlePointerUp)
          document.removeEventListener("pointercancel", handlePointerUp)
          propsRef.current.onResizeEnd?.()
        }

        document.addEventListener("pointermove", handlePointerMove)
        document.addEventListener("pointerup", handlePointerUp)
        document.addEventListener("pointercancel", handlePointerUp)
      }}
    />
  )
}

type AppShellTabsControllerProps = AppShellSessionContentProps & {
  appUiStore: PicoStore<AppShellUiState>
  composerDiffLineComments: Array<ComposerDiffLineComment>
  gitPanelOpen: boolean
  isMobile: boolean
  onCloseAllFileViewTabs: () => void
  onCloseFileViewTab: (path: string) => void
  onCloseFileViewTabsToRight: (path: string) => void
  onCloseOtherFileViewTabs: (path: string) => void
  onAddDiffLineComment: (
    comment: Omit<ComposerDiffLineComment, "cwd" | "id">
  ) => void
  onOpenFileViewTab: (path: string, options?: OpenFileViewTabOptions) => void
  onReorderFileViewTabs: (paths: Array<string>) => void
  onValueChange: (value: string) => void
  rightSidebarStore: PicoStore<AppShellRightSidebarState>
}

export function AppShellTabsController(props: AppShellTabsControllerProps) {
  return useAppShellTabsControllerView(props)
}

function useAppShellTabsControllerView({
  actionsRef,
  appUiStore,
  awaitingFirstTurn,
  composerDiffLineComments,
  composerPanelRef,
  contextUsageStore,
  conversationFrameRef,
  conversationItemsStore,
  defaultNewSessionDirectory,
  displaySettingsStore,
  fileInputRef,
  gitPanelOpen,
  hiddenThinkingPreviewStore,
  isSessionViewLoading,
  isSubmitting,
  isMobile,
  newSessionDirectoryOptions,
  onCancelCompaction,
  onCreateSession,
  onOpenAddDirectoryDialog,
  onCloseAllFileViewTabs,
  onCloseFileViewTab,
  onCloseFileViewTabsToRight,
  onCloseOtherFileViewTabs,
  onAddDiffLineComment,
  onOpenFileViewTab,
  onReorderFileViewTabs,
  onValueChange,
  rightSidebarStore,
  sessionStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellTabsControllerProps) {
  const currentTab = useSelector(appUiStore, (state) => state.currentTab)
  const isDraftSession = useSelector(
    sessionStore,
    (sessionState) => sessionState.draft
  )
  const showTabsList = isMobile || !isDraftSession || isSessionViewLoading
  const sessionVisibleClassName =
    currentTab === "git"
      ? "hidden min-h-0 flex-1 flex-col md:flex"
      : "flex min-h-0 flex-1 flex-col"
  const mobileGitClassName =
    currentTab === "git" ? "min-h-0 flex-1 overflow-hidden md:hidden" : "hidden"
  const rightSidebarHasVisibleFiles = useSelector(
    rightSidebarStore,
    selectRightSidebarHasVisibleFiles
  )
  const desktopGitPanelOpen = !isMobile && gitPanelOpen
  const desktopFileViewOpen =
    !isMobile && gitPanelOpen && rightSidebarHasVisibleFiles
  const desktopSideWorkspaceOpen = desktopFileViewOpen || desktopGitPanelOpen
  const desktopLayoutRef = React.useRef<HTMLDivElement | null>(null)
  const [desktopLayoutWidth, setDesktopLayoutWidth] = React.useState(0)
  const [desktopSidePanelWidths, setDesktopSidePanelWidthsState] =
    React.useState<DesktopSidePanelWidths>(() =>
      defaultDesktopSidePanelWidths()
    )
  const desktopSidePanelWidthsLoadedRef = React.useRef(false)
  const desktopSidePanelWidthsRef = React.useRef(desktopSidePanelWidths)
  desktopSidePanelWidthsRef.current = desktopSidePanelWidths
  const desktopFileViewWidth = desktopSidePanelWidths.fileViewWidth
  const desktopGitPanelWidth = desktopSidePanelWidths.gitPanelWidth
  const setDesktopSidePanelWidths = (
    action: React.SetStateAction<DesktopSidePanelWidths>
  ) => {
    const current = desktopSidePanelWidthsRef.current
    const next = normalizeDesktopSidePanelWidths(
      applyStoreAction(current, action)
    )
    if (sameDesktopSidePanelWidths(current, next)) return

    desktopSidePanelWidthsRef.current = next
    setDesktopSidePanelWidthsState(next)
    if (desktopSidePanelWidthsLoadedRef.current) {
      storeDesktopSidePanelWidths(next)
    }
  }
  const setDesktopFileViewWidth = (action: React.SetStateAction<number>) => {
    setDesktopSidePanelWidths((current) => ({
      ...current,
      fileViewWidth: clampStoredDesktopPanelWidth(
        applyStoreAction(current.fileViewWidth, action),
        DESKTOP_DEFAULT_FILE_VIEW_WIDTH
      ),
    }))
  }
  const setDesktopGitPanelWidth = (action: React.SetStateAction<number>) => {
    setDesktopSidePanelWidths((current) => ({
      ...current,
      gitPanelWidth: clampStoredDesktopPanelWidth(
        applyStoreAction(current.gitPanelWidth, action),
        DESKTOP_DEFAULT_GIT_PANEL_WIDTH
      ),
    }))
  }
  const [desktopGitPanelMounted, setDesktopGitPanelMounted] =
    React.useState(desktopGitPanelOpen)
  const [desktopPanelResizing, setDesktopPanelResizing] = React.useState(false)

  React.useEffect(() => {
    const storedWidths = readStoredDesktopSidePanelWidths()
    desktopSidePanelWidthsLoadedRef.current = true
    desktopSidePanelWidthsRef.current = storedWidths
    setDesktopSidePanelWidthsState((current) =>
      sameDesktopSidePanelWidths(current, storedWidths) ? current : storedWidths
    )
  }, [])

  const sessionPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className={sessionVisibleClassName}>
        <AppShellSessionContent
          actionsRef={actionsRef}
          awaitingFirstTurn={awaitingFirstTurn}
          composerPanelRef={composerPanelRef}
          contextUsageStore={contextUsageStore}
          conversationFrameRef={conversationFrameRef}
          conversationItemsStore={conversationItemsStore}
          defaultNewSessionDirectory={defaultNewSessionDirectory}
          displaySettingsStore={displaySettingsStore}
          fileInputRef={fileInputRef}
          hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
          isSessionViewLoading={isSessionViewLoading}
          isSubmitting={isSubmitting}
          newSessionDirectoryOptions={newSessionDirectoryOptions}
          onCancelCompaction={onCancelCompaction}
          onCreateSession={onCreateSession}
          onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
          sessionStore={sessionStore}
          store={store}
          viewerContextId={viewerContextId}
          workingStateStore={workingStateStore}
        />
      </div>

      {isMobile ? (
        <div className={mobileGitClassName}>
          <AppShellGitPanelController
            viewerContextId={viewerContextId}
            sessionStore={sessionStore}
            active={currentTab === "git"}
            composerDiffLineComments={composerDiffLineComments}
            rightSidebarStore={rightSidebarStore}
            onAddDiffLineComment={onAddDiffLineComment}
            onCloseAllFiles={onCloseAllFileViewTabs}
            onCloseFile={onCloseFileViewTab}
            onCloseFilesToRight={onCloseFileViewTabsToRight}
            onCloseOtherFiles={onCloseOtherFileViewTabs}
            onOpenFile={onOpenFileViewTab}
            onReorderFiles={onReorderFileViewTabs}
          />
        </div>
      ) : null}
    </div>
  )

  React.useLayoutEffect(() => {
    if (isMobile) {
      setDesktopGitPanelMounted(false)
      return
    }

    if (desktopSideWorkspaceOpen) {
      setDesktopGitPanelMounted(true)
    }
  }, [desktopSideWorkspaceOpen, isMobile])

  React.useLayoutEffect(() => {
    if (isMobile) return

    const element = desktopLayoutRef.current
    if (!element) return

    const updateWidth = () => {
      setDesktopLayoutWidth(element.clientWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth)
      return () => window.removeEventListener("resize", updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [isMobile])

  const desktopAvailableWidth =
    desktopLayoutWidth ||
    (typeof window === "undefined" ? 1200 : window.innerWidth)
  const desktopGitPanelRendered =
    desktopSideWorkspaceOpen || desktopGitPanelMounted || desktopGitPanelOpen
  const desktopFittedWidths = fitDesktopSidePanelWidths({
    availableWidth: desktopAvailableWidth,
    fileOpen: desktopFileViewOpen,
    fileWidth: desktopFileViewWidth,
    gitOpen: desktopGitPanelOpen,
    gitWidth: desktopGitPanelWidth,
  })
  const desktopSideWorkspaceRendered =
    desktopSideWorkspaceOpen || desktopGitPanelMounted
  const desktopSideWorkspaceWidth = desktopSideWorkspaceOpen
    ? desktopFittedWidths.sideWidth
    : 0
  const desktopTransitionClassName = !desktopPanelResizing
    ? "transition-[width] duration-200 ease-linear"
    : ""
  const desktopPanelGroupClassName =
    "relative flex h-full min-h-0 w-full flex-1 overflow-hidden"
  const desktopResizeStart = () => {
    setDesktopPanelResizing(true)
  }
  const desktopResizeEnd = () => {
    setDesktopPanelResizing(false)
  }
  const desktopSideWorkspaceMaxWidth = Math.max(
    0,
    desktopAvailableWidth - DESKTOP_MIN_SESSION_WIDTH
  )
  const setDesktopSideWorkspaceWidth = (nextSize: number) => {
    if (!desktopFileViewOpen) {
      setDesktopGitPanelWidth(nextSize)
      return
    }

    setDesktopFileViewWidth(
      Math.max(DESKTOP_MIN_SIDE_PANEL_WIDTH, nextSize - desktopGitPanelWidth)
    )
  }

  return (
    <Tabs
      value={currentTab}
      onValueChange={onValueChange}
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      {showTabsList ? (
        <AppShellTabsList
          sessionStore={sessionStore}
          viewerContextId={viewerContextId}
        />
      ) : null}

      {isMobile ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">{sessionPane}</div>
      ) : (
        <div ref={desktopLayoutRef} className={desktopPanelGroupClassName}>
          <div
            data-desktop-panel="session"
            className={`h-full min-h-0 min-w-0 shrink-0 overflow-hidden ${desktopTransitionClassName}`}
            style={{
              width: desktopSideWorkspaceOpen
                ? `calc(100% - ${desktopSideWorkspaceWidth}px)`
                : "100%",
            }}
          >
            {sessionPane}
          </div>

          {desktopSideWorkspaceRendered ? (
            <aside
              aria-label="Desktop side workspace"
              aria-hidden={!desktopSideWorkspaceOpen}
              data-state={desktopSideWorkspaceOpen ? "open" : "closed"}
              data-desktop-panel="side-workspace"
              className={`flex h-full min-h-0 min-w-0 shrink-0 overflow-visible bg-background data-[state=closed]:pointer-events-none ${desktopTransitionClassName}`}
              style={{ width: `${desktopSideWorkspaceWidth}px` }}
            >
              {desktopGitPanelRendered ? (
                <div
                  data-desktop-panel="git"
                  className={`relative h-full min-h-0 min-w-0 shrink-0 overflow-visible ${desktopTransitionClassName}`}
                  style={{ width: `${desktopSideWorkspaceWidth}px` }}
                >
                  {desktopGitPanelOpen ? (
                    <AppShellDesktopResizeHandle
                      label="Resize right sidebar"
                      min={Math.min(
                        DESKTOP_MIN_SIDE_PANEL_WIDTH,
                        desktopSideWorkspaceMaxWidth
                      )}
                      max={desktopSideWorkspaceMaxWidth}
                      size={desktopSideWorkspaceWidth}
                      onResize={setDesktopSideWorkspaceWidth}
                      onResizeStart={desktopResizeStart}
                      onResizeEnd={desktopResizeEnd}
                    />
                  ) : null}
                  <div className="h-full min-h-0 min-w-0 overflow-hidden">
                    {desktopGitPanelRendered ? (
                      <AppShellDesktopGitPanel
                        viewerContextId={viewerContextId}
                        sessionStore={sessionStore}
                        active={desktopGitPanelOpen}
                        composerDiffLineComments={composerDiffLineComments}
                        rightSidebarStore={rightSidebarStore}
                        onAddDiffLineComment={onAddDiffLineComment}
                        onCloseAllFiles={onCloseAllFileViewTabs}
                        onCloseFile={onCloseFileViewTab}
                        onCloseFilesToRight={onCloseFileViewTabsToRight}
                        onCloseOtherFiles={onCloseOtherFileViewTabs}
                        onOpenFile={onOpenFileViewTab}
                        onReorderFiles={onReorderFileViewTabs}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </Tabs>
  )
}
