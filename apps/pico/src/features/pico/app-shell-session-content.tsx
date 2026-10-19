import * as React from "react"

import {
  AppShellComposerController,
  NewSessionComposerSelectors,
} from "@/features/pico/app-shell-composer-controller"
import type {
  AppShellComposerActions,
  AppShellComposerSnapshot,
} from "@/features/pico/app-shell-composer-state"
import {
  AppShellSessionConversation,
  type AppShellConversationFrameHandle,
} from "@/features/pico/app-shell-conversation"
import {
  useConversationHasMessages,
  type ConversationItemsStore,
} from "@/features/pico/app-shell-conversation-store"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import type { AppShellWorkingState } from "@/features/pico/app-shell-working-state"
import type { ComposerPanelHandle } from "@/features/pico/composer-panel"
import type { ComposerContextUsageStore } from "@/features/pico/composer-context-usage-indicator"
import { shallowRecordEqual } from "@/features/pico/app-shell-common"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { SessionState } from "@/lib/pico"
import { ToolRenderContext } from "@/features/pico/tool-renderers/registry"
import { TodoProgressChip } from "@/features/pico/agent/todo"

export type AppShellSessionContentProps = {
  actionsRef: React.RefObject<AppShellComposerActions>
  awaitingFirstTurn: boolean
  composerPanelRef: React.RefObject<ComposerPanelHandle | null>
  contextUsageStore: ComposerContextUsageStore
  conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
  conversationItemsStore: ConversationItemsStore
  defaultNewSessionDirectory: string
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isLoadingOlderHistory: boolean
  isSessionViewLoading: boolean
  isSubmitting: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onCancelCompaction: () => void
  onCreateSession: (cwdOverride?: string) => void
  onLoadOlderHistory: () => Promise<void>
  onOpenAddDirectoryDialog: () => void
  sessionStore: PicoStore<SessionState>
  store: PicoStore<AppShellComposerSnapshot>
  viewerContextId: string
  workingStateStore: PicoStore<AppShellWorkingState | null>
}

export function AppShellSessionContent({
  actionsRef,
  awaitingFirstTurn,
  composerPanelRef,
  contextUsageStore,
  conversationFrameRef,
  conversationItemsStore,
  defaultNewSessionDirectory,
  displaySettingsStore,
  fileInputRef,
  isLoadingOlderHistory,
  isSessionViewLoading,
  isSubmitting,
  newSessionDirectoryOptions,
  onCancelCompaction,
  onCreateSession,
  onLoadOlderHistory,
  onOpenAddDirectoryDialog,
  sessionStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellSessionContentProps) {
  const sessionState = useSelector(
    sessionStore,
    (currentSessionState) => ({
      cwd: currentSessionState.cwd,
      draft: currentSessionState.draft,
      sessionId: currentSessionState.sessionId,
    }),
    { compare: shallowRecordEqual }
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const toolRenderContext = React.useMemo(
    () => ({
      viewerContextId,
      sessionId: sessionState.draft ? undefined : sessionState.sessionId,
      cwd: sessionState.cwd,
    }),
    [
      sessionState.cwd,
      sessionState.draft,
      sessionState.sessionId,
      viewerContextId,
    ]
  )
  const showNewSessionComposer =
    sessionState.draft && !hasMessages && !isSessionViewLoading

  if (showNewSessionComposer) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-end justify-items-center overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:place-items-center">
        <AppShellComposerController
          actionsRef={actionsRef}
          composerPanelRef={composerPanelRef}
          contextUsageStore={contextUsageStore}
          displaySettingsStore={displaySettingsStore}
          fileInputRef={fileInputRef}
          sessionStore={sessionStore}
          store={store}
          topContent={
            <NewSessionComposerSelectors
              cwd={sessionState.cwd}
              defaultNewSessionDirectory={defaultNewSessionDirectory}
              directoryOptions={newSessionDirectoryOptions}
              onCreateSession={onCreateSession}
              onMoveDraftToMachine={(targetMachine, directory) =>
                actionsRef.current.moveDraftToMachine(targetMachine, directory)
              }
              onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
              viewerContextId={viewerContextId}
            />
          }
        />
      </div>
    )
  }

  return (
    <ToolRenderContext.Provider value={toolRenderContext}>
      <AppShellSessionConversation
        awaitingFirstTurn={awaitingFirstTurn}
        conversationFrameRef={conversationFrameRef}
        conversationItemsStore={conversationItemsStore}
        displaySettingsStore={displaySettingsStore}
        isLoadingOlderHistory={isLoadingOlderHistory}
        isSessionViewLoading={isSessionViewLoading}
        isSubmitting={isSubmitting}
        onCancelCompaction={onCancelCompaction}
        onCreateSession={onCreateSession}
        onLoadOlderHistory={onLoadOlderHistory}
        sessionStore={sessionStore}
        viewerContextId={viewerContextId}
        workingStateStore={workingStateStore}
      />

      {toolRenderContext.sessionId ? (
        <div className="flex shrink-0 justify-center px-4">
          <TodoProgressChip
            sessionId={toolRenderContext.sessionId}
            viewerContextId={viewerContextId}
          />
        </div>
      ) : null}

      <AppShellComposerController
        actionsRef={actionsRef}
        composerPanelRef={composerPanelRef}
        contextUsageStore={contextUsageStore}
        displaySettingsStore={displaySettingsStore}
        fileInputRef={fileInputRef}
        sessionStore={sessionStore}
        store={store}
      />
    </ToolRenderContext.Provider>
  )
}
