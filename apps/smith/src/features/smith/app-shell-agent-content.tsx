import * as React from "react"

import {
  AppShellComposerController,
  NewAgentComposerSelectors,
} from "@/features/smith/app-shell-composer-controller"
import type {
  AppShellComposerActions,
  AppShellComposerSnapshot,
} from "@/features/smith/app-shell-composer-state"
import {
  AppShellAgentConversation,
  type AppShellConversationFrameHandle,
} from "@/features/smith/app-shell-conversation"
import {
  useConversationHasMessages,
  type ConversationItemsStore,
} from "@/features/smith/app-shell-conversation-store"
import type { AppShellDisplaySettingsState } from "@/features/smith/app-shell-types"
import type { AppShellWorkingState } from "@/features/smith/app-shell-working-state"
import type { ComposerPanelHandle } from "@/features/smith/composer-panel"
import type { ComposerContextUsageStore } from "@/features/smith/context-usage"
import { shallowRecordEqual } from "@/features/smith/app-shell-common"
import {
  useSelector,
  type SmithStore,
} from "@/features/smith/tanstack-store-utils"
import type { AgentState } from "@/lib/smith"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/smith/toast"
import { useMachineId } from "@/lib/smith/machine-context"
import {
  buildRequestUrl,
  fetchJson,
  getDataTransferFiles,
  hasDraggedFiles,
} from "@/features/smith/app-shell-utils"
import {
  UserMessageActionsContext,
  type UserMessageActions,
} from "@/features/smith/conversation-view"
import { ToolRenderContext } from "@/features/smith/tool-renderers/registry"
import { WaitingCardChip } from "@/features/smith/agent/waiting-cards"
import { settle } from "@/lib/settle"

export type AppShellAgentContentProps = {
  actionsRef: React.RefObject<AppShellComposerActions>
  awaitingFirstTurn: boolean
  composerPanelRef: React.RefObject<ComposerPanelHandle | null>
  contextUsageStore: ComposerContextUsageStore
  conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
  conversationItemsStore: ConversationItemsStore
  defaultNewAgentProject: string
  displaySettingsStore: SmithStore<AppShellDisplaySettingsState>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isLoadingOlderHistory: boolean
  isAgentViewLoading: boolean
  isSubmitting: boolean
  newAgentProjectOptions: string[]
  onCancelCompaction: () => void
  onCreateAgent: (cwdOverride?: string) => void
  onLoadOlderHistory: () => Promise<void>
  onOpenAddProjectDialog: () => void
  agentStore: SmithStore<AgentState>
  store: SmithStore<AppShellComposerSnapshot>
  viewerContextId: string
  workingStateStore: SmithStore<AppShellWorkingState | null>
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
  const centerMessages = useSelector(
    displaySettingsStore,
    (settings) => settings.centerMessages
  )
  const toolRenderContext = {
    viewerContextId,
    agentId: agentState.draft ? undefined : agentState.agentId,
    cwd: agentState.cwd,
  }
  const machineId = useMachineId()
  const editAgentId = toolRenderContext.agentId
  const userMessageActions: UserMessageActions = {
    editDisabled: agentState.streaming,
    editUserMessage: editAgentId
      ? (entryId) => {
          void (async () => {
            const settled = await settle(
              fetchJson<{ cancelled?: boolean }>(
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
            )
            if (!settled.ok) {
              const error = settled.error
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Failed to edit message"
              )
              return
            }
            composerPanelRef.current?.focusPrompt({ preventScroll: true })
          })()
        }
      : undefined,
  }
  const fileDrop = useConversationFileDrop(composerPanelRef)
  const showNewAgentComposer =
    agentState.draft && !hasMessages && !isAgentViewLoading

  if (showNewAgentComposer) {
    return (
      <div
        {...fileDrop.handlers}
        className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-end justify-items-center overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:place-items-center"
      >
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
        {fileDrop.overlay}
      </div>
    )
  }

  return (
    <div
      {...fileDrop.handlers}
      className="relative flex min-h-0 flex-1 flex-col"
    >
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
          <div
            className={cn(
              "flex shrink-0 flex-wrap justify-center gap-x-2 px-4",
              // The chips are no wider than the messages and the composer.
              centerMessages && "mx-auto w-full max-w-[calc(80ch+2rem)]"
            )}
          >
            <WaitingCardChip
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
      {fileDrop.overlay}
    </div>
  )
}

/**
 * Files dropped anywhere on the conversation go to the composer. The
 * composer's own drop target handles a drop on it first.
 */
function useConversationFileDrop(
  composerPanelRef: React.RefObject<ComposerPanelHandle | null>
) {
  // Counts nested dragenter and dragleave events, so the overlay does not
  // flicker when the pointer moves over child elements.
  const depthRef = React.useRef(0)
  const [dragging, setDragging] = React.useState(false)
  const reset = () => {
    depthRef.current = 0
    setDragging(false)
  }
  const handlers = {
    onDragEnter: (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      depthRef.current += 1
      setDragging(true)
    },
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: () => {
      if (depthRef.current === 0) return
      depthRef.current -= 1
      if (depthRef.current === 0) setDragging(false)
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      reset()
      if (event.defaultPrevented) return
      const files = getDataTransferFiles(event.dataTransfer)
      if (files.length === 0) return
      event.preventDefault()
      composerPanelRef.current?.attachFiles(files)
    },
  }
  const overlay = dragging ? (
    <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/60 text-sm font-medium text-foreground backdrop-blur-[1px]">
      Drop files to attach them
    </div>
  ) : null
  return { handlers, overlay }
}
