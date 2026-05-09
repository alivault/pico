import * as React from "react"
import { useQuery } from "@tanstack/react-query"

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
import { GitPanelErrorToasts } from "@/features/pico/right-sidebar-git-toolbar"
import { FileReviewContent } from "@/features/pico/right-sidebar-git-review"
import { normalizeCwd } from "@/features/pico/right-sidebar-shared"
import type {
  OpenProjectFileOptions,
  RightSidebarProps,
  RightSidebarTabValue,
} from "@/features/pico/right-sidebar-types"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

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
