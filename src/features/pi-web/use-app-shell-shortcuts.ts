import * as React from "react"

import type { SessionListEntry } from "@/lib/pi-web-api"

type ShortcutActions = {
  createSession: () => void | Promise<unknown>
  focusModelSelector: () => void
  focusPrompt: () => void
  focusSessionSearch: () => void
  jumpToNextMessage: () => void
  jumpToPreviousMessage: () => void
  openAddDirectoryDialog: () => void
  openCommandPalette: () => void
  openDeleteDialog: (targets: Array<SessionListEntry>) => void
  openDeleteDialogForCurrentSession: () => void
  openForkDialog: () => void | Promise<unknown>
  openRenameDialog: () => void
  openSettingsDialog: () => void
  openTreeDialog: () => void | Promise<unknown>
  runCompact: () => void | Promise<unknown>
  scrollConversationToBottom: () => void
  scrollConversationToTop: () => void
  toggleHideThinking: () => void | Promise<unknown>
  toggleHideToolBlocks: () => void
  cycleThinkingLevel: (direction: -1 | 1) => void | Promise<unknown>
}

export type AppShellShortcutState = {
  currentTab: string
  selectedSidebarSessions: Array<SessionListEntry>
  sessionHasAvailableModels: boolean
  sessionHasFile: boolean
  sidebarSessionEntriesByKey: Map<string, SessionListEntry>
}

type UseAppShellShortcutsOptions = {
  addDirectoryOpenRef: React.MutableRefObject<boolean>
  commandPaletteOpenRef: React.MutableRefObject<boolean>
  deleteOpenRef: React.MutableRefObject<boolean>
  forkOpenRef: React.MutableRefObject<boolean>
  pendingUiRequestOpenRef: React.MutableRefObject<boolean>
  lastEscapePressedAtRef: React.MutableRefObject<number>
  renameOpenRef: React.MutableRefObject<boolean>
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>
  settingsOpenRef: React.MutableRefObject<boolean>
  shortcutActionsRef: React.MutableRefObject<ShortcutActions>
  shortcutStateRef: React.MutableRefObject<AppShellShortcutState>
  treeOpenRef: React.MutableRefObject<boolean>
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
  deleteOpenRef,
  forkOpenRef,
  pendingUiRequestOpenRef,
  lastEscapePressedAtRef,
  renameOpenRef,
  sessionSearchInputRef,
  settingsOpenRef,
  shortcutActionsRef,
  shortcutStateRef,
  treeOpenRef,
}: UseAppShellShortcutsOptions) {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const {
        currentTab,
        selectedSidebarSessions,
        sessionHasAvailableModels,
        sessionHasFile,
        sidebarSessionEntriesByKey,
      } = shortcutStateRef.current
      const modalOpen =
        addDirectoryOpenRef.current ||
        renameOpenRef.current ||
        deleteOpenRef.current ||
        forkOpenRef.current ||
        treeOpenRef.current ||
        settingsOpenRef.current ||
        commandPaletteOpenRef.current ||
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
        ? sidebarSessionEntriesByKey.get(focusedSidebarSessionKey)
        : undefined
      const targetIsSessionSearch =
        event.target instanceof HTMLInputElement &&
        event.target === sessionSearchInputRef.current

      if (
        !modalOpen &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (!isEditableTarget(event.target) || targetIsSessionSearch)
      ) {
        if (
          key === "escape" &&
          !event.repeat &&
          !isEditableTarget(event.target)
        ) {
          const now = Date.now()
          if (now - lastEscapePressedAtRef.current <= 600) {
            event.preventDefault()
            lastEscapePressedAtRef.current = 0
            void shortcutActionsRef.current.openTreeDialog()
            return
          }

          lastEscapePressedAtRef.current = now
          return
        }

        if (
          key !== "shift" &&
          key !== "control" &&
          key !== "meta" &&
          key !== "alt"
        ) {
          lastEscapePressedAtRef.current = 0
        }
        if (
          !activeElementIsConversationViewport &&
          (key === "arrowdown" ||
            key === "arrowup" ||
            key === "home" ||
            key === "end")
        ) {
          const sessionButtons = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-sidebar-session-item]"
            )
          )
          const focusedSessionButton =
            activeElement instanceof HTMLElement
              ? activeElement.closest<HTMLElement>(
                  "[data-sidebar-session-item]"
                )
              : null

          if (sessionButtons.length > 0) {
            const currentIndex = focusedSessionButton
              ? sessionButtons.findIndex(
                  (button) => button === focusedSessionButton
                )
              : -1
            const nextIndex =
              key === "home"
                ? 0
                : key === "end"
                  ? sessionButtons.length - 1
                  : currentIndex >= 0
                    ? Math.max(
                        0,
                        Math.min(
                          sessionButtons.length - 1,
                          currentIndex + (key === "arrowdown" ? 1 : -1)
                        )
                      )
                    : key === "arrowup"
                      ? sessionButtons.length - 1
                      : 0

            event.preventDefault()
            sessionButtons[nextIndex]?.focus()
            return
          }
        }

        if (
          !event.shiftKey &&
          (key === "delete" ||
            (key === "backspace" && selectedSidebarSessions.length > 0))
        ) {
          const targetsToDelete =
            selectedSidebarSessions.length > 0
              ? selectedSidebarSessions
              : focusedSidebarSession?.path
                ? [focusedSidebarSession]
                : []

          if (targetsToDelete.length > 0) {
            event.preventDefault()
            shortcutActionsRef.current.openDeleteDialog(targetsToDelete)
            return
          }
        }
      }

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        key === "enter"
      ) {
        if (modalOpen || event.defaultPrevented) return

        event.preventDefault()
        shortcutActionsRef.current.focusPrompt()
        return
      }

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        currentTab === "session" &&
        !isEditableTarget(event.target)
      ) {
        if (modalOpen || event.defaultPrevented) return

        if (key === "arrowleft") {
          event.preventDefault()
          shortcutActionsRef.current.jumpToPreviousMessage()
          return
        }

        if (key === "arrowright") {
          event.preventDefault()
          shortcutActionsRef.current.jumpToNextMessage()
          return
        }

        if (key === "arrowup") {
          event.preventDefault()
          shortcutActionsRef.current.scrollConversationToTop()
          return
        }

        if (key === "arrowdown") {
          event.preventDefault()
          shortcutActionsRef.current.scrollConversationToBottom()
          return
        }
      }

      if (!event.ctrlKey || event.metaKey || event.altKey) return

      if (modalOpen) return

      if (key === "p" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.openCommandPalette()
        return
      }

      if (key === "n" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.createSession()
        return
      }

      if (key === "s" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.focusSessionSearch()
        return
      }

      if (key === "e" && !event.shiftKey) {
        if (!sessionHasFile) return
        event.preventDefault()
        shortcutActionsRef.current.openRenameDialog()
        return
      }

      if (key === "f" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.openForkDialog()
        return
      }

      if (key === "d" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.openAddDirectoryDialog()
        return
      }

      if (key === "," && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.openSettingsDialog()
        return
      }

      if (key === "m" && !event.shiftKey) {
        if (!sessionHasAvailableModels) return
        event.preventDefault()
        shortcutActionsRef.current.focusModelSelector()
        return
      }

      if (key === "t" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.openTreeDialog()
        return
      }

      if (key === "g" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.toggleHideThinking()
        return
      }

      if (key === "r") {
        event.preventDefault()
        void shortcutActionsRef.current.cycleThinkingLevel(
          event.shiftKey ? -1 : 1
        )
        return
      }

      if (key === "o" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.toggleHideToolBlocks()
        return
      }

      if (key === "c" && !event.shiftKey) {
        if (hasSelectedText(event.target)) return
        event.preventDefault()
        void shortcutActionsRef.current.runCompact()
        return
      }

      if (key === "x" && !event.shiftKey) {
        if (isEditableTarget(event.target)) return
        if (!sessionHasFile) return
        event.preventDefault()
        shortcutActionsRef.current.openDeleteDialogForCurrentSession()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [
    addDirectoryOpenRef,
    commandPaletteOpenRef,
    deleteOpenRef,
    forkOpenRef,
    pendingUiRequestOpenRef,
    lastEscapePressedAtRef,
    renameOpenRef,
    sessionSearchInputRef,
    settingsOpenRef,
    shortcutActionsRef,
    shortcutStateRef,
    treeOpenRef,
  ])
}
