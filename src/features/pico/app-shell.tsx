import * as React from "react"
import { Throttler } from "@tanstack/pacer"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { AppShellFloatingControllers } from "@/features/pico/app-shell-floating-controllers"
import { AppShellTabsController } from "@/features/pico/app-shell-desktop-layout"
import {
  AppShellSessionHeader,
  type AppShellSessionHeaderActions,
} from "@/features/pico/app-shell-session-header"
import { AppShellSidebarController } from "@/features/pico/app-shell-sidebar-controller"
import { AppShellWindowEffectsHost } from "@/features/pico/app-shell-window-effects"
import type { AppShellAddDirectoryDialogHandle } from "@/features/pico/app-shell-add-directory-dialog"
import type { AppShellAuthDialogHandle } from "@/features/pico/app-shell-auth-dialog"
import type {
  AppCommand,
  AppShellCommandPaletteHandle,
} from "@/features/pico/app-shell-command-palette"
import type { AppShellSessionsDialogHandle } from "@/features/pico/app-shell-sessions-dialog"
import type { AppShellSettingsDialogHandle } from "@/features/pico/app-shell-settings-dialog"
import type {
  DeleteOldDirectorySessionsDialogHandle,
  DeleteSessionsDialogHandle,
  ForkSessionDialogHandle,
  RenameSessionDialogHandle,
} from "@/features/pico/app-shell-session-dialogs"
import type { AppShellTreeDialogHandle } from "@/features/pico/app-shell-tree-dialog"
import type { AppShellUiRequestDialogHandle } from "@/features/pico/app-shell-ui-request-dialog"
import {
  findSidebarSessionSelectionKey,
  getCurrentSessionTitleFromState,
  sameStringArray,
  sessionNotificationKey,
  sessionScrollKey,
  shallowRecordEqual,
  useLatestRef,
} from "@/features/pico/app-shell-common"
import {
  EMPTY_COMPOSER_IMAGES,
  EMPTY_COMPOSER_PENDING_MESSAGES,
  createInitialAppShellComposerSnapshot,
  createOptimisticDraftSessionState,
  createOptimisticPendingId,
  insertOptimisticUserItem,
  movePendingDraftFollowUpMessage,
  pendingDraftFollowUpId,
  removeOptimisticUserItem,
  sameAppShellComposerSnapshot,
  type AppShellComposerActions,
  type AppShellComposerSnapshot,
  type PendingComposerMessage,
  type UserConversationItem,
} from "@/features/pico/app-shell-composer-state"
import {
  createConversationItemsStore,
  type ConversationItemsStore,
} from "@/features/pico/app-shell-conversation-store"
import type { AppShellConversationFrameHandle } from "@/features/pico/app-shell-conversation"
import {
  closeAllRightSidebarFiles,
  closeOtherRightSidebarFiles,
  closeRightSidebarFile,
  closeRightSidebarFilesToRight,
  createInitialRightSidebarState,
  openRightSidebarFile,
  reorderRightSidebarFiles,
  resetRightSidebarFiles,
  setRightSidebarActiveTab,
  type AppShellRightSidebarState,
  type OpenFileViewTabOptions,
} from "@/features/pico/app-shell-right-sidebar-state"
import {
  createAppShellSidebarStore,
  mergeSidebarSessionStatusMap,
  useAppShellSidebarValue,
  type AppShellSidebarStore,
} from "@/features/pico/app-shell-sidebar-store"
import type {
  AppShellDisplaySettingsState,
  AppShellDraftFlowState,
  AppShellNotificationState,
  AppShellSessionWorkspaceHandle,
  AppShellUiState,
  CreateSessionOptions,
  SelectSessionNavigationOptions,
} from "@/features/pico/app-shell-types"
import {
  COMPACT_CANCELLED_LABEL,
  COMPACT_WORKING_LABEL,
  sameWorkingState,
  type AppShellWorkingState,
} from "@/features/pico/app-shell-working-state"
import {
  buildRequestUrl,
  fetchJson,
  readFileAsPromptImage,
} from "@/features/pico/app-shell-utils"
import type { ComposerPanelHandle } from "@/features/pico/composer-panel"
import type { ComposerContextUsageStore } from "@/features/pico/composer-context-usage-indicator"
import {
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pico/composer-utils"
import { showGitPushSuccessToast } from "@/features/pico/git-toast-utils"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import {
  createPicoLatestThrottler,
  type PicoLatestThrottler,
} from "@/features/pico/pacer-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import type {
  GitCommitDialogControllerHandle,
  GitRemoteAction,
} from "@/features/pico/right-sidebar-types"
import {
  getDesktopNotificationPermission,
  primeSessionDoneSound,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from "@/features/pico/session-done-notifications"
import { useAppShellPromptMutations } from "@/features/pico/use-app-shell-prompt-mutations"
import { usePicoTheme } from "@/features/pico/use-pico-theme"
import { useAppShellSessionMutations } from "@/features/pico/use-app-shell-session-mutations"
import { useAppShellSessionSync } from "@/features/pico/use-app-shell-session-sync"
import {
  useAppShellShortcuts,
  type AppShellShortcutState,
} from "@/features/pico/use-app-shell-shortcuts"
import {
  applyStoreAction,
  batch,
  createPicoStore,
  setStoreField,
  setStoreState,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  AUTO_SCROLL_ENABLED_STORAGE_KEY,
  CENTER_MESSAGES_STORAGE_KEY,
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  PINNED_SESSIONS_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  createContextId,
  createInitialSessionState,
  getSessionTitle,
  normalizeSessionSelectionKeys,
  normalizeStoredDirectoryList,
  promptDraftKey,
  readStoredAutoScrollEnabled,
  readStoredCenterMessages,
  readStoredDraftDirectory,
  readStoredHideToolBlocks,
  readStoredPinnedSessionKeys,
  readStoredRecentDirectories,
  readStoredRightSidebarOpen,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  rememberStoredPromptDraft,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/pico"
import type {
  ConversationItem,
  PromptImage,
  SessionState,
  StreamingBehavior,
  ThemeColorMode,
  ThemeFamily,
} from "@/lib/pico"
import type {
  ExtensionUiEvent,
  GitActionResponse,
  SessionDoneEvent,
  SessionListEntry,
  SessionStatusEvent,
} from "@/lib/pico/api"

const INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT = 6
type AppShellController = {
  stores: {
    appUi: PicoStore<AppShellUiState>
    composer: PicoStore<AppShellComposerSnapshot>
    contextUsage: ComposerContextUsageStore
    conversationItems: ConversationItemsStore
    displaySettings: PicoStore<AppShellDisplaySettingsState>
    draftFlow: PicoStore<AppShellDraftFlowState>
    notification: PicoStore<AppShellNotificationState>
    rightSidebar: PicoStore<AppShellRightSidebarState>
    session: PicoStore<SessionState>
    sidebar: AppShellSidebarStore
  }
  refs: {
    composerImages: React.RefObject<Array<PromptImage>>
    composerPanel: React.RefObject<ComposerPanelHandle | null>
    composerSkill: React.RefObject<string | undefined>
    composerText: React.RefObject<string>
    conversationFrame: React.RefObject<AppShellConversationFrameHandle | null>
    sessionState: React.RefObject<SessionState>
  }
  actions: AppShellSessionWorkspaceHandle & {
    focusModelSelector: () => void
    focusPrompt: () => void
    focusSessionSearch: () => void
  }
}

type AppShellSessionWorkspaceProps = {
  viewerContextId: string
  sessionId?: string
  onSelectSession?: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
  sidebar: React.ReactNode
  sidebarStore: AppShellSidebarStore
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>
}

function AppShellSessionWorkspace({
  viewerContextId,
  sessionId,
  onSelectSession,
  sidebar,
  sidebarStore,
  sessionSearchInputRef,
  ref,
}: AppShellSessionWorkspaceProps & {
  ref?: React.Ref<AppShellSessionWorkspaceHandle>
}) {
  const queryClient = useQueryClient()
  const initialSessionStateRef = React.useRef<SessionState | null>(null)
  if (!initialSessionStateRef.current) {
    initialSessionStateRef.current = createInitialSessionState()
  }
  const sessionStoreRef = React.useRef<PicoStore<SessionState> | null>(null)
  if (!sessionStoreRef.current) {
    sessionStoreRef.current = createPicoStore(initialSessionStateRef.current)
  }
  const sessionStore = sessionStoreRef.current
  const sessionStateRef = React.useRef(sessionStore.state)
  const appUiStoreRef = React.useRef<PicoStore<AppShellUiState> | null>(null)
  if (!appUiStoreRef.current) {
    appUiStoreRef.current = createPicoStore<AppShellUiState>(
      {
        currentTab: "session",
        gitPanelOpen: false,
        initialLoadingSessionId: sessionId || null,
        loadingSessionId: null,
      },
      shallowRecordEqual
    )
  }
  const appUiStore = appUiStoreRef.current
  const rightSidebarStoreRef =
    React.useRef<PicoStore<AppShellRightSidebarState> | null>(null)
  if (!rightSidebarStoreRef.current) {
    rightSidebarStoreRef.current = createPicoStore(
      createInitialRightSidebarState()
    )
  }
  const rightSidebarStore = rightSidebarStoreRef.current
  const setCurrentTab = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (action) => {
      setStoreField(appUiStore, "currentTab", action)
    },
    [appUiStore]
  )
  const setGitPanelOpen = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const nextOpen = applyStoreAction(appUiStore.state.gitPanelOpen, action)
      setStoreField(appUiStore, "gitPanelOpen", nextOpen)
      safeLocalStorageSetItem(
        RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
        nextOpen ? "1" : "0"
      )
    },
    [appUiStore]
  )
  const setLoadingSessionId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(appUiStore, "loadingSessionId", action)
    },
    [appUiStore]
  )
  const setInitialLoadingSessionId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(appUiStore, "initialLoadingSessionId", action)
    },
    [appUiStore]
  )
  const previousRouteSessionIdRef = React.useRef(sessionId)
  const composerDraftSeedStoreRef = React.useRef<PicoStore<{
    text: string
    skillName?: string
    syncNonce: number
  }> | null>(null)
  if (!composerDraftSeedStoreRef.current) {
    composerDraftSeedStoreRef.current = createPicoStore({
      text: "",
      syncNonce: 0,
    })
  }
  const composerDraftSeedStore = composerDraftSeedStoreRef.current
  const composerImagesStoreRef = React.useRef<PicoStore<
    Array<PromptImage>
  > | null>(null)
  if (!composerImagesStoreRef.current) {
    composerImagesStoreRef.current = createPicoStore<Array<PromptImage>>([])
  }
  const composerImagesStore = composerImagesStoreRef.current
  const composerImagesRef = React.useRef<Array<PromptImage>>([])
  const displaySettingsStoreRef =
    React.useRef<PicoStore<AppShellDisplaySettingsState> | null>(null)
  if (!displaySettingsStoreRef.current) {
    displaySettingsStoreRef.current =
      createPicoStore<AppShellDisplaySettingsState>(
        {
          autoScrollEnabled: true,
          centerMessages: false,
          hideToolBlocks: false,
        },
        shallowRecordEqual
      )
  }
  const displaySettingsStore = displaySettingsStoreRef.current!
  const displaySettingsRef = React.useRef(displaySettingsStore.state)
  const hideToolBlocksRef = React.useRef(
    displaySettingsStore.state.hideToolBlocks
  )
  const setHideToolBlocks = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.state
      const nextHideToolBlocks = applyStoreAction(
        current.hideToolBlocks,
        action
      )
      if (nextHideToolBlocks === current.hideToolBlocks) return
      const next = { ...current, hideToolBlocks: nextHideToolBlocks }
      displaySettingsRef.current = next
      hideToolBlocksRef.current = next.hideToolBlocks
      setStoreState(displaySettingsStore, next)
    },
    [displaySettingsStore]
  )
  const setCenterMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.state
      const nextCenterMessages = applyStoreAction(
        current.centerMessages,
        action
      )
      if (nextCenterMessages === current.centerMessages) return
      const next = { ...current, centerMessages: nextCenterMessages }
      displaySettingsRef.current = next
      setStoreState(displaySettingsStore, next)
    },
    [displaySettingsStore]
  )
  const setAutoScrollEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.state
      const nextAutoScrollEnabled = applyStoreAction(
        current.autoScrollEnabled,
        action
      )
      if (nextAutoScrollEnabled === current.autoScrollEnabled) return
      const next = { ...current, autoScrollEnabled: nextAutoScrollEnabled }
      displaySettingsRef.current = next
      setStoreState(displaySettingsStore, next)
    },
    [displaySettingsStore]
  )
  const awaitingFirstTurnStoreRef = React.useRef<PicoStore<boolean> | null>(
    null
  )
  if (!awaitingFirstTurnStoreRef.current) {
    awaitingFirstTurnStoreRef.current = createPicoStore(false)
  }
  const awaitingFirstTurnStore = awaitingFirstTurnStoreRef.current
  const pendingDraftPromptStoreRef = React.useRef<PicoStore<{
    ownerKey: string
    message: string
    images: Array<PromptImage>
    streamingBehavior?: StreamingBehavior
    optimisticId?: string
  } | null> | null>(null)
  if (!pendingDraftPromptStoreRef.current) {
    pendingDraftPromptStoreRef.current = createPicoStore<{
      ownerKey: string
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      optimisticId?: string
    } | null>(null)
  }
  const pendingDraftPromptStore = pendingDraftPromptStoreRef.current
  const pendingDraftFollowUpsStoreRef = React.useRef<PicoStore<
    Array<{
      message: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
      optimisticId?: string
    }>
  > | null>(null)
  if (!pendingDraftFollowUpsStoreRef.current) {
    pendingDraftFollowUpsStoreRef.current = createPicoStore<
      Array<{
        message: string
        images: Array<PromptImage>
        streamingBehavior: "steer" | "followUp"
        optimisticId?: string
      }>
    >([])
  }
  const pendingDraftFollowUpsStore = pendingDraftFollowUpsStoreRef.current
  const isSubmittingStoreRef = React.useRef<PicoStore<boolean> | null>(null)
  if (!isSubmittingStoreRef.current) {
    isSubmittingStoreRef.current = createPicoStore(false)
  }
  const isSubmittingStore = isSubmittingStoreRef.current
  const pendingMessagesStoreRef = React.useRef<PicoStore<
    Array<PendingComposerMessage>
  > | null>(null)
  if (!pendingMessagesStoreRef.current) {
    pendingMessagesStoreRef.current = createPicoStore<
      Array<PendingComposerMessage>
    >([])
  }
  const pendingMessagesStore = pendingMessagesStoreRef.current
  const notificationStoreRef =
    React.useRef<PicoStore<AppShellNotificationState> | null>(null)
  if (!notificationStoreRef.current) {
    notificationStoreRef.current = createPicoStore<AppShellNotificationState>(
      {
        desktopNotificationPermission: "unsupported",
        sessionDoneDesktopNotificationsEnabled: true,
        sessionDoneEvents: [],
        sessionDoneSoundEnabled: true,
      },
      shallowRecordEqual
    )
  }
  const notificationStore = notificationStoreRef.current!
  const setSessionDoneEvents = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<SessionDoneEvent>>>
  >(
    (action) => {
      setStoreField(notificationStore, "sessionDoneEvents", action)
    },
    [notificationStore]
  )
  const setSessionDoneSoundEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setStoreField(notificationStore, "sessionDoneSoundEnabled", action)
    },
    [notificationStore]
  )
  const setSessionDoneDesktopNotificationsEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setStoreField(
        notificationStore,
        "sessionDoneDesktopNotificationsEnabled",
        action
      )
    },
    [notificationStore]
  )
  const setDesktopNotificationPermission = React.useCallback<
    React.Dispatch<React.SetStateAction<DesktopNotificationPermission>>
  >(
    (action) => {
      setStoreField(notificationStore, "desktopNotificationPermission", action)
    },
    [notificationStore]
  )
  const draftFlowStoreRef =
    React.useRef<PicoStore<AppShellDraftFlowState> | null>(null)
  if (!draftFlowStoreRef.current) {
    draftFlowStoreRef.current = createPicoStore<AppShellDraftFlowState>(
      {
        draftSessionLoadingOwnerKey: null,
        storedDraftDirectory: "",
      },
      shallowRecordEqual
    )
  }
  const draftFlowStore = draftFlowStoreRef.current!
  const setDraftSessionLoadingOwnerKey = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(draftFlowStore, "draftSessionLoadingOwnerKey", action)
    },
    [draftFlowStore]
  )
  const setStoredDraftDirectory = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (action) => {
      setStoreField(draftFlowStore, "storedDraftDirectory", action)
    },
    [draftFlowStore]
  )
  const recentDirectoriesStoreRef = React.useRef<PicoStore<
    Array<string>
  > | null>(null)
  if (!recentDirectoriesStoreRef.current) {
    recentDirectoriesStoreRef.current = createPicoStore<Array<string>>(
      [],
      sameStringArray
    )
  }
  const recentDirectoriesStore = recentDirectoriesStoreRef.current
  const setRecentDirectories = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<string>>>
  >(
    (action) => {
      const current = recentDirectoriesStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      setStoreState(recentDirectoriesStore, next)
    },
    [recentDirectoriesStore]
  )
  const { isMobile, openMobile, openMobileSettled, setOpenMobile } =
    useSidebar()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const composerPanelRef = React.useRef<ComposerPanelHandle | null>(null)
  const composerStoreRef =
    React.useRef<PicoStore<AppShellComposerSnapshot> | null>(null)
  if (!composerStoreRef.current) {
    composerStoreRef.current = createPicoStore(
      createInitialAppShellComposerSnapshot(viewerContextId),
      sameAppShellComposerSnapshot
    )
  }
  const composerStore = composerStoreRef.current
  const contextUsageStoreRef = React.useRef<PicoStore<
    SessionState["contextUsage"]
  > | null>(null)
  if (!contextUsageStoreRef.current) {
    contextUsageStoreRef.current =
      createPicoStore<SessionState["contextUsage"]>(undefined)
  }
  const contextUsageStore = contextUsageStoreRef.current
  const contextUsageThrottlerRef = React.useRef<Throttler<
    (contextUsage: SessionState["contextUsage"]) => void
  > | null>(null)
  if (!contextUsageThrottlerRef.current) {
    contextUsageThrottlerRef.current = new Throttler(
      (contextUsage: SessionState["contextUsage"]) => {
        setStoreState(contextUsageStore, contextUsage)
      },
      {
        key: "pico.composer.context-usage",
        wait: 250,
        leading: true,
        trailing: true,
      }
    )
  }
  const contextUsageThrottler = contextUsageThrottlerRef.current
  React.useEffect(
    () => () => {
      contextUsageThrottler.flush()
      contextUsageThrottler.cancel()
    },
    [contextUsageThrottler]
  )
  const setComposerDraftSeed = React.useCallback<
    React.Dispatch<
      React.SetStateAction<{
        text: string
        skillName?: string
        syncNonce: number
      }>
    >
  >(
    (action) => {
      const current = composerDraftSeedStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(composerDraftSeedStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          composerSkill: currentComposerSnapshot.disabled
            ? undefined
            : next.skillName,
          composerSyncNonce: next.syncNonce,
          composerText: currentComposerSnapshot.disabled ? "" : next.text,
        })
      })
    },
    [composerDraftSeedStore, composerStore]
  )
  const setComposerImages = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  >(
    (action) => {
      const current = composerImagesStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      composerImagesRef.current = next
      batch(() => {
        setStoreState(composerImagesStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          composerImages: currentComposerSnapshot.disabled ? [] : next,
        })
      })
    },
    [composerImagesStore, composerStore]
  )
  const setComposerContextUsage = React.useCallback(
    (contextUsage: SessionState["contextUsage"]) => {
      contextUsageThrottler.maybeExecute(contextUsage)
    },
    [contextUsageThrottler]
  )
  const setComposerStreaming = React.useCallback(
    (streaming: boolean) => {
      const currentComposerSnapshot = composerStore.state
      setStoreState(composerStore, {
        ...currentComposerSnapshot,
        isStreaming: currentComposerSnapshot.disabled ? false : streaming,
      })
    },
    [composerStore]
  )
  const commandPaletteRef = React.useRef<AppShellCommandPaletteHandle | null>(
    null
  )
  const commandPaletteOpenRef = React.useRef(false)
  const addDirectoryDialogRef =
    React.useRef<AppShellAddDirectoryDialogHandle | null>(null)
  const addDirectoryOpenRef = React.useRef(false)
  const moveSessionDirectoryDialogRef =
    React.useRef<AppShellAddDirectoryDialogHandle | null>(null)
  const moveSessionDirectoryOpenRef = React.useRef(false)
  const moveSessionDirectoryTargetRef = React.useRef<SessionListEntry | null>(
    null
  )
  const renameDialogRef = React.useRef<RenameSessionDialogHandle | null>(null)
  const renameOpenRef = React.useRef(false)
  const deleteDialogRef = React.useRef<DeleteSessionsDialogHandle | null>(null)
  const deleteOpenRef = React.useRef(false)
  const deleteOldDirectorySessionsDialogRef =
    React.useRef<DeleteOldDirectorySessionsDialogHandle | null>(null)
  const deleteOldDirectorySessionsOpenRef = React.useRef(false)
  const forkDialogRef = React.useRef<ForkSessionDialogHandle | null>(null)
  const forkOpenRef = React.useRef(false)
  const treeDialogRef = React.useRef<AppShellTreeDialogHandle | null>(null)
  const treeOpenRef = React.useRef(false)
  const gitCommitDialogRef =
    React.useRef<GitCommitDialogControllerHandle | null>(null)
  const gitCommitOpenRef = React.useRef(false)
  const sessionsDialogRef = React.useRef<AppShellSessionsDialogHandle | null>(
    null
  )
  const sessionsOpenRef = React.useRef(false)
  const settingsDialogRef = React.useRef<AppShellSettingsDialogHandle | null>(
    null
  )
  const settingsOpenRef = React.useRef(false)
  const authDialogRef = React.useRef<AppShellAuthDialogHandle | null>(null)
  const authOpenRef = React.useRef(false)
  const uiRequestDialogRef = React.useRef<AppShellUiRequestDialogHandle | null>(
    null
  )
  const uiRequestOpenRef = React.useRef(false)
  const conversationFrameRef =
    React.useRef<AppShellConversationFrameHandle | null>(null)
  const lastSyncedEditorTextRef = React.useRef("")
  const setSessionState = React.useCallback<
    React.Dispatch<React.SetStateAction<SessionState>>
  >(
    (action) => {
      const currentRefState = sessionStateRef.current
      const nextState =
        typeof action === "function"
          ? (action as (current: SessionState) => SessionState)(currentRefState)
          : action
      const currentStoreState = sessionStore.state
      if (
        Object.is(currentRefState, nextState) &&
        Object.is(currentStoreState, nextState)
      ) {
        return
      }

      sessionStateRef.current = nextState
      setStoreState(sessionStore, nextState)
    },
    [sessionStore]
  )
  const composerTextRef = React.useRef(composerDraftSeedStore.state.text)
  const composerSkillRef = React.useRef<string | undefined>(
    composerDraftSeedStore.state.skillName
  )
  const pendingRouteSessionIdRef = React.useRef<string | undefined>(undefined)
  const pendingRouteSessionPathRef = React.useRef<string | undefined>(undefined)
  const pendingUiRequestHandlerRef = React.useRef(
    (_request: ExtensionUiEvent) => {}
  )
  pendingUiRequestHandlerRef.current = (request) => {
    uiRequestDialogRef.current?.open(request)
  }
  const autoAddedSessionDirectoryKeysRef = React.useRef<Set<string>>(new Set())
  const pendingMobileSidebarPromptFocusRef = React.useRef(false)
  const conversationItemsStoreRef = React.useRef<ConversationItemsStore | null>(
    null
  )
  if (!conversationItemsStoreRef.current) {
    conversationItemsStoreRef.current = createConversationItemsStore(
      sessionStateRef.current.items
    )
  }
  const conversationItemsStore = conversationItemsStoreRef.current
  const hiddenThinkingPreviewStoreRef = React.useRef<PicoStore<string> | null>(
    null
  )
  if (!hiddenThinkingPreviewStoreRef.current) {
    hiddenThinkingPreviewStoreRef.current = createPicoStore<string>(
      sessionStateRef.current.hiddenThinkingPreview || ""
    )
  }
  const hiddenThinkingPreviewStore = hiddenThinkingPreviewStoreRef.current
  const workingStateStoreRef =
    React.useRef<PicoStore<AppShellWorkingState | null> | null>(null)
  if (!workingStateStoreRef.current) {
    workingStateStoreRef.current = createPicoStore<AppShellWorkingState | null>(
      null,
      sameWorkingState
    )
  }
  const workingStateStore = workingStateStoreRef.current
  const compactRunningRef = React.useRef(false)
  const compactAbortRequestedRef = React.useRef(false)
  const setCompactRunningState = React.useCallback((running: boolean) => {
    compactRunningRef.current = running
    if (running) {
      compactAbortRequestedRef.current = false
    }
  }, [])
  const setAwaitingFirstTurn = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = awaitingFirstTurnStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(awaitingFirstTurnStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          awaitingFirstTurn: currentComposerSnapshot.disabled ? false : next,
        })
        if (next && !sessionStateRef.current.streaming) {
          setStoreState(workingStateStore, {
            label: "Waiting for first response…",
          })
        } else if (
          !next &&
          workingStateStore.state?.label === "Waiting for first response…"
        ) {
          setStoreState(workingStateStore, null)
        }
      })
    },
    [awaitingFirstTurnStore, composerStore, workingStateStore]
  )
  const setIsSubmitting = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = isSubmittingStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(isSubmittingStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          isSubmitting: currentComposerSnapshot.disabled ? false : next,
        })
      })
    },
    [composerStore, isSubmittingStore]
  )
  const refreshComposerPendingMessages = React.useCallback(() => {
    const pendingDraftFollowUpMessages = pendingDraftFollowUpsStore.state.map(
      (message, index) => ({
        pendingId: message.optimisticId || `pending-draft:${index}`,
        text: message.message,
        images: message.images,
        streamingBehavior: message.streamingBehavior,
      })
    )
    const currentComposerSnapshot = composerStore.state
    setStoreState(composerStore, {
      ...currentComposerSnapshot,
      currentPendingMessages: currentComposerSnapshot.disabled
        ? []
        : [...pendingDraftFollowUpMessages, ...pendingMessagesStore.state],
    })
  }, [composerStore, pendingDraftFollowUpsStore, pendingMessagesStore])
  const setPendingDraftPrompt = React.useCallback<
    React.Dispatch<
      React.SetStateAction<{
        ownerKey: string
        message: string
        images: Array<PromptImage>
        streamingBehavior?: StreamingBehavior
        optimisticId?: string
      } | null>
    >
  >(
    (action) => {
      const current = pendingDraftPromptStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(pendingDraftPromptStore, next)
        if (next) {
          setStoreState(workingStateStore, {
            label: "Waiting for new session…",
          })
        } else if (
          workingStateStore.state?.label === "Waiting for new session…"
        ) {
          setStoreState(workingStateStore, null)
        }
      })
    },
    [pendingDraftPromptStore, workingStateStore]
  )
  const setPendingDraftFollowUps = React.useCallback<
    React.Dispatch<
      React.SetStateAction<
        Array<{
          message: string
          images: Array<PromptImage>
          streamingBehavior: "steer" | "followUp"
          optimisticId?: string
        }>
      >
    >
  >(
    (action) => {
      const current = pendingDraftFollowUpsStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(pendingDraftFollowUpsStore, next)
        refreshComposerPendingMessages()
      })
    },
    [pendingDraftFollowUpsStore, refreshComposerPendingMessages]
  )
  const setPendingMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<PendingComposerMessage>>>
  >(
    (action) => {
      const current = pendingMessagesStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(pendingMessagesStore, next)
        refreshComposerPendingMessages()
      })
    },
    [pendingMessagesStore, refreshComposerPendingMessages]
  )
  const conversationItemsThrottlerRef = React.useRef<PicoLatestThrottler<
    Array<ConversationItem>
  > | null>(null)
  if (!conversationItemsThrottlerRef.current) {
    conversationItemsThrottlerRef.current = createPicoLatestThrottler({
      key: "pico.conversation.streaming-items",
      wait: 16,
      onLatest: (items: Array<ConversationItem>) => {
        conversationItemsStore.setItems(items)
      },
    })
  }
  const conversationItemsThrottler = conversationItemsThrottlerRef.current
  const setConversationItems = React.useCallback(
    (items: Array<ConversationItem>) => {
      const hasStreamingAssistant = items.some(
        (item) => item.kind === "assistant" && item.streaming
      )

      if (hasStreamingAssistant && typeof window !== "undefined") {
        conversationItemsThrottler.add(items)
        return
      }

      conversationItemsThrottler.cancel()
      conversationItemsStore.setItems(items)
    },
    [conversationItemsThrottler, conversationItemsStore]
  )

  React.useEffect(
    () => () => {
      conversationItemsThrottler.flush()
      conversationItemsThrottler.cancel()
    },
    [conversationItemsThrottler]
  )
  const setHiddenThinkingPreview = React.useCallback(
    (value: string, options?: { preserveExisting?: boolean }) => {
      if (options?.preserveExisting && !value) return
      setStoreState(hiddenThinkingPreviewStore, value)
    },
    [hiddenThinkingPreviewStore]
  )
  const setWorkingState = React.useCallback(
    (state: AppShellWorkingState | null) => {
      setStoreState(workingStateStore, state)
    },
    [workingStateStore]
  )
  const addOptimisticUserMessage = React.useCallback(
    (options: {
      message: string
      images: Array<PromptImage>
      queued: boolean
      streamingBehavior?: StreamingBehavior
    }) => {
      const pendingId = createOptimisticPendingId()
      const item = {
        kind: "user",
        itemKey: `pending:${pendingId}`,
        pendingId,
        text: options.message,
        images: options.images.map((image) => ({ ...image })),
        queued: options.queued,
        streamingBehavior: options.streamingBehavior,
      } satisfies UserConversationItem

      const currentState = sessionStateRef.current
      const nextItems = insertOptimisticUserItem(currentState.items, item)
      if (nextItems !== currentState.items) {
        const nextState = { ...currentState, items: nextItems }
        sessionStateRef.current = nextState
        conversationItemsStore.setItems(nextItems)
        setSessionState(nextState)
      }

      return pendingId
    },
    [conversationItemsStore]
  )
  const removeOptimisticUserMessage = React.useCallback(
    (pendingId: string | undefined) => {
      if (!pendingId) return

      const currentState = sessionStateRef.current
      const nextItems = removeOptimisticUserItem(currentState.items, pendingId)
      if (nextItems === currentState.items) return

      const nextState = { ...currentState, items: nextItems }
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextItems)
      setSessionState(nextState)
    },
    [conversationItemsStore]
  )

  const {
    colorMode: currentThemeColorMode,
    previewThemeFamily,
    setColorMode,
    setThemeFamily,
    systemTheme,
    themeFamily: currentTheme,
  } = usePicoTheme()
  const { initialLoadingSessionId, loadingSessionId } = useSelector(
    appUiStore,
    (state) => ({
      initialLoadingSessionId: state.initialLoadingSessionId,
      loadingSessionId: state.loadingSessionId,
    }),
    { compare: shallowRecordEqual }
  )
  const { draftSessionLoadingOwnerKey, storedDraftDirectory } =
    useSelector(draftFlowStore)
  const sessionState = useSelector(
    sessionStore,
    (currentSessionState) => ({
      cwd: currentSessionState.cwd,
      draft: currentSessionState.draft,
      sessionFile: currentSessionState.sessionFile,
      sessionId: currentSessionState.sessionId,
      sessionKey: currentSessionState.sessionKey,
    }),
    { compare: shallowRecordEqual }
  )
  const setSidebarActiveSession = React.useCallback(
    (activeSession: {
      draft?: boolean
      sessionFile?: string
      sessionId?: string
      sessionKey?: string
      sessionPath?: string
    }) => {
      const activeSidebarSessionId = activeSession.draft
        ? ""
        : activeSession.sessionId?.trim() || ""
      const activeSidebarSessionPath = activeSession.draft
        ? ""
        : (activeSession.sessionFile || activeSession.sessionPath || "").trim()
      const activeSidebarSessionKey = activeSession.draft
        ? ""
        : sessionNotificationKey({
            sessionFile: activeSidebarSessionPath,
            sessionId: activeSidebarSessionId,
          }) ||
          activeSession.sessionKey?.trim() ||
          ""

      sidebarStore.setSidebarState((current) => {
        if (
          current.activeSidebarSessionId === activeSidebarSessionId &&
          current.activeSidebarSessionKey === activeSidebarSessionKey &&
          current.activeSidebarSessionPath === activeSidebarSessionPath
        ) {
          return current
        }

        return {
          activeSidebarSessionId,
          activeSidebarSessionKey,
          activeSidebarSessionPath,
        }
      })
    },
    [sidebarStore]
  )

  React.useLayoutEffect(() => {
    setSidebarActiveSession(sessionState)
  }, [sessionState, setSidebarActiveSession])

  const gitPanelOpen = useSelector(appUiStore, (state) => state.gitPanelOpen)

  const openFileViewTab = (path: string, options?: OpenFileViewTabOptions) => {
    if (!path) return
    batch(() => {
      setGitPanelOpen(true)
      openRightSidebarFile(rightSidebarStore, path, options)
    })
  }

  const closeFileViewTab = (path: string) => {
    closeRightSidebarFile(rightSidebarStore, path)
  }

  const closeOtherFileViewTabs = (path: string) => {
    closeOtherRightSidebarFiles(rightSidebarStore, path)
  }

  const closeFileViewTabsToRight = (path: string) => {
    closeRightSidebarFilesToRight(rightSidebarStore, path)
  }

  const closeAllFileViewTabs = () => {
    closeAllRightSidebarFiles(rightSidebarStore)
  }

  const reorderFileViewTabs = (paths: Array<string>) => {
    reorderRightSidebarFiles(rightSidebarStore, paths)
  }

  const toggleReviewPane = () => {
    const activeTab = rightSidebarStore.state.activeTab
    if (isMobile) {
      setRightSidebarActiveTab(rightSidebarStore, "review")
      setCurrentTab((tab) =>
        tab === "git" && activeTab === "review" ? "session" : "git"
      )
      return
    }

    if (gitPanelOpen && activeTab === "review") {
      setGitPanelOpen(false)
      return
    }

    batch(() => {
      setRightSidebarActiveTab(rightSidebarStore, "review")
      setGitPanelOpen(true)
    })
  }

  const toggleFileView = toggleReviewPane

  React.useEffect(() => {
    resetRightSidebarFiles(rightSidebarStore)
  }, [rightSidebarStore, sessionState.cwd])

  React.useEffect(() => {
    if (!sessionState.draft) return
    resetRightSidebarFiles(rightSidebarStore)
  }, [rightSidebarStore, sessionState.draft])

  const sidebarWorkspaceVersion = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.workspaceVersion
  )
  void sidebarWorkspaceVersion
  const {
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes,
    sidebarSessions,
    selectedSidebarSessions,
    sidebarSessionEntriesByKey,
  } = sidebarStore.getWorkspaceSnapshot()
  const sessionsEventDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionsEvent?.directories || [],
    sameStringArray
  )
  const applySidebarSessionStatusRef = React.useRef(
    (status: SessionStatusEvent) => {
      sidebarStore.setSidebarSessionStatusByKey((current) =>
        mergeSidebarSessionStatusMap(current, status)
      )
    }
  )
  applySidebarSessionStatusRef.current = (status) => {
    sidebarStore.setSidebarSessionStatusByKey((current) =>
      mergeSidebarSessionStatusMap(current, status)
    )
  }
  const activeSessionId =
    sessionState.sessionId || (sessionState.sessionKey ? undefined : sessionId)
  const currentSessionPinKey = sessionListEntryKey({
    path: sessionState.sessionFile,
    id: activeSessionId,
  })
  const currentSessionPinned = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) =>
      currentSessionPinKey
        ? snapshot.state.pinnedSidebarSessionKeys.includes(currentSessionPinKey)
        : false
  )
  const currentSessionQueryScope = sessionScrollKey(sessionState)
  const contextUsageSessionScopeRef = React.useRef("")
  React.useLayoutEffect(() => {
    if (contextUsageSessionScopeRef.current === currentSessionQueryScope) return
    contextUsageSessionScopeRef.current = currentSessionQueryScope
    contextUsageThrottler.cancel()
    setStoreState(contextUsageStore, sessionStateRef.current.contextUsage)
  }, [contextUsageStore, contextUsageThrottler, currentSessionQueryScope])
  const initialRouteLoadingSessionId =
    initialLoadingSessionId && !sessionState.sessionKey
      ? initialLoadingSessionId
      : null
  const activeLoadingSessionId =
    loadingSessionId && loadingSessionId !== sessionState.sessionId
      ? loadingSessionId
      : initialRouteLoadingSessionId &&
          initialRouteLoadingSessionId !== sessionState.sessionId
        ? initialRouteLoadingSessionId
        : null
  const isSessionViewLoading = Boolean(activeLoadingSessionId)
  const loadingSessionSummary = activeLoadingSessionId
    ? sidebarSessions.find((session) => session.id === activeLoadingSessionId)
    : undefined
  const loadingSessionTitle = getSessionTitle(loadingSessionSummary)
  const loadingDisplaySessionTitle =
    loadingSessionTitle !== "New session"
      ? loadingSessionTitle
      : "Loading session…"
  const displaySessionCwd = isSessionViewLoading
    ? loadingSessionSummary?.cwd
    : sessionState.cwd
  React.useEffect(() => {
    const previousSessionId = previousRouteSessionIdRef.current
    previousRouteSessionIdRef.current = sessionId

    if (previousSessionId === sessionId) return

    setCurrentTab((tab) => (tab === "git" ? "session" : tab))

    if (!sessionId) {
      setInitialLoadingSessionId(null)
      setLoadingSessionId(null)
      return
    }

    if (sessionStateRef.current.sessionId !== sessionId) {
      setLoadingSessionId(sessionId)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (isMobile) return
    setCurrentTab((tab) => (tab === "git" ? "session" : tab))
  }, [isMobile, setCurrentTab])

  const syncComposerDraft = (
    value: string,
    target = sessionStateRef.current
  ) => {
    const parsed = parseComposerSkillMessage(value)
    const nextText = parsed.matched ? parsed.text : value
    const nextSkill = parsed.matched ? parsed.skillName : undefined

    composerTextRef.current = nextText
    composerSkillRef.current = nextSkill

    const currentDraftSeed = composerDraftSeedStore.state
    if (
      currentDraftSeed.text !== nextText ||
      currentDraftSeed.skillName !== nextSkill
    ) {
      setStoreState(composerDraftSeedStore, {
        ...currentDraftSeed,
        text: nextText,
        skillName: nextSkill,
      })
    }

    rememberStoredPromptDraft(
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }

  const replaceComposerDraft = (
    value: string,
    target = sessionStateRef.current,
    options?: {
      forceSync?: boolean
    }
  ) => {
    const parsed = parseComposerSkillMessage(value)
    const nextText = parsed.matched ? parsed.text : value
    const nextSkill = parsed.matched ? parsed.skillName : undefined

    composerTextRef.current = nextText
    composerSkillRef.current = nextSkill
    setComposerDraftSeed((current) => {
      const draftUnchanged =
        current.text === nextText && current.skillName === nextSkill
      const forceSync = options?.forceSync === true

      if (draftUnchanged && !forceSync) {
        return current
      }

      return {
        text: nextText,
        skillName: nextSkill,
        syncNonce: forceSync ? current.syncNonce + 1 : current.syncNonce,
      }
    })
    rememberStoredPromptDraft(
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }
  const replaceComposerDraftRef = useLatestRef(replaceComposerDraft)

  React.useEffect(() => {
    setGitPanelOpen(readStoredRightSidebarOpen())
    setStoredDraftDirectory(readStoredDraftDirectory() || "")
    setSessionDoneSoundEnabled(readStoredSessionDoneSoundEnabled())
    setSessionDoneDesktopNotificationsEnabled(
      readStoredSessionDoneDesktopNotificationsEnabled()
    )
    setHideToolBlocks(readStoredHideToolBlocks())
    setCenterMessages(readStoredCenterMessages())
    setAutoScrollEnabled(readStoredAutoScrollEnabled())
    setRecentDirectories(readStoredRecentDirectories())
    setDesktopNotificationPermission(getDesktopNotificationPermission())
  }, [])

  const openCommandPalette = () => {
    sessionsDialogRef.current?.close()
    settingsDialogRef.current?.close()
    commandPaletteRef.current?.open()
  }

  const closeCommandPalette = () => {
    commandPaletteRef.current?.close()
  }

  const openSessionsDialog = () => {
    commandPaletteRef.current?.close()
    settingsDialogRef.current?.close()
    sessionsDialogRef.current?.open()
  }

  const openSettingsDialog = () => {
    commandPaletteRef.current?.close()
    sessionsDialogRef.current?.close()
    settingsDialogRef.current?.open()
  }

  const openCommitDialog = () => {
    commandPaletteRef.current?.close()
    sessionsDialogRef.current?.close()
    settingsDialogRef.current?.close()
    gitCommitDialogRef.current?.open()
  }

  const invalidateGitActionQueries = async (cwd: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFiles(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitCommits(viewerContextId, cwd),
        exact: false,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectFileTree(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFileReviews(viewerContextId, cwd),
        exact: false,
        refetchType: "active",
      }),
    ])
  }

  const gitPushMutation = useMutation({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      sessionStateRef.current.cwd?.trim() || "",
      "push"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-push", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ),
    onSuccess: async (response, cwd) => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      })
      await invalidateGitActionQueries(cwd)
      showGitPushSuccessToast({ response })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to push")
    },
  })

  const gitForcePushMutation = useMutation({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      sessionStateRef.current.cwd?.trim() || "",
      "force-push"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-push", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, force: true }),
        }
      ),
    onSuccess: async (response, cwd) => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      })
      await invalidateGitActionQueries(cwd)
      showGitPushSuccessToast({ response, force: true })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to force push"
      )
    },
  })

  const gitPullMutation = useMutation({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      sessionStateRef.current.cwd?.trim() || "",
      "pull"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-pull", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ),
    onSuccess: async (_response, cwd) => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      })
      await invalidateGitActionQueries(cwd)
      toast.success("Pulled changes")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to pull")
    },
  })

  const runGitRemoteAction = async (action: GitRemoteAction) => {
    const cwd = sessionStateRef.current.cwd?.trim() || ""
    if (!cwd) {
      toast.error("Open a session in a repository before running Git actions.")
      return
    }

    const mutation =
      action === "pull"
        ? gitPullMutation
        : action === "force-push"
          ? gitForcePushMutation
          : gitPushMutation

    if (
      gitPushMutation.isPending ||
      gitForcePushMutation.isPending ||
      gitPullMutation.isPending
    ) {
      return
    }

    await mutation.mutateAsync(cwd).catch(() => {})
  }

  const pushGitChanges = async () => {
    await runGitRemoteAction("push")
  }

  const forcePushGitChanges = async () => {
    await runGitRemoteAction("force-push")
  }

  const pullGitChanges = async () => {
    await runGitRemoteAction("pull")
  }

  const toggleGitPanel = () => {
    if (isMobile) {
      setCurrentTab((tab) => (tab === "git" ? "session" : "git"))
      return
    }

    setGitPanelOpen((open) => !open)
  }

  const openRenameDialog = () => {
    const currentState = sessionStateRef.current
    if (!currentState.sessionFile) return
    renameDialogRef.current?.open({
      path: currentState.sessionFile,
      title:
        currentState.sessionName ||
        getCurrentSessionTitleFromState(currentState),
    })
  }

  const openRenameDialogForEntry = (entry: SessionListEntry) => {
    renameDialogRef.current?.openForEntry(entry)
  }

  const openDeleteDialog = (targets: Array<SessionListEntry>) => {
    deleteDialogRef.current?.open(targets)
  }

  const openDeleteOldDirectorySessionsDialog = (directory: string) => {
    deleteOldDirectorySessionsDialogRef.current?.open(directory)
  }

  const currentSessionListEntry = () => {
    const currentState = sessionStateRef.current
    if (!currentState.sessionFile) return undefined

    return {
      path: currentState.sessionFile,
      id: currentState.sessionId,
      cwd: currentState.cwd,
      title: getCurrentSessionTitleFromState(currentState),
      name: currentState.sessionName,
      modified: currentState.modified,
    } satisfies SessionListEntry
  }

  const openDeleteDialogForCurrentSession = () => {
    const currentEntry = currentSessionListEntry()
    if (!currentEntry) return

    openDeleteDialog([currentEntry])
  }

  const openAddDirectoryDialog = () => {
    addDirectoryDialogRef.current?.open()
  }

  const openMoveSessionDirectoryDialogForEntry = (entry: SessionListEntry) => {
    if (!entry.path) return
    moveSessionDirectoryTargetRef.current = entry
    moveSessionDirectoryDialogRef.current?.open()
  }

  const openMoveSessionDirectoryDialogForCurrentSession = () => {
    const currentEntry = currentSessionListEntry()
    if (!currentEntry) return
    openMoveSessionDirectoryDialogForEntry(currentEntry)
  }

  const openForkDialog = async () => {
    await forkDialogRef.current?.open()
  }

  const openTreeDialog = async () => {
    await treeDialogRef.current?.open()
  }

  const focusSessionSearch = () => {
    openSessionsDialog()
  }

  const focusPrompt = () => {
    if (appUiStore.state.currentTab !== "session") {
      setCurrentTab("session")
    }

    if (isMobile && (openMobile || openMobileSettled)) {
      pendingMobileSidebarPromptFocusRef.current = true
      if (openMobile) {
        setOpenMobile(false)
      }
      return
    }

    window.requestAnimationFrame(() => {
      composerPanelRef.current?.focusPrompt({ preventScroll: true })
    })
  }

  const focusModelSelector = () => {
    composerPanelRef.current?.openModelPicker()
  }
  const focusPromptRef = useLatestRef(focusPrompt)
  const promptFocusAfterDialogCloseTimeoutRef = React.useRef<number | null>(
    null
  )

  const hasOpenDialogSurface = () => {
    if (
      addDirectoryOpenRef.current ||
      authOpenRef.current ||
      commandPaletteOpenRef.current ||
      deleteOldDirectorySessionsOpenRef.current ||
      deleteOpenRef.current ||
      forkOpenRef.current ||
      gitCommitOpenRef.current ||
      renameOpenRef.current ||
      sessionsOpenRef.current ||
      settingsOpenRef.current ||
      treeOpenRef.current ||
      uiRequestOpenRef.current
    ) {
      return true
    }

    if (typeof document === "undefined") return false

    return Boolean(
      document.querySelector(
        '[data-slot="dialog-content"][data-open], [data-slot="drawer-content"][data-state="open"]'
      )
    )
  }

  React.useEffect(() => {
    const handleDialogClosed = () => {
      if (promptFocusAfterDialogCloseTimeoutRef.current !== null) {
        window.clearTimeout(promptFocusAfterDialogCloseTimeoutRef.current)
      }

      promptFocusAfterDialogCloseTimeoutRef.current = window.setTimeout(() => {
        promptFocusAfterDialogCloseTimeoutRef.current = null
        if (hasOpenDialogSurface()) return

        focusPromptRef.current()
      }, 0)
    }

    window.addEventListener("pico:dialog-closed", handleDialogClosed)

    return () => {
      window.removeEventListener("pico:dialog-closed", handleDialogClosed)
      if (promptFocusAfterDialogCloseTimeoutRef.current !== null) {
        window.clearTimeout(promptFocusAfterDialogCloseTimeoutRef.current)
        promptFocusAfterDialogCloseTimeoutRef.current = null
      }
    }
  }, [focusPromptRef])
  const promptFocusRequestRef = React.useRef({
    sessionId: "",
    nonce: 0,
  })
  const promptFocusRequestTimeoutRef = React.useRef<number | null>(null)
  const lastAutoFocusedSessionKeyRef = React.useRef<string | null>(null)

  const schedulePromptFocusRequest = () => {
    if (promptFocusRequestTimeoutRef.current !== null) {
      window.clearTimeout(promptFocusRequestTimeoutRef.current)
    }

    promptFocusRequestTimeoutRef.current = window.setTimeout(() => {
      promptFocusRequestTimeoutRef.current = null
      if (hasOpenDialogSurface()) return

      focusPromptRef.current()
    }, 50)
  }

  React.useEffect(() => {
    return () => {
      if (promptFocusRequestTimeoutRef.current !== null) {
        window.clearTimeout(promptFocusRequestTimeoutRef.current)
        promptFocusRequestTimeoutRef.current = null
      }
    }
  }, [])

  React.useEffect(() => {
    if (
      !pendingMobileSidebarPromptFocusRef.current ||
      openMobile ||
      openMobileSettled
    ) {
      return
    }

    pendingMobileSidebarPromptFocusRef.current = false
    const timeoutId = window.setTimeout(() => {
      focusPromptRef.current()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [focusPromptRef, openMobile, openMobileSettled])

  React.useEffect(() => {
    if (isSessionViewLoading || hasOpenDialogSurface()) return

    const sessionFocusKey =
      sessionState.sessionKey || sessionState.sessionId || "draft"
    if (lastAutoFocusedSessionKeyRef.current === sessionFocusKey) return

    lastAutoFocusedSessionKeyRef.current = sessionFocusKey
    focusPromptRef.current()
  }, [
    focusPromptRef,
    isSessionViewLoading,
    sessionState.sessionId,
    sessionState.sessionKey,
  ])

  React.useEffect(() => {
    const promptFocusRequest = promptFocusRequestRef.current
    if (
      !promptFocusRequest.nonce ||
      isSessionViewLoading ||
      hasOpenDialogSurface()
    ) {
      return
    }
    if (
      promptFocusRequest.sessionId &&
      sessionState.sessionId !== promptFocusRequest.sessionId
    ) {
      return
    }

    schedulePromptFocusRequest()
  }, [isSessionViewLoading, sessionState.sessionId])

  const handleSessionDoneSoundEnabledChange = (enabled: boolean) => {
    setSessionDoneSoundEnabled(enabled)
    safeLocalStorageSetItem(
      SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
      enabled ? "1" : "0"
    )

    if (enabled) {
      void primeSessionDoneSound()
    }
  }

  const handleSessionDoneDesktopNotificationsEnabledChange = async (
    enabled: boolean
  ) => {
    setSessionDoneDesktopNotificationsEnabled(enabled)
    safeLocalStorageSetItem(
      SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
      enabled ? "1" : "0"
    )

    if (!enabled) {
      return
    }

    const permission = await requestDesktopNotificationPermission()
    setDesktopNotificationPermission(permission)

    if (permission === "denied") {
      toast.info(
        "Allow notifications for this site in your browser to receive desktop alerts."
      )
    } else if (permission === "unsupported") {
      toast.error("Desktop notifications are unavailable in this browser.")
    }
  }

  const syncSidebarSelectionForSession = React.useCallback(
    (nextSessionId?: string, options?: SelectSessionNavigationOptions) => {
      const nextKey = nextSessionId
        ? findSidebarSessionSelectionKey(
            sidebarStore.state.derived.sidebarSessionEntriesByKey,
            {
              sessionId: nextSessionId,
              sessionPath: options?.sessionPath,
            }
          )
        : ""

      sidebarStore.setSelectedSidebarSessionKeys((current) => {
        if (!nextKey) return current.length === 0 ? current : []
        return sameStringArray(current, [nextKey]) ? current : [nextKey]
      })
      sidebarStore.setSidebarSessionSelectionAnchor((current) =>
        current === nextKey ? current : nextKey
      )
    },
    [sidebarStore]
  )

  const handleSelectSession = React.useCallback(
    (nextSessionId?: string, options?: SelectSessionNavigationOptions) => {
      setCurrentTab((tab) => (tab === "git" ? "session" : tab))
      syncSidebarSelectionForSession(nextSessionId, options)
      setSidebarActiveSession({
        draft: !nextSessionId,
        sessionId: nextSessionId,
        sessionPath: options?.sessionPath,
      })

      pendingRouteSessionIdRef.current = nextSessionId
      pendingRouteSessionPathRef.current =
        options?.sessionPath?.trim() || undefined
      if (nextSessionId) {
        promptFocusRequestRef.current = {
          sessionId: nextSessionId,
          nonce: promptFocusRequestRef.current.nonce + 1,
        }
      }
      setLoadingSessionId((current) => {
        if (!nextSessionId) {
          return null
        }
        if (
          !sessionStateRef.current.draft &&
          sessionStateRef.current.sessionId === nextSessionId
        ) {
          return current
        }
        return nextSessionId
      })
      onSelectSession?.(nextSessionId, options)
    },
    [
      onSelectSession,
      sessionStateRef,
      setSidebarActiveSession,
      syncSidebarSelectionForSession,
    ]
  )
  const handleSelectSessionRef = useLatestRef(handleSelectSession)

  useAppShellSessionSync({
    viewerContextId,
    sessionId,
    draftSessionLoadingOwnerKey,
    bootstrapSidebarDirectories:
      sidebarStore.state.state.initialSidebarBootstrapDirectories,
    hideToolBlocksRef,
    sessionStore,
    sessionStateRef,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraftRef,
    handleSelectSessionRef,
    pendingRouteSessionIdRef,
    pendingRouteSessionPathRef,
    setSessionState,
    setConversationItems,
    setHiddenThinkingPreview,
    setWorkingState,
    setCompactRunningState,
    setComposerContextUsage,
    setComposerStreaming,
    setSessionsEvent: sidebarStore.setSessionsEvent,
    setSessionDoneEvents,
    applySidebarSessionStatusRef,
    setComposerImages,
    setPendingMessages,
    pendingUiRequestHandlerRef,
    lastSyncedEditorTextRef,
  })

  React.useEffect(() => {
    const nextDirectory = sessionState.cwd?.trim()
    if (!nextDirectory) return
    safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextDirectory)
    setStoredDraftDirectory(nextDirectory)
  }, [sessionState.cwd])

  React.useEffect(() => {
    const nextDirectory = sessionState.cwd?.trim()
    const nextSessionId = sessionState.sessionId?.trim()
    if (!sessionId || !nextSessionId || sessionState.draft || !nextDirectory) {
      return
    }
    if (nextSessionId !== sessionId) return

    const autoAddKey = `${nextSessionId}\n${nextDirectory}`
    if (autoAddedSessionDirectoryKeysRef.current.has(autoAddKey)) return
    autoAddedSessionDirectoryKeysRef.current.add(autoAddKey)

    sidebarStore.setSidebarDirectories((current) => {
      const normalizedCurrent = normalizeStoredDirectoryList(current)
      if (normalizedCurrent.includes(nextDirectory)) return current

      const nextDirectories = normalizeStoredDirectoryList([
        nextDirectory,
        ...normalizedCurrent,
      ])
      safeLocalStorageSetItem(
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(nextDirectories)
      )
      return nextDirectories
    })
  }, [
    sessionId,
    sessionState.cwd,
    sessionState.draft,
    sessionState.sessionId,
    sidebarStore,
  ])

  const defaultNewSessionDirectory =
    sessionState.cwd?.trim() ||
    baseSidebarDirectories[0] ||
    storedDraftDirectory ||
    ""
  const newSessionDirectoryOptions = React.useMemo(() => {
    const nextOptions: Array<{ path: string; label: string }> = []
    const seen = new Set<string>()
    const pushDirectoryOption = (path: string, label: string) => {
      const normalizedPath = path.trim()
      if (!normalizedPath || seen.has(normalizedPath)) return
      seen.add(normalizedPath)
      nextOptions.push({ path: normalizedPath, label })
    }

    if (sessionState.cwd?.trim()) {
      pushDirectoryOption(sessionState.cwd, "Current session directory")
    }
    if (storedDraftDirectory) {
      pushDirectoryOption(storedDraftDirectory, "Draft directory")
    }
    for (const directory of baseSidebarDirectories) {
      pushDirectoryOption(directory, "Sidebar directory")
    }

    return nextOptions
  }, [baseSidebarDirectories, sessionState.cwd, storedDraftDirectory])

  const knownDirectories = React.useMemo(
    () =>
      normalizeStoredDirectoryList([
        ...baseSidebarDirectories,
        ...sessionsEventDirectories,
        sessionState.cwd || "",
        storedDraftDirectory,
        ...Array.from(directoryStateByPath.keys()),
        ...Object.values(directoryIndexes).flatMap((entries) =>
          entries.map((entry) => entry.cwd || "")
        ),
      ]),
    [
      baseSidebarDirectories,
      directoryIndexes,
      directoryStateByPath,
      sessionState.cwd,
      sessionsEventDirectories,
      storedDraftDirectory,
    ]
  )

  const sessionsDialogDirectory =
    sessionState.cwd?.trim() ||
    (baseSidebarDirectories.length > 0
      ? (baseSidebarDirectories[0] ?? "")
      : storedDraftDirectory) ||
    defaultNewSessionDirectory

  const rememberRecentDirectory = (directory: string) => {
    const normalizedDirectory = directory.trim()
    if (!normalizedDirectory) return

    setRecentDirectories((current) => {
      const next = normalizeStoredDirectoryList([
        normalizedDirectory,
        ...current,
      ]).slice(0, RECENT_DIRECTORIES_LIMIT)
      safeLocalStorageSetItem(
        RECENT_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }

  const prefetchDirectorySessionsIndex = React.useCallback(
    (_directory: string) => {},
    []
  )

  const clearSelectedSidebarSelection = React.useCallback(() => {
    sidebarStore.setSelectedSidebarSessionKeys((current) =>
      current.length === 0 ? current : []
    )
    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current ? "" : current
    )
  }, [sidebarStore])

  const awaitingFirstTurn = awaitingFirstTurnStore.state
  const isSubmitting = isSubmittingStore.state
  const pendingDraftPrompt = pendingDraftPromptStore.state
  const pendingDraftFollowUps = pendingDraftFollowUpsStore.state
  const pendingMessages = pendingMessagesStore.state

  const {
    abortSession,
    addDirectoryPath,
    createSession: requestCreateSession,
    editPendingMessage,
    removePendingMessage,
    reorderPending,
    submitPrompt,
  } = useAppShellPromptMutations({
    viewerContextId,
    activeSessionId,
    defaultNewSessionDirectory,
    sessionStore,
    sessionStateRef,
    draftSessionLoadingOwnerKey,
    pendingDraftPrompt,
    pendingDraftFollowUps,
    awaitingFirstTurn,
    pendingMessages,
    composerImagesRef,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraft,
    lastSyncedEditorTextRef,
    rememberRecentDirectory,
    prefetchDirectorySessionsIndex,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
    setSidebarDirectories: sidebarStore.setSidebarDirectories,
    setStoredDraftDirectory,
    setDraftSessionLoadingOwnerKey,
    setPendingDraftPrompt,
    setPendingDraftFollowUps,
    setPendingMessages,
    setAwaitingFirstTurn,
    setIsSubmitting,
    setComposerImages,
  })

  const switchEmptyDraftDirectory = React.useCallback(
    (directory: string) => {
      const nextDirectory = directory.trim()
      if (!nextDirectory) return

      const previousState = sessionStateRef.current
      if (!previousState.draft || previousState.items.length > 0) return

      safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextDirectory)
      setStoredDraftDirectory(nextDirectory)
      rememberRecentDirectory(nextDirectory)

      const ownerKey = promptDraftKey({ cwd: nextDirectory })
      const nextState = createOptimisticDraftSessionState({
        previous: previousState,
        cwd: nextDirectory,
        ownerKey,
      })
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setSessionState(nextState)

      rememberStoredPromptDraft(
        nextState,
        serializeComposerDraft({
          text: composerTextRef.current,
          skillName: composerSkillRef.current,
        })
      )
    },
    [
      conversationItemsStore,
      rememberRecentDirectory,
      sessionStateRef,
      setSessionState,
      setStoredDraftDirectory,
    ]
  )

  const addDirectoryPathForDialog = React.useCallback(
    async (path: string) => {
      const result = await addDirectoryPath(path)
      if (typeof result === "string") {
        switchEmptyDraftDirectory(result)
      }
      return result
    },
    [addDirectoryPath, switchEmptyDraftDirectory]
  )

  const createSession = React.useCallback(
    async (cwdOverride?: string, options?: CreateSessionOptions) => {
      const nextCwd = cwdOverride || defaultNewSessionDirectory || undefined
      const ownerKey = promptDraftKey({ cwd: nextCwd })
      const optimisticSessionKey = `optimistic:${ownerKey}`
      const previousState = sessionStateRef.current
      const shouldCloseMobileSidebar =
        Boolean(options?.closeMobileSidebar) && isMobile && openMobile

      handleSelectSession(undefined)
      clearSelectedSidebarSelection()
      if (shouldCloseMobileSidebar) {
        pendingMobileSidebarPromptFocusRef.current = true
        setOpenMobile(false)
      } else {
        focusPrompt()
      }
      setAwaitingFirstTurn(false)
      setPendingMessages((current) => (current.length === 0 ? current : []))
      const nextState = createOptimisticDraftSessionState({
        previous: previousState,
        cwd: nextCwd,
        ownerKey,
      })
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setSessionState(nextState)

      const created = await requestCreateSession(cwdOverride)
      if (created) {
        return
      }

      if (sessionStateRef.current.sessionKey !== optimisticSessionKey) {
        return
      }

      sessionStateRef.current = previousState
      conversationItemsStore.setItems(previousState.items)
      setSessionState(previousState)
    },
    [
      clearSelectedSidebarSelection,
      conversationItemsStore,
      defaultNewSessionDirectory,
      focusPrompt,
      handleSelectSession,
      isMobile,
      openMobile,
      requestCreateSession,
      sessionStateRef,
      setAwaitingFirstTurn,
      setOpenMobile,
      setPendingMessages,
      setSessionState,
    ]
  )

  const onPickImages = async (files: FileList | Array<File> | null) => {
    if (!files || files.length === 0) return
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (imageFiles.length === 0) return

    const nextImages = await Promise.all(
      imageFiles.slice(0, 8).map((file) => readFileAsPromptImage(file))
    )
    setComposerImages((current) => [...current, ...nextImages].slice(0, 8))
  }

  const composerDraftSeed = composerDraftSeedStore.state
  const composerImages = composerImagesStore.state
  const pendingDraftFollowUpMessages = pendingDraftFollowUps.map(
    (message, index) => ({
      pendingId: pendingDraftFollowUpId(message, index),
      text: message.message,
      images: message.images,
      streamingBehavior: message.streamingBehavior,
    })
  )
  const currentPendingMessages =
    pendingDraftFollowUpMessages.length > 0 || pendingMessages.length > 0
      ? [...pendingDraftFollowUpMessages, ...pendingMessages]
      : EMPTY_COMPOSER_PENDING_MESSAGES
  const composerDisabled = isSessionViewLoading
  const displayedPendingMessages = composerDisabled
    ? EMPTY_COMPOSER_PENDING_MESSAGES
    : currentPendingMessages
  const displayedComposerImages = composerDisabled
    ? EMPTY_COMPOSER_IMAGES
    : composerImages
  const displayedComposerText = composerDisabled ? "" : composerDraftSeed.text
  const displayedComposerSkill = composerDisabled
    ? undefined
    : composerDraftSeed.skillName

  const editPendingDraftFollowUp = (pendingId: string, text: string) => {
    const existing = pendingDraftFollowUps.find(
      (message, index) => pendingDraftFollowUpId(message, index) === pendingId
    )
    if (!existing) return false

    if (!text.trim() && existing.images.length === 0) {
      toast.error("Enter a message or keep at least one image")
      return true
    }

    setPendingDraftFollowUps((current) =>
      current.map((message, index) =>
        pendingDraftFollowUpId(message, index) === pendingId
          ? { ...message, message: text }
          : message
      )
    )
    return true
  }

  const removePendingDraftFollowUp = (pendingId: string) => {
    if (
      !pendingDraftFollowUps.some(
        (message, index) => pendingDraftFollowUpId(message, index) === pendingId
      )
    ) {
      return false
    }

    setPendingDraftFollowUps((current) =>
      current.filter(
        (message, index) => pendingDraftFollowUpId(message, index) !== pendingId
      )
    )
    return true
  }

  const reorderPendingDraftFollowUp = (
    pendingId: string,
    direction: -1 | 1
  ) => {
    const nextPendingDraftFollowUps = movePendingDraftFollowUpMessage(
      pendingDraftFollowUps,
      pendingId,
      direction
    )
    if (!nextPendingDraftFollowUps) return false

    setPendingDraftFollowUps(nextPendingDraftFollowUps)
    return true
  }

  const setCompactWorkingState = React.useCallback(
    (running: boolean) => {
      setCompactRunningState(running)
      if (running) {
        setStoreState(workingStateStore, {
          label: COMPACT_WORKING_LABEL,
          cancelable: true,
        })
        return
      }

      if (compactAbortRequestedRef.current) {
        compactAbortRequestedRef.current = false
        setStoreState(workingStateStore, {
          label: COMPACT_CANCELLED_LABEL,
          error: true,
        })
        return
      }

      if (workingStateStore.state?.label === COMPACT_WORKING_LABEL) {
        setStoreState(workingStateStore, null)
      }
    },
    [setCompactRunningState, workingStateStore]
  )

  const isCompactAbortRequested = React.useCallback(
    () => compactAbortRequestedRef.current,
    []
  )

  const {
    cycleThinkingLevel,
    deleteSessions,
    moveSessionPath,
    renameSessionPath,
    runClone,
    runCompact,
    setModel,
    setThinkingBlocksHidden,
    setThinkingLevel,
    toggleHideThinking,
  } = useAppShellSessionMutations({
    viewerContextId,
    activeSessionId,
    sessionStateRef,
    setSessionState,
    getDirectoryIndexDataByPath: () =>
      sidebarStore.state.state.directoryIndexDataByPath,
    setDirectoryIndexDataByPath: sidebarStore.setDirectoryIndexDataByPath,
    getSessionsEvent: () => sidebarStore.state.state.sessionsEvent,
    setSessionsEvent: sidebarStore.setSessionsEvent,
    getSidebarSelection: () => {
      const sidebarState = sidebarStore.state.state
      return {
        selectedSidebarSessionKeys: sidebarState.selectedSidebarSessionKeys,
        sidebarSessionSelectionAnchor:
          sidebarState.sidebarSessionSelectionAnchor,
      }
    },
    optimisticallyClearActiveDeletedSession: (targetPath) => {
      const previousState = sessionStateRef.current
      if (previousState.sessionFile !== targetPath) return undefined

      const ownerKey = `delete:${targetPath}`
      const optimisticSessionKey = `optimistic:${ownerKey}`
      handleSelectSession(undefined, { replace: true })
      const nextState = createOptimisticDraftSessionState({
        previous: previousState,
        cwd: previousState.cwd,
        ownerKey,
      })
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setSessionState(nextState)

      return () => {
        if (sessionStateRef.current.sessionKey !== optimisticSessionKey) return
        if (previousState.sessionId) {
          handleSelectSession(previousState.sessionId, {
            replace: true,
            sessionPath: previousState.sessionFile,
          })
        }
        sessionStateRef.current = previousState
        conversationItemsStore.setItems(previousState.items)
        setSessionState(previousState)
      }
    },
    setSelectedSidebarSessionKeys: sidebarStore.setSelectedSidebarSessionKeys,
    setSidebarSessionSelectionAnchor:
      sidebarStore.setSidebarSessionSelectionAnchor,
    setPinnedSidebarSessionKeys: sidebarStore.setPinnedSidebarSessionKeys,
    setCompactWorkingState,
    isCompactAbortRequested,
  })

  const moveSessionToDirectory = async (
    entry: SessionListEntry,
    directory: string
  ) => {
    const moved = await moveSessionPath(entry, directory)
    if (moved) {
      rememberRecentDirectory(directory)
    }
    return moved
  }

  const moveSessionDirectoryTargetToPath = async (directory: string) => {
    const target = moveSessionDirectoryTargetRef.current
    if (!target) return false

    const moved = await moveSessionToDirectory(target, directory)
    if (moved) {
      moveSessionDirectoryTargetRef.current = null
    }
    return moved
  }

  const moveCurrentSessionToDirectory = async (directory: string) => {
    const currentState = sessionStateRef.current
    if (!currentState.sessionFile) return false

    return await moveSessionToDirectory(
      {
        path: currentState.sessionFile,
        id: currentState.sessionId,
        cwd: currentState.cwd,
        title: getCurrentSessionTitleFromState(currentState),
        name: currentState.sessionName,
        modified: currentState.modified,
      },
      directory
    )
  }

  const setToolBlocksHidden = (hidden: boolean) => {
    setHideToolBlocks(hidden)
    safeLocalStorageSetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY, hidden ? "1" : "0")
  }

  const toggleHideToolBlocks = () => {
    const currentHidden = displaySettingsRef.current.hideToolBlocks
    setToolBlocksHidden(!currentHidden)
    toast.info(currentHidden ? "Tools shown" : "Tools hidden")
  }

  const setMessagesCentered = (centered: boolean) => {
    setCenterMessages(centered)
    safeLocalStorageSetItem(CENTER_MESSAGES_STORAGE_KEY, centered ? "1" : "0")
  }

  const setAutoScroll = (enabled: boolean) => {
    setAutoScrollEnabled(enabled)
    safeLocalStorageSetItem(
      AUTO_SCROLL_ENABLED_STORAGE_KEY,
      enabled ? "1" : "0"
    )
  }

  const openAuthDialog = (mode: "login" | "logout" = "login") => {
    authDialogRef.current?.open(mode)
  }

  const runBuiltinSlashCommand = async (name: string, args: string) => {
    const trimmedArgs = args.trim()
    const clearComposerDraft = () => {
      replaceComposerDraft("", sessionStateRef.current, { forceSync: true })
    }

    switch (name) {
      case "login": {
        if (trimmedArgs) {
          toast.error("/login does not take any arguments yet.")
          return
        }
        clearComposerDraft()
        openAuthDialog("login")
        return
      }
      case "logout": {
        if (trimmedArgs) {
          toast.error("/logout does not take any arguments yet.")
          return
        }
        clearComposerDraft()
        openAuthDialog("logout")
        return
      }
      case "compact": {
        if (composerImages.length > 0) {
          toast.error("Built-in slash commands do not support images.")
          return
        }
        clearComposerDraft()
        await runCompact()
        return
      }
      case "clone": {
        if (trimmedArgs) {
          toast.error("/clone does not take any arguments.")
          return
        }
        if (composerImages.length > 0) {
          toast.error("Built-in slash commands do not support images.")
          return
        }
        clearComposerDraft()
        await runClone()
        return
      }
      case "rename": {
        if (!sessionState.sessionFile) {
          toast.error("Start the session before renaming it.")
          return
        }
        if (!trimmedArgs) {
          clearComposerDraft()
          openRenameDialog()
          return
        }
        clearComposerDraft()
        await renameSessionPath(sessionState.sessionFile, trimmedArgs)
        return
      }
      case "delete": {
        if (!sessionState.sessionFile) {
          toast.error("Start the session before deleting it.")
          return
        }
        clearComposerDraft()
        openDeleteDialogForCurrentSession()
        return
      }
      case "fork": {
        if (trimmedArgs) {
          toast.error("/fork does not take any arguments.")
          return
        }
        clearComposerDraft()
        await openForkDialog()
        return
      }
      case "tree": {
        if (trimmedArgs) {
          toast.error("/tree does not take any arguments.")
          return
        }
        clearComposerDraft()
        await openTreeDialog()
        return
      }
      case "hide-thinking": {
        clearComposerDraft()
        if (!sessionStateRef.current.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "show-thinking": {
        clearComposerDraft()
        if (sessionStateRef.current.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "hide-tools": {
        clearComposerDraft()
        setToolBlocksHidden(true)
        return
      }
      case "show-tools": {
        clearComposerDraft()
        setToolBlocksHidden(false)
        return
      }
      default:
        toast.error(`Unsupported slash command: /${name}`)
    }
  }

  const handleThemeChange = (value: ThemeFamily) => {
    setThemeFamily(value)
  }

  const handleThemePreviewChange = (value: ThemeFamily) => {
    previewThemeFamily(value)
  }

  const handleThemeColorModeChange = (value: ThemeColorMode) => {
    setColorMode(value)
  }

  const composerSnapshot = {
    activeSessionId,
    awaitingFirstTurn: composerDisabled ? false : awaitingFirstTurn,
    centerMessages: displaySettingsRef.current.centerMessages,
    composerImages: displayedComposerImages,
    composerSkill: displayedComposerSkill,
    composerSyncNonce: composerDraftSeed.syncNonce,
    composerText: displayedComposerText,
    currentPendingMessages: displayedPendingMessages,
    disabled: composerDisabled,
    isStreaming: composerDisabled ? false : sessionStateRef.current.streaming,
    isSubmitting: composerDisabled ? false : isSubmitting,
    viewerContextId,
  } satisfies AppShellComposerSnapshot

  React.useLayoutEffect(() => {
    setStoreState(composerStore, composerSnapshot)
  })

  const composerActionsRef = useLatestRef<AppShellComposerActions>({
    abortSession,
    onPickImages,
    onRemoveComposerImage: (index) => {
      setComposerImages((current) =>
        current.filter((_, imageIndex) => imageIndex !== index)
      )
    },
    editPendingDraftFollowUp,
    editPendingMessage,
    removePendingDraftFollowUp,
    removePendingMessage,
    reorderPending,
    reorderPendingDraftFollowUp,
    runBuiltinSlashCommand,
    setModel,
    setThinkingLevel,
    submitPrompt,
    syncComposerDraft,
  })

  const commandPaletteStateRef = useLatestRef({
    gitPanelOpen,
    hasAvailableModels: sessionStateRef.current.availableModels.length > 0,
    isMobile,
    selectedSidebarSessions,
    sessionFile: sessionState.sessionFile,
  })

  const buildCommandPaletteCommands = () => {
    const commandState = commandPaletteStateRef.current
    const currentHideThinkingBlock = sessionStateRef.current.hideThinkingBlock
    const currentThinkingLevel = sessionStateRef.current.thinkingLevel
    const commands: Array<AppCommand> = [
      {
        id: "new-session",
        group: "Sessions",
        title: "New session",
        description: "Create a new draft session",
        shortcut: formatShortcutLabel("Control+N"),
        keywords: ["create", "draft", "session"],
        onSelect: createSession,
      },
      {
        id: "open-sessions",
        group: "Sessions",
        title: "Open sessions",
        description: "Search and switch sessions",
        shortcut: formatShortcutLabel("Control+S"),
        keywords: ["session", "search", "switch", "jump"],
        onSelect: openSessionsDialog,
      },
      {
        id: "open-git-view",
        group: "Git",
        title: commandState.isMobile
          ? "Toggle right sidebar tab"
          : commandState.gitPanelOpen
            ? "Close right sidebar"
            : "Open right sidebar",
        description: commandState.isMobile
          ? "Switch the mobile right sidebar tab on or off"
          : "Toggle the right sidebar",
        shortcut: formatShortcutLabel("Control+\\"),
        keywords: [
          "right",
          "sidebar",
          "git",
          "changes",
          "branch",
          "commit",
          "panel",
        ],
        onSelect: toggleGitPanel,
      },
      {
        id: "commit-changes",
        group: "Git",
        title: "Commit changes",
        description: "Open the Git commit dialog",
        shortcut: formatShortcutLabel("Control+C"),
        keywords: ["git", "commit", "changes", "stage"],
        onSelect: openCommitDialog,
      },
      {
        id: "push-changes",
        group: "Git",
        title: "Push changes",
        description: "Push local commits to the remote",
        shortcut: formatShortcutLabel("Control+P"),
        keywords: ["git", "push", "remote", "upstream"],
        onSelect: pushGitChanges,
      },
      {
        id: "force-push-changes",
        group: "Git",
        title: "Force push changes",
        description: "Force push local commits with --force-with-lease",
        shortcut: formatShortcutLabel("Control+Shift+P"),
        keywords: ["git", "force", "push", "remote", "upstream", "lease"],
        onSelect: forcePushGitChanges,
      },
      {
        id: "pull-changes",
        group: "Git",
        title: "Pull changes",
        description: "Pull remote changes into the current branch",
        shortcut: formatShortcutLabel("Alt+P"),
        keywords: ["git", "pull", "remote", "upstream"],
        onSelect: pullGitChanges,
      },
      {
        id: "focus-prompt",
        group: "Assistant",
        title: "Focus prompt",
        description: "Move focus to the prompt field",
        shortcut: formatShortcutLabel("Control+Enter"),
        keywords: ["prompt", "composer", "input", "message", "reply"],
        onSelect: focusPrompt,
      },
      {
        id: "set-model",
        group: "Assistant",
        title: "Set model",
        description: "Open the model picker",
        shortcut: formatShortcutLabel("Control+M"),
        keywords: ["model", "provider", "picker", "choose"],
        onSelect: () => {
          if (!commandPaletteStateRef.current.hasAvailableModels) {
            throw new Error("No models are available right now.")
          }

          focusModelSelector()
        },
      },
      {
        id: "add-directory",
        group: "Sidebar",
        title: "Add Directory",
        description: "Add a directory accordion to the sidebar",
        shortcut: formatShortcutLabel("Control+D"),
        keywords: ["workspace", "sidebar", "directory", "folder"],
        onSelect: openAddDirectoryDialog,
      },
      {
        id: "tree-session",
        group: "Sessions",
        title: "Open tree",
        description: "Jump to an earlier point in the current session tree",
        shortcut: "Esc Esc",
        keywords: ["tree", "branch", "history", "navigate"],
        onSelect: openTreeDialog,
      },
      {
        id: "fork-session",
        group: "Sessions",
        title: "Fork session",
        description: "Create a new session from a previous user message",
        shortcut: formatShortcutLabel("Control+F"),
        keywords: ["fork", "branch", "draft"],
        onSelect: openForkDialog,
      },
      {
        id: "clone-session",
        group: "Sessions",
        title: "Clone session",
        description: "Duplicate the current active branch into a new session",
        keywords: ["clone", "branch", "duplicate", "session"],
        onSelect: runClone,
      },
      {
        id: "compact-session",
        group: "Sessions",
        title: "Compact",
        description: "Manually compact the session context with /compact",
        keywords: ["compact", "context", "compress", "summarize"],
        onSelect: runCompact,
      },
      {
        id: "toggle-thinking",
        group: "Assistant",
        title: currentHideThinkingBlock
          ? "Show thinking blocks"
          : "Hide thinking blocks",
        description: currentHideThinkingBlock
          ? "Show assistant thinking blocks"
          : "Hide assistant thinking blocks",
        shortcut: formatShortcutLabel("Control+T"),
        keywords: ["thinking", "reasoning", "visibility", "show", "hide"],
        onSelect: toggleHideThinking,
      },
      {
        id: "cycle-reasoning",
        group: "Assistant",
        title: "Next reasoning level",
        description: `Current level: ${currentThinkingLevel}`,
        shortcut: formatShortcutLabel("Control+R"),
        keywords: ["thinking", "reasoning", "level", "cycle", "next"],
        onSelect: () => {
          void cycleThinkingLevel(1)
        },
      },
      {
        id: "previous-reasoning",
        group: "Assistant",
        title: "Previous reasoning level",
        description: `Current level: ${currentThinkingLevel}`,
        shortcut: formatShortcutLabel("Control+Shift+R"),
        keywords: [
          "thinking",
          "reasoning",
          "level",
          "cycle",
          "previous",
          "back",
        ],
        onSelect: () => {
          void cycleThinkingLevel(-1)
        },
      },
      {
        id: "toggle-review-pane",
        group: "Git",
        title: "Toggle Review Pane",
        description: "Toggle the review pane for changed files",
        keywords: ["review", "diff", "file", "changes", "pane"],
        onSelect: toggleFileView,
      },
      {
        id: "toggle-tools",
        group: "Assistant",
        title: displaySettingsRef.current.hideToolBlocks
          ? "Show tool calls"
          : "Hide tool calls",
        description: displaySettingsRef.current.hideToolBlocks
          ? "Show assistant tool calls"
          : "Hide assistant tool calls",
        shortcut: formatShortcutLabel("Control+O"),
        keywords: ["tools", "tool calls", "visibility", "show", "hide"],
        onSelect: toggleHideToolBlocks,
      },
      {
        id: "login-provider",
        group: "App",
        title: "Login to provider",
        description: "Configure provider API key or subscription auth",
        keywords: ["login", "auth", "api key", "oauth", "provider"],
        onSelect: () => openAuthDialog("login"),
      },
      {
        id: "logout-provider",
        group: "App",
        title: "Logout from provider",
        description: "Remove stored provider credentials",
        keywords: ["logout", "auth", "api key", "oauth", "provider"],
        onSelect: () => openAuthDialog("logout"),
      },
      {
        id: "open-settings",
        group: "App",
        title: "Open settings",
        description: "Open app settings",
        shortcut: formatShortcutLabel("Control+,"),
        keywords: ["settings", "theme", "notifications", "display"],
        onSelect: openSettingsDialog,
      },
    ]

    if (commandState.sessionFile) {
      commands.splice(1, 0, {
        id: "rename-session",
        group: "Sessions",
        title: "Rename session",
        description: "Rename the current session",
        shortcut: formatShortcutLabel("Control+E"),
        keywords: ["rename", "title", "name"],
        onSelect: openRenameDialog,
      })
      commands.push({
        id: "delete-session",
        group: "Sessions",
        title: "Delete session",
        description: `Delete ${getCurrentSessionTitleFromState(
          sessionStateRef.current
        )}`,
        shortcut: formatShortcutLabel("Control+X"),
        keywords: ["delete", "remove", "session"],
        onSelect: openDeleteDialogForCurrentSession,
      })
    }

    if (commandState.selectedSidebarSessions.length > 0) {
      commands.push({
        id: "delete-selected-sessions",
        group: "Sidebar",
        title: "Delete selected sidebar sessions",
        description: `Delete ${commandState.selectedSidebarSessions.length} selected sidebar ${commandState.selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["delete", "selected", "sidebar", "sessions"],
        onSelect: () => {
          openDeleteDialog(
            commandPaletteStateRef.current.selectedSidebarSessions
          )
        },
      })
    }

    return commands
  }
  const commandPaletteCommandsRef = useLatestRef(buildCommandPaletteCommands)

  const abortCompact = React.useCallback(async () => {
    if (!compactRunningRef.current) return
    compactAbortRequestedRef.current = true
    await abortSession()
  }, [abortSession])

  const shortcutActionsRef = useLatestRef({
    abortCompact,
    abortSession,
    createSession,
    closeCommandPalette,
    forcePushGitChanges,
    focusModelSelector,
    focusPrompt,
    focusSessionSearch,
    jumpToNextMessage: () => {
      conversationFrameRef.current?.jumpToNextMessage()
    },
    jumpToPreviousMessage: () => {
      conversationFrameRef.current?.jumpToPreviousMessage()
    },
    openAddDirectoryDialog,
    openCommandPalette,
    openCommitDialog,
    openDeleteDialog,
    openDeleteDialogForCurrentSession,
    openForkDialog,
    openRenameDialog,
    openSessionsDialog,
    openSettingsDialog,
    openTreeDialog,
    pullGitChanges,
    pushGitChanges,
    scrollConversationToBottom: () => {
      conversationFrameRef.current?.scrollConversationToBottom()
    },
    scrollConversationToTop: () => {
      conversationFrameRef.current?.scrollConversationToTop()
    },
    toggleGitPanel,
    toggleHideThinking,
    toggleHideToolBlocks,
    cycleThinkingLevel,
  })

  const shortcutStateRef = useLatestRef<AppShellShortcutState>({
    currentTab: isMobile ? appUiStore.state.currentTab : "session",
    selectedSidebarSessions,
    sessionHasAvailableModels:
      sessionStateRef.current.availableModels.length > 0,
    sessionHasFile: Boolean(sessionState.sessionFile),
    sessionIsStreaming: sessionStateRef.current.streaming,
    sidebarSessionEntriesByKey,
  })
  const toggleCurrentSessionPinned = () => {
    const currentState = sessionStateRef.current
    const key = sessionListEntryKey({
      path: currentState.sessionFile,
      id: currentState.sessionId,
    })
    if (!key) return

    sidebarStore.setPinnedSidebarSessionKeys((current) => {
      const currentKeys = normalizeSessionSelectionKeys(current)
      const nextKeys = currentKeys.includes(key)
        ? currentKeys.filter((currentKey) => currentKey !== key)
        : [key, ...currentKeys]

      safeLocalStorageSetItem(
        PINNED_SESSIONS_STORAGE_KEY,
        JSON.stringify(nextKeys)
      )
      return nextKeys
    })
  }

  const sessionHeaderActionsRef = useLatestRef<AppShellSessionHeaderActions>({
    createSession,
    onDeleteCurrentSession: openDeleteDialogForCurrentSession,
    onForkSession: openForkDialog,
    onMoveCurrentSession: moveCurrentSessionToDirectory,
    onMoveCurrentSessionToAnyDirectory:
      openMoveSessionDirectoryDialogForCurrentSession,
    onRenameSession: openRenameDialog,
    onRunCompact: runCompact,
    onToggleCurrentSessionPinned: toggleCurrentSessionPinned,
    onToggleHideThinking: toggleHideThinking,
    onToggleHideToolBlocks: toggleHideToolBlocks,
    onTreeSession: openTreeDialog,
  })

  useAppShellShortcuts({
    addDirectoryOpenRef,
    commandPaletteOpenRef,
    compactRunningRef,
    deleteOpenRef,
    forkOpenRef,
    gitCommitOpenRef,
    moveSessionDirectoryOpenRef,
    pendingUiRequestOpenRef: uiRequestOpenRef,
    renameOpenRef,
    sessionSearchInputRef,
    sessionsOpenRef,
    settingsOpenRef,
    shortcutActionsRef,
    shortcutStateRef,
    treeOpenRef,
  })

  const appShellControllerRef = React.useRef<AppShellController | null>(null)
  appShellControllerRef.current = {
    stores: {
      appUi: appUiStore,
      composer: composerStore,
      contextUsage: contextUsageStore,
      conversationItems: conversationItemsStore,
      displaySettings: displaySettingsStore,
      draftFlow: draftFlowStore,
      notification: notificationStore,
      rightSidebar: rightSidebarStore,
      session: sessionStore,
      sidebar: sidebarStore,
    },
    refs: {
      composerImages: composerImagesRef,
      composerPanel: composerPanelRef,
      composerSkill: composerSkillRef,
      composerText: composerTextRef,
      conversationFrame: conversationFrameRef,
      sessionState: sessionStateRef,
    },
    actions: {
      createSession,
      focusModelSelector,
      focusPrompt,
      focusSessionSearch,
      openAddDirectoryDialog,
      openCommandPalette,
      openDeleteDialog,
      moveSessionToDirectory,
      openDeleteOldDirectorySessionsDialog,
      openMoveSessionDirectoryDialogForEntry,
      openRenameDialogForEntry,
      openSessionsDialog,
      openSettingsDialog,
      selectSession: handleSelectSession,
    },
  }

  React.useImperativeHandle(ref, () => {
    const actions = appShellControllerRef.current?.actions
    return {
      createSession: actions?.createSession ?? createSession,
      openAddDirectoryDialog:
        actions?.openAddDirectoryDialog ?? openAddDirectoryDialog,
      openCommandPalette: actions?.openCommandPalette ?? openCommandPalette,
      openDeleteDialog: actions?.openDeleteDialog ?? openDeleteDialog,
      openDeleteOldDirectorySessionsDialog:
        actions?.openDeleteOldDirectorySessionsDialog ??
        openDeleteOldDirectorySessionsDialog,
      moveSessionToDirectory:
        actions?.moveSessionToDirectory ?? moveSessionToDirectory,
      openMoveSessionDirectoryDialogForEntry:
        actions?.openMoveSessionDirectoryDialogForEntry ??
        openMoveSessionDirectoryDialogForEntry,
      openRenameDialogForEntry:
        actions?.openRenameDialogForEntry ?? openRenameDialogForEntry,
      openSessionsDialog: actions?.openSessionsDialog ?? openSessionsDialog,
      openSettingsDialog: actions?.openSettingsDialog ?? openSettingsDialog,
      selectSession: actions?.selectSession ?? handleSelectSession,
    }
  }, [
    createSession,
    handleSelectSession,
    openAddDirectoryDialog,
    openCommandPalette,
    moveSessionToDirectory,
    openDeleteDialog,
    openDeleteOldDirectorySessionsDialog,
    openMoveSessionDirectoryDialogForEntry,
    openRenameDialogForEntry,
    openSessionsDialog,
    openSettingsDialog,
  ])

  return (
    <>
      <AppShellWindowEffectsHost
        isSessionViewLoading={isSessionViewLoading}
        loadingDisplaySessionTitle={loadingDisplaySessionTitle}
        notificationStore={notificationStore}
        sessionStore={sessionStore}
        sidebarStore={sidebarStore}
        onSelectSession={handleSelectSession}
      />

      <AppShellSessionHeader
        actionsRef={sessionHeaderActionsRef}
        defaultNewSessionDirectory={defaultNewSessionDirectory}
        displaySessionCwd={displaySessionCwd}
        gitPanelOpen={gitPanelOpen}
        loadingDisplaySessionTitle={loadingDisplaySessionTitle}
        currentSessionPinned={currentSessionPinned}
        displaySettingsStore={displaySettingsStore}
        isSessionViewLoading={isSessionViewLoading}
        newSessionDirectoryOptions={newSessionDirectoryOptions}
        onToggleGitPanel={toggleGitPanel}
        sessionStore={sessionStore}
        viewerContextId={viewerContextId}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebar}
        <SidebarInset className="min-h-0 overflow-hidden">
          <AppShellTabsController
            actionsRef={composerActionsRef}
            appUiStore={appUiStore}
            composerPanelRef={composerPanelRef}
            contextUsageStore={contextUsageStore}
            conversationFrameRef={conversationFrameRef}
            conversationItemsStore={conversationItemsStore}
            defaultNewSessionDirectory={defaultNewSessionDirectory}
            displaySettingsStore={displaySettingsStore}
            fileInputRef={fileInputRef}
            gitPanelOpen={gitPanelOpen}
            hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
            isSessionViewLoading={isSessionViewLoading}
            isSubmitting={isSubmitting}
            isMobile={isMobile}
            newSessionDirectoryOptions={newSessionDirectoryOptions}
            onCancelCompaction={abortCompact}
            onCreateSession={(cwdOverride) => {
              void createSession(cwdOverride)
            }}
            onOpenAddDirectoryDialog={openAddDirectoryDialog}
            onCloseAllFileViewTabs={closeAllFileViewTabs}
            onCloseFileViewTab={closeFileViewTab}
            onCloseFileViewTabsToRight={closeFileViewTabsToRight}
            onCloseOtherFileViewTabs={closeOtherFileViewTabs}
            onOpenFileViewTab={openFileViewTab}
            onReorderFileViewTabs={reorderFileViewTabs}
            rightSidebarStore={rightSidebarStore}
            sessionStore={sessionStore}
            store={composerStore}
            viewerContextId={viewerContextId}
            workingStateStore={workingStateStore}
            awaitingFirstTurn={awaitingFirstTurn}
            onValueChange={setCurrentTab}
          />
        </SidebarInset>
      </div>

      <AppShellFloatingControllers
        activeSessionId={activeSessionId}
        addDirectoryDialogRef={addDirectoryDialogRef}
        addDirectoryOpenRef={addDirectoryOpenRef}
        addDirectoryPath={addDirectoryPathForDialog}
        baseSidebarDirectories={baseSidebarDirectories}
        commandPaletteCommandsRef={commandPaletteCommandsRef}
        commandPaletteOpenRef={commandPaletteOpenRef}
        commandPaletteRef={commandPaletteRef}
        currentSessionQueryScope={currentSessionQueryScope}
        currentTheme={currentTheme}
        currentThemeColorMode={currentThemeColorMode}
        authDialogRef={authDialogRef}
        authOpenRef={authOpenRef}
        deleteDialogRef={deleteDialogRef}
        deleteOpenRef={deleteOpenRef}
        deleteSessions={deleteSessions}
        deleteOldDirectorySessionsDialogRef={
          deleteOldDirectorySessionsDialogRef
        }
        deleteOldDirectorySessionsOpenRef={deleteOldDirectorySessionsOpenRef}
        notificationStore={notificationStore}
        forkDialogRef={forkDialogRef}
        forkOpenRef={forkOpenRef}
        gitCommitDialogRef={gitCommitDialogRef}
        gitCommitOpenRef={gitCommitOpenRef}
        displaySettingsStore={displaySettingsStore}
        knownDirectories={knownDirectories}
        moveSessionDirectoryDialogRef={moveSessionDirectoryDialogRef}
        moveSessionDirectoryOpenRef={moveSessionDirectoryOpenRef}
        moveSessionDirectoryTargetToPath={moveSessionDirectoryTargetToPath}
        onAutoScrollEnabledChange={setAutoScroll}
        onCenterMessagesChange={setMessagesCentered}
        onHideThinkingBlocksChange={(hidden) => {
          void setThinkingBlocksHidden(hidden)
        }}
        onHideToolBlocksChange={setToolBlocksHidden}
        onSessionDoneDesktopNotificationsEnabledChange={
          handleSessionDoneDesktopNotificationsEnabledChange
        }
        onSessionDoneSoundEnabledChange={handleSessionDoneSoundEnabledChange}
        onSessionDialogSelect={handleSelectSession}
        onThemeChange={handleThemeChange}
        onThemeColorModeChange={handleThemeColorModeChange}
        onThemePreviewChange={handleThemePreviewChange}
        systemTheme={systemTheme}
        recentDirectoriesStore={recentDirectoriesStore}
        renameDialogRef={renameDialogRef}
        renameOpenRef={renameOpenRef}
        renameSessionPath={renameSessionPath}
        sessionCwd={sessionState.cwd}
        sessionsDialogDirectory={sessionsDialogDirectory}
        sessionsDialogRef={sessionsDialogRef}
        sessionsOpenRef={sessionsOpenRef}
        sessionStore={sessionStore}
        settingsDialogRef={settingsDialogRef}
        settingsOpenRef={settingsOpenRef}
        sidebarStore={sidebarStore}
        treeDialogRef={treeDialogRef}
        treeOpenRef={treeOpenRef}
        uiRequestDialogRef={uiRequestDialogRef}
        uiRequestOpenRef={uiRequestOpenRef}
        viewerContextId={viewerContextId}
      />
    </>
  )
}

export function PicoAppShell({
  sessionId,
  onSelectSession,
}: {
  sessionId?: string
  onSelectSession?: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
}) {
  const [viewerContextId, setViewerContextId] = React.useState("")
  const sidebarStoreRef = React.useRef<AppShellSidebarStore | null>(null)
  if (!sidebarStoreRef.current) {
    sidebarStoreRef.current = createAppShellSidebarStore()
  }
  const sidebarStore = sidebarStoreRef.current
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const sessionWorkspaceRef =
    React.useRef<AppShellSessionWorkspaceHandle | null>(null)

  React.useEffect(() => {
    const storedContext = window.localStorage.getItem(
      VIEWER_CONTEXT_STORAGE_KEY
    )
    const nextContext = storedContext?.trim() || createContextId()
    safeLocalStorageSetItem(VIEWER_CONTEXT_STORAGE_KEY, nextContext)
    setViewerContextId(nextContext)

    const storedDirectories = readStoredSidebarDirectories()
    const nextDirectories = normalizeStoredDirectoryList(
      storedDirectories.directories
    )
    const nextBootstrapDirectories = nextDirectories.slice(
      0,
      INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT
    )
    const nextPinnedSessionKeys = readStoredPinnedSessionKeys()
    sidebarStore.setSidebarState((current) => {
      if (
        sameStringArray(current.sidebarDirectories, nextDirectories) &&
        sameStringArray(
          current.initialSidebarBootstrapDirectories,
          nextBootstrapDirectories
        ) &&
        sameStringArray(current.pinnedSidebarSessionKeys, nextPinnedSessionKeys)
      ) {
        return current
      }

      return {
        sidebarDirectories: nextDirectories,
        initialSidebarBootstrapDirectories: nextBootstrapDirectories,
        pinnedSidebarSessionKeys: nextPinnedSessionKeys,
      }
    })
  }, [sidebarStore])

  return (
    <SidebarProvider className="h-full flex-col overflow-hidden bg-background [--header-height:3rem]">
      <AppShellSessionWorkspace
        ref={sessionWorkspaceRef}
        viewerContextId={viewerContextId}
        sessionId={sessionId}
        onSelectSession={onSelectSession}
        sidebar={
          <AppShellSidebarController
            viewerContextId={viewerContextId}
            sidebarStore={sidebarStore}
            sessionWorkspaceRef={sessionWorkspaceRef}
          />
        }
        sidebarStore={sidebarStore}
        sessionSearchInputRef={sessionSearchInputRef}
      />
    </SidebarProvider>
  )
}
