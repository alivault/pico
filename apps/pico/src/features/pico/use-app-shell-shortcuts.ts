import * as React from "react"
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys"

import type { AgentListEntry } from "@/lib/pico/api"

import {
  appModifierFlag,
  matchesShortcutEvent,
  pullShortcut,
  rightSidebarPaneShortcutKeys,
  type RightSidebarShortcutPane,
} from "./keyboard-shortcuts"
import { isInShownMachineShell } from "@/lib/pico/machine-context"
import { getShownSidebarAgentItems } from "./sidebar-agent-numbers"

const DOUBLE_ESCAPE_INTERVAL_MS = 500

type ShortcutActions = {
  abortCompact: () => void | Promise<unknown>
  abortAgent: () => void | Promise<unknown>
  createAgent: () => void | Promise<unknown>
  focusModelSelector: () => void
  focusPrompt: () => void
  focusAgentSearch: () => void
  jumpToNextMessage: () => void
  jumpToPreviousMessage: () => void
  openAddProjectDialog: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openCommitDialog: () => void
  openDeleteDialog: (targets: Array<AgentListEntry>) => void
  openDeleteDialogForCurrentAgent: () => void
  openForkDialog: () => void | Promise<unknown>
  openRenameDialog: () => void
  openAgentsDialog: () => void
  openSettingsDialog: () => void
  openTreeDialog: () => void | Promise<unknown>
  forcePushGitChanges: () => void | Promise<unknown>
  pullGitChanges: () => void | Promise<unknown>
  pushGitChanges: () => void | Promise<unknown>
  scrollConversationToBottom: () => void
  scrollConversationToTop: () => void
  toggleGitPanel: () => void
  toggleRightSidebarPane: (pane: RightSidebarShortcutPane) => void
  toggleTerminalPanel: () => void
  toggleHideThinking: () => void | Promise<unknown>
  toggleHideToolBlocks: () => void
  cycleThinkingLevel: (direction: -1 | 1) => void | Promise<unknown>
}

export type AppShellShortcutState = {
  currentTab: string
  selectedSidebarAgents: Array<AgentListEntry>
  agentHasAvailableModels: boolean
  agentHasFile: boolean
  agentIsStreaming: boolean
  sidebarAgentEntriesByKey: Map<string, AgentListEntry>
}

type UseAppShellShortcutsOptions = {
  addProjectOpenRef: React.RefObject<boolean>
  commandPaletteOpenRef: React.RefObject<boolean>
  compactRunningRef: React.RefObject<boolean>
  deleteOpenRef: React.RefObject<boolean>
  forkOpenRef: React.RefObject<boolean>
  gitCommitOpenRef: React.RefObject<boolean>
  moveAgentProjectOpenRef: React.RefObject<boolean>
  pendingUiRequestOpenRef: React.RefObject<boolean>
  renameOpenRef: React.RefObject<boolean>
  agentSearchInputRef: React.RefObject<HTMLInputElement | null>
  agentsOpenRef: React.RefObject<boolean>
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
  focusedSidebarAgent?: AgentListEntry
  modalOpen: boolean
  targetIsAgentSearch: boolean
}

function isTerminalTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest('[data-terminal-panel="true"]') !== null
  )
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    isTerminalTarget(target) ||
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

function isCurrentSidebarAgentItem(element: HTMLElement) {
  return element.dataset.currentAgent !== undefined
}

// Open the agent in the sidebar that is `offset` rows from the current
// agent. Without a current agent, go to the first or last row.
function openAdjacentSidebarAgent(offset: -1 | 1) {
  const items = getShownSidebarAgentItems()
  if (items.length === 0) return

  const currentIndex = items.findIndex(isCurrentSidebarAgentItem)
  const nextIndex =
    currentIndex < 0
      ? offset > 0
        ? 0
        : items.length - 1
      : Math.max(0, Math.min(items.length - 1, currentIndex + offset))
  if (nextIndex === currentIndex) return
  items[nextIndex]?.click()
}

// Open the first agent of the previous or next sidebar group (a project
// or the pinned group). Groups without shown agents are skipped.
function openAdjacentSidebarGroup(offset: -1 | 1) {
  const groups = Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-agent-group]")
  ).flatMap((group) => {
    if (!isInShownMachineShell(group)) return []
    const items = getShownSidebarAgentItems(group)
    return items.length > 0 ? [{ group, items }] : []
  })
  if (groups.length === 0) return

  const currentIndex = groups.findIndex(({ items }) =>
    items.some(isCurrentSidebarAgentItem)
  )
  const nextIndex =
    currentIndex < 0
      ? offset > 0
        ? 0
        : groups.length - 1
      : currentIndex + offset
  groups[nextIndex]?.items[0]?.click()
}

function openSidebarAgentAt(index: number) {
  getShownSidebarAgentItems()[index]?.click()
}

export function useAppShellShortcuts({
  addProjectOpenRef,
  commandPaletteOpenRef,
  compactRunningRef,
  deleteOpenRef,
  forkOpenRef,
  gitCommitOpenRef,
  moveAgentProjectOpenRef,
  pendingUiRequestOpenRef,
  renameOpenRef,
  agentSearchInputRef,
  agentsOpenRef,
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
      addProjectOpenRef.current ||
      renameOpenRef.current ||
      deleteOpenRef.current ||
      forkOpenRef.current ||
      gitCommitOpenRef.current ||
      moveAgentProjectOpenRef.current ||
      treeOpenRef.current ||
      agentsOpenRef.current ||
      settingsOpenRef.current ||
      pendingUiRequestOpenRef.current
    const activeElement = document.activeElement
    const activeElementIsConversationViewport =
      activeElement instanceof HTMLElement &&
      activeElement.closest('[data-conversation-viewport="true"]') !== null
    const focusedSidebarAgentKey =
      activeElement instanceof HTMLElement
        ? (activeElement.dataset.agentKey?.trim() ?? "")
        : ""
    const focusedSidebarAgent = focusedSidebarAgentKey
      ? shortcutState.sidebarAgentEntriesByKey.get(focusedSidebarAgentKey)
      : undefined
    const targetIsAgentSearch =
      event.target instanceof HTMLInputElement &&
      event.target === agentSearchInputRef.current

    return {
      ...shortcutState,
      activeElement,
      activeElementIsConversationViewport,
      blockingModalOpen,
      commandPaletteOpen,
      focusedSidebarAgent,
      modalOpen: blockingModalOpen || commandPaletteOpen,
      targetIsAgentSearch,
    }
  }

  const closeCommandPaletteForShortcut = (commandPaletteOpen: boolean) => {
    if (commandPaletteOpen) {
      shortcutActionsRef.current.closeCommandPalette()
    }
  }

  const handleEscape = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      event.repeat ||
      context.modalOpen ||
      event.defaultPrevented ||
      isTerminalTarget(event.target)
    ) {
      return
    }

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

    if (context.agentIsStreaming && !isEditableTarget(event.target)) {
      event.preventDefault()
      void shortcutActionsRef.current.abortAgent()
    }
  }

  const handleSidebarFocusNavigation = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.modalOpen ||
      (isEditableTarget(event.target) && !context.targetIsAgentSearch) ||
      context.activeElementIsConversationViewport
    ) {
      return
    }

    const agentButtons = Array.from(
      document.querySelectorAll<HTMLElement>("[data-sidebar-agent-item]")
    ).filter(isInShownMachineShell)
    const focusedAgentButton =
      context.activeElement instanceof HTMLElement
        ? context.activeElement.closest<HTMLElement>(
            "[data-sidebar-agent-item]"
          )
        : null

    if (agentButtons.length === 0) return

    const currentIndex = focusedAgentButton
      ? agentButtons.findIndex((button) => button === focusedAgentButton)
      : -1
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? agentButtons.length - 1
          : currentIndex >= 0
            ? Math.max(
                0,
                Math.min(
                  agentButtons.length - 1,
                  currentIndex + (event.key === "ArrowDown" ? 1 : -1)
                )
              )
            : event.key === "ArrowUp"
              ? agentButtons.length - 1
              : 0

    event.preventDefault()
    agentButtons[nextIndex]?.focus()
  }

  const handleSidebarBackspaceDelete = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.modalOpen ||
      (isEditableTarget(event.target) && !context.targetIsAgentSearch)
    ) {
      return
    }

    if (context.selectedSidebarAgents.length <= 1) return

    event.preventDefault()
    shortcutActionsRef.current.openDeleteDialog(context.selectedSidebarAgents)
  }

  const handleFocusPrompt = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.blockingModalOpen ||
      event.defaultPrevented ||
      isTerminalTarget(event.target)
    ) {
      return
    }

    event.preventDefault()
    closeCommandPaletteForShortcut(context.commandPaletteOpen)
    shortcutActionsRef.current.focusPrompt()
  }

  const handleConversationJump = (event: KeyboardEvent) => {
    const context = getShortcutContext(event)

    if (
      context.currentTab !== "conversation" ||
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

  const handleSidebarAgentSwitch = (event: KeyboardEvent, open: () => void) => {
    const context = getShortcutContext(event)

    if (
      context.blockingModalOpen ||
      event.defaultPrevented ||
      isTerminalTarget(event.target)
    ) {
      return
    }

    event.preventDefault()
    closeCommandPaletteForShortcut(context.commandPaletteOpen)
    open()
  }

  const handleRightSidebarPaneShortcut = (
    event: KeyboardEvent,
    pane: RightSidebarShortcutPane
  ) => {
    const context = getShortcutContext(event)

    if (context.blockingModalOpen || event.defaultPrevented) return
    if (isTerminalTarget(event.target) && !context.commandPaletteOpen) return

    event.preventDefault()
    closeCommandPaletteForShortcut(context.commandPaletteOpen)
    shortcutActionsRef.current.toggleRightSidebarPane(pane)
  }

  const handleGlobalShortcut = (event: KeyboardEvent) => {
    const key =
      event.altKey && event.code.startsWith("Key")
        ? event.code.slice(3).toLowerCase()
        : event.key.toLowerCase()
    const context = getShortcutContext(event)

    if (context.blockingModalOpen || event.defaultPrevented) return
    if (
      isTerminalTarget(event.target) &&
      !context.commandPaletteOpen &&
      key !== "j"
    ) {
      return
    }

    if (key === "\\") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.toggleGitPanel()
      return
    }

    if (key === "j") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.toggleTerminalPanel()
      return
    }

    if (key === "k") {
      event.preventDefault()
      shortcutActionsRef.current.openCommandPalette()
      return
    }

    if (matchesShortcutEvent(event, pullShortcut)) {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      void shortcutActionsRef.current.pullGitChanges()
      return
    }

    if (key === "p") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)

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
      void shortcutActionsRef.current.createAgent()
      return
    }

    if (key === "s") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openAgentsDialog()
      return
    }

    if (key === "e") {
      if (!context.agentHasFile) return
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
      shortcutActionsRef.current.openAddProjectDialog()
      return
    }

    if (key === ",") {
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openSettingsDialog()
      return
    }

    if (key === "m") {
      if (!context.agentHasAvailableModels && !context.commandPaletteOpen) {
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
      if (context.selectedSidebarAgents.length > 1) {
        event.preventDefault()
        closeCommandPaletteForShortcut(context.commandPaletteOpen)
        shortcutActionsRef.current.openDeleteDialog(
          context.selectedSidebarAgents
        )
        return
      }
      if (!context.agentHasFile) return
      event.preventDefault()
      closeCommandPaletteForShortcut(context.commandPaletteOpen)
      shortcutActionsRef.current.openDeleteDialogForCurrentAgent()
    }
  }

  const hotkeys: Array<UseHotkeyDefinition> = [
    {
      hotkey: "Escape",
      callback: handleEscape,
      options: {
        meta: {
          name: "Abort active agent",
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
          description: "Move keyboard focus through sidebar agents.",
        },
      },
    })),
    {
      hotkey: "Backspace",
      callback: handleSidebarBackspaceDelete,
      options: {
        meta: {
          name: "Archive selected sidebar agents",
          description:
            "Open the archive dialog for multiple selected sidebar agents.",
        },
      },
    },
    {
      hotkey: { key: "Enter", ...appModifierFlag },
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
        hotkey: { key, ...appModifierFlag },
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
        { key: "ArrowUp", offset: -1 },
        { key: "ArrowDown", offset: 1 },
      ] as const
    ).map(({ key, offset }) => ({
      hotkey: { key, shift: true, ...appModifierFlag },
      callback: (event: KeyboardEvent) => {
        handleSidebarAgentSwitch(event, () => {
          openAdjacentSidebarAgent(offset)
        })
      },
      options: {
        meta: {
          name: "Open previous or next agent",
          description: "Open the agent above or below in the sidebar.",
        },
      },
    })),
    ...(
      [
        { key: "[", offset: -1 },
        { key: "]", offset: 1 },
      ] as const
    ).map(({ key, offset }) => ({
      hotkey: { key, ...appModifierFlag },
      callback: (event: KeyboardEvent) => {
        handleSidebarAgentSwitch(event, () => {
          openAdjacentSidebarGroup(offset)
        })
      },
      options: {
        meta: {
          name: "Open previous or next project",
          description:
            "Open the first agent of the project above or below in the sidebar.",
        },
      },
    })),
    ...(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map(
      (key, index) => ({
        hotkey: { key, ...appModifierFlag },
        callback: (event: KeyboardEvent) => {
          handleSidebarAgentSwitch(event, () => {
            openSidebarAgentAt(index)
          })
        },
        options: {
          meta: {
            name: "Open sidebar agent by number",
            description: "Open the Nth agent in the sidebar.",
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
        { key: "J" },
      ] as const
    ).map((hotkey) => ({
      hotkey: { ...hotkey, ...appModifierFlag },
      callback: handleGlobalShortcut,
      options: {
        meta: {
          name: "App shell shortcut",
          description: "Run a Pico app shell command.",
        },
      },
    })),
    ...(
      Object.entries(rightSidebarPaneShortcutKeys) as Array<
        [RightSidebarShortcutPane, string]
      >
    ).map(([pane, key]) => ({
      hotkey: { key, shift: true, ...appModifierFlag },
      callback: (event: KeyboardEvent) => {
        handleRightSidebarPaneShortcut(event, pane)
      },
      options: {
        meta: {
          name: "Open right sidebar pane",
          description: "Open or close a pane of the right sidebar.",
        },
      },
    })),
    {
      hotkey: pullShortcut,
      callback: handleGlobalShortcut,
      options: {
        meta: {
          name: "App shell shortcut",
          description: "Run a Pico app shell command.",
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
