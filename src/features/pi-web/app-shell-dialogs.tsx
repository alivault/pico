import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type {
  ForkMessage,
  TreeNavigateOptions,
} from "@/features/pi-web/app-shell-dialog-types"
import type { FlatTreeNode, ThemeMode } from "@/lib/pi-web"
import type { ExtensionUiEvent } from "@/lib/pi-web-api"

import { AppShellSettingsDialog } from "@/features/pi-web/app-shell-settings-dialog"
import {
  DeleteSessionsDialog,
  ForkSessionDialog,
  RenameSessionDialog,
} from "@/features/pi-web/app-shell-session-dialogs"
import { AppShellTreeDialog } from "@/features/pi-web/app-shell-tree-dialog"
import { AppShellUiRequestDialog } from "@/features/pi-web/app-shell-ui-request-dialog"

type AppShellDialogsProps = {
  renameOpen: boolean
  onRenameOpenChange: (open: boolean) => void
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRenameSession: () => void
  deleteOpen: boolean
  onDeleteOpenChange: (open: boolean) => void
  deleteTitle: string
  deleteDescription: string
  onDeleteSession: () => void
  forkOpen: boolean
  onForkOpenChange: (open: boolean) => void
  forkLoading: boolean
  forkMessages: Array<ForkMessage> | null
  onForkFromMessage: (entryId: string) => void
  treeOpen: boolean
  onTreeOpenChange: (open: boolean) => void
  treeLoading: boolean
  treeSubmitting: boolean
  treeLeafId: string | null
  treeSummaryAvailable: boolean
  treeQuery: string
  onTreeQueryChange: (value: string) => void
  flatTree: Array<FlatTreeNode>
  selectedTreeNodeId: string | null
  onSelectedTreeNodeIdChange: (value: string | null) => void
  selectedTreeNodeLabel: string
  onSelectedTreeNodeLabelChange: (value: string) => void
  onNavigateTreeNode: (
    targetId: string,
    options?: TreeNavigateOptions
  ) => Promise<void> | void
  onSaveTreeLabel: () => Promise<void> | void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  currentTheme: ThemeMode
  onThemeChange: (value: ThemeMode) => void
  hideThinkingBlocks: boolean
  onHideThinkingBlocksChange: (hidden: boolean) => void
  hideToolBlocks: boolean
  onHideToolBlocksChange: (hidden: boolean) => void
  centerMessages: boolean
  onCenterMessagesChange: (centered: boolean) => void
  sessionDoneSoundEnabled: boolean
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  sessionDoneDesktopNotificationsEnabled: boolean
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  desktopNotificationPermission: DesktopNotificationPermission
  pendingUiRequest: ExtensionUiEvent | null
  pendingUiValue: string
  onPendingUiValueChange: (value: string) => void
  onResolveUiRequest: (body: Record<string, unknown>) => void
}

export function AppShellDialogs({
  renameOpen,
  onRenameOpenChange,
  renameValue,
  onRenameValueChange,
  onRenameSession,
  deleteOpen,
  onDeleteOpenChange,
  deleteTitle,
  deleteDescription,
  onDeleteSession,
  forkOpen,
  onForkOpenChange,
  forkLoading,
  forkMessages,
  onForkFromMessage,
  treeOpen,
  onTreeOpenChange,
  treeLoading,
  treeSubmitting,
  treeLeafId,
  treeSummaryAvailable,
  treeQuery,
  onTreeQueryChange,
  flatTree,
  selectedTreeNodeId,
  onSelectedTreeNodeIdChange,
  selectedTreeNodeLabel,
  onSelectedTreeNodeLabelChange,
  onNavigateTreeNode,
  onSaveTreeLabel,
  settingsOpen,
  onSettingsOpenChange,
  currentTheme,
  onThemeChange,
  hideThinkingBlocks,
  onHideThinkingBlocksChange,
  hideToolBlocks,
  onHideToolBlocksChange,
  centerMessages,
  onCenterMessagesChange,
  sessionDoneSoundEnabled,
  onSessionDoneSoundEnabledChange,
  sessionDoneDesktopNotificationsEnabled,
  onSessionDoneDesktopNotificationsEnabledChange,
  desktopNotificationPermission,
  pendingUiRequest,
  pendingUiValue,
  onPendingUiValueChange,
  onResolveUiRequest,
}: AppShellDialogsProps) {
  return (
    <>
      <RenameSessionDialog
        open={renameOpen}
        onOpenChange={onRenameOpenChange}
        renameValue={renameValue}
        onRenameValueChange={onRenameValueChange}
        onRenameSession={onRenameSession}
      />

      <DeleteSessionsDialog
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
        title={deleteTitle}
        description={deleteDescription}
        onDeleteSession={onDeleteSession}
      />

      <ForkSessionDialog
        open={forkOpen}
        onOpenChange={onForkOpenChange}
        forkLoading={forkLoading}
        forkMessages={forkMessages}
        onForkFromMessage={onForkFromMessage}
      />

      <AppShellTreeDialog
        open={treeOpen}
        onOpenChange={onTreeOpenChange}
        treeLoading={treeLoading}
        treeSubmitting={treeSubmitting}
        treeLeafId={treeLeafId}
        treeSummaryAvailable={treeSummaryAvailable}
        treeQuery={treeQuery}
        onTreeQueryChange={onTreeQueryChange}
        flatTree={flatTree}
        selectedTreeNodeId={selectedTreeNodeId}
        onSelectedTreeNodeIdChange={onSelectedTreeNodeIdChange}
        selectedTreeNodeLabel={selectedTreeNodeLabel}
        onSelectedTreeNodeLabelChange={onSelectedTreeNodeLabelChange}
        onNavigateTreeNode={onNavigateTreeNode}
        onSaveTreeLabel={onSaveTreeLabel}
      />

      <AppShellSettingsDialog
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        currentTheme={currentTheme}
        onThemeChange={onThemeChange}
        hideThinkingBlocks={hideThinkingBlocks}
        onHideThinkingBlocksChange={onHideThinkingBlocksChange}
        hideToolBlocks={hideToolBlocks}
        onHideToolBlocksChange={onHideToolBlocksChange}
        centerMessages={centerMessages}
        onCenterMessagesChange={onCenterMessagesChange}
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        onSessionDoneDesktopNotificationsEnabledChange={
          onSessionDoneDesktopNotificationsEnabledChange
        }
        desktopNotificationPermission={desktopNotificationPermission}
      />

      <AppShellUiRequestDialog
        pendingUiRequest={pendingUiRequest}
        pendingUiValue={pendingUiValue}
        onPendingUiValueChange={onPendingUiValueChange}
        onResolveUiRequest={onResolveUiRequest}
      />
    </>
  )
}
