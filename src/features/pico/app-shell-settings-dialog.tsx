import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"

import type { DesktopNotificationPermission } from "@/features/pico/session-done-notifications"
import {
  THEME_COLOR_MODES,
  THEME_FAMILIES,
  themeColorModeLabel,
  themeFamilyLabel,
  type ThemeColorMode,
  type ThemeFamily,
} from "@/lib/pico"

import { Button } from "@/components/ui/button"
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

const THEME_OPTIONS: Array<ThemeFamily> = [...THEME_FAMILIES]
const THEME_COLOR_MODE_OPTIONS: Array<ThemeColorMode> = [...THEME_COLOR_MODES]

type SettingsDialogStage = "browse" | "theme"

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

function formatToggleValue(enabled: boolean) {
  return enabled ? "On" : "Off"
}

function nextThemeColorMode(currentMode: ThemeColorMode) {
  const currentIndex = THEME_COLOR_MODE_OPTIONS.indexOf(currentMode)
  const nextIndex = (currentIndex + 1) % THEME_COLOR_MODE_OPTIONS.length

  return THEME_COLOR_MODE_OPTIONS[nextIndex] ?? "auto"
}

function themeDescription(theme: ThemeFamily) {
  switch (theme) {
    case "default":
      return "Use Pico's default palette."
    case "flexoki":
      return "Use Flexoki's warm paper and inky dark palettes."
    default:
      return "Use this theme."
  }
}

function themeKeywords(theme: ThemeFamily) {
  return [theme, themeFamilyLabel(theme), themeDescription(theme)]
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
  currentTheme: ThemeFamily
  currentThemeColorMode: ThemeColorMode
  onThemeChange: (value: ThemeFamily) => void
  onThemeColorModeChange: (value: ThemeColorMode) => void
  systemTheme?: string
  hideThinkingBlocks: boolean
  onHideThinkingBlocksChange: (hidden: boolean) => void
  hideToolBlocks: boolean
  onHideToolBlocksChange: (hidden: boolean) => void
  centerMessages: boolean
  onCenterMessagesChange: (centered: boolean) => void
  autoScrollEnabled: boolean
  onAutoScrollEnabledChange: (enabled: boolean) => void
  sessionDoneSoundEnabled: boolean
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  sessionDoneDesktopNotificationsEnabled: boolean
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  desktopNotificationPermission: DesktopNotificationPermission
  onLoginProviders: () => void
  onLogoutProviders: () => void
}

export function AppShellSettingsDialog({
  open,
  onOpenChange,
  currentTheme,
  currentThemeColorMode,
  onThemeChange,
  onThemeColorModeChange,
  systemTheme,
  hideThinkingBlocks,
  onHideThinkingBlocksChange,
  hideToolBlocks,
  onHideToolBlocksChange,
  centerMessages,
  onCenterMessagesChange,
  autoScrollEnabled,
  onAutoScrollEnabledChange,
  sessionDoneSoundEnabled,
  onSessionDoneSoundEnabledChange,
  sessionDoneDesktopNotificationsEnabled,
  onSessionDoneDesktopNotificationsEnabledChange,
  desktopNotificationPermission,
  onLoginProviders,
  onLogoutProviders,
}: AppShellSettingsDialogProps) {
  const [query, setQuery] = React.useState("")
  const [themeQuery, setThemeQuery] = React.useState("")
  const [stage, setStage] = React.useState<SettingsDialogStage>("browse")
  const [selectedCommandId, setSelectedCommandId] = React.useState("theme")
  const [selectedTheme, setSelectedTheme] =
    React.useState<ThemeFamily>(currentTheme)
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
          description: "Choose between Default and Flexoki.",
          valueLabel: themeFamilyLabel(currentTheme),
          keywords: ["color", "mode", "default", "flexoki"],
          onSelect: () => setStage("theme"),
        },
        {
          id: "theme-color-mode",
          title: "Light/dark mode",
          description: "Follow OS appearance, or force light or dark mode.",
          valueLabel: themeColorModeLabel(currentThemeColorMode, systemTheme),
          keywords: ["auto", "system", "light", "dark", "mode", "color"],
          onSelect: () =>
            onThemeColorModeChange(nextThemeColorMode(currentThemeColorMode)),
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
        {
          id: "auto-scroll-latest",
          title: "Auto-scroll to latest messages",
          description:
            "Follow new messages and streaming output automatically.",
          valueLabel: formatToggleValue(autoScrollEnabled),
          keywords: ["auto", "scroll", "latest", "follow", "streaming"],
          onSelect: () => onAutoScrollEnabledChange(!autoScrollEnabled),
        },
      ],
    },
    {
      heading: "Provider authentication",
      commands: [
        {
          id: "login-providers",
          title: "Login to provider",
          description:
            "Authenticate a subscription provider or save a provider API key.",
          valueLabel: "Open",
          keywords: ["auth", "authentication", "login", "provider", "api key"],
          onSelect: onLoginProviders,
        },
        {
          id: "logout-providers",
          title: "Logout from provider",
          description:
            "Remove saved provider credentials from pi auth storage.",
          valueLabel: "Open",
          keywords: ["auth", "authentication", "logout", "provider", "remove"],
          onSelect: onLogoutProviders,
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
    if (!open) {
      if (query) setQuery("")
      if (themeQuery) setThemeQuery("")
      setStage("browse")
      return
    }
  }, [open, query, themeQuery])

  React.useEffect(() => {
    if (stage === "theme") {
      setSelectedTheme(currentTheme)
    }
  }, [currentTheme, stage])

  const handleSelect = (command: SettingsCommand) => {
    void Promise.resolve(command.onSelect()).catch((error: unknown) => {
      console.error(error)
    })
  }

  const handleThemeSelect = (theme: ThemeFamily) => {
    setSelectedTheme(theme)
    onThemeChange(theme)
  }

  const settingsBrowseBody = (
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
                <CommandShortcut className="inline shrink-0 tracking-normal normal-case">
                  {command.valueLabel}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
        Use ↑/↓ to select, Enter to open or toggle, and Esc to close.
      </div>
    </Command>
  )

  const settingsThemeBody = (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        setStage("browse")
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setStage("browse")}
          aria-label="Back to settings"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Choose theme</div>
          <div className="truncate text-xs text-muted-foreground">
            Current: {themeFamilyLabel(currentTheme)}
          </div>
        </div>
      </div>
      <Command
        shouldFilter
        loop
        value={selectedTheme}
        onValueChange={(value) => setSelectedTheme(value as ThemeFamily)}
        className="min-h-0 flex-1 rounded-none!"
      >
        <CommandInput
          autoFocus={!isMobile}
          value={themeQuery}
          onValueChange={setThemeQuery}
          placeholder="Search themes"
          className="text-base md:text-sm"
        />
        <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,28rem)]">
          <CommandEmpty>No themes found.</CommandEmpty>
          <CommandGroup heading="Themes">
            {THEME_OPTIONS.map((theme) => (
              <CommandItem
                key={theme}
                value={theme}
                keywords={themeKeywords(theme)}
                onSelect={() => handleThemeSelect(theme)}
                data-checked={theme === currentTheme ? true : undefined}
                className="items-start py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {themeFamilyLabel(theme)}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {themeDescription(theme)}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
          Use ↑/↓ to select, Enter to choose, and Esc to go back.
        </div>
      </Command>
    </div>
  )

  const settingsCommandBody =
    stage === "theme" ? settingsThemeBody : settingsBrowseBody

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
      description="Search settings. Press Enter on a setting to open or toggle it."
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
