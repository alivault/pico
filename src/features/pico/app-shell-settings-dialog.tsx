import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"

import type { DesktopNotificationPermission } from "@/features/pico/session-done-notifications"
import {
  THEME_COLOR_MODES,
  THEME_FAMILIES,
  themeColorModeLabel,
  themeFamilyDescription,
  themeFamilyKeywords,
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
const SETTINGS_DIALOG_AUTO_FOCUS_MEDIA = "(min-width: 768px)"

function shouldAutoFocusSettingsDialogInput() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(SETTINGS_DIALOG_AUTO_FOCUS_MEDIA).matches
  )
}

type SettingsDialogStage = "browse" | "theme"

type SettingsDialogState = {
  query: string
  themeQuery: string
  stage: SettingsDialogStage
  selectedCommandId: string
  selectedTheme: ThemeFamily
}

type SettingsDialogAction =
  | { type: "reset"; currentTheme: ThemeFamily }
  | { type: "set-query"; query: string }
  | { type: "set-theme-query"; themeQuery: string }
  | { type: "set-selected-command-id"; selectedCommandId: string }
  | { type: "open-theme"; currentTheme: ThemeFamily }
  | { type: "close-theme"; selectedTheme: ThemeFamily }
  | { type: "preview-theme"; selectedTheme: ThemeFamily }

function createInitialSettingsDialogState(
  currentTheme: ThemeFamily
): SettingsDialogState {
  return {
    query: "",
    themeQuery: "",
    stage: "browse",
    selectedCommandId: "theme",
    selectedTheme: currentTheme,
  }
}

function settingsDialogReducer(
  state: SettingsDialogState,
  action: SettingsDialogAction
): SettingsDialogState {
  switch (action.type) {
    case "reset":
      return createInitialSettingsDialogState(action.currentTheme)
    case "set-query":
      return { ...state, query: action.query }
    case "set-theme-query":
      return { ...state, themeQuery: action.themeQuery }
    case "set-selected-command-id":
      return { ...state, selectedCommandId: action.selectedCommandId }
    case "open-theme":
      return { ...state, stage: "theme", selectedTheme: action.currentTheme }
    case "close-theme":
      return { ...state, stage: "browse", selectedTheme: action.selectedTheme }
    case "preview-theme":
      return { ...state, selectedTheme: action.selectedTheme }
  }
}

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
  onThemePreviewChange: (value: ThemeFamily) => void
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

type SettingsCommandGroupsOptions = Pick<
  AppShellSettingsDialogProps,
  | "currentTheme"
  | "currentThemeColorMode"
  | "systemTheme"
  | "hideThinkingBlocks"
  | "onHideThinkingBlocksChange"
  | "hideToolBlocks"
  | "onHideToolBlocksChange"
  | "centerMessages"
  | "onCenterMessagesChange"
  | "autoScrollEnabled"
  | "onAutoScrollEnabledChange"
  | "sessionDoneSoundEnabled"
  | "onSessionDoneSoundEnabledChange"
  | "sessionDoneDesktopNotificationsEnabled"
  | "onSessionDoneDesktopNotificationsEnabledChange"
  | "desktopNotificationPermission"
  | "onLoginProviders"
  | "onLogoutProviders"
> & {
  onThemeCommand: () => void
  onThemeColorModeCommand: () => void
}

function getSettingsCommandGroups({
  currentTheme,
  currentThemeColorMode,
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
  onThemeCommand,
  onThemeColorModeCommand,
}: SettingsCommandGroupsOptions): Array<SettingsCommandGroup> {
  const desktopNotificationDescription = desktopNotificationPermissionLabel(
    desktopNotificationPermission
  )

  return [
    {
      heading: "Appearance",
      commands: [
        {
          id: "theme",
          title: "Theme",
          description: "Choose a color palette.",
          valueLabel: themeFamilyLabel(currentTheme),
          keywords: [
            "color",
            "mode",
            "palette",
            ...THEME_OPTIONS.flatMap((theme) => themeFamilyKeywords(theme)),
          ],
          onSelect: onThemeCommand,
        },
        {
          id: "theme-color-mode",
          title: "Light/dark mode",
          description: "Follow OS appearance, or force light or dark mode.",
          valueLabel: themeColorModeLabel(currentThemeColorMode, systemTheme),
          keywords: ["auto", "system", "light", "dark", "mode", "color"],
          onSelect: onThemeColorModeCommand,
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
}

type SettingsBrowseBodyProps = {
  query: string
  selectedCommandId: string
  settingGroups: Array<SettingsCommandGroup>
  onQueryChange: (query: string) => void
  onSelectedCommandIdChange: (commandId: string) => void
  onSelectCommand: (command: SettingsCommand) => void
}

function SettingsBrowseBody({
  query,
  selectedCommandId,
  settingGroups,
  onQueryChange,
  onSelectedCommandIdChange,
  onSelectCommand,
}: SettingsBrowseBodyProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!shouldAutoFocusSettingsDialogInput()) return

    inputRef.current?.focus()
  }, [])

  return (
    <Command
      shouldFilter
      filter={settingsCommandFilter}
      loop
      value={selectedCommandId}
      onValueChange={onSelectedCommandIdChange}
      className="min-h-0 flex-1"
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={onQueryChange}
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
                onSelect={() => onSelectCommand(command)}
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
}

type SettingsThemeBodyProps = {
  currentTheme: ThemeFamily
  selectedTheme: ThemeFamily
  themeQuery: string
  onThemeQueryChange: (query: string) => void
  onThemePreview: (theme: ThemeFamily) => void
  onThemeSelect: (theme: ThemeFamily) => void
  onCancelThemePreview: () => void
}

function SettingsThemeBody({
  currentTheme,
  selectedTheme,
  themeQuery,
  onThemeQueryChange,
  onThemePreview,
  onThemeSelect,
  onCancelThemePreview,
}: SettingsThemeBodyProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!shouldAutoFocusSettingsDialogInput()) return

    inputRef.current?.focus()
  }, [])

  return (
    <div
      role="presentation"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        onCancelThemePreview()
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancelThemePreview}
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
        onValueChange={(value) => onThemePreview(value as ThemeFamily)}
        className="min-h-0 flex-1 rounded-none!"
      >
        <CommandInput
          ref={inputRef}
          value={themeQuery}
          onValueChange={onThemeQueryChange}
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
                keywords={themeFamilyKeywords(theme)}
                onSelect={() => onThemeSelect(theme)}
                data-checked={theme === currentTheme ? true : undefined}
                className="items-start py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {themeFamilyLabel(theme)}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {themeFamilyDescription(theme)}
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
}

function SettingsDialogBody({
  stage,
  browseBodyProps,
  themeBodyProps,
}: {
  stage: SettingsDialogStage
  browseBodyProps: SettingsBrowseBodyProps
  themeBodyProps: SettingsThemeBodyProps
}) {
  if (stage === "theme") {
    return <SettingsThemeBody {...themeBodyProps} />
  }

  return <SettingsBrowseBody {...browseBodyProps} />
}

function AppShellSettingsDialog({
  open,
  onOpenChange,
  currentTheme,
  currentThemeColorMode,
  onThemeChange,
  onThemeColorModeChange,
  onThemePreviewChange,
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
  const [state, dispatch] = React.useReducer(
    settingsDialogReducer,
    currentTheme,
    createInitialSettingsDialogState
  )
  const themePreviewInitialRef = React.useRef<ThemeFamily>(currentTheme)
  const isMobile = useIsMobile()

  React.useEffect(() => {
    if (open) return

    if (state.stage === "theme") {
      onThemePreviewChange(themePreviewInitialRef.current)
    }

    dispatch({ type: "reset", currentTheme })
  }, [currentTheme, onThemePreviewChange, open, state.stage])

  const handleSelect = (command: SettingsCommand) => {
    void Promise.resolve(command.onSelect()).catch((error: unknown) => {
      console.error(error)
    })
  }

  const handleThemePreview = (theme: ThemeFamily) => {
    if (!THEME_OPTIONS.includes(theme)) return

    dispatch({ type: "preview-theme", selectedTheme: theme })
    onThemePreviewChange(theme)
  }

  const handleThemeSelect = (theme: ThemeFamily) => {
    dispatch({ type: "preview-theme", selectedTheme: theme })
    themePreviewInitialRef.current = theme
    onThemeChange(theme)
    onOpenChange(false)
  }

  const cancelThemePreview = () => {
    const initialTheme = themePreviewInitialRef.current
    dispatch({ type: "close-theme", selectedTheme: initialTheme })
    onThemePreviewChange(initialTheme)
  }

  const settingGroups = getSettingsCommandGroups({
    currentTheme,
    currentThemeColorMode,
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
    onThemeCommand: () => {
      themePreviewInitialRef.current = currentTheme
      dispatch({ type: "open-theme", currentTheme })
    },
    onThemeColorModeCommand: () =>
      onThemeColorModeChange(nextThemeColorMode(currentThemeColorMode)),
  })

  const settingsCommandBody = (
    <SettingsDialogBody
      stage={state.stage}
      browseBodyProps={{
        query: state.query,
        selectedCommandId: state.selectedCommandId,
        settingGroups,
        onQueryChange: (query) => dispatch({ type: "set-query", query }),
        onSelectedCommandIdChange: (selectedCommandId) =>
          dispatch({ type: "set-selected-command-id", selectedCommandId }),
        onSelectCommand: handleSelect,
      }}
      themeBodyProps={{
        currentTheme,
        selectedTheme: state.selectedTheme,
        themeQuery: state.themeQuery,
        onThemeQueryChange: (themeQuery) =>
          dispatch({ type: "set-theme-query", themeQuery }),
        onThemePreview: handleThemePreview,
        onThemeSelect: handleThemeSelect,
        onCancelThemePreview: cancelThemePreview,
      }}
    />
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
