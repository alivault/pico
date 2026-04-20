export const THEME_STORAGE_KEY = "pi-web-theme"
export const DRAFT_DIRECTORY_STORAGE_KEY = "pi-web-draft-directory"
export const SIDEBAR_DIRECTORIES_STORAGE_KEY = "pi-web-sidebar-directories"
export const COLLAPSED_DIRECTORIES_STORAGE_KEY = "pi-web-collapsed-directories"
export const RECENT_DIRECTORIES_STORAGE_KEY = "pi-web-recent-directories"
export const RECENT_DIRECTORIES_LIMIT = 8
export const PROMPT_DRAFTS_STORAGE_KEY = "pi-web-prompt-drafts"
export const SESSION_DONE_TOAST_MESSAGE = "Session finished."
export const SESSION_DONE_SOUND_ENABLED_STORAGE_KEY =
  "pi-web-session-done-sound"
export const SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "pi-web-session-done-desktop-notifications"
export const SESSION_DONE_SOUND_URL = "/session-done.aac"
export const INITIAL_DIRECTORY_SESSION_RENDER_COUNT = 5
export const DIRECTORY_SESSION_LOAD_MORE_COUNT = 5

export const systemThemeMedia =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null

export function safeLocalStorageGetItem(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalStorageSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeSessionStorageGetItem(key) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionStorageSetItem(key, value) {
  try {
    sessionStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function normalizeStoredDirectoryList(value) {
  if (!Array.isArray(value)) return []
  const directories = []
  const seen = new Set()
  for (const entry of value) {
    const normalizedEntry = typeof entry === "string" ? entry.trim() : ""
    if (!normalizedEntry || seen.has(normalizedEntry)) continue
    seen.add(normalizedEntry)
    directories.push(normalizedEntry)
  }
  return directories
}

export function readStoredDraftDirectory() {
  const value = safeLocalStorageGetItem(DRAFT_DIRECTORY_STORAGE_KEY) ?? ""
  return typeof value === "string" ? value.trim() : ""
}

export function readStoredSidebarDirectories() {
  try {
    const raw = safeLocalStorageGetItem(SIDEBAR_DIRECTORIES_STORAGE_KEY)
    if (raw == null) {
      return { directories: [], hasStoredValue: false }
    }
    return {
      directories: normalizeStoredDirectoryList(JSON.parse(raw)),
      hasStoredValue: true,
    }
  } catch {
    return { directories: [], hasStoredValue: false }
  }
}

export function readStoredCollapsedDirectories() {
  try {
    const raw = safeLocalStorageGetItem(COLLAPSED_DIRECTORIES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const collapsed = {}
    for (const [directoryPath, value] of Object.entries(parsed)) {
      const normalizedPath =
        typeof directoryPath === "string" ? directoryPath.trim() : ""
      if (!normalizedPath) continue
      collapsed[normalizedPath] = Boolean(value)
    }
    return collapsed
  } catch {
    return {}
  }
}

export function loadPromptDrafts() {
  try {
    const raw = safeSessionStorageGetItem(PROMPT_DRAFTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function readStoredSessionDoneSoundEnabled() {
  const value = safeLocalStorageGetItem(SESSION_DONE_SOUND_ENABLED_STORAGE_KEY)
  return value == null ? true : value !== "0"
}

export function readStoredSessionDoneDesktopNotificationsEnabled() {
  const value = safeLocalStorageGetItem(
    SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY
  )
  return value == null ? true : value !== "0"
}

export function createContextId() {
  return `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createAppState({ theme = "system" } = {}) {
  const initialSidebarDirectories = readStoredSidebarDirectories()

  return {
    connected: false,
    replaying: false,
    streaming: false,
    items: [],
    sessions: [],
    knownDirectories: [],
    sidebarDirectories: initialSidebarDirectories.directories,
    sidebarDirectoriesHydrated: initialSidebarDirectories.hasStoredValue,
    collapsedDirectories: readStoredCollapsedDirectories(),
    sessionSearch: "",
    sessionSearchAutoFocusList: false,
    mainPanelTab: "session",
    gitBranchesTab: "local",
    selectedSidebarSessionKeys: [],
    sidebarSessionSelectionAnchor: "",
    sessionScope: readStoredDraftDirectory(),
    dialog: null,
    sidebarCollapsedDesktop: false,
    sidebarDrawerOpenMobile: false,
    sessionId: undefined,
    sessionKey: undefined,
    sessionName: undefined,
    firstMessage: "",
    sessionFile: undefined,
    cwd: undefined,
    model: undefined,
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    availableModels: [],
    availableSkills: [],
    hideThinkingBlock: false,
    hiddenThinkingPreview: undefined,
    hideToolBlocks: safeLocalStorageGetItem("pi-web-hide-tools") === "1",
    sessionDoneSoundEnabled: readStoredSessionDoneSoundEnabled(),
    sessionDoneDesktopNotificationsEnabled:
      readStoredSessionDoneDesktopNotificationsEnabled(),
    contextUsage: undefined,
    draft: false,
    loadingSession: null,
    openComposerPopover: null,
    openSessionMenuPath: null,
    openDirectoryMenuPath: null,
    headerSessionMenuOpen: false,
    commandPaletteOpen: false,
    commandPaletteAutoFocusList: false,
    directoryDialogOpen: false,
    directoryDialogAutoFocusList: false,
    statusDialogOpen: false,
    shortcutsDialogOpen: false,
    settingsDialogOpen: false,
    treeDialog: null,
    forkDialog: null,
    renameDialog: null,
    confirmDialog: null,
    theme,
    commandPaletteQuery: "",
    directoryDialogQuery: "",
    followMessages: true,
    pendingMessagesTrayOpen: false,
    directorySessionLoadedCounts: {},
    directorySessionTotalCounts: {},
    directorySessionLoading: {},
    directoryGitStatus: {},
    directoryGitStatusLoading: {},
    directoryGitChanges: {},
    directoryGitChangesLoading: {},
    directorySessionIndexes: {},
    directorySessionSearchEntries: {},
    directorySessionSearchLoading: {},
    directorySessionSearchRevisions: {},
    modelSearch: "",
    composerSkill: undefined,
    pathCompletion: null,
    composerImages: [],
    pendingDraftPrompt: null,
    pendingDraftFollowUps: [],
    awaitingFirstTurn: false,
    slashCommandQuery: "",
    slashCommandIndex: 0,
    runningSlashCommand: undefined,
    cancellingSlashCommand: undefined,
    compacting: false,
    compactingReason: undefined,
    recentCompactionSummaryItem: null,
    recentCompactionSummaryPending: false,
    uiState: {
      statuses: {},
      title: undefined,
      editorText: "",
      workingMessage: undefined,
      hiddenThinkingLabel: undefined,
    },
  }
}

export function createDomRefs() {
  const refs = {
    $appShell: document.getElementById("app-shell"),
    $mainPanelTabSessionBtn: document.getElementById("main-panel-tab-session"),
    $mainPanelTabChangesBtn: document.getElementById("main-panel-tab-changes"),
    $messages: document.getElementById("messages"),
    $changesView: document.getElementById("changes-view"),
    $pendingMessagesTray: document.getElementById("pending-messages-tray"),
    $pendingMessagesTrayToggle: document.getElementById(
      "pending-messages-tray-toggle"
    ),
    $pendingMessagesTrayCount: document.getElementById(
      "pending-messages-tray-count"
    ),
    $pendingMessagesTrayList: document.getElementById(
      "pending-messages-tray-list"
    ),
    $prompt: document.getElementById("prompt-input"),
    $composerSkillPill: document.getElementById("composer-skill-pill"),
    $pathCompletionMenu: document.getElementById("path-completion-menu"),
    $slashCommandMenu: document.getElementById("slash-command-menu"),
    $composerEditorCard: document.querySelector(".composer-editor-card"),
    $messagesWorkingIndicator: document.getElementById(
      "messages-working-indicator"
    ),
    $messagesWorkingDone: document.getElementById("messages-working-done"),
    $messagesWorkingLabel: document.getElementById("messages-working-label"),
    $messagesWorkingText: document.getElementById("messages-working-text"),
    $composerImagePreview: document.getElementById("composer-image-preview"),
    $composerMobileTerminalBar: document.getElementById(
      "composer-mobile-terminal-bar"
    ),
    $composerMobileEscapeBtn: document.getElementById(
      "composer-mobile-key-escape"
    ),
    $composerMobileTabBtn: document.getElementById("composer-mobile-key-tab"),
    $composerMobileCtrlBtn: document.getElementById(
      "composer-mobile-key-control"
    ),
    $composerMobileOptionBtn: document.getElementById(
      "composer-mobile-key-option"
    ),
    $queue: document.getElementById("queue-btn"),
    $steer: document.getElementById("steer-btn"),
    $send: document.getElementById("send-btn"),
    $modelTrigger: document.getElementById("model-trigger-btn"),
    $modelTriggerLabel: document.getElementById("model-trigger-label"),
    $modelPopover: document.getElementById("model-popover"),
    $modelSearch: document.getElementById("model-search-input"),
    $modelOptions: document.getElementById("model-options"),
    $thinkingTrigger: document.getElementById("thinking-trigger-btn"),
    $thinkingTriggerLabel: document.getElementById("thinking-trigger-label"),
    $thinkingPopover: document.getElementById("thinking-popover"),
    $thinkingOptions: document.getElementById("thinking-options"),
    $sidebarToggleBtn: document.getElementById("sidebar-toggle-btn"),
    $sidebarCloseBtn: document.getElementById("sidebar-close-btn"),
    $sidebarBackdrop: document.getElementById("sidebar-backdrop"),
    $badge: document.getElementById("connection-badge"),
    $sessionSearch: document.getElementById("session-search-input"),
    $collapseAllDirectoriesBtn: document.getElementById(
      "collapse-all-directories-btn"
    ),
    $addDirectoryBtn: document.getElementById("add-directory-btn"),
    $sessionList: document.getElementById("session-list"),
    $sidebarSettingsBtn: document.getElementById("sidebar-settings-btn"),
    $sessionMeta: document.getElementById("session-meta"),
    $mainPanelTabs: document.getElementById("main-panel-tabs"),
    $contextUsageIndicator: document.getElementById("context-usage-indicator"),
    $headerSessionActions: document.getElementById("header-session-actions"),
    $headerSessionMenuTrigger: document.getElementById(
      "header-session-menu-trigger"
    ),
    $headerNewSessionBtn: document.getElementById("header-new-session-btn"),
    $headerSessionMenu: document.getElementById("header-session-menu"),
    $headerToggleThinkingBtn: document.getElementById(
      "header-toggle-thinking-btn"
    ),
    $headerToggleToolsBtn: document.getElementById("header-toggle-tools-btn"),
    $headerSessionMenuDivider: document.getElementById(
      "header-session-menu-divider"
    ),
    $headerRenameSessionBtn: document.getElementById(
      "header-rename-session-btn"
    ),
    $headerDeleteSessionBtn: document.getElementById(
      "header-delete-session-btn"
    ),
    $topbar: document.querySelector(".topbar"),
    $toastContainer: document.getElementById("toast-container"),
    $dialogOverlay: document.getElementById("dialog-overlay"),
    $dialogTitle: document.getElementById("dialog-title"),
    $dialogCloseBtn: document.getElementById("dialog-close-btn"),
    $dialogMessage: document.getElementById("dialog-message"),
    $dialogBody: document.getElementById("dialog-body"),
    $dialogActions: document.getElementById("dialog-actions"),
    $commandPaletteOverlay: document.getElementById("command-palette-overlay"),
    $commandPaletteInput: document.getElementById("command-palette-input"),
    $commandPaletteList: document.getElementById("command-palette-list"),
    $commandPaletteCloseBtn: document.getElementById(
      "command-palette-close-btn"
    ),
    $openDirectoryOverlay: document.getElementById("open-directory-overlay"),
    $openDirectoryInput: document.getElementById("open-directory-input"),
    $openDirectoryList: document.getElementById("open-directory-list"),
    $openDirectoryCloseBtn: document.getElementById("open-directory-close-btn"),
    $statusDialogOverlay: document.getElementById("status-dialog-overlay"),
    $statusDialogList: document.getElementById("status-dialog-list"),
    $statusDialogCloseBtn: document.getElementById("status-dialog-close-btn"),
    $shortcutsDialogOverlay: document.getElementById(
      "shortcuts-dialog-overlay"
    ),
    $shortcutsDialogList: document.getElementById("shortcuts-dialog-list"),
    $shortcutsDialogCloseBtn: document.getElementById(
      "shortcuts-dialog-close-btn"
    ),
    $settingsDialogOverlay: document.getElementById("settings-dialog-overlay"),
    $settingsDialogCloseBtn: document.getElementById(
      "settings-dialog-close-btn"
    ),
    $settingsDialogDoneBtn: document.getElementById("settings-dialog-done-btn"),
    $settingsSessionDoneDesktopNotificationsInput: document.getElementById(
      "settings-session-done-desktop-notifications-input"
    ),
    $settingsSessionDoneSoundInput: document.getElementById(
      "settings-session-done-sound-input"
    ),
    $treeDialogOverlay: document.getElementById("tree-dialog-overlay"),
    $treeDialogCloseBtn: document.getElementById("tree-dialog-close-btn"),
    $treeDialogBrowsePanel: document.getElementById("tree-dialog-browse-panel"),
    $treeDialogShortcutsTrigger: document.getElementById(
      "tree-dialog-shortcuts-trigger"
    ),
    $treeDialogShortcutsOverlay: document.getElementById(
      "tree-dialog-shortcuts-overlay"
    ),
    $treeDialogShortcutsCloseBtn: document.getElementById(
      "tree-dialog-shortcuts-close-btn"
    ),
    $treeDialogLabelOverlay: document.getElementById(
      "tree-dialog-label-overlay"
    ),
    $treeDialogLabelCloseBtn: document.getElementById(
      "tree-dialog-label-close-btn"
    ),
    $treeDialogLabelCopy: document.getElementById("tree-dialog-label-copy"),
    $treeDialogLabelInput: document.getElementById("tree-dialog-label-input"),
    $treeDialogLabelCancelBtn: document.getElementById(
      "tree-dialog-label-cancel-btn"
    ),
    $treeDialogLabelSaveBtn: document.getElementById(
      "tree-dialog-label-save-btn"
    ),
    $treeDialogInput: document.getElementById("tree-dialog-input"),
    $treeDialogList: document.getElementById("tree-dialog-list"),
    $treeDialogStatus: document.getElementById("tree-dialog-status"),
    $treeDialogActionPanel: document.getElementById("tree-dialog-action-panel"),
    $treeDialogSelectionCopy: document.getElementById(
      "tree-dialog-selection-copy"
    ),
    $treeDialogCustomLabel: document.getElementById("tree-dialog-custom-label"),
    $treeDialogCustomInput: document.getElementById("tree-dialog-custom-input"),
    $treeDialogActions: document.getElementById("tree-dialog-actions"),
    $forkDialogOverlay: document.getElementById("fork-dialog-overlay"),
    $forkDialogInput: document.getElementById("fork-dialog-input"),
    $forkDialogList: document.getElementById("fork-dialog-list"),
    $forkDialogCloseBtn: document.getElementById("fork-dialog-close-btn"),
    $renameDialogOverlay: document.getElementById("rename-dialog-overlay"),
    $renameDialogCloseBtn: document.getElementById("rename-dialog-close-btn"),
    $renameDialogInput: document.getElementById("rename-dialog-input"),
    $renameDialogCancelBtn: document.getElementById("rename-dialog-cancel-btn"),
    $renameDialogSaveBtn: document.getElementById("rename-dialog-save-btn"),
    $confirmDialogOverlay: document.getElementById("confirm-dialog-overlay"),
    $confirmDialogTitle: document.getElementById("confirm-dialog-title"),
    $confirmDialogMessage: document.getElementById("confirm-dialog-message"),
    $confirmDialogCloseBtn: document.getElementById("confirm-dialog-close-btn"),
    $confirmDialogCancelBtn: document.getElementById(
      "confirm-dialog-cancel-btn"
    ),
    $confirmDialogConfirmBtn: document.getElementById(
      "confirm-dialog-confirm-btn"
    ),
    $settingsThemeOptions: Array.from(
      document.querySelectorAll("[data-theme-option]")
    ),
    $lastMessageBtn: document.getElementById("last-message-btn"),
    $scrollToBottomBtn: document.getElementById("scroll-to-bottom-btn"),
    $composerFooter: document.querySelector(".composer-footer"),
  }

  refs.$messagesWorkingSpinner = refs.$messagesWorkingIndicator?.querySelector(
    ".messages-working-spinner"
  )
  refs.$messagesWorkingSummary = document.getElementById(
    "messages-working-summary"
  )
  refs.$messagesWorkingText = document.getElementById("messages-working-text")
  return refs
}

function createMountController(element) {
  if (!element?.parentNode) {
    return {
      mount() {},
      unmount() {},
    }
  }

  const parent = element.parentNode
  const anchor = element.nextSibling

  return {
    mount() {
      if (!element.isConnected) {
        parent.insertBefore(
          element,
          anchor?.parentNode === parent ? anchor : null
        )
      }
      element.classList.remove("hidden")
    },
    unmount() {
      element.classList.add("hidden")
      if (element.isConnected) {
        element.remove()
      }
    },
  }
}

export function setMounted(controller, mounted) {
  if (mounted) {
    controller?.mount()
    return
  }
  controller?.unmount()
}

export function createOverlayMounts(refs) {
  return {
    sidebarBackdrop: createMountController(refs.$sidebarBackdrop),
    dialog: createMountController(refs.$dialogOverlay),
    commandPalette: createMountController(refs.$commandPaletteOverlay),
    directory: createMountController(refs.$openDirectoryOverlay),
    status: createMountController(refs.$statusDialogOverlay),
    shortcuts: createMountController(refs.$shortcutsDialogOverlay),
    settings: createMountController(refs.$settingsDialogOverlay),
    tree: createMountController(refs.$treeDialogOverlay),
    fork: createMountController(refs.$forkDialogOverlay),
    rename: createMountController(refs.$renameDialogOverlay),
    confirm: createMountController(refs.$confirmDialogOverlay),
  }
}
