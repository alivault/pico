import * as React from "react"

import {
  AppShellComposerController,
  NewAgentComposerSelectors,
} from "@/features/pico/app-shell-composer-controller"
import type {
  AppShellComposerActions,
  AppShellComposerSnapshot,
} from "@/features/pico/app-shell-composer-state"
import {
  AppShellAgentConversation,
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
import type { AgentState } from "@/lib/pico"
import { toast } from "@/lib/pico/toast"
import { useMachineId } from "@/lib/pico/machine-context"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  UserMessageActionsContext,
  type UserMessageActions,
} from "@/features/pico/conversation-view"
import { ToolRenderContext } from "@/features/pico/tool-renderers/registry"
import { WaitingCardChip } from "@/features/pico/agent/waiting-cards"
import { TodoProgressChip } from "@/features/pico/agent/todo"

export type AppShellAgentContentProps = {
  actionsRef: React.RefObject<AppShellComposerActions>
  awaitingFirstTurn: boolean
  composerPanelRef: React.RefObject<ComposerPanelHandle | null>
  contextUsageStore: ComposerContextUsageStore
  conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
  conversationItemsStore: ConversationItemsStore
  defaultNewAgentProject: string
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isLoadingOlderHistory: boolean
  isAgentViewLoading: boolean
  isSubmitting: boolean
  newAgentProjectOptions: Array<{ path: string; label: string }>
  onCancelCompaction: () => void
  onCreateAgent: (cwdOverride?: string) => void
  onLoadOlderHistory: () => Promise<void>
  onOpenAddProjectDialog: () => void
  agentStore: PicoStore<AgentState>
  store: PicoStore<AppShellComposerSnapshot>
  viewerContextId: string
  workingStateStore: PicoStore<AppShellWorkingState | null>
}

export function AppShellAgentContent({
  actionsRef,
  awaitingFirstTurn,
  composerPanelRef,
  contextUsageStore,
  conversationFrameRef,
  conversationItemsStore,
  defaultNewAgentProject,
  displaySettingsStore,
  fileInputRef,
  isLoadingOlderHistory,
  isAgentViewLoading,
  isSubmitting,
  newAgentProjectOptions,
  onCancelCompaction,
  onCreateAgent,
  onLoadOlderHistory,
  onOpenAddProjectDialog,
  agentStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellAgentContentProps) {
  const agentState = useSelector(
    agentStore,
    (currentAgentState) => ({
      cwd: currentAgentState.cwd,
      draft: currentAgentState.draft,
      agentId: currentAgentState.agentId,
      streaming: currentAgentState.streaming,
    }),
    { compare: shallowRecordEqual }
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const toolRenderContext = React.useMemo(
    () => ({
      viewerContextId,
      agentId: agentState.draft ? undefined : agentState.agentId,
      cwd: agentState.cwd,
    }),
    [agentState.cwd, agentState.draft, agentState.agentId, viewerContextId]
  )
  const machineId = useMachineId()
  const editAgentId = toolRenderContext.agentId
  const userMessageActions = React.useMemo<UserMessageActions>(
    () => ({
      editDisabled: agentState.streaming,
      editUserMessage: editAgentId
        ? (entryId) => {
            void (async () => {
              try {
                // Tree navigation to a user message forks at its parent and
                // puts its text back in the composer.
                await fetchJson<{ cancelled?: boolean }>(
                  buildRequestUrl("/api/agent/tree", {
                    machineId,
                    contextId: viewerContextId,
                    agentId: editAgentId,
                  }),
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ targetId: entryId }),
                  }
                )
                composerPanelRef.current?.focusPrompt({ preventScroll: true })
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Failed to edit message"
                )
              }
            })()
          }
        : undefined,
    }),
    [
      composerPanelRef,
      editAgentId,
      machineId,
      agentState.streaming,
      viewerContextId,
    ]
  )
  const showNewAgentComposer =
    agentState.draft && !hasMessages && !isAgentViewLoading

  if (showNewAgentComposer) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-end justify-items-center overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:place-items-center">
        <AppShellComposerController
          actionsRef={actionsRef}
          composerPanelRef={composerPanelRef}
          contextUsageStore={contextUsageStore}
          displaySettingsStore={displaySettingsStore}
          fileInputRef={fileInputRef}
          agentStore={agentStore}
          store={store}
          topContent={
            <NewAgentComposerSelectors
              cwd={agentState.cwd}
              defaultNewAgentProject={defaultNewAgentProject}
              projectOptions={newAgentProjectOptions}
              onCreateAgent={onCreateAgent}
              onMoveDraftToMachine={(targetMachine, project) =>
                actionsRef.current.moveDraftToMachine(targetMachine, project)
              }
              onOpenAddProjectDialog={onOpenAddProjectDialog}
              viewerContextId={viewerContextId}
            />
          }
        />
      </div>
    )
  }

  return (
    <ToolRenderContext.Provider value={toolRenderContext}>
      <UserMessageActionsContext.Provider value={userMessageActions}>
        <AppShellAgentConversation
          awaitingFirstTurn={awaitingFirstTurn}
          conversationFrameRef={conversationFrameRef}
          conversationItemsStore={conversationItemsStore}
          displaySettingsStore={displaySettingsStore}
          isLoadingOlderHistory={isLoadingOlderHistory}
          isAgentViewLoading={isAgentViewLoading}
          isSubmitting={isSubmitting}
          onCancelCompaction={onCancelCompaction}
          onCreateAgent={onCreateAgent}
          onLoadOlderHistory={onLoadOlderHistory}
          agentStore={agentStore}
          viewerContextId={viewerContextId}
          workingStateStore={workingStateStore}
        />
      </UserMessageActionsContext.Provider>

      {toolRenderContext.agentId ? (
        <div className="flex shrink-0 flex-wrap justify-center gap-x-2 px-4">
          <WaitingCardChip
            agentId={toolRenderContext.agentId}
            viewerContextId={viewerContextId}
          />
          <TodoProgressChip
            agentId={toolRenderContext.agentId}
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
        agentStore={agentStore}
        store={store}
      />
    </ToolRenderContext.Provider>
  )
}
