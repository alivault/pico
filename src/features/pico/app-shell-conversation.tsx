import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpToLineIcon,
  CheckIcon,
  OctagonXIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  formatDisplayPath,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import type { AppShellWorkingState } from "@/features/pico/app-shell-working-state"
import { DraftGitStatusBadge } from "@/features/pico/right-sidebar-git-header-actions"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import {
  AssistantMessagesStoreCard,
  UserMessageCard,
} from "@/features/pico/conversation-view"
import {
  assistantMessagesSnapshotFromStore,
  createMutableAssistantMessagesStore,
  useConversationGroupDescriptors,
  useConversationHasAssistantOutput,
  useConversationHasMessages,
  useConversationItem,
  useConversationRevision,
  type ConversationItemsStore,
  type MutableAssistantMessagesStore,
  type RenderConversationGroupDescriptor,
} from "@/features/pico/app-shell-conversation-store"
import {
  useAppShellMessageScroll,
  useMessageScrollValue,
} from "@/features/pico/use-app-shell-message-scroll"
import type { MessageScrollStateStore } from "@/features/pico/use-app-shell-message-scroll"
import {
  ScrollGradientOverlays,
  useScrollGradients,
} from "@/features/pico/scroll-gradient-utils"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { SessionState } from "@/lib/pico"

export type AppShellConversationFrameHandle = {
  jumpToNextMessage: () => void
  jumpToPreviousMessage: () => void
  scrollConversationToBottom: () => void
  scrollConversationToTop: () => void
}

function ConversationLatestMessageButton({
  conversationItemsStore,
  draft,
  onClick,
  scrollStateStore,
}: {
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  onClick: () => void
  scrollStateStore: MessageScrollStateStore
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const isDisabled = useMessageScrollValue(
    scrollStateStore,
    (snapshot) => draft || !hasMessages || snapshot.isMessagesNearBottom
  )

  return (
    <TitleTooltip
      title="Jump to latest message"
      kbd={formatShortcutLabel("Control+ArrowDown")}
    >
      <Button
        variant="secondary"
        size="icon-lg"
        disabled={isDisabled}
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0 md:bottom-[18px]"
        aria-label="Jump to latest message"
        onClick={onClick}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </TitleTooltip>
  )
}

function ConversationScrollRevisionObserver({
  conversationItemsStore,
  disabled,
  onRevisionChange,
}: {
  conversationItemsStore: ConversationItemsStore
  disabled: boolean
  onRevisionChange: () => void
}) {
  const conversationRevision = useConversationRevision(conversationItemsStore)
  const onRevisionChangeEffectEvent = React.useEffectEvent(onRevisionChange)

  React.useLayoutEffect(() => {
    if (disabled) return
    onRevisionChangeEffectEvent()
  }, [conversationRevision, disabled])

  return null
}

function ConversationPreviousMessageButton({
  centerMessages,
  onClick,
  scrollStateStore,
}: {
  centerMessages: boolean
  onClick: () => void
  scrollStateStore: MessageScrollStateStore
}) {
  const isDisabled = useMessageScrollValue(
    scrollStateStore,
    (snapshot) => !snapshot.hasPreviousMessageJumpTarget
  )

  const button = (
    <TitleTooltip
      title="Jump to previous message"
      kbd={formatShortcutLabel("Control+ArrowLeft")}
    >
      <Button
        variant="secondary"
        size="icon-lg"
        disabled={isDisabled}
        className={cn(
          "rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0",
          centerMessages
            ? "pointer-events-auto"
            : "absolute right-4 bottom-4 z-10 md:right-[18px] md:bottom-[18px]"
        )}
        aria-label="Jump to previous message"
        onClick={onClick}
      >
        <ArrowUpToLineIcon className="size-4" />
      </Button>
    </TitleTooltip>
  )

  if (!centerMessages) return button

  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 md:bottom-[18px]">
      <div className="mx-auto flex w-full max-w-[80ch] justify-end">
        {button}
      </div>
    </div>
  )
}

type AppShellConversationSessionState = Pick<
  SessionState,
  "cwd" | "draft" | "sessionFile" | "sessionId" | "streaming"
>

const ConversationContentChangeContext = React.createContext<
  (() => void) | null
>(null)

function useAppShellConversationSessionState(store: PicoStore<SessionState>) {
  return useSelector(
    store,
    (sessionState) => ({
      cwd: sessionState.cwd,
      draft: sessionState.draft,
      sessionFile: sessionState.sessionFile,
      sessionId: sessionState.sessionId,
      streaming: sessionState.streaming,
    }),
    { compare: shallowRecordEqual }
  )
}

function AppShellConversationFrame({
  autoScrollEnabled,
  children,
  centerMessages,
  conversationItemsStore,
  isSessionViewLoading,
  ref,
  sessionState,
}: {
  autoScrollEnabled: boolean
  centerMessages: boolean
  children: React.ReactNode
  conversationItemsStore: ConversationItemsStore
  isSessionViewLoading: boolean
  ref?: React.Ref<AppShellConversationFrameHandle>
  sessionState: AppShellConversationSessionState
}) {
  const {
    bottomRef,
    jumpToNextMessage,
    jumpToPreviousMessage,
    messagesContentRef,
    messagesScrollAreaRef,
    scrollConversationToBottom,
    scrollConversationToTop,
    scrollStateStore,
    syncAfterConversationChange,
  } = useAppShellMessageScroll({
    autoScrollEnabled,
    isSessionViewLoading,
    sessionState,
  })
  const {
    bottomHeight: conversationScrollBottomGradientHeight,
    onScroll: onConversationScrollGradientScroll,
    setScrollElement: setConversationScrollGradientElement,
    topHeight: conversationScrollTopGradientHeight,
  } = useScrollGradients<HTMLDivElement>({ disabled: isSessionViewLoading })
  const setMessagesScrollAreaElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      messagesScrollAreaRef.current = element
      setConversationScrollGradientElement(element)
    },
    [messagesScrollAreaRef, setConversationScrollGradientElement]
  )

  React.useImperativeHandle(
    ref,
    () => ({
      jumpToNextMessage,
      jumpToPreviousMessage,
      scrollConversationToBottom,
      scrollConversationToTop,
    }),
    [
      jumpToNextMessage,
      jumpToPreviousMessage,
      scrollConversationToBottom,
      scrollConversationToTop,
    ]
  )

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={setMessagesScrollAreaElement}
        data-conversation-viewport="true"
        tabIndex={0}
        role="region"
        aria-label="Conversation messages"
        className="h-full overflow-x-hidden overflow-y-auto overscroll-contain px-4 outline-none [overflow-anchor:none]"
        onScroll={onConversationScrollGradientScroll}
      >
        <div ref={messagesContentRef} className="flex min-h-full flex-col">
          <ConversationScrollRevisionObserver
            conversationItemsStore={conversationItemsStore}
            disabled={isSessionViewLoading}
            onRevisionChange={syncAfterConversationChange}
          />
          <ConversationContentChangeContext.Provider
            value={syncAfterConversationChange}
          >
            {children}
          </ConversationContentChangeContext.Provider>
          <div ref={bottomRef} />
        </div>
      </div>

      <ScrollGradientOverlays
        bottomHeight={conversationScrollBottomGradientHeight}
        topHeight={conversationScrollTopGradientHeight}
      />

      {!isSessionViewLoading ? (
        <>
          <ConversationLatestMessageButton
            conversationItemsStore={conversationItemsStore}
            draft={sessionState.draft}
            onClick={scrollConversationToBottom}
            scrollStateStore={scrollStateStore}
          />
          <ConversationPreviousMessageButton
            centerMessages={centerMessages}
            onClick={jumpToPreviousMessage}
            scrollStateStore={scrollStateStore}
          />
        </>
      ) : null}
    </div>
  )
}

function AppShellWorkingIndicatorLabel({
  fallbackLabel,
  hiddenThinkingPreviewStore,
  useHiddenThinkingPreview,
}: {
  fallbackLabel: string
  hiddenThinkingPreviewStore: PicoStore<string>
  useHiddenThinkingPreview: boolean
}) {
  const hiddenThinkingPreview = useSelector(hiddenThinkingPreviewStore)
  const visibleLabel =
    useHiddenThinkingPreview && hiddenThinkingPreview
      ? hiddenThinkingPreview
      : fallbackLabel

  if (!visibleLabel.trim()) {
    return (
      <div aria-hidden="true" className="invisible leading-5 font-medium">
        Working…
      </div>
    )
  }

  return (
    <div className="leading-5 font-medium text-foreground">{visibleLabel}</div>
  )
}

function AppShellMessagesWorkingIndicator({
  hiddenThinkingPreviewStore,
  onCancel,
  state,
  useHiddenThinkingPreview,
}: {
  hiddenThinkingPreviewStore: PicoStore<string>
  onCancel?: () => void
  state: AppShellWorkingState
  useHiddenThinkingPreview: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-start gap-3 rounded-xl p-1 text-sm text-muted-foreground"
    >
      <span className="mt-0.5 inline-flex items-center justify-center">
        {state.done ? (
          <CheckIcon className="size-4 text-emerald-600" />
        ) : state.error ? (
          <OctagonXIcon className="size-4 text-destructive" />
        ) : (
          <Spinner />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-5 min-w-0 items-center justify-start gap-2">
          <div className="min-w-0 shrink-0">
            {state.done ? (
              <div className="font-medium text-foreground">Done</div>
            ) : state.error ? (
              <div className="font-medium text-destructive">{state.label}</div>
            ) : (
              <AppShellWorkingIndicatorLabel
                fallbackLabel={state.label}
                hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
                useHiddenThinkingPreview={useHiddenThinkingPreview}
              />
            )}
          </div>
          {state.cancelable && !state.done && !state.error && onCancel ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="gap-1.5 text-xs"
              onClick={onCancel}
            >
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
          ) : null}
        </div>
        {state.summary ? (
          <div className="truncate text-muted-foreground">{state.summary}</div>
        ) : null}
      </div>
    </div>
  )
}

function ConversationGroupView({
  className,
  group,
  hideFooter,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  className: string
  group: RenderConversationGroupDescriptor
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  if (group.kind === "user") {
    return (
      <ConversationUserGroupView
        className={className}
        itemKey={group.itemKey}
        store={store}
      />
    )
  }

  return (
    <ConversationAssistantGroupView
      className={className}
      groupKey={group.key}
      hideFooter={hideFooter}
      hideThinking={hideThinking}
      hideToolBlocks={hideToolBlocks}
      store={store}
    />
  )
}

function ConversationUserGroupView({
  className,
  itemKey,
  store,
}: {
  className: string
  itemKey: string
  store: ConversationItemsStore
}) {
  const item = useConversationItem(store, itemKey)
  if (!item || item.kind !== "user") return null

  return (
    <div data-message-anchor="true" className={className}>
      <UserMessageCard item={item} />
    </div>
  )
}

function useConversationAssistantGroupItemKeys(
  store: ConversationItemsStore,
  groupKey: string
) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeAssistantGroupItems(groupKey, listener),
      [groupKey, store]
    ),
    () => store.getAssistantGroupItemKeys(groupKey),
    () => store.getAssistantGroupItemKeys(groupKey)
  )
}

function ConversationAssistantGroupView({
  className,
  groupKey,
  hideFooter,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  className: string
  groupKey: string
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  const itemKeys = useConversationAssistantGroupItemKeys(store, groupKey)
  const syncAfterConversationContentChange = React.use(
    ConversationContentChangeContext
  )
  const assistantMessagesStoreRef =
    React.useRef<MutableAssistantMessagesStore | null>(null)
  if (!assistantMessagesStoreRef.current) {
    assistantMessagesStoreRef.current = createMutableAssistantMessagesStore(
      assistantMessagesSnapshotFromStore({
        hideThinking,
        hideToolBlocks,
        itemKeys,
        store,
      })
    )
  }
  const assistantMessagesStore = assistantMessagesStoreRef.current

  React.useLayoutEffect(() => {
    const updateSnapshot = () => {
      assistantMessagesStore.setSnapshot(
        assistantMessagesSnapshotFromStore({
          hideThinking,
          hideToolBlocks,
          itemKeys,
          store,
        })
      )
      syncAfterConversationContentChange?.()
    }

    updateSnapshot()
    return store.subscribeItems(itemKeys, updateSnapshot)
  }, [
    assistantMessagesStore,
    hideThinking,
    hideToolBlocks,
    itemKeys,
    store,
    syncAfterConversationContentChange,
  ])

  return (
    <AssistantMessagesStoreCard
      className={className}
      hideFooter={hideFooter}
      store={assistantMessagesStore}
    />
  )
}

function AppShellConversationItemGroups({
  centerMessages,
  conversationItemsStore,
  hideFooter,
  hideThinking,
  hideToolBlocks,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const renderedConversationGroups = useConversationGroupDescriptors({
    store: conversationItemsStore,
    hideFooter,
    hideThinking,
    hideToolBlocks,
  })

  if (renderedConversationGroups.length === 0) return null

  return (
    <>
      {renderedConversationGroups.map((group) => (
        <ConversationGroupView
          key={group.key}
          className={conversationMessageColumnClassName}
          group={group}
          hideFooter={hideFooter}
          hideThinking={hideThinking}
          hideToolBlocks={hideToolBlocks}
          store={conversationItemsStore}
        />
      ))}
    </>
  )
}

function AppShellConversationEmptyState({
  awaitingFirstTurn,
  conversationItemsStore,
  draft,
  cwd,
  isSessionViewLoading,
  isSubmitting,
  onCreateSession,
  streaming,
  viewerContextId,
  workingStateStore,
}: {
  awaitingFirstTurn: boolean
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  cwd?: string
  isSessionViewLoading: boolean
  isSubmitting: boolean
  onCreateSession: () => void
  streaming: boolean
  viewerContextId: string
  workingStateStore: PicoStore<AppShellWorkingState | null>
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const hasAssistantOutput = useConversationHasAssistantOutput(
    conversationItemsStore
  )
  const workingState = useSelector(workingStateStore)
  const displayedWorkingState =
    workingState ||
    (hasAssistantOutput
      ? {
          label: "Done",
          done: true,
        }
      : null)
  const showConversationLoadingState = Boolean(
    isSessionViewLoading ||
    (!draft &&
      !hasMessages &&
      (isSubmitting ||
        awaitingFirstTurn ||
        streaming ||
        Boolean(displayedWorkingState)))
  )
  const conversationLoadingLabel = isSessionViewLoading
    ? "Loading session…"
    : displayedWorkingState && !displayedWorkingState.done
      ? displayedWorkingState.label
      : "Loading…"

  if (showConversationLoadingState) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
        <Spinner />
        {conversationLoadingLabel ? (
          <div>{conversationLoadingLabel}</div>
        ) : null}
      </div>
    )
  }

  if (hasMessages) return null

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {draft ? "New session" : "Start a new conversation"}
        </EmptyTitle>
        <EmptyDescription>
          {draft
            ? undefined
            : "This is the native Pico session view backed by the new TypeScript runtime."}
        </EmptyDescription>
      </EmptyHeader>
      {draft ? (
        <EmptyContent className="flex flex-col items-center gap-3">
          {cwd ? (
            <Badge variant="outline">{formatDisplayPath(cwd)}</Badge>
          ) : null}
          <DraftGitStatusBadge viewerContextId={viewerContextId} cwd={cwd} />
        </EmptyContent>
      ) : (
        <EmptyContent>
          <Button onClick={onCreateSession}>New session</Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function AppShellConversationWorkingFooter({
  centerMessages,
  conversationItemsStore,
  hiddenThinkingPreviewStore,
  hideThinking,
  onCancelCompaction,
  streaming,
  workingStateStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hiddenThinkingPreviewStore: PicoStore<string>
  hideThinking: boolean
  onCancelCompaction: () => void
  streaming: boolean
  workingStateStore: PicoStore<AppShellWorkingState | null>
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const hasAssistantOutput = useConversationHasAssistantOutput(
    conversationItemsStore
  )
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const workingState = useSelector(workingStateStore)
  const displayedWorkingState =
    workingState ||
    (hasAssistantOutput
      ? {
          label: "Done",
          done: true,
        }
      : null)

  if (!hasMessages || !displayedWorkingState) return null

  return (
    <div className={`${conversationMessageColumnClassName} mt-4`}>
      <AppShellMessagesWorkingIndicator
        hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
        onCancel={onCancelCompaction}
        state={displayedWorkingState}
        useHiddenThinkingPreview={streaming && hideThinking}
      />
    </div>
  )
}

function AppShellConversationMessageStack({
  centerMessages,
  conversationItemsStore,
  hideToolBlocks,
  sessionStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideToolBlocks: boolean
  sessionStore: PicoStore<SessionState>
}) {
  const hideThinking = useSelector(
    sessionStore,
    (sessionState) => sessionState.hideThinkingBlock
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  if (!hasMessages) return null

  return (
    <div className="flex flex-col gap-4 pt-4">
      <AppShellConversationItemGroups
        centerMessages={centerMessages}
        conversationItemsStore={conversationItemsStore}
        hideFooter={false}
        hideThinking={hideThinking}
        hideToolBlocks={hideToolBlocks}
      />
    </div>
  )
}

export const AppShellSessionConversation = React.memo(
  function AppShellSessionConversation({
    awaitingFirstTurn,
    conversationFrameRef,
    conversationItemsStore,
    displaySettingsStore,
    hiddenThinkingPreviewStore,
    isSessionViewLoading,
    isSubmitting,
    onCancelCompaction,
    onCreateSession,
    sessionStore,
    viewerContextId,
    workingStateStore,
  }: {
    awaitingFirstTurn: boolean
    conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
    conversationItemsStore: ConversationItemsStore
    displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
    hiddenThinkingPreviewStore: PicoStore<string>
    isSessionViewLoading: boolean
    isSubmitting: boolean
    onCancelCompaction: () => void
    onCreateSession: () => void
    sessionStore: PicoStore<SessionState>
    viewerContextId: string
    workingStateStore: PicoStore<AppShellWorkingState | null>
  }) {
    const sessionState = useAppShellConversationSessionState(sessionStore)
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useSelector(displaySettingsStore)
    const hideThinking = useSelector(
      sessionStore,
      (currentSessionState) => currentSessionState.hideThinkingBlock
    )

    React.useLayoutEffect(() => {
      conversationItemsStore.setItems(sessionStore.state.items)
    }, [conversationItemsStore, hideThinking, hideToolBlocks, sessionStore])

    return (
      <AppShellConversationFrame
        ref={conversationFrameRef}
        autoScrollEnabled={autoScrollEnabled}
        centerMessages={centerMessages}
        conversationItemsStore={conversationItemsStore}
        isSessionViewLoading={isSessionViewLoading}
        sessionState={sessionState}
      >
        <AppShellConversationEmptyState
          awaitingFirstTurn={awaitingFirstTurn}
          conversationItemsStore={conversationItemsStore}
          cwd={sessionState.cwd}
          draft={sessionState.draft}
          isSessionViewLoading={isSessionViewLoading}
          isSubmitting={isSubmitting}
          onCreateSession={onCreateSession}
          streaming={sessionState.streaming}
          viewerContextId={viewerContextId}
          workingStateStore={workingStateStore}
        />
        {!isSessionViewLoading ? (
          <>
            <AppShellConversationMessageStack
              centerMessages={centerMessages}
              conversationItemsStore={conversationItemsStore}
              hideToolBlocks={hideToolBlocks}
              sessionStore={sessionStore}
            />
            <AppShellConversationWorkingFooter
              centerMessages={centerMessages}
              conversationItemsStore={conversationItemsStore}
              hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
              hideThinking={hideThinking}
              onCancelCompaction={onCancelCompaction}
              streaming={sessionState.streaming}
              workingStateStore={workingStateStore}
            />
          </>
        ) : null}
      </AppShellConversationFrame>
    )
  }
)
