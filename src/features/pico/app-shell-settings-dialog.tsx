import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"

import type { DesktopNotificationPermission } from "@/features/pico/session-done-notifications"
import {
  THEME_FAMILIES,
  themeColorModeLabel,
  themeFamilyDescription,
  themeFamilyFixedMode,
  themeFamilyKeywords,
  themeFamilyLabel,
  themeFamilySupportsColorMode,
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
const THEME_SELECTION_SECTION_CONFIGS = [
  { heading: "Auto", colorMode: "auto" },
  { heading: "Dark", colorMode: "dark" },
  { heading: "Light", colorMode: "light" },
] as const satisfies ReadonlyArray<{
  heading: string
  colorMode: ThemeColorMode
}>
const THEME_SELECTION_SECTIONS = THEME_SELECTION_SECTION_CONFIGS.map(
  (section) => ({
    ...section,
    themes: THEME_OPTIONS.filter((theme) =>
      themeFamilySupportsColorMode(theme, section.colorMode)
    ),
  })
)
const SETTINGS_DIALOG_AUTO_FOCUS_MEDIA = "(min-width: 768px)"

type ThemeSelection = {
  theme: ThemeFamily
  colorMode: ThemeColorMode
}

function shouldAutoFocusSettingsDialogInput() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(SETTINGS_DIALOG_AUTO_FOCUS_MEDIA).matches
  )
}

function isThemeColorMode(value: string): value is ThemeColorMode {
  return value === "auto" || value === "light" || value === "dark"
}

function themeSelectionKey(selection: ThemeSelection) {
  return `${selection.colorMode}:${selection.theme}`
}

function themeSelectionFromKey(value: string): ThemeSelection | undefined {
  const separatorIndex = value.indexOf(":")

  if (separatorIndex < 0) return undefined

  const colorMode = value.slice(0, separatorIndex)
  const theme = value.slice(separatorIndex + 1)

  if (!isThemeColorMode(colorMode)) return undefined
  if (!THEME_OPTIONS.includes(theme as ThemeFamily)) return undefined

  const normalizedTheme = theme as ThemeFamily
  if (!themeFamilySupportsColorMode(normalizedTheme, colorMode)) {
    return undefined
  }

  return { theme: normalizedTheme, colorMode }
}

function themeSelectionForCurrent(
  theme: ThemeFamily,
  colorMode: ThemeColorMode
): ThemeSelection {
  return {
    theme,
    colorMode: themeFamilyFixedMode(theme) ?? colorMode,
  }
}

function themeSelectionModeLabel(
  selection: ThemeSelection,
  systemTheme?: string
) {
  if (selection.colorMode === "auto") {
    return themeColorModeLabel(selection.colorMode, systemTheme)
  }

  return selection.colorMode === "light" ? "Light" : "Dark"
}

function themeSelectionValueLabel(
  selection: ThemeSelection,
  systemTheme?: string
) {
  return `${themeFamilyLabel(selection.theme)} · ${themeSelectionModeLabel(
    selection,
    systemTheme
  )}`
}

function themeSelectionDescription(selection: ThemeSelection) {
  if (selection.colorMode === "auto") {
    return `Auto: ${themeFamilyDescription(selection.theme)}`
  }

  const fixedMode = themeFamilyFixedMode(selection.theme)
  if (fixedMode) {
    return `${themeSelectionModeLabel(selection)} only: ${themeFamilyDescription(
      selection.theme
    )}`
  }

  return themeFamilyDescription(selection.theme)
}

function themeSelectionKeywords(selection: ThemeSelection) {
  return [
    selection.colorMode,
    themeSelectionModeLabel(selection),
    ...themeFamilyKeywords(selection.theme),
  ]
}

type SettingsDialogStage = "browse" | "theme"

type SettingsDialogState = {
  query: string
  themeQuery: string
  stage: SettingsDialogStage
  selectedCommandId: string
  selectedTheme: ThemeSelection
}

type SettingsDialogAction =
  | {
      type: "reset"
      currentTheme: ThemeFamily
      currentThemeColorMode: ThemeColorMode
    }
  | { type: "set-query"; query: string }
  | { type: "set-theme-query"; themeQuery: string }
  | { type: "set-selected-command-id"; selectedCommandId: string }
  | {
      type: "open-theme"
      currentTheme: ThemeFamily
      currentThemeColorMode: ThemeColorMode
    }
  | { type: "close-theme"; selectedTheme: ThemeSelection }
  | { type: "preview-theme"; selectedTheme: ThemeSelection }

function createInitialSettingsDialogState(
  currentTheme: ThemeFamily,
  currentThemeColorMode: ThemeColorMode
): SettingsDialogState {
  return {
    query: "",
    themeQuery: "",
    stage: "browse",
    selectedCommandId: "theme",
    selectedTheme: themeSelectionForCurrent(
      currentTheme,
      currentThemeColorMode
    ),
  }
}

function settingsDialogReducer(
  state: SettingsDialogState,
  action: SettingsDialogAction
): SettingsDialogState {
  switch (action.type) {
    case "reset":
      return createInitialSettingsDialogState(
        action.currentTheme,
        action.currentThemeColorMode
      )
    case "set-query":
      return { ...state, query: action.query }
    case "set-theme-query":
      return { ...state, themeQuery: action.themeQuery }
    case "set-selected-command-id":
      return { ...state, selectedCommandId: action.selectedCommandId }
    case "open-theme":
      return {
        ...state,
        stage: "theme",
        selectedTheme: themeSelectionForCurrent(
          action.currentTheme,
          action.currentThemeColorMode
        ),
      }
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
  onThemePreviewChange: (value: ThemeFamily, colorMode: ThemeColorMode) => void
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
          description: "Choose an auto, dark, or light color palette.",
          valueLabel: themeSelectionValueLabel(
            themeSelectionForCurrent(currentTheme, currentThemeColorMode),
            systemTheme
          ),
          keywords: [
            "auto",
            "system",
            "light",
            "dark",
            "color",
            "mode",
            "palette",
            ...THEME_OPTIONS.flatMap((theme) => themeFamilyKeywords(theme)),
          ],
          onSelect: onThemeCommand,
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
  currentThemeColorMode: ThemeColorMode
  selectedTheme: ThemeSelection
  systemTheme?: string
  themeQuery: string
  onThemeQueryChange: (query: string) => void
  onThemePreview: (selection: ThemeSelection) => void
  onThemeSelect: (selection: ThemeSelection) => void
  onCancelThemePreview: () => void
}

function SettingsThemeBody({
  currentTheme,
  currentThemeColorMode,
  selectedTheme,
  systemTheme,
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
            Current:{" "}
            {themeSelectionValueLabel(
              themeSelectionForCurrent(currentTheme, currentThemeColorMode),
              systemTheme
            )}
          </div>
        </div>
      </div>
      <Command
        shouldFilter
        loop
        value={themeSelectionKey(selectedTheme)}
        onValueChange={(value) => {
          const selection = themeSelectionFromKey(value)
          if (selection) onThemePreview(selection)
        }}
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
          {THEME_SELECTION_SECTIONS.map((section) => (
            <CommandGroup
              key={section.colorMode}
              heading={section.heading}
              className="**:[[cmdk-group-heading]]:sticky **:[[cmdk-group-heading]]:top-0 **:[[cmdk-group-heading]]:z-10 **:[[cmdk-group-heading]]:bg-popover"
            >
              {section.themes.map((theme) => {
                const selection = { theme, colorMode: section.colorMode }
                const selectionKey = themeSelectionKey(selection)
                const currentSelection = themeSelectionForCurrent(
                  currentTheme,
                  currentThemeColorMode
                )

                return (
                  <CommandItem
                    key={selectionKey}
                    value={selectionKey}
                    keywords={themeSelectionKeywords(selection)}
                    onSelect={() => onThemeSelect(selection)}
                    data-checked={
                      selectionKey === themeSelectionKey(currentSelection)
                        ? true
                        : undefined
                    }
                    className="items-start py-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {themeFamilyLabel(theme)}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {themeSelectionDescription(selection)}
                      </span>
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
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
    { currentTheme, currentThemeColorMode },
    ({ currentTheme: initialTheme, currentThemeColorMode: initialColorMode }) =>
      createInitialSettingsDialogState(initialTheme, initialColorMode)
  )
  const themePreviewInitialRef = React.useRef<ThemeSelection>(
    themeSelectionForCurrent(currentTheme, currentThemeColorMode)
  )
  const isMobile = useIsMobile()

  React.useEffect(() => {
    if (open) return

    if (state.stage === "theme") {
      onThemePreviewChange(
        themePreviewInitialRef.current.theme,
        themePreviewInitialRef.current.colorMode
      )
    }

    dispatch({ type: "reset", currentTheme, currentThemeColorMode })
  }, [
    currentTheme,
    currentThemeColorMode,
    onThemePreviewChange,
    open,
    state.stage,
  ])

  const handleSelect = (command: SettingsCommand) => {
    void Promise.resolve(command.onSelect()).catch((error: unknown) => {
      console.error(error)
    })
  }

  const handleThemePreview = (selection: ThemeSelection) => {
    if (!THEME_OPTIONS.includes(selection.theme)) return
    if (!themeFamilySupportsColorMode(selection.theme, selection.colorMode))
      return

    dispatch({ type: "preview-theme", selectedTheme: selection })
    onThemePreviewChange(selection.theme, selection.colorMode)
  }

  const handleThemeSelect = (selection: ThemeSelection) => {
    dispatch({ type: "preview-theme", selectedTheme: selection })
    themePreviewInitialRef.current = selection
    onThemeColorModeChange(selection.colorMode)
    onThemeChange(selection.theme)
    onOpenChange(false)
  }

  const cancelThemePreview = () => {
    const initialTheme = themePreviewInitialRef.current
    dispatch({ type: "close-theme", selectedTheme: initialTheme })
    onThemePreviewChange(initialTheme.theme, initialTheme.colorMode)
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
      themePreviewInitialRef.current = themeSelectionForCurrent(
        currentTheme,
        currentThemeColorMode
      )
      dispatch({ type: "open-theme", currentTheme, currentThemeColorMode })
    },
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
        currentThemeColorMode,
        selectedTheme: state.selectedTheme,
        systemTheme,
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
