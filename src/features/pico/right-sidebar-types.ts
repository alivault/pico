import type { GitCommitDiffMode, GitStatusSummary } from "@/lib/pico/api"

export type GitStatusValue = GitStatusSummary | null
export type GitRemoteAction = "push" | "force-push" | "pull"
export type OpenProjectFileOptions = { pin?: boolean }

export type GitCommitDiffTab = {
  key: string
  commit: string
  shortHash: string
  title: string
  mode: GitCommitDiffMode
  path?: string
  previousPath?: string
  leftRevisionLabel?: string
  rightRevisionLabel?: string
}

export type GitCommitDiffTabRequest = {
  commit: string
  shortHash: string
  subject: string
  mode: GitCommitDiffMode
  path?: string
  previousPath?: string
  leftRevisionLabel?: string
  rightRevisionLabel?: string
}

export type RightSidebarTabValue =
  | "files"
  | "review"
  | "history"
  | "commit-diff"

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
