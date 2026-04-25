import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type { ThemeMode } from "@/lib/pi-web"
import type { ExtensionUiEvent } from "@/lib/pi-web-api"

import { AppShellSettingsDialog } from "@/features/pi-web/app-shell-settings-dialog"
import { AppShellUiRequestDialog } from "@/features/pi-web/app-shell-ui-request-dialog"

type AppShellDialogsProps = {
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
