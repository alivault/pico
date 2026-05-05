import * as React from "react"
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys"

import type { SessionListEntry } from "@/lib/phi/api"

const DOUBLE_ESCAPE_INTERVAL_MS = 500

type ShortcutActions = {
  abortCompact: () => void | Promise<unknown>
  abortSession: () => void | Promise<unknown>
  createSession: () => void | Promise<unknown>
  focusModelSelector: () => void
  focusPrompt: () => void
  focusSessionSearch: () => void
  jumpToNextMessage: () => void
  jumpToPreviousMessage: () => void
  openAddDirectoryDialog: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openCommitDialog: () => void
  openDeleteDialog: (targets: Array<SessionListEntry>) => void
  openDeleteDialogForCurrentSession: () => void
  openForkDialog: () => void | Promise<unknown>
  openRenameDialog: () => void
  openSessionsDialog: () => void
  openSettingsDialog: () => void
  openTreeDialog: () => void | Promise<unknown>
  forcePushGitChanges: () => void | Promise<unknown>
  pullGitChanges: () => void | Promise<unknown>
  pushGitChanges: () => void | Promise<unknown>
  scrollConversationToBottom: () => void
  scrollConversationToTop: () => void
  toggleGitPanel: () => void
  toggleHideThinking: () => void | Promise<unknown>
  toggleHideToolBlocks: () => void
  cycleThinkingLevel: (direction: -1 | 1) => void | Promise<unknown>
}

export type AppShellShortcutState = {
  currentTab: string
  selectedSidebarSessions: Array<SessionListEntry>
  sessionHasAvailableModels: boolean
  sessionHasFile: boolean
  sessionIsStreaming: boolean
  sidebarSessionEntriesByKey: Map<string, SessionListEntry>
}

type UseAppShellShortcutsOptions = {
  addDirectoryOpenRef: React.RefObject<boolean>
  commandPaletteOpenRef: React.RefObject<boolean>
  compactRunningRef: React.RefObject<boolean>
  deleteOpenRef: React.RefObject<boolean>
  forkOpenRef: React.RefObject<boolean>
  gitCommitOpenRef: React.RefObject<boolean>
  pendingUiRequestOpenRef: React.RefObject<boolean>
  renameOpenRef: React.RefObject<boolean>
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>
  sessionsOpenRef: React.RefObject<boolean>
  settingsOpenRef: React.RefObject<boolean>
  shortcutActionsRef: React.RefObject<ShortcutActions>
  shortcutStateRef: React.RefObject<AppShellShortcutState>
  treeOpenRef: React.RefObject<boolean>
}

type ShortcutContext = AppShellShortcutState & {
  activeElement: Element | null
  activeElementIsConversationViewport: boolean
  blockingModalOpen: boolean
  commandPaletteOpen: boolean
  focusedSidebarSession?: SessionListEntry
  modalOpen: boolean
  targetIsSessionSearch: boolean
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    target.closest('[contenteditable="true"]') !== null
  )
}

function isPromptTextareaTarget(target: EventTarget | null) {
  return target instanceof HTMLTextAreaElement && target.name === "prompt"
}

function hasSelectedText(target: EventTarget | null) {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.selectionStart !== target.selectionEnd
  }

  if (target instanceof HTMLElement) {
    const selection = window.getSelection()
    return Boolean(selection && String(selection).trim())
  }

  return false
}

export function useAppShellShortcuts({
  addDirectoryOpenRef,
  commandPaletteOpenRef,
  compactRunningRef,
  deleteOpenRef,
  forkOpenRef,
  gitCommitOpenRef,
  pendingUiRequestOpenRef,
  renameOpenRef,
  sessionSearchInputRef,
  sessionsOpenRef,
  settingsOpenRef,
  shortcutActionsRef,
  shortcutStateRef,
  treeOpenRef,
}: UseAppShellShortcutsOptions) {
  const lastEscapeKeyDownAtRef = React.useRef(0)

  const getShortcutContext = (event: KeyboardEvent): ShortcutContext => {
    const shortcutState = shortcutStateRef.current
    const commandPaletteOpen = commandPaletteOpenRef.current
    const blockingModalOpen =
      addDirectoryOpenRef.current ||
      renameOpenRef.current ||
      deleteOpenRef.current ||
      forkOpenRef.current ||
      gitCommitOpenRef.current ||
      treeOpenRef.current ||
      sessionsOpenRef.current ||
      settingsOpenRef.current ||
      pendingUiRequestOpenRef.current
    const activeElement = document.activeElement
    const activeElementIsConversationViewport =
      activeElement instanceof HTMLElement &&
      activeElement.closest('[data-conversation-viewport="true"]') !== null
    const focusedSidebarSessionKey =
      activeElement instanceof HTMLElement
        ? (activeElement.dataset.sessionKey?.trim() ?? "")
        : ""
    const focusedSidebarSession = focusedSidebarSessionKey
      ? shortcutState.sidebarSessionEntriesByKey.get(focusedSidebarSessionKey)
      : undefined
    const targetIsSessionSearch =
      event.target instanceof HTMLInputElement &&
      event.target === sessionSearchInputRef.current

    return {
      ...shortcutState,
      activeElement,
      activeElementIsConversationViewport,
      blockingModalOpen,
      commandPaletteOpen,
      focusedSidebarSession,
      modalOpen: blockingModalOpen || commandPaletteOpen,
      targetIsSessionSearch,
    }
  }

  const closeCommandPaletteForShortcut = (commandPaletteOpen: boolean) => {
    if (commandPaletteOpen) {
      shortcutActionsRef.current.closeCommandPalette()
    }
  }

  const handleEscape = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (event.repeat || context.modalOpen || event.defaultPrevented) return

    const now = Date.now()
    if (now - lastEscapeKeyDownAtRef.current <= DOUBLE_ESCAPE_INTERVAL_MS) {
      lastEscapeKeyDownAtRef.current = 0
      event.preventDefault()
      void shortcutActionsRef.current.openTreeDialog()
      return
    }

    lastEscapeKeyDownAtRef.current = now

    if (compactRunningRef.current) {
      event.preventDefault()
      void shortcutActionsRef.current.abortCompact()
      return
    }

    if (context.sessionIsStreaming && !isEditableTarget(event.target)) {
      event.preventDefault()
      void shortcutActionsRef.current.abortSession()
    }
  }

  const handleSidebarFocusNavigation = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.modalOpen ||
      (isEditableTarget(event.target) && !context.targetIsSessionSearch) ||
      context.activeElementIsConversationViewport
    ) {
      return
    }

    const sessionButtons = Array.from(
      document.querySelectorAll<HTMLElement>("[data-sidebar-session-item]")
    )
    const focusedSessionButton =
      context.activeElement instanceof HTMLElement
        ? context.activeElement.closest<HTMLElement>(
            "[data-sidebar-session-item]"
          )
        : null

    if (sessionButtons.length === 0) return

    const currentIndex = focusedSessionButton
      ? sessionButtons.findIndex((button) => button === focusedSessionButton)
      : -1
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? sessionButtons.length - 1
          : currentIndex >= 0
            ? Math.max(
                0,
                Math.min(
                  sessionButtons.length - 1,
                  currentIndex + (event.key === "ArrowDown" ? 1 : -1)
                )
              )
            : event.key === "ArrowUp"
              ? sessionButtons.length - 1
              : 0

    event.preventDefault()
    sessionButtons[nextIndex]?.focus()
  }

  const handleSidebarDelete = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.modalOpen ||
      (isEditableTarget(event.target) && !context.targetIsSessionSearch)
    ) {
      return
    }

    const targetsToDelete =
      context.selectedSidebarSessions.length > 0
        ? context.selectedSidebarSessions
        : context.focusedSidebarSession?.path
          ? [context.focusedSidebarSession]
          : []

    if (targetsToDelete.length === 0) return

    event.preventDefault()
    shortcutActionsRef.current.openDeleteDialog(targetsToDelete)
  }

  const handleFocusPrompt = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (context.blockingModalOpen || event.defaultPrevented) return

    event.preventDefault()
    closeCommandPaletteForShortcut(context.commandPaletteOpen)
    shortcutActionsRef.current.focusPrompt()
  }

  const handleConversationJump = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.currentTab !== "session" ||
      context.modalOpen ||
      event.defaultPrevented ||
      (isEditableTarget(event.target) && !isPromptTextareaTarget(event.target))
    ) {
      return
    }

    event.preventDefault()

    if (event.key === "ArrowLeft") {
      shortcutActionsRef.current.jumpToPreviousMessage()
      return
    }

    if (event.key === "ArrowRight") {
      shortcutActionsRef.current.jumpToNextMessage()
      return
    }

    if (event.key === "ArrowUp") {
      shortcutActionsRef.current.scrollConversationToTop()
      return
    }

    shortcutActionsRef.current.scrollConversationToBottom()
  }

  const handleGlobalShortcut = (event: KeyboardEvent) => {
    const key =
      event.altKey && event.code.startsWith("Key")
        ? event.code.slice(3).toLowerCase()
        : event.key.toLowerCase()
    const context = getShortcutContext(event)

    if (context.blockingModalOpen) return

    if (key === "\\") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.toggleGitPanel()
      return
    }

    if (key === "k") {
      event.preventDefault()
      shortcutActionsRef.current.openCommandPalette()
      return
    }

    if (key === "p") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)

      if (event.altKey) {
        void shortcutActionsRef.current.pullGitChanges()
        return
      }

      if (event.shiftKey) {
        void shortcutActionsRef.current.forcePushGitChanges()
        return
      }

      void shortcutActionsRef.current.pushGitChanges()
      return
    }

    if (key === "n") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      void shortcutActionsRef.current.createSession()
      return
    }

    if (key === "s") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openSessionsDialog()
      return
    }

    if (key === "e") {
      if (!context.sessionHasFile) return
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openRenameDialog()
      return
    }

    if (key === "f") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      void shortcutActionsRef.current.openForkDialog()
      return
    }

    if (key === "d") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openAddDirectoryDialog()
      return
    }

    if (key === ",") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openSettingsDialog()
      return
    }

    if (key === "m") {
      if (!context.sessionHasAvailableModels && !context.commandPaletteOpen) {
        return
      }
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.focusModelSelector()
      return
    }

    if (key === "t") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      void shortcutActionsRef.current.toggleHideThinking()
      return
    }

    if (key === "r") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      void shortcutActionsRef.current.cycleThinkingLevel(
        event.shiftKey ? -1 : 1
      )
      return
    }

    if (key === "o") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.toggleHideToolBlocks()
      return
    }

    if (key === "c") {
      if (!context.commandPaletteOpen && hasSelectedText(event.target)) return
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openCommitDialog()
      return
    }

    if (key === "x") {
      if (
        isEditableTarget(event.target) &&
        !isPromptTextareaTarget(event.target)
      ) {
        return
      }
      if (!context.sessionHasFile) return
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openDeleteDialogForCurrentSession()
    }
  }

  const hotkeys: Array<UseHotkeyDefinition> = [
    {
      hotkey: "Escape",
      callback: handleEscape,
      options: {
        meta: {
          name: "Abort active session",
          description: "Abort compaction or the streaming assistant response.",
        },
      },
    },
    ...(
      [
        { key: "ArrowDown" },
        { key: "ArrowUp" },
        { key: "Home" },
        { key: "End" },
        { key: "ArrowDown", shift: true },
        { key: "ArrowUp", shift: true },
        { key: "Home", shift: true },
        { key: "End", shift: true },
      ] as const
    ).map((hotkey) => ({
      hotkey,
      callback: handleSidebarFocusNavigation,
      options: {
        meta: {
          name: "Move sidebar focus",
          description: "Move keyboard focus through sidebar sessions.",
        },
      },
    })),
    ...(["Delete", "Backspace"] as const).map((hotkey) => ({
      hotkey,
      callback: handleSidebarDelete,
      options: {
        meta: {
          name: "Delete selected sidebar sessions",
          description:
            "Open the delete dialog for focused or selected sessions.",
        },
      },
    })),
    {
      hotkey: { key: "Enter", ctrl: true },
      callback: handleFocusPrompt,
      options: {
        meta: {
          name: "Focus prompt",
          description: "Focus the prompt composer.",
        },
      },
    },
    ...(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const).map(
      (key) => ({
        hotkey: { key, ctrl: true },
        callback: handleConversationJump,
        options: {
          meta: {
            name: "Navigate conversation",
            description: "Jump between messages or to conversation boundaries.",
          },
        },
      })
    ),
    ...(
      [
        { key: "\\" },
        { key: "K" },
        { key: "P" },
        { key: "P", shift: true },
        { key: "N" },
        { key: "S" },
        { key: "E" },
        { key: "F" },
        { key: "D" },
        { key: "," },
        { key: "M" },
        { key: "T" },
        { key: "R" },
        { key: "R", shift: true },
        { key: "V" },
        { key: "O" },
        { key: "C" },
        { key: "X" },
      ] as const
    ).map((hotkey) => ({
      hotkey: { ...hotkey, ctrl: true },
      callback: handleGlobalShortcut,
      options: {
        meta: {
          name: "App shell shortcut",
          description: "Run a Phi app shell command.",
        },
      },
    })),
    {
      hotkey: { key: "P", alt: true },
      callback: handleGlobalShortcut,
      options: {
        meta: {
          name: "App shell shortcut",
          description: "Run a Phi app shell command.",
        },
      },
    },
  ]

  useHotkeys(hotkeys, {
    conflictBehavior: "allow",
    ignoreInputs: false,
    preventDefault: false,
    stopPropagation: false,
  })
}
