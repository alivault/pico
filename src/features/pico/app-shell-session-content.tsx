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
  hiddenThinkingPreviewStore: PicoStore<string>
  isSessionViewLoading: boolean
  isSubmitting: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onCancelCompaction: () => void
  onCreateSession: (cwdOverride?: string) => void
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
  hiddenThinkingPreviewStore,
  isSessionViewLoading,
  isSubmitting,
  newSessionDirectoryOptions,
  onCancelCompaction,
  onCreateSession,
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
    }),
    { compare: shallowRecordEqual }
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const showNewSessionComposer =
    sessionState.draft && !hasMessages && !isSessionViewLoading

  if (showNewSessionComposer) {
    return (
      <div className="grid min-h-0 flex-1 items-end justify-items-center overflow-auto p-4 md:place-items-center">
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
              onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
              viewerContextId={viewerContextId}
            />
          }
        />
      </div>
    )
  }

  return (
    <>
      <AppShellSessionConversation
        awaitingFirstTurn={awaitingFirstTurn}
        conversationFrameRef={conversationFrameRef}
        conversationItemsStore={conversationItemsStore}
        displaySettingsStore={displaySettingsStore}
        hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
        isSessionViewLoading={isSessionViewLoading}
        isSubmitting={isSubmitting}
        onCancelCompaction={onCancelCompaction}
        onCreateSession={onCreateSession}
        sessionStore={sessionStore}
        viewerContextId={viewerContextId}
        workingStateStore={workingStateStore}
      />

      <AppShellComposerController
        actionsRef={actionsRef}
        composerPanelRef={composerPanelRef}
        contextUsageStore={contextUsageStore}
        displaySettingsStore={displaySettingsStore}
        fileInputRef={fileInputRef}
        sessionStore={sessionStore}
        store={store}
      />
    </>
  )
}
