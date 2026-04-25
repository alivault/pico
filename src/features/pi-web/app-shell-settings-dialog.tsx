import * as React from "react"

import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type { ThemeMode } from "@/lib/pi-web"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"

const THEME_OPTIONS: Array<ThemeMode> = ["system", "light", "dark"]

function desktopNotificationPermissionLabel(
  permission: DesktopNotificationPermission
) {
  if (permission === "unsupported") {
    return "Desktop notifications are unavailable in this browser."
  }

  if (permission === "granted") {
    return "Desktop notifications are enabled for this origin."
  }

  if (permission === "denied") {
    return "Desktop notifications are blocked in this browser."
  }

  return "Desktop notifications will ask for browser permission when enabled."
}

export type AppShellSettingsDialogHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

type AppShellSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
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
}

export function AppShellSettingsDialog({
  open,
  onOpenChange,
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
}: AppShellSettingsDialogProps) {
  const isMobile = useIsMobile()

  const settingsSections = (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Theme</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map((themeOption) => (
            <Button
              key={themeOption}
              variant={currentTheme === themeOption ? "default" : "outline"}
              onClick={() => onThemeChange(themeOption)}
            >
              {themeOption[0].toUpperCase()}
              {themeOption.slice(1)}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Conversation display</h3>
        </div>

        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Hide thinking blocks</div>
            <div className="text-sm text-muted-foreground">
              Collapse assistant reasoning into the short hidden-thinking
              preview.
            </div>
          </div>
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={hideThinkingBlocks}
            onChange={(event) =>
              onHideThinkingBlocksChange(event.target.checked)
            }
          />
        </label>

        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Hide tool calls</div>
            <div className="text-sm text-muted-foreground">
              Hide assistant tool execution cards in the conversation view.
            </div>
          </div>
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={hideToolBlocks}
            onChange={(event) => onHideToolBlocksChange(event.target.checked)}
          />
        </label>

        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Center messages at 80ch</div>
            <div className="text-sm text-muted-foreground">
              Constrain each message to a centered 80 character column.
            </div>
          </div>
          <input
            name="center-messages"
            type="checkbox"
            className="mt-1 size-4"
            checked={centerMessages}
            onChange={(event) => onCenterMessagesChange(event.target.checked)}
          />
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">
            Session completion notifications
          </h3>
        </div>

        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Desktop notifications</div>
            <div className="text-sm text-muted-foreground">
              {desktopNotificationPermissionLabel(
                desktopNotificationPermission
              )}
            </div>
          </div>
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={sessionDoneDesktopNotificationsEnabled}
            onChange={(event) =>
              onSessionDoneDesktopNotificationsEnabledChange(
                event.target.checked
              )
            }
          />
        </label>

        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Completion sound</div>
            <div className="text-sm text-muted-foreground">
              Play a short confirmation sound when a session finishes.
            </div>
          </div>
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={sessionDoneSoundEnabled}
            onChange={(event) =>
              onSessionDoneSoundEnabledChange(event.target.checked)
            }
          />
        </label>
      </section>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription className="sr-only">
              Customize theme, conversation display, and session completion
              notifications.
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            {settingsSections}
          </div>
          <DrawerFooter className="border-t border-border/70">
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        {settingsSections}
      </DialogContent>
    </Dialog>
  )
}
type AppShellSettingsDialogControllerProps = Omit<
  AppShellSettingsDialogProps,
  "open" | "onOpenChange"
> & {
  ref?: React.Ref<AppShellSettingsDialogHandle>
  openStateRef?: React.MutableRefObject<boolean>
}

export function AppShellSettingsDialogController({
  ref,
  openStateRef,
  ...props
}: AppShellSettingsDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpenState(true)
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    []
  )

  return (
    <AppShellSettingsDialog
      open={open}
      onOpenChange={setOpenState}
      {...props}
    />
  )
}
