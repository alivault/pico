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
  openAddProjectDialog: () => void
  openCommandPalette: () => void
  openDeleteDialog: (targets: Array<AgentListEntry>) => void
  openDeleteOldProjectAgentsDialog: (project: string) => void
  moveAgentToProject: (
    entry: AgentListEntry,
    project: string
  ) => Promise<boolean>
  openMoveAgentProjectDialogForEntry: (entry: AgentListEntry) => void
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
  storedDraftProject: string
}
