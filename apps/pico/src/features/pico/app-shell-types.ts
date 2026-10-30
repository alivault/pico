import type { DesktopNotificationPermission } from "@/features/pico/agent-done-notifications"
import type { AgentDoneEvent, AgentListEntry } from "@/lib/pico/api"

export type SelectAgentNavigationOptions = {
  replace?: boolean
  agentPath?: string
}

export type CreateAgentOptions = {
  closeMobileSidebar?: boolean
}

export type AppShellAgentWorkspaceHandle = {
  createAgent: (
    cwdOverride?: string,
    options?: CreateAgentOptions
  ) => Promise<void>
  openAddDirectoryDialog: () => void
  openCommandPalette: () => void
  openDeleteDialog: (targets: Array<AgentListEntry>) => void
  openDeleteOldDirectoryAgentsDialog: (directory: string) => void
  moveAgentToDirectory: (
    entry: AgentListEntry,
    directory: string
  ) => Promise<boolean>
  openMoveAgentDirectoryDialogForEntry: (entry: AgentListEntry) => void
  openRenameDialogForEntry: (entry: AgentListEntry) => void
  openAgentsDialog: () => void
  openSettingsDialog: () => void
  setAgentUnread: (entry: AgentListEntry, unread: boolean) => Promise<boolean>
  markAgentsRead: (entries: Array<AgentListEntry>) => Promise<boolean>
  selectAgent: (
    nextAgentId?: string,
    options?: SelectAgentNavigationOptions
  ) => void
}

export type AppShellUiState = {
  currentTab: string
  gitPanelOpen: boolean
  terminalPanelOpen: boolean
  initialLoadingAgentId: string | null
  loadingAgentId: string | null
}

export type AppShellDisplaySettingsState = {
  autoScrollEnabled: boolean
  centerMessages: boolean
  hideToolBlocks: boolean
}

export type AppShellNotificationState = {
  desktopNotificationPermission: DesktopNotificationPermission
  agentDoneDesktopNotificationsEnabled: boolean
  agentDoneEvents: Array<AgentDoneEvent>
  agentDoneSoundEnabled: boolean
}

export type AppShellDraftFlowState = {
  draftAgentLoadingOwnerKey: string | null
  storedDraftDirectory: string
}
