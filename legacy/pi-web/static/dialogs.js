import { INITIAL_DIRECTORY_SESSION_RENDER_COUNT, setMounted } from "./state.js"

const SHORTCUTS_DIALOG_SECTIONS = [
  {
    title: "Global",
    items: [
      {
        label: "Open keyboard shortcuts",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>/</kbd>",
      },
      {
        label: "Open command palette",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>P</kbd>",
      },
      {
        label: "Create a new session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>N</kbd>",
      },
      {
        label: "Search sessions",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>S</kbd>",
      },
      {
        label: "Rename the current session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>E</kbd>",
      },
      {
        label: "Fork the current session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>F</kbd>",
      },
      {
        label: "Compact the current session context",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>C</kbd>",
      },
      {
        label: "Delete the current session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>X</kbd>",
      },
      {
        label: "Add a directory",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>D</kbd>",
      },
      {
        label: "Open settings",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>,</kbd>",
      },
      {
        label: "Open the model picker",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>M</kbd>",
      },
      {
        label: "Toggle thinking blocks",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>T</kbd>",
      },
      {
        label: "Cycle reasoning level",
        keysHtml:
          '<kbd>Ctrl</kbd>+<kbd>R</kbd> <span class="shortcuts-dialog-keys-separator">/</span> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>',
      },
      {
        label: "Toggle tool calls",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>O</kbd>",
      },
      {
        label: "Open the session tree",
        description: "Press Escape twice when nothing else is open.",
        keysHtml:
          '<kbd>Esc</kbd><span class="shortcuts-dialog-keys-separator">,</span><kbd>Esc</kbd>',
      },
      {
        label: "Toggle the sidebar",
        keysHtml: "<kbd>Cmd</kbd>+<kbd>B</kbd>",
      },
    ],
  },
  {
    title: "Lists & pickers",
    description:
      "Works in the session list, command palette, model and reasoning pickers, Add Directory results, Fork, and the tree browser.",
    items: [
      {
        label: "Move selection",
        keysHtml:
          '<kbd>↑</kbd>/<kbd>↓</kbd> <span class="shortcuts-dialog-keys-separator">or</span> <kbd>Ctrl</kbd>+<kbd>J</kbd>/<kbd>K</kbd>',
      },
      {
        label: "Jump to the first or last result",
        keysHtml: "<kbd>←</kbd>/<kbd>→</kbd>",
      },
      {
        label: "Select multiple sidebar sessions",
        description: "Works in the sidebar session list with the mouse.",
        keysHtml:
          '<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+Click <span class="shortcuts-dialog-keys-separator">or</span> <kbd>Shift</kbd>+Click',
      },
      {
        label: "Delete selected sidebar sessions",
        description: "When sidebar session rows are selected or focused.",
        keysHtml:
          '<kbd>Backspace</kbd> <span class="shortcuts-dialog-keys-separator">/</span> <kbd>Delete</kbd>',
      },
      {
        label: "Run the first command palette result",
        keysHtml: "<kbd>Enter</kbd>",
      },
      {
        label: "Open the first Add Directory or Fork result",
        keysHtml: "<kbd>Enter</kbd>",
      },
    ],
  },
  {
    title: "Composer",
    items: [
      {
        label: "Send the current prompt",
        keysHtml:
          '<kbd>Cmd</kbd>+<kbd>Enter</kbd> <span class="shortcuts-dialog-keys-separator">/</span> <kbd>Ctrl</kbd>+<kbd>Enter</kbd>',
      },
      {
        label: "Insert a newline",
        keysHtml: "<kbd>Enter</kbd>",
      },
      {
        label: "Stop streaming",
        keysHtml: "<kbd>Esc</kbd>",
      },
      {
        label: "Steer the current response while streaming",
        keysHtml:
          '<kbd>Cmd</kbd>+<kbd>Enter</kbd> <span class="shortcuts-dialog-keys-separator">/</span> <kbd>Ctrl</kbd>+<kbd>Enter</kbd>',
      },
      {
        label: "Queue a follow-up while streaming",
        keysHtml:
          '<kbd>Alt</kbd>+<kbd>Cmd</kbd>+<kbd>Enter</kbd> <span class="shortcuts-dialog-keys-separator">/</span> <kbd>Alt</kbd>+<kbd>Ctrl</kbd>+<kbd>Enter</kbd>',
      },
      {
        label: "Move through slash, path, or @ suggestions",
        keysHtml:
          '<kbd>↑</kbd>/<kbd>↓</kbd> <span class="shortcuts-dialog-keys-separator">or</span> <kbd>Ctrl</kbd>+<kbd>J</kbd>/<kbd>K</kbd>',
      },
      {
        label:
          "Open or accept path or @ suggestions, or accept the highlighted slash-command suggestion",
        keysHtml: "<kbd>Tab</kbd>",
      },
      {
        label: "Accept the highlighted path or @ suggestion",
        keysHtml: "<kbd>Enter</kbd>",
      },
      {
        label: "Clear the selected skill when the prompt is empty",
        keysHtml: "<kbd>Backspace</kbd>",
      },
    ],
  },
  {
    title: "Tree dialog",
    description:
      "When the tree is open, Ctrl+/ opens tree-specific help instead of this dialog.",
    items: [
      {
        label: "Show tree shortcuts",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>/</kbd>",
      },
      {
        label: "Move",
        keysHtml:
          '<kbd>↑</kbd>/<kbd>↓</kbd> <span class="shortcuts-dialog-keys-separator">or</span> <kbd>Ctrl</kbd>+<kbd>J</kbd>/<kbd>K</kbd>',
      },
      {
        label: "Expand or collapse a branch",
        keysHtml:
          '<kbd>←</kbd>/<kbd>→</kbd> <span class="shortcuts-dialog-keys-separator">or</span> <kbd>Ctrl</kbd>+<kbd>H</kbd>/<kbd>L</kbd>',
      },
      {
        label: "Move by half a page",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>U</kbd>/<kbd>D</kbd>",
      },
      {
        label: "Move by a full page",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>B</kbd>/<kbd>F</kbd>",
      },
      {
        label: "Cycle filters",
        keysHtml:
          '<kbd>Ctrl</kbd>+<kbd>O</kbd> <span class="shortcuts-dialog-keys-separator">/</span> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>',
      },
      {
        label: "Jump to a filter preset",
        keysHtml:
          "<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>/<kbd>T</kbd>/<kbd>U</kbd>/<kbd>L</kbd>/<kbd>A</kbd>",
      },
      {
        label: "Label the selected entry",
        keysHtml: "<kbd>Shift</kbd>+<kbd>L</kbd>",
      },
      {
        label: "Toggle label timestamps",
        keysHtml: "<kbd>Shift</kbd>+<kbd>T</kbd>",
      },
      {
        label: "Continue from the selected entry",
        keysHtml: "<kbd>Enter</kbd>",
      },
      {
        label: "Clear search or close the current tree layer",
        keysHtml: "<kbd>Esc</kbd>",
      },
      {
        label: "Submit custom summary instructions",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>Enter</kbd>",
      },
    ],
  },
  {
    title: "General",
    items: [
      {
        label: "Close the active dialog, menu, or popover",
        keysHtml: "<kbd>Esc</kbd>",
      },
    ],
  },
]

export function createDialogsController({
  state,
  refs,
  overlayMounts,
  services,
}) {
  const {
    $addDirectoryBtn,
    $commandPaletteInput,
    $commandPaletteList,
    $commandPaletteOverlay,
    $confirmDialogCancelBtn,
    $confirmDialogCloseBtn,
    $confirmDialogConfirmBtn,
    $confirmDialogMessage,
    $confirmDialogOverlay,
    $confirmDialogTitle,
    $dialogActions,
    $dialogBody,
    $dialogCloseBtn,
    $dialogMessage,
    $dialogOverlay,
    $dialogTitle,
    $treeDialogActionPanel,
    $treeDialogActions,
    $treeDialogBrowsePanel,
    $treeDialogCloseBtn,
    $treeDialogCustomInput,
    $treeDialogCustomLabel,
    $treeDialogInput,
    $treeDialogLabelCancelBtn,
    $treeDialogLabelCloseBtn,
    $treeDialogLabelCopy,
    $treeDialogLabelInput,
    $treeDialogLabelOverlay,
    $treeDialogLabelSaveBtn,
    $treeDialogList,
    $treeDialogShortcutsCloseBtn,
    $treeDialogShortcutsOverlay,
    $treeDialogShortcutsTrigger,
    $treeDialogStatus,
    $treeDialogOverlay,
    $treeDialogSelectionCopy,
    $forkDialogCloseBtn,
    $forkDialogInput,
    $forkDialogList,
    $forkDialogOverlay,
    $openDirectoryInput,
    $openDirectoryList,
    $openDirectoryOverlay,
    $renameDialogCancelBtn,
    $renameDialogCloseBtn,
    $renameDialogInput,
    $renameDialogOverlay,
    $renameDialogSaveBtn,
    $settingsDialogCloseBtn,
    $settingsDialogOverlay,
    $settingsSessionDoneDesktopNotificationsInput,
    $settingsSessionDoneSoundInput,
    $settingsThemeOptions,
    $sidebarSettingsBtn,
    $statusDialogCloseBtn,
    $statusDialogList,
    $statusDialogOverlay,
    $shortcutsDialogCloseBtn,
    $shortcutsDialogList,
    $shortcutsDialogOverlay,
    $toastContainer,
  } = refs

  let confirmDialogResolve = null

  function renameDialogValue(dialog = state.renameDialog) {
    return typeof dialog?.value === "string" ? dialog.value.trim() : ""
  }

  function openRenameDialog(sessionPath, currentName) {
    if (!sessionPath) return

    closeConfirmDialog({ focusPrompt: false })
    closeCommandPalette({ focusPrompt: false })
    closeDirectoryDialog({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeHeaderSessionMenu?.()
    services.closeSessionMenu?.()
    services.closeDirectoryMenu?.()
    services.closeComposerPopovers?.()

    state.renameDialog = {
      sessionPath,
      currentName: typeof currentName === "string" ? currentName.trim() : "",
      value: typeof currentName === "string" ? currentName : "",
      saving: false,
    }
    renderRenameDialog()
    requestAnimationFrame(() => {
      $renameDialogInput?.focus()
      $renameDialogInput?.select()
    })
  }

  function closeRenameDialog({ focusPrompt = true, force = false } = {}) {
    if (!state.renameDialog) return
    if (state.renameDialog.saving && !force) return
    state.renameDialog = null
    renderRenameDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  async function submitRenameDialog() {
    const dialog = state.renameDialog
    if (!dialog || dialog.saving) return

    const nextName = renameDialogValue(dialog)
    if (!nextName || nextName === dialog.currentName) return

    state.renameDialog = { ...dialog, value: nextName, saving: true }
    renderRenameDialog()

    try {
      await services.post("/api/session/rename", {
        path: dialog.sessionPath,
        name: nextName,
      })
      closeRenameDialog({ force: true })
    } catch (error) {
      state.renameDialog = { ...dialog, value: nextName, saving: false }
      renderRenameDialog()
      requestAnimationFrame(() => {
        $renameDialogInput?.focus()
        $renameDialogInput?.select()
      })
      showToast(error.message, "error")
    }
  }

  function renderRenameDialog() {
    if (
      !$renameDialogOverlay ||
      !$renameDialogInput ||
      !$renameDialogCloseBtn ||
      !$renameDialogCancelBtn ||
      !$renameDialogSaveBtn
    )
      return

    const dialog = state.renameDialog
    setMounted(overlayMounts.rename, Boolean(dialog))
    if (!dialog) {
      $renameDialogInput.value = ""
      $renameDialogInput.disabled = false
      $renameDialogCloseBtn.disabled = false
      $renameDialogCancelBtn.disabled = false
      $renameDialogSaveBtn.disabled = false
      $renameDialogSaveBtn.textContent = "Save"
      return
    }

    if ($renameDialogInput.value !== dialog.value) {
      $renameDialogInput.value = dialog.value
    }

    const nextName = renameDialogValue(dialog)
    const canSave =
      Boolean(nextName) && nextName !== dialog.currentName && !dialog.saving
    $renameDialogInput.disabled = dialog.saving
    $renameDialogCloseBtn.disabled = dialog.saving
    $renameDialogCancelBtn.disabled = dialog.saving
    $renameDialogSaveBtn.disabled = !canSave
    $renameDialogSaveBtn.textContent = dialog.saving ? "Saving..." : "Save"
  }

  function openConfirmDialog({
    title = "Confirm",
    message = "",
    confirmLabel = "Confirm",
    confirmVariant = "primary",
  } = {}) {
    closeRenameDialog({ focusPrompt: false, force: true })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    closeShortcutsDialog({ focusPrompt: false })
    if (confirmDialogResolve) {
      confirmDialogResolve(false)
      confirmDialogResolve = null
    }

    state.confirmDialog = {
      title,
      message: typeof message === "string" ? message : "",
      confirmLabel: confirmLabel || "Confirm",
      confirmVariant: confirmVariant === "danger" ? "danger" : "primary",
    }
    renderConfirmDialog()

    return new Promise((resolve) => {
      confirmDialogResolve = resolve
      requestAnimationFrame(() => {
        const initialFocus =
          state.confirmDialog?.confirmVariant === "danger"
            ? $confirmDialogCancelBtn
            : $confirmDialogConfirmBtn
        ;(initialFocus || $confirmDialogCloseBtn)?.focus()
      })
    })
  }

  function closeConfirmDialog({ confirmed = false, focusPrompt = true } = {}) {
    if (!state.confirmDialog && !confirmDialogResolve) return

    const resolve = confirmDialogResolve
    confirmDialogResolve = null
    state.confirmDialog = null
    renderConfirmDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
    resolve?.(confirmed)
  }

  function renderConfirmDialog() {
    if (
      !$confirmDialogOverlay ||
      !$confirmDialogTitle ||
      !$confirmDialogMessage ||
      !$confirmDialogCloseBtn ||
      !$confirmDialogCancelBtn ||
      !$confirmDialogConfirmBtn
    )
      return

    const dialog = state.confirmDialog
    setMounted(overlayMounts.confirm, Boolean(dialog))
    if (!dialog) {
      $confirmDialogTitle.textContent = "Confirm"
      $confirmDialogMessage.textContent = ""
      $confirmDialogMessage.classList.add("hidden")
      $confirmDialogCloseBtn.disabled = false
      $confirmDialogCancelBtn.disabled = false
      $confirmDialogConfirmBtn.disabled = false
      $confirmDialogConfirmBtn.textContent = "Confirm"
      $confirmDialogConfirmBtn.className = "button primary"
      return
    }

    $confirmDialogTitle.textContent = dialog.title || "Confirm"
    $confirmDialogMessage.textContent = dialog.message || ""
    $confirmDialogMessage.classList.toggle("hidden", !dialog.message)
    $confirmDialogCloseBtn.disabled = false
    $confirmDialogCancelBtn.disabled = false
    $confirmDialogConfirmBtn.disabled = false
    $confirmDialogConfirmBtn.textContent = dialog.confirmLabel || "Confirm"
    $confirmDialogConfirmBtn.className = `button ${dialog.confirmVariant || "primary"}`
  }

  function openCommandPalette() {
    closeDirectoryDialog({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeSessionMenu?.({ render: false })
    services.closeDirectoryMenu?.({ render: false })
    state.commandPaletteOpen = true
    state.commandPaletteAutoFocusList = true
    renderCommandPalette()
    services.renderSessions?.()
  }

  function closeCommandPalette({ focusPrompt = true } = {}) {
    if (!state.commandPaletteOpen) return
    state.commandPaletteOpen = false
    state.commandPaletteAutoFocusList = false
    state.commandPaletteQuery = ""
    renderCommandPalette()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  function runCommandPaletteCommand(command) {
    closeCommandPalette({ focusPrompt: false })
    return Promise.resolve()
      .then(() => command.run())
      .catch((error) => {
        showToast(error?.message || "Failed to run command.", "error")
      })
      .finally(() => {
        if (command?.restorePromptFocus === false) {
          return
        }
        if (services.shouldRestorePromptFocus()) {
          services.focusPromptField()
        }
      })
  }

  function activeCommandPaletteSessionTarget() {
    if (!state.sessionFile) return null

    const currentName =
      state.sessionName === "Current session"
        ? ""
        : typeof state.sessionName === "string"
          ? state.sessionName.trim()
          : ""
    const firstMessage =
      typeof state.firstMessage === "string" ? state.firstMessage.trim() : ""
    const fallbackTitleRaw = currentName || firstMessage || "New session"

    return {
      sessionPath: state.sessionFile,
      sessionId: state.sessionId,
      currentName,
      fallbackTitle:
        fallbackTitleRaw.length > 60
          ? `${fallbackTitleRaw.slice(0, 57)}...`
          : fallbackTitleRaw,
    }
  }

  function commandPaletteCommands() {
    const statusCount = Object.keys(state.uiState.statuses || {}).length
    const activeSessionTarget = activeCommandPaletteSessionTarget()
    const commands = [
      {
        id: "new-session",
        title: "New session",
        description: "Create a new draft session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>N</kbd>",
        shortcutSearchText: "ctrl n create session",
        run: async () => {
          await services.createNewSessionInDirectory(
            services.defaultNewSessionDirectory()
          )
        },
      },
      {
        id: "search-sessions",
        title: "Search sessions",
        description: "Search and jump through sessions in the sidebar",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>S</kbd>",
        shortcutSearchText: "ctrl s session search switch sidebar",
        restorePromptFocus: false,
        run: () => {
          services.focusSessionSearch?.()
        },
      },
      {
        id: "set-model",
        title: "Set model",
        description: "Open the model picker",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>M</kbd>",
        shortcutSearchText: "ctrl m model picker choose model",
        run: () => {
          if (!services.openModelMenu?.()) {
            throw new Error("No models are available right now.")
          }
        },
      },
      {
        id: "add-directory",
        title: "Add Directory",
        description: "Add a directory accordion to the sidebar",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>D</kbd>",
        shortcutSearchText: "ctrl d",
        run: () => {
          openDirectoryDialog()
        },
      },
      {
        id: "tree-session",
        title: "Navigate tree",
        description: "Jump to an earlier point in the current session tree",
        keysHtml:
          '<kbd>Esc</kbd><span class="command-palette-item-shortcut-separator">,</span><kbd>Esc</kbd>',
        shortcutSearchText: "esc escape",
        run: async () => {
          await openTreeDialog()
        },
      },
      {
        id: "fork-session",
        title: "Fork session",
        description: "Create a new session from a previous user message",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>F</kbd>",
        shortcutSearchText: "ctrl f fork branch session",
        run: async () => {
          await openForkDialog()
        },
      },
      {
        id: "compact-session",
        title: "Compact",
        description: "Manually compact the session context",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>C</kbd>",
        shortcutSearchText: "ctrl c compact context compress session",
        run: async () => {
          await services.submitBuiltinSlashCommand({ name: "compact" }, "")
        },
      },
      {
        id: "toggle-thinking",
        title: services.thinkingVisibilityLabel(),
        description: state.hideThinkingBlock
          ? "Show assistant thinking blocks"
          : "Hide assistant thinking blocks",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>T</kbd>",
        shortcutSearchText: "ctrl t",
        run: async () => {
          await services.toggleThinkingVisibility()
        },
      },
      {
        id: "toggle-tools",
        title: services.toolVisibilityLabel(),
        description: state.hideToolBlocks
          ? "Show assistant tool calls"
          : "Hide assistant tool calls",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>O</kbd>",
        shortcutSearchText: "ctrl o",
        run: () => {
          services.toggleToolVisibility()
        },
      },
      {
        id: "open-settings",
        title: "Open settings",
        description: "Open app settings",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>,</kbd>",
        shortcutSearchText: "ctrl comma settings preferences",
        run: () => {
          openSettingsDialog()
        },
      },
      {
        id: "view-shortcuts",
        title: "View keyboard shortcuts",
        description: "Open the keyboard shortcuts dialog",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>/</kbd>",
        shortcutSearchText: "ctrl slash ctrl /",
        run: () => {
          openShortcutsDialog()
        },
      },
      {
        id: "view-status",
        title: "View status",
        description: statusCount
          ? `Open ${statusCount} active status ${statusCount === 1 ? "item" : "items"}`
          : "Open current status items",
        run: () => {
          openStatusDialog()
        },
      },
    ]

    if (activeSessionTarget) {
      commands.splice(1, 0, {
        id: "rename-session",
        title: "Rename session",
        description: "Rename the current session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>E</kbd>",
        shortcutSearchText: "ctrl e rename current session title name",
        run: () => {
          openRenameDialog(
            activeSessionTarget.sessionPath,
            activeSessionTarget.currentName
          )
        },
      })
      commands.push({
        id: "delete-session",
        title: "Delete session",
        description: "Delete the current session",
        keysHtml: "<kbd>Ctrl</kbd>+<kbd>X</kbd>",
        shortcutSearchText: "ctrl x delete remove current session",
        run: async () => {
          await services.deleteSessionByPath(
            activeSessionTarget.sessionPath,
            activeSessionTarget.sessionId,
            activeSessionTarget.fallbackTitle
          )
        },
      })
    }

    return commands
  }

  function renderCommandPalette() {
    if (
      !$commandPaletteOverlay ||
      !$commandPaletteList ||
      !$commandPaletteInput
    )
      return
    setMounted(overlayMounts.commandPalette, state.commandPaletteOpen)
    if (!state.commandPaletteOpen) {
      $commandPaletteInput.value = ""
      $commandPaletteList.innerHTML = ""
      return
    }

    if ($commandPaletteInput.value !== state.commandPaletteQuery) {
      $commandPaletteInput.value = state.commandPaletteQuery
    }

    const commands = commandPaletteCommands().filter((command) => {
      const query = state.commandPaletteQuery.trim().toLowerCase()
      if (!query) return true
      return `${command.title} ${command.description || ""} ${command.shortcutSearchText || ""}`
        .toLowerCase()
        .includes(query)
    })

    $commandPaletteList.innerHTML = ""
    if (!commands.length) {
      const empty = document.createElement("div")
      empty.className = "session-list-empty"
      empty.textContent = "No commands found."
      $commandPaletteList.appendChild(empty)
      services.syncCommandPaletteListFocus?.()
      return
    }

    for (const command of commands) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "command-palette-item"
      button.innerHTML = `
        <span class="command-palette-item-header">
          <span class="command-palette-item-title">${services.escapeHtml(command.title)}</span>
          ${command.keysHtml ? `<span class="command-palette-item-shortcut" aria-hidden="true">${command.keysHtml}</span>` : ""}
        </span>
        <span class="command-palette-item-description">${services.escapeHtml(command.description || "")}</span>
      `
      button.addEventListener("click", async (event) => {
        event.stopPropagation()
        await runCommandPaletteCommand(command)
      })
      $commandPaletteList.appendChild(button)
    }

    services.syncCommandPaletteListFocus?.()
  }

  function knownDirectoryPaths() {
    const paths = []
    const seen = new Set()
    const addPath = (value) => {
      const normalizedValue = typeof value === "string" ? value.trim() : ""
      if (!normalizedValue || seen.has(normalizedValue)) return
      seen.add(normalizedValue)
      paths.push(normalizedValue)
    }

    addPath(state.cwd)
    for (const session of state.sessions) {
      addPath(session.cwd)
    }
    for (const directoryPath of state.knownDirectories) {
      addPath(directoryPath)
    }
    for (const directoryPath of state.sidebarDirectories) {
      addPath(directoryPath)
    }

    return paths
  }

  function directoryMatchesQuery(directoryPath, query) {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return true
    const haystack =
      `${directoryPath} ${services.tildePath(directoryPath)} ${services.baseName(directoryPath)} ${services.dirNameOrPath(directoryPath)}`.toLowerCase()
    return haystack.includes(normalizedQuery)
  }

  function directoryDialogHasExactMatch(directoryPaths, normalizedQuery) {
    if (!normalizedQuery) return false
    return directoryPaths.some((directoryPath) => {
      const normalizedPath = directoryPath.trim().toLowerCase()
      return (
        normalizedPath === normalizedQuery ||
        services.tildePath(directoryPath).toLowerCase() === normalizedQuery
      )
    })
  }

  function directoryDialogViewModel() {
    const query = state.directoryDialogQuery.trim()
    const normalizedQuery = query.toLowerCase()
    const openedSet = new Set(state.sidebarDirectories)
    const recentDirectories = services.loadRecentDirectories()
    const recentSet = new Set(recentDirectories)
    const opened = query
      ? state.sidebarDirectories.filter((directoryPath) =>
          directoryMatchesQuery(directoryPath, query)
        )
      : []
    const current =
      state.cwd &&
      !openedSet.has(state.cwd) &&
      directoryMatchesQuery(state.cwd, query)
        ? [state.cwd]
        : []
    const recent = recentDirectories
      .filter((directoryPath) => !openedSet.has(directoryPath))
      .filter((directoryPath) => directoryMatchesQuery(directoryPath, query))
    const known = knownDirectoryPaths()
      .filter((directoryPath) => !openedSet.has(directoryPath))
      .filter((directoryPath) => directoryPath !== state.cwd)
      .filter((directoryPath) => !recentSet.has(directoryPath))
      .filter((directoryPath) => directoryMatchesQuery(directoryPath, query))
    const exactMatch = directoryDialogHasExactMatch(
      [
        ...state.sidebarDirectories,
        ...recentDirectories,
        ...knownDirectoryPaths(),
      ],
      normalizedQuery
    )

    return {
      query,
      opened,
      current,
      recent,
      known,
      manualPath: query && !exactMatch ? query : "",
    }
  }

  function finalizeDirectoryAdd(directoryPath) {
    const normalizedPath = services.addSidebarDirectory(directoryPath, {
      expand: true,
    })
    if (!normalizedPath) return

    services.rememberRecentDirectory(normalizedPath)
    void services.fetchDirectorySessions(normalizedPath, {
      offset: 0,
      limit:
        services.directorySessionLoadedCount(normalizedPath) ||
        INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
      append: false,
    })
    closeDirectoryDialog({ focusPrompt: false })
    services.renderSessions()

    if (services.isSidebarVisible()) {
      $addDirectoryBtn?.focus()
      return
    }
    services.focusPromptField()
  }

  async function openDirectoryPath(directoryPath) {
    const result = await services.post("/api/directory/resolve", {
      path: directoryPath,
    })
    finalizeDirectoryAdd(result.path)
  }

  function renderDirectoryDialog() {
    if (!$openDirectoryOverlay || !$openDirectoryList || !$openDirectoryInput)
      return
    setMounted(overlayMounts.directory, state.directoryDialogOpen)
    if (!state.directoryDialogOpen) {
      $openDirectoryInput.value = ""
      $openDirectoryList.innerHTML = ""
      return
    }

    if ($openDirectoryInput.value !== state.directoryDialogQuery) {
      $openDirectoryInput.value = state.directoryDialogQuery
    }

    const { query, opened, current, recent, known, manualPath } =
      directoryDialogViewModel()
    $openDirectoryList.innerHTML = ""

    if (manualPath) {
      const manualTitleParts = {
        label: `Add ${manualPath}`,
        prefix: "Add",
        path: manualPath,
      }
      $openDirectoryList.appendChild(
        createOpenDirectoryItem(
          `Add ${manualPath}`,
          "",
          () => openDirectoryPath(manualPath),
          {
            titleParts: manualTitleParts,
          }
        )
      )
    }

    if (opened.length) {
      $openDirectoryList.appendChild(
        renderDirectorySection("Already added", opened, {
          descriptionForPath: () => "Expand and show in the sidebar",
          onSelect: (directoryPath) => finalizeDirectoryAdd(directoryPath),
        })
      )
    }

    if (current.length) {
      $openDirectoryList.appendChild(
        renderDirectorySection("Current directory", current, {
          descriptionForPath: () => "Use the pi-web working directory",
        })
      )
    }

    if (recent.length) {
      $openDirectoryList.appendChild(
        renderDirectorySection("Recent directories", recent)
      )
    }

    if (known.length) {
      $openDirectoryList.appendChild(
        renderDirectorySection(
          query ? "Matching directories" : "Discovered directories",
          known
        )
      )
    }

    if (
      !manualPath &&
      !opened.length &&
      !current.length &&
      !recent.length &&
      !known.length
    ) {
      const empty = document.createElement("div")
      empty.className = "session-list-empty"
      empty.textContent = query
        ? "No directories found. Press Enter to add the typed path."
        : "No recent or discovered directories yet."
      $openDirectoryList.appendChild(empty)
      services.syncDirectoryDialogListFocus?.()
      return
    }

    services.syncDirectoryDialogListFocus?.()
  }

  function renderDirectorySection(
    title,
    directories,
    { descriptionForPath, onSelect } = {}
  ) {
    const section = document.createElement("section")
    section.className = "open-directory-section"

    const heading = document.createElement("h3")
    heading.className = "open-directory-section-title"
    heading.textContent = title
    section.appendChild(heading)

    for (const directoryPath of directories) {
      const displayPath = services.tildePath(directoryPath)
      section.appendChild(
        createOpenDirectoryItem(
          displayPath,
          descriptionForPath?.(directoryPath) || "",
          () => {
            const action = onSelect || openDirectoryPath
            return action(directoryPath)
          },
          {
            titleParts: { label: displayPath, prefix: "", path: displayPath },
          }
        )
      )
    }

    return section
  }

  function createOpenDirectoryItem(
    title,
    description,
    onClick,
    { titleParts } = {}
  ) {
    const showDescription = Boolean(description)
    const button = document.createElement("button")
    button.type = "button"
    button.className = `command-palette-item open-directory-item${showDescription ? "" : " compact"}`
    button.title = title
    button.innerHTML = `
      <svg class="open-directory-item-icon" viewBox="0 0 20 16" fill="none" aria-hidden="true">
        <path d="M1.75 3.5A1.75 1.75 0 0 1 3.5 1.75h3.12c.46 0 .9.18 1.22.5l1.16 1.16c.33.33.77.51 1.23.51h5.27a1.75 1.75 0 0 1 1.75 1.75v6.83a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V3.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <span class="open-directory-item-content">
        ${services.buildFadedPathLabelHtml(
          titleParts || { label: title, prefix: "", path: "" },
          {
            containerClass:
              "command-palette-item-title open-directory-item-title",
            prefixClass: "open-directory-item-title-prefix",
            pathClass: "open-directory-item-title-path",
            leadingClass: "open-directory-item-title-leading",
            tailClass: "open-directory-item-title-tail",
          }
        )}
        ${showDescription ? `<span class="command-palette-item-description">${services.escapeHtml(description)}</span>` : ""}
      </span>
    `
    button.addEventListener("click", async () => {
      try {
        await onClick()
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Failed to add directory.",
          "error"
        )
      }
    })
    return button
  }

  function openDirectoryDialog() {
    closeCommandPalette({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeSessionMenu?.({ render: false })
    services.closeDirectoryMenu?.({ render: false })
    state.directoryDialogOpen = true
    state.directoryDialogAutoFocusList = true
    services.renderSidebarDirectoryControls?.()
    services.renderSessions?.()
    renderDirectoryDialog()
  }

  function closeDirectoryDialog({ focusPrompt = true } = {}) {
    if (!state.directoryDialogOpen) return
    state.directoryDialogOpen = false
    state.directoryDialogAutoFocusList = false
    state.directoryDialogQuery = ""
    services.renderSidebarDirectoryControls?.()
    renderDirectoryDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  function openStatusDialog() {
    closeCommandPalette({ focusPrompt: false })
    closeDirectoryDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeSessionMenu?.({ render: false })
    services.closeDirectoryMenu?.({ render: false })
    state.statusDialogOpen = true
    services.renderSessions?.()
    renderStatusDialog()
    requestAnimationFrame(() => {
      $statusDialogCloseBtn?.focus()
    })
  }

  function closeStatusDialog({ focusPrompt = true } = {}) {
    if (!state.statusDialogOpen) return
    state.statusDialogOpen = false
    renderStatusDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  function openShortcutsDialog() {
    if (state.dialog) return

    closeCommandPalette({ focusPrompt: false })
    closeDirectoryDialog({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeHeaderSessionMenu?.()
    services.closeSessionMenu?.()
    services.closeDirectoryMenu?.()
    services.closeComposerPopovers?.()

    if (!state.shortcutsDialogOpen) {
      state.shortcutsDialogOpen = true
    }
    renderShortcutsDialog()
    requestAnimationFrame(() => {
      $shortcutsDialogCloseBtn?.focus()
    })
  }

  function closeShortcutsDialog({ focusPrompt = true } = {}) {
    if (!state.shortcutsDialogOpen) return
    state.shortcutsDialogOpen = false
    renderShortcutsDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  function openSettingsDialog() {
    closeCommandPalette({ focusPrompt: false })
    closeDirectoryDialog({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeHeaderSessionMenu?.()
    services.closeSessionMenu?.()
    services.closeDirectoryMenu?.()
    services.closeComposerPopovers?.()
    state.settingsDialogOpen = true
    renderSettingsDialog()
    requestAnimationFrame(() => {
      const selectedOption = $settingsThemeOptions.find(
        (button) => button.dataset.themeOption === state.theme
      )
      ;(selectedOption || $settingsDialogCloseBtn)?.focus()
    })
  }

  function closeSettingsDialog({ focusPrompt = true } = {}) {
    if (!state.settingsDialogOpen) return
    state.settingsDialogOpen = false
    renderSettingsDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  const TREE_DIALOG_FILTER_MODES = [
    "default",
    "no-tools",
    "user-only",
    "labeled-only",
    "all",
  ]

  function treeDialogFilterMode(dialog = state.treeDialog) {
    const mode = typeof dialog?.filterMode === "string" ? dialog.filterMode : ""
    return TREE_DIALOG_FILTER_MODES.includes(mode) ? mode : "no-tools"
  }

  function treeDialogNormalizeLine(value) {
    return typeof value === "string" ? value.replace(/[\n\t]/g, " ").trim() : ""
  }

  function treeDialogFlattenTree(roots, currentLeafId) {
    const safeRoots = Array.isArray(roots) ? roots : []
    const result = []
    const multipleRoots = safeRoots.length > 1
    const containsActive = new Map()
    const allNodes = []
    const preOrderStack = [...safeRoots]

    while (preOrderStack.length > 0) {
      const node = preOrderStack.pop()
      if (!node?.entry) continue
      allNodes.push(node)
      const children = Array.isArray(node.children) ? node.children : []
      for (let index = children.length - 1; index >= 0; index -= 1) {
        preOrderStack.push(children[index])
      }
    }

    for (let index = allNodes.length - 1; index >= 0; index -= 1) {
      const node = allNodes[index]
      let hasActive = currentLeafId !== null && node.entry?.id === currentLeafId
      for (const child of Array.isArray(node.children) ? node.children : []) {
        if (containsActive.get(child)) {
          hasActive = true
          break
        }
      }
      containsActive.set(node, hasActive)
    }

    const orderedRoots = [...safeRoots].sort(
      (a, b) =>
        Number(Boolean(containsActive.get(b))) -
        Number(Boolean(containsActive.get(a)))
    )
    const stack = []
    for (let index = orderedRoots.length - 1; index >= 0; index -= 1) {
      const isLast = index === orderedRoots.length - 1
      stack.push([
        orderedRoots[index],
        multipleRoots ? 1 : 0,
        multipleRoots,
        multipleRoots,
        isLast,
        [],
        multipleRoots,
      ])
    }

    while (stack.length > 0) {
      const [
        node,
        indent,
        justBranched,
        showConnector,
        isLast,
        gutters,
        isVirtualRootChild,
      ] = stack.pop()
      if (!node?.entry) continue

      result.push({
        node,
        indent,
        showConnector,
        isLast,
        gutters,
        isVirtualRootChild,
        multipleRoots,
      })

      const children = Array.isArray(node.children) ? node.children : []
      const multipleChildren = children.length > 1
      const prioritized = []
      const rest = []
      for (const child of children) {
        if (containsActive.get(child)) {
          prioritized.push(child)
        } else {
          rest.push(child)
        }
      }
      const orderedChildren = [...prioritized, ...rest]

      let childIndent
      if (multipleChildren) {
        childIndent = indent + 1
      } else if (justBranched && indent > 0) {
        childIndent = indent + 1
      } else {
        childIndent = indent
      }

      const connectorDisplayed = showConnector && !isVirtualRootChild
      const currentDisplayIndent = multipleRoots
        ? Math.max(0, indent - 1)
        : indent
      const connectorPosition = Math.max(0, currentDisplayIndent - 1)
      const childGutters = connectorDisplayed
        ? [...gutters, { position: connectorPosition, show: !isLast }]
        : gutters

      for (let index = orderedChildren.length - 1; index >= 0; index -= 1) {
        const childIsLast = index === orderedChildren.length - 1
        stack.push([
          orderedChildren[index],
          childIndent,
          multipleChildren,
          multipleChildren,
          childIsLast,
          childGutters,
          false,
        ])
      }
    }

    return result
  }

  function treeDialogActivePathIds(flatNodes, currentLeafId) {
    const activeIds = new Set()
    if (!currentLeafId) return activeIds

    const entryMap = new Map(
      flatNodes.map((flatNode) => [flatNode.node.entry.id, flatNode])
    )
    let currentId = currentLeafId
    while (currentId) {
      activeIds.add(currentId)
      const node = entryMap.get(currentId)
      if (!node) break
      currentId = node.node.entry.parentId ?? null
    }
    return activeIds
  }

  function treeDialogSearchableText(node) {
    const entry = node?.entry
    if (!entry) return ""

    const parts = []
    if (node?.label) {
      parts.push(node.label)
    }

    switch (entry.type) {
      case "message": {
        const message = entry.message || {}
        parts.push(message.role || "message")
        if (message.text) parts.push(message.text)
        if (Array.isArray(message.toolCalls)) {
          for (const toolCall of message.toolCalls) {
            if (toolCall?.preview) parts.push(toolCall.preview)
          }
        }
        if (message.command) parts.push(message.command)
        if (message.errorMessage) parts.push(message.errorMessage)
        break
      }
      case "custom_message":
        parts.push(entry.customType || "custom", entry.text || "")
        break
      case "compaction":
        parts.push("compaction")
        break
      case "branch_summary":
        parts.push("branch summary", entry.summary || "")
        break
      case "session_info":
        parts.push("title", entry.name || "")
        break
      case "model_change":
        parts.push("model", entry.modelId || "")
        break
      case "thinking_level_change":
        parts.push("thinking", entry.thinkingLevel || "")
        break
      case "custom":
        parts.push("custom", entry.customType || "")
        break
      case "label":
        parts.push("label", entry.label || "")
        break
      default:
        parts.push(entry.type || "entry")
        break
    }

    return parts.join(" ").toLowerCase()
  }

  function treeDialogRecalculateVisualStructure(filteredNodes, allFlatNodes) {
    if (!filteredNodes.length) {
      return {
        visibleParentMap: new Map(),
        visibleChildrenMap: new Map([[null, []]]),
        multipleRoots: false,
      }
    }

    const visibleIds = new Set(
      filteredNodes.map((flatNode) => flatNode.node.entry.id)
    )
    const entryMap = new Map(
      allFlatNodes.map((flatNode) => [flatNode.node.entry.id, flatNode])
    )
    const visibleParentMap = new Map()
    const visibleChildrenMap = new Map([[null, []]])

    const findVisibleAncestor = (nodeId) => {
      let currentId = entryMap.get(nodeId)?.node.entry.parentId ?? null
      while (currentId !== null) {
        if (visibleIds.has(currentId)) {
          return currentId
        }
        currentId = entryMap.get(currentId)?.node.entry.parentId ?? null
      }
      return null
    }

    for (const flatNode of filteredNodes) {
      const nodeId = flatNode.node.entry.id
      const ancestorId = findVisibleAncestor(nodeId)
      visibleParentMap.set(nodeId, ancestorId)
      if (!visibleChildrenMap.has(ancestorId)) {
        visibleChildrenMap.set(ancestorId, [])
      }
      visibleChildrenMap.get(ancestorId).push(nodeId)
    }

    const visibleRootIds = visibleChildrenMap.get(null) || []
    const multipleRoots = visibleRootIds.length > 1
    const filteredNodeMap = new Map(
      filteredNodes.map((flatNode) => [flatNode.node.entry.id, flatNode])
    )
    const stack = []

    for (let index = visibleRootIds.length - 1; index >= 0; index -= 1) {
      const isLast = index === visibleRootIds.length - 1
      stack.push([
        visibleRootIds[index],
        multipleRoots ? 1 : 0,
        multipleRoots,
        multipleRoots,
        isLast,
        [],
        multipleRoots,
      ])
    }

    while (stack.length > 0) {
      const [
        nodeId,
        indent,
        justBranched,
        showConnector,
        isLast,
        gutters,
        isVirtualRootChild,
      ] = stack.pop()
      const flatNode = filteredNodeMap.get(nodeId)
      if (!flatNode) continue

      flatNode.indent = indent
      flatNode.showConnector = showConnector
      flatNode.isLast = isLast
      flatNode.gutters = gutters
      flatNode.isVirtualRootChild = isVirtualRootChild
      flatNode.multipleRoots = multipleRoots

      const children = visibleChildrenMap.get(nodeId) || []
      const multipleChildren = children.length > 1

      let childIndent
      if (multipleChildren) {
        childIndent = indent + 1
      } else if (justBranched && indent > 0) {
        childIndent = indent + 1
      } else {
        childIndent = indent
      }

      const connectorDisplayed = showConnector && !isVirtualRootChild
      const currentDisplayIndent = multipleRoots
        ? Math.max(0, indent - 1)
        : indent
      const connectorPosition = Math.max(0, currentDisplayIndent - 1)
      const childGutters = connectorDisplayed
        ? [...gutters, { position: connectorPosition, show: !isLast }]
        : gutters

      for (let index = children.length - 1; index >= 0; index -= 1) {
        const childIsLast = index === children.length - 1
        stack.push([
          children[index],
          childIndent,
          multipleChildren,
          multipleChildren,
          childIsLast,
          childGutters,
          false,
        ])
      }
    }

    return {
      visibleParentMap,
      visibleChildrenMap,
      multipleRoots,
    }
  }

  function treeDialogFindNearestVisibleIndex(flatNodes, visibleNodes, entryId) {
    if (!visibleNodes.length) return -1

    const entryMap = new Map(
      flatNodes.map((flatNode) => [flatNode.node.entry.id, flatNode])
    )
    const visibleIdToIndex = new Map(
      visibleNodes.map((flatNode, index) => [flatNode.node.entry.id, index])
    )

    let currentId = entryId
    while (currentId !== null) {
      const index = visibleIdToIndex.get(currentId)
      if (index !== undefined) return index
      const node = entryMap.get(currentId)
      if (!node) break
      currentId = node.node.entry.parentId ?? null
    }

    return visibleNodes.length - 1
  }

  function treeDialogViewModel(dialog = state.treeDialog) {
    const tree = Array.isArray(dialog?.tree) ? dialog.tree : []
    const currentLeafId =
      typeof dialog?.currentLeafId === "string" && dialog.currentLeafId
        ? dialog.currentLeafId
        : null
    const flatNodes = treeDialogFlattenTree(tree, currentLeafId)
    const toolCallMap = new Map()
    for (const flatNode of flatNodes) {
      const entry = flatNode.node.entry
      if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        Array.isArray(entry.message.toolCalls)
      ) {
        for (const toolCall of entry.message.toolCalls) {
          if (toolCall?.id) {
            toolCallMap.set(toolCall.id, toolCall)
          }
        }
      }
    }
    const activePathIds = treeDialogActivePathIds(flatNodes, currentLeafId)
    const searchTokens =
      typeof dialog?.query === "string"
        ? dialog.query.toLowerCase().split(/\s+/).filter(Boolean)
        : []
    const filterMode = treeDialogFilterMode(dialog)
    const foldedEntryIds = new Set(
      Array.isArray(dialog?.foldedEntryIds) ? dialog.foldedEntryIds : []
    )
    const visibleNodes = flatNodes.filter((flatNode) => {
      const entry = flatNode.node.entry
      const message = entry.message || {}
      const isCurrentLeaf = entry.id === currentLeafId

      if (
        !isCurrentLeaf &&
        entry.type === "message" &&
        message.role === "assistant"
      ) {
        const hasText = Boolean(treeDialogNormalizeLine(message.text))
        const stopReason =
          typeof message.stopReason === "string" ? message.stopReason : ""
        const isErrorOrAborted =
          Boolean(stopReason) &&
          stopReason !== "stop" &&
          stopReason !== "toolUse"
        if (!hasText && !isErrorOrAborted) {
          return false
        }
      }

      const isSettingsEntry =
        entry.type === "label" ||
        entry.type === "custom" ||
        entry.type === "model_change" ||
        entry.type === "thinking_level_change" ||
        entry.type === "session_info"

      let passesFilter = true
      switch (filterMode) {
        case "user-only":
          passesFilter = entry.type === "message" && message.role === "user"
          break
        case "no-tools":
          passesFilter =
            !isSettingsEntry &&
            !(entry.type === "message" && message.role === "toolResult")
          break
        case "labeled-only":
          passesFilter = flatNode.node.label !== undefined
          break
        case "all":
          passesFilter = true
          break
        default:
          passesFilter = !isSettingsEntry
          break
      }
      if (!passesFilter) return false

      if (searchTokens.length > 0) {
        const searchableText = treeDialogSearchableText(flatNode.node)
        if (!searchTokens.every((token) => searchableText.includes(token))) {
          return false
        }
      }

      return true
    })

    if (foldedEntryIds.size > 0) {
      const skipSet = new Set()
      for (const flatNode of flatNodes) {
        const nodeId = flatNode.node.entry.id
        const parentId = flatNode.node.entry.parentId ?? null
        if (
          parentId !== null &&
          (foldedEntryIds.has(parentId) || skipSet.has(parentId))
        ) {
          skipSet.add(nodeId)
        }
      }
      for (let index = visibleNodes.length - 1; index >= 0; index -= 1) {
        if (skipSet.has(visibleNodes[index].node.entry.id)) {
          visibleNodes.splice(index, 1)
        }
      }
    }

    const { visibleParentMap, visibleChildrenMap, multipleRoots } =
      treeDialogRecalculateVisualStructure(visibleNodes, flatNodes)
    const flatNodeById = new Map(
      flatNodes.map((flatNode) => [flatNode.node.entry.id, flatNode])
    )
    const visibleFlatNodeById = new Map(
      visibleNodes.map((flatNode) => [flatNode.node.entry.id, flatNode])
    )

    const searching = searchTokens.length > 0
    let selectedIndex = -1
    let selectedFlatNode
    for (const preferredId of [dialog?.focusedEntryId, currentLeafId]) {
      if (!preferredId) continue
      const index = searching
        ? visibleNodes.findIndex(
            (flatNode) => flatNode.node.entry.id === preferredId
          )
        : treeDialogFindNearestVisibleIndex(
            flatNodes,
            visibleNodes,
            preferredId
          )
      if (index >= 0 && visibleNodes[index]) {
        selectedIndex = index
        selectedFlatNode = visibleNodes[index]
        break
      }
    }
    if (!selectedFlatNode) {
      selectedIndex = visibleNodes.length > 0 ? 0 : -1
      selectedFlatNode = visibleNodes[0]
    }

    return {
      filterMode,
      currentLeafId,
      flatNodes,
      flatNodeById,
      visibleNodes,
      visibleFlatNodeById,
      visibleParentMap,
      visibleChildrenMap,
      activePathIds,
      multipleRoots,
      selectedIndex,
      selectedFlatNode,
      toolCallMap,
      showLabelTimestamps: Boolean(dialog?.showLabelTimestamps),
    }
  }

  function treeDialogEntries(dialog = state.treeDialog) {
    return treeDialogViewModel(dialog).visibleNodes.map(
      (flatNode) => flatNode.node
    )
  }

  function treeDialogTarget(dialog = state.treeDialog) {
    const targetEntryId =
      typeof dialog?.targetEntryId === "string" ? dialog.targetEntryId : ""
    if (!targetEntryId) return undefined
    return treeDialogViewModel(dialog).flatNodeById.get(targetEntryId)?.node
  }

  function treeDialogLabelTarget(dialog = state.treeDialog) {
    const targetEntryId =
      typeof dialog?.labelEntryId === "string" ? dialog.labelEntryId : ""
    if (!targetEntryId) return undefined
    return treeDialogViewModel(dialog).flatNodeById.get(targetEntryId)?.node
  }

  function treeDialogActivePath(dialog = state.treeDialog) {
    return treeDialogViewModel(dialog).activePathIds
  }

  function treeDialogBrowsableEntry(dialog = state.treeDialog) {
    return treeDialogViewModel(dialog).selectedFlatNode?.node
  }

  function treeDialogNavElements() {
    if (!$treeDialogList) return []
    return Array.from($treeDialogList.querySelectorAll(".tree-dialog-nav-item"))
  }

  function treeDialogNavByEntryId(entryId) {
    const targetEntryId = typeof entryId === "string" ? entryId : ""
    if (!targetEntryId || !$treeDialogList) return null
    return $treeDialogList.querySelector(
      `.tree-dialog-nav-item[data-entry-id="${CSS.escape(targetEntryId)}"]`
    )
  }

  function syncTreeDialogBrowseSelection(dialog = state.treeDialog) {
    const selectedEntryId = treeDialogBrowsableEntry(dialog)?.entry?.id
    for (const element of treeDialogNavElements()) {
      element.classList.toggle(
        "is-selected",
        Boolean(selectedEntryId) && element.dataset.entryId === selectedEntryId
      )
    }
    renderTreeDialogBrowseStatus(dialog)
  }

  function renderTreeDialogBrowseActions(dialog = state.treeDialog) {
    if (!$treeDialogActions) return
    $treeDialogActions.innerHTML = ""

    const cancelButton = dialogButton("Cancel", "secondary", () =>
      closeTreeDialog()
    )
    cancelButton.disabled = Boolean(dialog?.submitting)
    $treeDialogActions.appendChild(cancelButton)

    const selectedEntry = treeDialogBrowsableEntry(dialog)
    const selectedEntryId = selectedEntry?.entry?.id
    const continueButton = dialogButton("Continue", "primary", () => {
      if (selectedEntryId) {
        beginTreeDialogSelection(selectedEntryId)
      }
    })
    continueButton.disabled = Boolean(
      dialog?.loading ||
      dialog?.submitting ||
      !selectedEntryId ||
      selectedEntryId === dialog?.currentLeafId
    )
    $treeDialogActions.appendChild(continueButton)
  }

  function treeDialogKindLabel(value) {
    const entry = value?.entry || value
    if (!entry || typeof entry !== "object") return "Entry"

    if (entry.type === "message") {
      switch (entry.message?.role) {
        case "user":
          return "User"
        case "assistant":
          return "Assistant"
        case "toolResult":
          return "Tool"
        case "bashExecution":
          return "Shell"
        default:
          return entry.message?.role || "Message"
      }
    }

    switch (entry.type) {
      case "compaction":
        return "Compaction"
      case "branch_summary":
        return "Summary"
      case "custom_message":
        return "Custom"
      case "model_change":
        return "Model"
      case "thinking_level_change":
        return "Thinking"
      case "session_info":
        return "Title"
      case "label":
        return "Label"
      case "custom":
        return "Custom"
      default:
        return entry.type || "Entry"
    }
  }

  function normalizeTreeDialogNode(node) {
    if (!node || typeof node !== "object") return null

    const entry = node.entry && typeof node.entry === "object" ? node.entry : {}
    const entryId = typeof entry.id === "string" ? entry.id : ""
    if (!entryId) return null

    const message =
      entry.message && typeof entry.message === "object"
        ? entry.message
        : undefined
    const children = Array.isArray(node.children)
      ? node.children
          .map((child) => normalizeTreeDialogNode(child))
          .filter(Boolean)
      : []

    return {
      entry: {
        id: entryId,
        parentId: typeof entry.parentId === "string" ? entry.parentId : null,
        timestamp:
          typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        type: typeof entry.type === "string" ? entry.type : "entry",
        message: message
          ? {
              role: typeof message.role === "string" ? message.role : "message",
              text: typeof message.text === "string" ? message.text : "",
              toolCalls: Array.isArray(message.toolCalls)
                ? message.toolCalls
                    .map((toolCall) => ({
                      id: typeof toolCall?.id === "string" ? toolCall.id : "",
                      name:
                        typeof toolCall?.name === "string"
                          ? toolCall.name
                          : "tool",
                      preview:
                        typeof toolCall?.preview === "string"
                          ? toolCall.preview
                          : "",
                    }))
                    .filter((toolCall) => toolCall.id || toolCall.preview)
                : [],
              stopReason:
                typeof message.stopReason === "string"
                  ? message.stopReason
                  : undefined,
              errorMessage:
                typeof message.errorMessage === "string"
                  ? message.errorMessage
                  : "",
              toolCallId:
                typeof message.toolCallId === "string"
                  ? message.toolCallId
                  : undefined,
              toolName:
                typeof message.toolName === "string"
                  ? message.toolName
                  : undefined,
              command:
                typeof message.command === "string" ? message.command : "",
            }
          : undefined,
        customType:
          typeof entry.customType === "string" ? entry.customType : undefined,
        text: typeof entry.text === "string" ? entry.text : "",
        summary: typeof entry.summary === "string" ? entry.summary : "",
        tokensBefore: Number.isFinite(Number(entry.tokensBefore))
          ? Number(entry.tokensBefore)
          : 0,
        modelId: typeof entry.modelId === "string" ? entry.modelId : "",
        thinkingLevel:
          typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : "",
        label: typeof entry.label === "string" ? entry.label : undefined,
        name: typeof entry.name === "string" ? entry.name : "",
      },
      label:
        typeof node.label === "string" && node.label.trim()
          ? node.label.trim()
          : undefined,
      labelTimestamp:
        typeof node.labelTimestamp === "string" && node.labelTimestamp
          ? node.labelTimestamp
          : undefined,
      children,
    }
  }

  function updateTreeDialogFocusedEntry(entryId) {
    const targetEntryId = typeof entryId === "string" ? entryId.trim() : ""
    if (
      !state.treeDialog ||
      !targetEntryId ||
      state.treeDialog.focusedEntryId === targetEntryId
    )
      return
    state.treeDialog = {
      ...state.treeDialog,
      focusedEntryId: targetEntryId,
    }
    syncTreeDialogBrowseSelection(state.treeDialog)
    renderTreeDialogBrowseActions(state.treeDialog)
  }

  function focusTreeDialogBrowseSelection({
    fallbackToInput = true,
    selectInput = false,
  } = {}) {
    requestAnimationFrame(() => {
      if (
        state.treeDialog?.stage !== "browse" ||
        state.treeDialog?.showShortcutsHelp ||
        state.treeDialog?.showLabelEditor
      )
        return

      const selectedEntryId = treeDialogBrowsableEntry(state.treeDialog)?.entry
        ?.id
      const focusTarget = selectedEntryId
        ? treeDialogNavByEntryId(selectedEntryId)
        : null
      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus()
        focusTarget.scrollIntoView?.({ block: "nearest" })
        return
      }

      if (!fallbackToInput || !($treeDialogInput instanceof HTMLInputElement))
        return
      $treeDialogInput.focus()
      if (selectInput) {
        $treeDialogInput.select()
        return
      }
      const end = $treeDialogInput.value.length
      try {
        $treeDialogInput.setSelectionRange(end, end)
      } catch {
        // ignore unsupported selection operations
      }
    })
  }

  function openTreeDialogShortcutsHelp() {
    if (
      !state.treeDialog ||
      state.treeDialog.stage !== "browse" ||
      state.treeDialog.showShortcutsHelp
    )
      return false
    state.treeDialog = {
      ...state.treeDialog,
      showShortcutsHelp: true,
      showLabelEditor: false,
      labelSubmitting: false,
      labelEntryId: undefined,
      labelDraft: "",
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      $treeDialogShortcutsCloseBtn?.focus()
    })
    return true
  }

  function closeTreeDialogShortcutsHelp({ restoreFocus = true } = {}) {
    if (!state.treeDialog?.showShortcutsHelp) return false
    state.treeDialog = {
      ...state.treeDialog,
      showShortcutsHelp: false,
    }
    renderTreeDialog()
    if (restoreFocus) {
      focusTreeDialogBrowseSelection({ fallbackToInput: true })
    }
    return true
  }

  function toggleTreeDialogShortcutsHelp() {
    if (state.treeDialog?.showShortcutsHelp) {
      return closeTreeDialogShortcutsHelp()
    }
    return openTreeDialogShortcutsHelp()
  }

  function openTreeDialogLabelEditor() {
    const dialog = state.treeDialog
    if (
      !dialog ||
      dialog.stage !== "browse" ||
      dialog.loading ||
      dialog.submitting ||
      dialog.showLabelEditor
    )
      return false
    const target = treeDialogBrowsableEntry(dialog)
    const entryId = target?.entry?.id
    if (!entryId) return false

    state.treeDialog = {
      ...dialog,
      showShortcutsHelp: false,
      showLabelEditor: true,
      labelSubmitting: false,
      labelEntryId: entryId,
      labelDraft: target.label || "",
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      $treeDialogLabelInput?.focus()
      $treeDialogLabelInput?.select()
    })
    return true
  }

  function closeTreeDialogLabelEditor({ restoreFocus = true } = {}) {
    if (!state.treeDialog?.showLabelEditor) return false
    state.treeDialog = {
      ...state.treeDialog,
      showLabelEditor: false,
      labelSubmitting: false,
      labelEntryId: undefined,
      labelDraft: "",
    }
    renderTreeDialog()
    if (restoreFocus) {
      focusTreeDialogBrowseSelection({ fallbackToInput: true })
    }
    return true
  }

  async function submitTreeDialogLabel() {
    const dialog = state.treeDialog
    const entryId =
      typeof dialog?.labelEntryId === "string" ? dialog.labelEntryId.trim() : ""
    if (
      !dialog ||
      !dialog.showLabelEditor ||
      dialog.labelSubmitting ||
      !entryId
    )
      return

    const nextLabel =
      typeof dialog.labelDraft === "string" ? dialog.labelDraft.trim() : ""
    state.treeDialog = {
      ...dialog,
      labelSubmitting: true,
      labelDraft: nextLabel,
    }
    renderTreeDialog()

    try {
      const result = await services.post("/api/session/tree/label", {
        entryId,
        label: nextLabel,
      })
      if (!state.treeDialog) return

      const tree = Array.isArray(result?.tree)
        ? result.tree
            .map((node) => normalizeTreeDialogNode(node))
            .filter(Boolean)
        : state.treeDialog.tree
      const currentLeafId =
        typeof result?.leafId === "string" && result.leafId
          ? result.leafId
          : state.treeDialog.currentLeafId

      state.treeDialog = {
        ...state.treeDialog,
        tree,
        currentLeafId,
        focusedEntryId: entryId,
        showLabelEditor: false,
        labelSubmitting: false,
        labelEntryId: undefined,
        labelDraft: "",
      }
      renderTreeDialog()
      focusTreeDialogBrowseSelection({ fallbackToInput: true })
    } catch (error) {
      if (!state.treeDialog) return
      state.treeDialog = {
        ...state.treeDialog,
        labelSubmitting: false,
      }
      renderTreeDialog()
      showToast(error?.message || "Failed to update label.", "error")
    }
  }

  async function openTreeDialog() {
    closeConfirmDialog({ focusPrompt: false })
    closeRenameDialog({ focusPrompt: false, force: true })
    closeCommandPalette({ focusPrompt: false })
    closeDirectoryDialog({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeForkDialog({ focusPrompt: false, force: true })
    services.closeHeaderSessionMenu?.()
    services.closeSessionMenu?.()
    services.closeDirectoryMenu?.()
    services.closeComposerPopovers?.()

    state.treeDialog = {
      stage: "browse",
      query: "",
      tree: [],
      loading: true,
      submitting: false,
      currentLeafId: null,
      focusedEntryId: undefined,
      foldedEntryIds: [],
      filterMode: "no-tools",
      showLabelTimestamps: false,
      targetEntryId: undefined,
      customInstructions: "",
      showShortcutsHelp: false,
      showLabelEditor: false,
      labelSubmitting: false,
      labelEntryId: undefined,
      labelDraft: "",
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      $treeDialogCloseBtn?.focus()
    })

    try {
      const result = await services.get("/api/session/tree")
      const tree = Array.isArray(result?.tree)
        ? result.tree
            .map((node) => normalizeTreeDialogNode(node))
            .filter(Boolean)
        : []

      if (!state.treeDialog) return
      if (!tree.length) {
        closeTreeDialog({ force: true })
        throw new Error("No session tree entries are available.")
      }

      const currentLeafId =
        typeof result?.leafId === "string" && result.leafId
          ? result.leafId
          : null
      const initialViewModel = treeDialogViewModel({
        ...state.treeDialog,
        tree,
        currentLeafId,
      })

      state.treeDialog = {
        ...state.treeDialog,
        loading: false,
        tree,
        currentLeafId,
        focusedEntryId:
          currentLeafId || initialViewModel.visibleNodes[0]?.node.entry.id,
        foldedEntryIds: [],
      }
      renderTreeDialog()
      focusTreeDialogBrowseSelection({ fallbackToInput: true })
    } catch (error) {
      if (!state.treeDialog) {
        return
      }
      if (state.treeDialog.loading) {
        closeTreeDialog({ force: true })
      }
      throw error
    }
  }

  function closeTreeDialog({ focusPrompt = true, force = false } = {}) {
    if (!state.treeDialog) return
    if (
      (state.treeDialog.submitting || state.treeDialog.labelSubmitting) &&
      !force
    )
      return
    state.treeDialog = null
    renderTreeDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  function handleTreeDialogEscape() {
    const dialog = state.treeDialog
    if (!dialog) return
    if (dialog.submitting || dialog.labelSubmitting) return

    if (dialog.showShortcutsHelp) {
      closeTreeDialogShortcutsHelp()
      return
    }

    if (dialog.showLabelEditor) {
      closeTreeDialogLabelEditor()
      return
    }

    if (dialog.stage === "custom") {
      state.treeDialog = { ...dialog, stage: "confirm" }
      renderTreeDialog()
      requestAnimationFrame(() => {
        $treeDialogActions?.querySelector(".button.primary, button")?.focus()
      })
      return
    }

    if (dialog.stage === "confirm") {
      state.treeDialog = {
        ...dialog,
        stage: "browse",
        focusedEntryId: dialog.targetEntryId || dialog.focusedEntryId,
      }
      renderTreeDialog()
      requestAnimationFrame(() => {
        const focusTarget = treeDialogNavByEntryId(
          dialog.targetEntryId || dialog.focusedEntryId
        )
        if (focusTarget instanceof HTMLElement) {
          focusTarget.focus()
          return
        }
        $treeDialogInput?.focus()
        $treeDialogInput?.select()
      })
      return
    }

    closeTreeDialog()
  }

  function beginTreeDialogSelection(entryId) {
    const dialog = state.treeDialog
    const targetEntryId = typeof entryId === "string" ? entryId.trim() : ""
    if (!dialog || dialog.loading || dialog.submitting || !targetEntryId) return
    if (targetEntryId === dialog.currentLeafId) {
      showToast("Already at this point.", "info")
      return
    }

    state.treeDialog = {
      ...dialog,
      stage: "confirm",
      focusedEntryId: targetEntryId,
      targetEntryId,
      showShortcutsHelp: false,
      showLabelEditor: false,
      labelSubmitting: false,
      labelEntryId: undefined,
      labelDraft: "",
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      $treeDialogActions?.querySelector(".button.primary, button")?.focus()
    })
  }

  function openTreeCustomSummary() {
    const dialog = state.treeDialog
    if (
      !dialog ||
      dialog.loading ||
      dialog.submitting ||
      !dialog.targetEntryId ||
      !state.model
    )
      return

    state.treeDialog = {
      ...dialog,
      stage: "custom",
      showShortcutsHelp: false,
      showLabelEditor: false,
      labelSubmitting: false,
      labelEntryId: undefined,
      labelDraft: "",
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      $treeDialogCustomInput?.focus()
      $treeDialogCustomInput?.select()
    })
  }

  async function submitTreeDialog(
    targetId,
    { summarize = false, customInstructions } = {}
  ) {
    const dialog = state.treeDialog
    const targetEntryId = typeof targetId === "string" ? targetId.trim() : ""
    if (!dialog || dialog.loading || dialog.submitting || !targetEntryId) return

    state.treeDialog = {
      ...dialog,
      submitting: true,
      customInstructions:
        typeof customInstructions === "string"
          ? customInstructions
          : dialog.customInstructions,
    }
    renderTreeDialog()

    try {
      const result = await services.post("/api/session/tree", {
        targetId: targetEntryId,
        summarize,
        customInstructions:
          typeof customInstructions === "string"
            ? customInstructions
            : undefined,
      })

      if (result?.aborted) {
        if (!state.treeDialog) return
        state.treeDialog = {
          ...state.treeDialog,
          submitting: false,
          stage: "confirm",
        }
        renderTreeDialog()
        showToast("Branch summarization cancelled.", "info")
        return
      }

      if (result?.cancelled) {
        if (!state.treeDialog) return
        state.treeDialog = {
          ...state.treeDialog,
          submitting: false,
          stage: "confirm",
        }
        renderTreeDialog()
        showToast("Navigation cancelled.", "info")
        return
      }

      closeTreeDialog({ force: true })
    } catch (error) {
      if (!state.treeDialog) return
      state.treeDialog = {
        ...state.treeDialog,
        submitting: false,
      }
      renderTreeDialog()
      showToast(
        error?.message || "Failed to navigate the session tree.",
        "error"
      )
    }
  }

  function treeDialogFormatLabelTimestamp(timestamp) {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return ""

    const now = new Date()
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const time = `${hours}:${minutes}`
    if (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    ) {
      return time
    }

    const month = date.getMonth() + 1
    const day = date.getDate()
    if (date.getFullYear() === now.getFullYear()) {
      return `${month}/${day} ${time}`
    }

    const year = date.getFullYear().toString().slice(-2)
    return `${year}/${month}/${day} ${time}`
  }

  function treeDialogStatusLabels(viewModel) {
    let labels = ""
    switch (viewModel.filterMode) {
      case "no-tools":
        labels += " [no-tools]"
        break
      case "user-only":
        labels += " [user]"
        break
      case "labeled-only":
        labels += " [labeled]"
        break
      case "all":
        labels += " [all]"
        break
      default:
        break
    }
    if (viewModel.showLabelTimestamps) {
      labels += " [+label time]"
    }
    return labels
  }

  function renderTreeDialogBrowseStatus(dialog = state.treeDialog) {
    if (!$treeDialogStatus) return
    if (!dialog || dialog.stage !== "browse" || dialog.loading) {
      $treeDialogStatus.textContent = ""
      $treeDialogStatus.classList.add("hidden")
      return
    }

    const viewModel = treeDialogViewModel(dialog)
    if (!viewModel.visibleNodes.length) {
      $treeDialogStatus.textContent = ""
      $treeDialogStatus.classList.add("hidden")
      return
    }

    $treeDialogStatus.textContent = `(${viewModel.selectedIndex >= 0 ? viewModel.selectedIndex + 1 : 0}/${viewModel.visibleNodes.length})${treeDialogStatusLabels(viewModel)}`
    $treeDialogStatus.classList.remove("hidden")
  }

  function treeDialogIsFoldable(viewModel, entryId) {
    const children = viewModel.visibleChildrenMap.get(entryId)
    if (!children || children.length === 0) return false
    const parentId = viewModel.visibleParentMap.get(entryId)
    if (parentId === null || parentId === undefined) return true
    const siblings = viewModel.visibleChildrenMap.get(parentId)
    return Array.isArray(siblings) && siblings.length > 1
  }

  function treeDialogFindBranchSegmentStart(
    viewModel,
    selectedEntryId,
    direction
  ) {
    if (!selectedEntryId) return selectedEntryId
    const indexByEntryId = new Map(
      viewModel.visibleNodes.map((flatNode, index) => [
        flatNode.node.entry.id,
        index,
      ])
    )
    let currentId = selectedEntryId

    if (direction === "down") {
      while (true) {
        const children = viewModel.visibleChildrenMap.get(currentId) || []
        if (children.length === 0) {
          return currentId
        }
        if (children.length > 1) {
          return children[0]
        }
        currentId = children[0]
      }
    }

    while (true) {
      const parentId = viewModel.visibleParentMap.get(currentId) ?? null
      if (parentId === null) {
        return currentId
      }
      const children = viewModel.visibleChildrenMap.get(parentId) || []
      if (children.length > 1) {
        const currentIndex = indexByEntryId.get(currentId)
        const selectedIndex = indexByEntryId.get(selectedEntryId)
        if (
          typeof currentIndex === "number" &&
          typeof selectedIndex === "number" &&
          currentIndex < selectedIndex
        ) {
          return currentId
        }
      }
      currentId = parentId
    }
  }

  function treeDialogIconSvg(name) {
    const wrap = (body, viewBox = "0 0 10 24") =>
      `<svg viewBox="${viewBox}" fill="none" aria-hidden="true">${body}</svg>`

    switch (name) {
      case "gutter":
        return wrap(
          '<path d="M5 0V24" stroke="currentColor" stroke-width="1"/>'
        )
      case "connector-tee":
        return wrap(
          '<path d="M5 0V24M5 12H10" stroke="currentColor" stroke-width="1"/>'
        )
      case "connector-elbow":
        return wrap(
          '<path d="M5 0V12M5 12H10" stroke="currentColor" stroke-width="1"/>'
        )
      case "leaf-line":
        return wrap(
          '<path d="M0 12H10" stroke="currentColor" stroke-width="1"/>'
        )
      case "fold-open":
        return wrap(
          '<rect x="0.5" y="7.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1"/><path d="M2.5 12H7.5" stroke="currentColor" stroke-width="1"/>'
        )
      case "fold-closed":
        return wrap(
          '<rect x="0.5" y="7.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1"/><path d="M2.5 12H7.5M5 9.5V14.5" stroke="currentColor" stroke-width="1"/>'
        )
      case "root-folded":
        return wrap(
          '<rect x="0.5" y="7.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1"/><path d="M2.5 12H7.5M5 9.5V14.5" stroke="currentColor" stroke-width="1"/>'
        )
      case "active-path":
        return wrap('<circle cx="5" cy="12" r="2.25" fill="currentColor"/>')
      default:
        return ""
    }
  }

  function treeDialogBuildPrefixHtml(flatNode, viewModel, isFolded) {
    const displayIndent = flatNode.multipleRoots
      ? Math.max(0, flatNode.indent - 1)
      : flatNode.indent
    const connector = flatNode.showConnector && !flatNode.isVirtualRootChild
    const connectorPosition = connector ? displayIndent - 1 : -1
    const foldable = treeDialogIsFoldable(viewModel, flatNode.node.entry.id)
    const totalCells = displayIndent * 3
    const cells = []

    for (let index = 0; index < totalCells; index += 1) {
      const level = Math.floor(index / 3)
      const positionInLevel = index % 3
      const gutter = flatNode.gutters.find(
        (candidate) => candidate.position === level
      )
      if (gutter) {
        if (positionInLevel === 0 && gutter.show) {
          cells.push(
            `<span class="tree-dialog-prefix-cell is-gutter">${treeDialogIconSvg("gutter")}</span>`
          )
        } else {
          cells.push('<span class="tree-dialog-prefix-cell is-empty"></span>')
        }
        continue
      }

      if (connector && level === connectorPosition) {
        if (positionInLevel === 0) {
          cells.push(
            `<span class="tree-dialog-prefix-cell is-connector">${treeDialogIconSvg(flatNode.isLast ? "connector-elbow" : "connector-tee")}</span>`
          )
        } else if (positionInLevel === 1) {
          const iconName = isFolded
            ? "fold-closed"
            : foldable
              ? "fold-open"
              : "leaf-line"
          cells.push(
            `<span class="tree-dialog-prefix-cell is-node-marker">${treeDialogIconSvg(iconName)}</span>`
          )
        } else {
          cells.push('<span class="tree-dialog-prefix-cell is-empty"></span>')
        }
        continue
      }

      cells.push('<span class="tree-dialog-prefix-cell is-empty"></span>')
    }

    return cells.join("")
  }

  function treeDialogEntryPlainText(node, viewModel) {
    const entry = node?.entry
    if (!entry) return ""

    if (entry.type === "message") {
      const message = entry.message || {}
      switch (message.role) {
        case "user":
          return `user: ${treeDialogNormalizeLine(message.text) || "(no content)"}`
        case "assistant": {
          const text = treeDialogNormalizeLine(message.text)
          if (text) return `assistant: ${text}`
          if (message.stopReason === "aborted") return "assistant: (aborted)"
          if (message.errorMessage)
            return `assistant: ${treeDialogNormalizeLine(message.errorMessage)}`
          return "assistant: (no content)"
        }
        case "toolResult": {
          const preview = message.toolCallId
            ? viewModel.toolCallMap.get(message.toolCallId)?.preview
            : undefined
          if (preview) return preview
          return `[${message.toolName || "tool"}]`
        }
        case "bashExecution":
          return `[bash]: ${treeDialogNormalizeLine(message.command)}`
        default:
          return `[${message.role || "message"}]`
      }
    }

    switch (entry.type) {
      case "compaction": {
        const tokens = Math.round((Number(entry.tokensBefore) || 0) / 1000)
        return `[compaction: ${tokens}k tokens]`
      }
      case "branch_summary":
        return `[branch summary]: ${treeDialogNormalizeLine(entry.summary) || "Branch summary"}`
      case "custom_message":
        return `[${entry.customType || "custom"}]: ${treeDialogNormalizeLine(entry.text) || "Custom message"}`
      case "model_change":
        return `[model: ${entry.modelId || ""}]`
      case "thinking_level_change":
        return `[thinking: ${entry.thinkingLevel || ""}]`
      case "session_info":
        return entry.name ? `[title: ${entry.name}]` : "[title: empty]"
      case "label":
        return `[label: ${entry.label ?? "(cleared)"}]`
      case "custom":
        return `[custom: ${entry.customType || "custom"}]`
      default:
        return `[${entry.type || "entry"}]`
    }
  }

  function treeDialogEntryDisplayHtml(node, viewModel) {
    const entry = node?.entry
    if (!entry) return ""
    const escapeHtml = services.escapeHtml

    if (entry.type === "message") {
      const message = entry.message || {}
      switch (message.role) {
        case "user":
          return `<span class="tree-dialog-role tree-dialog-role-user">user:</span> ${escapeHtml(treeDialogNormalizeLine(message.text) || "(no content)")}`
        case "assistant": {
          const text = treeDialogNormalizeLine(message.text)
          if (text) {
            return `<span class="tree-dialog-role tree-dialog-role-assistant">assistant:</span> ${escapeHtml(text)}`
          }
          if (message.stopReason === "aborted") {
            return '<span class="tree-dialog-role tree-dialog-role-assistant">assistant:</span> <span class="tree-dialog-muted">(aborted)</span>'
          }
          if (message.errorMessage) {
            return `<span class="tree-dialog-role tree-dialog-role-assistant">assistant:</span> <span class="tree-dialog-error">${escapeHtml(treeDialogNormalizeLine(message.errorMessage))}</span>`
          }
          return '<span class="tree-dialog-role tree-dialog-role-assistant">assistant:</span> <span class="tree-dialog-muted">(no content)</span>'
        }
        case "toolResult": {
          const preview = message.toolCallId
            ? viewModel.toolCallMap.get(message.toolCallId)?.preview
            : undefined
          if (preview) {
            return `<span class="tree-dialog-muted">${escapeHtml(preview)}</span>`
          }
          return `<span class="tree-dialog-muted">[${escapeHtml(message.toolName || "tool")}]</span>`
        }
        case "bashExecution":
          return `<span class="tree-dialog-muted">[bash]:</span> ${escapeHtml(treeDialogNormalizeLine(message.command))}`
        default:
          return `<span class="tree-dialog-muted">[${escapeHtml(message.role || "message")}]</span>`
      }
    }

    switch (entry.type) {
      case "compaction": {
        const tokens = Math.round((Number(entry.tokensBefore) || 0) / 1000)
        return `<span class="tree-dialog-compaction">[compaction: ${escapeHtml(String(tokens))}k tokens]</span>`
      }
      case "branch_summary":
        return `<span class="tree-dialog-branch-summary">[branch summary]:</span> ${escapeHtml(treeDialogNormalizeLine(entry.summary) || "Branch summary")}`
      case "custom_message":
        return `<span class="tree-dialog-custom-prefix">[${escapeHtml(entry.customType || "custom")}]:</span> ${escapeHtml(treeDialogNormalizeLine(entry.text) || "Custom message")}`
      case "model_change":
        return `<span class="tree-dialog-muted">[model: ${escapeHtml(entry.modelId || "")}]</span>`
      case "thinking_level_change":
        return `<span class="tree-dialog-muted">[thinking: ${escapeHtml(entry.thinkingLevel || "")}]</span>`
      case "session_info":
        return entry.name
          ? `<span class="tree-dialog-muted">[title: ${escapeHtml(entry.name)}]</span>`
          : '<span class="tree-dialog-muted">[title: <span class="tree-dialog-italic">empty</span>]</span>'
      case "label":
        return `<span class="tree-dialog-muted">[label: ${escapeHtml(entry.label ?? "(cleared)")}]</span>`
      case "custom":
        return `<span class="tree-dialog-muted">[custom: ${escapeHtml(entry.customType || "custom")}]</span>`
      default:
        return `<span class="tree-dialog-muted">[${escapeHtml(entry.type || "entry")}]</span>`
    }
  }

  function cycleTreeDialogFilter(direction = 1) {
    if (
      !state.treeDialog ||
      state.treeDialog.stage !== "browse" ||
      state.treeDialog.loading ||
      state.treeDialog.submitting
    )
      return false
    const modes = TREE_DIALOG_FILTER_MODES
    const currentIndex = modes.indexOf(treeDialogFilterMode(state.treeDialog))
    const nextIndex =
      (currentIndex + (direction < 0 ? -1 : 1) + modes.length) % modes.length
    state.treeDialog = {
      ...state.treeDialog,
      filterMode: modes[nextIndex],
      foldedEntryIds: [],
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      const target = treeDialogNavByEntryId(
        treeDialogBrowsableEntry(state.treeDialog)?.entry?.id
      )
      ;(target || $treeDialogInput)?.focus()
    })
    return true
  }

  function setTreeDialogFilterMode(mode) {
    if (
      !state.treeDialog ||
      state.treeDialog.stage !== "browse" ||
      !TREE_DIALOG_FILTER_MODES.includes(mode)
    )
      return false
    state.treeDialog = {
      ...state.treeDialog,
      filterMode: mode,
      foldedEntryIds: [],
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      const target = treeDialogNavByEntryId(
        treeDialogBrowsableEntry(state.treeDialog)?.entry?.id
      )
      ;(target || $treeDialogInput)?.focus()
    })
    return true
  }

  function toggleTreeDialogLabelTimestamps() {
    if (!state.treeDialog || state.treeDialog.stage !== "browse") return false
    state.treeDialog = {
      ...state.treeDialog,
      showLabelTimestamps: !state.treeDialog.showLabelTimestamps,
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      const target = treeDialogNavByEntryId(
        treeDialogBrowsableEntry(state.treeDialog)?.entry?.id
      )
      ;(target || $treeDialogInput)?.focus()
    })
    return true
  }

  function toggleTreeDialogBranch(open) {
    const dialog = state.treeDialog
    if (
      !dialog ||
      dialog.stage !== "browse" ||
      dialog.loading ||
      dialog.submitting
    )
      return false

    const viewModel = treeDialogViewModel(dialog)
    const currentEntryId = treeDialogBrowsableEntry(dialog)?.entry?.id
    if (!currentEntryId) return false

    const foldedEntryIds = new Set(
      Array.isArray(dialog.foldedEntryIds) ? dialog.foldedEntryIds : []
    )
    let nextFocusedEntryId = currentEntryId

    if (!open) {
      if (
        treeDialogIsFoldable(viewModel, currentEntryId) &&
        !foldedEntryIds.has(currentEntryId)
      ) {
        foldedEntryIds.add(currentEntryId)
      } else {
        nextFocusedEntryId =
          treeDialogFindBranchSegmentStart(viewModel, currentEntryId, "up") ||
          currentEntryId
      }
    } else if (foldedEntryIds.has(currentEntryId)) {
      foldedEntryIds.delete(currentEntryId)
    } else {
      nextFocusedEntryId =
        treeDialogFindBranchSegmentStart(viewModel, currentEntryId, "down") ||
        currentEntryId
    }

    state.treeDialog = {
      ...dialog,
      focusedEntryId: nextFocusedEntryId,
      foldedEntryIds: [...foldedEntryIds],
    }
    renderTreeDialog()
    requestAnimationFrame(() => {
      const target = treeDialogNavByEntryId(nextFocusedEntryId)
      if (target instanceof HTMLElement) {
        target.focus()
      }
    })
    return true
  }

  function renderTreeDialog() {
    if (
      !$treeDialogOverlay ||
      !$treeDialogBrowsePanel ||
      !$treeDialogInput ||
      !$treeDialogLabelCancelBtn ||
      !$treeDialogLabelCloseBtn ||
      !$treeDialogLabelCopy ||
      !$treeDialogLabelInput ||
      !$treeDialogLabelOverlay ||
      !$treeDialogLabelSaveBtn ||
      !$treeDialogList ||
      !$treeDialogShortcutsCloseBtn ||
      !$treeDialogShortcutsOverlay ||
      !$treeDialogShortcutsTrigger ||
      !$treeDialogStatus ||
      !$treeDialogActionPanel ||
      !$treeDialogSelectionCopy ||
      !$treeDialogCustomLabel ||
      !$treeDialogCustomInput ||
      !$treeDialogActions ||
      !$treeDialogCloseBtn
    ) {
      return
    }

    const dialog = state.treeDialog
    setMounted(overlayMounts.tree, Boolean(dialog))
    if (!dialog) {
      $treeDialogInput.value = ""
      $treeDialogInput.disabled = false
      $treeDialogShortcutsTrigger.setAttribute("aria-expanded", "false")
      $treeDialogShortcutsOverlay.classList.add("hidden")
      $treeDialogLabelOverlay.classList.add("hidden")
      $treeDialogLabelCopy.innerHTML = ""
      $treeDialogLabelInput.value = ""
      $treeDialogLabelInput.disabled = false
      $treeDialogLabelSaveBtn.textContent = "Save"
      $treeDialogLabelSaveBtn.disabled = false
      $treeDialogLabelCancelBtn.disabled = false
      $treeDialogLabelCloseBtn.disabled = false
      $treeDialogList.innerHTML = ""
      $treeDialogStatus.textContent = ""
      $treeDialogStatus.classList.add("hidden")
      $treeDialogSelectionCopy.innerHTML = ""
      $treeDialogCustomInput.value = ""
      $treeDialogCustomInput.disabled = false
      $treeDialogActions.innerHTML = ""
      $treeDialogCloseBtn.disabled = false
      $treeDialogBrowsePanel.classList.remove("hidden")
      $treeDialogActionPanel.classList.add("hidden")
      $treeDialogCustomLabel.classList.add("hidden")
      $treeDialogCustomInput.classList.add("hidden")
      return
    }

    if ($treeDialogInput.value !== dialog.query) {
      $treeDialogInput.value = dialog.query
    }
    if ($treeDialogCustomInput.value !== (dialog.customInstructions || "")) {
      $treeDialogCustomInput.value = dialog.customInstructions || ""
    }
    if ($treeDialogLabelInput.value !== (dialog.labelDraft || "")) {
      $treeDialogLabelInput.value = dialog.labelDraft || ""
    }

    const browsing = dialog.stage === "browse"
    const customStage = dialog.stage === "custom"
    const showShortcutsHelp = browsing && Boolean(dialog.showShortcutsHelp)
    const showLabelEditor = browsing && Boolean(dialog.showLabelEditor)
    const viewModel = treeDialogViewModel(dialog)
    const target = treeDialogTarget(dialog)
    const labelTarget = treeDialogLabelTarget(dialog)
    const summaryAvailable = Boolean(state.model)
    const submitting = Boolean(dialog.submitting)

    $treeDialogBrowsePanel.classList.toggle("hidden", !browsing)
    $treeDialogActionPanel.classList.toggle("hidden", browsing)
    $treeDialogShortcutsTrigger.setAttribute(
      "aria-expanded",
      showShortcutsHelp ? "true" : "false"
    )
    $treeDialogShortcutsOverlay.classList.toggle("hidden", !showShortcutsHelp)
    $treeDialogLabelOverlay.classList.toggle("hidden", !showLabelEditor)
    $treeDialogCustomLabel.classList.toggle("hidden", !customStage)
    $treeDialogCustomInput.classList.toggle("hidden", !customStage)
    $treeDialogInput.disabled = Boolean(
      dialog.loading || submitting || !browsing
    )
    $treeDialogCustomInput.disabled = submitting
    $treeDialogLabelInput.disabled = Boolean(dialog.labelSubmitting)
    $treeDialogLabelSaveBtn.textContent = dialog.labelSubmitting
      ? "Saving..."
      : "Save"
    $treeDialogLabelSaveBtn.disabled = Boolean(dialog.labelSubmitting)
    $treeDialogLabelCancelBtn.disabled = Boolean(dialog.labelSubmitting)
    $treeDialogLabelCloseBtn.disabled = Boolean(dialog.labelSubmitting)
    $treeDialogCloseBtn.disabled = submitting
    $treeDialogActions.innerHTML = ""

    if (showLabelEditor && labelTarget) {
      const currentLabel = labelTarget.label
        ? `<span class="tree-dialog-item-label">${services.escapeHtml(labelTarget.label)}</span>`
        : '<span class="tree-dialog-item-meta">No label</span>'
      $treeDialogLabelCopy.innerHTML = `
        <div class="tree-dialog-selection-target">
          <div class="tree-dialog-selection-title">${services.escapeHtml(treeDialogEntryPlainText(labelTarget, viewModel))}</div>
          <div class="tree-dialog-selection-meta">
            <span class="tree-dialog-selection-kind">${services.escapeHtml(treeDialogKindLabel(labelTarget))}</span>
            ${currentLabel}
          </div>
        </div>
        <p class="tree-dialog-selection-note">Leave the field empty to clear the label.</p>
      `
    } else {
      $treeDialogLabelCopy.innerHTML = ""
    }

    if (browsing) {
      $treeDialogSelectionCopy.innerHTML = ""
      $treeDialogList.innerHTML = ""
      $treeDialogStatus.textContent = ""
      $treeDialogStatus.classList.add("hidden")

      if (dialog.loading) {
        const loading = document.createElement("div")
        loading.className = "session-list-empty"
        loading.textContent = "Loading session tree..."
        $treeDialogList.appendChild(loading)
      } else if (!viewModel.visibleNodes.length) {
        const empty = document.createElement("div")
        empty.className = "session-list-empty"
        empty.textContent = dialog.query.trim()
          ? "No matching tree entries."
          : "No tree entries found."
        $treeDialogList.appendChild(empty)
      } else {
        const attachTreeEntryHandlers = (element, flatNode) => {
          const entryId = flatNode.node.entry.id
          element.addEventListener("focus", () => {
            updateTreeDialogFocusedEntry(entryId)
          })
          element.addEventListener("click", () => {
            updateTreeDialogFocusedEntry(entryId)
          })
          element.addEventListener("dblclick", (event) => {
            event.preventDefault()
            beginTreeDialogSelection(entryId)
          })
        }

        const foldedIds = new Set(
          Array.isArray(dialog.foldedEntryIds) ? dialog.foldedEntryIds : []
        )
        for (const flatNode of viewModel.visibleNodes) {
          const node = flatNode.node
          const entry = node.entry
          const isActiveLeaf = entry.id === dialog.currentLeafId
          const isActivePath = viewModel.activePathIds.has(entry.id)
          const isFolded = foldedIds.has(entry.id)
          const showsFoldInConnector =
            flatNode.showConnector && !flatNode.isVirtualRootChild
          const showFoldMarker = isFolded && !showsFoldInConnector

          const button = document.createElement("button")
          button.type = "button"
          button.className = `tree-dialog-entry tree-dialog-nav-item${isActiveLeaf ? " is-active-leaf" : ""}${isActivePath ? " is-active-path" : ""}`
          button.dataset.entryId = entry.id
          button.title = treeDialogEntryPlainText(node, viewModel)
          button.innerHTML = `
            <span class="tree-dialog-entry-prefix" aria-hidden="true">${treeDialogBuildPrefixHtml(flatNode, viewModel, isFolded)}</span>
            <span class="tree-dialog-entry-body">
              ${showFoldMarker ? `<span class="tree-dialog-entry-fold" aria-hidden="true">${treeDialogIconSvg("root-folded")}</span>` : ""}
              <span class="tree-dialog-entry-path${isActivePath ? " is-active" : ""}" aria-hidden="true">${isActivePath ? treeDialogIconSvg("active-path") : ""}</span>
              ${node.label ? `<span class="tree-dialog-inline-label">[${services.escapeHtml(node.label)}]</span>` : ""}
              ${viewModel.showLabelTimestamps && node.label && node.labelTimestamp ? `<span class="tree-dialog-inline-timestamp">${services.escapeHtml(treeDialogFormatLabelTimestamp(node.labelTimestamp))}</span>` : ""}
              <span class="tree-dialog-entry-content">${treeDialogEntryDisplayHtml(node, viewModel)}</span>
            </span>
          `
          attachTreeEntryHandlers(button, flatNode)
          $treeDialogList.appendChild(button)
        }

        syncTreeDialogBrowseSelection(dialog)
      }

      renderTreeDialogBrowseActions(dialog)
      return
    }

    $treeDialogList.innerHTML = ""
    $treeDialogStatus.textContent = ""
    $treeDialogStatus.classList.add("hidden")
    if (!target) {
      const empty = document.createElement("div")
      empty.className = "session-list-empty"
      empty.textContent = "Select a tree entry first."
      $treeDialogSelectionCopy.replaceChildren(empty)
      $treeDialogActions.appendChild(
        dialogButton("Back", "secondary", () => handleTreeDialogEscape())
      )
      return
    }

    const note = customStage
      ? "These instructions will be appended to the default branch summary prompt."
      : summaryAvailable
        ? "Choose whether to summarize the branch you are leaving before navigating."
        : "Summary options require a selected model. You can still navigate without a summary."
    $treeDialogSelectionCopy.innerHTML = `
      <div class="tree-dialog-selection-target">
        <div class="tree-dialog-selection-title">${services.escapeHtml(treeDialogEntryPlainText(target, viewModel))}</div>
        <div class="tree-dialog-selection-meta">
          <span class="tree-dialog-selection-kind">${services.escapeHtml(treeDialogKindLabel(target))}</span>
          ${target.label ? `<span class="tree-dialog-item-label">${services.escapeHtml(target.label)}</span>` : ""}
          ${target.label && target.labelTimestamp ? `<span class="tree-dialog-item-meta">${services.escapeHtml(treeDialogFormatLabelTimestamp(target.labelTimestamp))}</span>` : ""}
        </div>
      </div>
      <p class="tree-dialog-selection-note">${services.escapeHtml(note)}</p>
    `

    const backButton = dialogButton("Back", "secondary", () =>
      handleTreeDialogEscape()
    )
    backButton.disabled = submitting
    $treeDialogActions.appendChild(backButton)
    if (customStage) {
      const submitCustomButton = dialogButton(
        submitting ? "Navigating..." : "Summarize & navigate",
        "primary",
        () => {
          void submitTreeDialog(target.entry.id, {
            summarize: true,
            customInstructions: $treeDialogCustomInput.value,
          })
        }
      )
      submitCustomButton.disabled = submitting
      $treeDialogActions.appendChild(submitCustomButton)
      return
    }

    const noSummaryButton = dialogButton(
      submitting ? "Navigating..." : "No summary",
      "primary",
      () => {
        void submitTreeDialog(target.entry.id, { summarize: false })
      }
    )
    noSummaryButton.disabled = submitting
    $treeDialogActions.appendChild(noSummaryButton)
    const summarizeButton = dialogButton(
      submitting ? "Summarizing..." : "Summarize",
      "secondary",
      () => {
        void submitTreeDialog(target.entry.id, { summarize: true })
      }
    )
    summarizeButton.disabled = !summaryAvailable || submitting
    $treeDialogActions.appendChild(summarizeButton)

    const customButton = dialogButton("Custom prompt", "secondary", () => {
      openTreeCustomSummary()
    })
    customButton.disabled = !summaryAvailable || submitting
    $treeDialogActions.appendChild(customButton)
  }

  function forkDialogFormatTimestamp(timestamp) {
    if (!timestamp) return ""
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return ""

    const now = new Date()
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()

    if (sameDay) {
      return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    }

    const sameYear = date.getFullYear() === now.getFullYear()
    return date.toLocaleDateString(
      [],
      sameYear
        ? {
            month: "short",
            day: "numeric",
          }
        : {
            year: "numeric",
            month: "short",
            day: "numeric",
          }
    )
  }

  function forkDialogEntries(dialog = state.forkDialog) {
    if (!dialog) return []
    const query =
      typeof dialog.query === "string" ? dialog.query.trim().toLowerCase() : ""
    const entries = Array.isArray(dialog.entries) ? dialog.entries : []
    if (!query) return entries
    return entries.filter((entry) =>
      `${entry?.text || ""}`.toLowerCase().includes(query)
    )
  }

  async function openForkDialog() {
    closeConfirmDialog({ focusPrompt: false })
    closeRenameDialog({ focusPrompt: false, force: true })
    closeCommandPalette({ focusPrompt: false })
    closeDirectoryDialog({ focusPrompt: false })
    closeStatusDialog({ focusPrompt: false })
    closeShortcutsDialog({ focusPrompt: false })
    closeSettingsDialog({ focusPrompt: false })
    closeTreeDialog({ focusPrompt: false, force: true })
    services.closeHeaderSessionMenu?.()
    services.closeSessionMenu?.()
    services.closeDirectoryMenu?.()
    services.closeComposerPopovers?.()

    state.forkDialog = {
      query: "",
      entries: [],
      loading: true,
      submittingEntryId: undefined,
      autoFocusList: true,
    }
    renderForkDialog()
    requestAnimationFrame(() => {
      $forkDialogInput?.focus()
      $forkDialogInput?.select()
    })

    try {
      const result = await services.get("/api/session/fork")
      const entries = Array.isArray(result?.messages)
        ? result.messages
            .map((message, index) => ({
              entryId:
                typeof message?.entryId === "string" ? message.entryId : "",
              text:
                typeof message?.text === "string" ? message.text.trim() : "",
              timestamp:
                typeof message?.timestamp === "string"
                  ? message.timestamp
                  : undefined,
              index: Number.isInteger(message?.index) ? message.index : index,
            }))
            .filter((message) => message.entryId && message.text)
        : []

      if (!state.forkDialog) return
      if (!entries.length) {
        closeForkDialog({ force: true })
        throw new Error("No messages to fork from.")
      }

      state.forkDialog = {
        ...state.forkDialog,
        loading: false,
        entries,
        autoFocusList: true,
      }
      renderForkDialog()
    } catch (error) {
      if (!state.forkDialog) {
        return
      }
      if (state.forkDialog.loading) {
        closeForkDialog({ force: true })
      }
      throw error
    }
  }

  function closeForkDialog({ focusPrompt = true, force = false } = {}) {
    if (!state.forkDialog) return
    if (state.forkDialog.submittingEntryId && !force) return
    state.forkDialog = null
    renderForkDialog()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  async function submitForkDialog(entryId) {
    const dialog = state.forkDialog
    if (!dialog || dialog.loading || dialog.submittingEntryId) return

    const targetEntryId = typeof entryId === "string" ? entryId : ""
    if (!targetEntryId) return

    state.forkDialog = {
      ...dialog,
      submittingEntryId: targetEntryId,
    }
    renderForkDialog()

    try {
      await services.post("/api/session/fork", { entryId: targetEntryId })
      closeForkDialog({ force: true })
    } catch (error) {
      if (!state.forkDialog) return
      state.forkDialog = {
        ...state.forkDialog,
        submittingEntryId: undefined,
      }
      renderForkDialog()
      showToast(error?.message || "Failed to fork session.", "error")
    }
  }

  function renderForkDialog() {
    if (
      !$forkDialogOverlay ||
      !$forkDialogInput ||
      !$forkDialogList ||
      !$forkDialogCloseBtn
    )
      return

    const dialog = state.forkDialog
    setMounted(overlayMounts.fork, Boolean(dialog))
    if (!dialog) {
      $forkDialogInput.value = ""
      $forkDialogInput.disabled = false
      $forkDialogCloseBtn.disabled = false
      $forkDialogList.innerHTML = ""
      return
    }

    if ($forkDialogInput.value !== dialog.query) {
      $forkDialogInput.value = dialog.query
    }

    $forkDialogInput.disabled = Boolean(
      dialog.loading || dialog.submittingEntryId
    )
    $forkDialogCloseBtn.disabled = Boolean(dialog.submittingEntryId)
    $forkDialogList.innerHTML = ""

    if (dialog.loading) {
      const loading = document.createElement("div")
      loading.className = "session-list-empty"
      loading.textContent = "Loading previous user messages..."
      $forkDialogList.appendChild(loading)
      services.syncForkDialogListFocus?.()
      return
    }

    const entries = forkDialogEntries(dialog)
    if (!entries.length) {
      const empty = document.createElement("div")
      empty.className = "session-list-empty"
      empty.textContent = dialog.query.trim()
        ? "No matching messages."
        : "No messages to fork from."
      $forkDialogList.appendChild(empty)
      services.syncForkDialogListFocus?.()
      return
    }

    for (const entry of entries) {
      const button = document.createElement("button")
      const submitting = dialog.submittingEntryId === entry.entryId
      const timestampLabel = submitting
        ? "Forking..."
        : forkDialogFormatTimestamp(entry.timestamp)
      button.type = "button"
      button.className = "fork-dialog-item"
      button.dataset.entryId = entry.entryId
      button.disabled = Boolean(dialog.submittingEntryId)
      button.title = entry.text
      button.innerHTML = `
        <span class="fork-dialog-item-title">${services.escapeHtml(entry.text)}</span>
        <span class="fork-dialog-item-time">${services.escapeHtml(timestampLabel)}</span>
      `
      button.addEventListener("click", async () => {
        await submitForkDialog(entry.entryId)
      })
      $forkDialogList.appendChild(button)
    }

    services.syncForkDialogListFocus?.()
  }

  function renderStatusDialog() {
    if (!$statusDialogOverlay || !$statusDialogList) return

    setMounted(overlayMounts.status, state.statusDialogOpen)
    $statusDialogList.innerHTML = ""

    if (!state.statusDialogOpen) return

    const entries = Object.entries(state.uiState.statuses || {})
    if (!entries.length) {
      const empty = document.createElement("div")
      empty.className = "session-list-empty"
      empty.textContent = "No active status items."
      $statusDialogList.appendChild(empty)
      return
    }

    for (const [, text] of entries) {
      const div = document.createElement("div")
      div.className = "status-chip"
      div.textContent = text
      $statusDialogList.appendChild(div)
    }
  }

  function renderShortcutsDialog() {
    if (!$shortcutsDialogOverlay || !$shortcutsDialogList) return

    setMounted(overlayMounts.shortcuts, state.shortcutsDialogOpen)
    $shortcutsDialogList.innerHTML = ""

    if (!state.shortcutsDialogOpen) return

    SHORTCUTS_DIALOG_SECTIONS.forEach((section, index) => {
      const sectionElement = document.createElement("section")
      sectionElement.className = "shortcuts-dialog-section"

      const header = document.createElement("div")
      header.className = "shortcuts-dialog-section-header"

      const title = document.createElement("h3")
      title.id = `shortcuts-dialog-section-${index}`
      title.className = "shortcuts-dialog-section-title"
      title.textContent = section.title
      header.appendChild(title)

      if (section.description) {
        const note = document.createElement("p")
        note.className = "shortcuts-dialog-section-note"
        note.textContent = section.description
        header.appendChild(note)
      }

      sectionElement.appendChild(header)

      const list = document.createElement("div")
      list.className = "shortcuts-dialog-list"
      for (const item of section.items) {
        const row = document.createElement("div")
        row.className = "shortcuts-dialog-row"
        row.innerHTML = `
          <div class="shortcuts-dialog-copy">
            <div class="shortcuts-dialog-label">${services.escapeHtml(item.label)}</div>
            ${item.description ? `<div class="shortcuts-dialog-description">${services.escapeHtml(item.description)}</div>` : ""}
          </div>
          <div class="shortcuts-dialog-keys">${item.keysHtml}</div>
        `
        list.appendChild(row)
      }

      sectionElement.appendChild(list)
      $shortcutsDialogList.appendChild(sectionElement)
    })
  }

  function renderSidebarSettingsButton() {
    if (!$sidebarSettingsBtn) return
    const label = services.themeModeLabel()
    $sidebarSettingsBtn.setAttribute(
      "aria-expanded",
      state.settingsDialogOpen ? "true" : "false"
    )
    $sidebarSettingsBtn.setAttribute(
      "aria-label",
      `Open settings. Current theme: ${label}.`
    )
    $sidebarSettingsBtn.title = `Settings • ${label}`
  }

  function renderSettingsDialog() {
    renderSidebarSettingsButton()
    if (!$settingsDialogOverlay) return

    const notificationPermission =
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission

    setMounted(overlayMounts.settings, state.settingsDialogOpen)
    for (const button of $settingsThemeOptions) {
      const selected = button.dataset.themeOption === state.theme
      button.setAttribute("aria-checked", selected ? "true" : "false")
      button.classList.toggle("is-selected", selected)
    }

    if ($settingsSessionDoneDesktopNotificationsInput) {
      const enabled = Boolean(state.sessionDoneDesktopNotificationsEnabled)
      $settingsSessionDoneDesktopNotificationsInput.checked = enabled
      $settingsSessionDoneDesktopNotificationsInput.title = !enabled
        ? "Turn on desktop notifications"
        : notificationPermission === "denied"
          ? "Desktop notifications are blocked in the browser"
          : notificationPermission === "unsupported"
            ? "Desktop notifications are unavailable in this browser"
            : notificationPermission === "default"
              ? "Allow desktop notifications"
              : "Turn off desktop notifications"
    }

    if ($settingsSessionDoneSoundInput) {
      const enabled = Boolean(state.sessionDoneSoundEnabled)
      $settingsSessionDoneSoundInput.checked = enabled
      $settingsSessionDoneSoundInput.title = enabled
        ? "Turn off session done sound"
        : "Turn on session done sound"
    }
  }

  async function dismissDialog(payload = { cancelled: true }) {
    const dialog = state.dialog
    state.dialog = null
    renderDialog()
    if (services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }

    if (!dialog?.id) return
    try {
      await services.post(`/api/ui/${encodeURIComponent(dialog.id)}`, payload)
    } catch (error) {
      showToast(error.message, "error")
    }
  }

  function renderDialog() {
    if (!$dialogOverlay) return

    const dialog = state.dialog
    setMounted(overlayMounts.dialog, Boolean(dialog))
    if (!dialog) {
      return
    }

    $dialogTitle.textContent = dialog.title || dialog.method || "Dialog"
    $dialogMessage.textContent = dialog.message || ""
    $dialogBody.innerHTML = ""
    $dialogActions.innerHTML = ""

    const respond = async (payload) => {
      await dismissDialog(payload)
    }

    let supported = true

    if (dialog.method === "select") {
      for (const option of dialog.options || []) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "button dialog-option"
        button.textContent = option
        button.addEventListener("click", () => respond({ value: option }))
        $dialogBody.appendChild(button)
      }
      $dialogActions.appendChild(
        dialogButton("Cancel", "ghost", () => respond({ cancelled: true }))
      )
    } else if (dialog.method === "confirm") {
      $dialogActions.append(
        dialogButton("Cancel", "ghost", () => respond({ confirmed: false })),
        dialogButton("Confirm", "primary", () => respond({ confirmed: true }))
      )
    } else if (dialog.method === "input") {
      const input = document.createElement("input")
      input.className = "dialog-input"
      input.value = dialog.prefill || ""
      input.placeholder = dialog.placeholder || ""
      $dialogBody.appendChild(input)
      $dialogActions.append(
        dialogButton("Cancel", "ghost", () => respond({ cancelled: true })),
        dialogButton("OK", "primary", () => respond({ value: input.value }))
      )
    } else if (dialog.method === "editor") {
      const input = document.createElement("textarea")
      input.className = "dialog-editor"
      input.value = dialog.prefill || ""
      $dialogBody.appendChild(input)
      $dialogActions.append(
        dialogButton("Cancel", "ghost", () => respond({ cancelled: true })),
        dialogButton("Save", "primary", () => respond({ value: input.value }))
      )
    } else {
      supported = false
      const message = document.createElement("div")
      message.className = "session-list-empty"
      message.textContent = `Unsupported dialog type: ${dialog.method || "unknown"}`
      $dialogBody.appendChild(message)
      $dialogActions.appendChild(
        dialogButton("Dismiss", "ghost", () => respond({ cancelled: true }))
      )
    }

    if (supported && $dialogActions.children.length === 0) {
      $dialogActions.appendChild(
        dialogButton("Dismiss", "ghost", () => respond({ cancelled: true }))
      )
    }
  }

  function dialogButton(labelText, variant, onClick) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `button ${variant}`
    button.textContent = labelText
    button.addEventListener("click", onClick)
    return button
  }

  function showToast(message, type = "info", options = {}) {
    if (!$toastContainer) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const clickable = typeof options.onClick === "function"
    const toast = document.createElement(clickable ? "button" : "div")
    if (toast instanceof HTMLButtonElement) {
      toast.type = "button"
    }
    toast.className = `toast ${type}${clickable ? " clickable" : ""}`
    toast.textContent = message
    if (options.title) {
      toast.title = options.title
    }

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches
    const enterTransitionMs = reducedMotion ? 0 : 180
    const dismissTransitionMs = reducedMotion ? 0 : 220
    let timeoutId = null
    let dismissing = false
    const dismiss = () => {
      if (dismissing) return
      dismissing = true
      if (timeoutId != null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      toast.classList.remove("is-visible")
      toast.classList.add("is-closing")
      if (!dismissTransitionMs) {
        toast.remove()
        return
      }

      let removed = false
      const finishDismiss = () => {
        if (removed) return
        removed = true
        toast.removeEventListener("transitionend", handleTransitionEnd)
        toast.remove()
      }
      const handleTransitionEnd = (event) => {
        if (event.target === toast && event.propertyName === "max-height") {
          finishDismiss()
        }
      }

      toast.addEventListener("transitionend", handleTransitionEnd)
      setTimeout(finishDismiss, dismissTransitionMs + 40)
    }

    if (clickable) {
      toast.addEventListener("click", () => {
        dismiss()
        Promise.resolve()
          .then(() => options.onClick())
          .catch((error) => {
            showToast(error?.message || "Failed to open session.", "error")
          })
      })
    }

    services.syncToastContainerOffset?.()
    $toastContainer.appendChild(toast)
    toast.style.setProperty(
      "--toast-height",
      `${Math.ceil(toast.scrollHeight)}px`
    )
    requestAnimationFrame(() => {
      if (!dismissing) {
        toast.classList.add("is-visible")
      }
    })
    services.restoreElementFocus?.(previouslyFocused)
    timeoutId = setTimeout(dismiss, 4500 + enterTransitionMs)
  }

  return {
    closeCommandPalette,
    closeConfirmDialog,
    closeDirectoryDialog,
    closeForkDialog,
    closeRenameDialog,
    closeSettingsDialog,
    closeShortcutsDialog,
    closeStatusDialog,
    closeTreeDialogLabelEditor,
    closeTreeDialogShortcutsHelp,
    cycleTreeDialogFilter,
    beginTreeDialogSelection,
    closeTreeDialog,
    commandPaletteCommands,
    dialogButton,
    directoryDialogViewModel,
    dismissDialog,
    finalizeDirectoryAdd,
    forkDialogEntries,
    handleTreeDialogEscape,
    openCommandPalette,
    openConfirmDialog,
    openForkDialog,
    openDirectoryDialog,
    openDirectoryPath,
    openRenameDialog,
    openSettingsDialog,
    openShortcutsDialog,
    openStatusDialog,
    openTreeDialog,
    openTreeDialogLabelEditor,
    openTreeDialogShortcutsHelp,
    renderCommandPalette,
    renderConfirmDialog,
    renderDialog,
    renderDirectoryDialog,
    renderForkDialog,
    renderRenameDialog,
    renderSettingsDialog,
    renderShortcutsDialog,
    renderSidebarSettingsButton,
    renderStatusDialog,
    renderTreeDialog,
    runCommandPaletteCommand,
    setTreeDialogFilterMode,
    showToast,
    submitForkDialog,
    submitRenameDialog,
    submitTreeDialog,
    submitTreeDialogLabel,
    toggleTreeDialogBranch,
    toggleTreeDialogLabelTimestamps,
    toggleTreeDialogShortcutsHelp,
    treeDialogEntries,
  }
}
