import * as React from "react"
import {
  FileDiff as FileDiffInstance,
  parsePatchFiles,
  type AnnotationSide,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type FileDiffOptions,
} from "@pierre/diffs"
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
import { usePicoDiffThemeOptions } from "@/features/pico/pico-diff-theme"
import { GitCommitsSection } from "@/features/pico/right-sidebar-git-commits"
import { FileReviewContent } from "@/features/pico/right-sidebar-git-review"
import {
  getStuckScrollTriggerValue,
  setDerivedScrollState,
} from "@/features/pico/scroll-shadow-utils"
import {
  ScrollGradientOverlays,
  useScrollGradients,
} from "@/features/pico/scroll-gradient-utils"
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
import type { ComposerDiffLineComment } from "@/features/pico/app-shell-composer-state"
import type { GitCommitDiffMode, GitCommitDiffResponse } from "@/lib/pico/api"
import { cn } from "@/lib/utils"

type GitCommitDiffData = Extract<GitCommitDiffResponse, { ok: true }>
type CommitDiffStyle = "unified" | "split"

const EMPTY_RIGHT_SIDEBAR_DIFF_LINE_COMMENTS: Array<ComposerDiffLineComment> =
  []
const EMPTY_RIGHT_SIDEBAR_FILE_TABS: NonNullable<
  RightSidebarProps["fileTabs"]
> = []

type CommitDiffCommentTarget = Omit<
  ComposerDiffLineComment,
  "cwd" | "id" | "text"
>

type PendingCommitDiffLineComment = CommitDiffCommentTarget & {
  kind: "pending"
  onCancel: () => void
  onSubmit: (text: string) => void
}

type CommitDiffLineAnnotationMetadata =
  | ComposerDiffLineComment
  | PendingCommitDiffLineComment

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

function commitDiffCommentSideLabel(side: AnnotationSide) {
  return side === "deletions" ? "old" : "new"
}

function commitDiffLineCommentAnnotations({
  comments,
  pendingComment,
}: {
  comments: Array<ComposerDiffLineComment>
  pendingComment?: PendingCommitDiffLineComment | null
}): Array<DiffLineAnnotation<CommitDiffLineAnnotationMetadata>> {
  const annotations: Array<
    DiffLineAnnotation<CommitDiffLineAnnotationMetadata>
  > = comments.map((comment) => ({
    lineNumber: comment.lineNumber,
    metadata: comment,
    side: comment.side,
  }))

  if (pendingComment) {
    annotations.push({
      lineNumber: pendingComment.lineNumber,
      metadata: pendingComment,
      side: pendingComment.side,
    })
  }

  return annotations
}

function assignClassName(element: HTMLElement, className: string) {
  for (const classItem of className.split(/\s+/)) {
    if (classItem) element.classList.add(classItem)
  }
}

function renderPendingCommitDiffLineComment(
  pendingComment: PendingCommitDiffLineComment
) {
  const form = document.createElement("form")
  assignClassName(
    form,
    "m-2 w-[calc(100%_-_1rem)] max-w-[38rem] rounded-lg border border-border/70 bg-background p-2 shadow-sm"
  )

  const header = document.createElement("div")
  assignClassName(
    header,
    "mb-2 flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground"
  )

  const label = document.createElement("span")
  label.textContent = `Comment on ${pendingComment.path}:L${pendingComment.lineNumber} (${commitDiffCommentSideLabel(pendingComment.side)})`
  assignClassName(label, "min-w-0 truncate")

  const cancelButton = document.createElement("button")
  cancelButton.type = "button"
  cancelButton.textContent = "×"
  cancelButton.setAttribute("aria-label", "Cancel line comment")
  assignClassName(
    cancelButton,
    "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
  )
  cancelButton.addEventListener("click", () => pendingComment.onCancel())

  header.append(label, cancelButton)

  const textarea = document.createElement("textarea")
  textarea.rows = 2
  textarea.placeholder = "Add a note for the prompt…"
  assignClassName(
    textarea,
    "flex min-h-16 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
  )
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
    if (event.key === "Escape") {
      event.preventDefault()
      pendingComment.onCancel()
    }
  })

  const footer = document.createElement("div")
  assignClassName(footer, "mt-2 flex flex-wrap justify-end gap-2")

  const secondaryCancelButton = document.createElement("button")
  secondaryCancelButton.type = "button"
  secondaryCancelButton.textContent = "Cancel"
  assignClassName(
    secondaryCancelButton,
    "inline-flex h-8 items-center rounded-md px-3 text-sm hover:bg-muted"
  )
  secondaryCancelButton.addEventListener("click", () =>
    pendingComment.onCancel()
  )

  const submitButton = document.createElement("button")
  submitButton.type = "submit"
  submitButton.textContent = "Add to prompt"
  assignClassName(
    submitButton,
    "inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
  )

  function syncSubmitDisabled() {
    submitButton.disabled = textarea.value.trim().length === 0
  }

  function submit() {
    const text = textarea.value.trim()
    if (!text) return
    pendingComment.onSubmit(text)
  }

  textarea.addEventListener("input", syncSubmitDisabled)
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    submit()
  })

  footer.append(secondaryCancelButton, submitButton)
  form.append(header, textarea, footer)
  syncSubmitDisabled()
  window.setTimeout(() => textarea.focus(), 0)
  return form
}

function renderCommitDiffLineAnnotation(
  annotation: DiffLineAnnotation<CommitDiffLineAnnotationMetadata>
) {
  const comment = annotation.metadata
  if (!comment) return undefined

  if ((comment as PendingCommitDiffLineComment).kind === "pending") {
    return renderPendingCommitDiffLineComment(
      comment as PendingCommitDiffLineComment
    )
  }

  const savedComment = comment as ComposerDiffLineComment
  const wrapper = document.createElement("div")
  assignClassName(
    wrapper,
    "my-1 ml-2 inline-flex max-w-[min(32rem,calc(100vw_-_5rem),90%)] items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200"
  )

  const icon = document.createElement("span")
  icon.textContent = "💬"
  assignClassName(icon, "shrink-0")

  const text = document.createElement("span")
  text.textContent = savedComment.text
  assignClassName(text, "truncate")

  wrapper.append(icon, text)
  return wrapper
}

function CommitDiffFileRenderer({
  comments,
  diffStyle,
  disableFileHeader = false,
  fileDiff,
  onStartComment,
  pendingComment,
}: {
  comments: Array<ComposerDiffLineComment>
  diffStyle: CommitDiffStyle
  disableFileHeader?: boolean
  fileDiff: FileDiffMetadata
  onStartComment: (target: {
    lineNumber: number
    path: string
    side: AnnotationSide
  }) => void
  pendingComment?: PendingCommitDiffLineComment | null
}) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null)
  const instanceRef =
    React.useRef<FileDiffInstance<CommitDiffLineAnnotationMetadata> | null>(
      null
    )
  const lineAnnotations = commitDiffLineCommentAnnotations({
    comments,
    pendingComment,
  })
  const themeOptions = usePicoDiffThemeOptions()
  const options = {
    ...themeOptions,
    diffStyle,
    disableFileHeader,
    enableGutterUtility: true,
    lineDiffType: "word-alt",
    lineHoverHighlight: "both",
    maxLineDiffLength: 1000,
    onGutterUtilityClick: (range) => {
      onStartComment({
        lineNumber: Math.min(range.start, range.end),
        path: fileDiff.name,
        side: (range.side || range.endSide || "additions") as AnnotationSide,
      })
    },
    onLineNumberClick: (props) => {
      onStartComment({
        lineNumber: props.lineNumber,
        path: fileDiff.name,
        side: props.annotationSide,
      })
    },
    overflow: "wrap",
    renderAnnotation: renderCommitDiffLineAnnotation,
  } satisfies FileDiffOptions<CommitDiffLineAnnotationMetadata>

  React.useLayoutEffect(() => {
    if (!container) return

    const existing = instanceRef.current
    if (existing) {
      existing.setOptions(options)
      existing.render({
        containerWrapper: container,
        fileDiff,
        forceRender: true,
        lineAnnotations,
      })
      return
    }

    const instance = new FileDiffInstance<CommitDiffLineAnnotationMetadata>(
      options,
      undefined,
      false
    )
    instanceRef.current = instance
    instance.render({
      containerWrapper: container,
      fileDiff,
      lineAnnotations,
    })
  })

  React.useLayoutEffect(
    () => () => {
      instanceRef.current?.cleanUp()
      instanceRef.current = null
    },
    []
  )

  return React.createElement("div", {
    ref: setContainer,
  })
}

function CommitFileDiffAccordionItem({
  comments,
  diffStyle,
  fileDiff,
  index,
  onStartComment,
  pendingComment,
  stuck,
}: {
  comments: Array<ComposerDiffLineComment>
  diffStyle: CommitDiffStyle
  fileDiff: FileDiffMetadata
  index: number
  onStartComment: (target: {
    lineNumber: number
    path: string
    side: AnnotationSide
  }) => void
  pendingComment?: PendingCommitDiffLineComment | null
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
          className="group/commit-file-trigger relative flex min-h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-none border border-transparent bg-background px-3 py-2 text-left text-[13px] font-medium transition-all outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground"
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
        <CommitDiffFileRenderer
          comments={comments}
          diffStyle={diffStyle}
          disableFileHeader
          fileDiff={fileDiff}
          onStartComment={onStartComment}
          pendingComment={pendingComment}
        />
      </AccordionContent>
    </AccordionItem>
  )
}

function CommitSingleFileDiff({
  comments,
  diffStyle,
  onStartComment,
  patch,
  pendingComment,
}: {
  comments: Array<ComposerDiffLineComment>
  diffStyle: CommitDiffStyle
  onStartComment: (target: {
    lineNumber: number
    path: string
    side: AnnotationSide
  }) => void
  patch: string
  pendingComment?: PendingCommitDiffLineComment | null
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
      <CommitDiffFileRenderer
        comments={comments}
        diffStyle={diffStyle}
        fileDiff={fileDiff}
        onStartComment={onStartComment}
        pendingComment={pendingComment}
      />
    </div>
  )
}

function CommitPatchDiffs({
  comments,
  diffStyle,
  onStartComment,
  patch,
  pendingComment,
  stuckFileValue,
}: {
  comments: Array<ComposerDiffLineComment>
  diffStyle: CommitDiffStyle
  onStartComment: (target: {
    lineNumber: number
    path: string
    side: AnnotationSide
  }) => void
  patch: string
  pendingComment?: PendingCommitDiffLineComment | null
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
            comments={comments.filter(
              (comment) => comment.path === fileDiff.name
            )}
            diffStyle={diffStyle}
            fileDiff={fileDiff}
            index={index}
            onStartComment={onStartComment}
            pendingComment={
              pendingComment?.path === fileDiff.name ? pendingComment : null
            }
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
  diffLineComments,
  onAddDiffLineComment,
  tab,
}: {
  viewerContextId: string
  cwd: string
  active: boolean
  diffLineComments: Array<ComposerDiffLineComment>
  onAddDiffLineComment?: (
    comment: Omit<ComposerDiffLineComment, "cwd" | "id">
  ) => void
  tab: GitCommitDiffTab | undefined
}) {
  const [diffStyle, setDiffStyle] = React.useState<CommitDiffStyle>("unified")
  const [stickyCommitFileValue, setStickyCommitFileValue] = React.useState("")
  const isMobile = useIsMobile()
  const [commentTarget, setCommentTarget] =
    React.useState<CommitDiffCommentTarget | null>(null)
  const diffScrollRef = React.useRef<HTMLDivElement>(null)
  const {
    bottomHeight: diffScrollBottomGradientHeight,
    onScroll: onDiffScrollGradientScroll,
    setScrollElement: setDiffScrollGradientElement,
    topHeight: diffScrollTopGradientHeight,
  } = useScrollGradients<HTMLDivElement>()
  const setDiffScrollElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      diffScrollRef.current = element
      setDiffScrollGradientElement(element)
    },
    [setDiffScrollGradientElement]
  )
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

  const commentsForTab = tab
    ? diffLineComments.filter(
        (comment) =>
          comment.tabKey === tab.key &&
          comment.commit === tab.commit &&
          comment.mode === tab.mode
      )
    : EMPTY_RIGHT_SIDEBAR_DIFF_LINE_COMMENTS
  const startLineComment = (lineTarget: {
    lineNumber: number
    path: string
    side: AnnotationSide
  }) => {
    if (!tab || !onAddDiffLineComment) return
    setCommentTarget({
      commit: tab.commit,
      lineNumber: lineTarget.lineNumber,
      mode: tab.mode,
      path: lineTarget.path,
      shortHash: tab.shortHash,
      side: lineTarget.side,
      tabKey: tab.key,
      tabTitle: tab.title,
    })
  }
  const pendingComment: PendingCommitDiffLineComment | null = commentTarget
    ? {
        ...commentTarget,
        kind: "pending",
        onCancel: () => setCommentTarget(null),
        onSubmit: (text) => {
          onAddDiffLineComment?.({ ...commentTarget, text })
          setCommentTarget(null)
        },
      }
    : null

  React.useEffect(() => {
    setCommentTarget(null)
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
          size={isMobile ? "default" : "sm"}
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
      <div className="relative min-h-0 flex-1">
        <div
          ref={setDiffScrollElement}
          className="h-full overflow-auto"
          onScroll={(event) => {
            updateStickyCommitFileHeader(event.currentTarget)
            onDiffScrollGradientScroll(event)
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
              comments={commentsForTab.filter((comment) => {
                if (!tab.path) return true
                return (
                  comment.path === tab.path || comment.path === tab.previousPath
                )
              })}
              diffStyle={diffStyle}
              onStartComment={startLineComment}
              patch={diffQuery.data.patch}
              pendingComment={pendingComment}
            />
          ) : diffQuery.data?.patch ? (
            <CommitPatchDiffs
              key={`${diffQuery.data.commit}:${diffQuery.data.mode}`}
              comments={commentsForTab}
              diffStyle={diffStyle}
              onStartComment={startLineComment}
              patch={diffQuery.data.patch}
              pendingComment={pendingComment}
              stuckFileValue={stickyCommitFileValue}
            />
          ) : (
            <div className="p-4">
              <GitSectionNote>No line changes.</GitSectionNote>
            </div>
          )}
        </div>
        <ScrollGradientOverlays
          bottomHeight={diffScrollBottomGradientHeight}
          topHeight={diffScrollTopGradientHeight}
        />
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
  diffLineComments = EMPTY_RIGHT_SIDEBAR_DIFF_LINE_COMMENTS,
  filePreviewPath = "",
  fileTabs = EMPTY_RIGHT_SIDEBAR_FILE_TABS,
  fileTreeCollapsed = false,
  onActiveFileChange,
  onActiveTabChange,
  onAddDiffLineComment,
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
  const previewMode: ProjectFilesPreviewMode = "external"
  const panelHasCardChrome = showToolbar && !isMobile
  const currentFilePath = activeFilePath
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

  const handleTabStripActiveTabChange = (tab: RightSidebarTabValue) => {
    if (isMobile && tab === "files") {
      onActiveFileChange?.("")
    }
    setActiveTab(tab)
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
          onActiveTabChange={handleTabStripActiveTabChange}
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
          showFiles={isMobile && hasOpenFileTabs}
          showHistory={historyAsTab}
          showReview
        />
        <div
          className={
            activeTab === "review" ? "min-h-0 flex-1 overflow-hidden" : "hidden"
          }
        >
          <FileReviewContent
            viewerContextId={viewerContextId}
            cwd={normalizedCwd}
            active={active && activeTab === "review"}
            diffLineComments={diffLineComments}
            onMaximizeHistory={() => {
              setHistoryAsTab(true)
              setActiveTab("history")
            }}
            onAddDiffLineComment={onAddDiffLineComment}
            onOpenCommitDiff={openCommitDiff}
            onOpenFile={openFile}
            showEmbeddedHistory={!historyAsTab}
          />
        </div>
        <div
          className={
            activeTab === "history"
              ? "min-h-0 flex-1 overflow-hidden"
              : "hidden"
          }
        >
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
        <div
          className={
            activeTab === "commit-diff"
              ? "min-h-0 flex-1 overflow-hidden"
              : "hidden"
          }
        >
          <CommitDiffContent
            viewerContextId={viewerContextId}
            cwd={normalizedCwd}
            active={active && activeTab === "commit-diff"}
            diffLineComments={diffLineComments}
            onAddDiffLineComment={onAddDiffLineComment}
            tab={activeCommitDiffTab}
          />
        </div>
        <div
          className={
            activeTab === "files" ? "min-h-0 flex-1 overflow-hidden" : "hidden"
          }
        >
          {isMobile ? (
            currentFilePath ? (
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <FilePathBreadcrumb path={currentFilePath} />
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  <ProjectFileContent
                    viewerContextId={viewerContextId}
                    cwd={normalizedCwd}
                    active={active && activeTab === "files"}
                    path={currentFilePath}
                  />
                </div>
              </div>
            ) : (
              <ProjectFilesWorkspace
                viewerContextId={viewerContextId}
                cwd={normalizedCwd}
                active={active && activeTab === "files"}
                activeFilePath={currentFilePath}
                onOpenFile={openFile}
                previewMode={previewMode}
              />
            )
          ) : hasOpenFileTabs ? (
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
              onOpenFile={openFile}
              previewMode={previewMode}
            />
          )}
        </div>
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
