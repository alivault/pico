import { mountLoaderElement, setLoaderActive } from "./loader.js"
import {
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  createAppState,
  createContextId,
  createDomRefs,
  createOverlayMounts,
  DRAFT_DIRECTORY_STORAGE_KEY,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  loadPromptDrafts,
  normalizeStoredDirectoryList,
  PROMPT_DRAFTS_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  safeSessionStorageSetItem,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_URL,
  SESSION_DONE_TOAST_MESSAGE,
  setMounted,
  systemThemeMedia,
} from "./state.js"
import {
  applyTheme as applyThemeState,
  readStoredThemePreference,
  resolvedThemeMode as resolveThemeMode,
  themeModeLabel as getThemeModeLabel,
} from "./theme.js"
import {
  closeSidebarDrawerOnMobile,
  closeSidebarForViewport,
  isMobileViewport,
  isSidebarVisible as isSidebarVisibleForState,
  openSidebarForViewport,
  syncSidebarLayoutClasses,
} from "./sidebar.js"
import { createTransport } from "./transport.js"
import { createShortcutHandlers } from "./shortcuts.js"
import { createMessagesController } from "./messages.js"
import { createDialogsController } from "./dialogs.js"
import { createComposerController } from "./composer.js"
import { createFloatingPortal, FLOATING_PLACEMENTS } from "./floating.js"

const state = createAppState({ theme: readStoredThemePreference() })
const promptDrafts = loadPromptDrafts()
const contextId = createContextId()

let currentAssistantItem = null
let listNavigationFocusEl = null
let pendingSessionDoneNotificationKey = ""
let suppressedSessionDoneNotificationKey = ""
let backgroundCurrentSessionUnreadKey = ""
let sessionDoneAudio = null
let sessionDoneAudioPrimed = false
let sessionDoneDesktopNotificationPromptInstalled = false
let sessionDoneDesktopNotificationPromptAttempted = false
const activeSessionDoneDesktopNotifications = new Map()
const TITLE_STREAMING_FRAMES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]
const TITLE_STREAMING_INTERVAL_MS = 500
let titleStreamingFrameIndex = 0
let titleStreamingIntervalId = 0
let sessionDoneSnapshots = new Map()
let sessionDoneSnapshotsReady = false
const sessionListElementCache = {
  directories: new Map(),
  sessions: new Map(),
  emptyState: null,
}
const directorySessionRequestTokens = new Map()
const directorySessionSearchRequestTokens = new Map()
const pendingSessionDeletionPaths = new Set()
const hiddenDeletedSessionPaths = new Set()
let refreshLoadedSidebarDirectoriesPromise = null
let refreshLoadedSidebarDirectoriesQueued = false
let pendingDirectorySessionIndexRefresh = null
let refreshSidebarSearchIndexesPromise = null
let refreshSidebarSearchIndexesQueued = false
let pendingSidebarSearchIndexRefresh = null
let sidebarDirectoryDragPath = ""
let sidebarDirectoryDragPointerId = null
let sidebarDirectoryDragOverlay = null
let sidebarDirectoryDragOffsetX = 0
let sidebarDirectoryDragOffsetY = 0
let sidebarDirectoryDragLastClientX = 0
let sidebarDirectoryDragLastClientY = 0
let sidebarDirectoryDragInitialOrder = []
let sidebarDirectoryDragCandidate = null
let suppressSidebarDirectoryToggleClick = false
let lastChangesViewDirectory = ""
const SIDEBAR_DIRECTORY_DRAG_START_DISTANCE = 6

const refs = createDomRefs()
const {
  $addDirectoryBtn,
  $appShell,
  $badge,
  $collapseAllDirectoriesBtn,
  $commandPaletteCloseBtn,
  $commandPaletteInput,
  $commandPaletteList,
  $commandPaletteOverlay,
  $composerEditorCard,
  $composerFooter,
  $composerImagePreview,
  $composerMobileTerminalBar,
  $composerMobileEscapeBtn,
  $composerMobileTabBtn,
  $composerMobileCtrlBtn,
  $composerMobileOptionBtn,
  $composerSkillPill,
  $messagesWorkingSpinner,
  $confirmDialogCancelBtn,
  $confirmDialogCloseBtn,
  $confirmDialogConfirmBtn,
  $confirmDialogMessage,
  $confirmDialogOverlay,
  $confirmDialogTitle,
  $contextUsageIndicator,
  $dialogActions,
  $dialogBody,
  $dialogCloseBtn,
  $dialogMessage,
  $dialogOverlay,
  $dialogTitle,
  $treeDialogCloseBtn,
  $treeDialogCustomInput,
  $treeDialogInput,
  $treeDialogLabelCancelBtn,
  $treeDialogLabelCloseBtn,
  $treeDialogLabelInput,
  $treeDialogLabelOverlay,
  $treeDialogLabelSaveBtn,
  $treeDialogList,
  $treeDialogShortcutsCloseBtn,
  $treeDialogShortcutsOverlay,
  $treeDialogShortcutsTrigger,
  $treeDialogOverlay,
  $forkDialogCloseBtn,
  $forkDialogInput,
  $forkDialogList,
  $forkDialogOverlay,
  $headerDeleteSessionBtn,
  $headerNewSessionBtn,
  $headerRenameSessionBtn,
  $headerSessionActions,
  $headerSessionMenu,
  $headerSessionMenuDivider,
  $headerSessionMenuTrigger,
  $headerToggleThinkingBtn,
  $headerToggleToolsBtn,
  $lastMessageBtn,
  $changesView,
  $mainPanelTabs,
  $mainPanelTabChangesBtn,
  $mainPanelTabSessionBtn,
  $messages,
  $modelOptions,
  $modelPopover,
  $modelSearch,
  $modelTrigger,
  $modelTriggerLabel,
  $pathCompletionMenu,
  $openDirectoryCloseBtn,
  $openDirectoryInput,
  $openDirectoryList,
  $openDirectoryOverlay,
  $pendingMessagesTray,
  $pendingMessagesTrayCount,
  $pendingMessagesTrayList,
  $pendingMessagesTrayToggle,
  $prompt,
  $queue,
  $renameDialogCancelBtn,
  $renameDialogCloseBtn,
  $renameDialogInput,
  $renameDialogOverlay,
  $renameDialogSaveBtn,
  $scrollToBottomBtn,
  $send,
  $sessionList,
  $sessionMeta,
  $sessionSearch,
  $settingsDialogCloseBtn,
  $settingsDialogDoneBtn,
  $settingsDialogOverlay,
  $settingsSessionDoneDesktopNotificationsInput,
  $settingsSessionDoneSoundInput,
  $settingsThemeOptions,
  $sidebarBackdrop,
  $sidebarCloseBtn,
  $sidebarSettingsBtn,
  $sidebarToggleBtn,
  $slashCommandMenu,
  $statusDialogCloseBtn,
  $statusDialogList,
  $statusDialogOverlay,
  $shortcutsDialogCloseBtn,
  $shortcutsDialogOverlay,
  $steer,
  $thinkingOptions,
  $thinkingPopover,
  $thinkingTrigger,
  $thinkingTriggerLabel,
  $toastContainer,
  $topbar,
} = refs

const headerSessionMenuPortal = createFloatingPortal($headerSessionMenu, {
  defaultPlacement: FLOATING_PLACEMENTS.BOTTOM_START,
  offset: 6,
  padding: 12,
})

const SPINNER_ICON_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinner-icon-svg" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>'

function createSpinnerIcon(className = "") {
  const spinner = document.createElement("span")
  spinner.className = className
    ? `spinner-icon spinner-icon--spinning ${className}`
    : "spinner-icon spinner-icon--spinning"
  spinner.setAttribute("aria-hidden", "true")
  spinner.innerHTML = SPINNER_ICON_MARKUP
  return spinner
}

function createCanvasLoader(className = "", { active = false } = {}) {
  const loader = document.createElement("span")
  loader.className = className
  loader.setAttribute("aria-hidden", "true")
  mountLoaderElement(loader)
  if (active) {
    setLoaderActive(loader, true)
  }
  return loader
}

const overlayMounts = createOverlayMounts(refs)

for (const controller of Object.values(overlayMounts)) {
  controller.unmount()
}

function syncToastContainerOffset() {
  if (!$toastContainer) return
  const gap = isMobileViewport() ? 12 : 16
  const topbarBottom = $topbar?.getBoundingClientRect()?.bottom ?? 0
  const tabsBottom = $mainPanelTabs?.getBoundingClientRect()?.bottom ?? 0
  $toastContainer.style.top = `${Math.max(gap, Math.ceil(Math.max(topbarBottom, tabsBottom) + gap))}px`
}

const toastOffsetObserver =
  typeof ResizeObserver === "function" && $topbar
    ? new ResizeObserver(() => {
        syncToastContainerOffset()
      })
    : null

toastOffsetObserver?.observe($topbar)
if ($mainPanelTabs) {
  toastOffsetObserver?.observe($mainPanelTabs)
}

const BUILTIN_SLASH_COMMANDS = [
  {
    kind: "builtin",
    name: "compact",
    description: "Summarize the session to reduce context size",
  },
  {
    kind: "builtin",
    name: "delete",
    description: "Delete the current session",
  },
  {
    kind: "builtin",
    name: "fork",
    description: "Create a new session from a previous message",
  },
  {
    kind: "builtin",
    name: "tree",
    description: "Navigate to an earlier point in the current session tree",
  },
  {
    kind: "builtin",
    name: "rename",
    description: "Rename the current session",
  },
  {
    kind: "builtin",
    name: "hide-thinking",
    description: "Hide assistant thinking blocks",
  },
  {
    kind: "builtin",
    name: "show-thinking",
    description: "Show assistant thinking blocks",
  },
  {
    kind: "builtin",
    name: "hide-tools",
    description: "Hide assistant tool calls",
  },
  {
    kind: "builtin",
    name: "show-tools",
    description: "Show assistant tool calls",
  },
]

const uiServices = {}
const messagesController = createMessagesController({
  state,
  refs,
  services: uiServices,
})
const dialogsController = createDialogsController({
  state,
  refs,
  overlayMounts,
  services: uiServices,
})
const composerController = createComposerController({
  state,
  refs,
  builtinSlashCommands: BUILTIN_SLASH_COMMANDS,
  services: uiServices,
})

const {
  flushVisibleText,
  handleMessagesScroll,
  handleMessagesWheel,
  isMessagesNearBottom,
  meaningfulHiddenThinkingLabel,
  renderComposerFooterShadow,
  renderMessageItem,
  renderMessages,
  renderPendingMessagesTray,
  renderScrollToBottomButton,
  restoreMessagesScroll,
  scheduleTextPacer,
  scrollToBottom,
  scrollToLastMessage,
  stopTextPacer,
  thinkingSummaryText,
  togglePendingMessagesTray,
  truncateThinkingSummary,
} = messagesController

const {
  beginTreeDialogSelection,
  closeCommandPalette,
  closeConfirmDialog,
  closeDirectoryDialog,
  closeForkDialog,
  closeRenameDialog,
  closeSettingsDialog,
  closeShortcutsDialog,
  closeStatusDialog,
  closeTreeDialog,
  closeTreeDialogLabelEditor,
  closeTreeDialogShortcutsHelp,
  commandPaletteCommands,
  directoryDialogViewModel,
  dismissDialog,
  finalizeDirectoryAdd,
  forkDialogEntries,
  cycleTreeDialogFilter,
  handleTreeDialogEscape,
  openCommandPalette,
  openConfirmDialog,
  openDirectoryDialog,
  openDirectoryPath,
  openForkDialog,
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
} = dialogsController

const {
  abortRunningSlashCommand,
  abortStreamingResponse,
  acceptSelectedPathCompletion,
  applySlashCommandCompletion,
  clearComposerImages,
  clearComposerSkill,
  closeComposerPopovers,
  composerDraftValue,
  dismissPathCompletion,
  dismissSlashCommandQuery,
  composerHasSubmittableContent,
  createComposerImage,
  cycleThinkingLevel,
  extractMessageImages,
  flushPendingDraftPrompt,
  handleComposerInputChange,
  hideWorkingIndicatorImmediately,
  insertSkillCommand,
  isPathCompletionOpen,
  isSlashCommandQueryActive,
  movePathCompletionSelection,
  moveSlashCommandSelection,
  normalizePromptImage,
  openModelMenu,
  readClipboardImages,
  rememberComposerDraft,
  renderComposerControls,
  renderComposerImages,
  renderComposerSkillPill,
  renderSendButton,
  renderSlashCommandMenu,
  renderWorkingIndicator,
  requestFileReferenceCompletion,
  requestPathCompletion,
  resetWorkingIndicatorSuppression,
  restorePendingDraftPrompt,
  selectedSlashCommand,
  syncSlashCommandState,
  setComposerPopover,
  setComposerText,
  setThinkingVisibility,
  setToolVisibility,
  slashCommandAction,
  submitBuiltinSlashCommand,
  submitPrompt,
  submitPromptOrQueue,
  suppressWorkingIndicatorFinish,
  thinkingVisibilityLabel,
  toggleThinkingVisibility,
  toggleToolVisibility,
  toolVisibilityLabel,
} = composerController

mountLoaderElement($messagesWorkingSpinner)
$messagesWorkingSpinner?.addEventListener("loaderfinish", () => {
  renderWorkingIndicator()
})

function sessionNotificationKey(sessionLike = state) {
  return (
    sessionLike?.sessionId ||
    sessionLike?.sessionFile ||
    sessionLike?.id ||
    sessionLike?.path ||
    ""
  )
}

function isPageForeground() {
  return document.visibilityState === "visible" && document.hasFocus()
}

function backgroundCurrentSessionUnreadCount() {
  const key = backgroundCurrentSessionUnreadKey
  const currentKey = sessionNotificationKey(state.loadingSession || state)
  if (!key || !currentKey || key !== currentKey) return 0
  return state.sessions.some(
    (session) => session?.unread && sessionNotificationKey(session) === key
  )
    ? 0
    : 1
}

function clearBackgroundCurrentSessionUnread(sessionLike) {
  const key = sessionLike ? sessionNotificationKey(sessionLike) : ""
  if (key && backgroundCurrentSessionUnreadKey !== key) return false
  if (!key && !backgroundCurrentSessionUnreadKey) return false
  backgroundCurrentSessionUnreadKey = ""
  syncDocumentTitle()
  return true
}

function markBackgroundCurrentSessionUnread(sessionLike = state) {
  if (isPageForeground()) return false
  const key = sessionNotificationKey(sessionLike)
  const currentKey = sessionNotificationKey(state.loadingSession || state)
  if (!key || !currentKey || key !== currentKey) return false
  if (backgroundCurrentSessionUnreadKey === key) return false
  backgroundCurrentSessionUnreadKey = key
  syncDocumentTitle()
  return true
}

function syncBackgroundCurrentSessionUnread() {
  if (isPageForeground()) {
    clearBackgroundCurrentSessionUnread()
  } else {
    syncDocumentTitle()
  }
}

function savePromptDrafts() {
  safeSessionStorageSetItem(
    PROMPT_DRAFTS_STORAGE_KEY,
    JSON.stringify(promptDrafts)
  )
}

function promptDraftKey(sessionLike = state) {
  if (sessionLike?.draft) return `draft:${sessionLike?.cwd || "default"}`
  if (sessionLike?.sessionId) return `session:${sessionLike.sessionId}`
  if (sessionLike?.sessionFile) return `file:${sessionLike.sessionFile}`
  return `draft:${sessionLike?.cwd || "default"}`
}

function getPromptDraft(sessionLike = state) {
  const key = promptDraftKey(sessionLike)
  return Object.prototype.hasOwnProperty.call(promptDrafts, key)
    ? promptDrafts[key]
    : undefined
}

function rememberPromptDraft(sessionLike = state, text = "") {
  const key = promptDraftKey(sessionLike)
  const value = typeof text === "string" ? text : ""
  if (value) {
    promptDrafts[key] = value
  } else {
    delete promptDrafts[key]
  }
  savePromptDrafts()
}

function resolvedThemeMode(theme = state.theme) {
  return resolveThemeMode(theme, systemThemeMedia)
}

function themeModeLabel(theme = state.theme) {
  return getThemeModeLabel(theme, systemThemeMedia)
}

function applyTheme(theme, { persist = true } = {}) {
  applyThemeState(state, theme, {
    systemThemeMedia,
    persist,
    onAfterApply: () => {
      renderSettingsDialog()
    },
  })
}

function setSessionDoneSoundEnabled(enabled, { persist = true } = {}) {
  state.sessionDoneSoundEnabled = Boolean(enabled)
  if (persist) {
    safeLocalStorageSetItem(
      SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
      state.sessionDoneSoundEnabled ? "1" : "0"
    )
  }
  renderSettingsDialog()
  if (state.sessionDoneSoundEnabled) {
    void primeSessionDoneAudio()
  }
}

function desktopNotificationsSupported() {
  return typeof Notification !== "undefined"
}

function sessionDoneDesktopNotificationPermission() {
  return desktopNotificationsSupported()
    ? Notification.permission
    : "unsupported"
}

function removeSessionDoneDesktopNotificationPermissionPrompt() {
  if (!sessionDoneDesktopNotificationPromptInstalled) return
  document.removeEventListener(
    "pointerdown",
    handleSessionDoneDesktopNotificationPermissionInteraction,
    true
  )
  document.removeEventListener(
    "keydown",
    handleSessionDoneDesktopNotificationPermissionInteraction,
    true
  )
  sessionDoneDesktopNotificationPromptInstalled = false
}

async function requestSessionDoneDesktopNotificationPermission() {
  const permission = sessionDoneDesktopNotificationPermission()
  if (permission !== "default") {
    renderSettingsDialog()
    return permission
  }

  try {
    const result = Notification.requestPermission()
    const nextPermission = typeof result === "string" ? result : await result
    renderSettingsDialog()
    return nextPermission || sessionDoneDesktopNotificationPermission()
  } catch (error) {
    console.warn(
      "[pi-web] desktop notification permission request failed",
      error
    )
    renderSettingsDialog()
    return sessionDoneDesktopNotificationPermission()
  }
}

function installSessionDoneDesktopNotificationPermissionPrompt() {
  removeSessionDoneDesktopNotificationPermissionPrompt()
  if (!state.sessionDoneDesktopNotificationsEnabled) return
  if (!desktopNotificationsSupported()) return
  if (sessionDoneDesktopNotificationPromptAttempted) return
  if (sessionDoneDesktopNotificationPermission() !== "default") return
  document.addEventListener(
    "pointerdown",
    handleSessionDoneDesktopNotificationPermissionInteraction,
    true
  )
  document.addEventListener(
    "keydown",
    handleSessionDoneDesktopNotificationPermissionInteraction,
    true
  )
  sessionDoneDesktopNotificationPromptInstalled = true
}

function handleSessionDoneDesktopNotificationPermissionInteraction() {
  removeSessionDoneDesktopNotificationPermissionPrompt()
  if (
    !state.sessionDoneDesktopNotificationsEnabled ||
    sessionDoneDesktopNotificationPromptAttempted
  )
    return
  sessionDoneDesktopNotificationPromptAttempted = true
  void requestSessionDoneDesktopNotificationPermission()
}

function closeSessionDoneDesktopNotification(key) {
  const notification = activeSessionDoneDesktopNotifications.get(key)
  if (!notification) return
  activeSessionDoneDesktopNotifications.delete(key)
  try {
    notification.close()
  } catch {
    // ignore browser notification close failures
  }
}

function closeAllSessionDoneDesktopNotifications() {
  for (const key of activeSessionDoneDesktopNotifications.keys()) {
    closeSessionDoneDesktopNotification(key)
  }
}

function setSessionDoneDesktopNotificationsEnabled(
  enabled,
  { persist = true, requestPermission = false } = {}
) {
  state.sessionDoneDesktopNotificationsEnabled = Boolean(enabled)
  if (persist) {
    safeLocalStorageSetItem(
      SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
      state.sessionDoneDesktopNotificationsEnabled ? "1" : "0"
    )
  }

  renderSettingsDialog()

  if (!state.sessionDoneDesktopNotificationsEnabled) {
    removeSessionDoneDesktopNotificationPermissionPrompt()
    closeAllSessionDoneDesktopNotifications()
    return
  }

  if (requestPermission) {
    sessionDoneDesktopNotificationPromptAttempted = true
    removeSessionDoneDesktopNotificationPermissionPrompt()
    void requestSessionDoneDesktopNotificationPermission().then(
      (permission) => {
        if (permission === "denied") {
          showToast(
            "Allow notifications for this site in Chrome to receive desktop alerts.",
            "info"
          )
        } else if (permission === "unsupported") {
          showToast(
            "Desktop notifications are unavailable in this browser.",
            "error"
          )
        }
      }
    )
    return
  }

  installSessionDoneDesktopNotificationPermissionPrompt()
}

function armSessionDoneNotification(sessionLike = state) {
  const key = sessionNotificationKey(sessionLike)
  if (!key) return
  pendingSessionDoneNotificationKey = key
  if (suppressedSessionDoneNotificationKey === key) {
    suppressedSessionDoneNotificationKey = ""
  }
}

function clearSessionDoneNotification(sessionLike) {
  const key = sessionNotificationKey(sessionLike)
  if (!key || pendingSessionDoneNotificationKey === key) {
    pendingSessionDoneNotificationKey = ""
  }
  if (!key || suppressedSessionDoneNotificationKey === key) {
    suppressedSessionDoneNotificationKey = ""
  }
}

function suppressSessionDoneNotification(sessionLike = state) {
  const key = sessionNotificationKey(sessionLike)
  if (!key) return
  pendingSessionDoneNotificationKey = ""
  suppressedSessionDoneNotificationKey = key
}

function getSessionDoneAudio() {
  if (typeof Audio === "undefined" || !state.sessionDoneSoundEnabled)
    return null
  if (!sessionDoneAudio) {
    sessionDoneAudio = new Audio(SESSION_DONE_SOUND_URL)
    sessionDoneAudio.preload = "auto"
  }
  return sessionDoneAudio
}

async function primeSessionDoneAudio() {
  if (!state.sessionDoneSoundEnabled) return
  const audio = getSessionDoneAudio()
  if (!audio || sessionDoneAudioPrimed) return

  const previousMuted = audio.muted
  const previousVolume = audio.volume
  sessionDoneAudioPrimed = true
  audio.muted = true
  audio.volume = 0

  try {
    await audio.play()
  } catch {
    sessionDoneAudioPrimed = false
  }

  audio.pause()
  audio.currentTime = 0
  audio.muted = previousMuted
  audio.volume = previousVolume
}

function handleSessionDoneAudioInteraction() {
  void primeSessionDoneAudio().finally(() => {
    if (!sessionDoneAudioPrimed) return
    document.removeEventListener(
      "pointerdown",
      handleSessionDoneAudioInteraction,
      true
    )
    document.removeEventListener(
      "keydown",
      handleSessionDoneAudioInteraction,
      true
    )
  })
}

function installSessionDoneAudioPriming() {
  document.addEventListener(
    "pointerdown",
    handleSessionDoneAudioInteraction,
    true
  )
  document.addEventListener("keydown", handleSessionDoneAudioInteraction, true)
}

function playSessionDoneNotificationSound() {
  if (!state.sessionDoneSoundEnabled) return Promise.resolve()
  const audio = getSessionDoneAudio()
  if (!audio) return Promise.resolve()
  audio.pause()
  audio.currentTime = 0
  return audio.play().catch((error) => {
    console.warn("[pi-web] session done sound failed", error)
  })
}

function sessionDoneLabel(sessionLike = state) {
  const title = sessionLike?.sessionName
    ? sessionTitle({
        name: sessionLike.sessionName,
        firstMessage: sessionLike.firstMessage,
      })
    : sessionTitle(sessionLike)
  return title && title !== "New session" ? title : ""
}

async function openSessionFromToast(sessionLike = state) {
  const sessionId = sessionLike?.sessionId || sessionLike?.id || ""
  if (!sessionId) return

  if (sessionId === state.sessionId || sessionId === currentUrlSessionId()) {
    focusPromptField()
    return
  }

  await navigateToSession(sessionId)
}

function showSessionDoneDesktopNotification(sessionLike = state) {
  if (!state.sessionDoneDesktopNotificationsEnabled) return false
  if (sessionDoneDesktopNotificationPermission() !== "granted") return false
  if (document.visibilityState === "visible" && document.hasFocus())
    return false

  const key = sessionNotificationKey(sessionLike)
  if (!key) return false

  closeSessionDoneDesktopNotification(key)

  const label = sessionDoneLabel(sessionLike)
  const sessionId = sessionLike?.sessionId || sessionLike?.id || ""
  const cwdLabel = sessionLike?.cwd ? tildePath(sessionLike.cwd) : ""

  try {
    const notification = new Notification(
      label ? `Session finished: ${label}` : SESSION_DONE_TOAST_MESSAGE,
      {
        body: cwdLabel || "Click to open in pi-web",
        tag: `session-done:${key}`,
        silent: true,
      }
    )

    notification.addEventListener("click", () => {
      closeSessionDoneDesktopNotification(key)
      try {
        window.focus()
      } catch {
        // ignore focus failures
      }
      void (sessionId
        ? openSessionFromToast(sessionLike)
        : Promise.resolve(focusPromptField()))
    })
    notification.addEventListener("close", () => {
      if (activeSessionDoneDesktopNotifications.get(key) === notification) {
        activeSessionDoneDesktopNotifications.delete(key)
      }
    })
    notification.addEventListener("error", () => {
      if (activeSessionDoneDesktopNotifications.get(key) === notification) {
        activeSessionDoneDesktopNotifications.delete(key)
      }
    })
    activeSessionDoneDesktopNotifications.set(key, notification)
    return true
  } catch (error) {
    console.warn("[pi-web] desktop notification failed", error)
    return false
  }
}

function showSessionDoneNotification(
  sessionLike = state,
  { playSound = state.sessionDoneSoundEnabled } = {}
) {
  const label = sessionDoneLabel(sessionLike)
  const sessionId = sessionLike?.sessionId || sessionLike?.id || ""
  showToast(
    label ? `Session finished: ${label}` : SESSION_DONE_TOAST_MESSAGE,
    "info",
    {
      onClick: sessionId ? () => openSessionFromToast(sessionLike) : undefined,
      title: sessionId ? "Open session" : undefined,
    }
  )
  showSessionDoneDesktopNotification(sessionLike)
  if (playSound) {
    void playSessionDoneNotificationSound()
  }
}

function updateSessionDoneSnapshots(
  sessions = state.sessions,
  { notify = true } = {}
) {
  const nextSnapshots = new Map()
  const finishedSessions = []
  const canNotify = notify && sessionDoneSnapshotsReady && !state.replaying

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const key = sessionNotificationKey(session)
    if (!key) continue
    const snapshot = { unread: Boolean(session.unread) }
    const previous = sessionDoneSnapshots.get(key)
    if (canNotify && snapshot.unread && !previous?.unread) {
      finishedSessions.push(session)
    }
    nextSnapshots.set(key, snapshot)
  }

  sessionDoneSnapshots = nextSnapshots
  sessionDoneSnapshotsReady = true

  for (const [index, session] of finishedSessions.entries()) {
    showSessionDoneNotification(session, { playSound: index === 0 })
  }
}

function notifySessionDone(sessionLike = state) {
  if (state.replaying) return false
  const key = sessionNotificationKey(sessionLike)
  if (!key || pendingSessionDoneNotificationKey !== key) return false

  pendingSessionDoneNotificationKey = ""
  const suppressed = suppressedSessionDoneNotificationKey === key
  suppressedSessionDoneNotificationKey = ""
  markBackgroundCurrentSessionUnread(sessionLike)
  if (suppressed) return false

  showSessionDoneNotification(sessionLike)
  return true
}

function currentUrlSessionId() {
  return new URL(window.location.href).searchParams.get("session") || ""
}

function isSessionLoading() {
  return Boolean(state.loadingSession)
}

function loadingDraftSession(sessionLike = state.loadingSession) {
  if (!sessionLike) return null
  return !sessionLike.sessionId && !sessionLike.sessionFile ? sessionLike : null
}

function isBlockingSessionLoading() {
  return Boolean(state.loadingSession) && !loadingDraftSession()
}

function canEditComposerWhileLoading() {
  return Boolean(loadingDraftSession())
}

function composerDraftOwner(sessionLike = state) {
  if (sessionLike === state) {
    return loadingDraftSession() || sessionLike
  }
  return sessionLike
}

function activeSessionSelection() {
  if (state.loadingSession) {
    return {
      sessionId: state.loadingSession.sessionId || "",
      sessionFile: state.loadingSession.sessionFile || "",
    }
  }

  const sessionId = state.sessionId || currentUrlSessionId() || ""
  return {
    sessionId,
    sessionFile: sessionId ? "" : state.sessionFile || "",
  }
}

function sessionSummaryById(sessionId) {
  if (!sessionId) return null
  return state.sessions.find((session) => session.id === sessionId) || null
}

function startSessionLoading(sessionLike = {}) {
  rememberComposerDraft(state)
  state.awaitingFirstTurn = false
  state.pendingDraftFollowUps = []
  state.loadingSession = {
    sessionId: sessionLike?.sessionId || sessionLike?.id || "",
    sessionFile: sessionLike?.sessionFile || sessionLike?.path,
    cwd: sessionLike?.cwd,
    title: sessionLike?.title || "",
    name: sessionLike?.sessionName || sessionLike?.name,
    firstMessage: sessionLike?.firstMessage || "",
    modified: sessionLike?.modified,
  }
  state.followMessages = true
  state.openComposerPopover = null
  state.modelSearch = ""
  state.openSessionMenuPath = null
  state.headerSessionMenuOpen = false
  render()
}

function clearSessionLoading() {
  const wasLoading = Boolean(state.loadingSession)
  state.loadingSession = null
  return wasLoading
}

function setUrlSessionId(sessionId, { replace = false } = {}) {
  const url = new URL(window.location.href)
  if (sessionId) {
    url.searchParams.set("session", sessionId)
  } else {
    url.searchParams.delete("session")
  }
  const method = replace ? "replaceState" : "pushState"
  window.history[method]({}, "", url)
}

function currentSessionScope() {
  const normalizedScope =
    typeof state.sessionScope === "string" ? state.sessionScope.trim() : ""
  return normalizedScope || state.cwd || ""
}

function saveDraftDirectory(directoryPath = currentSessionScope()) {
  safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, directoryPath || "")
}

function setDraftDirectory(directoryPath) {
  state.sessionScope =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  saveDraftDirectory(state.sessionScope || state.cwd || "")
}

function saveSidebarDirectories() {
  safeLocalStorageSetItem(
    SIDEBAR_DIRECTORIES_STORAGE_KEY,
    JSON.stringify(state.sidebarDirectories)
  )
}

function sidebarDirectoryOrder(entries = state.sidebarDirectories) {
  return normalizeStoredDirectoryList(Array.isArray(entries) ? entries : [])
}

function sidebarDirectoryOrderEqual(left = [], right = []) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function sidebarDirectoryOrderingEnabled() {
  return !state.sessionSearch.trim() && state.sidebarDirectories.length > 1
}

function reorderSidebarDirectoriesInState(nextDirectoryOrder) {
  const currentOrder = sidebarDirectoryOrder()
  const normalizedNextOrder = sidebarDirectoryOrder(nextDirectoryOrder)
  if (
    !currentOrder.length ||
    normalizedNextOrder.length !== currentOrder.length
  )
    return false

  const remainingPaths = new Set(currentOrder)
  for (const directoryPath of normalizedNextOrder) {
    if (!remainingPaths.has(directoryPath)) return false
    remainingPaths.delete(directoryPath)
  }

  if (
    remainingPaths.size > 0 ||
    sidebarDirectoryOrderEqual(currentOrder, normalizedNextOrder)
  ) {
    return false
  }

  state.sidebarDirectories = normalizedNextOrder
  return true
}

function saveCollapsedDirectories() {
  const collapsed = Object.fromEntries(
    Object.entries(state.collapsedDirectories || {}).filter(([, value]) =>
      Boolean(value)
    )
  )
  safeLocalStorageSetItem(
    COLLAPSED_DIRECTORIES_STORAGE_KEY,
    JSON.stringify(collapsed)
  )
}

function ensureSidebarDirectoriesInitialized() {
  if (state.sidebarDirectoriesHydrated || !state.cwd) return false
  state.sidebarDirectoriesHydrated = true
  state.sidebarDirectories = normalizeStoredDirectoryList([state.cwd])
  saveSidebarDirectories()
  return true
}

function directoryIsCollapsed(directoryPath) {
  return Boolean(state.collapsedDirectories?.[directoryPath])
}

function addSidebarDirectory(directoryPath, { expand = true } = {}) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return undefined

  state.sidebarDirectoriesHydrated = true
  if (!state.sidebarDirectories.includes(normalizedPath)) {
    state.sidebarDirectories = [normalizedPath, ...state.sidebarDirectories]
    saveSidebarDirectories()
  }

  if (expand && state.collapsedDirectories?.[normalizedPath]) {
    delete state.collapsedDirectories[normalizedPath]
    saveCollapsedDirectories()
  }

  void queueRefreshSidebarSearchIndexes(
    state.directorySessionIndexes,
    state.directorySessionIndexes
  )
  return normalizedPath
}

function removeSidebarDirectory(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return

  state.sidebarDirectoriesHydrated = true
  state.sidebarDirectories = state.sidebarDirectories.filter(
    (entry) => entry !== normalizedPath
  )
  state.sessions = state.sessions.filter(
    (session) => sessionDirectoryPath(session) !== normalizedPath
  )
  delete state.collapsedDirectories[normalizedPath]
  delete state.directorySessionLoadedCounts[normalizedPath]
  delete state.directorySessionTotalCounts[normalizedPath]
  delete state.directorySessionLoading[normalizedPath]
  delete state.directorySessionIndexes[normalizedPath]
  delete state.directorySessionSearchEntries[normalizedPath]
  delete state.directorySessionSearchLoading[normalizedPath]
  delete state.directorySessionSearchRevisions[normalizedPath]
  directorySessionRequestTokens.delete(normalizedPath)
  directorySessionSearchRequestTokens.delete(normalizedPath)
  if (state.openDirectoryMenuPath === normalizedPath) {
    state.openDirectoryMenuPath = null
  }
  saveSidebarDirectories()
  saveCollapsedDirectories()
  updateSessionDoneSnapshots(state.sessions, { notify: false })
  renderSessions()
}

function setDirectoryCollapsed(directoryPath, collapsed) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return

  if (collapsed) {
    state.collapsedDirectories[normalizedPath] = true
  } else {
    delete state.collapsedDirectories[normalizedPath]
  }
  saveCollapsedDirectories()
  renderSessions()
}

function collapseAllDirectories() {
  for (const directoryPath of state.sidebarDirectories) {
    state.collapsedDirectories[directoryPath] = true
  }
  saveCollapsedDirectories()
  renderSessions()
}

function expandAllDirectories() {
  state.collapsedDirectories = {}
  saveCollapsedDirectories()
  renderSessions()
}

function loadMoreDirectorySessions(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath || directorySessionIsLoading(normalizedPath)) return

  const offset = directorySessionLoadedCount(normalizedPath)
  const remainingCount = Math.max(
    0,
    directorySessionTotalCount(normalizedPath) - offset
  )
  if (remainingCount <= 0) return

  void fetchDirectorySessions(normalizedPath, {
    offset,
    limit: Math.min(DIRECTORY_SESSION_LOAD_MORE_COUNT, remainingCount),
    append: true,
  })
}

function loadRecentDirectories() {
  try {
    const parsed = JSON.parse(
      safeLocalStorageGetItem(RECENT_DIRECTORIES_STORAGE_KEY) || "[]"
    )
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === "string" && entry.trim())
      : []
  } catch {
    return []
  }
}

function saveRecentDirectories(directories) {
  safeLocalStorageSetItem(
    RECENT_DIRECTORIES_STORAGE_KEY,
    JSON.stringify(directories.slice(0, RECENT_DIRECTORIES_LIMIT))
  )
}

function rememberRecentDirectory(directoryPath) {
  if (typeof directoryPath !== "string") return
  const normalizedPath = directoryPath.trim()
  if (!normalizedPath) return
  const nextDirectories = [
    normalizedPath,
    ...loadRecentDirectories().filter((entry) => entry !== normalizedPath),
  ]
  saveRecentDirectories(nextDirectories)
}

function withContext(path) {
  const url = new URL(path, window.location.origin)
  url.searchParams.set("context", contextId)
  url.searchParams.set("scope", currentSessionScope())

  if (state.loadingSession) {
    const loadingSessionId = state.loadingSession.sessionId || ""
    if (loadingSessionId) {
      url.searchParams.set("session", loadingSessionId)
    }
    return `${url.pathname}${url.search}`
  }

  const sessionKey = state.sessionKey || ""
  if (sessionKey) {
    url.searchParams.set("sessionKey", sessionKey)
  }

  const sessionId = !state.draft
    ? state.sessionId || currentUrlSessionId() || ""
    : ""
  if (sessionId) {
    url.searchParams.set("session", sessionId)
  }
  return `${url.pathname}${url.search}`
}

async function navigateToSession(
  sessionId,
  { replace = false, loadingSession } = {}
) {
  if (state.pendingDraftPrompt) {
    state.pendingDraftPrompt = null
    state.pendingDraftFollowUps = []
    state.awaitingFirstTurn = false
    renderWorkingIndicator()
    renderSendButton()
  }

  const nextLoadingSession = loadingSession ||
    sessionSummaryById(sessionId) || {
      sessionId,
      name: sessionId ? undefined : "Current session",
      cwd: sessionId ? undefined : state.cwd,
    }

  if (nextLoadingSession?.cwd) {
    setDraftDirectory(nextLoadingSession.cwd)
  }

  setUrlSessionId(sessionId, { replace })
  startSessionLoading(nextLoadingSession)
  connect()
  requestAnimationFrame(() => {
    $prompt?.focus()
  })
}

function defaultNewSessionDirectory() {
  const currentDirectory = typeof state.cwd === "string" ? state.cwd.trim() : ""
  if (currentDirectory) return currentDirectory
  return state.sidebarDirectories[0] || currentSessionScope()
}

async function createNewSessionInDirectory(
  directoryPath = defaultNewSessionDirectory()
) {
  const previousUrlSessionId = currentUrlSessionId()
  if (state.pendingDraftPrompt) {
    state.pendingDraftPrompt = null
    state.pendingDraftFollowUps = []
    state.awaitingFirstTurn = false
    renderWorkingIndicator()
    renderSendButton()
  }
  const normalizedPath =
    addSidebarDirectory(directoryPath, { expand: true }) ||
    directoryPath ||
    state.cwd
  if (normalizedPath) {
    setDraftDirectory(normalizedPath)
  }

  if (isMobileViewport() && isSidebarVisible()) {
    closeSidebar({ focusPrompt: true, immediateFocus: true })
  }

  startSessionLoading({
    name: "Current session",
    cwd: normalizedPath || state.cwd,
  })
  const pendingDraftOwnerKey = promptDraftKey(
    loadingDraftSession() || { cwd: normalizedPath || state.cwd }
  )

  if (shouldRestorePromptFocus()) {
    focusPromptField({ immediate: true })
  }

  try {
    await post(
      "/api/session/new",
      normalizedPath ? { cwd: normalizedPath } : {}
    )
    if (currentUrlSessionId() === previousUrlSessionId) {
      setUrlSessionId("")
    }
    connect()

    if (shouldRestorePromptFocus()) {
      focusPromptField()
    }
  } catch (error) {
    clearSessionLoading()
    restorePendingDraftPrompt(pendingDraftOwnerKey)
    state.pendingDraftFollowUps = []
    state.awaitingFirstTurn = false
    render()
    throw error
  }
}

function renderSidebarDirectoryControls() {
  const hasDirectories = state.sidebarDirectories.length > 0
  const hasExpandedDirectories = state.sidebarDirectories.some(
    (directoryPath) => !directoryIsCollapsed(directoryPath)
  )
  const shouldCollapse = hasExpandedDirectories
  const label = shouldCollapse
    ? "Collapse all directories"
    : "Expand all directories"

  $collapseAllDirectoriesBtn?.toggleAttribute("disabled", !hasDirectories)
  $collapseAllDirectoriesBtn?.setAttribute("aria-label", label)
  $collapseAllDirectoriesBtn?.setAttribute("title", label)
  if ($collapseAllDirectoriesBtn) {
    $collapseAllDirectoriesBtn.innerHTML = shouldCollapse
      ? `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="directory-section-button-icon" aria-hidden="true">
          <path d="m7 20 5-5 5 5"/>
          <path d="m7 4 5 5 5-5"/>
        </svg>
      `
      : `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="directory-section-button-icon" aria-hidden="true">
          <path d="m7 15 5 5 5-5"/>
          <path d="m7 9 5-5 5 5"/>
        </svg>
      `
  }
  $addDirectoryBtn?.setAttribute(
    "aria-expanded",
    state.directoryDialogOpen ? "true" : "false"
  )
}

async function performSessionDeletion(
  sessionPath,
  sessionId,
  { optimistic = true, render = true } = {}
) {
  const normalizedSessionPath = normalizeSessionPath(sessionPath)
  if (
    normalizedSessionPath &&
    pendingSessionDeletionPaths.has(normalizedSessionPath)
  ) {
    return false
  }

  const deletingActiveSession = Boolean(
    normalizedSessionPath &&
    (normalizedSessionPath === state.sessionFile ||
      (sessionId && sessionId === state.sessionId))
  )
  if (deletingActiveSession) {
    suppressWorkingIndicatorFinish()
  }

  let restoreSidebarSession = null
  if (normalizedSessionPath) {
    pendingSessionDeletionPaths.add(normalizedSessionPath)
    if (optimistic) {
      restoreSidebarSession = optimisticallyRemoveSessionFromSidebar(
        normalizedSessionPath,
        sessionId,
        { render }
      )
    }
  }

  try {
    const result = await post("/api/session/delete", {
      path: normalizedSessionPath,
    })
    if (deletingActiveSession) {
      await navigateToSession(result.sessionId || "", { replace: true })
    }
    return true
  } catch (error) {
    restoreSidebarSession?.({ render })
    if (deletingActiveSession) {
      resetWorkingIndicatorSuppression()
      renderWorkingIndicator()
    }
    throw error
  } finally {
    if (normalizedSessionPath) {
      pendingSessionDeletionPaths.delete(normalizedSessionPath)
    }
  }
}

async function deleteSessionByPath(sessionPath, sessionId, fallbackTitle) {
  const normalizedSessionPath = normalizeSessionPath(sessionPath)
  if (
    normalizedSessionPath &&
    pendingSessionDeletionPaths.has(normalizedSessionPath)
  ) {
    return false
  }

  const confirmed = await openConfirmDialog({
    title: "Delete session",
    message: `Delete session "${fallbackTitle}"?`,
    confirmLabel: "Delete",
    confirmVariant: "danger",
  })
  if (!confirmed) return false

  try {
    await performSessionDeletion(normalizedSessionPath, sessionId)
    return true
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "Failed to delete the session.",
      "error"
    )
    return false
  }
}

async function deleteSelectedOrFocusedSidebarSessions() {
  const selectedSessions = selectedSidebarSessionSummaries()
  const fallbackFocusedSession = selectedSessions.length
    ? null
    : focusedSidebarSessionSummary()
  const deleteTargets = selectedSessions.length
    ? selectedSessions
    : fallbackFocusedSession?.path
      ? [fallbackFocusedSession]
      : []
  if (!deleteTargets.length) return false

  const uniqueTargets = []
  const seenKeys = new Set()
  for (const session of deleteTargets) {
    if (!session?.path || pendingSessionDeletionPaths.has(session.path))
      continue
    const key = sessionListItemKey(session)
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)
    uniqueTargets.push(session)
  }
  if (!uniqueTargets.length) return false

  const confirmed = await openConfirmDialog({
    title: uniqueTargets.length === 1 ? "Delete session" : "Delete sessions",
    message:
      uniqueTargets.length === 1
        ? `Delete session "${sessionTitle(uniqueTargets[0])}"?`
        : `Delete ${uniqueTargets.length} selected sessions?`,
    confirmLabel: "Delete",
    confirmVariant: "danger",
  })
  if (!confirmed) return false

  const activeTargets = []
  const backgroundTargets = []
  for (const session of uniqueTargets) {
    if (
      sessionMatchesIdentity(session, {
        sessionPath: state.sessionFile,
        sessionId: state.sessionId,
      })
    ) {
      activeTargets.push(session)
    } else {
      backgroundTargets.push(session)
    }
  }

  const orderedTargets = [...backgroundTargets, ...activeTargets]
  const restoreSidebarSessions = new Map()
  for (const session of orderedTargets) {
    const key = sessionListItemKey(session)
    if (!key) continue
    restoreSidebarSessions.set(
      key,
      optimisticallyRemoveSessionFromSidebar(session.path, session.id, {
        render: false,
      })
    )
  }
  renderSessions()

  let deletedCount = 0
  let firstError = null
  const failedTargets = []

  for (const session of orderedTargets) {
    try {
      const deleted = await performSessionDeletion(session.path, session.id, {
        optimistic: false,
      })
      if (deleted) {
        deletedCount += 1
      }
    } catch (error) {
      failedTargets.push(session)
      if (!firstError) {
        firstError = { session, error }
      }
    }
  }

  if (failedTargets.length) {
    for (const session of failedTargets) {
      const key = sessionListItemKey(session)
      restoreSidebarSessions.get(key)?.({ render: false })
    }
    renderSessions()
  }

  if (!firstError) {
    return deletedCount > 0
  }

  const failedCount = Math.max(
    1,
    failedTargets.length || orderedTargets.length - deletedCount
  )
  const detail =
    firstError.error instanceof Error
      ? firstError.error.message
      : "Failed to delete the selected sessions."
  const message =
    deletedCount > 0
      ? `Deleted ${deletedCount} session${deletedCount === 1 ? "" : "s"}. Failed to delete ${failedCount} more.`
      : failedCount === 1
        ? `Failed to delete "${sessionTitle(firstError.session)}": ${detail}`
        : `Failed to delete ${failedCount} selected sessions. ${detail}`
  showToast(message, "error")
  return deletedCount > 0
}

function activeSessionSlashCommandTarget() {
  if (!state.sessionFile) return null
  return {
    sessionPath: state.sessionFile,
    sessionId: state.sessionId,
    currentName:
      state.sessionName === "Current session" ? "" : state.sessionName || "",
    fallbackTitle: sessionTitle({
      name: state.sessionName,
      firstMessage: state.firstMessage,
    }),
  }
}

async function runRenameSessionSlashCommand(args) {
  const target = activeSessionSlashCommandTarget()
  if (!target) {
    throw new Error("Start the session before renaming it.")
  }

  const nextName = typeof args === "string" ? args.trim() : ""
  if (!nextName) {
    openRenameDialog(target.sessionPath, target.currentName)
    return
  }
  if (nextName === target.currentName) {
    return
  }

  await post("/api/session/rename", {
    path: target.sessionPath,
    name: nextName,
  })
}

async function runDeleteSessionSlashCommand(args) {
  if (typeof args === "string" && args.trim()) {
    throw new Error("/delete does not take any arguments.")
  }

  const target = activeSessionSlashCommandTarget()
  if (!target) {
    throw new Error("Start the session before deleting it.")
  }

  await deleteSessionByPath(
    target.sessionPath,
    target.sessionId,
    target.fallbackTitle
  )
}

async function runForkSessionSlashCommand(args) {
  if (typeof args === "string" && args.trim()) {
    throw new Error("/fork does not take any arguments.")
  }

  await openForkDialog()
}

async function runTreeSessionSlashCommand(args) {
  if (typeof args === "string" && args.trim()) {
    throw new Error("/tree does not take any arguments.")
  }

  await openTreeDialog()
  focusTreeDialogBrowseSelection({ fallbackToInput: true })
}

async function runLocalBuiltinSlashCommand(command, args) {
  switch (command?.name) {
    case "rename":
      await runRenameSessionSlashCommand(args)
      return true
    case "delete":
      await runDeleteSessionSlashCommand(args)
      return true
    case "fork":
      await runForkSessionSlashCommand(args)
      return true
    case "tree":
      await runTreeSessionSlashCommand(args)
      return true
    case "hide-thinking":
      if (typeof args === "string" && args.trim()) {
        throw new Error("/hide-thinking does not take any arguments.")
      }
      await setThinkingVisibility(true)
      return true
    case "show-thinking":
      if (typeof args === "string" && args.trim()) {
        throw new Error("/show-thinking does not take any arguments.")
      }
      await setThinkingVisibility(false)
      return true
    case "hide-tools":
      if (typeof args === "string" && args.trim()) {
        throw new Error("/hide-tools does not take any arguments.")
      }
      setToolVisibility(true)
      return true
    case "show-tools":
      if (typeof args === "string" && args.trim()) {
        throw new Error("/show-tools does not take any arguments.")
      }
      setToolVisibility(false)
      return true
    default:
      return false
  }
}

function splitDisplayPath(value) {
  const raw = typeof value === "string" ? value : ""
  if (!raw) return { leading: "", trailing: "" }

  const trimmed = raw.replace(/[\\/]+$/, "")
  if (!trimmed) {
    return { leading: "", trailing: raw }
  }

  const suffix = raw.slice(trimmed.length)
  const separatorIndex = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\")
  )
  if (separatorIndex < 0 || separatorIndex === trimmed.length - 1) {
    return { leading: "", trailing: `${trimmed}${suffix}` }
  }

  return {
    leading: trimmed.slice(0, separatorIndex + 1),
    trailing: `${trimmed.slice(separatorIndex + 1)}${suffix}`,
  }
}

function buildFadedPathLabelHtml(
  titleParts,
  { containerClass, prefixClass, pathClass, leadingClass, tailClass }
) {
  const label = titleParts?.label || ""
  const prefix = titleParts?.prefix || ""
  const path = titleParts?.path || ""
  if (!path) {
    return `<span class="${containerClass}">${escapeHtml(label)}</span>`
  }

  const prefixHtml = prefix
    ? `<span class="${prefixClass}">${escapeHtml(prefix)}</span>`
    : ""
  const { leading, trailing } = splitDisplayPath(path)
  const leadingHtml = leading
    ? `<span class="${leadingClass}">${escapeHtml(leading)}</span>`
    : ""
  const tailHtml = `<span class="${tailClass}">${escapeHtml(trailing || path)}</span>`
  return `<span class="${containerClass}">${prefixHtml}<span class="${pathClass}">${leadingHtml}${tailHtml}</span></span>`
}

function unreadSessionCount() {
  return (
    state.sessions.reduce(
      (count, session) => count + (session?.unread ? 1 : 0),
      0
    ) + backgroundCurrentSessionUnreadCount()
  )
}

function renderSidebarToggleButton() {
  syncDocumentTitle()
  if (!$sidebarToggleBtn) return
  const unreadCount = unreadSessionCount()
  const visible = isSidebarVisibleForState(state)
  $sidebarToggleBtn.classList.toggle("has-unread", unreadCount > 0)
  $sidebarToggleBtn.setAttribute("aria-expanded", visible ? "true" : "false")
  const actionLabel = visible ? "Close sessions menu" : "Open sessions menu"
  const label =
    unreadCount > 0
      ? `${actionLabel}. ${unreadCount} unread session${unreadCount === 1 ? "" : "s"}.`
      : actionLabel
  $sidebarToggleBtn.setAttribute("aria-label", label)
  $sidebarToggleBtn.title =
    unreadCount > 0
      ? `${unreadCount} unread session${unreadCount === 1 ? "" : "s"}`
      : ""
}

function syncSidebarLayout() {
  syncSidebarLayoutClasses(state, { appShell: $appShell })
  renderSidebarToggleButton()
  renderSidebarBackdrop()
}

function renderSidebarBackdrop() {
  setMounted(
    overlayMounts.sidebarBackdrop,
    isMobileViewport() && state.sidebarDrawerOpenMobile
  )
}

function isSidebarVisible() {
  return isSidebarVisibleForState(state)
}

function focusPromptField({ immediate = false } = {}) {
  const focus = () => {
    if (!shouldRestorePromptFocus()) return
    $prompt?.focus()
    if ($prompt) {
      const caret = $prompt.value.length
      $prompt.setSelectionRange(caret, caret)
    }
  }

  if (immediate) {
    focus()
    return
  }

  requestAnimationFrame(focus)
}

function shouldRestorePromptFocus() {
  return (
    !state.commandPaletteOpen &&
    !state.directoryDialogOpen &&
    !state.statusDialogOpen &&
    !state.shortcutsDialogOpen &&
    !state.settingsDialogOpen &&
    !state.treeDialog &&
    !state.forkDialog &&
    !state.renameDialog &&
    !state.confirmDialog &&
    !state.dialog &&
    !state.openComposerPopover
  )
}

const composerMobileModifierState = {
  ctrl: false,
  alt: false,
}
let pendingComposerMobileInputRestore = null

function renderComposerMobileTerminalBar() {
  if ($composerMobileCtrlBtn) {
    $composerMobileCtrlBtn.classList.toggle(
      "is-active",
      composerMobileModifierState.ctrl
    )
    $composerMobileCtrlBtn.setAttribute(
      "aria-pressed",
      composerMobileModifierState.ctrl ? "true" : "false"
    )
  }
  if ($composerMobileOptionBtn) {
    $composerMobileOptionBtn.classList.toggle(
      "is-active",
      composerMobileModifierState.alt
    )
    $composerMobileOptionBtn.setAttribute(
      "aria-pressed",
      composerMobileModifierState.alt ? "true" : "false"
    )
  }
}

function snapshotComposerPromptState() {
  if (!$prompt) return null
  return {
    value: $prompt.value,
    selectionStart:
      typeof $prompt.selectionStart === "number"
        ? $prompt.selectionStart
        : $prompt.value.length,
    selectionEnd:
      typeof $prompt.selectionEnd === "number"
        ? $prompt.selectionEnd
        : $prompt.value.length,
  }
}

function restoreComposerPromptState(snapshot) {
  if (!$prompt || !snapshot) return
  $prompt.value = typeof snapshot.value === "string" ? snapshot.value : ""
  const selectionStart = Number.isFinite(snapshot.selectionStart)
    ? snapshot.selectionStart
    : $prompt.value.length
  const selectionEnd = Number.isFinite(snapshot.selectionEnd)
    ? snapshot.selectionEnd
    : selectionStart
  $prompt.setSelectionRange(selectionStart, selectionEnd)
}

function clearComposerMobileModifiers() {
  if (!composerMobileModifierState.ctrl && !composerMobileModifierState.alt)
    return
  composerMobileModifierState.ctrl = false
  composerMobileModifierState.alt = false
  renderComposerMobileTerminalBar()
}

function toggleComposerMobileModifier(kind) {
  if (kind === "ctrl") {
    composerMobileModifierState.ctrl = !composerMobileModifierState.ctrl
  } else if (kind === "alt") {
    composerMobileModifierState.alt = !composerMobileModifierState.alt
  }
  pendingComposerMobileInputRestore = composerMobileModifiersActive()
    ? snapshotComposerPromptState()
    : null
  renderComposerMobileTerminalBar()
}

function activeComposerKeyTarget({ preferPrompt = false } = {}) {
  const activeElement = document.activeElement
  if (
    !preferPrompt &&
    activeElement instanceof HTMLElement &&
    !$composerMobileTerminalBar?.contains(activeElement) &&
    activeElement !== document.body
  ) {
    return activeElement
  }
  return $prompt || window
}

function normalizedComposerMobileKeyCode(key) {
  if (typeof key !== "string" || !key) return ""
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`
  if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`
  if (key === " ") return "Space"
  return key
}

function dispatchComposerMobileModifiedKey(
  target,
  { key, code, shiftKey = false, preferPrompt = false } = {}
) {
  const eventTarget = preferPrompt
    ? $prompt || target || window
    : target || activeComposerKeyTarget({ preferPrompt })
  if (preferPrompt && shouldRestorePromptFocus()) {
    focusPromptField({ immediate: true })
  }
  pendingComposerMobileInputRestore = snapshotComposerPromptState()

  const eventInit = {
    key,
    code: code || normalizedComposerMobileKeyCode(key),
    ctrlKey: composerMobileModifierState.ctrl,
    altKey: composerMobileModifierState.alt,
    shiftKey,
    bubbles: true,
    cancelable: true,
  }

  eventTarget.dispatchEvent(new KeyboardEvent("keydown", eventInit))
  eventTarget.dispatchEvent(new KeyboardEvent("keyup", eventInit))
  clearComposerMobileModifiers()
}

function dispatchComposerMobileKey({ key, code, preferPrompt = false } = {}) {
  dispatchComposerMobileModifiedKey(activeComposerKeyTarget({ preferPrompt }), {
    key,
    code,
    preferPrompt,
  })
}

function composerMobileModifiersActive() {
  return composerMobileModifierState.ctrl || composerMobileModifierState.alt
}

function maybeDispatchComposerMobileModifiedKeyboardEvent(event) {
  if (
    !composerMobileModifiersActive() ||
    !event?.isTrusted ||
    event.defaultPrevented ||
    event.isComposing
  ) {
    return false
  }
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return false
  }
  if (
    event.target instanceof Element &&
    $composerMobileTerminalBar?.contains(event.target)
  ) {
    return false
  }
  if (
    !event.key ||
    event.key === "Unidentified" ||
    event.key === "Dead" ||
    event.key === "Process"
  ) {
    return false
  }
  if (
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Meta" ||
    event.key === "Shift"
  ) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  dispatchComposerMobileModifiedKey(event.target, {
    key: event.key,
    code: event.code || normalizedComposerMobileKeyCode(event.key),
    shiftKey: event.shiftKey,
  })
  return true
}

function maybeDispatchComposerMobileModifiedBeforeInput(event) {
  if (
    !composerMobileModifiersActive() ||
    !event?.isTrusted ||
    event.defaultPrevented ||
    event.isComposing
  ) {
    return false
  }
  if (event.target !== $prompt) {
    return false
  }

  let key = ""
  if (event.inputType === "insertLineBreak") {
    key = "Enter"
  } else if (
    event.inputType === "insertText" &&
    typeof event.data === "string" &&
    event.data.length === 1
  ) {
    key = event.data
  } else {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  dispatchComposerMobileModifiedKey($prompt, {
    key,
    code: normalizedComposerMobileKeyCode(key),
    shiftKey: key.length === 1 && key !== key.toLowerCase(),
    preferPrompt: true,
  })
  return true
}

function maybeHandleComposerMobileModifiedInput(event) {
  if (!$prompt || event.target !== $prompt || !event.isTrusted) {
    return false
  }
  if (!pendingComposerMobileInputRestore && !composerMobileModifiersActive()) {
    return false
  }

  const restoreSnapshot = pendingComposerMobileInputRestore
  if (restoreSnapshot) {
    restoreComposerPromptState(restoreSnapshot)
    pendingComposerMobileInputRestore = null
  }

  let dispatched = false
  if (composerMobileModifiersActive()) {
    let key = ""
    if (event.inputType === "insertLineBreak") {
      key = "Enter"
    } else if (
      event.inputType === "insertText" &&
      typeof event.data === "string" &&
      event.data.length === 1
    ) {
      key = event.data
    }
    if (key) {
      dispatchComposerMobileModifiedKey($prompt, {
        key,
        code: normalizedComposerMobileKeyCode(key),
        shiftKey: key.length === 1 && key !== key.toLowerCase(),
        preferPrompt: true,
      })
      dispatched = true
    }
  }

  if (!dispatched) {
    handleComposerInputChange()
  }
  return true
}

function bindComposerMobileTerminalButton(button, handler) {
  if (!button) return
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault()
  })
  button.addEventListener("click", (event) => {
    event.preventDefault()
    handler()
  })
}

function openSidebar() {
  openSidebarForViewport(state)
  syncSidebarLayout()
}

function closeSidebar({ focusPrompt = false, immediateFocus = false } = {}) {
  if (!isSidebarVisible()) return
  closeSidebarForViewport(state)
  syncSidebarLayout()
  if (focusPrompt && shouldRestorePromptFocus()) {
    focusPromptField({ immediate: immediateFocus })
  }
}

function ensureSidebarVisible(callback) {
  if (isSidebarVisible()) {
    callback?.()
    return
  }
  openSidebar()
  if (callback) {
    requestAnimationFrame(callback)
  }
}

function focusSessionSearch() {
  if (!$sessionSearch) return
  state.sessionSearchAutoFocusList = true
  ensureSidebarVisible(() => {
    syncSessionSearchListFocus()
  })
}

function toggleSidebarVisibility({ focusPromptOnClose = false } = {}) {
  if (isSidebarVisible()) {
    closeSidebar({ focusPrompt: focusPromptOnClose })
    return
  }
  openSidebar()
}

function sidebarKeyboardTarget() {
  const activeElement = document.activeElement
  if (!activeElement) return null
  if (
    activeElement === $sidebarToggleBtn ||
    activeElement === $sessionSearch ||
    activeElement === $collapseAllDirectoriesBtn ||
    activeElement === $addDirectoryBtn
  ) {
    return activeElement
  }
  if (!(activeElement instanceof Element)) return null
  if (activeElement.closest(".sidebar")) return activeElement
  return null
}

function clearListNavigationFocus() {
  if (!(listNavigationFocusEl instanceof Element)) {
    listNavigationFocusEl = null
    return
  }
  listNavigationFocusEl.classList.remove("list-navigation-focus")
  listNavigationFocusEl = null
}

function setListNavigationFocus(element) {
  if (!(element instanceof HTMLElement)) return false
  if (listNavigationFocusEl !== element) {
    clearListNavigationFocus()
  }
  listNavigationFocusEl = element
  element.classList.add("list-navigation-focus")
  element.focus()
  return true
}

function filteredListNavigationTarget(input, list, itemSelector) {
  const activeElement = document.activeElement
  if (activeElement === input) return activeElement
  if (!(activeElement instanceof Element) || !list) return null
  const item = activeElement.closest(itemSelector)
  return item && list.contains(item) ? item : null
}

function filteredListButtons(list, itemSelector) {
  if (!list) return []
  return Array.from(list.querySelectorAll(itemSelector))
}

function focusFilteredListResult(input, list, itemSelector, direction = 1) {
  if (!filteredListNavigationTarget(input, list, itemSelector)) return false

  const step = direction < 0 ? -1 : 1
  const buttons = filteredListButtons(list, itemSelector)
  if (!buttons.length) return false

  if (document.activeElement === input) {
    if (step < 0) return false
    return setListNavigationFocus(buttons[0])
  }

  const currentButton =
    document.activeElement instanceof Element
      ? document.activeElement.closest(itemSelector)
      : null
  const currentIndex = currentButton ? buttons.indexOf(currentButton) : -1

  if (currentIndex < 0) {
    return setListNavigationFocus(buttons[step < 0 ? buttons.length - 1 : 0])
  }

  if (step < 0 && currentIndex === 0) {
    clearListNavigationFocus()
    input?.focus()
    input?.select?.()
    return true
  }

  return setListNavigationFocus(
    buttons[Math.max(0, Math.min(buttons.length - 1, currentIndex + step))]
  )
}

function focusListBoundary(list, itemSelector, toEnd = false) {
  if (!list || !(document.activeElement instanceof Element)) return false
  const currentButton = document.activeElement.closest(itemSelector)
  if (!currentButton || !list.contains(currentButton)) return false

  const buttons = filteredListButtons(list, itemSelector)
  if (!buttons.length) return false

  return setListNavigationFocus(buttons[toEnd ? buttons.length - 1 : 0])
}

function focusCommandPaletteResult(direction = 1) {
  return (
    state.commandPaletteOpen &&
    focusFilteredListResult(
      $commandPaletteInput,
      $commandPaletteList,
      ".command-palette-item",
      direction
    )
  )
}

function syncCommandPaletteListFocus() {
  if (!state.commandPaletteOpen || !state.commandPaletteAutoFocusList)
    return false

  state.commandPaletteAutoFocusList = false
  const buttons = filteredListButtons(
    $commandPaletteList,
    ".command-palette-item"
  )
  if (!buttons.length) {
    clearListNavigationFocus()
    $commandPaletteInput?.focus()
    $commandPaletteInput?.select?.()
    return false
  }

  return setListNavigationFocus(buttons[0])
}

function setCommandPaletteQuery(query, { autoFocusList = true } = {}) {
  if (!state.commandPaletteOpen) return false
  state.commandPaletteQuery = query
  state.commandPaletteAutoFocusList = autoFocusList
  renderCommandPalette()
  return true
}

function appendCommandPaletteQuery(text) {
  if (!state.commandPaletteOpen || !text) return false
  return setCommandPaletteQuery(`${state.commandPaletteQuery || ""}${text}`)
}

function deleteCommandPaletteQueryChar() {
  if (!state.commandPaletteOpen || !state.commandPaletteQuery) return false
  return setCommandPaletteQuery(state.commandPaletteQuery.slice(0, -1))
}

function focusDirectoryDialogResult(direction = 1) {
  return (
    state.directoryDialogOpen &&
    focusFilteredListResult(
      $openDirectoryInput,
      $openDirectoryList,
      ".command-palette-item",
      direction
    )
  )
}

function syncDirectoryDialogListFocus() {
  if (!state.directoryDialogOpen || !state.directoryDialogAutoFocusList)
    return false

  state.directoryDialogAutoFocusList = false
  const buttons = filteredListButtons(
    $openDirectoryList,
    ".command-palette-item"
  )
  if (!buttons.length) {
    clearListNavigationFocus()
    $openDirectoryInput?.focus()
    $openDirectoryInput?.select?.()
    return false
  }

  return setListNavigationFocus(buttons[0])
}

function setDirectoryDialogQuery(query, { autoFocusList = true } = {}) {
  if (!state.directoryDialogOpen) return false
  state.directoryDialogQuery = query
  state.directoryDialogAutoFocusList = autoFocusList
  renderDirectoryDialog()
  return true
}

function appendDirectoryDialogQuery(text) {
  if (!state.directoryDialogOpen || !text) return false
  return setDirectoryDialogQuery(`${state.directoryDialogQuery || ""}${text}`)
}

function deleteDirectoryDialogQueryChar() {
  if (!state.directoryDialogOpen || !state.directoryDialogQuery) return false
  return setDirectoryDialogQuery(state.directoryDialogQuery.slice(0, -1))
}

function focusForkDialogResult(direction = 1) {
  return (
    Boolean(state.forkDialog) &&
    focusFilteredListResult(
      $forkDialogInput,
      $forkDialogList,
      ".fork-dialog-item",
      direction
    )
  )
}

function syncForkDialogListFocus() {
  const dialog = state.forkDialog
  if (!dialog?.autoFocusList) return false
  if (dialog.loading || dialog.submittingEntryId) return false

  dialog.autoFocusList = false
  const buttons = filteredListButtons($forkDialogList, ".fork-dialog-item")
  if (!buttons.length) {
    clearListNavigationFocus()
    $forkDialogInput?.focus()
    $forkDialogInput?.select?.()
    return false
  }

  return setListNavigationFocus(buttons[0])
}

function setForkDialogQuery(query, { autoFocusList = true } = {}) {
  if (!state.forkDialog) return false
  state.forkDialog = {
    ...state.forkDialog,
    query,
    autoFocusList,
  }
  renderForkDialog()
  return true
}

function appendForkDialogQuery(text) {
  if (!state.forkDialog || !text) return false
  return setForkDialogQuery(`${state.forkDialog.query || ""}${text}`)
}

function deleteForkDialogQueryChar() {
  if (!state.forkDialog) return false
  const query = state.forkDialog.query || ""
  if (!query) return false
  return setForkDialogQuery(query.slice(0, -1))
}

function treeDialogVisibleItems() {
  if (!$treeDialogList) return []
  return Array.from(
    $treeDialogList.querySelectorAll(".tree-dialog-nav-item")
  ).filter((element) => element.getClientRects().length > 0)
}

function treeDialogNavigationTarget() {
  if (state.treeDialog?.stage !== "browse") return null
  if (document.activeElement === $treeDialogInput) return $treeDialogInput
  if (!(document.activeElement instanceof Element) || !$treeDialogList)
    return null
  const element = document.activeElement.closest(".tree-dialog-nav-item")
  return element && $treeDialogList.contains(element) ? element : null
}

function preferredTreeDialogItem(items = treeDialogVisibleItems()) {
  const preferredIds = [
    state.treeDialog?.focusedEntryId,
    state.treeDialog?.currentLeafId,
  ].filter(Boolean)
  for (const entryId of preferredIds) {
    const match = items.find((element) => element.dataset.entryId === entryId)
    if (match) return match
  }
  return items[0] || null
}

function activeTreeDialogItem() {
  if (document.activeElement instanceof Element) {
    const element = document.activeElement.closest(".tree-dialog-nav-item")
    if (element && $treeDialogList?.contains(element)) {
      return element
    }
  }
  return preferredTreeDialogItem()
}

function focusTreeDialogResult(direction = 1) {
  const navigationTarget = treeDialogNavigationTarget()
  if (!navigationTarget) return false

  const step = direction < 0 ? -1 : 1
  const items = treeDialogVisibleItems()
  if (!items.length) return false

  if (navigationTarget === $treeDialogInput) {
    const preferred = preferredTreeDialogItem(items)
    const fallback = step < 0 ? items[items.length - 1] : items[0]
    const target = preferred || fallback
    target?.scrollIntoView?.({ block: "nearest" })
    return setListNavigationFocus(target)
  }

  const currentItem =
    document.activeElement instanceof Element
      ? document.activeElement.closest(".tree-dialog-nav-item")
      : null
  const currentIndex = currentItem ? items.indexOf(currentItem) : -1
  if (currentIndex < 0) {
    return setListNavigationFocus(preferredTreeDialogItem(items) || items[0])
  }

  return setListNavigationFocus(
    items[Math.max(0, Math.min(items.length - 1, currentIndex + step))]
  )
}

function focusCommandPaletteBoundary(toEnd = false) {
  return (
    state.commandPaletteOpen &&
    focusListBoundary($commandPaletteList, ".command-palette-item", toEnd)
  )
}

function focusDirectoryDialogBoundary(toEnd = false) {
  return (
    state.directoryDialogOpen &&
    focusListBoundary($openDirectoryList, ".command-palette-item", toEnd)
  )
}

function focusForkDialogBoundary(toEnd = false) {
  return (
    Boolean(state.forkDialog) &&
    focusListBoundary($forkDialogList, ".fork-dialog-item", toEnd)
  )
}

function focusTreeDialogBoundary(toEnd = false) {
  const navigationTarget = treeDialogNavigationTarget()
  if (!navigationTarget) return false

  const items = treeDialogVisibleItems()
  if (!items.length) return false
  return setListNavigationFocus(items[toEnd ? items.length - 1 : 0])
}

function toggleTreeDialogNode(open) {
  return toggleTreeDialogBranch(open)
}

function focusTreeDialogBrowseSelection({ fallbackToInput = true } = {}) {
  if (state.treeDialog?.stage !== "browse") return false

  const target = preferredTreeDialogItem()
  if (target instanceof HTMLElement) {
    target.scrollIntoView?.({ block: "nearest" })
    return setListNavigationFocus(target)
  }

  if (!fallbackToInput || !($treeDialogInput instanceof HTMLInputElement)) {
    return false
  }

  clearListNavigationFocus()
  $treeDialogInput.focus()
  const end = $treeDialogInput.value.length
  try {
    $treeDialogInput.setSelectionRange(end, end)
  } catch {
    // ignore unsupported selection operations
  }
  return true
}

function setTreeDialogQuery(query) {
  if (state.treeDialog?.stage !== "browse") return false

  state.treeDialog = {
    ...state.treeDialog,
    query,
    foldedEntryIds: [],
  }
  renderTreeDialog()
  requestAnimationFrame(() => {
    focusTreeDialogBrowseSelection({ fallbackToInput: true })
  })
  return true
}

function appendTreeDialogQuery(text) {
  if (typeof text !== "string" || !text) return false
  return setTreeDialogQuery(`${state.treeDialog?.query || ""}${text}`)
}

function deleteTreeDialogQueryChar() {
  if (state.treeDialog?.stage !== "browse") return false
  const query = state.treeDialog?.query || ""
  if (!query) return false
  return setTreeDialogQuery(query.slice(0, -1))
}

function clearTreeDialogQuery() {
  if (state.treeDialog?.stage !== "browse") return false
  if (!state.treeDialog?.query) return false
  return setTreeDialogQuery("")
}

function focusTreeDialogHalfPage(direction = 1) {
  if (state.treeDialog?.stage !== "browse") return false
  const navigationTarget = treeDialogNavigationTarget()
  if (!navigationTarget) return false

  const scrollContainer = $treeDialogList?.parentElement
  if (!(scrollContainer instanceof HTMLElement)) return false

  const items = treeDialogVisibleItems()
  if (!items.length) return false

  const currentItem = activeTreeDialogItem()
  const currentIndex = currentItem ? items.indexOf(currentItem) : -1
  const containerRect = scrollContainer.getBoundingClientRect()
  const visibleCount = items.filter((item) => {
    const rect = item.getBoundingClientRect()
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom
  }).length
  const step = Math.max(1, Math.floor(Math.max(visibleCount, 1) / 2))
  const startIndex = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = Math.max(
    0,
    Math.min(items.length - 1, startIndex + (direction < 0 ? -step : step))
  )
  const target = items[nextIndex]
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView?.({ block: "center" })
  return setListNavigationFocus(target)
}

function focusTreeDialogPage(direction = 1) {
  if (state.treeDialog?.stage !== "browse") return false
  const navigationTarget = treeDialogNavigationTarget()
  if (!navigationTarget) return false

  const scrollContainer = $treeDialogList?.parentElement
  if (!(scrollContainer instanceof HTMLElement)) return false

  const items = treeDialogVisibleItems()
  if (!items.length) return false
  const containerRect = scrollContainer.getBoundingClientRect()

  let candidate = null
  if (direction < 0) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const rect = items[index].getBoundingClientRect()
      if (rect.bottom <= containerRect.top) {
        candidate = items[index]
        break
      }
    }
  } else {
    for (const item of items) {
      const rect = item.getBoundingClientRect()
      if (rect.top >= containerRect.bottom) {
        candidate = item
        break
      }
    }
  }

  const target =
    candidate || (direction < 0 ? items[0] : items[items.length - 1])
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView?.({ block: direction < 0 ? "end" : "start" })
  return setListNavigationFocus(target)
}

function selectFocusedTreeDialogNode() {
  if (state.treeDialog?.stage !== "browse") return false
  const item = activeTreeDialogItem()
  const entryId = item?.dataset?.entryId
  if (!entryId) return false
  beginTreeDialogSelection(entryId)
  return true
}

function focusModelResult(direction = 1) {
  return (
    state.openComposerPopover === "model" &&
    focusFilteredListResult(
      $modelSearch,
      $modelOptions,
      ".composer-option",
      direction
    )
  )
}

function focusModelBoundary(toEnd = false) {
  return (
    state.openComposerPopover === "model" &&
    focusListBoundary($modelOptions, ".composer-option", toEnd)
  )
}

function focusThinkingResult(direction = 1) {
  if (state.openComposerPopover !== "thinking" || !$thinkingOptions)
    return false

  const step = direction < 0 ? -1 : 1
  const buttons = filteredListButtons($thinkingOptions, ".composer-option")
  if (!buttons.length) return false

  if (document.activeElement === $thinkingTrigger) {
    if (step < 0) return false
    return setListNavigationFocus(buttons[0])
  }

  const currentButton =
    document.activeElement instanceof Element
      ? document.activeElement.closest(".composer-option")
      : null
  if (!currentButton || !$thinkingOptions.contains(currentButton)) return false

  const currentIndex = buttons.indexOf(currentButton)
  if (currentIndex < 0) {
    return setListNavigationFocus(buttons[step < 0 ? buttons.length - 1 : 0])
  }

  if (step < 0 && currentIndex === 0) {
    clearListNavigationFocus()
    $thinkingTrigger?.focus()
    return true
  }

  return setListNavigationFocus(
    buttons[Math.max(0, Math.min(buttons.length - 1, currentIndex + step))]
  )
}

function focusThinkingBoundary(toEnd = false) {
  return (
    state.openComposerPopover === "thinking" &&
    focusListBoundary($thinkingOptions, ".composer-option", toEnd)
  )
}

function sessionListNavigationTarget() {
  const activeElement = document.activeElement
  if (activeElement === $sessionSearch) return activeElement
  if (!(activeElement instanceof Element)) return null
  if (activeElement.closest(".session-item")) return activeElement
  return null
}

function sessionResultButtons() {
  if (!$sessionList) return []
  return Array.from($sessionList.querySelectorAll(".session-item-main"))
}

function syncSessionSearchListFocus() {
  if (!state.sessionSearchAutoFocusList) return false

  state.sessionSearchAutoFocusList = false
  const buttons = sessionResultButtons()
  if (!buttons.length) {
    clearListNavigationFocus()
    $sessionSearch?.focus()
    $sessionSearch?.select?.()
    return false
  }

  return setListNavigationFocus(buttons[0])
}

function setSessionSearchQuery(query, { autoFocusList = true } = {}) {
  state.sessionSearch = query
  state.sessionSearchAutoFocusList = autoFocusList
  if (state.sessionSearch.trim()) {
    void queueRefreshSidebarSearchIndexes(
      state.directorySessionIndexes,
      state.directorySessionIndexes
    )
  }
  renderSessions()
  return true
}

function appendSessionSearchQuery(text) {
  if (!text) return false
  return setSessionSearchQuery(`${state.sessionSearch || ""}${text}`)
}

function deleteSessionSearchQueryChar() {
  if (!state.sessionSearch) return false
  return setSessionSearchQuery(state.sessionSearch.slice(0, -1))
}

function focusSessionResult(direction = 1) {
  if (!sessionListNavigationTarget()) return false

  const step = direction < 0 ? -1 : 1
  ensureSidebarVisible(() => {
    const buttons = sessionResultButtons()
    if (!buttons.length) return

    if (document.activeElement === $sessionSearch) {
      if (step > 0) {
        setListNavigationFocus(buttons[0])
      }
      return
    }

    const currentButton =
      document.activeElement instanceof Element
        ? document.activeElement
            .closest(".session-item")
            ?.querySelector(".session-item-main")
        : null
    const currentIndex = currentButton ? buttons.indexOf(currentButton) : -1

    if (currentIndex < 0) {
      setListNavigationFocus(buttons[step < 0 ? buttons.length - 1 : 0])
      return
    }

    if (step < 0 && currentIndex === 0) {
      clearListNavigationFocus()
      $sessionSearch?.focus()
      $sessionSearch?.select()
      return
    }

    setListNavigationFocus(
      buttons[Math.max(0, Math.min(buttons.length - 1, currentIndex + step))]
    )
  })

  return true
}

function focusSessionBoundary(toEnd = false) {
  if (!(document.activeElement instanceof Element)) return false
  const currentButton = document.activeElement.closest(".session-item-main")
  if (!currentButton || !$sessionList?.contains(currentButton)) return false

  ensureSidebarVisible(() => {
    const buttons = sessionResultButtons()
    if (!buttons.length) return
    setListNavigationFocus(buttons[toEnd ? buttons.length - 1 : 0])
  })

  return true
}

function openSessionMenuRefs() {
  const path =
    typeof state.openSessionMenuPath === "string"
      ? state.openSessionMenuPath.trim()
      : ""
  if (!path) return null
  return (
    sessionListElementCache.sessions.get(sessionListItemKey({ path }))?._refs ||
    null
  )
}

function openDirectoryMenuRefs() {
  const path =
    typeof state.openDirectoryMenuPath === "string"
      ? state.openDirectoryMenuPath.trim()
      : ""
  if (!path) return null
  return sessionListElementCache.directories.get(path)?._refs || null
}

function setSessionMenu(path) {
  state.openSessionMenuPath = state.openSessionMenuPath === path ? null : path
  state.openDirectoryMenuPath = null
  renderSessions()
}

function closeSessionMenu({ render = true } = {}) {
  if (!state.openSessionMenuPath) return
  const refs = openSessionMenuRefs()
  state.openSessionMenuPath = null
  refs?.actions?.classList.remove("is-open")
  refs?.trigger?.setAttribute("aria-expanded", "false")
  refs?.menu?.classList.remove("is-open")
  refs?.menuPortal?.hide()
  if (render) {
    renderSessions()
  }
}

function setDirectoryMenu(path) {
  state.openDirectoryMenuPath =
    state.openDirectoryMenuPath === path ? null : path
  state.openSessionMenuPath = null
  renderSessions()
}

function closeDirectoryMenu({ render = true } = {}) {
  if (!state.openDirectoryMenuPath) return
  const refs = openDirectoryMenuRefs()
  state.openDirectoryMenuPath = null
  refs?.actions?.classList.remove("is-open")
  refs?.trigger?.setAttribute("aria-expanded", "false")
  refs?.menu?.classList.remove("is-open")
  refs?.menuPortal?.hide()
  if (render) {
    renderSessions()
  }
}

function captureSidebarDirectoryAccordionPositions() {
  const positions = new Map()
  if (!$sessionList) return positions

  for (const section of $sessionList.querySelectorAll(
    ".directory-accordion[data-directory-path]"
  )) {
    const directoryPath = section.dataset.directoryPath || ""
    if (!directoryPath) continue
    positions.set(directoryPath, section.getBoundingClientRect().top)
  }

  return positions
}

function animateSidebarDirectoryAccordionPositions(
  previousPositions = new Map()
) {
  if (!$sessionList || previousPositions.size === 0) return

  for (const section of $sessionList.querySelectorAll(
    ".directory-accordion[data-directory-path]"
  )) {
    if (section.classList.contains("is-drag-source")) continue
    const directoryPath = section.dataset.directoryPath || ""
    const previousTop = previousPositions.get(directoryPath)
    if (previousTop == null) continue
    const nextTop = section.getBoundingClientRect().top
    const deltaY = previousTop - nextTop
    if (!deltaY) continue

    section.style.transition = "none"
    section.style.transform = `translateY(${deltaY}px)`
    section.getBoundingClientRect()
    requestAnimationFrame(() => {
      section.style.removeProperty("transition")
      section.style.removeProperty("transform")
    })
  }
}

function destroySidebarDirectoryDragOverlay() {
  sidebarDirectoryDragOverlay?.remove()
  sidebarDirectoryDragOverlay = null
}

function removeSidebarDirectoryDragListeners() {
  window.removeEventListener(
    "pointermove",
    handleSidebarDirectoryDragPointerMove
  )
  window.removeEventListener("pointerup", handleSidebarDirectoryDragPointerUp)
  window.removeEventListener(
    "pointercancel",
    handleSidebarDirectoryDragPointerCancel
  )
  window.removeEventListener("blur", handleSidebarDirectoryDragWindowBlur)
}

function clearSidebarDirectoryDragCandidate({ removeListeners = true } = {}) {
  sidebarDirectoryDragCandidate = null
  if (removeListeners && !sidebarDirectoryDragPath) {
    removeSidebarDirectoryDragListeners()
  }
}

function clearSuppressedSidebarDirectoryToggleClickSoon() {
  if (!suppressSidebarDirectoryToggleClick) return
  setTimeout(() => {
    suppressSidebarDirectoryToggleClick = false
  }, 0)
}

function applySidebarDirectoryDragState() {
  const sections = Array.from(
    $sessionList?.querySelectorAll(
      ".directory-accordion[data-directory-path]"
    ) || []
  )
  const hasDrag = Boolean(sidebarDirectoryDragPath)

  for (const section of sections) {
    const directoryPath = section.dataset.directoryPath || ""
    const isDragSource = hasDrag && directoryPath === sidebarDirectoryDragPath
    section.classList.toggle("is-drag-source", isDragSource)
    section.setAttribute("aria-grabbed", isDragSource ? "true" : "false")
  }

  document.body.classList.toggle("sidebar-directory-drag-active", hasDrag)
}

function clearSidebarDirectoryDragState({
  restoreInitialOrder = false,
  render = true,
} = {}) {
  const currentOrder = sidebarDirectoryOrder()
  const initialOrder = sidebarDirectoryOrder(sidebarDirectoryDragInitialOrder)

  removeSidebarDirectoryDragListeners()
  destroySidebarDirectoryDragOverlay()
  document.body.classList.remove("sidebar-directory-drag-active")

  sidebarDirectoryDragPath = ""
  sidebarDirectoryDragPointerId = null
  sidebarDirectoryDragOffsetX = 0
  sidebarDirectoryDragOffsetY = 0
  sidebarDirectoryDragLastClientX = 0
  sidebarDirectoryDragLastClientY = 0
  sidebarDirectoryDragInitialOrder = []
  clearSidebarDirectoryDragCandidate({ removeListeners: false })

  if (
    restoreInitialOrder &&
    initialOrder.length > 0 &&
    initialOrder.length === currentOrder.length &&
    !sidebarDirectoryOrderEqual(currentOrder, initialOrder)
  ) {
    reorderSidebarDirectoriesInState(initialOrder)
  }

  if (render) {
    renderSessions()
  } else {
    applySidebarDirectoryDragState()
  }
}

function currentSidebarDirectoryDropTarget(clientY) {
  if (!$sessionList || !sidebarDirectoryDragPath) {
    return { beforeDirectoryPath: "" }
  }

  const sections = Array.from(
    $sessionList.querySelectorAll(".directory-accordion[data-directory-path]")
  ).filter(
    (section) =>
      (section.dataset.directoryPath || "") !== sidebarDirectoryDragPath
  )

  for (const section of sections) {
    const rect = section.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    if (clientY < midpoint) {
      return { beforeDirectoryPath: section.dataset.directoryPath || "" }
    }
  }

  return { beforeDirectoryPath: "" }
}

function buildSidebarDirectoryOrder(draggedDirectoryPath, dropTarget = {}) {
  const currentOrder = sidebarDirectoryOrder()
  const normalizedDraggedPath =
    typeof draggedDirectoryPath === "string" ? draggedDirectoryPath.trim() : ""
  if (!normalizedDraggedPath || !currentOrder.includes(normalizedDraggedPath))
    return null

  const normalizedDropTarget = {
    beforeDirectoryPath:
      typeof dropTarget?.beforeDirectoryPath === "string"
        ? dropTarget.beforeDirectoryPath.trim()
        : "",
  }

  const remainingDirectories = currentOrder.filter(
    (directoryPath) => directoryPath !== normalizedDraggedPath
  )
  let insertIndex = remainingDirectories.length
  if (normalizedDropTarget.beforeDirectoryPath) {
    const beforeIndex = remainingDirectories.indexOf(
      normalizedDropTarget.beforeDirectoryPath
    )
    if (beforeIndex !== -1) {
      insertIndex = beforeIndex
    }
  }

  const nextOrder = [...remainingDirectories]
  nextOrder.splice(insertIndex, 0, normalizedDraggedPath)
  return sidebarDirectoryOrderEqual(currentOrder, nextOrder) ? null : nextOrder
}

function maybeAutoScrollSidebarDirectoryList(clientY) {
  if (!$sessionList) return

  const rect = $sessionList.getBoundingClientRect()
  const edgeThreshold = 44
  if (clientY < rect.top + edgeThreshold) {
    const distance = rect.top + edgeThreshold - clientY
    $sessionList.scrollTop -= Math.max(6, Math.ceil(distance / 3))
  } else if (clientY > rect.bottom - edgeThreshold) {
    const distance = clientY - (rect.bottom - edgeThreshold)
    $sessionList.scrollTop += Math.max(6, Math.ceil(distance / 3))
  }
}

function positionSidebarDirectoryDragOverlay(clientX, clientY) {
  if (!sidebarDirectoryDragOverlay) return
  sidebarDirectoryDragLastClientX = clientX
  sidebarDirectoryDragLastClientY = clientY
  sidebarDirectoryDragOverlay.style.left = `${Math.round(clientX - sidebarDirectoryDragOffsetX)}px`
  sidebarDirectoryDragOverlay.style.top = `${Math.round(clientY - sidebarDirectoryDragOffsetY)}px`
}

function updateSidebarDirectoryDrag(clientX, clientY) {
  if (!sidebarDirectoryDragPath) return

  positionSidebarDirectoryDragOverlay(clientX, clientY)
  maybeAutoScrollSidebarDirectoryList(clientY)

  const nextOrder = buildSidebarDirectoryOrder(
    sidebarDirectoryDragPath,
    currentSidebarDirectoryDropTarget(clientY)
  )
  if (!nextOrder) return

  const previousPositions = captureSidebarDirectoryAccordionPositions()
  reorderSidebarDirectoriesInState(nextOrder)
  renderSessions({ previousDirectoryPositions: previousPositions })
}

function finishSidebarDirectoryDrag({ commit = true } = {}) {
  if (!sidebarDirectoryDragPath) return

  const initialOrder = sidebarDirectoryOrder(sidebarDirectoryDragInitialOrder)
  const finalOrder = sidebarDirectoryOrder()
  clearSidebarDirectoryDragState({ restoreInitialOrder: !commit, render: true })

  if (
    !commit ||
    !initialOrder.length ||
    sidebarDirectoryOrderEqual(initialOrder, finalOrder)
  ) {
    return
  }

  saveSidebarDirectories()
}

function handleSidebarDirectoryDragPointerMove(event) {
  if (sidebarDirectoryDragPath) {
    if (event.pointerId !== sidebarDirectoryDragPointerId) return
    event.preventDefault()
    updateSidebarDirectoryDrag(event.clientX, event.clientY)
    return
  }

  const candidate = sidebarDirectoryDragCandidate
  if (!candidate || event.pointerId !== candidate.pointerId) return

  const deltaX = event.clientX - candidate.startClientX
  const deltaY = event.clientY - candidate.startClientY
  if (Math.hypot(deltaX, deltaY) < SIDEBAR_DIRECTORY_DRAG_START_DISTANCE) {
    return
  }

  event.preventDefault()
  suppressSidebarDirectoryToggleClick = true
  clearSidebarDirectoryDragCandidate({ removeListeners: false })
  beginSidebarDirectoryDrag(candidate.directoryPath, candidate.section, {
    pointerId: event.pointerId,
    clientX: candidate.startClientX,
    clientY: candidate.startClientY,
  })

  if (!sidebarDirectoryDragPath) {
    removeSidebarDirectoryDragListeners()
    clearSuppressedSidebarDirectoryToggleClickSoon()
    return
  }

  updateSidebarDirectoryDrag(event.clientX, event.clientY)
}

function handleSidebarDirectoryDragPointerUp(event) {
  if (sidebarDirectoryDragPath) {
    if (event.pointerId !== sidebarDirectoryDragPointerId) return
    event.preventDefault()
    finishSidebarDirectoryDrag({ commit: true })
    clearSuppressedSidebarDirectoryToggleClickSoon()
    return
  }

  if (
    !sidebarDirectoryDragCandidate ||
    event.pointerId !== sidebarDirectoryDragCandidate.pointerId
  )
    return
  clearSidebarDirectoryDragCandidate()
}

function handleSidebarDirectoryDragPointerCancel(event) {
  if (sidebarDirectoryDragPath) {
    if (event.pointerId !== sidebarDirectoryDragPointerId) return
    event.preventDefault()
    finishSidebarDirectoryDrag({ commit: false })
    clearSuppressedSidebarDirectoryToggleClickSoon()
    return
  }

  if (
    !sidebarDirectoryDragCandidate ||
    event.pointerId !== sidebarDirectoryDragCandidate.pointerId
  )
    return
  clearSidebarDirectoryDragCandidate()
}

function handleSidebarDirectoryDragWindowBlur() {
  if (sidebarDirectoryDragPath) {
    finishSidebarDirectoryDrag({ commit: false })
    clearSuppressedSidebarDirectoryToggleClickSoon()
    return
  }

  if (!sidebarDirectoryDragCandidate) return
  clearSidebarDirectoryDragCandidate()
}

function beginSidebarDirectoryDrag(directoryPath, section, event) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  const currentOrder = sidebarDirectoryOrder()
  if (
    !normalizedPath ||
    sidebarDirectoryDragPath ||
    !sidebarDirectoryOrderingEnabled() ||
    currentOrder.length < 2 ||
    !currentOrder.includes(normalizedPath)
  ) {
    return
  }

  clearSidebarDirectoryDragCandidate({ removeListeners: false })
  closeSessionMenu({ render: false })
  closeDirectoryMenu({ render: false })

  const rect = section?.getBoundingClientRect?.()
  if (!rect) return

  sidebarDirectoryDragPath = normalizedPath
  sidebarDirectoryDragPointerId = event.pointerId
  sidebarDirectoryDragInitialOrder = [...currentOrder]
  sidebarDirectoryDragOffsetX = event.clientX - rect.left
  sidebarDirectoryDragOffsetY = event.clientY - rect.top
  sidebarDirectoryDragLastClientX = event.clientX
  sidebarDirectoryDragLastClientY = event.clientY

  const overlay = section.cloneNode(true)
  overlay.classList.remove("menu-open", "is-draggable", "is-drag-source")
  overlay.classList.add("sidebar-directory-drag-overlay")
  overlay.removeAttribute("data-directory-path")
  overlay.setAttribute("aria-hidden", "true")
  overlay.style.width = `${Math.round(rect.width)}px`
  overlay.style.height = `${Math.round(rect.height)}px`
  overlay
    .querySelector(".directory-accordion-actions")
    ?.classList.remove("is-open")

  for (const control of overlay.querySelectorAll("button")) {
    control.disabled = true
    control.tabIndex = -1
  }

  sidebarDirectoryDragOverlay = overlay
  document.body.appendChild(overlay)
  positionSidebarDirectoryDragOverlay(event.clientX, event.clientY)

  applySidebarDirectoryDragState()
  window.addEventListener(
    "pointermove",
    handleSidebarDirectoryDragPointerMove,
    { passive: false }
  )
  window.addEventListener("pointerup", handleSidebarDirectoryDragPointerUp, {
    passive: false,
  })
  window.addEventListener(
    "pointercancel",
    handleSidebarDirectoryDragPointerCancel,
    { passive: false }
  )
  window.addEventListener("blur", handleSidebarDirectoryDragWindowBlur)
}

function toggleHeaderSessionMenu() {
  state.headerSessionMenuOpen = !state.headerSessionMenuOpen
  renderHeaderSessionActions()
}

function closeHeaderSessionMenu() {
  if (!state.headerSessionMenuOpen) return
  state.headerSessionMenuOpen = false
  renderHeaderSessionActions()
}

function renderHeaderSessionActions() {
  if (
    !$headerSessionActions ||
    !$headerSessionMenuTrigger ||
    !$headerSessionMenu
  )
    return

  const sessionLoading = isSessionLoading()
  const hasSession = !sessionLoading && Boolean(state.sessionFile)
  const hasVisibleItems =
    !sessionLoading &&
    Boolean($headerToggleThinkingBtn || $headerToggleToolsBtn || hasSession)
  const currentDirectory = typeof state.cwd === "string" ? state.cwd.trim() : ""
  const newSessionLabel = currentDirectory
    ? `Create a new session in ${currentDirectory}`
    : "Create a new session"

  $headerSessionActions.classList.toggle("hidden", !hasVisibleItems)

  if (!hasVisibleItems) {
    state.headerSessionMenuOpen = false
  }

  if ($headerToggleThinkingBtn) {
    $headerToggleThinkingBtn.textContent = thinkingVisibilityLabel()
  }

  if ($headerToggleToolsBtn) {
    $headerToggleToolsBtn.textContent = toolVisibilityLabel()
  }

  if ($headerNewSessionBtn) {
    $headerNewSessionBtn.title = newSessionLabel
    $headerNewSessionBtn.setAttribute("aria-label", newSessionLabel)
  }

  $headerSessionMenuDivider?.classList.toggle("hidden", !hasSession)
  $headerRenameSessionBtn?.classList.toggle("hidden", !hasSession)
  $headerDeleteSessionBtn?.classList.toggle("hidden", !hasSession)

  const menuOpen = state.headerSessionMenuOpen && hasVisibleItems
  $headerSessionMenuTrigger.setAttribute(
    "aria-expanded",
    menuOpen ? "true" : "false"
  )
  $headerSessionMenu.classList.toggle("is-open", menuOpen)
  if (menuOpen) {
    headerSessionMenuPortal.show($headerSessionMenuTrigger, {
      placement: FLOATING_PLACEMENTS.BOTTOM_START,
    })
  } else {
    headerSessionMenuPortal.hide()
  }
}

function renderContextUsage() {
  if (!$contextUsageIndicator) return
  const usage = state.contextUsage
  if (isSessionLoading() || !usage || !usage.contextWindow) {
    $contextUsageIndicator.classList.add("hidden")
    $contextUsageIndicator.innerHTML = ""
    $contextUsageIndicator.removeAttribute("title")
    return
  }

  const percent =
    typeof usage.percent === "number"
      ? Math.max(0, Math.min(100, usage.percent))
      : 0
  const progress = percent / 100
  const tokens = typeof usage.tokens === "number" ? usage.tokens : null
  const remaining =
    tokens == null ? null : Math.max(0, usage.contextWindow - tokens)
  const stroke =
    percent >= 80
      ? "var(--danger)"
      : percent >= 70
        ? "#f59e0b"
        : "var(--accent)"
  const titleParts = [
    `Context used: ${percent.toFixed(1)}%`,
    tokens == null ? "Used: unknown" : `Used: ${formatNumber(tokens)} tokens`,
    `Window: ${formatNumber(usage.contextWindow)} tokens`,
    remaining == null
      ? "Left: unknown"
      : `Left: ${formatNumber(remaining)} tokens`,
  ]

  $contextUsageIndicator.classList.remove("hidden")
  $contextUsageIndicator.title = titleParts.join("\n")
  $contextUsageIndicator.innerHTML = `
    <svg class="context-usage-ring" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle class="context-usage-track" cx="16" cy="16" r="14"></circle>
      <circle class="context-usage-progress" cx="16" cy="16" r="14" style="stroke:${stroke}; stroke-dasharray:${(progress * 87.96).toFixed(2)} 87.96"></circle>
    </svg>
  `
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatHeaderGitStatusText(gitStatus) {
  if (!gitStatus || typeof gitStatus !== "object") return ""
  const inline =
    typeof gitStatus.inline === "string" ? gitStatus.inline.trim() : ""
  if (inline) return inline
  if (gitStatus.detached) {
    return typeof gitStatus.revision === "string" && gitStatus.revision.trim()
      ? `detached ${gitStatus.revision.trim()}`
      : "detached"
  }
  return typeof gitStatus.branch === "string" ? gitStatus.branch.trim() : ""
}

function currentMainPanelDirectory() {
  const loadingSession = state.loadingSession
  return normalizeDirectoryPath(loadingSession ? loadingSession.cwd : state.cwd)
}

function normalizeMainPanelTab(value) {
  return value === "changes" ? "changes" : "session"
}

function isChangesTabActive() {
  return normalizeMainPanelTab(state.mainPanelTab) === "changes"
}

function renderMeta() {
  syncDocumentTitle()
  $badge.textContent = ""
  $badge.className = `badge ${state.connected ? "online" : "offline"}`
  $badge.setAttribute("aria-label", state.connected ? "online" : "offline")
  $badge.title = state.connected ? "online" : "offline"

  const loadingSession = state.loadingSession
  const title = loadingSession
    ? loadingDraftSession(loadingSession)
      ? sessionTitle(loadingSession)
      : sessionTitleText(loadingSession) !== "New session"
        ? sessionTitle(loadingSession)
        : "Loading session..."
    : sessionTitle({
        name: state.sessionName,
        firstMessage: state.firstMessage,
      })
  const cwd = currentMainPanelDirectory()
  const pills = []

  if (cwd) {
    ensureDirectoryGitStatus(cwd)
    pills.push(renderMetaPathPill(cwd))

    const gitStatus = getDirectoryGitStatus(cwd)
    const gitStatusText = formatHeaderGitStatusText(gitStatus)
    if (gitStatusText) {
      pills.push(
        renderMetaPill(
          "",
          `· ${gitStatusText}`,
          gitStatus?.title || gitStatusText,
          "git-status-inline"
        )
      )
    }
  }

  $sessionMeta.innerHTML = `
    <div class="session-meta-title">${escapeHtml(title)}</div>
    ${pills.length ? `<div class="session-meta-row">${pills.join("")}</div>` : ""}
  `
}

function renderMetaPill(label, value, title, tone = "") {
  const key = label
    ? `<span class="session-meta-key">${escapeHtml(label)}</span>`
    : ""
  return `<span class="session-meta-pill${tone ? ` ${tone}` : ""}"${title ? ` title="${escapeAttribute(title)}"` : ""}>${key}<span class="session-meta-value">${escapeHtml(value)}</span></span>`
}

function renderMetaPathPill(value) {
  const displayValue = tildePath(value)
  const hasTildePrefix = displayValue === "~" || displayValue.startsWith("~/")
  const prefix = hasTildePrefix ? (displayValue === "~" ? "~" : "~/") : ""
  const remainder = prefix ? displayValue.slice(prefix.length) : displayValue
  const prefixMarkup = prefix
    ? `<span class="session-meta-prefix">${escapeHtml(prefix)}</span>`
    : ""
  const valueMarkup =
    remainder || !prefix
      ? `<span class="session-meta-value">${escapeHtml(remainder || displayValue)}</span>`
      : ""
  return `<span class="session-meta-pill path-only"${value ? ` title="${escapeAttribute(value)}"` : ""}>${prefixMarkup}${valueMarkup}</span>`
}

function tildePath(value) {
  if (typeof value !== "string") return ""
  return value.replace(/^\/Users\/Ali(?=\/|$)/, "~")
}

const { connect, get, post } = createTransport({
  state,
  withContext,
  renderMeta,
  handleEvent,
})

function normalizeDirectoryPath(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeGitChangeEntry(entry) {
  if (!entry || typeof entry !== "object") return null
  const path = typeof entry.path === "string" ? entry.path.trim() : ""
  if (!path) return null
  const status =
    typeof entry.status === "string"
      ? entry.status.slice(0, 2).padEnd(2, " ")
      : "  "
  const previousPath =
    typeof entry.previousPath === "string" && entry.previousPath.trim()
      ? entry.previousPath.trim()
      : undefined
  const parsedLinesAdded = Number.parseInt(entry.linesAdded, 10)
  const parsedLinesDeleted = Number.parseInt(entry.linesDeleted, 10)
  return {
    status,
    path,
    previousPath,
    linesAdded: Number.isFinite(parsedLinesAdded)
      ? parsedLinesAdded
      : undefined,
    linesDeleted: Number.isFinite(parsedLinesDeleted)
      ? parsedLinesDeleted
      : undefined,
  }
}

function normalizeGitLocalBranchEntry(entry) {
  if (!entry || typeof entry !== "object") return null
  const name = typeof entry.name === "string" ? entry.name.trim() : ""
  if (!name) return null
  const ahead = Number.parseInt(entry.ahead, 10)
  const behind = Number.parseInt(entry.behind, 10)
  return {
    name,
    current: Boolean(entry.current),
    upstream:
      typeof entry.upstream === "string" && entry.upstream.trim()
        ? entry.upstream.trim()
        : undefined,
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    upstreamGone: Boolean(entry.upstreamGone),
    hash:
      typeof entry.hash === "string" && entry.hash.trim()
        ? entry.hash.trim()
        : undefined,
    subject:
      typeof entry.subject === "string" && entry.subject.trim()
        ? entry.subject.trim()
        : undefined,
    relativeDate:
      typeof entry.relativeDate === "string" && entry.relativeDate.trim()
        ? entry.relativeDate.trim()
        : undefined,
  }
}

function normalizeGitRemoteBranchEntry(entry) {
  if (!entry || typeof entry !== "object") return null
  const name = typeof entry.name === "string" ? entry.name.trim() : ""
  if (!name) return null
  return {
    name,
    hash:
      typeof entry.hash === "string" && entry.hash.trim()
        ? entry.hash.trim()
        : undefined,
    subject:
      typeof entry.subject === "string" && entry.subject.trim()
        ? entry.subject.trim()
        : undefined,
    relativeDate:
      typeof entry.relativeDate === "string" && entry.relativeDate.trim()
        ? entry.relativeDate.trim()
        : undefined,
  }
}

function normalizeGitDirectoryChanges(value) {
  if (value == null) return null
  if (
    value.files === null &&
    value.localBranches === null &&
    value.remoteBranches === null &&
    value.commits === null
  ) {
    return null
  }
  return {
    files: Array.isArray(value.files)
      ? value.files
          .map((entry) => normalizeGitChangeEntry(entry))
          .filter(Boolean)
      : [],
    localBranches: Array.isArray(value.localBranches)
      ? value.localBranches
          .map((entry) => normalizeGitLocalBranchEntry(entry))
          .filter(Boolean)
      : [],
    remoteBranches: Array.isArray(value.remoteBranches)
      ? value.remoteBranches
          .map((entry) => normalizeGitRemoteBranchEntry(entry))
          .filter(Boolean)
      : [],
    commits: Array.isArray(value.commits)
      ? value.commits.filter(
          (entry) => typeof entry === "string" && entry.length > 0
        )
      : [],
    unpushedCommitShortHashes: Array.isArray(value.unpushedCommitShortHashes)
      ? value.unpushedCommitShortHashes
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      : [],
  }
}

function gitDirectoryFiles(value) {
  return Array.isArray(value?.files) ? value.files : []
}

function gitDirectoryLocalBranches(value) {
  return Array.isArray(value?.localBranches) ? value.localBranches : []
}

function gitDirectoryRemoteBranches(value) {
  return Array.isArray(value?.remoteBranches) ? value.remoteBranches : []
}

function gitDirectoryCommits(value) {
  return Array.isArray(value?.commits) ? value.commits : []
}

function normalizeGitBranchesTab(value) {
  return value === "remote" ? "remote" : "local"
}

function activeGitBranchesTab() {
  const nextTab = normalizeGitBranchesTab(state.gitBranchesTab)
  state.gitBranchesTab = nextTab
  return nextTab
}

function setGitBranchesTab(tab) {
  const nextTab = normalizeGitBranchesTab(tab)
  if (state.gitBranchesTab === nextTab) return
  state.gitBranchesTab = nextTab
  renderChangesView()
}

function applyDirectoryGitUpdate(event) {
  const normalizedPath = normalizeDirectoryPath(event?.cwd)
  if (!normalizedPath) return

  state.directoryGitStatus[normalizedPath] = event?.gitStatus ?? null
  state.directoryGitChanges[normalizedPath] = normalizeGitDirectoryChanges({
    files: event?.files,
    localBranches: event?.localBranches,
    remoteBranches: event?.remoteBranches,
    commits: event?.commits,
    unpushedCommitShortHashes: event?.unpushedCommitShortHashes,
  })
  delete state.directoryGitStatusLoading[normalizedPath]
  delete state.directoryGitChangesLoading[normalizedPath]

  if (currentMainPanelDirectory() !== normalizedPath) {
    return
  }

  renderMeta()
  renderMessages()
  renderMainPanelTabs()
}

function getDirectoryGitStatus(directoryPath) {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  if (!normalizedPath) return null
  if (
    !Object.prototype.hasOwnProperty.call(
      state.directoryGitStatus,
      normalizedPath
    )
  ) {
    return undefined
  }
  return state.directoryGitStatus[normalizedPath]
}

async function fetchDirectoryGitStatus(directoryPath, { force = false } = {}) {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  if (!normalizedPath) return null

  if (
    !force &&
    Object.prototype.hasOwnProperty.call(
      state.directoryGitStatus,
      normalizedPath
    )
  ) {
    return state.directoryGitStatus[normalizedPath]
  }

  if (state.directoryGitStatusLoading[normalizedPath]) {
    return getDirectoryGitStatus(normalizedPath)
  }

  state.directoryGitStatusLoading[normalizedPath] = true
  try {
    const params = new URLSearchParams({ cwd: normalizedPath })
    const result = await get(`/api/git-status?${params.toString()}`)
    state.directoryGitStatus[normalizedPath] = result?.gitStatus ?? null
  } catch {
    state.directoryGitStatus[normalizedPath] = null
  } finally {
    delete state.directoryGitStatusLoading[normalizedPath]
    renderMeta()
    renderMessages()
    renderMainPanelTabs()
  }

  return state.directoryGitStatus[normalizedPath]
}

function ensureDirectoryGitStatus(directoryPath) {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  if (!normalizedPath) return
  if (
    Object.prototype.hasOwnProperty.call(
      state.directoryGitStatus,
      normalizedPath
    ) ||
    state.directoryGitStatusLoading[normalizedPath]
  ) {
    return
  }
  void fetchDirectoryGitStatus(normalizedPath)
}

function getDirectoryGitChanges(directoryPath) {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  if (!normalizedPath) return null
  if (
    !Object.prototype.hasOwnProperty.call(
      state.directoryGitChanges,
      normalizedPath
    )
  ) {
    return undefined
  }
  return state.directoryGitChanges[normalizedPath]
}

async function fetchDirectoryGitChanges(directoryPath, { force = false } = {}) {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  if (!normalizedPath) return null

  if (
    !force &&
    Object.prototype.hasOwnProperty.call(
      state.directoryGitChanges,
      normalizedPath
    )
  ) {
    return state.directoryGitChanges[normalizedPath]
  }

  if (state.directoryGitChangesLoading[normalizedPath]) {
    return getDirectoryGitChanges(normalizedPath)
  }

  state.directoryGitChangesLoading[normalizedPath] = true
  try {
    const params = new URLSearchParams({ cwd: normalizedPath })
    const result = await get(`/api/git-changes?${params.toString()}`)
    state.directoryGitChanges[normalizedPath] = normalizeGitDirectoryChanges({
      files: result?.files,
      localBranches: result?.localBranches,
      remoteBranches: result?.remoteBranches,
      commits: result?.commits,
      unpushedCommitShortHashes: result?.unpushedCommitShortHashes,
    })
  } catch {
    state.directoryGitChanges[normalizedPath] = null
  } finally {
    delete state.directoryGitChangesLoading[normalizedPath]
    renderMainPanelTabs()
  }

  return state.directoryGitChanges[normalizedPath]
}

function ensureDirectoryGitChanges(directoryPath) {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  if (!normalizedPath) return
  if (
    Object.prototype.hasOwnProperty.call(
      state.directoryGitChanges,
      normalizedPath
    ) ||
    state.directoryGitChangesLoading[normalizedPath]
  ) {
    return
  }
  void fetchDirectoryGitChanges(normalizedPath)
}

function isChangesViewNearBottom(threshold = 48) {
  if (!isChangesTabActive() || !$changesView) return true
  return (
    $changesView.scrollHeight -
      $changesView.scrollTop -
      $changesView.clientHeight <
    threshold
  )
}

function gitFileStatusCharacters(status) {
  const normalized =
    typeof status === "string" ? status.slice(0, 2).padEnd(2, " ") : "  "
  return [normalized[0], normalized[1]]
}

function gitFileStatusTone(column, character) {
  if (character === " ") return "muted"
  if (character === "?") return "untracked"
  if (character === "U" || character === "!") return "conflict"
  return column === "index" ? "staged" : "unstaged"
}

function gitFileLineChangeValue(value) {
  return Number.isInteger(value) && value > 0 ? value : 0
}

function gitFileHasLineChanges(file) {
  return (
    gitFileLineChangeValue(file?.linesAdded) > 0 ||
    gitFileLineChangeValue(file?.linesDeleted) > 0
  )
}

function gitFilesSummaryText(files) {
  if (!files.length) return "Working tree clean"

  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0

  for (const file of files) {
    const [indexCharacter, worktreeCharacter] = gitFileStatusCharacters(
      file?.status
    )
    if (indexCharacter === "?" || worktreeCharacter === "?") {
      untrackedCount += 1
      continue
    }
    if (indexCharacter !== " " && indexCharacter !== "!") {
      stagedCount += 1
    }
    if (worktreeCharacter !== " " && worktreeCharacter !== "!") {
      unstagedCount += 1
    }
  }

  const parts = [`${files.length} file${files.length === 1 ? "" : "s"}`]
  if (stagedCount > 0) parts.push(`${stagedCount} staged`)
  if (unstagedCount > 0) parts.push(`${unstagedCount} unstaged`)
  if (untrackedCount > 0) parts.push(`${untrackedCount} untracked`)
  return parts.join(" · ")
}

function gitCommitEntryCount(commits) {
  return commits.reduce(
    (count, line) => count + (line.includes("\t") ? 1 : 0),
    0
  )
}

function gitCommitsSummaryText(directoryPath, commits) {
  const gitStatus = directoryPath ? getDirectoryGitStatus(directoryPath) : null
  const parts = []
  if (gitStatus?.detached) {
    parts.push(`detached ${gitStatus.revision || "HEAD"}`.trim())
  } else if (gitStatus?.branch) {
    parts.push(gitStatus.branch)
  }
  const count = gitCommitEntryCount(commits)
  if (count > 0) {
    parts.push(`${count} commit${count === 1 ? "" : "s"}`)
  }
  return parts.join(" · ")
}

function appendChangesViewNote(container, text) {
  const note = document.createElement("div")
  note.className = "changes-view-note"
  note.textContent = text
  container.append(note)
}

function createChangesViewSection(titleText, metaText = "") {
  const section = document.createElement("section")
  section.className = "changes-view-section"

  const header = document.createElement("div")
  header.className = "changes-view-section-header"

  const title = document.createElement("div")
  title.className = "changes-view-section-title"
  title.textContent = titleText

  header.append(title)
  if (metaText) {
    const meta = document.createElement("div")
    meta.className = "changes-view-section-meta"
    meta.textContent = metaText
    header.append(meta)
  }

  const body = document.createElement("div")
  body.className = "changes-view-section-body"

  section.append(header, body)
  return { section, header, body }
}

function renderGitFilesSection({ directoryPath, gitChanges, loading }) {
  const files = gitDirectoryFiles(gitChanges)
  const { section, body } = createChangesViewSection(
    "Files",
    gitChanges === null ? "" : gitFilesSummaryText(files)
  )

  if (!directoryPath) {
    appendChangesViewNote(body, "No directory selected.")
    return section
  }
  if (loading && typeof gitChanges === "undefined") {
    appendChangesViewNote(body, "Loading files…")
    return section
  }
  if (gitChanges === null) {
    appendChangesViewNote(body, "No git repository detected.")
    return section
  }
  if (!files.length) {
    appendChangesViewNote(body, "Working tree clean.")
    return section
  }

  const list = document.createElement("ul")
  list.className = "git-files-list"

  for (const file of files) {
    const item = document.createElement("li")
    item.className = "git-files-item"
    item.title = file.previousPath
      ? `${file.status} ${file.previousPath} -> ${file.path}`
      : `${file.status} ${file.path}`

    const status = document.createElement("span")
    status.className = "git-files-status"
    const [indexCharacter, worktreeCharacter] = gitFileStatusCharacters(
      file.status
    )
    for (const [column, character] of [
      ["index", indexCharacter],
      ["worktree", worktreeCharacter],
    ]) {
      const part = document.createElement("span")
      part.className = `git-files-status-char is-${gitFileStatusTone(column, character)}`
      part.textContent = character
      status.append(part)
    }

    const path = document.createElement("span")
    path.className = "git-files-path"
    if (file.previousPath) {
      const previous = document.createElement("span")
      previous.className = "git-files-path-previous"
      previous.textContent = file.previousPath

      const arrow = document.createElement("span")
      arrow.className = "git-files-path-arrow"
      arrow.textContent = " → "

      const current = document.createElement("span")
      current.className = "git-files-path-current"
      current.textContent = file.path

      path.append(previous, arrow, current)
    } else {
      path.textContent = file.path
    }

    const diff = document.createElement("span")
    diff.className = "git-files-diff"
    if (gitFileHasLineChanges(file)) {
      const linesAdded = gitFileLineChangeValue(file.linesAdded)
      const linesDeleted = gitFileLineChangeValue(file.linesDeleted)
      if (linesAdded > 0) {
        const added = document.createElement("span")
        added.className = "git-files-diff-added"
        added.textContent = `+${linesAdded}`
        diff.append(added)
      }
      if (linesDeleted > 0) {
        const deleted = document.createElement("span")
        deleted.className = "git-files-diff-deleted"
        deleted.textContent = `-${linesDeleted}`
        diff.append(deleted)
      }
    }

    item.append(status, path, diff)
    list.append(item)
  }

  body.append(list)
  return section
}

function gitLocalBranchTrackText(branch) {
  if (!branch?.upstream) return ""
  if (branch.upstreamGone) return "gone"
  const ahead = Number.isInteger(branch.ahead) ? branch.ahead : 0
  const behind = Number.isInteger(branch.behind) ? branch.behind : 0
  if (ahead > 0 && behind > 0) return `↓${behind} ↑${ahead}`
  if (behind > 0) return `↓${behind}`
  if (ahead > 0) return `↑${ahead}`
  return "synced"
}

function gitLocalBranchesForRender(directoryPath, gitChanges) {
  const branches = gitDirectoryLocalBranches(gitChanges)
  if (branches.length > 0) {
    return branches
  }
  const gitStatus = directoryPath ? getDirectoryGitStatus(directoryPath) : null
  if (!gitStatus?.branch) {
    return []
  }
  return [
    {
      name: gitStatus.branch,
      current: true,
      ahead: gitStatus.ahead || 0,
      behind: gitStatus.behind || 0,
      hash: gitStatus.revision,
      relativeDate: undefined,
      upstreamGone: false,
    },
  ]
}

function gitRemoteBranchParts(name) {
  const value = typeof name === "string" ? name.trim() : ""
  const slashIndex = value.indexOf("/")
  if (slashIndex <= 0) {
    return { remote: "", branch: value }
  }
  return {
    remote: value.slice(0, slashIndex),
    branch: value.slice(slashIndex + 1),
  }
}

function renderGitBranchesSection({ directoryPath, gitChanges, loading }) {
  const currentTab = activeGitBranchesTab()
  const localBranches = gitLocalBranchesForRender(directoryPath, gitChanges)
  const remoteBranches = gitDirectoryRemoteBranches(gitChanges)
  const visibleBranches =
    currentTab === "remote" ? remoteBranches : localBranches
  const countLabel = `${visibleBranches.length} ${currentTab === "remote" ? "remote" : "local"}`
  const { section, header, body } = createChangesViewSection("Branches")

  const controls = document.createElement("div")
  controls.className = "changes-view-section-controls"

  const meta = document.createElement("div")
  meta.className = "changes-view-section-meta"
  meta.textContent = countLabel

  const tabs = document.createElement("div")
  tabs.className = "changes-view-section-tabs"

  for (const [value, labelText] of [
    ["local", "Local"],
    ["remote", "Remote"],
  ]) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `changes-view-section-tab${currentTab === value ? " is-active" : ""}`
    button.textContent = labelText
    button.setAttribute("aria-pressed", currentTab === value ? "true" : "false")
    button.addEventListener("click", () => {
      setGitBranchesTab(value)
    })
    tabs.append(button)
  }

  controls.append(meta, tabs)
  header.append(controls)

  if (!directoryPath) {
    appendChangesViewNote(body, "No directory selected.")
    return section
  }
  if (loading && typeof gitChanges === "undefined") {
    appendChangesViewNote(body, "Loading branches…")
    return section
  }
  if (gitChanges === null) {
    appendChangesViewNote(body, "No git repository detected.")
    return section
  }
  if (!visibleBranches.length) {
    appendChangesViewNote(
      body,
      currentTab === "remote" ? "No remote branches." : "No local branches."
    )
    return section
  }

  const list = document.createElement("ul")
  list.className = "git-branches-list"

  for (const branch of visibleBranches) {
    const item = document.createElement("li")
    item.className = `git-branch-item${branch.current ? " is-current" : ""}`

    const name = document.createElement("span")
    name.className = "git-branch-name"

    if (currentTab === "remote") {
      const parts = gitRemoteBranchParts(branch.name)
      if (parts.remote) {
        const remote = document.createElement("span")
        remote.className = "git-branch-remote"
        remote.textContent = `${parts.remote}/`
        name.append(remote)
      }
      const branchName = document.createElement("span")
      branchName.className = "git-branch-name-primary"
      branchName.textContent = parts.branch || branch.name
      name.append(branchName)
    } else {
      const branchName = document.createElement("span")
      branchName.className = "git-branch-name-primary"
      branchName.textContent = branch.name
      name.append(branchName)
      if (branch.upstream) {
        const upstream = document.createElement("span")
        upstream.className = "git-branch-upstream"
        upstream.textContent = ` ${branch.upstream}`
        name.append(upstream)
      }
    }

    const metaGroup = document.createElement("span")
    metaGroup.className = "git-branch-meta"

    if (branch.hash) {
      const hash = document.createElement("span")
      hash.className = "git-branch-hash"
      hash.textContent = branch.hash
      metaGroup.append(hash)
    }

    if (currentTab === "local") {
      if (branch.current) {
        const current = document.createElement("span")
        current.className = "git-branch-status is-current"
        current.textContent = "current"
        metaGroup.append(current)
      }
      const trackText = gitLocalBranchTrackText(branch)
      if (trackText) {
        const track = document.createElement("span")
        track.className = `git-branch-status${branch.upstreamGone ? " is-gone" : trackText === "synced" ? " is-synced" : " is-diverged"}`
        track.textContent = trackText
        metaGroup.append(track)
      }
    }

    if (branch.relativeDate) {
      const date = document.createElement("span")
      date.className = "git-branch-date"
      date.textContent = branch.relativeDate
      metaGroup.append(date)
    }

    item.title =
      currentTab === "local"
        ? [branch.name, branch.upstream, branch.subject]
            .filter(Boolean)
            .join(" · ")
        : [branch.name, branch.subject].filter(Boolean).join(" · ")
    item.append(name, metaGroup)
    list.append(item)
  }

  body.append(list)
  return section
}

function parseGitCommitGraphLine(line) {
  const text = typeof line === "string" ? line : ""
  if (!text.includes("\t")) {
    return { graph: text, hash: "", subject: "" }
  }

  const [lead = "", ...subjectParts] = text.split("\t")
  const hashMatch = lead.match(/^(.*?)([0-9a-f]{5,40})$/i)
  return {
    graph: hashMatch ? hashMatch[1] : lead,
    hash: hashMatch ? hashMatch[2] : "",
    subject: subjectParts.join("\t").trim(),
  }
}

function renderGitCommitsSection({ directoryPath, gitChanges, loading }) {
  const commits = gitDirectoryCommits(gitChanges)
  const unpushedCommitShortHashSet = new Set(
    Array.isArray(gitChanges?.unpushedCommitShortHashes)
      ? gitChanges.unpushedCommitShortHashes
      : []
  )
  const { section, body } = createChangesViewSection(
    "Commits",
    gitCommitsSummaryText(directoryPath, commits)
  )
  section.classList.add("changes-view-section--commits")
  body.classList.add("changes-view-section-body--commits")

  if (!directoryPath) {
    appendChangesViewNote(body, "No directory selected.")
    return section
  }
  if (loading && typeof gitChanges === "undefined") {
    appendChangesViewNote(body, "Loading commits…")
    return section
  }
  if (gitChanges === null) {
    appendChangesViewNote(body, "No git repository detected.")
    return section
  }
  if (!commits.length) {
    appendChangesViewNote(body, "No commits on this branch yet.")
    return section
  }

  const list = document.createElement("div")
  list.className = "git-commits-list"

  for (const line of commits) {
    const parsed = parseGitCommitGraphLine(line)
    const row = document.createElement("div")
    row.className = `git-commit-row${parsed.hash && unpushedCommitShortHashSet.has(parsed.hash) ? " is-unpushed" : ""}`
    row.title = line.replace(/\t+/g, " ").trim()

    const graph = document.createElement("span")
    graph.className = "git-commit-graph"
    graph.textContent = parsed.graph
    row.append(graph)

    if (parsed.hash) {
      const hash = document.createElement("span")
      hash.className = "git-commit-hash"
      hash.textContent = parsed.hash
      row.append(hash)
    }

    if (parsed.subject) {
      const subject = document.createElement("span")
      subject.className = "git-commit-subject"
      subject.textContent = ` ${parsed.subject}`
      row.append(subject)
    }

    list.append(row)
  }

  body.append(list)
  return section
}

function renderChangesView() {
  if (!$changesView) return

  const active = isChangesTabActive()
  $changesView.classList.toggle("hidden", !active)
  $changesView.classList.toggle("is-active", active)
  $changesView.setAttribute("aria-hidden", active ? "false" : "true")

  if (!active) return

  const directoryPath = currentMainPanelDirectory()
  if (directoryPath !== lastChangesViewDirectory) {
    $changesView.scrollTop = 0
    lastChangesViewDirectory = directoryPath
  }

  if (directoryPath) {
    ensureDirectoryGitStatus(directoryPath)
    ensureDirectoryGitChanges(directoryPath)
  }

  const gitChanges = directoryPath
    ? getDirectoryGitChanges(directoryPath)
    : undefined
  const loading = directoryPath
    ? Boolean(state.directoryGitChangesLoading[directoryPath])
    : false
  const shell = document.createElement("section")
  shell.className = "changes-view-shell"

  shell.append(
    renderGitFilesSection({ directoryPath, gitChanges, loading }),
    renderGitBranchesSection({ directoryPath, gitChanges, loading }),
    renderGitCommitsSection({ directoryPath, gitChanges, loading })
  )

  syncContainerChildren($changesView, [shell])
}

function formatChangesTabLabel(changes) {
  if (changes && typeof changes === "object") {
    const count = gitDirectoryFiles(changes).length
    if (count <= 0) {
      return "Working tree clean"
    }
    return `${count} File${count === 1 ? "" : "s"} Changed`
  }
  return "Git"
}

function renderMainPanelTabs() {
  const activeTab = normalizeMainPanelTab(state.mainPanelTab)
  state.mainPanelTab = activeTab
  const directoryPath = currentMainPanelDirectory()
  if (directoryPath) {
    ensureDirectoryGitChanges(directoryPath)
  }
  const changes = directoryPath
    ? getDirectoryGitChanges(directoryPath)
    : undefined

  if ($mainPanelTabs) {
    $mainPanelTabs.setAttribute("data-active-tab", activeTab)
  }

  if ($mainPanelTabSessionBtn) {
    const active = activeTab === "session"
    $mainPanelTabSessionBtn.classList.toggle("is-active", active)
    $mainPanelTabSessionBtn.setAttribute(
      "aria-pressed",
      active ? "true" : "false"
    )
    $mainPanelTabSessionBtn.textContent = "Session"
  }

  if ($mainPanelTabChangesBtn) {
    const active = activeTab === "changes"
    $mainPanelTabChangesBtn.classList.toggle("is-active", active)
    $mainPanelTabChangesBtn.setAttribute(
      "aria-pressed",
      active ? "true" : "false"
    )
    $mainPanelTabChangesBtn.textContent = formatChangesTabLabel(changes)
  }

  renderChangesView()
  renderScrollToBottomButton()
}

function setMainPanelTab(tab, { forceRefresh = false } = {}) {
  const nextTab = normalizeMainPanelTab(tab)
  const changed = state.mainPanelTab !== nextTab
  state.mainPanelTab = nextTab

  if (nextTab === "changes") {
    const directoryPath = currentMainPanelDirectory()
    if (directoryPath) {
      if (forceRefresh || changed) {
        void fetchDirectoryGitStatus(directoryPath, { force: true })
        void fetchDirectoryGitChanges(directoryPath, { force: true })
      } else {
        ensureDirectoryGitStatus(directoryPath)
        ensureDirectoryGitChanges(directoryPath)
      }
    }
  }

  renderMainPanelTabs()
}

Object.assign(uiServices, {
  addSidebarDirectory,
  baseName,
  buildFadedPathLabelHtml,
  canEditComposerWhileLoading,
  closeCommandPalette,
  closeComposerPopovers,
  closeDirectoryDialog,
  closeDirectoryMenu,
  closeHeaderSessionMenu,
  closeSessionMenu,
  closeSettingsDialog,
  closeStatusDialog,
  composerDraftOwner,
  composerHasSubmittableContent,
  createCanvasLoader,
  createComposerImage,
  createNewSessionInDirectory,
  defaultNewSessionDirectory,
  deleteSessionByPath,
  dirNameOrPath,
  directorySessionLoadedCount,
  ensureDirectoryGitChanges,
  ensureDirectoryGitStatus,
  escapeAttribute,
  escapeHtml,
  fetchDirectorySessions,
  focusPromptField,
  focusSessionSearch,
  formatNumber,
  get,
  getCurrentAssistantItem: () => currentAssistantItem,
  getDirectoryGitChanges,
  getDirectoryGitStatus,
  insertUserItem,
  isBlockingSessionLoading,
  isPendingUserItem,
  isSessionLoading,
  isSidebarVisible,
  isChangesTabActive,
  isChangesViewNearBottom,
  isMobileViewport,
  loadRecentDirectories,
  loadingDraftSession,
  openConfirmDialog,
  openModelMenu,
  post,
  primeSessionDoneAudio,
  promptDraftKey,
  rememberComposerDraft,
  rememberPromptDraft,
  rememberRecentDirectory,
  removeOptimisticUserItem,
  render,
  renderCommandPalette,
  renderComposerImages,
  renderHeaderSessionActions,
  renderMainPanelTabs,
  renderMessages,
  renderScrollToBottomButton,
  renderSendButton,
  renderSessions,
  renderSidebarDirectoryControls,
  renderSlashCommandMenu,
  restoreElementFocus,
  syncCommandPaletteListFocus,
  syncDirectoryDialogListFocus,
  syncForkDialogListFocus,
  runLocalBuiltinSlashCommand,
  setComposerText,
  shouldRestorePromptFocus,
  showToast,
  submitBuiltinSlashCommand,
  suppressSessionDoneNotification,
  syncContainerChildren,
  syncToastContainerOffset,
  themeModeLabel,
  thinkingVisibilityLabel,
  tildePath,
  toggleThinkingVisibility,
  toggleToolVisibility,
  toolVisibilityLabel,
  clearCurrentAssistantItem: () => {
    currentAssistantItem = null
  },
})

function createRequestToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSessionPath(value) {
  return typeof value === "string" ? value.trim() : ""
}

function sessionPathValue(sessionLike = {}) {
  return normalizeSessionPath(
    sessionLike?.path || sessionLike?.sessionFile || ""
  )
}

function sessionIdValue(sessionLike = {}) {
  const value = sessionLike?.id ?? sessionLike?.sessionId ?? ""
  return typeof value === "string" ? value.trim() : ""
}

function sessionMatchesIdentity(
  sessionLike = {},
  { sessionPath = "", sessionId = "" } = {}
) {
  const normalizedPath = normalizeSessionPath(sessionPath)
  const normalizedId = typeof sessionId === "string" ? sessionId.trim() : ""
  if (normalizedPath && sessionPathValue(sessionLike) === normalizedPath)
    return true
  if (normalizedId && sessionIdValue(sessionLike) === normalizedId) return true
  return false
}

function sessionIsOptimisticallyDeleted(sessionLike = {}) {
  const sessionPath = sessionPathValue(sessionLike)
  return Boolean(sessionPath && hiddenDeletedSessionPaths.has(sessionPath))
}

function filterOptimisticallyDeletedSessions(sessions = []) {
  return Array.isArray(sessions)
    ? sessions.filter((session) => !sessionIsOptimisticallyDeleted(session))
    : []
}

function removeMatchingSessions(sessions, identity) {
  const kept = []
  const removed = []
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (sessionMatchesIdentity(session, identity)) {
      removed.push(session)
    } else {
      kept.push(session)
    }
  }
  return { kept, removed }
}

function sessionDirectoryPath(sessionLike = {}) {
  return typeof sessionLike?.cwd === "string" ? sessionLike.cwd.trim() : ""
}

function syncDirectoryLoadedCount(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return
  state.directorySessionLoadedCounts[normalizedPath] = state.sessions.filter(
    (session) => sessionDirectoryPath(session) === normalizedPath
  ).length
}

function adjustDirectorySessionTotalCounts(directoryPath, delta) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath || !Number.isFinite(delta) || delta === 0) return

  const currentTotalCount = directorySessionTotalCount(normalizedPath)
  const nextTotalCount = Math.max(0, currentTotalCount + delta)
  state.directorySessionTotalCounts[normalizedPath] = nextTotalCount

  if (state.directorySessionIndexes?.[normalizedPath]) {
    const currentIndexedTotalCount = Number.isInteger(
      state.directorySessionIndexes[normalizedPath]?.totalCount
    )
      ? state.directorySessionIndexes[normalizedPath].totalCount
      : currentTotalCount
    state.directorySessionIndexes[normalizedPath] = {
      ...state.directorySessionIndexes[normalizedPath],
      totalCount: Math.max(0, currentIndexedTotalCount + delta),
    }
  }
}

function invalidateDirectorySessionRequests(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return
  directorySessionRequestTokens.set(normalizedPath, createRequestToken())
  directorySessionSearchRequestTokens.set(normalizedPath, createRequestToken())
}

function optimisticallyRemoveSessionFromSidebar(
  sessionPath,
  sessionId,
  { render = true } = {}
) {
  const identity = {
    sessionPath: normalizeSessionPath(sessionPath),
    sessionId: typeof sessionId === "string" ? sessionId.trim() : "",
  }
  if (!identity.sessionPath && !identity.sessionId) return null

  if (identity.sessionPath) {
    hiddenDeletedSessionPaths.add(identity.sessionPath)
  }

  const affectedDirectories = new Set()
  const adjustedTotalCountDirectories = new Set()
  const removedSessionsByDirectory = new Map()
  const { kept, removed } = removeMatchingSessions(state.sessions, identity)
  state.sessions = kept

  for (const session of removed) {
    const directoryPath = sessionDirectoryPath(session)
    if (!directoryPath) continue
    const directorySessions =
      removedSessionsByDirectory.get(directoryPath) || []
    directorySessions.push(session)
    removedSessionsByDirectory.set(directoryPath, directorySessions)
    affectedDirectories.add(directoryPath)
  }

  const removedSearchSessionsByDirectory = new Map()
  for (const [directoryPath, sessions] of Object.entries(
    state.directorySessionSearchEntries || {}
  )) {
    const { kept: nextSessions, removed: removedSearchSessions } =
      removeMatchingSessions(sessions, identity)
    if (!removedSearchSessions.length) continue
    state.directorySessionSearchEntries[directoryPath] = nextSessions
    removedSearchSessionsByDirectory.set(directoryPath, removedSearchSessions)
    if (directoryPath) {
      affectedDirectories.add(directoryPath.trim())
    }
  }

  if (
    !affectedDirectories.size &&
    sessionMatchesIdentity(state, identity) &&
    state.cwd
  ) {
    affectedDirectories.add(state.cwd.trim())
  }

  for (const directoryPath of affectedDirectories) {
    invalidateDirectorySessionRequests(directoryPath)
    syncDirectoryLoadedCount(directoryPath)
    if (directorySessionTotalCount(directoryPath) > 0) {
      adjustDirectorySessionTotalCounts(directoryPath, -1)
      adjustedTotalCountDirectories.add(directoryPath)
    }
  }

  if (
    identity.sessionPath &&
    state.openSessionMenuPath === identity.sessionPath
  ) {
    state.openSessionMenuPath = null
  }

  updateSessionDoneSnapshots(state.sessions, { notify: false })
  if (render) {
    renderSessions()
  }

  return ({ render: restoreRender = true } = {}) => {
    if (identity.sessionPath) {
      hiddenDeletedSessionPaths.delete(identity.sessionPath)
    }

    for (const [
      directoryPath,
      removedSearchSessions,
    ] of removedSearchSessionsByDirectory.entries()) {
      const currentSessions = Array.isArray(
        state.directorySessionSearchEntries?.[directoryPath]
      )
        ? state.directorySessionSearchEntries[directoryPath]
        : []
      state.directorySessionSearchEntries[directoryPath] =
        mergeDirectorySessionSummaries(directoryPath, [
          currentSessions,
          removedSearchSessions,
        ])
    }

    for (const [
      directoryPath,
      removedSessions,
    ] of removedSessionsByDirectory.entries()) {
      const currentDirectorySessions = state.sessions.filter(
        (session) => sessionDirectoryPath(session) === directoryPath
      )
      const otherSessions = state.sessions.filter(
        (session) => sessionDirectoryPath(session) !== directoryPath
      )
      state.sessions = [
        ...otherSessions,
        ...mergeDirectorySessionSummaries(directoryPath, [
          currentDirectorySessions,
          removedSessions,
        ]),
      ]
    }

    for (const directoryPath of adjustedTotalCountDirectories) {
      adjustDirectorySessionTotalCounts(directoryPath, 1)
    }
    for (const directoryPath of affectedDirectories) {
      syncDirectoryLoadedCount(directoryPath)
    }

    updateSessionDoneSnapshots(state.sessions, { notify: false })
    if (restoreRender) {
      renderSessions()
    }
  }
}

function directorySessionLoadedCount(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  const count = Number(state.directorySessionLoadedCounts?.[normalizedPath])
  return Number.isInteger(count) && count > 0 ? count : 0
}

function directorySessionTotalCount(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  const count = Number(state.directorySessionTotalCounts?.[normalizedPath])
  if (Number.isInteger(count) && count >= 0) return count
  const indexedCount = Number(
    state.directorySessionIndexes?.[normalizedPath]?.totalCount
  )
  return Number.isInteger(indexedCount) && indexedCount >= 0 ? indexedCount : 0
}

function directorySessionIsLoading(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  return Boolean(
    normalizedPath && state.directorySessionLoading?.[normalizedPath]
  )
}

function setDirectorySessionLoading(directoryPath, loading) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return
  if (loading) {
    state.directorySessionLoading[normalizedPath] = true
  } else {
    delete state.directorySessionLoading[normalizedPath]
  }
}

function directorySearchSessions(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  return filterOptimisticallyDeletedSessions(
    Array.isArray(state.directorySessionSearchEntries?.[normalizedPath])
      ? state.directorySessionSearchEntries[normalizedPath]
      : []
  )
}

function directorySearchRevision(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  return typeof state.directorySessionSearchRevisions?.[normalizedPath] ===
    "string"
    ? state.directorySessionSearchRevisions[normalizedPath]
    : ""
}

function directorySearchIsLoading(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  return Boolean(
    normalizedPath && state.directorySessionSearchLoading?.[normalizedPath]
  )
}

function setDirectorySearchLoading(directoryPath, loading) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return
  if (loading) {
    state.directorySessionSearchLoading[normalizedPath] = true
  } else {
    delete state.directorySessionSearchLoading[normalizedPath]
  }
}

function normalizeDirectorySessionIndexes(rawStates) {
  const indexes = {}
  for (const entry of Array.isArray(rawStates) ? rawStates : []) {
    const directoryPath =
      typeof entry?.path === "string" ? entry.path.trim() : ""
    if (!directoryPath) continue
    indexes[directoryPath] = {
      totalCount:
        Number.isInteger(entry?.totalCount) && entry.totalCount >= 0
          ? entry.totalCount
          : 0,
      revision: typeof entry?.revision === "string" ? entry.revision : "",
    }
  }
  return indexes
}

function directorySessionIndexChanged(previousIndex, nextIndex) {
  const previousTotalCount = Number.isInteger(previousIndex?.totalCount)
    ? previousIndex.totalCount
    : 0
  const nextTotalCount = Number.isInteger(nextIndex?.totalCount)
    ? nextIndex.totalCount
    : 0
  const previousRevision =
    typeof previousIndex?.revision === "string" ? previousIndex.revision : ""
  const nextRevision =
    typeof nextIndex?.revision === "string" ? nextIndex.revision : ""
  return (
    previousTotalCount !== nextTotalCount || previousRevision !== nextRevision
  )
}

function directoryHasCompleteLoadedSessions(directoryPath) {
  const totalCount = directorySessionTotalCount(directoryPath)
  if (totalCount <= 0) return true
  return directorySessionLoadedCount(directoryPath) >= totalCount
}

function directoryHasCurrentSearchIndex(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  const totalCount = directorySessionTotalCount(normalizedPath)
  if (totalCount <= 0) return true
  const expectedRevision =
    typeof state.directorySessionIndexes?.[normalizedPath]?.revision ===
    "string"
      ? state.directorySessionIndexes[normalizedPath].revision
      : ""
  const sessions = directorySearchSessions(normalizedPath)
  if (sessions.length < totalCount) return false
  if (!expectedRevision) return true
  return directorySearchRevision(normalizedPath) === expectedRevision
}

function directorySearchCoverageReady(directoryPath) {
  return (
    directoryHasCompleteLoadedSessions(directoryPath) ||
    directoryHasCurrentSearchIndex(directoryPath)
  )
}

function mergeDirectorySessionSummaries(directoryPath, sessionLists = []) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return []

  const keyedSessions = new Map()
  const unkeyedSessions = []
  const pushSession = (session) => {
    if (
      sessionDirectoryPath(session) !== normalizedPath ||
      sessionIsOptimisticallyDeleted(session)
    )
      return
    const key = sessionListItemKey(session)
    if (!key) {
      unkeyedSessions.push(session)
      return
    }
    const previous = keyedSessions.get(key) || {}
    keyedSessions.set(key, {
      ...previous,
      ...session,
      modified: session?.modified ?? previous?.modified,
    })
  }

  for (const sessions of sessionLists) {
    for (const session of Array.isArray(sessions) ? sessions : []) {
      pushSession(session)
    }
  }

  return [
    ...[...keyedSessions.values()].sort(compareSessionsByModified),
    ...unkeyedSessions,
  ]
}

function setDirectorySessions(
  directoryPath,
  sessions,
  { append = false } = {}
) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return

  const existingDirectorySessions = append
    ? state.sessions.filter(
        (session) => sessionDirectoryPath(session) === normalizedPath
      )
    : []
  const otherSessions = state.sessions.filter(
    (session) => sessionDirectoryPath(session) !== normalizedPath
  )

  state.sessions = filterOptimisticallyDeletedSessions([
    ...otherSessions,
    ...mergeDirectorySessionSummaries(normalizedPath, [
      existingDirectorySessions,
      sessions,
    ]),
  ])
  updateSessionDoneSnapshots(state.sessions)
}

function findExistingSessionSummary(sessionLike = {}) {
  const sessionId = sessionLike?.sessionId || sessionLike?.id || ""
  const sessionFile = sessionLike?.sessionFile || sessionLike?.path || ""
  return (
    state.sessions.find((session) => {
      if (sessionId && session.id === sessionId) return true
      if (sessionFile && session.path === sessionFile) return true
      return false
    }) || null
  )
}

function currentSessionSummary(sessionLike = state) {
  const cwd = typeof sessionLike?.cwd === "string" ? sessionLike.cwd.trim() : ""
  const sessionId = sessionLike?.sessionId || sessionLike?.id || ""
  const sessionFile = sessionLike?.sessionFile || sessionLike?.path || ""
  if (!cwd || (!sessionId && !sessionFile) || sessionLike?.draft) return null

  const existingSummary = findExistingSessionSummary(sessionLike)

  return {
    id: sessionId || undefined,
    path: sessionFile || undefined,
    cwd,
    name: sessionLike?.sessionName || sessionLike?.name,
    title: sessionTitleText(sessionLike),
    modified: sessionLike?.modified || existingSummary?.modified,
    streaming: Boolean(sessionLike?.streaming ?? state.streaming),
    unread: false,
  }
}

function ensureActiveSessionSummaryLoaded(sessionLike = state) {
  const summary = currentSessionSummary(sessionLike)
  if (!summary || !state.sidebarDirectories.includes(summary.cwd)) return
  setDirectorySessions(summary.cwd, [summary], { append: true })
}

function searchableSessionsForDirectory(directoryPath) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return []

  const loadedSessions = state.sessions.filter(
    (session) => sessionDirectoryPath(session) === normalizedPath
  )
  if (directoryHasCompleteLoadedSessions(normalizedPath)) {
    return mergeDirectorySessionSummaries(normalizedPath, [loadedSessions])
  }

  const indexedSessions = directoryHasCurrentSearchIndex(normalizedPath)
    ? directorySearchSessions(normalizedPath)
    : []

  return mergeDirectorySessionSummaries(normalizedPath, [
    indexedSessions,
    loadedSessions,
  ])
}

async function fetchDirectorySessions(
  directoryPath,
  {
    offset = 0,
    limit = INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
    append = false,
    showError = true,
    showLoading = true,
  } = {}
) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return

  const requestToken = createRequestToken()
  directorySessionRequestTokens.set(normalizedPath, requestToken)
  if (showLoading) {
    setDirectorySessionLoading(normalizedPath, true)
    renderSessions()
  }

  try {
    const params = new URLSearchParams({
      directory: normalizedPath,
      offset: String(Math.max(0, offset)),
      limit: String(Math.max(1, limit)),
    })
    const result = await get(`/api/directory-sessions?${params.toString()}`)
    if (directorySessionRequestTokens.get(normalizedPath) !== requestToken)
      return

    if (showLoading) {
      setDirectorySessionLoading(normalizedPath, false)
    }
    state.directorySessionLoadedCounts[normalizedPath] = append
      ? Math.max(
          directorySessionLoadedCount(normalizedPath),
          Math.max(0, offset) +
            (Array.isArray(result.sessions) ? result.sessions.length : 0)
        )
      : Math.max(0, offset) +
        (Array.isArray(result.sessions) ? result.sessions.length : 0)
    state.directorySessionTotalCounts[normalizedPath] = Number.isInteger(
      result.totalCount
    )
      ? Math.max(0, result.totalCount)
      : Array.isArray(result.sessions)
        ? result.sessions.length
        : 0
    setDirectorySessions(
      normalizedPath,
      Array.isArray(result.sessions) ? result.sessions : [],
      { append }
    )
    ensureActiveSessionSummaryLoaded()
    renderSessions()
  } catch (error) {
    if (directorySessionRequestTokens.get(normalizedPath) !== requestToken)
      return
    if (showLoading) {
      setDirectorySessionLoading(normalizedPath, false)
    }
    renderSessions()
    if (showError) {
      showToast(
        error instanceof Error
          ? error.message
          : `Failed to load sessions for ${normalizedPath}.`,
        "error"
      )
    }
  }
}

async function fetchDirectorySessionSearchIndex(
  directoryPath,
  { showLoading = false } = {}
) {
  const normalizedPath =
    typeof directoryPath === "string" ? directoryPath.trim() : ""
  if (!normalizedPath) return

  const requestToken = createRequestToken()
  directorySessionSearchRequestTokens.set(normalizedPath, requestToken)
  setDirectorySearchLoading(normalizedPath, true)
  if (showLoading || state.sessionSearch.trim()) {
    renderSessions()
  }

  try {
    const params = new URLSearchParams({
      directory: normalizedPath,
    })
    const result = await get(
      `/api/directory-sessions-index?${params.toString()}`
    )
    if (
      directorySessionSearchRequestTokens.get(normalizedPath) !== requestToken
    )
      return

    setDirectorySearchLoading(normalizedPath, false)
    state.directorySessionTotalCounts[normalizedPath] = Number.isInteger(
      result.totalCount
    )
      ? Math.max(0, result.totalCount)
      : directorySessionTotalCount(normalizedPath)
    state.directorySessionSearchEntries[normalizedPath] =
      mergeDirectorySessionSummaries(normalizedPath, [
        Array.isArray(result.sessions) ? result.sessions : [],
      ])
    state.directorySessionSearchRevisions[normalizedPath] =
      typeof result.revision === "string"
        ? result.revision
        : typeof state.directorySessionIndexes?.[normalizedPath]?.revision ===
            "string"
          ? state.directorySessionIndexes[normalizedPath].revision
          : ""
    if (state.sessionSearch.trim()) {
      renderSessions()
    }
  } catch {
    if (
      directorySessionSearchRequestTokens.get(normalizedPath) !== requestToken
    )
      return
    setDirectorySearchLoading(normalizedPath, false)
    if (showLoading || state.sessionSearch.trim()) {
      renderSessions()
    }
  }
}

function queueRefreshLoadedSidebarDirectories(
  previousIndexes = state.directorySessionIndexes,
  nextIndexes = state.directorySessionIndexes
) {
  pendingDirectorySessionIndexRefresh = {
    previous: previousIndexes || {},
    next: nextIndexes || {},
  }

  if (refreshLoadedSidebarDirectoriesPromise) {
    refreshLoadedSidebarDirectoriesQueued = true
    return refreshLoadedSidebarDirectoriesPromise
  }

  refreshLoadedSidebarDirectoriesPromise = (async () => {
    do {
      refreshLoadedSidebarDirectoriesQueued = false
      const refreshTarget = pendingDirectorySessionIndexRefresh || {
        previous: {},
        next: state.directorySessionIndexes || {},
      }
      pendingDirectorySessionIndexRefresh = null
      const directories = [
        ...new Set(
          state.sidebarDirectories
            .map((directoryPath) => directoryPath.trim())
            .filter(Boolean)
        ),
      ]
      await Promise.all(
        directories.map((directoryPath) => {
          if (directorySessionIsLoading(directoryPath)) return undefined

          const loadedCount = directorySessionLoadedCount(directoryPath)
          const shouldFetchInitial = loadedCount === 0
          const shouldRefreshLoaded =
            loadedCount > 0 &&
            directorySessionIndexChanged(
              refreshTarget.previous?.[directoryPath],
              refreshTarget.next?.[directoryPath]
            )

          if (!shouldFetchInitial && !shouldRefreshLoaded) {
            return undefined
          }

          return fetchDirectorySessions(directoryPath, {
            offset: 0,
            limit: loadedCount || INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
            append: false,
            showError: false,
            showLoading: shouldFetchInitial,
          })
        })
      )
    } while (refreshLoadedSidebarDirectoriesQueued)
    refreshLoadedSidebarDirectoriesPromise = null
  })()

  return refreshLoadedSidebarDirectoriesPromise
}

function queueRefreshSidebarSearchIndexes(
  previousIndexes = state.directorySessionIndexes,
  nextIndexes = state.directorySessionIndexes
) {
  pendingSidebarSearchIndexRefresh = {
    previous: previousIndexes || {},
    next: nextIndexes || {},
  }

  if (refreshSidebarSearchIndexesPromise) {
    refreshSidebarSearchIndexesQueued = true
    return refreshSidebarSearchIndexesPromise
  }

  refreshSidebarSearchIndexesPromise = (async () => {
    do {
      refreshSidebarSearchIndexesQueued = false
      const refreshTarget = pendingSidebarSearchIndexRefresh || {
        previous: {},
        next: state.directorySessionIndexes || {},
      }
      pendingSidebarSearchIndexRefresh = null
      const directories = [
        ...new Set(
          state.sidebarDirectories
            .map((directoryPath) => directoryPath.trim())
            .filter(Boolean)
        ),
      ]
      await Promise.all(
        directories.map((directoryPath) => {
          const nextIndex = refreshTarget.next?.[directoryPath]
          if (!nextIndex || nextIndex.totalCount <= 0) {
            state.directorySessionSearchEntries[directoryPath] = []
            state.directorySessionSearchRevisions[directoryPath] =
              typeof nextIndex?.revision === "string" ? nextIndex.revision : ""
            delete state.directorySessionSearchLoading[directoryPath]
            return undefined
          }

          if (
            directorySearchIsLoading(directoryPath) ||
            directoryHasCompleteLoadedSessions(directoryPath)
          ) {
            return undefined
          }

          const shouldRefreshSearchIndex =
            !directoryHasCurrentSearchIndex(directoryPath) ||
            directorySessionIndexChanged(
              refreshTarget.previous?.[directoryPath],
              nextIndex
            )

          if (!shouldRefreshSearchIndex) {
            return undefined
          }

          return fetchDirectorySessionSearchIndex(directoryPath, {
            showLoading: Boolean(state.sessionSearch.trim()),
          })
        })
      )
    } while (refreshSidebarSearchIndexesQueued)
    refreshSidebarSearchIndexesPromise = null
  })()

  return refreshSidebarSearchIndexesPromise
}

function isActiveSessionEvent(event) {
  if (!event || event.type === "state_sync" || event.type === "sessions")
    return true
  if (!event.sessionKey || !state.sessionKey) return true
  return event.sessionKey === state.sessionKey
}

function handleEvent(event) {
  if (!isActiveSessionEvent(event)) return
  switch (event.type) {
    case "replay_start":
      state.replaying = true
      break
    case "replay_end":
      state.replaying = false
      break
    case "state_sync":
      handleStateSync(event)
      break
    case "session_meta":
      handleSessionMeta(event)
      break
    case "user_message": {
      const text = typeof event.message === "string" ? event.message : ""
      const images = Array.isArray(event.images)
        ? event.images
            .map((image) => normalizePromptImage(image))
            .filter(Boolean)
        : []
      if (!state.firstMessage && text.trim()) {
        state.firstMessage = text.trim()
      }
      const optimisticItem = acknowledgeOptimisticUserItem({
        text,
        images,
        queued: Boolean(event.queued),
        streamingBehavior: event.streamingBehavior,
      })
      if (!optimisticItem) {
        insertUserItem({
          kind: "user",
          text,
          images,
          queued: Boolean(event.queued),
          streamingBehavior: event.streamingBehavior,
        })
      }
      render()
      break
    }
    case "request_error":
      if (!state.streaming) {
        state.awaitingFirstTurn = false
        renderSendButton()
        renderWorkingIndicator()
      }
      if (!state.replaying) {
        showToast(event.error || "Request failed", "error")
      }
      break
    case "sessions": {
      const previousDirectorySessionIndexes = state.directorySessionIndexes
      state.knownDirectories = Array.isArray(event.directories)
        ? event.directories
        : []
      state.directorySessionIndexes = normalizeDirectorySessionIndexes(
        event.directoryStates
      )
      void queueRefreshLoadedSidebarDirectories(
        previousDirectorySessionIndexes,
        state.directorySessionIndexes
      )
      void queueRefreshSidebarSearchIndexes(
        previousDirectorySessionIndexes,
        state.directorySessionIndexes
      )
      renderSidebarDirectoryControls()
      renderSessions()
      break
    }
    case "git_directory_update":
      applyDirectoryGitUpdate(event)
      break
    case "agent_start":
      state.streaming = true
      state.awaitingFirstTurn = false
      state.hiddenThinkingPreview = undefined
      state.uiState.hiddenThinkingLabel = undefined
      armSessionDoneNotification()
      currentAssistantItem = { kind: "assistant", blocks: [], streaming: true }
      state.items.push(currentAssistantItem)
      render()
      break
    case "message_start":
      if (event.message?.role && event.message.role !== "assistant") {
        break
      }
      state.streaming = true
      state.awaitingFirstTurn = false
      state.uiState.hiddenThinkingLabel = undefined
      if (!currentAssistantItem) {
        currentAssistantItem = {
          kind: "assistant",
          blocks: [],
          streaming: true,
        }
        state.items.push(currentAssistantItem)
      } else if (currentAssistantItem.blocks.length > 0) {
        currentAssistantItem.streaming = false
        currentAssistantItem = {
          kind: "assistant",
          blocks: [],
          streaming: true,
        }
        state.items.push(currentAssistantItem)
      }
      render()
      break
    case "message_update":
      handleMessageUpdate(event.assistantMessageEvent)
      break
    case "tool_execution_update": {
      const partialText = extractToolText(event.partialResult)
      if (partialText) {
        const item = mutateToolBlock(event.toolCallId, (block) => {
          block.output = partialText
        })
        if (item) {
          renderMessageItem(item, { force: true })
        }
      }
      break
    }
    case "tool_execution_end": {
      const finalText = extractToolText(event.result)
      const item = mutateToolBlock(event.toolCallId, (block) => {
        block.running = false
        block.details = event.result?.details
        block.isError = Boolean(event.isError)
        if (finalText) block.output = finalText
        if (block.isError) block.expanded = true
      })
      if (item) {
        renderMessageItem(item, { force: true })
      }
      break
    }
    case "compaction_start":
      state.compacting = true
      state.compactingReason =
        typeof event.reason === "string" && event.reason.trim()
          ? event.reason.trim()
          : undefined
      renderWorkingIndicator()
      break
    case "compaction_end":
      state.compacting = false
      state.compactingReason = undefined
      if (event.result) {
        state.recentCompactionSummaryItem = createCompactionSummaryItem(
          event.result.summary,
          event.result.tokensBefore
        )
        state.recentCompactionSummaryPending = true
      }
      renderWorkingIndicator()
      break
    case "agent_end":
      state.streaming = false
      state.hiddenThinkingPreview = undefined
      state.uiState.hiddenThinkingLabel = undefined
      state.items = state.items.filter((item) => !isPendingUserItem(item))
      if (currentAssistantItem) currentAssistantItem.streaming = false
      currentAssistantItem = null
      flushVisibleText()
      render()
      if (!state.replaying) {
        notifySessionDone()
      }
      break
    case "extension_ui_request":
      if (event.method === "notify") {
        if (!state.replaying) {
          showToast(event.message || "", event.notifyType || "info")
        }
      } else {
        closeCommandPalette({ focusPrompt: false })
        closeDirectoryDialog({ focusPrompt: false })
        closeStatusDialog({ focusPrompt: false })
        closeSettingsDialog({ focusPrompt: false })
        closeForkDialog({ focusPrompt: false, force: true })
        state.dialog = event
        renderDialog()
      }
      break
    case "extension_error":
      if (!state.replaying) {
        showToast(`Extension error: ${event.error || "Unknown error"}`, "error")
      }
      break
    case "auto_session_naming_error":
      console.error("[pi-web] auto session naming failed:", {
        sessionId: event.sessionId,
        cwd: event.cwd,
        promptPreview: event.promptPreview,
        imageCount: event.imageCount,
        heuristicReason: event.heuristicReason,
        refinementReason: event.refinementReason,
      })
      break
    case "ui_status":
      if (event.text == null || event.text === "") {
        delete state.uiState.statuses[event.key]
      } else {
        state.uiState.statuses[event.key] = event.text
      }
      renderStatusDialog()
      if (state.commandPaletteOpen) {
        renderCommandPalette()
      }
      break
    case "ui_title":
      state.uiState.title = event.title
      syncDocumentTitle()
      break
    case "ui_editor_text":
      if (event.mode === "paste") {
        state.uiState.editorText = `${composerDraftValue()}${event.text || ""}`
      } else {
        state.uiState.editorText = event.text || ""
      }
      setComposerText(state.uiState.editorText)
      rememberComposerDraft(state)
      renderSlashCommandMenu()
      break
    case "ui_working_message":
      state.uiState.workingMessage =
        typeof event.message === "string" && event.message.trim()
          ? event.message.trim()
          : undefined
      renderWorkingIndicator()
      break
    case "ui_hidden_thinking_label": {
      const previousLabel = state.uiState.hiddenThinkingLabel
      const previousPreview = state.hiddenThinkingPreview || ""
      state.uiState.hiddenThinkingLabel = event.label
      const summaryLabel = meaningfulHiddenThinkingLabel(event.label)
      if (summaryLabel) {
        const targetBlock =
          findLastThinkingBlockInItem(currentAssistantItem) ||
          findLastThinkingBlockInCurrentResponse()
        if (targetBlock) {
          targetBlock.summaryLabel = summaryLabel
        }
        state.hiddenThinkingPreview = truncateThinkingSummary(summaryLabel)
      } else if (!state.streaming) {
        state.hiddenThinkingPreview = undefined
      }
      if (
        state.hideThinkingBlock &&
        (previousLabel !== state.uiState.hiddenThinkingLabel ||
          previousPreview !== (state.hiddenThinkingPreview || ""))
      ) {
        renderWorkingIndicator()
      }
      break
    }
    case "context_usage": {
      const nextContextUsage = event.contextUsage
      if (sameContextUsage(state.contextUsage, nextContextUsage)) {
        break
      }
      state.contextUsage = nextContextUsage
      renderContextUsage()
      break
    }
    default:
      break
  }
}

function handleSessionMeta(meta) {
  if (!meta || state.loadingSession) return

  if (meta.draft) {
    if (currentUrlSessionId()) {
      setUrlSessionId("", { replace: true })
    }
  } else if (meta.sessionId && meta.sessionId !== currentUrlSessionId()) {
    setUrlSessionId(meta.sessionId, { replace: !currentUrlSessionId() })
  }

  state.sessionId = meta.sessionId
  state.sessionKey = meta.sessionKey || state.sessionKey
  state.sessionName = meta.sessionName
  state.firstMessage =
    typeof meta.firstMessage === "string" ? meta.firstMessage : ""
  state.sessionFile = meta.sessionFile
  state.cwd = meta.cwd
  if (typeof meta.draft === "boolean") {
    state.draft = meta.draft
  }

  if (Array.isArray(meta.pendingUserMessages)) {
    state.items = state.items.filter((item) => !isPendingUserItem(item))
    for (const message of meta.pendingUserMessages) {
      insertUserItem({
        kind: "user",
        pendingId:
          typeof message?.pendingId === "string"
            ? message.pendingId
            : undefined,
        text: typeof message?.text === "string" ? message.text : "",
        images: Array.isArray(message?.images)
          ? message.images
              .map((image) => normalizePromptImage(image))
              .filter(Boolean)
          : [],
        queued: Boolean(message?.queued ?? true),
        streamingBehavior: message?.streamingBehavior,
      })
    }
    renderPendingMessagesTray()
  }

  ensureActiveSessionSummaryLoaded({
    sessionId: meta.sessionId,
    sessionFile: meta.sessionFile,
    cwd: meta.cwd,
    sessionName: meta.sessionName,
    firstMessage: meta.firstMessage,
    modified: meta.modified,
    draft: typeof meta.draft === "boolean" ? meta.draft : state.draft,
    streaming:
      typeof meta.streaming === "boolean" ? meta.streaming : state.streaming,
  })

  renderMeta()
  renderHeaderSessionActions()
}

function handleStateSync(sync) {
  const loadingSessionModified = state.loadingSession?.modified
  const hadLoadingSession = Boolean(state.loadingSession)
  const pendingLoadingDraft = loadingDraftSession()
  const preservingLoadingDraftComposer =
    Boolean(pendingLoadingDraft) &&
    Boolean(sync?.draft) &&
    sync.cwd === pendingLoadingDraft.cwd
  const localPromptOwner = pendingLoadingDraft || composerDraftOwner(state)
  const localPromptText = composerDraftValue()
  const sessionChanged = promptDraftKey(sync) !== promptDraftKey(state)
  const previousStreaming = state.streaming
  const previousHideThinkingBlock = state.hideThinkingBlock
  const previousNonOptimisticItems = state.items.filter(
    (item) => !isOptimisticUserItem(item)
  )
  const nextSyncedItems = buildItemsFromSync(sync)
  const shouldFollowSessionDirectory = !state.sessionScope || sessionChanged
  clearSessionLoading()
  if (sync.draft) {
    if (currentUrlSessionId()) {
      setUrlSessionId("", { replace: true })
    }
  } else if (sync.sessionId && sync.sessionId !== currentUrlSessionId()) {
    setUrlSessionId(sync.sessionId, { replace: !currentUrlSessionId() })
  }
  state.dialog = null
  renderDialog()
  state.openComposerPopover = null
  state.modelSearch = ""
  if (sessionChanged && !preservingLoadingDraftComposer) {
    clearComposerImages()
  }
  rememberPromptDraft(localPromptOwner, localPromptText)
  const previousEditorText = state.uiState.editorText || ""
  const preserveLocalPrompt =
    !sessionChanged && localPromptText !== previousEditorText
  const optimisticItems = state.items.filter((item) =>
    isOptimisticUserItem(item)
  )
  const preservedOptimisticItems = shouldPreserveOptimisticUserItemsOnSync(
    sync,
    sessionChanged,
    optimisticItems
  )
    ? optimisticItems
    : []
  const nextEditorText = sync.uiState?.editorText || ""
  const nextStreaming = Boolean(sync.streaming)

  if (nextStreaming) {
    state.awaitingFirstTurn = false
  }

  state.streaming = nextStreaming
  state.draft = Boolean(sync.draft)
  state.sessionId = sync.sessionId
  state.sessionKey = sync.sessionKey
  state.sessionName = sync.sessionName
  state.firstMessage =
    typeof sync.firstMessage === "string" ? sync.firstMessage : ""
  state.sessionFile = sync.sessionFile
  state.cwd = sync.cwd
  ensureSidebarDirectoriesInitialized()
  if (state.cwd && shouldFollowSessionDirectory) {
    setDraftDirectory(state.cwd)
  }
  state.model = sync.model
  state.hideThinkingBlock = Boolean(sync.hideThinkingBlock)
  state.contextUsage = sync.contextUsage
  state.thinkingLevel = sync.thinkingLevel || "off"
  state.availableThinkingLevels =
    Array.isArray(sync.availableThinkingLevels) &&
    sync.availableThinkingLevels.length
      ? sync.availableThinkingLevels
      : ["off"]
  state.availableModels = Array.isArray(sync.availableModels)
    ? sync.availableModels
    : []
  state.availableSkills = Array.isArray(sync.availableSkills)
    ? sync.availableSkills
    : []
  state.uiState = {
    statuses: { ...sync.uiState?.statuses },
    title: sync.uiState?.title,
    editorText: nextEditorText,
    workingMessage:
      typeof sync.uiState?.workingMessage === "string" &&
      sync.uiState.workingMessage.trim()
        ? sync.uiState.workingMessage.trim()
        : undefined,
    hiddenThinkingLabel: sync.uiState?.hiddenThinkingLabel,
  }
  const keepRecentCompactionSummary = Boolean(
    state.recentCompactionSummaryPending
  )
  state.hiddenThinkingPreview = undefined
  state.compacting = false
  state.compactingReason = undefined
  state.recentCompactionSummaryPending = false
  if (sessionChanged || !keepRecentCompactionSummary) {
    state.recentCompactionSummaryItem = null
  }
  if (sessionChanged) {
    clearSessionDoneNotification()
    clearBackgroundCurrentSessionUnread()
  }
  if (nextStreaming) {
    armSessionDoneNotification(sync)
  } else if (!sessionChanged && previousStreaming && !state.replaying) {
    notifySessionDone(sync)
  }
  syncDocumentTitle()

  const shouldRebuildItems =
    sessionChanged ||
    hadLoadingSession ||
    !sameStateItems(previousNonOptimisticItems, nextSyncedItems.items)
  const skipMessages =
    !shouldRebuildItems && previousHideThinkingBlock === state.hideThinkingBlock

  if (shouldRebuildItems) {
    state.items = nextSyncedItems.items
    currentAssistantItem = nextSyncedItems.currentAssistantItem
    stopTextPacer()
    restoreOptimisticUserItems(preservedOptimisticItems)
  } else {
    currentAssistantItem = findStreamingAssistantItemInItems(state.items)
  }

  if (nextStreaming) {
    const summaryLabel = meaningfulHiddenThinkingLabel(
      state.uiState.hiddenThinkingLabel
    )
    const thinkingBlock = findLastThinkingBlockInCurrentResponse()
    if (summaryLabel) {
      if (thinkingBlock) {
        thinkingBlock.summaryLabel = summaryLabel
      }
      state.hiddenThinkingPreview = truncateThinkingSummary(summaryLabel)
    } else if (thinkingBlock) {
      state.hiddenThinkingPreview = thinkingSummaryText(thinkingBlock, {
        allowUiLabel: false,
        allowPlaceholder: false,
      })
    }
  }

  const storedPromptDraft =
    preservingLoadingDraftComposer && pendingLoadingDraft
      ? getPromptDraft(pendingLoadingDraft)
      : getPromptDraft(state)
  const nextPromptText =
    preserveLocalPrompt || preservingLoadingDraftComposer
      ? localPromptText
      : (storedPromptDraft ?? state.uiState.editorText) || ""
  setComposerText(nextPromptText)
  rememberComposerDraft(state)
  ensureActiveSessionSummaryLoaded({
    sessionId: sync.sessionId,
    sessionFile: sync.sessionFile,
    cwd: sync.cwd,
    sessionName: sync.sessionName,
    firstMessage: sync.firstMessage,
    title: sessionTitleText({
      sessionName: sync.sessionName,
      firstMessage: sync.firstMessage,
    }),
    modified: sync.modified ?? loadingSessionModified,
    draft: sync.draft,
    streaming: sync.streaming,
  })
  renderSlashCommandMenu()
  render({ skipMessages })

  if (preservingLoadingDraftComposer) {
    void flushPendingDraftPrompt(promptDraftKey({ cwd: sync.cwd }))
  }
}

function assistantBlocksFromMessage(message) {
  const blocks = []
  const content = Array.isArray(message?.content) ? message.content : []
  for (const part of content) {
    if (part?.type === "text") {
      blocks.push({
        type: "text",
        text: part.text || "",
        visibleText: part.text || "",
      })
    }
    if (part?.type === "thinking") {
      const thinkingText = part.thinking || ""
      if (thinkingText.trim()) {
        blocks.push({
          type: "thinking",
          text: thinkingText,
          expanded: false,
          summaryLabel: undefined,
        })
      }
    }
    if (part?.type === "toolCall") {
      blocks.push({
        type: "tool",
        callId: part.id,
        name: part.name,
        args: part.arguments,
        output: "",
        details: undefined,
        isError: false,
        running: true,
        expanded: false,
      })
    }
  }
  return blocks
}

function mutateToolBlockInItems(items, callId, mutate) {
  if (!callId || !Array.isArray(items)) return null
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind !== "assistant") continue
    const block = item.blocks.find(
      (entry) => entry.type === "tool" && entry.callId === callId
    )
    if (!block) continue
    mutate(block)
    return item
  }
  return null
}

function createCompactionSummaryItem(summary, tokensBefore) {
  return {
    kind: "assistant",
    blocks: [
      {
        type: "compaction",
        summary: typeof summary === "string" ? summary : "",
        tokensBefore: Number.isFinite(Number(tokensBefore))
          ? Number(tokensBefore)
          : 0,
      },
    ],
    streaming: false,
  }
}

function buildItemsFromSync(sync) {
  const items = []
  let streamingAssistantItem = null

  const messages = Array.isArray(sync?.messages) ? sync.messages : []
  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        kind: "user",
        text: extractMessageText(message),
        images: extractMessageImages(message),
        queued: Boolean(message.queued ?? message?.metadata?.queued),
        streamingBehavior:
          message.streamingBehavior ??
          message.deliverAs ??
          message?.metadata?.streamingBehavior ??
          message?.metadata?.deliverAs,
      })
      continue
    }

    if (message.role === "assistant") {
      items.push({
        kind: "assistant",
        blocks: assistantBlocksFromMessage(message),
        streaming: false,
      })
      continue
    }

    if (message.role === "compactionSummary") {
      items.push(
        createCompactionSummaryItem(message.summary, message.tokensBefore)
      )
      continue
    }

    if (message.role === "toolResult") {
      mutateToolBlockInItems(items, message.toolCallId, (block) => {
        block.output = extractMessageText(message)
        block.details = message.details
        block.isError = Boolean(message.isError)
        block.running = false
        if (block.isError) block.expanded = true
      })
    }
  }

  const pendingUserMessages = Array.isArray(sync?.pendingUserMessages)
    ? sync.pendingUserMessages
    : []
  for (const message of pendingUserMessages) {
    items.push({
      kind: "user",
      pendingId:
        typeof message?.pendingId === "string" ? message.pendingId : undefined,
      text: typeof message?.text === "string" ? message.text : "",
      images: Array.isArray(message?.images)
        ? message.images
            .map((image) => normalizePromptImage(image))
            .filter(Boolean)
        : [],
      queued: Boolean(message?.queued ?? true),
      streamingBehavior: message?.streamingBehavior,
    })
  }

  const streamingMessage = sync?.streamingMessage
  if (sync?.streaming && streamingMessage?.role === "assistant") {
    streamingAssistantItem = {
      kind: "assistant",
      blocks: assistantBlocksFromMessage(streamingMessage),
      streaming: true,
    }
    items.push(streamingAssistantItem)
  } else if (sync?.streaming) {
    streamingAssistantItem = { kind: "assistant", blocks: [], streaming: true }
    items.push(streamingAssistantItem)
  }

  return { items, currentAssistantItem: streamingAssistantItem }
}

function stableJsonValue(value) {
  if (value == null) return ""
  if (typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonValue(entry)).join(",")}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonValue(value[key])}`).join(",")}}`
}

function sameContextUsage(left, right) {
  return stableJsonValue(left) === stableJsonValue(right)
}

function sameAssistantBlock(left, right) {
  if (!left || !right || left.type !== right.type) return false

  if (left.type === "text") {
    return (
      (left.text || "") === (right.text || "") &&
      Boolean(left.isError) === Boolean(right.isError)
    )
  }

  if (left.type === "thinking") {
    return (left.text || "") === (right.text || "")
  }

  if (left.type === "tool") {
    return (
      (left.callId || "") === (right.callId || "") &&
      (left.name || "") === (right.name || "") &&
      stableJsonValue(left.args) === stableJsonValue(right.args) &&
      (left.output || "") === (right.output || "") &&
      stableJsonValue(left.details) === stableJsonValue(right.details) &&
      Boolean(left.isError) === Boolean(right.isError) &&
      Boolean(left.running) === Boolean(right.running)
    )
  }

  if (left.type === "compaction") {
    return (
      (left.summary || "") === (right.summary || "") &&
      (Number(left.tokensBefore) || 0) === (Number(right.tokensBefore) || 0)
    )
  }

  return false
}

function sameStateItem(left, right) {
  if (!left || !right || left.kind !== right.kind) return false

  if (left.kind === "user") {
    return (
      (left.pendingId || "") === (right.pendingId || "") &&
      sameUserMessageContent(left, right)
    )
  }

  if (left.kind === "assistant") {
    if (Boolean(left.streaming) !== Boolean(right.streaming)) return false
    const leftBlocks = Array.isArray(left.blocks) ? left.blocks : []
    const rightBlocks = Array.isArray(right.blocks) ? right.blocks : []
    if (leftBlocks.length !== rightBlocks.length) return false
    for (let index = 0; index < leftBlocks.length; index += 1) {
      if (!sameAssistantBlock(leftBlocks[index], rightBlocks[index])) {
        return false
      }
    }
    return true
  }

  return false
}

function sameStateItems(leftItems, rightItems) {
  if (
    !Array.isArray(leftItems) ||
    !Array.isArray(rightItems) ||
    leftItems.length !== rightItems.length
  ) {
    return false
  }
  for (let index = 0; index < leftItems.length; index += 1) {
    if (!sameStateItem(leftItems[index], rightItems[index])) {
      return false
    }
  }
  return true
}

function findStreamingAssistantItemInItems(items = state.items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "assistant" && item.streaming) {
      return item
    }
  }
  return null
}

function findLastThinkingBlockInItem(item) {
  if (!item || !Array.isArray(item.blocks)) return null
  for (let index = item.blocks.length - 1; index >= 0; index--) {
    const block = item.blocks[index]
    if (block?.type === "thinking") {
      return block
    }
  }
  return null
}

function isPendingUserItem(item) {
  return (
    item?.kind === "user" &&
    (item.queued ||
      item.streamingBehavior === "followUp" ||
      item.streamingBehavior === "steer")
  )
}

function isOptimisticUserItem(item) {
  return (
    item?.kind === "user" &&
    (Boolean(item?.optimistic) || Boolean(item?.awaitingStateSync))
  )
}

function samePromptImages(leftImages = [], rightImages = []) {
  if (leftImages.length !== rightImages.length) return false
  for (let index = 0; index < leftImages.length; index += 1) {
    const left = leftImages[index]
    const right = rightImages[index]
    if ((left?.mimeType || "") !== (right?.mimeType || "")) return false
    if ((left?.data || "") !== (right?.data || "")) return false
  }
  return true
}

function sameUserMessageContent(left, right) {
  return (
    Boolean(left && right) &&
    (left.text || "") === (right.text || "") &&
    samePromptImages(
      Array.isArray(left.images) ? left.images : [],
      Array.isArray(right.images) ? right.images : []
    ) &&
    Boolean(left.queued) === Boolean(right.queued) &&
    (left.streamingBehavior || "") === (right.streamingBehavior || "")
  )
}

function insertUserItem(item) {
  const assistantIndex = currentAssistantItem
    ? state.items.indexOf(currentAssistantItem)
    : -1
  if (assistantIndex >= 0) {
    state.items.splice(assistantIndex, 0, item)
  } else {
    state.items.push(item)
  }
  return item
}

function findOptimisticUserItemIndex(messageLike = {}) {
  const clientRequestId =
    typeof messageLike?.clientRequestId === "string"
      ? messageLike.clientRequestId
      : ""
  return state.items.findIndex((item) => {
    if (item?.kind !== "user" || !item?.optimistic) return false
    if (clientRequestId && item.clientRequestId === clientRequestId) {
      return true
    }
    return sameUserMessageContent(item, messageLike)
  })
}

function acknowledgeOptimisticUserItem(messageLike = {}) {
  const index = findOptimisticUserItemIndex(messageLike)
  if (index === -1) return null
  const item = state.items[index]
  item.text =
    typeof messageLike.text === "string" ? messageLike.text : item.text
  item.images = Array.isArray(messageLike.images)
    ? messageLike.images
    : item.images
  item.queued = Boolean(messageLike.queued)
  item.streamingBehavior = messageLike.streamingBehavior
  item.optimistic = false
  item.awaitingStateSync = true
  item.clientRequestId = undefined
  return item
}

function removeOptimisticUserItem(clientRequestId) {
  if (!clientRequestId) return null
  const index = findOptimisticUserItemIndex({ clientRequestId })
  if (index === -1) return null
  const [item] = state.items.splice(index, 1)
  return item || null
}

function shouldPreserveOptimisticUserItemsOnSync(
  sync,
  sessionChanged,
  optimisticItems
) {
  if (!Array.isArray(optimisticItems) || optimisticItems.length === 0)
    return false
  if (!sessionChanged) return true

  if (!sync?.draft && promptDraftKey(state).startsWith("draft:")) {
    return true
  }

  const syncFirstMessage =
    typeof sync?.firstMessage === "string" ? sync.firstMessage.trim() : ""
  if (syncFirstMessage) {
    return optimisticItems.some(
      (item) =>
        (typeof item?.text === "string" ? item.text.trim() : "") ===
        syncFirstMessage
    )
  }

  return Boolean(
    !sync?.draft &&
    optimisticItems.some(
      (item) => Array.isArray(item?.images) && item.images.length > 0
    )
  )
}

function restoreOptimisticUserItems(optimisticItems) {
  if (!Array.isArray(optimisticItems) || optimisticItems.length === 0) return

  const remaining = [...optimisticItems]
  for (const item of state.items) {
    if (
      item?.kind !== "user" ||
      isPendingUserItem(item) ||
      isOptimisticUserItem(item)
    ) {
      continue
    }
    const matchIndex = remaining.findIndex((optimisticItem) =>
      sameUserMessageContent(optimisticItem, item)
    )
    if (matchIndex !== -1) {
      remaining.splice(matchIndex, 1)
    }
  }

  for (const item of remaining) {
    insertUserItem(item)
  }
}

function findLastThinkingBlockInCurrentResponse() {
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (!item) continue
    if (item.kind === "user" && !isPendingUserItem(item)) {
      break
    }
    if (item.kind !== "assistant") {
      continue
    }
    const block = findLastThinkingBlockInItem(item)
    if (block) {
      return block
    }
  }
  return null
}

function ensureStreamingAssistantItem() {
  if (!currentAssistantItem) {
    currentAssistantItem = { kind: "assistant", blocks: [], streaming: true }
    state.items.push(currentAssistantItem)
  }
  currentAssistantItem.streaming = true
  state.streaming = true
  return currentAssistantItem
}

function handleMessageUpdate(delta) {
  if (!delta) return
  const assistantItem = ensureStreamingAssistantItem()

  if (delta.type === "text_delta") {
    let block = assistantItem.blocks.find((entry) => entry.type === "text")
    if (!block) {
      block = { type: "text", text: "", visibleText: "" }
      assistantItem.blocks.push(block)
    }
    block.text += delta.delta || ""
    scheduleTextPacer()
    return
  }

  if (delta.type === "thinking_delta") {
    if (!delta.delta) {
      if (!state.hideThinkingBlock) {
        renderMessageItem(assistantItem)
      } else {
        renderWorkingIndicator()
      }
      return
    }
    let block = assistantItem.blocks.find((entry) => entry.type === "thinking")
    if (!block) {
      block = {
        type: "thinking",
        text: "",
        expanded: false,
        summaryLabel: undefined,
      }
      assistantItem.blocks.push(block)
      state.uiState.hiddenThinkingLabel = undefined
    }
    const previousPreview = state.hiddenThinkingPreview || ""
    block.text += delta.delta
    const preview = thinkingSummaryText(block, {
      allowUiLabel: false,
      allowPlaceholder: false,
    })
    if (preview) {
      state.hiddenThinkingPreview = preview
    } else if (previousPreview) {
      state.hiddenThinkingPreview = undefined
    }
    if (!state.hideThinkingBlock) {
      renderMessageItem(assistantItem)
    } else if ((state.hiddenThinkingPreview || "") !== previousPreview) {
      renderWorkingIndicator()
    }
    return
  }

  if (delta.type === "toolcall_end") {
    const toolCall = delta.toolCall || {}
    assistantItem.blocks.push({
      type: "tool",
      callId: toolCall.id,
      name: toolCall.name,
      args: toolCall.arguments,
      output: "",
      details: undefined,
      isError: false,
      running: true,
      expanded: false,
    })
    renderMessageItem(assistantItem, { force: true })
  }
}

function mutateToolBlock(callId, mutate) {
  if (!callId) return null
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (item.kind !== "assistant") continue
    const block = item.blocks.find(
      (entry) => entry.type === "tool" && entry.callId === callId
    )
    if (!block) continue
    mutate(block)
    return item
  }
  return null
}

function render(options = {}) {
  const { skipMessages = false } = options
  const sidebarDirectoriesInitialized = ensureSidebarDirectoriesInitialized()
  const sessionLoading = isSessionLoading()
  const blockingSessionLoading = isBlockingSessionLoading()
  $composerEditorCard?.classList.toggle("is-loading", blockingSessionLoading)
  if ($prompt) {
    $prompt.readOnly = sessionLoading && !canEditComposerWhileLoading()
    $prompt.setAttribute("aria-busy", blockingSessionLoading ? "true" : "false")
  }

  renderMeta()
  renderMainPanelTabs()
  renderContextUsage()
  renderSidebarToggleButton()
  renderSidebarBackdrop()
  renderHeaderSessionActions()
  syncToastContainerOffset()
  renderCommandPalette()
  renderDirectoryDialog()
  renderTreeDialog()
  renderForkDialog()
  renderStatusDialog()
  renderShortcutsDialog()
  renderSettingsDialog()
  renderSidebarDirectoryControls()
  if (sidebarDirectoriesInitialized || !$sessionList?.childElementCount) {
    renderSessions()
  } else {
    syncSessionListSelection()
  }
  renderSendButton()
  renderWorkingIndicator()
  renderComposerControls()
  renderComposerSkillPill()
  renderComposerImages()
  renderSlashCommandMenu()
  renderPendingMessagesTray()
  if (!skipMessages) {
    renderMessages()
  }
}

function restoreElementFocus(target) {
  if (!target || typeof target.focus !== "function") return
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body)
      return
    target.focus()
    target.select?.()
  })
}

function captureSessionListFocus() {
  const activeElement = document.activeElement
  if (activeElement === $sessionSearch) {
    return { type: "search" }
  }
  if (!(activeElement instanceof Element)) {
    return null
  }

  const portaledMenu = activeElement.closest(
    '.session-item-menu[data-session-menu-owner="session"]'
  )
  if (portaledMenu) {
    const menuOption = activeElement.closest(".session-item-menu-option")
    return menuOption
      ? {
          type: "menu-option",
          sessionId: portaledMenu.dataset.sessionId || "",
          sessionPath: portaledMenu.dataset.sessionPath || "",
          menuAction: menuOption.dataset.sessionMenuAction || "",
          listNavigation: false,
        }
      : null
  }

  if (!$sessionList?.contains(activeElement)) {
    return null
  }

  const item = activeElement.closest(".session-item")
  if (!(item instanceof HTMLElement)) {
    return null
  }

  const menuOption = activeElement.closest(".session-item-menu-option")
  let type = ""
  if (menuOption) {
    type = "menu-option"
  } else if (activeElement.closest(".session-item-menu-trigger")) {
    type = "menu-trigger"
  } else if (activeElement.closest(".session-item-main")) {
    type = "main"
  }

  if (!type) {
    return null
  }

  return {
    type,
    sessionId: item.dataset.sessionId || "",
    sessionPath: item.dataset.sessionPath || "",
    menuAction: menuOption?.dataset.sessionMenuAction || "",
    listNavigation: activeElement === listNavigationFocusEl,
  }
}

function restoreSessionListFocus(focusState) {
  if (!focusState) return
  if (focusState.type === "search") {
    restoreElementFocus($sessionSearch)
    return
  }

  const items = Array.from(
    $sessionList?.querySelectorAll(".session-item") || []
  )
  const item = items.find((entry) => {
    const matchesPath =
      focusState.sessionPath &&
      entry.dataset.sessionPath === focusState.sessionPath
    const matchesId =
      focusState.sessionId && entry.dataset.sessionId === focusState.sessionId
    return matchesPath || matchesId
  })

  if (!(item instanceof HTMLElement)) {
    if (focusState.listNavigation) {
      clearListNavigationFocus()
    }
    return
  }

  let target = null
  if (focusState.type === "main") {
    target = item.querySelector(".session-item-main")
  } else if (focusState.type === "menu-trigger") {
    target = item.querySelector(".session-item-menu-trigger")
  } else if (focusState.type === "menu-option") {
    const menuIsOpen = item._refs?.menu?.classList.contains("is-open")
    target =
      (menuIsOpen
        ? Array.from(
            item._refs?.menu?.querySelectorAll(".session-item-menu-option") ||
              []
          ).find(
            (button) =>
              button.dataset.sessionMenuAction === focusState.menuAction
          )
        : null) ||
      item.querySelector(".session-item-menu-trigger") ||
      null
  }

  if (!(target instanceof HTMLElement)) {
    if (focusState.listNavigation) {
      clearListNavigationFocus()
    }
    return
  }

  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body)
      return
    if (focusState.listNavigation && focusState.type === "main") {
      setListNavigationFocus(target)
      return
    }
    target.focus()
  })
}

function sessionMatchesSearch(session, normalizedQuery) {
  if (!normalizedQuery) return true
  const title = sessionTitleText(session).toLowerCase()
  const cwd = (session.cwd || "").toLowerCase()
  return title.includes(normalizedQuery) || cwd.includes(normalizedQuery)
}

function directoryMatchesQuery(directoryPath, query) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  const haystack =
    `${directoryPath} ${tildePath(directoryPath)} ${baseName(directoryPath)} ${dirNameOrPath(directoryPath)}`.toLowerCase()
  return haystack.includes(normalizedQuery)
}

function compareSessionsByModified(a, b) {
  const aTime = a?.modified ? new Date(a.modified).getTime() : 0
  const bTime = b?.modified ? new Date(b.modified).getTime() : 0
  return bTime - aTime
}

function sidebarDirectoryGroups() {
  const query = state.sessionSearch.trim().toLowerCase()
  const sessionsByDirectory = new Map()

  for (const session of [...state.sessions].sort(compareSessionsByModified)) {
    const directoryPath =
      typeof session.cwd === "string" ? session.cwd.trim() : ""
    if (!directoryPath) continue
    const sessions = sessionsByDirectory.get(directoryPath) || []
    sessions.push(session)
    sessionsByDirectory.set(directoryPath, sessions)
  }

  return state.sidebarDirectories
    .map((directoryPath) => {
      const allSessions = sessionsByDirectory.get(directoryPath) || []
      const searchSessions = query
        ? searchableSessionsForDirectory(directoryPath)
        : allSessions
      const directoryMatches =
        Boolean(query) && directoryMatchesQuery(directoryPath, query)
      const totalCount = directorySessionTotalCount(directoryPath)
      const loadedCount = directorySessionLoadedCount(directoryPath)
      const matchingSessions = query
        ? directoryMatches
          ? searchSessions
          : searchSessions.filter((session) =>
              sessionMatchesSearch(session, query)
            )
        : allSessions
      return {
        directoryPath,
        allSessions,
        sessions: matchingSessions,
        hasSearchQuery: Boolean(query),
        directoryMatches,
        collapsed: query ? false : directoryIsCollapsed(directoryPath),
        hasMore: !query && totalCount > loadedCount,
        remainingCount: query ? 0 : Math.max(0, totalCount - loadedCount),
        loading: directorySessionIsLoading(directoryPath),
        searchLoading: directorySearchIsLoading(directoryPath),
        searchCoverageReady: directorySearchCoverageReady(directoryPath),
        totalCount,
        loadedCount,
      }
    })
    .filter(
      (group) =>
        !group.hasSearchQuery ||
        group.directoryMatches ||
        group.sessions.length > 0
    )
}

function sessionListItemKey(sessionLike = {}) {
  if (sessionLike?.path) return `path:${sessionLike.path}`
  if (sessionLike?.id) return `id:${sessionLike.id}`
  return ""
}

function normalizeSidebarSessionSelectionKeys(value = []) {
  if (!Array.isArray(value)) return []
  const keys = []
  const seen = new Set()
  for (const entry of value) {
    const key = typeof entry === "string" ? entry.trim() : ""
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

function setSidebarSessionSelection(
  nextKeys,
  { anchorKey = "", render = true } = {}
) {
  const normalizedKeys = normalizeSidebarSessionSelectionKeys(nextKeys)
  const normalizedAnchorKey =
    typeof anchorKey === "string" ? anchorKey.trim() : ""
  const resolvedAnchorKey = normalizedKeys.length
    ? normalizedAnchorKey && normalizedKeys.includes(normalizedAnchorKey)
      ? normalizedAnchorKey
      : normalizedKeys[normalizedKeys.length - 1]
    : ""
  const changed =
    normalizedKeys.length !== state.selectedSidebarSessionKeys.length ||
    normalizedKeys.some(
      (key, index) => key !== state.selectedSidebarSessionKeys[index]
    ) ||
    resolvedAnchorKey !== state.sidebarSessionSelectionAnchor

  if (!changed) return false

  state.selectedSidebarSessionKeys = normalizedKeys
  state.sidebarSessionSelectionAnchor = resolvedAnchorKey
  if (render) {
    renderSessions()
  }
  return true
}

function pruneSidebarSessionSelection() {
  const validKeys = new Set(
    state.sessions.map((session) => sessionListItemKey(session)).filter(Boolean)
  )
  state.selectedSidebarSessionKeys = normalizeSidebarSessionSelectionKeys(
    state.selectedSidebarSessionKeys.filter((key) => validKeys.has(key))
  )
  state.sidebarSessionSelectionAnchor = validKeys.has(
    state.sidebarSessionSelectionAnchor
  )
    ? state.sidebarSessionSelectionAnchor
    : state.selectedSidebarSessionKeys[
        state.selectedSidebarSessionKeys.length - 1
      ] || ""
}

function toggleSidebarSessionSelection(sessionKey) {
  const normalizedKey = typeof sessionKey === "string" ? sessionKey.trim() : ""
  if (!normalizedKey) return false
  const nextKeys = state.selectedSidebarSessionKeys.includes(normalizedKey)
    ? state.selectedSidebarSessionKeys.filter((key) => key !== normalizedKey)
    : [...state.selectedSidebarSessionKeys, normalizedKey]
  return setSidebarSessionSelection(nextKeys, { anchorKey: normalizedKey })
}

function selectSidebarSessionRange(sessionKey) {
  const normalizedKey = typeof sessionKey === "string" ? sessionKey.trim() : ""
  if (!normalizedKey) return false

  const orderedKeys = sessionResultButtons()
    .map((button) =>
      typeof button.dataset.sessionKey === "string"
        ? button.dataset.sessionKey.trim()
        : ""
    )
    .filter(Boolean)
  if (!orderedKeys.length) {
    return setSidebarSessionSelection([normalizedKey], {
      anchorKey: normalizedKey,
    })
  }

  const targetIndex = orderedKeys.indexOf(normalizedKey)
  if (targetIndex < 0) {
    return setSidebarSessionSelection([normalizedKey], {
      anchorKey: normalizedKey,
    })
  }

  const anchorKey = orderedKeys.includes(state.sidebarSessionSelectionAnchor)
    ? state.sidebarSessionSelectionAnchor
    : state.selectedSidebarSessionKeys.find((key) =>
        orderedKeys.includes(key)
      ) || normalizedKey
  const anchorIndex = orderedKeys.indexOf(anchorKey)
  if (anchorIndex < 0) {
    return setSidebarSessionSelection([normalizedKey], {
      anchorKey: normalizedKey,
    })
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return setSidebarSessionSelection(orderedKeys.slice(start, end + 1), {
    anchorKey,
  })
}

function selectedSidebarSessionSummaries() {
  if (!state.selectedSidebarSessionKeys.length) return []
  const selectedKeys = new Set(state.selectedSidebarSessionKeys)
  return state.sessions.filter((session) => {
    const key = sessionListItemKey(session)
    return Boolean(session?.path) && Boolean(key) && selectedKeys.has(key)
  })
}

function focusedSidebarSessionSummary() {
  const activeElement = document.activeElement
  const sessionItem =
    activeElement instanceof Element
      ? activeElement.closest(".session-item")
      : null
  if (!(sessionItem instanceof HTMLElement)) return null
  const sessionKey =
    typeof sessionItem.dataset.sessionKey === "string"
      ? sessionItem.dataset.sessionKey.trim()
      : ""
  if (!sessionKey) return null
  return (
    state.sessions.find(
      (session) => sessionListItemKey(session) === sessionKey
    ) ||
    sessionItem._sessionData ||
    null
  )
}

function pruneSessionListCaches(groups = []) {
  const activeSessionKeys = new Set(
    groups
      .flatMap((group) =>
        Array.isArray(group?.sessions) ? group.sessions : []
      )
      .map((session) => sessionListItemKey(session))
      .filter(Boolean)
  )
  for (const [key, element] of sessionListElementCache.sessions) {
    if (activeSessionKeys.has(key)) continue
    element._refs?.menuPortal?.destroy?.()
    element.remove()
    sessionListElementCache.sessions.delete(key)
  }

  const activeDirectoryPaths = new Set(state.sidebarDirectories)
  for (const [directoryPath, element] of sessionListElementCache.directories) {
    if (activeDirectoryPaths.has(directoryPath)) continue
    element._refs?.menuPortal?.destroy?.()
    element.remove()
    sessionListElementCache.directories.delete(directoryPath)
  }
}

function sidebarSearchPending() {
  if (!state.sessionSearch.trim()) return false
  return state.sidebarDirectories.some((directoryPath) => {
    const normalizedPath =
      typeof directoryPath === "string" ? directoryPath.trim() : ""
    if (!normalizedPath) return false
    const totalCount = directorySessionTotalCount(normalizedPath)
    if (totalCount <= 0) return false
    return !directorySearchCoverageReady(normalizedPath)
  })
}

function sessionListEmptyStateText() {
  if (state.sessionSearch.trim()) {
    return sidebarSearchPending()
      ? "Searching sessions…"
      : "No sessions or directories match your search."
  }
  return state.sidebarDirectories.length
    ? "No directories match this view."
    : "No directories added yet."
}

function sessionListEmptyStateElement() {
  if (!sessionListElementCache.emptyState) {
    const empty = document.createElement("div")
    empty.className = "session-list-empty"
    sessionListElementCache.emptyState = empty
  }
  sessionListElementCache.emptyState.textContent = sessionListEmptyStateText()
  return sessionListElementCache.emptyState
}

function createSessionItem(
  session,
  { activeSessionId, activeSessionFile } = {}
) {
  const key = sessionListItemKey(session)
  let item = key ? sessionListElementCache.sessions.get(key) : null

  if (!item) {
    item = document.createElement("div")

    const button = document.createElement("button")
    button.type = "button"
    button.className = "session-item-main"

    const titleRow = document.createElement("div")
    titleRow.className = "session-item-title-row"

    const titleGroup = document.createElement("div")
    titleGroup.className = "session-item-title-group"

    const spinner = createSpinnerIcon("session-item-status-spinner hidden")

    const title = document.createElement("div")
    title.className = "session-item-title"

    const dot = document.createElement("div")
    dot.className = "session-item-status-dot hidden"
    dot.setAttribute("aria-hidden", "true")

    titleGroup.append(dot, spinner, title)

    const trailing = document.createElement("div")
    trailing.className = "session-item-trailing"

    const time = document.createElement("div")
    time.className = "session-item-time"

    trailing.append(time)
    titleRow.append(titleGroup, trailing)
    button.append(titleRow)

    const actions = document.createElement("div")
    actions.className = "session-item-actions"

    const trigger = document.createElement("button")
    trigger.type = "button"
    trigger.className = "session-item-menu-trigger"
    trigger.tabIndex = -1
    trigger.textContent = "⋯"
    trigger.addEventListener("click", (event) => {
      event.stopPropagation()
      const currentSession = item._sessionData || {}
      if (!currentSession.path) return
      setSessionMenu(currentSession.path)
    })

    const menu = document.createElement("div")
    menu.className = "session-item-menu"
    const menuPortal = createFloatingPortal(menu, {
      defaultPlacement: FLOATING_PLACEMENTS.BOTTOM_START,
      offset: 6,
      padding: 12,
    })

    const renameButton = document.createElement("button")
    renameButton.type = "button"
    renameButton.className = "session-item-menu-option"
    renameButton.dataset.sessionMenuAction = "rename"
    renameButton.textContent = "Rename"
    renameButton.addEventListener("click", (event) => {
      event.stopPropagation()
      closeSessionMenu()
      const currentSession = item._sessionData || {}
      if (!currentSession.path) return
      const currentName =
        currentSession.name === "Current session"
          ? ""
          : currentSession.name || ""
      openRenameDialog(
        currentSession.path,
        currentName,
        sessionTitle(currentSession)
      )
    })

    const deleteButton = document.createElement("button")
    deleteButton.type = "button"
    deleteButton.className = "session-item-menu-option danger"
    deleteButton.dataset.sessionMenuAction = "delete"
    deleteButton.textContent = "Delete"
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation()
      closeSessionMenu()
      const currentSession = item._sessionData || {}
      if (!currentSession.path) return
      await deleteSessionByPath(
        currentSession.path,
        currentSession.id,
        sessionTitle(currentSession)
      )
    })

    menu.append(renameButton, deleteButton)
    actions.append(trigger, menu)

    button.addEventListener("click", async (event) => {
      const currentSession = item._sessionData || {}
      const currentSessionKey = sessionListItemKey(currentSession)
      closeSessionMenu({ render: false })
      closeDirectoryMenu({ render: false })
      if (!currentSessionKey) return

      if (event.shiftKey) {
        event.preventDefault()
        selectSidebarSessionRange(currentSessionKey)
        return
      }

      if (event.metaKey || event.ctrlKey) {
        event.preventDefault()
        toggleSidebarSessionSelection(currentSessionKey)
        return
      }

      setSidebarSessionSelection([currentSessionKey], {
        anchorKey: currentSessionKey,
        render: false,
      })
      if (isMobileViewport()) {
        closeSidebarDrawerOnMobile(state)
        syncSidebarLayout()
      }
      const {
        sessionId: currentActiveSessionId,
        sessionFile: currentActiveSessionFile,
      } = activeSessionSelection()
      const isCurrent = currentActiveSessionId
        ? currentSession.id === currentActiveSessionId
        : Boolean(currentActiveSessionFile) &&
          currentSession.path === currentActiveSessionFile
      if (!currentSession.id || isCurrent) {
        renderSessions()
        return
      }
      await navigateToSession(currentSession.id, {
        loadingSession: currentSession,
      })
    })

    item._refs = {
      button,
      title,
      spinner,
      time,
      dot,
      actions,
      trigger,
      menu,
      menuPortal,
    }

    if (key) {
      sessionListElementCache.sessions.set(key, item)
    }
  }

  item._sessionData = session

  const isActive = activeSessionId
    ? session.id === activeSessionId
    : Boolean(activeSessionFile) && session.path === activeSessionFile
  const isSelected =
    Boolean(key) && state.selectedSidebarSessionKeys.includes(key)
  const menuOpen =
    Boolean(session.path) && state.openSessionMenuPath === session.path
  const fullTitle = sessionTitleText(session)
  const refs = item._refs

  item.className = `session-item${isActive ? " active" : ""}${isSelected ? " is-selected" : ""}${menuOpen ? " menu-open" : ""}`
  item.dataset.sessionKey = key || ""
  item.dataset.sessionId = session.id || ""
  item.dataset.sessionPath = session.path || ""
  refs.button.dataset.sessionKey = key || ""

  refs.title.textContent = sessionTitle(session)
  refs.title.title = fullTitle
  refs.spinner.classList.toggle("hidden", !session.streaming)
  refs.dot.classList.toggle(
    "hidden",
    Boolean(session.streaming) || !session.unread
  )
  refs.time.textContent = relativeTime(session.modified)
  refs.actions.classList.toggle("is-open", menuOpen)
  refs.trigger.setAttribute(
    "aria-label",
    `Session actions for ${sessionTitle(session)}`
  )
  refs.trigger.setAttribute("aria-expanded", menuOpen ? "true" : "false")
  refs.menu.dataset.sessionMenuOwner = "session"
  refs.menu.dataset.sessionId = session.id || ""
  refs.menu.dataset.sessionPath = session.path || ""
  refs.menu.classList.toggle("is-open", menuOpen)
  if (menuOpen) {
    refs.menuPortal.show(refs.trigger, {
      placement: FLOATING_PLACEMENTS.BOTTOM_START,
    })
  } else {
    refs.menuPortal.hide()
  }

  const children = [refs.button]
  if (session.path) {
    children.push(refs.actions)
  }
  syncContainerChildren(item, children)

  return item
}

function renderDirectoryAccordion(
  group,
  { activeSessionId, activeSessionFile } = {}
) {
  let section = sessionListElementCache.directories.get(group.directoryPath)

  if (!section) {
    section = document.createElement("section")

    const header = document.createElement("div")
    header.className = "directory-accordion-header"

    const toggle = document.createElement("button")
    toggle.type = "button"
    toggle.className = "directory-accordion-toggle"
    toggle.innerHTML = `
      <span class="directory-accordion-leading">
        <svg class="directory-accordion-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M5.25 3.75 9.75 8l-4.5 4.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg class="directory-accordion-icon" viewBox="0 0 20 16" fill="none" aria-hidden="true">
          <path d="M1.75 3.5A1.75 1.75 0 0 1 3.5 1.75h3.12c.46 0 .9.18 1.22.5l1.16 1.16c.33.33.77.51 1.23.51h5.27a1.75 1.75 0 0 1 1.75 1.75v6.83a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V3.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="directory-accordion-copy"></span>
    `
    toggle.addEventListener("click", (event) => {
      if (suppressSidebarDirectoryToggleClick) {
        suppressSidebarDirectoryToggleClick = false
        event.preventDefault()
        event.stopPropagation()
        return
      }

      const currentGroup = section._groupData || {}
      if (!currentGroup.directoryPath) return
      setDirectoryCollapsed(currentGroup.directoryPath, !currentGroup.collapsed)
    })
    toggle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return
      const currentGroup = section._groupData || {}
      if (!currentGroup.directoryPath || !sidebarDirectoryOrderingEnabled())
        return

      sidebarDirectoryDragCandidate = {
        directoryPath: currentGroup.directoryPath,
        section,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
      }

      window.addEventListener(
        "pointermove",
        handleSidebarDirectoryDragPointerMove,
        { passive: false }
      )
      window.addEventListener(
        "pointerup",
        handleSidebarDirectoryDragPointerUp,
        { passive: false }
      )
      window.addEventListener(
        "pointercancel",
        handleSidebarDirectoryDragPointerCancel,
        { passive: false }
      )
      window.addEventListener("blur", handleSidebarDirectoryDragWindowBlur)
    })

    const actions = document.createElement("div")
    actions.className = "directory-accordion-actions"

    const createButton = document.createElement("button")
    createButton.type = "button"
    createButton.className = "button ghost directory-accordion-create"
    createButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="directory-accordion-create-icon" aria-hidden="true">
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
      </svg>
    `
    createButton.addEventListener("click", async (event) => {
      event.stopPropagation()
      closeDirectoryMenu({ render: false })
      const currentGroup = section._groupData || {}
      if (!currentGroup.directoryPath) return
      try {
        await createNewSessionInDirectory(currentGroup.directoryPath)
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Failed to create a session.",
          "error"
        )
      }
    })

    const menuShell = document.createElement("div")
    menuShell.className = "directory-accordion-menu-shell"

    const trigger = document.createElement("button")
    trigger.type = "button"
    trigger.className =
      "session-item-menu-trigger directory-accordion-menu-trigger"
    trigger.textContent = "⋯"
    trigger.addEventListener("click", (event) => {
      event.stopPropagation()
      const currentGroup = section._groupData || {}
      if (!currentGroup.directoryPath) return
      setDirectoryMenu(currentGroup.directoryPath)
    })

    const menu = document.createElement("div")
    menu.className = "session-item-menu directory-accordion-menu"
    const menuPortal = createFloatingPortal(menu, {
      defaultPlacement: FLOATING_PLACEMENTS.BOTTOM_START,
      offset: 6,
      padding: 12,
    })

    const removeButton = document.createElement("button")
    removeButton.type = "button"
    removeButton.className = "session-item-menu-option"
    removeButton.textContent = "Remove"
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation()
      const currentGroup = section._groupData || {}
      if (!currentGroup.directoryPath) return
      removeSidebarDirectory(currentGroup.directoryPath)
    })

    menu.append(removeButton)
    menuShell.append(trigger, menu)
    actions.append(createButton, menuShell)
    header.append(toggle, actions)

    const body = document.createElement("div")
    body.className = "directory-accordion-body"

    const list = document.createElement("div")
    list.className = "directory-session-list"

    const empty = document.createElement("div")
    empty.className = "directory-accordion-empty"
    empty.textContent = "No saved sessions yet."

    const loadMoreButton = document.createElement("button")
    loadMoreButton.type = "button"
    loadMoreButton.className = "button ghost directory-session-load-more"
    loadMoreButton.addEventListener("click", (event) => {
      event.stopPropagation()
      const currentGroup = section._groupData || {}
      if (!currentGroup.directoryPath) return
      loadMoreDirectorySessions(currentGroup.directoryPath)
    })

    section._refs = {
      header,
      toggle,
      copy: toggle.querySelector(".directory-accordion-copy"),
      actions,
      createButton,
      trigger,
      menu,
      menuPortal,
      body,
      list,
      empty,
      loadMoreButton,
    }

    sessionListElementCache.directories.set(group.directoryPath, section)
  }

  section._groupData = group

  const refs = section._refs
  const menuOpen = state.openDirectoryMenuPath === group.directoryPath
  const displayPath = tildePath(group.directoryPath)
  const dragEnabled =
    !group.hasSearchQuery && state.sidebarDirectories.length > 1
  const isDragSource = group.directoryPath === sidebarDirectoryDragPath

  section.className = `directory-accordion${group.collapsed ? " is-collapsed" : ""}${menuOpen ? " menu-open" : ""}${dragEnabled ? " is-draggable" : ""}${isDragSource ? " is-drag-source" : ""}`
  section.dataset.directoryPath = group.directoryPath

  refs.toggle.setAttribute("aria-expanded", group.collapsed ? "false" : "true")
  refs.toggle.title = group.directoryPath
  refs.copy.innerHTML = buildFadedPathLabelHtml(
    { label: displayPath, prefix: "", path: displayPath },
    {
      containerClass: "directory-accordion-title",
      prefixClass: "directory-accordion-title-prefix",
      pathClass: "directory-accordion-title-path",
      leadingClass: "directory-accordion-title-leading",
      tailClass: "directory-accordion-title-tail",
    }
  )

  refs.actions.classList.toggle("is-open", menuOpen)
  refs.toggle.setAttribute("aria-grabbed", isDragSource ? "true" : "false")
  refs.createButton.setAttribute(
    "aria-label",
    `Create a session in ${group.directoryPath}`
  )
  refs.createButton.title = `Create a session in ${group.directoryPath}`
  refs.trigger.setAttribute(
    "aria-label",
    `Directory actions for ${group.directoryPath}`
  )
  refs.trigger.setAttribute("aria-expanded", menuOpen ? "true" : "false")
  refs.menu.dataset.sessionMenuOwner = "directory"
  refs.menu.dataset.directoryPath = group.directoryPath
  refs.menu.classList.toggle("is-open", menuOpen)
  if (menuOpen) {
    refs.menuPortal.show(refs.trigger, {
      placement: FLOATING_PLACEMENTS.BOTTOM_START,
    })
  } else {
    refs.menuPortal.hide()
  }

  const loadMoreCount = Math.min(
    DIRECTORY_SESSION_LOAD_MORE_COUNT,
    group.remainingCount || 0
  )
  const loadMoreLabel =
    group.loading && group.hasMore
      ? "Loading…"
      : loadMoreCount > 0
        ? `Load ${loadMoreCount} more`
        : "Load more"
  refs.loadMoreButton.textContent = loadMoreLabel
  refs.loadMoreButton.disabled = group.loading
  refs.loadMoreButton.setAttribute(
    "aria-label",
    `${loadMoreLabel} sessions from ${group.directoryPath}`
  )
  refs.loadMoreButton.title = loadMoreLabel
  refs.empty.textContent = group.hasSearchQuery
    ? group.searchCoverageReady
      ? "No sessions match this search."
      : "Searching sessions…"
    : group.loading
      ? "Loading sessions…"
      : "No saved sessions yet."

  const children = [refs.header]
  if (!group.collapsed) {
    if (group.sessions.length) {
      const sessionElements = group.sessions.map((session) =>
        createSessionItem(session, { activeSessionId, activeSessionFile })
      )
      syncContainerChildren(refs.list, sessionElements)
      const bodyChildren = [refs.list]
      if (group.hasMore) {
        bodyChildren.push(refs.loadMoreButton)
      }
      syncContainerChildren(refs.body, bodyChildren)
    } else {
      syncContainerChildren(refs.body, [refs.empty])
    }
    children.push(refs.body)
  }

  syncContainerChildren(section, children)
  return section
}

function syncSessionListSelection() {
  if (!$sessionList) return

  pruneSidebarSessionSelection()
  const selectedSessionKeys = new Set(state.selectedSidebarSessionKeys)
  const { sessionId: activeSessionId, sessionFile: activeSessionFile } =
    activeSessionSelection()

  for (const item of $sessionList.querySelectorAll(".session-item")) {
    const isActive = activeSessionId
      ? item.dataset.sessionId === activeSessionId
      : Boolean(activeSessionFile) &&
        item.dataset.sessionPath === activeSessionFile
    const sessionKey =
      typeof item.dataset.sessionKey === "string"
        ? item.dataset.sessionKey.trim()
        : ""
    item.classList.toggle("active", isActive)
    item.classList.toggle(
      "is-selected",
      Boolean(sessionKey) && selectedSessionKeys.has(sessionKey)
    )
  }
}

function renderSessions(options = {}) {
  renderSidebarToggleButton()
  renderSidebarDirectoryControls()
  pruneSidebarSessionSelection()
  const focusState = captureSessionListFocus()
  const { sessionId: activeSessionId, sessionFile: activeSessionFile } =
    activeSessionSelection()
  const groups = sidebarDirectoryGroups()
  const validDirectoryPaths = new Set(
    groups.map((group) => group.directoryPath)
  )

  if (
    sidebarDirectoryDragPath &&
    (!sidebarDirectoryOrderingEnabled() ||
      !validDirectoryPaths.has(sidebarDirectoryDragPath))
  ) {
    clearSidebarDirectoryDragState({
      restoreInitialOrder: false,
      render: false,
    })
  }

  if (!groups.length) {
    syncContainerChildren($sessionList, [sessionListEmptyStateElement()])
    pruneSessionListCaches(groups)
    restoreSessionListFocus(focusState)
    syncSessionSearchListFocus()
    applySidebarDirectoryDragState()
    return
  }

  const elements = groups.map((group) =>
    renderDirectoryAccordion(group, { activeSessionId, activeSessionFile })
  )
  syncContainerChildren($sessionList, elements)
  pruneSessionListCaches(groups)
  restoreSessionListFocus(focusState)
  syncSessionSearchListFocus()
  animateSidebarDirectoryAccordionPositions(options.previousDirectoryPositions)
  applySidebarDirectoryDragState()
}

function syncContainerChildren(container, elements) {
  let insertions = 0
  let removals = 0

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]
    const currentChild = container.children[index]
    if (currentChild !== element) {
      container.insertBefore(element, currentChild || null)
      insertions += 1
    }
  }

  while (container.children.length > elements.length) {
    container.lastElementChild?.remove()
    removals += 1
  }
}

function baseName(value) {
  if (!value) return ""
  const trimmed = value.replace(/[\\/]+$/, "")
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

function dirNameOrPath(value) {
  if (!value) return ""
  const trimmed = value.replace(/[\\/]+$/, "")
  const parts = trimmed.split(/[\\/]/)
  parts.pop()
  return parts.join("/") || value
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;")
}

function pill(text) {
  const span = document.createElement("span")
  span.className = "session-item-pill"
  span.textContent = text
  return span
}

function sessionTitleText(session) {
  const title = typeof session?.title === "string" ? session.title.trim() : ""
  const sessionName =
    session?.sessionName === "Current session"
      ? ""
      : typeof session?.sessionName === "string"
        ? session.sessionName.trim()
        : ""
  const name =
    session?.name === "Current session"
      ? ""
      : typeof session?.name === "string"
        ? session.name.trim()
        : ""
  const firstMessage =
    typeof session?.firstMessage === "string" ? session.firstMessage.trim() : ""
  return title || sessionName || name || firstMessage || "New session"
}

function sessionTitle(session) {
  const raw = sessionTitleText(session)
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw
}

function sessionPageTitle(sessionLike = state.loadingSession || state) {
  const title = sessionTitleText(sessionLike)
  return title === "New session" ? "pi" : title
}

function syncDocumentTitleAnimation() {
  const shouldAnimate = !state.loadingSession && Boolean(state.streaming)
  if (shouldAnimate) {
    if (!titleStreamingIntervalId) {
      titleStreamingFrameIndex = 0
      titleStreamingIntervalId = window.setInterval(() => {
        titleStreamingFrameIndex =
          (titleStreamingFrameIndex + 1) % TITLE_STREAMING_FRAMES.length
        syncDocumentTitle()
      }, TITLE_STREAMING_INTERVAL_MS)
    }
    return true
  }

  if (titleStreamingIntervalId) {
    window.clearInterval(titleStreamingIntervalId)
    titleStreamingIntervalId = 0
  }
  titleStreamingFrameIndex = 0
  return false
}

function syncDocumentTitle() {
  const animate = syncDocumentTitleAnimation()
  const uiTitle =
    !state.loadingSession && typeof state.uiState?.title === "string"
      ? state.uiState.title.trim()
      : ""
  const baseTitle = uiTitle || sessionPageTitle()
  const unreadCount = unreadSessionCount()
  const streamingPrefix = animate
    ? `${TITLE_STREAMING_FRAMES[titleStreamingFrameIndex]} `
    : ""
  const title = `${streamingPrefix}${baseTitle}`
  document.title = unreadCount > 0 ? `(${unreadCount}) ${title}` : title
}

function relativeTime(value) {
  if (!value) return ""
  const date = new Date(value)
  const diffMs = date.getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (absMs < minute) return "just now"
  if (absMs < hour) return `${Math.round(absMs / minute)}m ago`
  if (absMs < day) return `${Math.round(absMs / hour)}h ago`
  return `${Math.round(absMs / day)}d ago`
}

function extractMessageText(message) {
  if (typeof message?.content === "string") return message.content
  if (!Array.isArray(message?.content)) return ""
  return message.content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n")
}

function extractToolText(result) {
  if (!result || !Array.isArray(result.content)) return ""
  return result.content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n")
}

$send.addEventListener("click", async () => {
  if (state.streaming) {
    await abortStreamingResponse()
    return
  }

  const slashAction = slashCommandAction()
  if (slashAction?.type === "execute-builtin") {
    await submitBuiltinSlashCommand(slashAction.command, slashAction.args)
    return
  }
  if (slashAction?.type === "insert-skill") {
    insertSkillCommand(slashAction.skillName)
    return
  }

  if (state.awaitingFirstTurn) {
    await submitPrompt("steer")
    return
  }

  await submitPromptOrQueue()
})

$queue?.addEventListener("click", async () => {
  await submitPrompt("followUp")
})

$steer?.addEventListener("click", async () => {
  await submitPrompt("steer")
})

$pendingMessagesTrayToggle?.addEventListener("click", () => {
  togglePendingMessagesTray()
})

$collapseAllDirectoriesBtn?.addEventListener("click", () => {
  const hasExpandedDirectories = state.sidebarDirectories.some(
    (directoryPath) => !directoryIsCollapsed(directoryPath)
  )
  if (hasExpandedDirectories) {
    collapseAllDirectories()
    return
  }
  expandAllDirectories()
})

$addDirectoryBtn?.addEventListener("click", (event) => {
  event.stopPropagation()
  openDirectoryDialog()
})

$sessionSearch?.addEventListener("input", () => {
  setSessionSearchQuery($sessionSearch.value)
})

$mainPanelTabSessionBtn?.addEventListener("click", () => {
  setMainPanelTab("session")
})

$mainPanelTabChangesBtn?.addEventListener("click", () => {
  setMainPanelTab("changes", { forceRefresh: true })
})

$headerSessionMenuTrigger?.addEventListener("click", (event) => {
  event.stopPropagation()
  toggleHeaderSessionMenu()
})

$headerNewSessionBtn?.addEventListener("click", async (event) => {
  event.stopPropagation()
  closeHeaderSessionMenu()
  try {
    const currentDirectory =
      typeof state.cwd === "string" ? state.cwd.trim() : ""
    await createNewSessionInDirectory(currentDirectory || undefined)
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "Failed to create a session.",
      "error"
    )
  }
})

$headerToggleThinkingBtn?.addEventListener("click", async (event) => {
  event.stopPropagation()
  closeHeaderSessionMenu()
  await toggleThinkingVisibility()
})

$headerToggleToolsBtn?.addEventListener("click", (event) => {
  event.stopPropagation()
  closeHeaderSessionMenu()
  toggleToolVisibility()
})

$headerRenameSessionBtn?.addEventListener("click", (event) => {
  event.stopPropagation()
  closeHeaderSessionMenu()
  if (!state.sessionFile) return
  const currentName =
    state.sessionName === "Current session" ? "" : state.sessionName || ""
  openRenameDialog(
    state.sessionFile,
    currentName,
    sessionTitle({ name: state.sessionName, firstMessage: state.firstMessage })
  )
})

$headerDeleteSessionBtn?.addEventListener("click", async (event) => {
  event.stopPropagation()
  closeHeaderSessionMenu()
  if (!state.sessionFile) return
  await deleteSessionByPath(
    state.sessionFile,
    state.sessionId,
    sessionTitle({ name: state.sessionName, firstMessage: state.firstMessage })
  )
})

$commandPaletteCloseBtn?.addEventListener("click", () => {
  closeCommandPalette()
})

$openDirectoryCloseBtn?.addEventListener("click", () => {
  closeDirectoryDialog()
})

$statusDialogCloseBtn?.addEventListener("click", () => {
  closeStatusDialog()
})

$sidebarSettingsBtn?.addEventListener("click", (event) => {
  event.stopPropagation()
  if (state.settingsDialogOpen) {
    closeSettingsDialog({ focusPrompt: false })
    return
  }
  openSettingsDialog()
})

$settingsDialogCloseBtn?.addEventListener("click", () => {
  closeSettingsDialog()
})

$settingsDialogDoneBtn?.addEventListener("click", () => {
  closeSettingsDialog()
})

$settingsSessionDoneDesktopNotificationsInput?.addEventListener(
  "change",
  (event) => {
    const input = event.currentTarget
    const nextEnabled =
      input instanceof HTMLInputElement
        ? input.checked
        : !state.sessionDoneDesktopNotificationsEnabled
    setSessionDoneDesktopNotificationsEnabled(nextEnabled, {
      requestPermission: nextEnabled,
    })
  }
)

$settingsSessionDoneSoundInput?.addEventListener("change", (event) => {
  const input = event.currentTarget
  const nextEnabled =
    input instanceof HTMLInputElement
      ? input.checked
      : !state.sessionDoneSoundEnabled
  setSessionDoneSoundEnabled(nextEnabled)
})

for (const button of $settingsThemeOptions) {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.themeOption)
  })
}

$commandPaletteInput?.addEventListener("input", () => {
  setCommandPaletteQuery($commandPaletteInput.value)
})

$commandPaletteInput?.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault()
    const command = commandPaletteCommands().filter((item) => {
      const query = state.commandPaletteQuery.trim().toLowerCase()
      if (!query) return true
      return `${item.title} ${item.description || ""} ${item.shortcutSearchText || ""}`
        .toLowerCase()
        .includes(query)
    })[0]
    if (!command) return
    await runCommandPaletteCommand(command)
  }
})

$openDirectoryInput?.addEventListener("input", () => {
  setDirectoryDialogQuery($openDirectoryInput.value)
})

$openDirectoryInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  const { manualPath, opened, current, recent, known } =
    directoryDialogViewModel()
  try {
    if (manualPath) {
      await openDirectoryPath(manualPath)
      return
    }
    if (opened[0]) {
      finalizeDirectoryAdd(opened[0])
      return
    }
    if (current[0]) {
      await openDirectoryPath(current[0])
      return
    }
    if (recent[0]) {
      await openDirectoryPath(recent[0])
      return
    }
    if (known[0]) {
      await openDirectoryPath(known[0])
    }
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "Failed to add directory.",
      "error"
    )
  }
})

$treeDialogInput?.addEventListener("input", () => {
  if (!state.treeDialog) return
  void setTreeDialogQuery($treeDialogInput.value)
})

$treeDialogInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  selectFocusedTreeDialogNode()
})

$treeDialogCustomInput?.addEventListener("input", () => {
  if (!state.treeDialog) return
  state.treeDialog = {
    ...state.treeDialog,
    customInstructions: $treeDialogCustomInput.value,
  }
})

$treeDialogCustomInput?.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault()
    const targetEntryId = state.treeDialog?.targetEntryId
    if (!targetEntryId) return
    await submitTreeDialog(targetEntryId, {
      summarize: true,
      customInstructions: $treeDialogCustomInput.value,
    })
  }
})

$treeDialogLabelInput?.addEventListener("input", () => {
  if (!state.treeDialog) return
  state.treeDialog = {
    ...state.treeDialog,
    labelDraft: $treeDialogLabelInput.value,
  }
})

$treeDialogLabelInput?.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault()
    await submitTreeDialogLabel()
  }
})

$treeDialogLabelCancelBtn?.addEventListener("click", () => {
  closeTreeDialogLabelEditor()
})

$treeDialogLabelCloseBtn?.addEventListener("click", () => {
  closeTreeDialogLabelEditor()
})

$treeDialogLabelSaveBtn?.addEventListener("click", () => {
  void submitTreeDialogLabel()
})

$treeDialogLabelOverlay?.addEventListener("click", (event) => {
  if (event.target === $treeDialogLabelOverlay) {
    closeTreeDialogLabelEditor()
  }
})

$forkDialogInput?.addEventListener("input", () => {
  if (!state.forkDialog) return
  setForkDialogQuery($forkDialogInput.value)
})

$forkDialogInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  const firstEntry = forkDialogEntries()[0]
  if (!firstEntry?.entryId) return
  await submitForkDialog(firstEntry.entryId)
})

$modelTrigger?.addEventListener("click", (event) => {
  event.stopPropagation()
  setComposerPopover("model")
})

$thinkingTrigger?.addEventListener("click", (event) => {
  event.stopPropagation()
  setComposerPopover("thinking")
})

$modelSearch?.addEventListener("input", () => {
  state.modelSearch = $modelSearch.value
  renderComposerControls()
})

$sidebarToggleBtn.addEventListener("click", () => {
  toggleSidebarVisibility()
})

$sidebarCloseBtn.addEventListener("click", () => {
  closeSidebar()
})

$sidebarBackdrop.addEventListener("click", () => {
  closeSidebar()
})

$prompt.addEventListener("beforeinput", (event) => {
  maybeDispatchComposerMobileModifiedBeforeInput(event)
})

$prompt.addEventListener("input", (event) => {
  if (maybeHandleComposerMobileModifiedInput(event)) {
    return
  }
  handleComposerInputChange()
})

bindComposerMobileTerminalButton($composerMobileEscapeBtn, () => {
  dispatchComposerMobileKey({ key: "Escape", code: "Escape" })
})

bindComposerMobileTerminalButton($composerMobileTabBtn, () => {
  dispatchComposerMobileKey({ key: "Tab", code: "Tab", preferPrompt: true })
})

bindComposerMobileTerminalButton($composerMobileCtrlBtn, () => {
  toggleComposerMobileModifier("ctrl")
})

bindComposerMobileTerminalButton($composerMobileOptionBtn, () => {
  toggleComposerMobileModifier("alt")
})

renderComposerMobileTerminalBar()

function isComposerSubmitShortcut(event) {
  return (
    event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey)
  )
}

$prompt.addEventListener("keydown", async (event) => {
  if (
    event.key === "Escape" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    isMobileViewport() &&
    state.sidebarDrawerOpenMobile
  ) {
    event.preventDefault()
    closeSidebar({ focusPrompt: true, immediateFocus: true })
    return
  }

  if (
    event.key === "Escape" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    dismissPathCompletion()
  ) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (isSessionLoading()) {
    if (!canEditComposerWhileLoading()) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault()
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      if (dismissSlashCommandQuery()) {
        event.stopPropagation()
      }
      return
    }

    if (isComposerSubmitShortcut(event)) {
      const slashAction = slashCommandAction()
      if (slashAction?.type === "execute-builtin") {
        event.preventDefault()
        return
      }
      if (slashAction?.type === "insert-skill") {
        event.preventDefault()
        insertSkillCommand(slashAction.skillName)
        return
      }

      const followUpBehavior = state.pendingDraftPrompt
        ? event.altKey
          ? "followUp"
          : "steer"
        : undefined
      event.preventDefault()
      await submitPromptOrQueue(followUpBehavior)
      return
    }
  }

  if (
    event.key === "Escape" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    dismissSlashCommandQuery()
  ) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const menuState = syncSlashCommandState()
  const selectedCommand = selectedSlashCommand(menuState)

  if (event.key === "Backspace" && state.composerSkill && !$prompt.value) {
    event.preventDefault()
    clearComposerSkill()
    return
  }

  if (event.key === "Escape" && state.streaming) {
    event.preventDefault()
    await abortStreamingResponse()
    return
  }

  if (
    (event.key === "ArrowDown" || event.key === "ArrowUp") &&
    isPathCompletionOpen()
  ) {
    event.preventDefault()
    movePathCompletionSelection(event.key === "ArrowDown" ? 1 : -1)
    return
  }

  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && menuState) {
    event.preventDefault()
    moveSlashCommandSelection(event.key === "ArrowDown" ? 1 : -1)
    return
  }

  if (
    event.key === "Tab" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    event.preventDefault()
    if (isPathCompletionOpen() && acceptSelectedPathCompletion()) {
      return
    }
    if (await requestFileReferenceCompletion({ acceptSingle: true })) {
      return
    }
    if (selectedCommand) {
      applySlashCommandCompletion(selectedCommand)
      return
    }
    await requestPathCompletion({ force: true, acceptSingle: true })
    return
  }

  if (
    event.key === "Enter" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    isPathCompletionOpen()
  ) {
    if (acceptSelectedPathCompletion()) {
      event.preventDefault()
      return
    }
  }

  if (isComposerSubmitShortcut(event)) {
    const slashAction = slashCommandAction()
    if (slashAction?.type === "execute-builtin") {
      event.preventDefault()
      await submitBuiltinSlashCommand(slashAction.command, slashAction.args)
      return
    }
    if (slashAction?.type === "insert-skill") {
      event.preventDefault()
      insertSkillCommand(slashAction.skillName)
      return
    }

    event.preventDefault()
    if (state.streaming || state.awaitingFirstTurn) {
      if (event.altKey) {
        await submitPrompt("followUp")
      } else {
        await submitPrompt("steer")
      }
      return
    }
    await submitPrompt()
  }
})

$prompt.addEventListener("paste", async (event) => {
  const hasImages = Array.from(event.clipboardData?.items || []).some(
    (item) => item.kind === "file" && /^image\//i.test(item.type)
  )
  if (!hasImages) return

  event.preventDefault()

  try {
    const images = await readClipboardImages(event.clipboardData)
    if (images.length === 0) return

    state.composerImages = [...state.composerImages, ...images]
    renderComposerImages()
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : "Clipboard image could not be read.",
      "error"
    )
  }
})

$composerEditorCard?.addEventListener("click", (event) => {
  const target = event.target
  if (
    target instanceof Element &&
    target.closest("button, input, textarea, select, a")
  ) {
    return
  }
  $prompt?.focus()
  if ($prompt) {
    const caret = $prompt.value.length
    $prompt.setSelectionRange(caret, caret)
  }
})

$messages.addEventListener("scroll", () => {
  handleMessagesScroll()
})

$changesView?.addEventListener("scroll", () => {
  renderComposerFooterShadow()
})

$scrollToBottomBtn?.addEventListener("click", () => {
  scrollToBottom()
})

$lastMessageBtn?.addEventListener("click", () => {
  scrollToLastMessage()
})

$messages.addEventListener(
  "wheel",
  (event) => {
    handleMessagesWheel(event)
  },
  { passive: true }
)

$dialogOverlay.addEventListener("click", (event) => {
  if (event.target === $dialogOverlay && state.dialog) {
    void dismissDialog({ cancelled: true })
  }
})

$dialogCloseBtn.addEventListener("click", () => {
  if (state.dialog) {
    void dismissDialog({ cancelled: true })
  }
})

$shortcutsDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === $shortcutsDialogOverlay) {
    closeShortcutsDialog()
  }
})

$shortcutsDialogCloseBtn?.addEventListener("click", () => {
  closeShortcutsDialog()
})

$treeDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === $treeDialogOverlay) {
    closeTreeDialog()
  }
})

$treeDialogCloseBtn?.addEventListener("click", () => {
  closeTreeDialog()
})

$treeDialogShortcutsTrigger?.addEventListener("click", () => {
  toggleTreeDialogShortcutsHelp()
})

$treeDialogShortcutsOverlay?.addEventListener("click", (event) => {
  if (event.target === $treeDialogShortcutsOverlay) {
    closeTreeDialogShortcutsHelp()
  }
})

$treeDialogShortcutsCloseBtn?.addEventListener("click", () => {
  closeTreeDialogShortcutsHelp()
})

$forkDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === $forkDialogOverlay) {
    closeForkDialog()
  }
})

$forkDialogCloseBtn?.addEventListener("click", () => {
  closeForkDialog()
})

$renameDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === $renameDialogOverlay) {
    closeRenameDialog()
  }
})

$renameDialogCloseBtn?.addEventListener("click", () => {
  closeRenameDialog()
})

$renameDialogCancelBtn?.addEventListener("click", () => {
  closeRenameDialog()
})

$renameDialogSaveBtn?.addEventListener("click", () => {
  void submitRenameDialog()
})

$renameDialogInput?.addEventListener("input", () => {
  if (!state.renameDialog) return
  state.renameDialog = {
    ...state.renameDialog,
    value: $renameDialogInput.value,
  }
  renderRenameDialog()
})

$renameDialogInput?.addEventListener("keydown", (event) => {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  event.preventDefault()
  void submitRenameDialog()
})

$confirmDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === $confirmDialogOverlay) {
    closeConfirmDialog()
  }
})

$confirmDialogCloseBtn?.addEventListener("click", () => {
  closeConfirmDialog()
})

$confirmDialogCancelBtn?.addEventListener("click", () => {
  closeConfirmDialog()
})

$confirmDialogConfirmBtn?.addEventListener("click", () => {
  closeConfirmDialog({ confirmed: true })
})

const { handleGlobalKeydown } = createShortcutHandlers({
  state,
  toggleSidebarVisibility,
  cycleThinkingLevel,
  openCommandPalette,
  createNewSessionInDirectory,
  defaultNewSessionDirectory,
  showToast,
  focusSessionSearch,
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
  openTreeDialog,
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
})

document.addEventListener(
  "keydown",
  (event) => {
    maybeDispatchComposerMobileModifiedKeyboardEvent(event)
  },
  { capture: true }
)

document.addEventListener("keydown", handleGlobalKeydown, { capture: true })

document.addEventListener(
  "pointerdown",
  () => {
    clearListNavigationFocus()
  },
  true
)

document.addEventListener("focusin", (event) => {
  if (!listNavigationFocusEl) return
  if (event.target === listNavigationFocusEl) return
  clearListNavigationFocus()
})

document.addEventListener("focusin", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !isPathCompletionOpen()) return
  if (target === $prompt || $pathCompletionMenu?.contains(target)) return
  dismissPathCompletion()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.openComposerPopover) return
  if (target === $modelTrigger || target === $thinkingTrigger) return
  if ($modelPopover?.contains(target) || $thinkingPopover?.contains(target))
    return
  if ($modelTrigger?.contains(target) || $thinkingTrigger?.contains(target))
    return
  closeComposerPopovers()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !isPathCompletionOpen()) return
  if ($prompt?.contains(target) || $pathCompletionMenu?.contains(target)) return
  dismissPathCompletion()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.openSessionMenuPath) return
  const refs = openSessionMenuRefs()
  if (refs?.trigger?.contains(target) || refs?.menuPortal?.contains(target))
    return
  closeSessionMenu()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.openDirectoryMenuPath) return
  const refs = openDirectoryMenuRefs()
  if (
    refs?.trigger?.contains(target) ||
    refs?.menuPortal?.contains(target) ||
    refs?.actions?.contains(target)
  )
    return
  closeDirectoryMenu()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.headerSessionMenuOpen) return
  if (
    $headerSessionMenuTrigger?.contains(target) ||
    headerSessionMenuPortal.contains(target)
  )
    return
  closeHeaderSessionMenu()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.commandPaletteOpen) return
  if (
    target instanceof Element &&
    target.closest("#command-palette-overlay .dialog-card")
  )
    return
  closeCommandPalette()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.directoryDialogOpen) return
  if (
    target instanceof Element &&
    target.closest("#open-directory-overlay .dialog-card")
  )
    return
  closeDirectoryDialog()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.statusDialogOpen) return
  if (
    target instanceof Element &&
    target.closest("#status-dialog-overlay .dialog-card")
  )
    return
  closeStatusDialog()
})

document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Node) || !state.settingsDialogOpen) return
  if (
    target instanceof Element &&
    target.closest("#settings-dialog-overlay .dialog-card")
  )
    return
  if (
    target === $sidebarSettingsBtn ||
    (target instanceof Element && $sidebarSettingsBtn?.contains(target))
  )
    return
  closeSettingsDialog()
})

window.addEventListener("resize", () => {
  if (!isMobileViewport() && state.sidebarDrawerOpenMobile) {
    closeSidebarDrawerOnMobile(state)
    syncSidebarLayout()
  }
  syncToastContainerOffset()
  renderScrollToBottomButton()
})

document.addEventListener(
  "visibilitychange",
  syncBackgroundCurrentSessionUnread
)
window.addEventListener("focus", syncBackgroundCurrentSessionUnread)
window.addEventListener("blur", syncBackgroundCurrentSessionUnread)

window.addEventListener("popstate", () => {
  startSessionLoading(
    sessionSummaryById(currentUrlSessionId()) || {
      sessionId: currentUrlSessionId(),
      name: currentUrlSessionId() ? undefined : "Current session",
      cwd: currentUrlSessionId() ? undefined : state.cwd,
    }
  )
  connect()
})

function handleSystemThemeChange() {
  if (state.theme !== "system") return
  applyTheme("system", { persist: false })
}

if (systemThemeMedia) {
  if (typeof systemThemeMedia.addEventListener === "function") {
    systemThemeMedia.addEventListener("change", handleSystemThemeChange)
  } else if (typeof systemThemeMedia.addListener === "function") {
    systemThemeMedia.addListener(handleSystemThemeChange)
  }
}

applyTheme(state.theme, { persist: false })
installSessionDoneAudioPriming()
installSessionDoneDesktopNotificationPermissionPrompt()
if (currentUrlSessionId()) {
  startSessionLoading({ sessionId: currentUrlSessionId() })
} else {
  render()
}
connect()
requestAnimationFrame(() => {
  $prompt?.focus()
})
