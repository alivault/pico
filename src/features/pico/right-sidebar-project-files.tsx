import * as React from "react"
import {
  type FileTreeDirectoryHandle,
  type FileTreeItemHandle,
  type GitStatusEntry,
} from "@pierre/trees"
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
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ChevronsDownUpIcon,
  FileDiffIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  XIcon,
} from "lucide-react"

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
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { resizeRailPrimaryInteractiveClass } from "@/components/ui/resize-rail"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { MarkdownBlock } from "@/features/pico/markdown-renderer"
import { picoQueryKeys } from "@/features/pico/query-keys"
import {
  ProjectFileIconSprite,
  ProjectFileTypeIcon,
} from "@/features/pico/right-sidebar-file-icons"
import { gitChangesQueryOptions } from "@/features/pico/right-sidebar-git-data"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  GitCommitDiffTab,
  GitScopedProps,
  OpenProjectFileOptions,
  RightSidebarTabValue,
} from "@/features/pico/right-sidebar-types"
import {
  RIGHT_SIDEBAR_FILE_TREE_WIDTH_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico"
import type {
  GitChangeFile,
  HighlightResponse,
  ProjectFileReadResponse,
  ProjectFileTreeResponse,
} from "@/lib/pico/api"
import { useIsMobile } from "@/hooks/use-mobile"
import { installGlobalResizeCursor } from "@/hooks/use-sidebar-resize"
import { cn } from "@/lib/utils"

type ProjectFileTreeData = Extract<ProjectFileTreeResponse, { ok: true }>
type ProjectFileReadData = Extract<ProjectFileReadResponse, { ok: true }>

const EMPTY_PROJECT_FILE_PATHS: Array<string> = []
const EMPTY_GIT_CHANGE_FILES: Array<GitChangeFile> = []

const PROJECT_FILE_QUERY_STALE_TIME_MS = 1000 * 30
const PROJECT_FILE_QUERY_GC_TIME_MS = 1000 * 60 * 10
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

const fileHighlightCache = new Map<
  string,
  Promise<HighlightResponse> | HighlightResponse
>()

type MarkdownFileViewMode = "preview" | "source"

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
  markdown: "markdown",
  md: "markdown",
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

function fileExtensionFromPath(path: string) {
  const cleanPath = path.split(/[?#]/)[0] || ""
  return cleanPath.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase()
}

function codeLanguageFromPath(path: string) {
  const extension = fileExtensionFromPath(path)
  if (!extension) return undefined

  return CODE_LANGUAGE_BY_EXTENSION[extension]
}

function isMarkdownFilePath(path: string) {
  const extension = fileExtensionFromPath(path)
  return extension === "md" || extension === "markdown"
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

export function projectFileTreeQueryOptions({
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
    staleTime: PROJECT_FILE_QUERY_STALE_TIME_MS,
    gcTime: PROJECT_FILE_QUERY_GC_TIME_MS,
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
    staleTime: PROJECT_FILE_QUERY_STALE_TIME_MS,
    gcTime: PROJECT_FILE_QUERY_GC_TIME_MS,
  }
}

const GIT_FILE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: var(--background);
    --trees-fg-override: var(--foreground);
    --trees-border-color-override: var(--border);
    --trees-fg-muted-override: var(--muted-foreground);
    --trees-selected-bg-override: var(--accent);
    --trees-selected-fg-override: var(--accent-foreground);
    --trees-padding-inline-override: 0px;
  }

  [data-file-tree-virtualized-scroll='true'] {
    padding-inline: 0 16px;
  }

  [data-file-tree-search-input] {
    font-size: 16px;
  }
`

function isFileTreeDirectoryHandle(
  item: FileTreeItemHandle | null
): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true
}

function isProjectFileTreeItemEvent(event: React.SyntheticEvent) {
  const path = event.nativeEvent.composedPath()
  return path.some(
    (target) =>
      target instanceof Element && target.getAttribute("data-type") === "item"
  )
}

function getProjectFileTreeGitStatusFromPorcelain(
  status: string
): GitStatusEntry["status"] {
  const indexStatus = status[0] || " "
  const worktreeStatus = status[1] || " "

  if (status === "??") return "untracked"
  if (status === "!!") return "ignored"
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed"
  if (indexStatus === "C" || worktreeStatus === "C") return "renamed"
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted"
  if (indexStatus === "A" || worktreeStatus === "A") return "added"

  return "modified"
}

function getProjectFileTreeGitStatus(
  files: Array<GitChangeFile>
): Array<GitStatusEntry> {
  return files.map((file) => ({
    path: file.path,
    status: getProjectFileTreeGitStatusFromPorcelain(file.status),
  }))
}

function getProjectFileTreePaths(
  paths: Array<string>,
  files: Array<GitChangeFile>
) {
  if (files.length === 0) return paths

  const pathSet = new Set(paths)
  let addedPath = false

  for (const file of files) {
    if (getProjectFileTreeGitStatusFromPorcelain(file.status) !== "deleted") {
      continue
    }
    if (!file.path || pathSet.has(file.path)) continue

    pathSet.add(file.path)
    addedPath = true
  }

  if (!addedPath) return paths

  return [...pathSet]
}

function getProjectFileDirectoryPaths(paths: Array<string>) {
  const directoryPaths = new Set<string>()

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      directoryPaths.add(`${parts.slice(0, index).join("/")}/`)
    }
  }

  return Array.from(directoryPaths).toSorted(
    (left, right) =>
      right.split("/").length - left.split("/").length ||
      right.length - left.length ||
      right.localeCompare(left)
  )
}

function ProjectFileTree({
  collapseAllRevision,
  gitStatus,
  paths,
  selectedPath,
  onSelectFile,
}: {
  collapseAllRevision: number
  gitStatus: Array<GitStatusEntry>
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
    gitStatus,
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
    model.setGitStatus(gitStatus)
  }, [gitStatus, model])

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
      onClick={(event) => {
        if (!isProjectFileTreeItemEvent(event)) return
        openFocusedFile()
      }}
      onKeyUp={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        if (!isProjectFileTreeItemEvent(event)) return
        openFocusedFile()
      }}
    />
  )
}

export type ProjectFilesPreviewMode = "external" | "inline"

export function ProjectFilesWorkspace({
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
  const inlinePreview = previewMode === "inline"
  const showInlinePreview = inlinePreview && Boolean(activeFilePath)
  const fileTreeQuery = useQuery({
    ...projectFileTreeQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: (data) => data.paths,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const gitFilesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: (data) => data.files ?? [],
    notifyOnChangeProps: ["data"],
  })
  const projectPaths = fileTreeQuery.data ?? EMPTY_PROJECT_FILE_PATHS
  const gitFiles = gitFilesQuery.data ?? EMPTY_GIT_CHANGE_FILES
  const paths = React.useMemo(
    () => getProjectFileTreePaths(projectPaths, gitFiles),
    [gitFiles, projectPaths]
  )
  const gitStatus = React.useMemo(
    () => getProjectFileTreeGitStatus(gitFiles),
    [gitFiles]
  )

  return (
    <div
      className={cn(
        "h-full min-h-0 overflow-hidden",
        inlinePreview ? "relative flex flex-col" : "flex flex-col"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpenFileDialogOpen(true)
              }}
            >
              Open File
            </Button>
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
              gitStatus={gitStatus}
              paths={paths}
              selectedPath={activeFilePath}
              onSelectFile={onOpenFile}
            />
          ) : (
            <GitSectionNote>No files found.</GitSectionNote>
          )}
        </div>
      </div>
      {inlinePreview ? (
        <div
          aria-hidden={!showInlinePreview}
          inert={!showInlinePreview}
          className={cn(
            "absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-background transition-transform duration-200 ease-out",
            showInlinePreview
              ? "translate-x-0 shadow-xl"
              : "pointer-events-none translate-x-full"
          )}
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-2 text-xs font-medium text-muted-foreground">
            <button
              type="button"
              aria-label="Back to file tree"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onCloseFile}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Files</span>
            </button>
            <span className="min-w-0 flex-1 truncate" title={activeFilePath}>
              {activeFilePath}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ProjectFileContent
              viewerContextId={viewerContextId}
              cwd={normalizedCwd}
              active={active && showInlinePreview}
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

export function ProjectOpenFileDialog({
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
  const isMobile = useIsMobile()

  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const commandBody = (
    <Command shouldFilter className={cn(isMobile && "min-h-0 flex-1")}>
      <ProjectFileIconSprite />
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search files…"
        className="text-base md:text-sm"
      />
      <CommandList className={cn(isMobile && "max-h-none min-h-0 flex-1")}>
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
              <span className="min-w-0 truncate font-mono text-xs">{path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Open Files</DrawerTitle>
            <DrawerDescription>Search project files to open.</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {commandBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open Files"
      description="Search project files to open."
    >
      {commandBody}
    </CommandDialog>
  )
}

export function ProjectFileContent({
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
  const isMarkdownFile = isMarkdownFilePath(path)
  const [markdownViewModes, setMarkdownViewModes] = React.useState<
    Record<string, MarkdownFileViewMode>
  >({})
  const markdownViewMode: MarkdownFileViewMode = isMarkdownFile
    ? markdownViewModes[path] || "preview"
    : "source"
  const showMarkdownPreview = isMarkdownFile && markdownViewMode === "preview"
  const [highlighted, setHighlighted] =
    React.useState<HighlightResponse | null>(null)

  React.useEffect(() => {
    let cancelled = false

    if (!active || !content || !language || showMarkdownPreview) {
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
  }, [active, content, language, showMarkdownPreview])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a file to preview it.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {isMarkdownFile ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
          <div className="truncate text-xs font-medium text-muted-foreground">
            Markdown
          </div>
          <ToggleGroup
            variant="outline"
            value={[markdownViewMode]}
            onValueChange={(values) => {
              const value = values[0]
              if (value === "preview" || value === "source") {
                setMarkdownViewModes((current) => ({
                  ...current,
                  [path]: value,
                }))
              }
            }}
          >
            <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
            <ToggleGroupItem value="source">Source</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
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
        ) : showMarkdownPreview ? (
          <div className="min-h-full p-4 text-foreground">
            <MarkdownBlock text={content} />
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
        "inline-flex h-8 shrink-0 items-center rounded-md border border-transparent text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
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

function fileViewerTabId(path: string) {
  return `file:${path}`
}

function commitDiffViewerTabId(key: string) {
  return `commit-diff:${key}`
}

function filePathFromViewerTabId(id: string) {
  return id.startsWith("file:") ? id.slice("file:".length) : ""
}

function commitDiffKeyFromViewerTabId(id: string) {
  return id.startsWith("commit-diff:") ? id.slice("commit-diff:".length) : ""
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
  } = useSortable({ id: fileViewerTabId(props.path) })
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

function CommitDiffViewerTab({
  active,
  dragging = false,
  dragListeners,
  dragAttributes,
  index,
  onActiveCommitDiffChange,
  onActiveTabChange,
  onCloseAllCommitDiffs,
  onCloseCommitDiff,
  onCloseCommitDiffsToRight,
  onCloseOtherCommitDiffs,
  tab,
  tabCount,
}: {
  active: boolean
  dragging?: boolean
  dragListeners?: ReturnType<typeof useSortable>["listeners"]
  dragAttributes?: ReturnType<typeof useSortable>["attributes"]
  index: number
  onActiveCommitDiffChange?: (key: string) => void
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  onCloseAllCommitDiffs?: () => void
  onCloseCommitDiff?: (key: string) => void
  onCloseCommitDiffsToRight?: (key: string) => void
  onCloseOtherCommitDiffs?: (key: string) => void
  tab: GitCommitDiffTab
  tabCount: number
}) {
  const tabNode = (
    <div
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-md border border-transparent text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
        dragging && "border-transparent shadow-none ring-0"
      )}
      {...dragAttributes}
      {...dragListeners}
    >
      <button
        type="button"
        title={tab.title}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left"
        onClick={() => {
          onActiveCommitDiffChange?.(tab.key)
          onActiveTabChange("commit-diff")
        }}
      >
        {tab.path ? (
          <ProjectFileTypeIcon path={tab.path} />
        ) : (
          <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="block min-w-0 truncate">{tab.title}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          onCloseCommitDiff?.(tab.key)
        }}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger render={tabNode} />
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => onCloseCommitDiff?.(tab.key)}>
          Close
        </ContextMenuItem>
        <ContextMenuItem
          disabled={tabCount <= 1}
          onClick={() => onCloseOtherCommitDiffs?.(tab.key)}
        >
          Close others
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index >= tabCount - 1}
          onClick={() => onCloseCommitDiffsToRight?.(tab.key)}
        >
          Close to the right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseAllCommitDiffs?.()}>
          Close all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SortableCommitDiffViewerTab(props: {
  active: boolean
  index: number
  onActiveCommitDiffChange?: (key: string) => void
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  onCloseAllCommitDiffs?: () => void
  onCloseCommitDiff?: (key: string) => void
  onCloseCommitDiffsToRight?: (key: string) => void
  onCloseOtherCommitDiffs?: (key: string) => void
  tab: GitCommitDiffTab
  tabCount: number
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: commitDiffViewerTabId(props.tab.key) })
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
      <CommitDiffViewerTab
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

function CommitDiffViewerTabOverlay({
  active,
  tab,
}: {
  active: boolean
  tab: GitCommitDiffTab
}) {
  return (
    <CommitDiffViewerTab
      active={active}
      dragging
      index={0}
      onActiveTabChange={() => {}}
      tab={tab}
      tabCount={1}
    />
  )
}

export function RightSidebarTabStrip({
  activeCommitDiffKey = "",
  activeFilePath,
  activeTab,
  commitDiffTabs = [],
  filePreviewPath = "",
  fileTabs = [],
  onActiveCommitDiffChange,
  onActiveFileChange,
  onActiveTabChange,
  onCloseAllCommitDiffs,
  onCloseAllFiles,
  onCloseCommitDiff,
  onCloseCommitDiffsToRight,
  onCloseFile,
  onCloseFilesToRight,
  onCloseOtherCommitDiffs,
  onCloseOtherFiles,
  onOpenFileDialog,
  onReorderCommitDiffs,
  onReorderFiles,
  showHistory = false,
  showReview = false,
}: {
  activeCommitDiffKey?: string
  activeFilePath?: string
  activeTab: RightSidebarTabValue
  commitDiffTabs?: Array<GitCommitDiffTab>
  filePreviewPath?: string
  fileTabs?: Array<string>
  onActiveCommitDiffChange?: (key: string) => void
  onActiveFileChange?: (path: string) => void
  onActiveTabChange: (tab: RightSidebarTabValue) => void
  onCloseAllCommitDiffs?: () => void
  onCloseAllFiles?: () => void
  onCloseCommitDiff?: (key: string) => void
  onCloseCommitDiffsToRight?: (key: string) => void
  onCloseFile?: (path: string) => void
  onCloseFilesToRight?: (path: string) => void
  onCloseOtherCommitDiffs?: (key: string) => void
  onCloseOtherFiles?: (path: string) => void
  onOpenFileDialog?: () => void
  onReorderCommitDiffs?: (keys: Array<string>) => void
  onReorderFiles?: (paths: Array<string>) => void
  showHistory?: boolean
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

  const fileTabIds = fileTabs.map(fileViewerTabId)
  const commitDiffTabIds = commitDiffTabs.map((tab) =>
    commitDiffViewerTabId(tab.key)
  )
  const availableMixedTabIds = [...fileTabIds, ...commitDiffTabIds]
  const availableMixedTabIdSet = new Set(availableMixedTabIds)
  const [mixedTabOrder, setMixedTabOrder] = React.useState<Array<string>>([])
  const [activeDragTabId, setActiveDragTabId] = React.useState("")
  const mixedTabIds = [
    ...mixedTabOrder.filter((id) => availableMixedTabIdSet.has(id)),
    ...availableMixedTabIds.filter((id) => !mixedTabOrder.includes(id)),
  ]
  const hasOpenFiles = fileTabs.length > 0
  const hasOpenCommitDiffs = commitDiffTabs.length > 0
  const hasFileTypeIconTabs =
    hasOpenFiles || commitDiffTabs.some((tab) => Boolean(tab.path))
  const hasMixedTabs = mixedTabIds.length > 0
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )

  React.useEffect(() => {
    setMixedTabOrder((current) => {
      const next = [
        ...current.filter((id) => availableMixedTabIdSet.has(id)),
        ...availableMixedTabIds.filter((id) => !current.includes(id)),
      ]
      return next.length === current.length &&
        next.every((id, index) => id === current[index])
        ? current
        : next
    })
  }, [availableMixedTabIds.join("\0")])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragTabId(String(event.active.id))
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""
    if (!activeId || !overId || activeId === overId) {
      setActiveDragTabId("")
      return
    }

    const oldIndex = mixedTabIds.indexOf(activeId)
    const newIndex = mixedTabIds.indexOf(overId)
    if (oldIndex === -1 || newIndex === -1) {
      setActiveDragTabId("")
      return
    }

    const nextMixedTabIds = arrayMove(mixedTabIds, oldIndex, newIndex)
    setMixedTabOrder(nextMixedTabIds)
    onReorderFiles?.(
      nextMixedTabIds.map(filePathFromViewerTabId).filter(Boolean)
    )
    onReorderCommitDiffs?.(
      nextMixedTabIds.map(commitDiffKeyFromViewerTabId).filter(Boolean)
    )
    setActiveDragTabId("")
  }
  const handleDragCancel = () => {
    setActiveDragTabId("")
  }

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border/70 bg-background p-2">
      {hasFileTypeIconTabs ? <ProjectFileIconSprite /> : null}
      {showReview ? renderTab({ label: "Changes", value: "review" }) : null}
      {showHistory ? renderTab({ label: "History", value: "history" }) : null}
      {!hasOpenFiles ? renderTab({ label: "Files", value: "files" }) : null}
      {hasOpenFiles || hasOpenCommitDiffs ? (
        <span className="mx-1 shrink-0 text-xs text-border" aria-hidden="true">
          |
        </span>
      ) : null}
      {hasMixedTabs ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={mixedTabIds}
            strategy={horizontalListSortingStrategy}
          >
            {mixedTabIds.map((id) => {
              const path = filePathFromViewerTabId(id)
              if (path) {
                return (
                  <SortableFileViewerTab
                    key={id}
                    active={activeTab === "files" && activeFilePath === path}
                    index={fileTabs.indexOf(path)}
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
                )
              }

              const commitDiffKey = commitDiffKeyFromViewerTabId(id)
              const tab = commitDiffTabs.find(
                (candidate) => candidate.key === commitDiffKey
              )
              if (!tab) return null

              return (
                <SortableCommitDiffViewerTab
                  key={id}
                  active={
                    activeTab === "commit-diff" &&
                    activeCommitDiffKey === tab.key
                  }
                  index={commitDiffTabs.findIndex(
                    (candidate) => candidate.key === tab.key
                  )}
                  onActiveCommitDiffChange={onActiveCommitDiffChange}
                  onActiveTabChange={onActiveTabChange}
                  onCloseAllCommitDiffs={onCloseAllCommitDiffs}
                  onCloseCommitDiff={onCloseCommitDiff}
                  onCloseCommitDiffsToRight={onCloseCommitDiffsToRight}
                  onCloseOtherCommitDiffs={onCloseOtherCommitDiffs}
                  tab={tab}
                  tabCount={commitDiffTabs.length}
                />
              )
            })}
          </SortableContext>
          <DragOverlay
            dropAnimation={null}
            modifiers={FILE_TAB_DRAG_OVERLAY_MODIFIERS}
          >
            {filePathFromViewerTabId(activeDragTabId) ? (
              <FileViewerTabOverlay
                activeFilePath={activeFilePath}
                activePath={filePathFromViewerTabId(activeDragTabId)}
                filePreviewPath={filePreviewPath}
                fileTabs={fileTabs}
              />
            ) : commitDiffKeyFromViewerTabId(activeDragTabId) ? (
              <CommitDiffViewerTabOverlay
                active={
                  activeTab === "commit-diff" &&
                  activeCommitDiffKey ===
                    commitDiffKeyFromViewerTabId(activeDragTabId)
                }
                tab={
                  commitDiffTabs.find(
                    (candidate) =>
                      candidate.key ===
                      commitDiffKeyFromViewerTabId(activeDragTabId)
                  ) || commitDiffTabs[0]
                }
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
  return Math.round(
    Math.min(
      PROJECT_FILE_TREE_MAX_WIDTH,
      Math.max(PROJECT_FILE_TREE_MIN_WIDTH, width)
    )
  )
}

function readStoredProjectFileTreeWidth() {
  const storedWidth = safeLocalStorageGetItem(
    RIGHT_SIDEBAR_FILE_TREE_WIDTH_STORAGE_KEY
  )
  if (storedWidth == null) return PROJECT_FILE_TREE_DEFAULT_WIDTH

  return clampProjectFileTreeWidth(Number(storedWidth))
}

function storeProjectFileTreeWidth(width: number) {
  safeLocalStorageSetItem(
    RIGHT_SIDEBAR_FILE_TREE_WIDTH_STORAGE_KEY,
    String(clampProjectFileTreeWidth(width))
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

        Object.assign(document.body.style, {
          cursor: "col-resize",
          userSelect: "none",
        })

        const handlePointerMove = (moveEvent: PointerEvent) => {
          resizeTo(startWidth + moveEvent.clientX - startX)
        }
        const handlePointerUp = () => {
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
      }}
    />
  )
}

export function ProjectFileTreePane({
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
  const [fileTreeWidth, setFileTreeWidthState] = React.useState(
    PROJECT_FILE_TREE_DEFAULT_WIDTH
  )

  React.useEffect(() => {
    setFileTreeWidthState(readStoredProjectFileTreeWidth())
  }, [])

  const setFileTreeWidth = (nextWidth: number) => {
    const width = clampProjectFileTreeWidth(nextWidth)
    setFileTreeWidthState(width)
    storeProjectFileTreeWidth(width)
  }

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

export function FilePathBreadcrumb({
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
              "inline-flex h-8 shrink-0 items-center rounded-md border border-transparent text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
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
