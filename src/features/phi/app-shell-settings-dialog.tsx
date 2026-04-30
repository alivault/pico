import * as React from "react"

import type { DesktopNotificationPermission } from "@/features/phi/session-done-notifications"
import type { ThemeMode } from "@/lib/phi"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"

const THEME_OPTIONS: Array<ThemeMode> = ["system", "light", "dark"]

type SettingsCommand = {
  id: string
  title: string
  description: string
  valueLabel: string
  keywords: Array<string>
  onSelect: () => void | Promise<void>
}

type SettingsCommandGroup = {
  heading: string
  commands: Array<SettingsCommand>
}

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

function formatThemeMode(theme: ThemeMode) {
  return `${theme[0].toUpperCase()}${theme.slice(1)}`
}

function formatToggleValue(enabled: boolean) {
  return enabled ? "On" : "Off"
}

function nextThemeMode(currentTheme: ThemeMode) {
  const currentIndex = THEME_OPTIONS.indexOf(currentTheme)
  const nextIndex = (currentIndex + 1) % THEME_OPTIONS.length

  return THEME_OPTIONS[nextIndex] ?? "system"
}

function settingsCommandKeywords(command: SettingsCommand) {
  return [
    command.title,
    command.description,
    command.valueLabel,
    ...command.keywords,
  ]
}

function settingsCommandFilter(
  value: string,
  search: string,
  keywords?: Array<string>
) {
  const query = search.trim().toLowerCase()

  if (!query) {
    return 1
  }

  const searchableText = [value, ...(keywords ?? [])].join(" ").toLowerCase()

  return searchableText.includes(query) ? 1 : 0
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
  const [query, setQuery] = React.useState("")
  const [selectedCommandId, setSelectedCommandId] = React.useState("theme")
  const isMobile = useIsMobile()
  const desktopNotificationDescription = desktopNotificationPermissionLabel(
    desktopNotificationPermission
  )
  const settingGroups: Array<SettingsCommandGroup> = [
    {
      heading: "Appearance",
      commands: [
        {
          id: "theme",
          title: "Theme",
          description: "Cycle between system, light, and dark mode.",
          valueLabel: formatThemeMode(currentTheme),
          keywords: ["color", "mode", "system", "light", "dark"],
          onSelect: () => onThemeChange(nextThemeMode(currentTheme)),
        },
      ],
    },
    {
      heading: "Conversation display",
      commands: [
        {
          id: "hide-thinking-blocks",
          title: "Hide thinking blocks",
          description:
            "Collapse assistant reasoning into the short hidden-thinking preview.",
          valueLabel: formatToggleValue(hideThinkingBlocks),
          keywords: ["reasoning", "thinking", "display", "collapse"],
          onSelect: () => onHideThinkingBlocksChange(!hideThinkingBlocks),
        },
        {
          id: "hide-tool-calls",
          title: "Hide tool calls",
          description:
            "Hide assistant tool execution cards in the conversation view.",
          valueLabel: formatToggleValue(hideToolBlocks),
          keywords: ["tools", "calls", "display", "cards"],
          onSelect: () => onHideToolBlocksChange(!hideToolBlocks),
        },
        {
          id: "center-messages",
          title: "Center messages at 80ch",
          description:
            "Constrain each message to a centered 80 character column.",
          valueLabel: formatToggleValue(centerMessages),
          keywords: ["center", "messages", "width", "80", "column"],
          onSelect: () => onCenterMessagesChange(!centerMessages),
        },
      ],
    },
    {
      heading: "Session completion notifications",
      commands: [
        {
          id: "desktop-notifications",
          title: "Desktop notifications",
          description: desktopNotificationDescription,
          valueLabel: formatToggleValue(sessionDoneDesktopNotificationsEnabled),
          keywords: [
            "desktop",
            "browser",
            "notifications",
            "permission",
            desktopNotificationPermission,
          ],
          onSelect: () =>
            onSessionDoneDesktopNotificationsEnabledChange(
              !sessionDoneDesktopNotificationsEnabled
            ),
        },
        {
          id: "completion-sound",
          title: "Completion sound",
          description:
            "Play a short confirmation sound when a session finishes.",
          valueLabel: formatToggleValue(sessionDoneSoundEnabled),
          keywords: ["sound", "audio", "completion", "notifications"],
          onSelect: () =>
            onSessionDoneSoundEnabledChange(!sessionDoneSoundEnabled),
        },
      ],
    },
  ]

  React.useEffect(() => {
    if (!open && query) {
      setQuery("")
    }
  }, [open, query])

  const handleSelect = (command: SettingsCommand) => {
    void Promise.resolve(command.onSelect()).catch((error: unknown) => {
      console.error(error)
    })
  }

  const settingsCommandBody = (
    <Command
      shouldFilter
      filter={settingsCommandFilter}
      loop
      value={selectedCommandId}
      onValueChange={setSelectedCommandId}
      className="min-h-0 flex-1"
    >
      <CommandInput
        autoFocus={!isMobile}
        value={query}
        onValueChange={setQuery}
        placeholder="Search settings"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>No settings found.</CommandEmpty>
        {settingGroups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.commands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                keywords={settingsCommandKeywords(command)}
                onSelect={() => handleSelect(command)}
                className="items-start py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{command.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </div>
                <CommandShortcut className="shrink-0 tracking-normal normal-case">
                  {command.valueLabel}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
        Use ↑/↓ to select, Enter to cycle or toggle, and Esc to close.
      </div>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription>Search and update settings.</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {settingsCommandBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Search settings. Press Enter on a setting to cycle or toggle it."
      className="sm:max-w-2xl"
      initialFocus
    >
      {settingsCommandBody}
    </CommandDialog>
  )
}
type AppShellSettingsDialogControllerProps = Omit<
  AppShellSettingsDialogProps,
  "open" | "onOpenChange"
> & {
  ref?: React.Ref<AppShellSettingsDialogHandle>
  openStateRef?: React.RefObject<boolean>
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
