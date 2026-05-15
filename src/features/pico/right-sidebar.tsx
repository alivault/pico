import * as React from "react"
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  FilePathBreadcrumb,
  ProjectFileContent,
  ProjectFilesWorkspace,
  ProjectFileTreePane,
  ProjectOpenFileDialog,
  RightSidebarTabStrip,
  projectFileTreeQueryOptions,
  type ProjectFilesPreviewMode,
} from "@/features/pico/right-sidebar-project-files"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { GitPanelErrorToasts } from "@/features/pico/right-sidebar-git-toolbar"
import { GitCommitsSection } from "@/features/pico/right-sidebar-git-commits"
import { FileReviewContent } from "@/features/pico/right-sidebar-git-review"
import {
  getStuckScrollTriggerValue,
  setDerivedScrollState,
} from "@/features/pico/scroll-shadow-utils"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  OpenProjectFileOptions,
  GitCommitDiffTab,
  GitCommitDiffTabRequest,
  RightSidebarProps,
  RightSidebarTabValue,
} from "@/features/pico/right-sidebar-types"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  RIGHT_SIDEBAR_HISTORY_TAB_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico"
import type { GitCommitDiffMode, GitCommitDiffResponse } from "@/lib/pico/api"
import { cn } from "@/lib/utils"

type GitCommitDiffData = Extract<GitCommitDiffResponse, { ok: true }>
type CommitDiffStyle = "unified" | "split"

const EMPTY_RIGHT_SIDEBAR_FILE_TABS: NonNullable<
  RightSidebarProps["fileTabs"]
> = []

function readStoredHistoryAsTab() {
  return safeLocalStorageGetItem(RIGHT_SIDEBAR_HISTORY_TAB_STORAGE_KEY) === "1"
}

function storeHistoryAsTab(historyAsTab: boolean) {
  safeLocalStorageSetItem(
    RIGHT_SIDEBAR_HISTORY_TAB_STORAGE_KEY,
    historyAsTab ? "1" : "0"
  )
}

function gitCommitDiffTabKey(
  commit: string,
  mode: GitCommitDiffMode,
  path = ""
) {
  return `commit-diff:${mode}:${commit}:${path}`
}

function pathBaseName(path: string) {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

function gitCommitDiffTabTitle(request: GitCommitDiffTabRequest) {
  if (request.path) {
    const leftPath = request.previousPath || request.path
    const leftRevisionLabel =
      request.leftRevisionLabel ||
      (request.mode === "head" ? request.shortHash : `${request.shortHash}^`)
    const rightRevisionLabel =
      request.rightRevisionLabel ||
      (request.mode === "head" ? "HEAD" : request.shortHash)
    return `${pathBaseName(leftPath)} (${leftRevisionLabel}) → ${pathBaseName(
      request.path
    )} (${rightRevisionLabel})`
  }
  if (request.mode === "head") return `${request.shortHash}..HEAD`
  if (request.mode === "previous") {
    return `${request.shortHash}^..${request.shortHash}`
  }
  return `Diff ${request.shortHash}`
}

function createGitCommitDiffTab(
  request: GitCommitDiffTabRequest
): GitCommitDiffTab {
  return {
    key: gitCommitDiffTabKey(request.commit, request.mode, request.path),
    commit: request.commit,
    shortHash: request.shortHash,
    title: gitCommitDiffTabTitle(request),
    mode: request.mode,
    ...(request.path ? { path: request.path } : {}),
    ...(request.previousPath ? { previousPath: request.previousPath } : {}),
    ...(request.leftRevisionLabel
      ? { leftRevisionLabel: request.leftRevisionLabel }
      : {}),
    ...(request.rightRevisionLabel
      ? { rightRevisionLabel: request.rightRevisionLabel }
      : {}),
  }
}

type RightSidebarLocalState = {
  uncontrolledActiveTab: RightSidebarTabValue
  inlineActiveFilePath: string
  openFileDialogOpen: boolean
  commitDiffTabs: Array<GitCommitDiffTab>
  activeCommitDiffKey: string
}

type RightSidebarLocalAction =
  | { type: "set-active-tab"; tab: RightSidebarTabValue }
  | { type: "set-inline-active-file"; path: string }
  | { type: "set-open-file-dialog-open"; open: boolean }
  | { type: "upsert-commit-diff-tab"; tab: GitCommitDiffTab }
  | { type: "set-active-commit-diff-key"; key: string }
  | { type: "close-commit-diff-keys"; keys: Array<string> }
  | { type: "close-other-commit-diffs"; key: string }
  | { type: "reorder-commit-diffs"; keys: Array<string> }
  | { type: "reset-navigation"; resetActiveTab: boolean }

const initialRightSidebarLocalState = {
  uncontrolledActiveTab: "review",
  inlineActiveFilePath: "",
  openFileDialogOpen: false,
  commitDiffTabs: [],
  activeCommitDiffKey: "",
} satisfies RightSidebarLocalState

function rightSidebarLocalReducer(
  state: RightSidebarLocalState,
  action: RightSidebarLocalAction
): RightSidebarLocalState {
  switch (action.type) {
    case "set-active-tab":
      return { ...state, uncontrolledActiveTab: action.tab }
    case "set-inline-active-file":
      return { ...state, inlineActiveFilePath: action.path }
    case "set-open-file-dialog-open":
      return { ...state, openFileDialogOpen: action.open }
    case "upsert-commit-diff-tab":
      return {
        ...state,
        commitDiffTabs: state.commitDiffTabs.some(
          (existing) => existing.key === action.tab.key
        )
          ? state.commitDiffTabs.map((existing) =>
              existing.key === action.tab.key ? action.tab : existing
            )
          : [...state.commitDiffTabs, action.tab],
        activeCommitDiffKey: action.tab.key,
        uncontrolledActiveTab: "commit-diff",
      }
    case "set-active-commit-diff-key":
      return { ...state, activeCommitDiffKey: action.key }
    case "close-commit-diff-keys": {
      const keySet = new Set(action.keys)
      const firstClosedIndex = state.commitDiffTabs.findIndex((tab) =>
        keySet.has(tab.key)
      )
      const nextTabs = state.commitDiffTabs.filter(
        (tab) => !keySet.has(tab.key)
      )
      const nextActive = keySet.has(state.activeCommitDiffKey)
        ? nextTabs[Math.max(0, firstClosedIndex - 1)] || nextTabs[0]
        : undefined
      return {
        ...state,
        commitDiffTabs: nextTabs,
        activeCommitDiffKey: keySet.has(state.activeCommitDiffKey)
          ? nextActive?.key || ""
          : state.activeCommitDiffKey,
        uncontrolledActiveTab: nextActive
          ? state.uncontrolledActiveTab
          : state.uncontrolledActiveTab === "commit-diff"
            ? "review"
            : state.uncontrolledActiveTab,
      }
    }
    case "close-other-commit-diffs":
      return {
        ...state,
        commitDiffTabs: state.commitDiffTabs.filter(
          (tab) => tab.key === action.key
        ),
        activeCommitDiffKey: action.key,
        uncontrolledActiveTab: "commit-diff",
      }
    case "reorder-commit-diffs": {
      const byKey = new Map(state.commitDiffTabs.map((tab) => [tab.key, tab]))
      const ordered = action.keys.flatMap((key) => {
        const tab = byKey.get(key)
        return tab ? [tab] : []
      })
      const keySet = new Set(action.keys)
      const missing = state.commitDiffTabs.filter((tab) => !keySet.has(tab.key))
      return { ...state, commitDiffTabs: [...ordered, ...missing] }
    }
    case "reset-navigation":
      return {
        ...state,
        inlineActiveFilePath: "",
        commitDiffTabs: [],
        activeCommitDiffKey: "",
        uncontrolledActiveTab: action.resetActiveTab
          ? "review"
          : state.uncontrolledActiveTab,
      }
  }
}

function commitFileDiffValue(fileDiff: FileDiffMetadata, index: number) {
  return `${index}:${fileDiff.prevName || ""}:${fileDiff.name}`
}

function commitFileDiffLineCounts(fileDiff: FileDiffMetadata) {
  return fileDiff.hunks.reduce(
    (counts, hunk) => ({
      additions: counts.additions + hunk.additionLines,
      deletions: counts.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 }
  )
}

function CommitFileDiffAccordionItem({
  diffStyle,
  fileDiff,
  index,
  stuck,
}: {
  diffStyle: CommitDiffStyle
  fileDiff: FileDiffMetadata
  index: number
  stuck: boolean
}) {
  const value = commitFileDiffValue(fileDiff, index)
  const counts = commitFileDiffLineCounts(fileDiff)

  return (
    <AccordionItem value={value} className="border-border/70">
      <AccordionPrimitive.Header
        className={cn(
          "sticky top-0 z-20 flex bg-background transition-shadow",
          stuck && "shadow-sm"
        )}
      >
        <AccordionPrimitive.Trigger
          data-commit-file-trigger
          data-commit-file-value={value}
          className="group/commit-file-trigger relative flex min-h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-none border border-transparent bg-background px-3 py-2 text-left font-mono text-[13px] font-medium transition-all outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground"
        >
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
            <span className="min-w-0 truncate text-left">
              {fileDiff.prevName ? (
                <>
                  <span className="text-muted-foreground">
                    {fileDiff.prevName}
                  </span>
                  <span className="text-muted-foreground/70"> → </span>
                  <span>{fileDiff.name}</span>
                </>
              ) : (
                fileDiff.name
              )}
            </span>
            <span className="inline-flex min-w-0 gap-2 justify-self-end whitespace-nowrap tabular-nums">
              {counts.additions > 0 ? (
                <span className="text-emerald-500">+{counts.additions}</span>
              ) : null}
              {counts.deletions > 0 ? (
                <span className="text-red-500">-{counts.deletions}</span>
              ) : null}
            </span>
          </span>
          <ChevronRightIcon
            data-slot="accordion-trigger-icon"
            className="pointer-events-none size-4 shrink-0 group-aria-expanded/commit-file-trigger:hidden"
          />
          <ChevronDownIcon
            data-slot="accordion-trigger-icon"
            className="pointer-events-none hidden size-4 shrink-0 group-aria-expanded/commit-file-trigger:inline"
          />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionContent className="bg-background p-0">
        <FileDiff
          fileDiff={fileDiff}
          disableWorkerPool
          options={{
            diffStyle,
            disableFileHeader: true,
            lineDiffType: "word-alt",
            maxLineDiffLength: 1000,
            overflow: "wrap",
          }}
        />
      </AccordionContent>
    </AccordionItem>
  )
}

function CommitSingleFileDiff({
  diffStyle,
  patch,
}: {
  diffStyle: CommitDiffStyle
  patch: string
}) {
  const fileDiff = parsePatchFiles(patch).flatMap((parsed) => parsed.files)[0]

  if (!fileDiff) {
    return (
      <div className="p-4">
        <GitSectionNote>No line changes.</GitSectionNote>
      </div>
    )
  }

  return (
    <div
      className="min-h-full text-xs"
      style={
        {
          "--diffs-font-family":
            'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
        } as React.CSSProperties
      }
    >
      <FileDiff
        fileDiff={fileDiff}
        disableWorkerPool
        options={{
          diffStyle,
          lineDiffType: "word-alt",
          maxLineDiffLength: 1000,
          overflow: "wrap",
        }}
      />
    </div>
  )
}

function CommitPatchDiffs({
  diffStyle,
  patch,
  stuckFileValue,
}: {
  diffStyle: CommitDiffStyle
  patch: string
  stuckFileValue: string
}) {
  const fileDiffs = parsePatchFiles(patch).flatMap((parsed) => parsed.files)
  const firstValue = fileDiffs[0]
    ? commitFileDiffValue(fileDiffs[0], 0)
    : undefined

  if (fileDiffs.length === 0) {
    return (
      <div className="p-4">
        <GitSectionNote>No line changes.</GitSectionNote>
      </div>
    )
  }

  return (
    <div
      className="min-h-full text-xs"
      style={
        {
          "--diffs-font-family":
            'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
        } as React.CSSProperties
      }
    >
      <Accordion
        multiple
        defaultValue={firstValue ? [firstValue] : []}
        className="border-b border-border/80"
      >
        {fileDiffs.map((fileDiff, index) => (
          <CommitFileDiffAccordionItem
            key={commitFileDiffValue(fileDiff, index)}
            diffStyle={diffStyle}
            fileDiff={fileDiff}
            index={index}
            stuck={stuckFileValue === commitFileDiffValue(fileDiff, index)}
          />
        ))}
      </Accordion>
    </div>
  )
}

function CommitDiffPathBreadcrumb({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean)

  if (parts.length === 0) return null

  return (
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
  )
}

function CommitDiffHeaderTitle({ tab }: { tab: GitCommitDiffTab }) {
  if (!tab.path) {
    return (
      <div className="min-w-0">
        <div className="truncate text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
          Commit diff
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {tab.title}
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-x-auto">
      <CommitDiffPathBreadcrumb path={tab.path} />
    </div>
  )
}

function CommitDiffContent({
  viewerContextId,
  cwd,
  active,
  tab,
}: {
  viewerContextId: string
  cwd: string
  active: boolean
  tab: GitCommitDiffTab | undefined
}) {
  const [diffStyle, setDiffStyle] = React.useState<CommitDiffStyle>("unified")
  const [stickyCommitFileValue, setStickyCommitFileValue] = React.useState("")
  const diffScrollRef = React.useRef<HTMLDivElement>(null)
  const updateStickyCommitFileHeader = (
    scrollElement: HTMLDivElement | null
  ) => {
    setDerivedScrollState(
      setStickyCommitFileValue,
      getStuckScrollTriggerValue({
        getValue: (trigger) => trigger.dataset.commitFileValue || "",
        scrollElement,
        selector: "[data-commit-file-trigger]",
      })
    )
  }
  const diffQuery = useQuery({
    queryKey: tab
      ? picoQueryKeys.gitCommitDiff(
          viewerContextId,
          cwd,
          tab.commit,
          tab.mode,
          tab.path,
          tab.previousPath
        )
      : ["pico", "git-commit-diff", viewerContextId, cwd, "", ""],
    queryFn: () =>
      fetchJson<GitCommitDiffData>(
        buildRequestUrl(
          `/api/git-commit-diff?cwd=${encodeURIComponent(cwd)}&commit=${encodeURIComponent(
            tab?.commit || ""
          )}&mode=${encodeURIComponent(tab?.mode || "commit")}${
            tab?.path ? `&path=${encodeURIComponent(tab.path)}` : ""
          }${
            tab?.previousPath
              ? `&previousPath=${encodeURIComponent(tab.previousPath)}`
              : ""
          }`,
          { contextId: viewerContextId }
        )
      ),
    enabled: Boolean(active && viewerContextId && cwd && tab?.commit),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })

  React.useEffect(() => {
    setDerivedScrollState<string>(setStickyCommitFileValue, "")
    updateStickyCommitFileHeader(diffScrollRef.current)
  }, [tab?.key, diffQuery.data?.patch])

  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a commit diff tab.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background p-2">
        <CommitDiffHeaderTitle tab={tab} />
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
          <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
          <ToggleGroupItem value="split">Split</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div
        ref={diffScrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          updateStickyCommitFileHeader(event.currentTarget)
        }}
      >
        {diffQuery.isPending && !diffQuery.data ? (
          <div className="p-4">
            <GitSectionNote>
              <Spinner /> Loading commit diff…
            </GitSectionNote>
          </div>
        ) : diffQuery.error ? (
          <div className="p-4">
            <GitSectionNote tone="destructive">
              {getErrorMessage(diffQuery.error, "Failed to load commit diff")}
            </GitSectionNote>
          </div>
        ) : diffQuery.data?.patch && tab.path ? (
          <CommitSingleFileDiff
            diffStyle={diffStyle}
            patch={diffQuery.data.patch}
          />
        ) : diffQuery.data?.patch ? (
          <CommitPatchDiffs
            key={`${diffQuery.data.commit}:${diffQuery.data.mode}`}
            diffStyle={diffStyle}
            patch={diffQuery.data.patch}
            stuckFileValue={stickyCommitFileValue}
          />
        ) : (
          <div className="p-4">
            <GitSectionNote>No line changes.</GitSectionNote>
          </div>
        )}
      </div>
    </div>
  )
}

export function RightSidebar({
  viewerContextId,
  cwd,
  active,
  activeFilePath = "",
  activeTab: controlledActiveTab,
  filePreviewPath = "",
  fileTabs = EMPTY_RIGHT_SIDEBAR_FILE_TABS,
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
  const [localState, dispatchLocal] = React.useReducer(
    rightSidebarLocalReducer,
    initialRightSidebarLocalState
  )
  const [historyAsTab, setHistoryAsTabState] = React.useState(
    readStoredHistoryAsTab
  )
  const hasControlledActiveTab = controlledActiveTab !== undefined
  const activeTab = controlledActiveTab ?? localState.uncontrolledActiveTab
  const activeTabRef = React.useRef(activeTab)
  activeTabRef.current = activeTab
  const activeTabChangeEffectEvent = React.useEffectEvent(
    (tab: RightSidebarTabValue) => {
      onActiveTabChange?.(tab)
    }
  )
  const setActiveTab = (tab: RightSidebarTabValue) => {
    dispatchLocal({ type: "set-active-tab", tab })
    onActiveTabChange?.(tab)
  }
  const setHistoryAsTab = (value: boolean) => {
    setHistoryAsTabState(value)
    storeHistoryAsTab(value)
  }
  const previewMode: ProjectFilesPreviewMode = isMobile ? "inline" : "external"
  const panelHasCardChrome = showToolbar && !isMobile
  const currentFilePath =
    previewMode === "inline" ? localState.inlineActiveFilePath : activeFilePath
  const hasOpenFileTabs = fileTabs.length > 0
  const activeCommitDiffTab =
    localState.commitDiffTabs.find(
      (tab) => tab.key === localState.activeCommitDiffKey
    ) ?? localState.commitDiffTabs[0]
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
      dispatchLocal({ type: "set-inline-active-file", path })
      return
    }
    onOpenFile?.(path, options)
    onActiveFileChange?.(path)
  }

  const openCommitDiff = (request: GitCommitDiffTabRequest) => {
    if (!request.commit) return

    const tab = createGitCommitDiffTab(request)
    dispatchLocal({ type: "upsert-commit-diff-tab", tab })
    onActiveTabChange?.("commit-diff")
  }

  const closeCommitDiffKeys = (keys: Array<string>) => {
    const keySet = new Set(keys)
    const closingActiveTab = keySet.has(localState.activeCommitDiffKey)
    const nextTabs = localState.commitDiffTabs.filter(
      (tab) => !keySet.has(tab.key)
    )
    dispatchLocal({ type: "close-commit-diff-keys", keys })
    if (closingActiveTab && nextTabs.length === 0) {
      onActiveTabChange?.("review")
    }
  }

  const closeCommitDiff = (key: string) => {
    closeCommitDiffKeys([key])
  }

  const closeOtherCommitDiffs = (key: string) => {
    dispatchLocal({ type: "close-other-commit-diffs", key })
    onActiveTabChange?.("commit-diff")
  }

  const closeCommitDiffsToRight = (key: string) => {
    const index = localState.commitDiffTabs.findIndex((tab) => tab.key === key)
    if (index < 0) return
    closeCommitDiffKeys(
      localState.commitDiffTabs.slice(index + 1).map((tab) => tab.key)
    )
  }

  const closeAllCommitDiffs = () => {
    closeCommitDiffKeys(localState.commitDiffTabs.map((tab) => tab.key))
  }

  const reorderCommitDiffs = (keys: Array<string>) => {
    dispatchLocal({ type: "reorder-commit-diffs", keys })
  }

  React.useEffect(() => {
    dispatchLocal({
      type: "reset-navigation",
      resetActiveTab: !hasControlledActiveTab,
    })
    if (activeTabRef.current === "commit-diff") {
      activeTabChangeEffectEvent("review")
    }
  }, [hasControlledActiveTab, isMobile, normalizedCwd])

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
          activeCommitDiffKey={activeCommitDiffTab?.key || ""}
          activeFilePath={currentFilePath}
          activeTab={activeTab}
          commitDiffTabs={localState.commitDiffTabs}
          filePreviewPath={filePreviewPath}
          fileTabs={fileTabs}
          onActiveCommitDiffChange={(key) =>
            dispatchLocal({ type: "set-active-commit-diff-key", key })
          }
          onActiveFileChange={onActiveFileChange}
          onActiveTabChange={setActiveTab}
          onCloseAllCommitDiffs={closeAllCommitDiffs}
          onCloseAllFiles={onCloseAllFiles}
          onCloseCommitDiff={closeCommitDiff}
          onCloseCommitDiffsToRight={closeCommitDiffsToRight}
          onCloseFile={onCloseFile}
          onCloseFilesToRight={onCloseFilesToRight}
          onCloseOtherCommitDiffs={closeOtherCommitDiffs}
          onCloseOtherFiles={onCloseOtherFiles}
          onOpenFileDialog={() => {
            dispatchLocal({ type: "set-open-file-dialog-open", open: true })
          }}
          onReorderCommitDiffs={reorderCommitDiffs}
          onReorderFiles={onReorderFiles}
          showHistory={historyAsTab}
          showReview
        />
        <React.Activity mode={activeTab === "review" ? "visible" : "hidden"}>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileReviewContent
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "review"}
              onMaximizeHistory={() => {
                setHistoryAsTab(true)
                setActiveTab("history")
              }}
              onOpenCommitDiff={openCommitDiff}
              onOpenFile={openFile}
              showEmbeddedHistory={!historyAsTab}
            />
          </div>
        </React.Activity>
        <React.Activity mode={activeTab === "history" ? "visible" : "hidden"}>
          <div className="min-h-0 flex-1 overflow-hidden">
            <GitCommitsSection
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "history"}
              flush
              onOpenCommitDiff={openCommitDiff}
              onRestoreEmbedded={() => {
                setHistoryAsTab(false)
                setActiveTab("review")
              }}
            />
          </div>
        </React.Activity>
        <React.Activity
          mode={activeTab === "commit-diff" ? "visible" : "hidden"}
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            <CommitDiffContent
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && activeTab === "commit-diff"}
              tab={activeCommitDiffTab}
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
                  dispatchLocal({ type: "set-inline-active-file", path: "" })
                }}
                onOpenFile={openFile}
                previewMode={previewMode}
              />
            )}
          </div>
        </React.Activity>
        <ProjectOpenFileDialog
          open={localState.openFileDialogOpen}
          onOpenChange={(open) =>
            dispatchLocal({ type: "set-open-file-dialog-open", open })
          }
          paths={fileDialogPaths}
          onOpenFile={(path) => {
            openFile(path, { pin: true })
          }}
        />
      </div>
    </div>
  )
}
