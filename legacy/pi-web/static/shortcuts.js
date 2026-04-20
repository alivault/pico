export function createShortcutHandlers({
  state,
  toggleSidebarVisibility,
  cycleThinkingLevel,
  openCommandPalette,
  createNewSessionInDirectory,
  defaultNewSessionDirectory,
  showToast,
  focusSessionSearch,
  openTreeDialog,
  movePathCompletionSelection,
  moveSlashCommandSelection,
  isPathCompletionOpen,
  isSlashCommandQueryActive,
  focusModelResult,
  focusThinkingResult,
  focusCommandPaletteResult,
  focusDirectoryDialogResult,
  focusForkDialogResult,
  focusTreeDialogResult,
  focusSessionResult,
  focusModelBoundary,
  focusThinkingBoundary,
  focusCommandPaletteBoundary,
  focusDirectoryDialogBoundary,
  focusForkDialogBoundary,
  focusTreeDialogBoundary,
  focusTreeDialogHalfPage,
  focusTreeDialogPage,
  toggleTreeDialogNode,
  appendTreeDialogQuery,
  deleteTreeDialogQueryChar,
  appendSessionSearchQuery,
  deleteSessionSearchQueryChar,
  appendCommandPaletteQuery,
  deleteCommandPaletteQueryChar,
  appendDirectoryDialogQuery,
  deleteDirectoryDialogQueryChar,
  appendForkDialogQuery,
  deleteForkDialogQueryChar,
  clearTreeDialogQuery,
  selectFocusedTreeDialogNode,
  cycleTreeDialogFilter,
  setTreeDialogFilterMode,
  toggleTreeDialogLabelTimestamps,
  toggleTreeDialogShortcutsHelp,
  openTreeDialogLabelEditor,
  focusSessionBoundary,
  openDirectoryDialog,
  openSettingsDialog,
  openShortcutsDialog,
  openForkDialog,
  openRenameDialog,
  openModelMenu,
  toggleThinkingVisibility,
  toggleToolVisibility,
  deleteSessionByPath,
  deleteSelectedOrFocusedSidebarSessions,
  submitBuiltinSlashCommand,
  abortRunningSlashCommand,
  abortStreamingResponse,
  closeCommandPalette,
  closeDirectoryDialog,
  closeForkDialog,
  handleTreeDialogEscape,
  closeStatusDialog,
  closeShortcutsDialog,
  closeSettingsDialog,
  closeConfirmDialog,
  closeRenameDialog,
  closeHeaderSessionMenu,
  closeSessionMenu,
  closeDirectoryMenu,
  closeComposerPopovers,
  dismissDialog,
  isSidebarVisible,
  sidebarKeyboardTarget,
  isMobileViewport,
  closeSidebar,
  focusPromptField,
}) {
  const DOUBLE_ESCAPE_TREE_DELAY_MS = 500
  let lastPlainEscapeAt = 0

  function resetDoubleEscapeToTree() {
    lastPlainEscapeAt = 0
  }

  function isPlainEscape(event) {
    return (
      event.key === "Escape" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    )
  }

  function maybeOpenTreeOnDoubleEscape(event) {
    if (!isPlainEscape(event) || event.repeat) {
      return false
    }

    if (state.loadingSession || state.streaming) {
      resetDoubleEscapeToTree()
      return false
    }

    const now = Date.now()
    if (
      lastPlainEscapeAt &&
      now - lastPlainEscapeAt <= DOUBLE_ESCAPE_TREE_DELAY_MS
    ) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      event.stopImmediatePropagation()
      void openTreeDialog().catch((error) => {
        showToast(error?.message || "Failed to open the session tree.", "error")
      })
      return true
    }

    lastPlainEscapeAt = now
    return false
  }

  function hasNoFocusedElement() {
    const activeElement = document.activeElement
    return (
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement
    )
  }

  function shouldPreserveCopyShortcut(event) {
    const selection =
      typeof document.getSelection === "function"
        ? document.getSelection()
        : null
    if (selection && !selection.isCollapsed && String(selection).length > 0) {
      return true
    }

    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      try {
        return (
          typeof target.selectionStart === "number" &&
          typeof target.selectionEnd === "number" &&
          target.selectionStart !== target.selectionEnd
        )
      } catch {
        return false
      }
    }

    return target instanceof HTMLElement && target.isContentEditable
  }

  function handleSidebarSessionDeleteKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return false
    if (event.key !== "Backspace" && event.key !== "Delete") return false

    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
      return false
    if (target instanceof HTMLElement && target.isContentEditable) return false

    const activeElement = document.activeElement
    const sessionItem =
      activeElement instanceof Element
        ? activeElement.closest(".session-item")
        : null
    const hasSidebarSelection =
      Array.isArray(state.selectedSidebarSessionKeys) &&
      state.selectedSidebarSessionKeys.length > 0
    if (!sessionItem) return false
    if (event.key === "Backspace" && !hasSidebarSelection) return false

    event.preventDefault()
    event.stopImmediatePropagation()
    void deleteSelectedOrFocusedSidebarSessions()
    return true
  }

  function handleShortcutKeydown(event) {
    const key = event.key.toLowerCase()

    if (state.confirmDialog || state.renameDialog) return false

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      key === "b"
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      toggleSidebarVisibility({ focusPromptOnClose: true })
      return true
    }

    if (!event.ctrlKey || event.metaKey || event.altKey) return false

    if (event.code === "Slash" || key === "/" || key === "?") {
      if (state.dialog) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!state.shortcutsDialogOpen) {
        openShortcutsDialog()
      }
      return true
    }

    if (key === "r") {
      event.preventDefault()
      event.stopImmediatePropagation()
      void cycleThinkingLevel(event.shiftKey ? -1 : 1)
      return true
    }

    if (event.shiftKey) return false

    if (key === "p") {
      event.preventDefault()
      event.stopImmediatePropagation()
      openCommandPalette()
      return true
    }
    if (key === "n") {
      event.preventDefault()
      event.stopImmediatePropagation()
      void createNewSessionInDirectory(defaultNewSessionDirectory()).catch(
        (error) => {
          showToast(error.message, "error")
        }
      )
      return true
    }
    if (key === "s") {
      event.preventDefault()
      event.stopImmediatePropagation()
      focusSessionSearch()
      return true
    }
    if (key === "j") {
      if (
        !movePathCompletionSelection(1) &&
        !moveSlashCommandSelection(1) &&
        !focusModelResult(1) &&
        !focusThinkingResult(1) &&
        !focusCommandPaletteResult(1) &&
        !focusDirectoryDialogResult(1) &&
        !focusForkDialogResult(1) &&
        !focusTreeDialogResult(1) &&
        !focusSessionResult(1)
      )
        return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    if (key === "k") {
      if (
        !movePathCompletionSelection(-1) &&
        !moveSlashCommandSelection(-1) &&
        !focusModelResult(-1) &&
        !focusThinkingResult(-1) &&
        !focusCommandPaletteResult(-1) &&
        !focusDirectoryDialogResult(-1) &&
        !focusForkDialogResult(-1) &&
        !focusTreeDialogResult(-1) &&
        !focusSessionResult(-1)
      )
        return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    if (key === "d") {
      event.preventDefault()
      event.stopImmediatePropagation()
      openDirectoryDialog()
      return true
    }
    if (key === "e") {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!state.sessionFile) {
        showToast("Start the session before renaming it.", "error")
        return true
      }
      openRenameDialog(
        state.sessionFile,
        state.sessionName === "Current session" ? "" : state.sessionName || ""
      )
      return true
    }
    if (key === "f") {
      event.preventDefault()
      event.stopImmediatePropagation()
      void openForkDialog().catch((error) => {
        showToast(error?.message || "Failed to fork session.", "error")
      })
      return true
    }
    if (key === "c") {
      if (shouldPreserveCopyShortcut(event)) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      void submitBuiltinSlashCommand({ name: "compact" }, "")
      return true
    }
    if (key === "x") {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!state.sessionFile) {
        showToast("Start the session before deleting it.", "error")
        return true
      }
      const currentName =
        state.sessionName === "Current session" ? "" : state.sessionName || ""
      const firstMessage =
        typeof state.firstMessage === "string" ? state.firstMessage.trim() : ""
      const fallbackTitleRaw = currentName || firstMessage || "New session"
      const fallbackTitle =
        fallbackTitleRaw.length > 60
          ? `${fallbackTitleRaw.slice(0, 57)}...`
          : fallbackTitleRaw
      void deleteSessionByPath(
        state.sessionFile,
        state.sessionId,
        fallbackTitle
      )
      return true
    }
    if (event.code === "Comma" || key === ",") {
      event.preventDefault()
      event.stopImmediatePropagation()
      openSettingsDialog()
      return true
    }
    if (key === "m") {
      if (!openModelMenu()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    if (key === "t") {
      event.preventDefault()
      event.stopImmediatePropagation()
      void toggleThinkingVisibility()
      return true
    }
    if (key === "o") {
      event.preventDefault()
      event.stopImmediatePropagation()
      toggleToolVisibility()
      return true
    }

    return false
  }

  function handleListNavigationKeydown(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) return false
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false

    const direction = event.key === "ArrowDown" ? 1 : -1
    if (
      !movePathCompletionSelection(direction) &&
      !focusModelResult(direction) &&
      !focusThinkingResult(direction) &&
      !focusCommandPaletteResult(direction) &&
      !focusDirectoryDialogResult(direction) &&
      !focusForkDialogResult(direction) &&
      !focusTreeDialogResult(direction) &&
      !focusSessionResult(direction)
    ) {
      return false
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    return true
  }

  function handleListBoundaryKeydown(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) return false
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false

    const toEnd = event.key === "ArrowRight"
    if (
      !focusModelBoundary(toEnd) &&
      !focusThinkingBoundary(toEnd) &&
      !focusCommandPaletteBoundary(toEnd) &&
      !focusDirectoryDialogBoundary(toEnd) &&
      !focusForkDialogBoundary(toEnd) &&
      !focusSessionBoundary(toEnd)
    ) {
      return false
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    return true
  }

  function handleTreeDialogKeydown(event) {
    if (state.treeDialog?.stage !== "browse") return false

    const key = event.key.toLowerCase()

    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.code === "Slash" || key === "/" || key === "?")
    ) {
      if (!toggleTreeDialogShortcutsHelp()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (state.treeDialog?.showShortcutsHelp) {
      if (event.key === "Escape") {
        if (!toggleTreeDialogShortcutsHelp()) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      return false
    }

    if (state.treeDialog?.showLabelEditor) {
      if (event.key === "Escape") {
        handleTreeDialogEscape()
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      return false
    }

    const target = event.target
    const editingText =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    const isPlainTextInput =
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.length === 1 &&
      !(event.shiftKey && key === "t")

    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key === "Escape" &&
      state.treeDialog?.query
    ) {
      if (!clearTreeDialogQuery()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (
      !editingText &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key === "Backspace"
    ) {
      deleteTreeDialogQueryChar()
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (!editingText && isPlainTextInput) {
      if (!appendTreeDialogQuery(event.key)) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (
        !editingText &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        if (!toggleTreeDialogNode(event.key === "ArrowRight")) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
    }

    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!focusTreeDialogBoundary(event.key === "ArrowDown")) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!event.shiftKey && key === "j") {
        if (!focusTreeDialogResult(1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "k") {
        if (!focusTreeDialogResult(-1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "h") {
        if (!toggleTreeDialogNode(false)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "l") {
        if (!toggleTreeDialogNode(true)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "u") {
        if (!focusTreeDialogHalfPage(-1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "d") {
        if (!focusTreeDialogHalfPage(1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "b") {
        if (!focusTreeDialogPage(-1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (!event.shiftKey && key === "f") {
        if (!focusTreeDialogPage(1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (key === "o") {
        if (!cycleTreeDialogFilter(event.shiftKey ? -1 : 1)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (event.shiftKey && key === "d") {
        if (!setTreeDialogFilterMode("default")) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (event.shiftKey && key === "t") {
        const nextMode =
          state.treeDialog?.filterMode === "no-tools" ? "default" : "no-tools"
        if (!setTreeDialogFilterMode(nextMode)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (event.shiftKey && key === "u") {
        const nextMode =
          state.treeDialog?.filterMode === "user-only" ? "default" : "user-only"
        if (!setTreeDialogFilterMode(nextMode)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (event.shiftKey && key === "l") {
        const nextMode =
          state.treeDialog?.filterMode === "labeled-only"
            ? "default"
            : "labeled-only"
        if (!setTreeDialogFilterMode(nextMode)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
      if (event.shiftKey && key === "a") {
        const nextMode =
          state.treeDialog?.filterMode === "all" ? "default" : "all"
        if (!setTreeDialogFilterMode(nextMode)) return false
        event.preventDefault()
        event.stopImmediatePropagation()
        return true
      }
    }

    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.shiftKey &&
      key === "l"
    ) {
      if (!openTreeDialogLabelEditor()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.shiftKey &&
      key === "t"
    ) {
      if (!toggleTreeDialogLabelTimestamps()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key === "Enter"
    ) {
      if (!selectFocusedTreeDialogNode()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    return false
  }

  function handleFilterableListSearchKeydown(
    event,
    { enabled, itemSelector, appendQuery, deleteQueryChar }
  ) {
    if (!enabled) return false
    if (event.isComposing) return false

    const target = event.target
    if (!(target instanceof Element)) return false
    if (!target.closest(itemSelector)) return false

    const editingText =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    if (editingText) return false

    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key === "Backspace"
    ) {
      if (!deleteQueryChar()) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.length === 1
    ) {
      if (!appendQuery(event.key)) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }

    return false
  }

  function handleSessionSearchKeydown(event) {
    return handleFilterableListSearchKeydown(event, {
      enabled: true,
      itemSelector: ".session-item-main",
      appendQuery: appendSessionSearchQuery,
      deleteQueryChar: deleteSessionSearchQueryChar,
    })
  }

  function handleCommandPaletteSearchKeydown(event) {
    return handleFilterableListSearchKeydown(event, {
      enabled: state.commandPaletteOpen,
      itemSelector: ".command-palette-item",
      appendQuery: appendCommandPaletteQuery,
      deleteQueryChar: deleteCommandPaletteQueryChar,
    })
  }

  function handleDirectoryDialogSearchKeydown(event) {
    return handleFilterableListSearchKeydown(event, {
      enabled: state.directoryDialogOpen,
      itemSelector: ".command-palette-item",
      appendQuery: appendDirectoryDialogQuery,
      deleteQueryChar: deleteDirectoryDialogQueryChar,
    })
  }

  function handleForkDialogSearchKeydown(event) {
    return handleFilterableListSearchKeydown(event, {
      enabled: Boolean(state.forkDialog),
      itemSelector: ".fork-dialog-item",
      appendQuery: appendForkDialogQuery,
      deleteQueryChar: deleteForkDialogQueryChar,
    })
  }

  function handleGlobalKeydown(event) {
    if (handleTreeDialogKeydown(event)) {
      resetDoubleEscapeToTree()
      return
    }
    if (
      state.treeDialog?.showShortcutsHelp ||
      state.treeDialog?.showLabelEditor
    ) {
      resetDoubleEscapeToTree()
      return
    }
    if (handleSidebarSessionDeleteKeydown(event)) {
      resetDoubleEscapeToTree()
      return
    }
    if (
      handleSessionSearchKeydown(event) ||
      handleCommandPaletteSearchKeydown(event) ||
      handleDirectoryDialogSearchKeydown(event) ||
      handleForkDialogSearchKeydown(event)
    ) {
      resetDoubleEscapeToTree()
      return
    }
    if (handleListBoundaryKeydown(event)) {
      resetDoubleEscapeToTree()
      return
    }
    if (handleListNavigationKeydown(event)) {
      resetDoubleEscapeToTree()
      return
    }
    if (handleShortcutKeydown(event)) {
      resetDoubleEscapeToTree()
      return
    }
    if (isPlainEscape(event) && isPathCompletionOpen()) {
      resetDoubleEscapeToTree()
      return
    }
    if (isPlainEscape(event) && isSlashCommandQueryActive()) {
      resetDoubleEscapeToTree()
      return
    }
    if (event.key === "Escape" && state.runningSlashCommand === "compact") {
      resetDoubleEscapeToTree()
      event.preventDefault()
      void abortRunningSlashCommand()
      return
    }
    if (event.key === "Escape" && state.commandPaletteOpen) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeCommandPalette()
      return
    }
    if (event.key === "Escape" && state.directoryDialogOpen) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeDirectoryDialog()
      return
    }
    if (event.key === "Escape" && state.forkDialog) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeForkDialog()
      return
    }
    if (event.key === "Escape" && state.treeDialog) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      handleTreeDialogEscape()
      return
    }
    if (event.key === "Escape" && state.statusDialogOpen) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeStatusDialog()
      return
    }
    if (event.key === "Escape" && state.shortcutsDialogOpen) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeShortcutsDialog()
      return
    }
    if (event.key === "Escape" && state.settingsDialogOpen) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeSettingsDialog()
      return
    }
    if (event.key === "Escape" && state.confirmDialog) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeConfirmDialog()
      return
    }
    if (event.key === "Escape" && state.renameDialog) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeRenameDialog()
      return
    }
    if (event.key === "Escape" && state.headerSessionMenuOpen) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeHeaderSessionMenu()
      return
    }
    if (event.key === "Escape" && state.openSessionMenuPath) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeSessionMenu()
      return
    }
    if (event.key === "Escape" && state.openDirectoryMenuPath) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeDirectoryMenu()
      return
    }
    if (event.key === "Escape" && state.openComposerPopover) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeComposerPopovers()
      return
    }
    if (event.key === "Escape" && state.dialog) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      void dismissDialog({ cancelled: true })
      return
    }
    if (
      event.key === "Escape" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      isMobileViewport() &&
      isSidebarVisible() &&
      hasNoFocusedElement()
    ) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      closeSidebar({ focusPrompt: true })
      return
    }
    if (
      event.key === "Escape" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      state.streaming &&
      hasNoFocusedElement()
    ) {
      resetDoubleEscapeToTree()
      event.preventDefault()
      void abortStreamingResponse()
      return
    }
    if (maybeOpenTreeOnDoubleEscape(event)) {
      return
    }
    if (
      event.key === "Escape" &&
      isSidebarVisible() &&
      sidebarKeyboardTarget()
    ) {
      event.preventDefault()
      if (isMobileViewport()) {
        closeSidebar({ focusPrompt: true })
      } else {
        focusPromptField()
      }
    }
  }

  return {
    handleGlobalKeydown,
  }
}
