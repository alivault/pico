import type { GitStatusSummary } from "@/lib/pico/api"

export type GitStatusValue = GitStatusSummary | null
export type GitRemoteAction = "push" | "force-push" | "pull"
export type OpenProjectFileOptions = { pin?: boolean }

export type RightSidebarTabValue = "files" | "review"

export type RightSidebarProps = {
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

export type GitScopedProps = RightSidebarProps

export type GitCommitDialogControllerHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}
