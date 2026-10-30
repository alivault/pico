import * as React from "react"
import { emitPicoEvent, usePicoEvent } from "@/features/pico/agent/events"
import { useMachineFeature } from "@/features/pico/machine-store"
import { startSidebarSync } from "@/features/pico/sidebar-sync"
import { focusShellSide, getShellLayout } from "@/hooks/use-shell-layout"
import {
  onMachineAction,
  openMachine,
  takeMachineActions,
  type MachineAction,
} from "@/lib/pico/machine"
import { Throttler } from "@tanstack/pacer"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import { SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { AppShellFloatingControllers } from "@/features/pico/app-shell-floating-controllers"
import { AppShellTabsController } from "@/features/pico/app-shell-desktop-layout"
import {
  AppShellAgentHeader,
  type AppShellAgentHeaderActions,
} from "@/features/pico/app-shell-agent-header"
import { AppShellSidebarController } from "@/features/pico/app-shell-sidebar-controller"
import { AppShellWindowEffectsHost } from "@/features/pico/app-shell-window-effects"
import type { AppShellAddDirectoryDialogHandle } from "@/features/pico/app-shell-add-project-dialog"
import type { AppShellAuthDialogHandle } from "@/features/pico/app-shell-auth-dialog"
import type {
  AppCommand,
  AppShellCommandPaletteHandle,
} from "@/features/pico/app-shell-command-palette"
import type { AppShellAgentsDialogHandle } from "@/features/pico/app-shell-agents-dialog"
import type { AppShellSettingsDialogHandle } from "@/features/pico/app-shell-settings-dialog"
import type {
  DeleteOldDirectoryAgentsDialogHandle,
  DeleteAgentsDialogHandle,
  ForkAgentDialogHandle,
  RenameAgentDialogHandle,
} from "@/features/pico/app-shell-agent-dialogs"
import type { AppShellTreeDialogHandle } from "@/features/pico/app-shell-tree-dialog"
import type { AppShellUiRequestDialogHandle } from "@/features/pico/app-shell-ui-request-dialog"
import {
  findSidebarAgentSelectionKey,
  getCurrentAgentTitleFromState,
  resolveNewAgentCwd,
  sameStringArray,
  agentNotificationKey,
  agentScrollKey,
  shallowRecordEqual,
  useLatestRef,
} from "@/features/pico/app-shell-common"
import {
  EMPTY_COMPOSER_LINE_COMMENTS,
  EMPTY_COMPOSER_IMAGES,
  EMPTY_COMPOSER_PENDING_MESSAGES,
  createInitialAppShellComposerSnapshot,
  createOptimisticDraftAgentState,
  createOptimisticPendingId,
  insertOptimisticUserItem,
  pendingDraftFollowUpId,
  removeOptimisticUserItem,
  sameAppShellComposerSnapshot,
  type AppShellComposerActions,
  type AppShellComposerSnapshot,
  type ComposerDiffLineComment,
  type ComposerLineComment,
  isComposerDiffLineComment,
  isComposerFileLineComment,
  type PendingComposerMessage,
  type UserConversationItem,
} from "@/features/pico/app-shell-composer-state"
import {
  FileLineCommentsProvider,
  type FileLineCommentsValue,
} from "@/features/pico/file-line-comments"
import {
  isHeldPendingId,
  type PendingQueueSaveRow,
} from "@/features/pico/pending-queue"
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
  pinRightSidebarFile,
  reorderRightSidebarFiles,
  resetRightSidebarFiles,
  selectRightSidebarVisibleFileTabs,
  setRightSidebarActiveTab,
  type AppShellRightSidebarState,
  type OpenFileViewTabOptions,
} from "@/features/pico/app-shell-right-sidebar-state"
import {
  endProjectFileEdits,
  getDirtyProjectFilePaths,
  useDirtyProjectFilePaths,
} from "@/features/pico/project-file-edits"
import { normalizeCwd } from "@/features/pico/right-sidebar-shared"
import {
  createAppShellSidebarStore,
  mergeSidebarAgentStatusMap,
  bindOptimisticSidebarAgentEntries,
  bindOptimisticSidebarAgentEntryById,
  removeOptimisticSidebarAgentEntry,
  updateOptimisticSidebarAgentPreviewEntry,
  upsertOptimisticSidebarAgentEntry,
  useAppShellSidebarValue,
  type AppShellSidebarStore,
} from "@/features/pico/app-shell-sidebar-store"
import type {
  AppShellDisplaySettingsState,
  AppShellDraftFlowState,
  AppShellNotificationState,
  AppShellAgentWorkspaceHandle,
  AppShellUiState,
  CreateAgentOptions,
  SelectAgentNavigationOptions,
} from "@/features/pico/app-shell-types"
import {
  AWAITING_FIRST_RESPONSE_WORKING_LABEL,
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
import {
  appShortcut,
  formatShortcutLabel,
  pullShortcut,
  rightSidebarPaneShortcut,
  type RightSidebarShortcutPane,
} from "@/features/pico/keyboard-shortcuts"
import { picoQueryKeys } from "@/features/pico/query-keys"
import type {
  GitCommitDialogControllerHandle,
  GitRemoteAction,
} from "@/features/pico/right-sidebar-types"
import {
  getDesktopNotificationPermission,
  primeAgentDoneSound,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from "@/features/pico/agent-done-notifications"
import { useAppShellPromptMutations } from "@/features/pico/use-app-shell-prompt-mutations"
import { usePicoTheme } from "@/features/pico/use-pico-theme"
import {
  applyDirectoryIndexRename,
  updateAgentsEventDirectoryIndexes,
  useAppShellAgentMutations,
} from "@/features/pico/use-app-shell-agent-mutations"
import { useAppShellAgentSync } from "@/features/pico/use-app-shell-agent-sync"
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
  PINNED_AGENTS_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
  TERMINAL_PANEL_OPEN_STORAGE_KEY,
  AGENT_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  AGENT_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  createContextId,
  createInitialAgentState,
  getAgentTitle,
  normalizeAgentSelectionKeys,
  normalizeStoredDirectoryList,
  promptDraftKey,
  readStoredAutoScrollEnabled,
  readStoredCenterMessages,
  readStoredDraftDirectory,
  readStoredHideToolBlocks,
  readStoredPinnedAgentKeys,
  readStoredRecentDirectories,
  readStoredRightSidebarOpen,
  readStoredTerminalPanelOpen,
  readStoredAgentDoneDesktopNotificationsEnabled,
  readStoredAgentDoneSoundEnabled,
  readStoredSidebarDirectories,
  rememberStoredPromptDraft,
  safeLocalStorageSetItem,
  machineLocalStorageSetItem,
  agentListEntryKey,
} from "@/lib/pico"
import type {
  ConversationItem,
  PromptImage,
  AgentState,
  StreamingBehavior,
  ThemeColorMode,
  ThemeFamily,
} from "@/lib/pico"
import type {
  ExtensionUiEvent,
  GitActionResponse,
  AgentDoneEvent,
  AgentListEntry,
  AgentHistoryResponse,
  AgentReadStateResponse,
  AgentStatusEvent,
} from "@/lib/pico/api"
import { useMachineId } from "@/lib/pico/machine-context"

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
    agent: PicoStore<AgentState>
    sidebar: AppShellSidebarStore
  }
  refs: {
    composerImages: React.RefObject<Array<PromptImage>>
    composerPanel: React.RefObject<ComposerPanelHandle | null>
    composerSkill: React.RefObject<string | undefined>
    composerText: React.RefObject<string>
    conversationFrame: React.RefObject<AppShellConversationFrameHandle | null>
    agentState: React.RefObject<AgentState>
  }
  actions: AppShellAgentWorkspaceHandle & {
    focusModelSelector: () => void
    focusPrompt: () => void
    focusAgentSearch: () => void
  }
}

type AppShellAgentWorkspaceProps = {
  viewerContextId: string
  agentId?: string
  onSelectAgent?: (
    agentId?: string,
    options?: SelectAgentNavigationOptions
  ) => void
  sidebar: React.ReactNode
  sidebarStore: AppShellSidebarStore
  agentSearchInputRef: React.RefObject<HTMLInputElement | null>
}

function AppShellAgentWorkspace(
  props: AppShellAgentWorkspaceProps & {
    ref?: React.Ref<AppShellAgentWorkspaceHandle>
  }
) {
  return useAppShellAgentWorkspaceView(props)
}

function useAppShellAgentWorkspaceView({
  viewerContextId,
  agentId,
  onSelectAgent,
  sidebar,
  sidebarStore,
  agentSearchInputRef,
  ref,
}: AppShellAgentWorkspaceProps & {
  ref?: React.Ref<AppShellAgentWorkspaceHandle>
}) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const initialAgentStateRef = React.useRef<AgentState | null>(null)
  if (!initialAgentStateRef.current) {
    initialAgentStateRef.current = createInitialAgentState()
  }
  const agentStoreRef = React.useRef<PicoStore<AgentState> | null>(null)
  if (!agentStoreRef.current) {
    agentStoreRef.current = createPicoStore(initialAgentStateRef.current)
  }
  const agentStore = agentStoreRef.current
  const agentStateRef = React.useRef(agentStore.state)
  const appUiStoreRef = React.useRef<PicoStore<AppShellUiState> | null>(null)
  if (!appUiStoreRef.current) {
    appUiStoreRef.current = createPicoStore<AppShellUiState>(
      {
        currentTab: "conversation",
        gitPanelOpen: false,
        terminalPanelOpen: false,
        initialLoadingAgentId: agentId || null,
        loadingAgentId: null,
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
      // A sidebar that the user opens gets priority over the left sidebar.
      if (nextOpen) focusShellSide("right")
      setStoreField(appUiStore, "gitPanelOpen", nextOpen)
      safeLocalStorageSetItem(
        RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
        nextOpen ? "1" : "0"
      )
    },
    [appUiStore]
  )
  const setTerminalPanelOpen = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const nextOpen = applyStoreAction(
        appUiStore.state.terminalPanelOpen,
        action
      )
      setStoreField(appUiStore, "terminalPanelOpen", nextOpen)
      safeLocalStorageSetItem(
        TERMINAL_PANEL_OPEN_STORAGE_KEY,
        nextOpen ? "1" : "0"
      )
    },
    [appUiStore]
  )
  const setLoadingAgentId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(appUiStore, "loadingAgentId", action)
    },
    [appUiStore]
  )
  const previousRouteAgentIdRef = React.useRef(agentId)
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
  const composerLineCommentsRef = React.useRef<Array<ComposerLineComment>>([])
  const [composerLineComments, setComposerLineCommentsState] = React.useState<
    Array<ComposerLineComment>
  >([])
  const displaySettingsStoreRef =
    React.useRef<PicoStore<AppShellDisplaySettingsState> | null>(null)
  if (!displaySettingsStoreRef.current) {
    displaySettingsStoreRef.current =
      createPicoStore<AppShellDisplaySettingsState>(
        {
          autoScrollEnabled: false,
          centerMessages: true,
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
    optimisticSidebarAgentId?: string
  } | null> | null>(null)
  if (!pendingDraftPromptStoreRef.current) {
    pendingDraftPromptStoreRef.current = createPicoStore<{
      ownerKey: string
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      optimisticId?: string
      optimisticSidebarAgentId?: string
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
        agentDoneDesktopNotificationsEnabled: true,
        agentDoneEvents: [],
        agentDoneSoundEnabled: true,
      },
      shallowRecordEqual
    )
  }
  const notificationStore = notificationStoreRef.current!
  const setAgentDoneEvents = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<AgentDoneEvent>>>
  >(
    (action) => {
      setStoreField(notificationStore, "agentDoneEvents", action)
    },
    [notificationStore]
  )
  const setAgentDoneSoundEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setStoreField(notificationStore, "agentDoneSoundEnabled", action)
    },
    [notificationStore]
  )
  const setAgentDoneDesktopNotificationsEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setStoreField(
        notificationStore,
        "agentDoneDesktopNotificationsEnabled",
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
        draftAgentLoadingOwnerKey: null,
        storedDraftDirectory: "",
      },
      shallowRecordEqual
    )
  }
  const draftFlowStore = draftFlowStoreRef.current!
  const setDraftAgentLoadingOwnerKey = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(draftFlowStore, "draftAgentLoadingOwnerKey", action)
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
  const setComposerLineComments = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<ComposerLineComment>>>
  >(
    (action) => {
      const current = composerLineCommentsRef.current
      const next = applyStoreAction(current, action)
      if (next === current) return

      composerLineCommentsRef.current = next
      setComposerLineCommentsState(next)
      const currentComposerSnapshot = composerStore.state
      setStoreState(composerStore, {
        ...currentComposerSnapshot,
        composerLineComments: currentComposerSnapshot.disabled ? [] : next,
      })
    },
    [composerStore]
  )
  const contextUsageStoreRef = React.useRef<PicoStore<
    AgentState["contextUsage"]
  > | null>(null)
  if (!contextUsageStoreRef.current) {
    contextUsageStoreRef.current =
      createPicoStore<AgentState["contextUsage"]>(undefined)
  }
  const contextUsageStore = contextUsageStoreRef.current
  const contextUsageThrottlerRef = React.useRef<Throttler<
    (contextUsage: AgentState["contextUsage"]) => void
  > | null>(null)
  if (!contextUsageThrottlerRef.current) {
    contextUsageThrottlerRef.current = new Throttler(
      (contextUsage: AgentState["contextUsage"]) => {
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
    (contextUsage: AgentState["contextUsage"]) => {
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
  const moveAgentDirectoryDialogRef =
    React.useRef<AppShellAddDirectoryDialogHandle | null>(null)
  const moveAgentDirectoryOpenRef = React.useRef(false)
  const moveAgentDirectoryTargetRef = React.useRef<AgentListEntry | null>(null)
  const renameDialogRef = React.useRef<RenameAgentDialogHandle | null>(null)
  const renameOpenRef = React.useRef(false)
  const deleteDialogRef = React.useRef<DeleteAgentsDialogHandle | null>(null)
  const deleteOpenRef = React.useRef(false)
  const deleteOldDirectoryAgentsDialogRef =
    React.useRef<DeleteOldDirectoryAgentsDialogHandle | null>(null)
  const deleteOldDirectoryAgentsOpenRef = React.useRef(false)
  const forkDialogRef = React.useRef<ForkAgentDialogHandle | null>(null)
  const forkOpenRef = React.useRef(false)
  const treeDialogRef = React.useRef<AppShellTreeDialogHandle | null>(null)
  const treeOpenRef = React.useRef(false)
  const gitCommitDialogRef =
    React.useRef<GitCommitDialogControllerHandle | null>(null)
  const gitCommitOpenRef = React.useRef(false)
  const agentsDialogRef = React.useRef<AppShellAgentsDialogHandle | null>(null)
  const agentsOpenRef = React.useRef(false)
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
  const loadingOlderHistoryRef = React.useRef(false)
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] =
    React.useState(false)
  const lastSyncedEditorTextRef = React.useRef("")
  const publishSidebarActiveAgent = React.useCallback(
    (
      activeAgent: {
        draft?: boolean
        agentFile?: string
        agentId?: string
        agentKey?: string
        agentPath?: string
      },
      routeAgentId = agentId
    ) => {
      const activeAgentId =
        activeAgent.agentId || (activeAgent.agentKey ? undefined : routeAgentId)
      const activeSidebarAgentId = activeAgent.draft
        ? ""
        : activeAgentId?.trim() || ""
      const activeSidebarAgentPath = activeAgent.draft
        ? ""
        : (activeAgent.agentFile || activeAgent.agentPath || "").trim()
      const activeSidebarAgentKey = activeAgent.draft
        ? ""
        : agentNotificationKey({
            agentFile: activeSidebarAgentPath,
            agentId: activeSidebarAgentId,
          }) ||
          activeAgent.agentKey?.trim() ||
          ""

      sidebarStore.setSidebarState((current) => {
        if (
          current.activeSidebarAgentId === activeSidebarAgentId &&
          current.activeSidebarAgentKey === activeSidebarAgentKey &&
          current.activeSidebarAgentPath === activeSidebarAgentPath
        ) {
          return current
        }

        return {
          activeSidebarAgentId,
          activeSidebarAgentKey,
          activeSidebarAgentPath,
        }
      })
    },
    [agentId, sidebarStore]
  )
  const setAgentState = React.useCallback<
    React.Dispatch<React.SetStateAction<AgentState>>
  >(
    (action) => {
      const currentRefState = agentStateRef.current
      const nextState =
        typeof action === "function"
          ? (action as (current: AgentState) => AgentState)(currentRefState)
          : action
      const currentStoreState = agentStore.state
      if (
        Object.is(currentRefState, nextState) &&
        Object.is(currentStoreState, nextState)
      ) {
        return
      }

      agentStateRef.current = nextState
      setStoreState(agentStore, nextState)
      publishSidebarActiveAgent(nextState)
    },
    [publishSidebarActiveAgent, agentStore]
  )
  const composerTextRef = React.useRef(composerDraftSeedStore.state.text)
  const composerSkillRef = React.useRef<string | undefined>(
    composerDraftSeedStore.state.skillName
  )
  const pendingRouteAgentIdRef = React.useRef<string | undefined>(undefined)
  const pendingRouteAgentPathRef = React.useRef<string | undefined>(undefined)
  const pendingUiRequestHandlerRef = React.useRef(
    (_request: ExtensionUiEvent) => {}
  )
  pendingUiRequestHandlerRef.current = (request) => {
    uiRequestDialogRef.current?.open(request)
  }
  const dismissUiRequestRef = React.useRef((id: string) => {
    uiRequestDialogRef.current?.close(id)
  })
  const autoAddedAgentDirectoryKeysRef = React.useRef<Set<string>>(new Set())
  const pendingMobileSidebarPromptFocusRef = React.useRef(false)
  const conversationItemsStoreRef = React.useRef<ConversationItemsStore | null>(
    null
  )
  if (!conversationItemsStoreRef.current) {
    conversationItemsStoreRef.current = createConversationItemsStore(
      agentStateRef.current.items
    )
  }
  const conversationItemsStore = conversationItemsStoreRef.current
  const loadOlderHistory = React.useCallback(async () => {
    const currentState = agentStateRef.current
    const before = currentState.historyOffset
    const agentId = currentState.agentId?.trim()
    if (
      loadingOlderHistoryRef.current ||
      currentState.draft ||
      !agentId ||
      before <= 0
    ) {
      return
    }

    const agentKey = currentState.agentKey
    loadingOlderHistoryRef.current = true
    setIsLoadingOlderHistory(true)
    try {
      const history = await fetchJson<
        Extract<AgentHistoryResponse, { ok: true }>
      >(
        buildRequestUrl("/api/agent/history", {
          machineId,
          contextId: viewerContextId,
          agentId,
          searchParams: { before, limit: 50 },
        })
      )
      const latestState = agentStateRef.current
      if (
        latestState.agentKey !== agentKey ||
        latestState.historyOffset !== before
      ) {
        return
      }

      const nextState = {
        ...latestState,
        items: [...history.items, ...latestState.items],
        historyOffset: history.offset,
        historyTotalCount: history.totalCount,
      }
      conversationItemsStore.setItems(nextState.items)
      setAgentState(nextState)
    } catch (error) {
      toast.error("Could not load earlier messages", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      loadingOlderHistoryRef.current = false
      setIsLoadingOlderHistory(false)
    }
  }, [conversationItemsStore, setAgentState, viewerContextId])
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
        if (next && !agentStateRef.current.streaming) {
          setStoreState(workingStateStore, {
            label: AWAITING_FIRST_RESPONSE_WORKING_LABEL,
          })
        } else if (
          !next &&
          workingStateStore.state?.label ===
            AWAITING_FIRST_RESPONSE_WORKING_LABEL
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
        optimisticSidebarAgentId?: string
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
            label: "Waiting for new agent…",
          })
        } else if (
          workingStateStore.state?.label === "Waiting for new agent…"
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
  const setConversationItems = React.useCallback(
    (items: Array<ConversationItem>) => {
      conversationItemsStore.setItems(items)
    },
    [conversationItemsStore]
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
        images: options.images.map((image) => ({
          mimeType: image.mimeType,
          url: image.previewUrl,
        })),
        queued: options.queued,
        streamingBehavior: options.streamingBehavior,
      } satisfies UserConversationItem

      const currentState = agentStateRef.current
      const nextItems = insertOptimisticUserItem(currentState.items, item)
      if (nextItems !== currentState.items) {
        const nextState = { ...currentState, items: nextItems }
        agentStateRef.current = nextState
        conversationItemsStore.setItems(nextItems)
        setAgentState(nextState)
      }

      return pendingId
    },
    [conversationItemsStore]
  )
  const removeOptimisticUserMessage = React.useCallback(
    (pendingId: string | undefined) => {
      if (!pendingId) return

      const currentState = agentStateRef.current
      const nextItems = removeOptimisticUserItem(currentState.items, pendingId)
      if (nextItems === currentState.items) return

      const nextState = { ...currentState, items: nextItems }
      agentStateRef.current = nextState
      conversationItemsStore.setItems(nextItems)
      setAgentState(nextState)
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
  const { initialLoadingAgentId, loadingAgentId } = useSelector(
    appUiStore,
    (state) => ({
      initialLoadingAgentId: state.initialLoadingAgentId,
      loadingAgentId: state.loadingAgentId,
    }),
    { compare: shallowRecordEqual }
  )
  const { draftAgentLoadingOwnerKey, storedDraftDirectory } =
    useSelector(draftFlowStore)
  const agentState = useSelector(
    agentStore,
    (currentAgentState) => ({
      cwd: currentAgentState.cwd,
      directory: currentAgentState.directory,
      draft: currentAgentState.draft,
      agentFile: currentAgentState.agentFile,
      agentId: currentAgentState.agentId,
      agentKey: currentAgentState.agentKey,
    }),
    { compare: shallowRecordEqual }
  )
  const gitPanelOpen = useSelector(appUiStore, (state) => state.gitPanelOpen)
  const terminalPanelOpen = useSelector(
    appUiStore,
    (state) => state.terminalPanelOpen
  )

  const openFileViewTab = (path: string, options?: OpenFileViewTabOptions) => {
    if (!path) return
    batch(() => {
      setGitPanelOpen(true)
      if (isMobile) {
        setCurrentTab("git")
      }
      openRightSidebarFile(rightSidebarStore, path, {
        ...options,
        pin: isMobile || options?.pin,
      })
    })
  }

  const fileEditCwd = normalizeCwd(agentState.cwd)
  const dirtyFileEditPaths = useDirtyProjectFilePaths(machineId, fileEditCwd)

  // A file with unsaved changes keeps its tab: a preview tab becomes pinned.
  React.useEffect(() => {
    const previewPath = rightSidebarStore.state.filePreviewPath
    if (previewPath && dirtyFileEditPaths.includes(previewPath))
      pinRightSidebarFile(rightSidebarStore, previewPath)
  }, [dirtyFileEditPaths, rightSidebarStore])

  /**
   * Before file tabs close, ask to discard their unsaved changes. Then end
   * their edits. Returns false when the user keeps the tabs.
   */
  const discardFileEdits = (paths: Array<string>) => {
    const dirty = getDirtyProjectFilePaths(machineId, fileEditCwd).filter(
      (path) => paths.includes(path)
    )
    if (dirty.length > 0) {
      const names = dirty.map((path) => path.split("/").at(-1) || path)
      const message =
        dirty.length === 1
          ? `Discard your unsaved changes to ${names[0]}?`
          : `Discard your unsaved changes to ${dirty.length} files (${names.join(", ")})?`
      if (!window.confirm(message)) return false
    }
    endProjectFileEdits(machineId, fileEditCwd, paths)
    return true
  }

  const visibleFileViewTabs = () =>
    selectRightSidebarVisibleFileTabs(rightSidebarStore.state)

  const closeFileViewTab = (path: string) => {
    if (!discardFileEdits([path])) return
    closeRightSidebarFile(rightSidebarStore, path)
  }

  const closeOtherFileViewTabs = (path: string) => {
    if (!discardFileEdits(visibleFileViewTabs().filter((tab) => tab !== path)))
      return
    closeOtherRightSidebarFiles(rightSidebarStore, path)
  }

  const closeFileViewTabsToRight = (path: string) => {
    const tabs = visibleFileViewTabs()
    const index = tabs.indexOf(path)
    if (index >= 0 && !discardFileEdits(tabs.slice(index + 1))) return
    closeRightSidebarFilesToRight(rightSidebarStore, path)
  }

  const closeAllFileViewTabs = () => {
    if (!discardFileEdits(visibleFileViewTabs())) return
    closeAllRightSidebarFiles(rightSidebarStore)
  }

  const reorderFileViewTabs = (paths: Array<string>) => {
    reorderRightSidebarFiles(rightSidebarStore, paths)
  }

  usePicoEvent("pico:open-sidebar-tab", (detail) => {
    if (isMobile && detail.tab === "agent") {
      setCurrentTab("agent")
      return
    }
    batch(() => {
      setRightSidebarActiveTab(rightSidebarStore, detail.tab)
      setGitPanelOpen(true)
      if (isMobile) setCurrentTab("git")
    })
  })

  // Open the right sidebar on a pane. If the pane already shows, close the
  // sidebar.
  const toggleRightSidebarPane = (pane: RightSidebarShortcutPane) => {
    const activeTab = rightSidebarStore.state.activeTab
    if (isMobile) {
      // On mobile, the Agent panel has its own top-level tab.
      if (pane === "agent") {
        setCurrentTab((tab) => (tab === "agent" ? "conversation" : "agent"))
        return
      }
      if (pane === "files")
        setStoreField(rightSidebarStore, "fileActivePath", "")
      setRightSidebarActiveTab(rightSidebarStore, pane)
      setCurrentTab((tab) =>
        tab === "git" && activeTab === pane ? "conversation" : "git"
      )
      return
    }

    if (gitPanelOpen && getShellLayout().rightShown && activeTab === pane) {
      setGitPanelOpen(false)
      return
    }

    batch(() => {
      setRightSidebarActiveTab(rightSidebarStore, pane)
      setGitPanelOpen(true)
    })
  }

  const toggleFileView = () => {
    toggleRightSidebarPane("review")
  }

  React.useEffect(() => {
    resetRightSidebarFiles(rightSidebarStore)
  }, [rightSidebarStore, agentState.cwd])

  React.useEffect(() => {
    if (!agentState.draft) return
    resetRightSidebarFiles(rightSidebarStore)
  }, [rightSidebarStore, agentState.draft])

  const sidebarWorkspaceVersion = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.workspaceVersion
  )
  void sidebarWorkspaceVersion
  const {
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes,
    sidebarAgents,
    selectedSidebarAgents,
    sidebarAgentEntriesByKey,
  } = sidebarStore.getWorkspaceSnapshot()
  const agentsEventDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.agentsEvent?.directories || [],
    sameStringArray
  )
  const applySidebarAgentStatusRef = React.useRef(
    (status: AgentStatusEvent) => {
      sidebarStore.setSidebarAgentStatusByKey((current) =>
        mergeSidebarAgentStatusMap(current, status)
      )
    }
  )
  applySidebarAgentStatusRef.current = (status) => {
    sidebarStore.setSidebarAgentStatusByKey((current) =>
      mergeSidebarAgentStatusMap(current, status)
    )
  }
  const bindOptimisticSidebarAgentRef = React.useRef(
    (agent: { cwd?: string; agentId?: string; agentPath?: string }) => {
      sidebarStore.setDirectoryIndexDataByPath((current) =>
        bindOptimisticSidebarAgentEntries(current, agent)
      )
      sidebarStore.setAgentsEvent((current) => {
        if (!current?.directoryIndexes) return current
        const directoryIndexes = bindOptimisticSidebarAgentEntries(
          current.directoryIndexes,
          agent
        )
        return directoryIndexes === current.directoryIndexes
          ? current
          : { ...current, directoryIndexes }
      })
    }
  )
  // The server sends a new name (rename, auto name) in the agent state at
  // once. The sidebar index refreshes later, and not while the agent streams,
  // so put the name in the sidebar entry now.
  const activeAgentFile = agentState.agentFile
  const activeAgentName = useSelector(agentStore, (state) =>
    state.agentName?.trim()
  )
  React.useEffect(() => {
    if (!activeAgentFile || !activeAgentName) return
    sidebarStore.setDirectoryIndexDataByPath((current) =>
      applyDirectoryIndexRename(current, activeAgentFile, activeAgentName)
    )
    sidebarStore.setAgentsEvent((current) =>
      updateAgentsEventDirectoryIndexes(current, (indexes) =>
        applyDirectoryIndexRename(indexes, activeAgentFile, activeAgentName)
      )
    )
  }, [activeAgentFile, activeAgentName, sidebarStore])
  const activeAgentId =
    agentState.agentId || (agentState.agentKey ? undefined : agentId)
  const currentAgentPinKey = agentListEntryKey({
    path: agentState.agentFile,
    id: activeAgentId,
  })
  const currentAgentPinned = useAppShellSidebarValue(sidebarStore, (snapshot) =>
    currentAgentPinKey
      ? snapshot.state.pinnedSidebarAgentKeys.includes(currentAgentPinKey)
      : false
  )
  const currentAgentQueryScope = agentScrollKey(agentState)
  const contextUsageAgentScopeRef = React.useRef("")
  React.useLayoutEffect(() => {
    if (contextUsageAgentScopeRef.current === currentAgentQueryScope) return
    contextUsageAgentScopeRef.current = currentAgentQueryScope
    contextUsageThrottler.cancel()
    setStoreState(contextUsageStore, agentStateRef.current.contextUsage)
  }, [contextUsageStore, contextUsageThrottler, currentAgentQueryScope])
  const initialRouteLoadingAgentId =
    initialLoadingAgentId && !agentState.agentKey ? initialLoadingAgentId : null
  const activeLoadingAgentId =
    loadingAgentId && loadingAgentId !== agentState.agentId
      ? loadingAgentId
      : initialRouteLoadingAgentId &&
          initialRouteLoadingAgentId !== agentState.agentId
        ? initialRouteLoadingAgentId
        : null
  const isAgentViewLoading = Boolean(activeLoadingAgentId)
  const loadingAgentSummary = activeLoadingAgentId
    ? sidebarAgents.find((agent) => agent.id === activeLoadingAgentId)
    : undefined
  const loadingAgentTitle = getAgentTitle(loadingAgentSummary)
  const loadingDisplayAgentTitle =
    loadingAgentTitle !== "New agent" ? loadingAgentTitle : "Loading agent…"
  const displayAgentCwd = isAgentViewLoading
    ? loadingAgentSummary?.cwd
    : agentState.cwd
  React.useEffect(() => {
    const previousAgentId = previousRouteAgentIdRef.current
    previousRouteAgentIdRef.current = agentId

    if (previousAgentId === agentId) return

    const currentAgent = agentStateRef.current
    const optimisticAgentPath = agentId
      ? pendingRouteAgentPathRef.current ||
        sidebarStore.state.derived.sidebarAgents.find(
          (agent) => agent.id === agentId
        )?.path
      : undefined
    const optimisticActiveAgent = agentId
      ? currentAgent.draft || currentAgent.agentId !== agentId
        ? {
            agentId,
            agentPath: optimisticAgentPath,
          }
        : currentAgent
      : { draft: true }

    publishSidebarActiveAgent(optimisticActiveAgent, agentId)
    setStoreState(appUiStore, (current) => ({
      ...current,
      currentTab:
        current.currentTab === "git" ||
        current.currentTab === "agent" ||
        current.currentTab === "terminal"
          ? "conversation"
          : current.currentTab,
      initialLoadingAgentId: agentId ? current.initialLoadingAgentId : null,
      loadingAgentId:
        agentId && agentStateRef.current.agentId !== agentId ? agentId : null,
    }))
  }, [appUiStore, publishSidebarActiveAgent, agentId, sidebarStore])

  React.useEffect(() => {
    if (isMobile) return
    setCurrentTab((tab) =>
      tab === "git" || tab === "agent" || tab === "terminal"
        ? "conversation"
        : tab
    )
  }, [isMobile, setCurrentTab])

  const syncComposerDraft = (value: string, target = agentStateRef.current) => {
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
      machineId,
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }

  const replaceComposerDraft = (
    value: string,
    target = agentStateRef.current,
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
      machineId,
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }
  const replaceComposerDraftRef = useLatestRef(replaceComposerDraft)

  const applyStoredClientPreferences = () => {
    batch(() => {
      setGitPanelOpen(readStoredRightSidebarOpen())
      setTerminalPanelOpen(readStoredTerminalPanelOpen())
      setStoredDraftDirectory(readStoredDraftDirectory(machineId) || "")
      setAgentDoneSoundEnabled(readStoredAgentDoneSoundEnabled())
      setAgentDoneDesktopNotificationsEnabled(
        readStoredAgentDoneDesktopNotificationsEnabled()
      )
      setHideToolBlocks(readStoredHideToolBlocks())
      setCenterMessages(readStoredCenterMessages())
      setAutoScrollEnabled(readStoredAutoScrollEnabled())
      setRecentDirectories(readStoredRecentDirectories(machineId))
      setDesktopNotificationPermission(getDesktopNotificationPermission())
    })
  }

  React.useEffect(() => {
    applyStoredClientPreferences()
  }, [])

  const openCommandPalette = () => {
    agentsDialogRef.current?.close()
    settingsDialogRef.current?.close()
    commandPaletteRef.current?.open()
  }

  const closeCommandPalette = () => {
    commandPaletteRef.current?.close()
  }

  const openAgentsDialog = () => {
    commandPaletteRef.current?.close()
    settingsDialogRef.current?.close()
    agentsDialogRef.current?.open()
  }

  const openSettingsDialog = () => {
    commandPaletteRef.current?.close()
    agentsDialogRef.current?.close()
    settingsDialogRef.current?.open()
  }

  const openCommitDialog = () => {
    commandPaletteRef.current?.close()
    agentsDialogRef.current?.close()
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
      agentStateRef.current.cwd?.trim() || "",
      "push"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-push", {
          machineId,
          contextId: viewerContextId,
        }),
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
      agentStateRef.current.cwd?.trim() || "",
      "force-push"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-push", {
          machineId,
          contextId: viewerContextId,
        }),
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
      agentStateRef.current.cwd?.trim() || "",
      "pull"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-pull", {
          machineId,
          contextId: viewerContextId,
        }),
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
    const cwd = agentStateRef.current.cwd?.trim() || ""
    if (!cwd) {
      toast.error("Open an agent in a repository before running Git actions.")
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
      setCurrentTab((tab) => (tab === "git" ? "conversation" : "git"))
      return
    }
    // The sidebar is open but hidden because the window is too narrow. Show
    // it; the left sidebar hides instead.
    if (gitPanelOpen && !getShellLayout().rightShown) {
      focusShellSide("right")
      return
    }

    setGitPanelOpen((open) => !open)
  }

  const terminalsAvailable = useMachineFeature("native-pty")

  usePicoEvent("pico:open-job-terminal", () => {
    if (!terminalsAvailable) return
    if (isMobile) setCurrentTab("terminal")
    else setTerminalPanelOpen(true)
  })

  const toggleTerminalPanel = () => {
    if (!terminalsAvailable) {
      toast.info("This machine has no terminals. Update Pico on it.")
      return
    }
    if (isMobile) {
      setCurrentTab((tab) => (tab === "terminal" ? "conversation" : "terminal"))
      return
    }

    setTerminalPanelOpen((open) => !open)
  }

  const closeTerminalPanel = () => {
    if (isMobile) {
      setCurrentTab((tab) => (tab === "terminal" ? "conversation" : tab))
      return
    }

    setTerminalPanelOpen(false)
  }

  const openRenameDialog = () => {
    const currentState = agentStateRef.current
    if (!currentState.agentFile) return
    renameDialogRef.current?.open({
      path: currentState.agentFile,
      title:
        currentState.agentName || getCurrentAgentTitleFromState(currentState),
      hasGeneratedName: Boolean(currentState.agentName?.trim()),
    })
  }

  const openRenameDialogForEntry = (entry: AgentListEntry) => {
    renameDialogRef.current?.openForEntry(entry)
  }

  const openDeleteDialog = (targets: Array<AgentListEntry>) => {
    deleteDialogRef.current?.open(targets)
  }

  const openDeleteOldDirectoryAgentsDialog = (directory: string) => {
    deleteOldDirectoryAgentsDialogRef.current?.open(directory)
  }

  const currentAgentListEntry = () => {
    const currentState = agentStateRef.current
    if (!currentState.agentFile) return undefined

    return {
      path: currentState.agentFile,
      id: currentState.agentId,
      cwd: currentState.cwd,
      title: getCurrentAgentTitleFromState(currentState),
      name: currentState.agentName,
      modified: currentState.modified,
    } satisfies AgentListEntry
  }

  const openDeleteDialogForCurrentAgent = () => {
    const currentEntry = currentAgentListEntry()
    if (!currentEntry) return

    openDeleteDialog([currentEntry])
  }

  const openAddDirectoryDialog = () => {
    addDirectoryDialogRef.current?.open()
  }

  const openMoveAgentDirectoryDialogForEntry = (entry: AgentListEntry) => {
    if (!entry.path) return
    moveAgentDirectoryTargetRef.current = entry
    moveAgentDirectoryDialogRef.current?.open()
  }

  const openMoveAgentDirectoryDialogForCurrentAgent = () => {
    const currentEntry = currentAgentListEntry()
    if (!currentEntry) return
    openMoveAgentDirectoryDialogForEntry(currentEntry)
  }

  const openForkDialog = async () => {
    await forkDialogRef.current?.open()
  }

  const openTreeDialog = async () => {
    await treeDialogRef.current?.open()
  }

  const focusAgentSearch = () => {
    openAgentsDialog()
  }

  const focusPrompt = () => {
    if (appUiStore.state.currentTab !== "conversation") {
      setCurrentTab("conversation")
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
      deleteOldDirectoryAgentsOpenRef.current ||
      deleteOpenRef.current ||
      forkOpenRef.current ||
      gitCommitOpenRef.current ||
      renameOpenRef.current ||
      agentsOpenRef.current ||
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
    agentId: "",
    nonce: 0,
  })
  const promptFocusRequestTimeoutRef = React.useRef<number | null>(null)
  const lastAutoFocusedAgentKeyRef = React.useRef<string | null>(null)

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
    if (isAgentViewLoading || hasOpenDialogSurface()) return

    const agentFocusKey = agentState.agentKey || agentState.agentId || "draft"
    if (lastAutoFocusedAgentKeyRef.current === agentFocusKey) return

    lastAutoFocusedAgentKeyRef.current = agentFocusKey
    focusPromptRef.current()
  }, [
    focusPromptRef,
    isAgentViewLoading,
    agentState.agentId,
    agentState.agentKey,
  ])

  React.useEffect(() => {
    const promptFocusRequest = promptFocusRequestRef.current
    if (
      !promptFocusRequest.nonce ||
      isAgentViewLoading ||
      hasOpenDialogSurface()
    ) {
      return
    }
    if (
      promptFocusRequest.agentId &&
      agentState.agentId !== promptFocusRequest.agentId
    ) {
      return
    }

    schedulePromptFocusRequest()
  }, [isAgentViewLoading, agentState.agentId])

  const handleAgentDoneSoundEnabledChange = (enabled: boolean) => {
    setAgentDoneSoundEnabled(enabled)
    safeLocalStorageSetItem(
      AGENT_DONE_SOUND_ENABLED_STORAGE_KEY,
      enabled ? "1" : "0"
    )

    if (enabled) {
      void primeAgentDoneSound()
    }
  }

  const handleAgentDoneDesktopNotificationsEnabledChange = async (
    enabled: boolean
  ) => {
    setAgentDoneDesktopNotificationsEnabled(enabled)
    safeLocalStorageSetItem(
      AGENT_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
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

  const syncSidebarSelectionForAgent = React.useCallback(
    (nextAgentId?: string, options?: SelectAgentNavigationOptions) => {
      const nextKey = nextAgentId
        ? findSidebarAgentSelectionKey(
            sidebarStore.state.derived.sidebarAgentEntriesByKey,
            {
              agentId: nextAgentId,
              agentPath: options?.agentPath,
            }
          )
        : ""

      sidebarStore.setSelectedSidebarAgentKeys((current) => {
        if (!nextKey) return current.length === 0 ? current : []
        return sameStringArray(current, [nextKey]) ? current : [nextKey]
      })
      sidebarStore.setSidebarAgentSelectionAnchor((current) =>
        current === nextKey ? current : nextKey
      )
    },
    [sidebarStore]
  )

  const handleSelectAgent = React.useCallback(
    (nextAgentId?: string, options?: SelectAgentNavigationOptions) => {
      setCurrentTab((tab) => (tab === "git" ? "conversation" : tab))
      syncSidebarSelectionForAgent(nextAgentId, options)
      publishSidebarActiveAgent({
        draft: !nextAgentId,
        agentId: nextAgentId,
        agentPath: options?.agentPath,
      })

      pendingRouteAgentIdRef.current = nextAgentId
      pendingRouteAgentPathRef.current = options?.agentPath?.trim() || undefined
      if (nextAgentId) {
        promptFocusRequestRef.current = {
          agentId: nextAgentId,
          nonce: promptFocusRequestRef.current.nonce + 1,
        }
      }
      setLoadingAgentId((current) => {
        if (!nextAgentId) {
          return null
        }
        if (
          !agentStateRef.current.draft &&
          agentStateRef.current.agentId === nextAgentId
        ) {
          return current
        }
        return nextAgentId
      })
      onSelectAgent?.(nextAgentId, options)
    },
    [
      onSelectAgent,
      agentStateRef,
      publishSidebarActiveAgent,
      syncSidebarSelectionForAgent,
    ]
  )
  const handleSelectAgentRef = useLatestRef(handleSelectAgent)
  // Another device changed the shared sidebar layout. The first directories
  // that the event stream loads stay the same, so the stream does not restart.
  usePicoEvent(
    "pico:sidebar-state",
    ({ machineId: changedMachine, changed }) => {
      if (changedMachine !== machineId) return
      if (changed.includes("directories")) {
        sidebarStore.setSidebarDirectories(
          normalizeStoredDirectoryList(
            readStoredSidebarDirectories(machineId).directories
          )
        )
      }
      if (changed.includes("pinnedAgentKeys")) {
        sidebarStore.setPinnedSidebarAgentKeys(
          readStoredPinnedAgentKeys(machineId)
        )
      }
    }
  )

  usePicoEvent("pico:open-agent", (detail) => {
    handleSelectAgent(detail.agentId)
  })

  useAppShellAgentSync({
    viewerContextId,
    agentId,
    draftAgentLoadingOwnerKey,
    bootstrapSidebarDirectories:
      sidebarStore.state.state.initialSidebarBootstrapDirectories,
    hideToolBlocksRef,
    agentStore,
    agentStateRef,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraftRef,
    handleSelectAgentRef,
    pendingRouteAgentIdRef,
    pendingRouteAgentPathRef,
    setAgentState,
    setConversationItems,
    setWorkingState,
    setCompactRunningState,
    setComposerContextUsage,
    setComposerStreaming,
    setAgentsEvent: sidebarStore.setAgentsEvent,
    setAgentDoneEvents,
    applySidebarAgentStatusRef,
    bindOptimisticSidebarAgentRef,
    setComposerImages,
    setPendingMessages,
    pendingUiRequestHandlerRef,
    dismissUiRequestRef,
    lastSyncedEditorTextRef,
  })

  // The sidebar directory of the agent. A worktree agent works in its
  // worktree, but belongs to the directory of the agent that made it.
  const agentDirectory = (agentState.directory ?? agentState.cwd)?.trim()

  React.useEffect(() => {
    if (!agentDirectory) return
    machineLocalStorageSetItem(
      machineId,
      DRAFT_DIRECTORY_STORAGE_KEY,
      agentDirectory
    )
    setStoredDraftDirectory(agentDirectory)
  }, [agentDirectory])

  React.useEffect(() => {
    const nextDirectory = agentDirectory
    const nextAgentId = agentState.agentId?.trim()
    if (!agentId || !nextAgentId || agentState.draft || !nextDirectory) {
      return
    }
    if (nextAgentId !== agentId) return

    const autoAddKey = `${nextAgentId}\n${nextDirectory}`
    if (autoAddedAgentDirectoryKeysRef.current.has(autoAddKey)) return
    autoAddedAgentDirectoryKeysRef.current.add(autoAddKey)

    sidebarStore.setSidebarDirectories((current) => {
      const normalizedCurrent = normalizeStoredDirectoryList(current)
      if (normalizedCurrent.includes(nextDirectory)) return current

      const nextDirectories = normalizeStoredDirectoryList([
        nextDirectory,
        ...normalizedCurrent,
      ])
      machineLocalStorageSetItem(
        machineId,
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(nextDirectories)
      )
      return nextDirectories
    })
  }, [
    agentDirectory,
    agentId,
    agentState.draft,
    agentState.agentId,
    sidebarStore,
  ])

  const defaultNewAgentDirectory =
    agentDirectory || baseSidebarDirectories[0] || storedDraftDirectory || ""
  const newAgentDirectoryOptions = React.useMemo(() => {
    const nextOptions: Array<{ path: string; label: string }> = []
    const seen = new Set<string>()
    const pushDirectoryOption = (path: string, label: string) => {
      const normalizedPath = path.trim()
      if (!normalizedPath || seen.has(normalizedPath)) return
      seen.add(normalizedPath)
      nextOptions.push({ path: normalizedPath, label })
    }

    if (agentDirectory) {
      pushDirectoryOption(agentDirectory, "Current agent directory")
    }
    if (storedDraftDirectory) {
      pushDirectoryOption(storedDraftDirectory, "Draft directory")
    }
    for (const directory of baseSidebarDirectories) {
      pushDirectoryOption(directory, "Sidebar directory")
    }

    return nextOptions
  }, [baseSidebarDirectories, agentDirectory, storedDraftDirectory])

  const knownDirectories = React.useMemo(
    () =>
      normalizeStoredDirectoryList([
        ...baseSidebarDirectories,
        ...agentsEventDirectories,
        agentState.cwd || "",
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
      agentState.cwd,
      agentsEventDirectories,
      storedDraftDirectory,
    ]
  )

  const agentsDialogDirectory =
    agentState.cwd?.trim() ||
    (baseSidebarDirectories.length > 0
      ? (baseSidebarDirectories[0] ?? "")
      : storedDraftDirectory) ||
    defaultNewAgentDirectory

  const rememberRecentDirectory = (directory: string) => {
    const normalizedDirectory = directory.trim()
    if (!normalizedDirectory) return

    setRecentDirectories((current) => {
      const next = normalizeStoredDirectoryList([
        normalizedDirectory,
        ...current,
      ]).slice(0, RECENT_DIRECTORIES_LIMIT)
      machineLocalStorageSetItem(
        machineId,
        RECENT_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }

  const prefetchDirectoryAgentsIndex = React.useCallback(
    (_directory: string) => {},
    []
  )

  const addOptimisticSidebarAgent = React.useCallback(
    (options?: { id?: string; cwd?: string; lastMessagePreview?: string }) => {
      const currentState = agentStateRef.current
      const optimisticId = (
        options?.id ||
        currentState.agentKey ||
        `optimistic:${promptDraftKey(currentState)}`
      ).trim()
      const cwd = (
        options?.cwd ||
        currentState.cwd ||
        defaultNewAgentDirectory
      ).trim()
      if (!optimisticId || !cwd) return undefined

      const modified = new Date().toISOString()
      const entry = {
        id: optimisticId,
        cwd,
        title: "New agent",
        modified,
        lastUserMessageAt: modified,
        lastMessageAt: modified,
        ...(options?.lastMessagePreview
          ? { lastMessagePreview: options.lastMessagePreview }
          : {}),
        streaming: true,
        unread: false,
        optimistic: true,
      } satisfies AgentListEntry
      const entryKey = agentListEntryKey(entry)

      sidebarStore.setSidebarDirectories((current) => {
        const normalizedCurrent = normalizeStoredDirectoryList(current)
        if (normalizedCurrent.includes(cwd)) return current

        const nextDirectories = normalizeStoredDirectoryList([
          cwd,
          ...normalizedCurrent,
        ])
        machineLocalStorageSetItem(
          machineId,
          SIDEBAR_DIRECTORIES_STORAGE_KEY,
          JSON.stringify(nextDirectories)
        )
        return nextDirectories
      })
      const optimisticEntry = {
        ...entry,
        id: optimisticId,
        cwd,
      }
      sidebarStore.setDirectoryIndexDataByPath((current) =>
        upsertOptimisticSidebarAgentEntry(current, optimisticEntry)
      )
      // Update the event index only when it has this directory. Otherwise
      // the event gets an index with only the new entry, and the merge of the
      // event replaces the full directory list with it.
      sidebarStore.setAgentsEvent((current) =>
        current?.directoryIndexes?.[cwd]
          ? {
              ...current,
              directoryIndexes: upsertOptimisticSidebarAgentEntry(
                current.directoryIndexes || {},
                optimisticEntry
              ),
            }
          : current
      )
      if (entryKey) {
        sidebarStore.setSelectedSidebarAgentKeys((current) =>
          sameStringArray(current, [entryKey]) ? current : [entryKey]
        )
        sidebarStore.setSidebarAgentSelectionAnchor((current) =>
          current === entryKey ? current : entryKey
        )
      }

      return optimisticId
    },
    [defaultNewAgentDirectory, agentStateRef, sidebarStore]
  )

  const removeOptimisticSidebarAgent = React.useCallback(
    (optimisticId: string | undefined) => {
      const targetId = optimisticId?.trim() || ""
      if (!targetId) return

      const entryKey = agentListEntryKey({ id: targetId })
      sidebarStore.setDirectoryIndexDataByPath((current) =>
        removeOptimisticSidebarAgentEntry(current, targetId)
      )
      sidebarStore.setAgentsEvent((current) =>
        current?.directoryIndexes
          ? {
              ...current,
              directoryIndexes: removeOptimisticSidebarAgentEntry(
                current.directoryIndexes,
                targetId
              ),
            }
          : current
      )
      if (entryKey) {
        sidebarStore.setSelectedSidebarAgentKeys((current) =>
          current.filter((key) => key !== entryKey)
        )
        sidebarStore.setSidebarAgentSelectionAnchor((current) =>
          current === entryKey ? "" : current
        )
      }
    },
    [sidebarStore]
  )

  const bindOptimisticSidebarAgent = React.useCallback(
    (
      optimisticId: string | undefined,
      agent: { agentId?: string; agentPath?: string }
    ) => {
      const targetId = optimisticId?.trim() || ""
      if (!targetId || !agent.agentId) return

      sidebarStore.setDirectoryIndexDataByPath((current) =>
        bindOptimisticSidebarAgentEntryById(current, targetId, agent)
      )
      sidebarStore.setAgentsEvent((current) => {
        if (!current?.directoryIndexes) return current
        const directoryIndexes = bindOptimisticSidebarAgentEntryById(
          current.directoryIndexes,
          targetId,
          agent
        )
        return directoryIndexes === current.directoryIndexes
          ? current
          : { ...current, directoryIndexes }
      })

      const previousKey = agentListEntryKey({ id: targetId })
      const nextKey = agentListEntryKey({
        id: agent.agentId,
        path: agent.agentPath,
      })
      if (!previousKey || !nextKey) return
      sidebarStore.setSelectedSidebarAgentKeys((current) =>
        current.includes(previousKey)
          ? current.map((key) => (key === previousKey ? nextKey : key))
          : current
      )
      sidebarStore.setSidebarAgentSelectionAnchor((current) =>
        current === previousKey ? nextKey : current
      )
    },
    [sidebarStore]
  )

  const updateOptimisticSidebarAgentPreview = React.useCallback(
    (options: { preview: string; optimisticSidebarAgentId?: string }) => {
      const preview = options.preview.trim()
      if (!preview) return

      const currentState = agentStateRef.current
      const modified = new Date().toISOString()
      const agentId =
        options.optimisticSidebarAgentId ||
        currentState.agentId ||
        currentState.agentKey
      const agentPath = currentState.agentFile

      const previewUpdate = {
        ...(agentId ? { agentId } : {}),
        ...(agentPath ? { agentPath } : {}),
        preview,
        modified,
      }

      sidebarStore.setDirectoryIndexDataByPath((current) =>
        updateOptimisticSidebarAgentPreviewEntry(current, previewUpdate)
      )
      sidebarStore.setAgentsEvent((current) => {
        if (!current?.directoryIndexes) return current
        const directoryIndexes = updateOptimisticSidebarAgentPreviewEntry(
          current.directoryIndexes,
          previewUpdate
        )
        return directoryIndexes === current.directoryIndexes
          ? current
          : { ...current, directoryIndexes }
      })
    },
    [agentStateRef, sidebarStore]
  )

  const clearSelectedSidebarSelection = React.useCallback(() => {
    sidebarStore.setSelectedSidebarAgentKeys((current) =>
      current.length === 0 ? current : []
    )
    sidebarStore.setSidebarAgentSelectionAnchor((current) =>
      current ? "" : current
    )
  }, [sidebarStore])

  const awaitingFirstTurn = awaitingFirstTurnStore.state
  const isSubmitting = isSubmittingStore.state
  const pendingDraftPrompt = pendingDraftPromptStore.state
  const pendingDraftFollowUps = pendingDraftFollowUpsStore.state
  const pendingMessages = pendingMessagesStore.state

  const {
    abortAgent,
    addDirectoryPath,
    createAgent: requestCreateAgent,
    holdPendingQueue,
    savePendingQueue,
    startPendingQueue,
    submitPrompt,
  } = useAppShellPromptMutations({
    viewerContextId,
    activeAgentId,
    defaultNewAgentDirectory,
    agentStore,
    agentStateRef,
    draftAgentLoadingOwnerKey,
    pendingDraftPrompt,
    pendingDraftFollowUps,
    awaitingFirstTurn,
    pendingMessages,
    composerLineCommentsRef,
    composerImagesRef,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraft,
    lastSyncedEditorTextRef,
    rememberRecentDirectory,
    prefetchDirectoryAgentsIndex,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
    addOptimisticSidebarAgent,
    removeOptimisticSidebarAgent,
    bindOptimisticSidebarAgent,
    updateOptimisticSidebarAgentPreview,
    setSidebarDirectories: sidebarStore.setSidebarDirectories,
    setStoredDraftDirectory,
    setDraftAgentLoadingOwnerKey,
    setPendingDraftPrompt,
    setPendingDraftFollowUps,
    setPendingMessages,
    setAwaitingFirstTurn,
    setIsSubmitting,
    setComposerLineComments,
    setComposerImages,
  })

  const switchEmptyDraftDirectory = React.useCallback(
    (directory: string) => {
      const nextDirectory = directory.trim()
      if (!nextDirectory) return

      const previousState = agentStateRef.current
      if (!previousState.draft || previousState.items.length > 0) return

      machineLocalStorageSetItem(
        machineId,
        DRAFT_DIRECTORY_STORAGE_KEY,
        nextDirectory
      )
      setStoredDraftDirectory(nextDirectory)
      rememberRecentDirectory(nextDirectory)

      const ownerKey = promptDraftKey({ cwd: nextDirectory })
      const nextState = createOptimisticDraftAgentState({
        previous: previousState,
        cwd: nextDirectory,
        ownerKey,
      })
      agentStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setAgentState(nextState)

      rememberStoredPromptDraft(
        machineId,
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
      agentStateRef,
      setAgentState,
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

  const createAgent = React.useCallback(
    async (cwdOverride?: string, options?: CreateAgentOptions) => {
      const previousState = agentStateRef.current
      const nextCwd = resolveNewAgentCwd({
        cwdOverride,
        defaultDirectory: defaultNewAgentDirectory,
        currentCwd: previousState.cwd,
      })
      const ownerKey = promptDraftKey({ cwd: nextCwd })
      const optimisticAgentKey = `optimistic:${ownerKey}`
      const shouldCloseMobileSidebar =
        Boolean(options?.closeMobileSidebar) && isMobile && openMobile

      // Start the request before focusing the composer so an immediate Enter
      // queues against the new draft instead of the previous route agent.
      const createAgentPromise = requestCreateAgent(nextCwd)

      handleSelectAgent(undefined)
      clearSelectedSidebarSelection()
      setAwaitingFirstTurn(false)
      setPendingMessages((current) => (current.length === 0 ? current : []))
      const nextState = createOptimisticDraftAgentState({
        previous: previousState,
        cwd: nextCwd,
        ownerKey,
      })
      agentStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setAgentState(nextState)

      if (shouldCloseMobileSidebar) {
        pendingMobileSidebarPromptFocusRef.current = true
        setOpenMobile(false)
      } else {
        focusPrompt()
      }

      const created = await createAgentPromise
      if (created) {
        return
      }

      if (agentStateRef.current.agentKey !== optimisticAgentKey) {
        return
      }

      agentStateRef.current = previousState
      conversationItemsStore.setItems(previousState.items)
      setAgentState(previousState)
    },
    [
      clearSelectedSidebarSelection,
      conversationItemsStore,
      defaultNewAgentDirectory,
      focusPrompt,
      handleSelectAgent,
      isMobile,
      openMobile,
      requestCreateAgent,
      agentStateRef,
      setAwaitingFirstTurn,
      setOpenMobile,
      setPendingMessages,
      setAgentState,
    ]
  )

  // Actions from outside this shell: for example the sidebar group of this
  // machine, shown while another machine was open, or the directory picker
  // of another machine's new-agent composer. The effect runs again when
  // the shell shows, so actions that came while it was hidden run then.
  const runMachineAction = React.useEffectEvent((action: MachineAction) => {
    if (action.type === "add-directory") {
      addDirectoryDialogRef.current?.open()
      return
    }
    const draft = action.draft
    void createAgent(action.directory).then(() => {
      if (!draft) return
      // The prompt that the user wrote in another machine's composer before
      // choosing a directory of this machine.
      replaceComposerDraftRef.current(draft.text, agentStateRef.current, {
        forceSync: true,
      })
      if (draft.images.length > 0) setComposerImages(draft.images)
    })
  })
  React.useEffect(() => {
    if (!viewerContextId) return
    const run = () => {
      for (const action of takeMachineActions(machineId))
        runMachineAction(action)
    }
    run()
    return onMachineAction(machineId, run)
  }, [machineId, viewerContextId])

  const createLineCommentId = () => {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return `diff-comment:${crypto.randomUUID()}`
    }

    return `diff-comment:${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`
  }

  const addComposerDiffLineComment = (
    comment: Omit<ComposerDiffLineComment, "cwd" | "id">
  ) => {
    const text = comment.text.trim()
    const cwd = agentStateRef.current.cwd?.trim() || ""
    if (!text || !cwd) return

    setComposerLineComments((current) => [
      ...current,
      {
        ...comment,
        id: createLineCommentId(),
        cwd,
        text,
      },
    ])
    composerPanelRef.current?.focusPrompt({ preventScroll: true })
  }

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
  const composerDisabled = isAgentViewLoading
  const displayedLineComments = composerDisabled
    ? EMPTY_COMPOSER_LINE_COMMENTS
    : composerLineComments
  const displayedDiffLineComments = React.useMemo(
    () => displayedLineComments.filter(isComposerDiffLineComment),
    [displayedLineComments]
  )
  const displayedFileLineComments = React.useMemo(
    () => displayedLineComments.filter(isComposerFileLineComment),
    [displayedLineComments]
  )
  const fileLineComments = React.useMemo<FileLineCommentsValue>(
    () => ({
      comments: displayedFileLineComments,
      add: (comment) => {
        const text = comment.text.trim()
        if (!text || !comment.cwd) return
        setComposerLineComments((current) => [
          ...current,
          { ...comment, kind: "file", id: createLineCommentId(), text },
        ])
        composerPanelRef.current?.focusPrompt({ preventScroll: true })
      },
      remove: (id) => {
        setComposerLineComments((current) =>
          current.filter((comment) => comment.id !== id)
        )
      },
    }),
    [displayedFileLineComments, setComposerLineComments]
  )
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

  const savePendingDraftFollowUps = (
    rows: Array<PendingQueueSaveRow>
  ): Array<PendingQueueSaveRow> => {
    if (pendingDraftFollowUps.length === 0) return rows

    const drafts = new Map(
      pendingDraftFollowUps.map((message, index) => [
        pendingDraftFollowUpId(message, index),
        message,
      ])
    )
    // New rows join the drafts only while no agent queue exists yet.
    const draftOnly = pendingMessages.length === 0
    const draftRows = rows.filter((row) =>
      row.pendingId ? drafts.has(row.pendingId) : draftOnly
    )

    setPendingDraftFollowUps(
      draftRows.map((row) => {
        const existing = row.pendingId ? drafts.get(row.pendingId) : undefined
        return {
          ...existing,
          message: row.text,
          images: existing?.images ?? row.images,
          streamingBehavior: row.streamingBehavior,
        }
      })
    )
    return rows.filter((row) => !draftRows.includes(row))
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
    deleteAgents,
    moveAgentPath,
    renameAgentPath,
    runClone,
    runCompact,
    setModel,
    setThinkingBlocksHidden,
    setThinkingLevel,
    toggleHideThinking,
  } = useAppShellAgentMutations({
    viewerContextId,
    activeAgentId,
    agentStateRef,
    setAgentState,
    getDirectoryIndexDataByPath: () =>
      sidebarStore.state.state.directoryIndexDataByPath,
    setDirectoryIndexDataByPath: sidebarStore.setDirectoryIndexDataByPath,
    getAgentsEvent: () => sidebarStore.state.state.agentsEvent,
    setAgentsEvent: sidebarStore.setAgentsEvent,
    getSidebarSelection: () => {
      const sidebarState = sidebarStore.state.state
      return {
        selectedSidebarAgentKeys: sidebarState.selectedSidebarAgentKeys,
        sidebarAgentSelectionAnchor: sidebarState.sidebarAgentSelectionAnchor,
      }
    },
    optimisticallyClearActiveDeletedAgent: (targetPath) => {
      const previousState = agentStateRef.current
      if (previousState.agentFile !== targetPath) return undefined

      const ownerKey = `delete:${targetPath}`
      const optimisticAgentKey = `optimistic:${ownerKey}`
      handleSelectAgent(undefined, { replace: true })
      const nextState = createOptimisticDraftAgentState({
        previous: previousState,
        cwd: previousState.cwd,
        ownerKey,
      })
      agentStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setAgentState(nextState)

      return () => {
        if (agentStateRef.current.agentKey !== optimisticAgentKey) return
        if (previousState.agentId) {
          handleSelectAgent(previousState.agentId, {
            replace: true,
            agentPath: previousState.agentFile,
          })
        }
        agentStateRef.current = previousState
        conversationItemsStore.setItems(previousState.items)
        setAgentState(previousState)
      }
    },
    setSelectedSidebarAgentKeys: sidebarStore.setSelectedSidebarAgentKeys,
    setSidebarAgentSelectionAnchor: sidebarStore.setSidebarAgentSelectionAnchor,
    setPinnedSidebarAgentKeys: sidebarStore.setPinnedSidebarAgentKeys,
    setCompactWorkingState,
    isCompactAbortRequested,
  })

  const moveAgentToDirectory = async (
    entry: AgentListEntry,
    directory: string
  ) => {
    const moved = await moveAgentPath(entry, directory)
    if (moved) {
      rememberRecentDirectory(directory)
    }
    return moved
  }

  const setAgentUnread = async (entry: AgentListEntry, unread: boolean) => {
    if (!viewerContextId || !entry.path) return false

    const targetPath = entry.path
    const previousUnread = Boolean(entry.unread)
    const nextUnread = Boolean(unread)

    const applyUnread = (value: boolean) => {
      sidebarStore.setSidebarAgentStatusByKey((current) =>
        mergeSidebarAgentStatusMap(current, {
          type: "agent_status",
          agentId: entry.id,
          agentPath: targetPath,
          unread: value,
        })
      )
    }

    applyUnread(nextUnread)

    try {
      await fetchJson<Extract<AgentReadStateResponse, { ok: true }>>(
        buildRequestUrl("/api/agent/read-state", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: targetPath, unread: nextUnread }),
        }
      )
      await queryClient.invalidateQueries({
        queryKey: ["pico", "directory-agents-index", viewerContextId],
        refetchType: "active",
      })
      toast.success(nextUnread ? "Marked agent unread" : "Marked agent read")
      return true
    } catch (error) {
      applyUnread(previousUnread)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update agent read state"
      )
      return false
    }
  }

  const markAgentsRead = async (entries: Array<AgentListEntry>) => {
    if (!viewerContextId) return false

    const targets = entries.filter((entry) => entry.path && entry.unread)
    if (targets.length === 0) return true

    const applyUnread = (target: AgentListEntry, value: boolean) => {
      sidebarStore.setSidebarAgentStatusByKey((current) =>
        mergeSidebarAgentStatusMap(current, {
          type: "agent_status",
          agentId: target.id,
          agentPath: target.path,
          unread: value,
        })
      )
    }

    for (const target of targets) applyUnread(target, false)

    const results = await Promise.allSettled(
      targets.map((target) =>
        fetchJson<Extract<AgentReadStateResponse, { ok: true }>>(
          buildRequestUrl("/api/agent/read-state", {
            machineId,
            contextId: viewerContextId,
            agentId: activeAgentId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: target.path, unread: false }),
          }
        )
      )
    )

    let failed = 0
    results.forEach((result, index) => {
      if (result.status === "fulfilled") return
      failed += 1
      applyUnread(targets[index], true)
    })

    await queryClient.invalidateQueries({
      queryKey: ["pico", "directory-agents-index", viewerContextId],
      refetchType: "active",
    })

    if (failed > 0) {
      toast.error(`Failed to mark ${failed} of ${targets.length} agents read`)
      return false
    }
    toast.success(
      targets.length === 1
        ? "Marked 1 agent read"
        : `Marked ${targets.length} agents read`
    )
    return true
  }

  const moveAgentDirectoryTargetToPath = async (directory: string) => {
    const target = moveAgentDirectoryTargetRef.current
    if (!target) return false

    const moved = await moveAgentToDirectory(target, directory)
    if (moved) {
      moveAgentDirectoryTargetRef.current = null
    }
    return moved
  }

  const moveCurrentAgentToDirectory = async (directory: string) => {
    const currentState = agentStateRef.current
    if (!currentState.agentFile) return false

    return await moveAgentToDirectory(
      {
        path: currentState.agentFile,
        id: currentState.agentId,
        cwd: currentState.cwd,
        title: getCurrentAgentTitleFromState(currentState),
        name: currentState.agentName,
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
      replaceComposerDraft("", agentStateRef.current, { forceSync: true })
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
        if (!agentState.agentFile) {
          toast.error("Start the agent before renaming it.")
          return
        }
        if (!trimmedArgs) {
          clearComposerDraft()
          openRenameDialog()
          return
        }
        clearComposerDraft()
        await renameAgentPath(agentState.agentFile, trimmedArgs)
        return
      }
      case "archive":
      case "delete": {
        if (!agentState.agentFile) {
          toast.error("Start the agent before archiving it.")
          return
        }
        clearComposerDraft()
        openDeleteDialogForCurrentAgent()
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
        if (!agentStateRef.current.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "show-thinking": {
        clearComposerDraft()
        if (agentStateRef.current.hideThinkingBlock) {
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

  const handleThemePreviewChange = (
    value: ThemeFamily,
    colorMode: ThemeColorMode
  ) => {
    previewThemeFamily(value, colorMode)
  }

  const handleThemeColorModeChange = (value: ThemeColorMode) => {
    setColorMode(value)
  }

  const composerSnapshot = {
    activeAgentId,
    awaitingFirstTurn: composerDisabled ? false : awaitingFirstTurn,
    canStartPendingQueue:
      !composerDisabled &&
      pendingMessages.length > 0 &&
      // A paused queue holds its prompts, also while a new turn streams.
      (pendingMessages.some((message) => isHeldPendingId(message.pendingId)) ||
        (!agentStateRef.current.streaming &&
          !agentStateRef.current.compacting)) &&
      !awaitingFirstTurn &&
      !isSubmitting,
    centerMessages: displaySettingsRef.current.centerMessages,
    composerLineComments: displayedLineComments,
    composerImages: displayedComposerImages,
    composerSkill: displayedComposerSkill,
    composerSyncNonce: composerDraftSeed.syncNonce,
    composerText: displayedComposerText,
    currentPendingMessages: displayedPendingMessages,
    disabled: composerDisabled,
    isCompacting: composerDisabled ? false : agentStateRef.current.compacting,
    isStreaming: composerDisabled ? false : agentStateRef.current.streaming,
    isSubmitting: composerDisabled ? false : isSubmitting,
    viewerContextId,
  } satisfies AppShellComposerSnapshot

  React.useLayoutEffect(() => {
    setStoreState(composerStore, composerSnapshot)
  })

  const composerActionsRef = useLatestRef<AppShellComposerActions>({
    abortAgent,
    onPickImages,
    removeLineComment: (id) => {
      setComposerLineComments((current) =>
        current.filter((comment) => comment.id !== id)
      )
    },
    onRemoveComposerImage: (index) => {
      setComposerImages((current) =>
        current.filter((_, imageIndex) => imageIndex !== index)
      )
    },
    holdPendingQueue,
    savePendingDraftFollowUps,
    savePendingQueue,
    startPendingQueue,
    runBuiltinSlashCommand,
    setModel,
    setThinkingLevel,
    submitPrompt,
    syncComposerDraft,
    moveDraftToMachine: (targetMachine, directory) => {
      const text = serializeComposerDraft({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
      })
      const images = composerImagesRef.current
      // The draft moves: it does not stay in this machine's composer too.
      replaceComposerDraft("", agentStateRef.current, { forceSync: true })
      setComposerImages([])
      openMachine(targetMachine, {
        action: {
          type: "new-agent",
          directory,
          draft: text || images.length > 0 ? { text, images } : undefined,
        },
      })
    },
  })

  const commandPaletteStateRef = useLatestRef({
    gitPanelOpen,
    hasAvailableModels: agentStateRef.current.availableModels.length > 0,
    isMobile,
    selectedSidebarAgents,
    agentFile: agentState.agentFile,
    terminalPanelOpen,
  })

  const buildCommandPaletteCommands = () => {
    const commandState = commandPaletteStateRef.current
    const currentThinkingLevel = agentStateRef.current.thinkingLevel
    const commands: Array<AppCommand> = [
      {
        id: "new-agent",
        group: "Agents",
        title: "New agent",
        description: "Create a new draft agent",
        shortcut: formatShortcutLabel(appShortcut("N")),
        keywords: ["create", "draft", "agent"],
        onSelect: createAgent,
      },
      {
        id: "open-agents",
        group: "Agents",
        title: "Open agents",
        description: "Search and switch agents",
        shortcut: formatShortcutLabel(appShortcut("S")),
        keywords: ["agent", "search", "switch", "jump"],
        onSelect: openAgentsDialog,
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
        shortcut: formatShortcutLabel(appShortcut("\\")),
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
        id: "toggle-terminal",
        group: "Workspace",
        title: commandState.isMobile
          ? "Toggle terminal tab"
          : commandState.terminalPanelOpen
            ? "Close terminal"
            : "Open terminal",
        description: commandState.isMobile
          ? "Switch the mobile terminal tab on or off"
          : "Toggle the bottom terminal panel",
        shortcut: formatShortcutLabel(appShortcut("J")),
        keywords: ["terminal", "shell", "console", "bottom", "panel"],
        onSelect: toggleTerminalPanel,
      },
      {
        id: "show-resources",
        group: "Workspace",
        title: "Show resources",
        description: "Memory of the server, terminals, jobs, and the browser",
        keywords: ["resources", "memory", "ram", "jobs", "processes"],
        onSelect: () => emitPicoEvent("pico:open-resources", {}),
      },
      {
        id: "commit-changes",
        group: "Git",
        title: "Commit changes",
        description: "Open the Git commit dialog",
        shortcut: formatShortcutLabel(appShortcut("C")),
        keywords: ["git", "commit", "changes", "stage"],
        onSelect: openCommitDialog,
      },
      {
        id: "push-changes",
        group: "Git",
        title: "Push changes",
        description: "Push local commits to the remote",
        shortcut: formatShortcutLabel(appShortcut("P")),
        keywords: ["git", "push", "remote", "upstream"],
        onSelect: pushGitChanges,
      },
      {
        id: "force-push-changes",
        group: "Git",
        title: "Force push changes",
        description: "Force push local commits with --force-with-lease",
        shortcut: formatShortcutLabel(appShortcut("Shift+P")),
        keywords: ["git", "force", "push", "remote", "upstream", "lease"],
        onSelect: forcePushGitChanges,
      },
      {
        id: "pull-changes",
        group: "Git",
        title: "Pull changes",
        description: "Pull remote changes into the current branch",
        shortcut: formatShortcutLabel(pullShortcut),
        keywords: ["git", "pull", "remote", "upstream"],
        onSelect: pullGitChanges,
      },
      {
        id: "focus-prompt",
        group: "Assistant",
        title: "Focus prompt",
        description: "Move focus to the prompt field",
        shortcut: formatShortcutLabel(appShortcut("Enter")),
        keywords: ["prompt", "composer", "input", "message", "reply"],
        onSelect: focusPrompt,
      },
      {
        id: "set-model",
        group: "Assistant",
        title: "Set model",
        description: "Open the model picker",
        shortcut: formatShortcutLabel(appShortcut("M")),
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
        shortcut: formatShortcutLabel(appShortcut("D")),
        keywords: ["workspace", "sidebar", "directory", "folder"],
        onSelect: openAddDirectoryDialog,
      },
      {
        id: "conversation-tree",
        group: "Agents",
        title: "Open tree",
        description: "Go to an earlier point in the conversation tree",
        shortcut: "Esc Esc",
        keywords: ["tree", "branch", "history", "navigate"],
        onSelect: openTreeDialog,
      },
      {
        id: "fork-conversation",
        group: "Agents",
        title: "Fork conversation",
        description: "Start a new agent from an earlier user message",
        shortcut: formatShortcutLabel(appShortcut("F")),
        keywords: ["fork", "branch", "draft"],
        onSelect: openForkDialog,
      },
      {
        id: "clone-conversation",
        group: "Agents",
        title: "Clone conversation",
        description:
          "Copy the current branch of the conversation into a new agent",
        keywords: ["clone", "branch", "duplicate", "agent"],
        onSelect: runClone,
      },
      {
        id: "compact-conversation",
        group: "Agents",
        title: "Compact",
        description: "Compact the conversation with /compact",
        keywords: ["compact", "context", "compress", "summarize"],
        onSelect: runCompact,
      },
      {
        id: "cycle-reasoning",
        group: "Assistant",
        title: "Next reasoning level",
        description: `Current level: ${currentThinkingLevel}`,
        shortcut: formatShortcutLabel(appShortcut("R")),
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
        shortcut: formatShortcutLabel(appShortcut("Shift+R")),
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
        title: "Toggle Git Pane",
        description: "Toggle the Git pane for changed files",
        shortcut: formatShortcutLabel(rightSidebarPaneShortcut("review")),
        keywords: ["review", "diff", "file", "changes", "pane"],
        onSelect: toggleFileView,
      },
      {
        id: "toggle-files-pane",
        group: "Workspace",
        title: "Toggle Files Pane",
        description: "Toggle the project files pane",
        shortcut: formatShortcutLabel(rightSidebarPaneShortcut("files")),
        keywords: ["files", "tree", "explorer", "project", "pane"],
        onSelect: () => toggleRightSidebarPane("files"),
      },
      {
        id: "toggle-history-pane",
        group: "Git",
        title: "Toggle History Pane",
        description: "Toggle the commit history pane",
        shortcut: formatShortcutLabel(rightSidebarPaneShortcut("history")),
        keywords: ["history", "commits", "log", "git", "pane"],
        onSelect: () => toggleRightSidebarPane("history"),
      },
      {
        id: "toggle-agent-pane",
        group: "Workspace",
        title: "Toggle Agent Pane",
        description: "Toggle the agent pane",
        shortcut: formatShortcutLabel(rightSidebarPaneShortcut("agent")),
        keywords: ["agent", "todo", "jobs", "pane"],
        onSelect: () => toggleRightSidebarPane("agent"),
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
        shortcut: formatShortcutLabel(appShortcut(",")),
        keywords: ["settings", "theme", "notifications", "display"],
        onSelect: openSettingsDialog,
      },
    ]

    if (commandState.agentFile) {
      commands.splice(1, 0, {
        id: "rename-agent",
        group: "Agents",
        title: "Rename agent",
        description: "Rename the current agent",
        shortcut: formatShortcutLabel(appShortcut("E")),
        keywords: ["rename", "title", "name"],
        onSelect: openRenameDialog,
      })
      commands.push({
        id: "delete-agent",
        group: "Agents",
        title: "Archive agent",
        description: `Archive ${getCurrentAgentTitleFromState(
          agentStateRef.current
        )}`,
        shortcut: formatShortcutLabel(appShortcut("X")),
        keywords: ["archive", "delete", "remove", "agent"],
        onSelect: openDeleteDialogForCurrentAgent,
      })
    }

    if (commandState.selectedSidebarAgents.length > 0) {
      commands.push({
        id: "delete-selected-agents",
        group: "Sidebar",
        title: "Archive selected sidebar agents",
        description: `Archive ${
          commandState.selectedSidebarAgents.length
        } selected sidebar ${
          commandState.selectedSidebarAgents.length === 1 ? "agent" : "agents"
        }`,
        keywords: ["archive", "delete", "selected", "sidebar", "agents"],
        onSelect: () => {
          openDeleteDialog(commandPaletteStateRef.current.selectedSidebarAgents)
        },
      })
    }

    // Settings come last, from the same list as the settings dialog.
    commands.push(...(settingsDialogRef.current?.getPaletteCommands() ?? []))

    return commands
  }
  const commandPaletteCommandsRef = useLatestRef(buildCommandPaletteCommands)

  const abortCompact = React.useCallback(async () => {
    if (!compactRunningRef.current) return
    compactAbortRequestedRef.current = true
    await abortAgent()
  }, [abortAgent])

  const shortcutActionsRef = useLatestRef({
    abortCompact,
    abortAgent,
    createAgent,
    closeCommandPalette,
    forcePushGitChanges,
    focusModelSelector,
    focusPrompt,
    focusAgentSearch,
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
    openDeleteDialogForCurrentAgent,
    openForkDialog,
    openRenameDialog,
    openAgentsDialog,
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
    toggleRightSidebarPane,
    toggleTerminalPanel,
    toggleHideThinking,
    toggleHideToolBlocks,
    cycleThinkingLevel,
  })

  const shortcutStateRef = useLatestRef<AppShellShortcutState>({
    currentTab: isMobile ? appUiStore.state.currentTab : "conversation",
    selectedSidebarAgents,
    agentHasAvailableModels: agentStateRef.current.availableModels.length > 0,
    agentHasFile: Boolean(agentState.agentFile),
    agentIsStreaming: agentStateRef.current.streaming,
    sidebarAgentEntriesByKey,
  })
  const toggleCurrentAgentPinned = () => {
    const currentState = agentStateRef.current
    const key = agentListEntryKey({
      path: currentState.agentFile,
      id: currentState.agentId,
    })
    if (!key) return

    sidebarStore.setPinnedSidebarAgentKeys((current) => {
      const currentKeys = normalizeAgentSelectionKeys(current)
      const nextKeys = currentKeys.includes(key)
        ? currentKeys.filter((currentKey) => currentKey !== key)
        : [key, ...currentKeys]

      machineLocalStorageSetItem(
        machineId,
        PINNED_AGENTS_STORAGE_KEY,
        JSON.stringify(nextKeys)
      )
      return nextKeys
    })
  }

  const agentHeaderActionsRef = useLatestRef<AppShellAgentHeaderActions>({
    createAgent,
    onDeleteCurrentAgent: openDeleteDialogForCurrentAgent,
    onForkAgent: openForkDialog,
    onMoveCurrentAgent: moveCurrentAgentToDirectory,
    onMoveCurrentAgentToAnyDirectory:
      openMoveAgentDirectoryDialogForCurrentAgent,
    onOpenCommandPalette: openCommandPalette,
    onOpenSettings: openSettingsDialog,
    onRenameAgent: openRenameDialog,
    onRunCompact: runCompact,
    onToggleCurrentAgentPinned: toggleCurrentAgentPinned,
    onToggleHideThinking: toggleHideThinking,
    onToggleHideToolBlocks: toggleHideToolBlocks,
    onTreeAgent: openTreeDialog,
  })

  useAppShellShortcuts({
    addDirectoryOpenRef,
    commandPaletteOpenRef,
    compactRunningRef,
    deleteOpenRef,
    forkOpenRef,
    gitCommitOpenRef,
    moveAgentDirectoryOpenRef,
    pendingUiRequestOpenRef: uiRequestOpenRef,
    renameOpenRef,
    agentSearchInputRef,
    agentsOpenRef,
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
      agent: agentStore,
      sidebar: sidebarStore,
    },
    refs: {
      composerImages: composerImagesRef,
      composerPanel: composerPanelRef,
      composerSkill: composerSkillRef,
      composerText: composerTextRef,
      conversationFrame: conversationFrameRef,
      agentState: agentStateRef,
    },
    actions: {
      createAgent,
      focusModelSelector,
      focusPrompt,
      focusAgentSearch,
      openAddDirectoryDialog,
      openCommandPalette,
      openDeleteDialog,
      moveAgentToDirectory,
      openDeleteOldDirectoryAgentsDialog,
      openMoveAgentDirectoryDialogForEntry,
      openRenameDialogForEntry,
      openAgentsDialog,
      openSettingsDialog,
      setAgentUnread,
      markAgentsRead,
      selectAgent: handleSelectAgent,
    },
  }

  React.useImperativeHandle(ref, () => {
    const actions = appShellControllerRef.current?.actions
    return {
      createAgent: actions?.createAgent ?? createAgent,
      openAddDirectoryDialog:
        actions?.openAddDirectoryDialog ?? openAddDirectoryDialog,
      openCommandPalette: actions?.openCommandPalette ?? openCommandPalette,
      openDeleteDialog: actions?.openDeleteDialog ?? openDeleteDialog,
      openDeleteOldDirectoryAgentsDialog:
        actions?.openDeleteOldDirectoryAgentsDialog ??
        openDeleteOldDirectoryAgentsDialog,
      moveAgentToDirectory:
        actions?.moveAgentToDirectory ?? moveAgentToDirectory,
      openMoveAgentDirectoryDialogForEntry:
        actions?.openMoveAgentDirectoryDialogForEntry ??
        openMoveAgentDirectoryDialogForEntry,
      openRenameDialogForEntry:
        actions?.openRenameDialogForEntry ?? openRenameDialogForEntry,
      openAgentsDialog: actions?.openAgentsDialog ?? openAgentsDialog,
      openSettingsDialog: actions?.openSettingsDialog ?? openSettingsDialog,
      setAgentUnread: actions?.setAgentUnread ?? setAgentUnread,
      markAgentsRead: actions?.markAgentsRead ?? markAgentsRead,
      selectAgent: actions?.selectAgent ?? handleSelectAgent,
    }
  }, [
    createAgent,
    handleSelectAgent,
    openAddDirectoryDialog,
    openCommandPalette,
    moveAgentToDirectory,
    openDeleteDialog,
    openDeleteOldDirectoryAgentsDialog,
    openMoveAgentDirectoryDialogForEntry,
    openRenameDialogForEntry,
    openAgentsDialog,
    openSettingsDialog,
    setAgentUnread,
    markAgentsRead,
  ])

  return (
    <FileLineCommentsProvider value={fileLineComments}>
      <AppShellWindowEffectsHost
        isAgentViewLoading={isAgentViewLoading}
        loadingDisplayAgentTitle={loadingDisplayAgentTitle}
        notificationStore={notificationStore}
        agentStore={agentStore}
        sidebarStore={sidebarStore}
        onSelectAgent={handleSelectAgent}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebar}
        <SidebarInset className="min-h-0 overflow-hidden">
          <AppShellTabsController
            actionsRef={composerActionsRef}
            appUiStore={appUiStore}
            diffLineComments={displayedDiffLineComments}
            composerPanelRef={composerPanelRef}
            contextUsageStore={contextUsageStore}
            conversationFrameRef={conversationFrameRef}
            conversationItemsStore={conversationItemsStore}
            defaultNewAgentDirectory={defaultNewAgentDirectory}
            displaySettingsStore={displaySettingsStore}
            fileInputRef={fileInputRef}
            gitPanelOpen={gitPanelOpen}
            header={
              <AppShellAgentHeader
                actionsRef={agentHeaderActionsRef}
                defaultNewAgentDirectory={defaultNewAgentDirectory}
                displayAgentCwd={displayAgentCwd}
                gitPanelOpen={gitPanelOpen}
                terminalPanelOpen={terminalPanelOpen}
                loadingDisplayAgentTitle={loadingDisplayAgentTitle}
                currentAgentPinned={currentAgentPinned}
                displaySettingsStore={displaySettingsStore}
                isAgentViewLoading={isAgentViewLoading}
                newAgentDirectoryOptions={newAgentDirectoryOptions}
                onToggleGitPanel={toggleGitPanel}
                onToggleTerminalPanel={toggleTerminalPanel}
                agentStore={agentStore}
                viewerContextId={viewerContextId}
              />
            }
            terminalPanelOpen={terminalPanelOpen}
            isLoadingOlderHistory={isLoadingOlderHistory}
            isAgentViewLoading={isAgentViewLoading}
            isSubmitting={isSubmitting}
            isMobile={isMobile}
            newAgentDirectoryOptions={newAgentDirectoryOptions}
            onCancelCompaction={abortCompact}
            onCreateAgent={(cwdOverride) => {
              void createAgent(cwdOverride)
            }}
            onLoadOlderHistory={loadOlderHistory}
            onOpenAddDirectoryDialog={openAddDirectoryDialog}
            onCloseAllFileViewTabs={closeAllFileViewTabs}
            onCloseFileViewTab={closeFileViewTab}
            onCloseFileViewTabsToRight={closeFileViewTabsToRight}
            onCloseOtherFileViewTabs={closeOtherFileViewTabs}
            onAddDiffLineComment={addComposerDiffLineComment}
            onOpenFileViewTab={openFileViewTab}
            onReorderFileViewTabs={reorderFileViewTabs}
            onCloseTerminalPanel={closeTerminalPanel}
            rightSidebarStore={rightSidebarStore}
            agentStore={agentStore}
            store={composerStore}
            viewerContextId={viewerContextId}
            workingStateStore={workingStateStore}
            awaitingFirstTurn={awaitingFirstTurn}
            onValueChange={setCurrentTab}
          />
        </SidebarInset>
      </div>

      <AppShellFloatingControllers
        activeAgentId={activeAgentId}
        addDirectoryDialogRef={addDirectoryDialogRef}
        addDirectoryOpenRef={addDirectoryOpenRef}
        addDirectoryPath={addDirectoryPathForDialog}
        baseSidebarDirectories={baseSidebarDirectories}
        commandPaletteCommandsRef={commandPaletteCommandsRef}
        commandPaletteOpenRef={commandPaletteOpenRef}
        commandPaletteRef={commandPaletteRef}
        currentAgentQueryScope={currentAgentQueryScope}
        currentTheme={currentTheme}
        currentThemeColorMode={currentThemeColorMode}
        authDialogRef={authDialogRef}
        authOpenRef={authOpenRef}
        deleteDialogRef={deleteDialogRef}
        deleteOpenRef={deleteOpenRef}
        deleteAgents={deleteAgents}
        deleteOldDirectoryAgentsDialogRef={deleteOldDirectoryAgentsDialogRef}
        deleteOldDirectoryAgentsOpenRef={deleteOldDirectoryAgentsOpenRef}
        notificationStore={notificationStore}
        forkDialogRef={forkDialogRef}
        forkOpenRef={forkOpenRef}
        gitCommitDialogRef={gitCommitDialogRef}
        gitCommitOpenRef={gitCommitOpenRef}
        displaySettingsStore={displaySettingsStore}
        knownDirectories={knownDirectories}
        moveAgentDirectoryDialogRef={moveAgentDirectoryDialogRef}
        moveAgentDirectoryOpenRef={moveAgentDirectoryOpenRef}
        moveAgentDirectoryTargetToPath={moveAgentDirectoryTargetToPath}
        onAutoScrollEnabledChange={setAutoScroll}
        onCenterMessagesChange={setMessagesCentered}
        onHideThinkingBlocksChange={(hidden) => {
          void setThinkingBlocksHidden(hidden)
        }}
        onHideToolBlocksChange={setToolBlocksHidden}
        onAgentDoneDesktopNotificationsEnabledChange={
          handleAgentDoneDesktopNotificationsEnabledChange
        }
        onAgentDoneSoundEnabledChange={handleAgentDoneSoundEnabledChange}
        onAgentDialogSelect={handleSelectAgent}
        onThemeChange={handleThemeChange}
        onThemeColorModeChange={handleThemeColorModeChange}
        onThemePreviewChange={handleThemePreviewChange}
        systemTheme={systemTheme}
        recentDirectoriesStore={recentDirectoriesStore}
        renameDialogRef={renameDialogRef}
        renameOpenRef={renameOpenRef}
        renameAgentPath={renameAgentPath}
        agentCwd={agentState.cwd}
        agentsDialogDirectory={agentsDialogDirectory}
        agentsDialogRef={agentsDialogRef}
        agentsOpenRef={agentsOpenRef}
        agentStore={agentStore}
        settingsDialogRef={settingsDialogRef}
        settingsOpenRef={settingsOpenRef}
        sidebarStore={sidebarStore}
        treeDialogRef={treeDialogRef}
        treeOpenRef={treeOpenRef}
        uiRequestDialogRef={uiRequestDialogRef}
        uiRequestOpenRef={uiRequestOpenRef}
        viewerContextId={viewerContextId}
      />
    </FileLineCommentsProvider>
  )
}

export function PicoAppShell({
  agentId,
  onSelectAgent,
}: {
  agentId?: string
  onSelectAgent?: (
    agentId?: string,
    options?: SelectAgentNavigationOptions
  ) => void
}) {
  const machineId = useMachineId()
  const [viewerContextId, setViewerContextId] = React.useState("")
  const sidebarStoreRef = React.useRef<AppShellSidebarStore | null>(null)
  if (!sidebarStoreRef.current) {
    sidebarStoreRef.current = createAppShellSidebarStore()
  }
  const sidebarStore = sidebarStoreRef.current
  const agentSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const agentWorkspaceRef = React.useRef<AppShellAgentWorkspaceHandle | null>(
    null
  )

  React.useEffect(() => {
    const storedContext = window.localStorage.getItem(
      VIEWER_CONTEXT_STORAGE_KEY
    )
    const nextContext = storedContext?.trim() || createContextId()
    safeLocalStorageSetItem(VIEWER_CONTEXT_STORAGE_KEY, nextContext)
    setViewerContextId(nextContext)

    startSidebarSync(machineId, nextContext)

    const storedDirectories = readStoredSidebarDirectories(machineId)
    const nextDirectories = normalizeStoredDirectoryList(
      storedDirectories.directories
    )
    const nextBootstrapDirectories = nextDirectories.slice(
      0,
      INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT
    )
    const nextPinnedAgentKeys = readStoredPinnedAgentKeys(machineId)
    sidebarStore.setSidebarState((current) => {
      if (
        sameStringArray(current.sidebarDirectories, nextDirectories) &&
        sameStringArray(
          current.initialSidebarBootstrapDirectories,
          nextBootstrapDirectories
        ) &&
        sameStringArray(current.pinnedSidebarAgentKeys, nextPinnedAgentKeys)
      ) {
        return current
      }

      return {
        sidebarDirectories: nextDirectories,
        initialSidebarBootstrapDirectories: nextBootstrapDirectories,
        pinnedSidebarAgentKeys: nextPinnedAgentKeys,
      }
    })
  }, [sidebarStore])

  return (
    <AppShellAgentWorkspace
      ref={agentWorkspaceRef}
      viewerContextId={viewerContextId}
      agentId={agentId}
      onSelectAgent={onSelectAgent}
      sidebar={
        <AppShellSidebarController
          viewerContextId={viewerContextId}
          sidebarStore={sidebarStore}
          agentWorkspaceRef={agentWorkspaceRef}
        />
      }
      sidebarStore={sidebarStore}
      agentSearchInputRef={agentSearchInputRef}
    />
  )
}
