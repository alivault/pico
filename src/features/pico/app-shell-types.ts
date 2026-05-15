import type { DesktopNotificationPermission } from "@/features/pico/session-done-notifications"
import type { SessionDoneEvent, SessionListEntry } from "@/lib/pico/api"

export type SelectSessionNavigationOptions = {
  replace?: boolean
  sessionPath?: string
}

export type CreateSessionOptions = {
  closeMobileSidebar?: boolean
}

export type AppShellSessionWorkspaceHandle = {
  createSession: (
    cwdOverride?: string,
    options?: CreateSessionOptions
  ) => Promise<void>
  openAddDirectoryDialog: () => void
  openCommandPalette: () => void
  openDeleteDialog: (targets: Array<SessionListEntry>) => void
  openDeleteOldDirectorySessionsDialog: (directory: string) => void
  moveSessionToDirectory: (
    entry: SessionListEntry,
    directory: string
  ) => Promise<boolean>
  openMoveSessionDirectoryDialogForEntry: (entry: SessionListEntry) => void
  openRenameDialogForEntry: (entry: SessionListEntry) => void
  openSessionsDialog: () => void
  openSettingsDialog: () => void
  setSessionUnread: (
    entry: SessionListEntry,
    unread: boolean
  ) => Promise<boolean>
  selectSession: (
    nextSessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
}

export type AppShellUiState = {
  currentTab: string
  gitPanelOpen: boolean
  initialLoadingSessionId: string | null
  loadingSessionId: string | null
}

export type AppShellDisplaySettingsState = {
  autoScrollEnabled: boolean
  centerMessages: boolean
  hideToolBlocks: boolean
}

export type AppShellNotificationState = {
  desktopNotificationPermission: DesktopNotificationPermission
  sessionDoneDesktopNotificationsEnabled: boolean
  sessionDoneEvents: Array<SessionDoneEvent>
  sessionDoneSoundEnabled: boolean
}

export type AppShellDraftFlowState = {
  draftSessionLoadingOwnerKey: string | null
  storedDraftDirectory: string
}
