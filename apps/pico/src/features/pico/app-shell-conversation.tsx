import * as React from "react"
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
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
import {
  COMPACT_WORKING_LABEL,
  type AppShellWorkingState,
} from "@/features/pico/app-shell-working-state"
import { DraftGitStatusBadge } from "@/features/pico/right-sidebar-git-header-actions"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
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
  usePendingCompactionRow,
  type ConversationItemsStore,
  type MutableAssistantMessagesStore,
  type RenderConversationGroupDescriptor,
} from "@/features/pico/app-shell-conversation-store"
import {
  useAppShellMessageScroll,
  useMessageJumpValue,
  type MessageJumpStateStore,
} from "@/features/pico/use-app-shell-message-scroll"
import { picoSessionScopeKey } from "@/features/pico/query-keys"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller"
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
  streaming,
}: {
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  onClick: () => void
  streaming: boolean
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const scrollable = useMessageScrollerScrollable()
  const isDisabled = draft || !hasMessages || !scrollable.end
  // The turn can stream below the view. A ring on the button shows that
  // there is live output out of view.
  const showStreaming = streaming && !isDisabled
  const label = showStreaming
    ? "Jump to latest message, response is streaming"
    : "Jump to latest message"

  return (
    <TitleTooltip
      title="Jump to latest message"
      kbd={formatShortcutLabel(appShortcut("ArrowDown"))}
    >
      <Button
        variant="outline"
        size="icon"
        disabled={isDisabled}
        className="pointer-events-auto relative rounded-full bg-secondary text-secondary-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-0 dark:bg-secondary dark:hover:bg-accent"
        aria-label={label}
        onClick={onClick}
      >
        <ArrowDownIcon className="size-4" />
        {showStreaming ? (
          <Spinner
            role="presentation"
            aria-hidden="true"
            aria-label={undefined}
            strokeWidth={1.5}
            className="absolute -inset-px size-[calc(100%+2px)]"
          />
        ) : null}
      </Button>
    </TitleTooltip>
  )
}

function ConversationFirstMessageButton({
  conversationItemsStore,
  draft,
  onClick,
}: {
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  onClick: () => void
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const scrollable = useMessageScrollerScrollable()
  const isDisabled = draft || !hasMessages || !scrollable.start

  return (
    <TitleTooltip
      title="Jump to first message"
      kbd={formatShortcutLabel(appShortcut("ArrowUp"))}
    >
      <Button
        variant="outline"
        size="icon"
        disabled={isDisabled}
        className="pointer-events-auto rounded-full bg-secondary text-secondary-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-0 dark:bg-secondary dark:hover:bg-accent"
        aria-label="Jump to first message"
        onClick={onClick}
      >
        <ArrowUpIcon className="size-4" />
      </Button>
    </TitleTooltip>
  )
}

function ConversationMessageJumpButton({
  direction,
  jumpStateStore,
  onClick,
}: {
  direction: "next" | "previous"
  jumpStateStore: MessageJumpStateStore
  onClick: () => void
}) {
  const isDisabled = useMessageJumpValue(jumpStateStore, (snapshot) =>
    direction === "next"
      ? !snapshot.hasNextMessageJumpTarget
      : !snapshot.hasPreviousMessageJumpTarget
  )
  const label =
    direction === "next"
      ? "Jump to your next message"
      : "Jump to your previous message"
  const Icon = direction === "next" ? ArrowDownToLineIcon : ArrowUpToLineIcon

  return (
    <TitleTooltip
      title={label}
      kbd={formatShortcutLabel(
        appShortcut(direction === "next" ? "ArrowRight" : "ArrowLeft")
      )}
    >
      <Button
        variant="outline"
        size="icon"
        disabled={isDisabled}
        className="pointer-events-auto rounded-full bg-secondary text-secondary-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-0 dark:bg-secondary dark:hover:bg-accent"
        aria-label={label}
        onClick={onClick}
      >
        <Icon className="size-4" />
      </Button>
    </TitleTooltip>
  )
}

// The buttons sit in a column at the bottom right: first, previous, next,
// latest. A hidden button keeps its space, so the buttons do not move.
// With centered messages, the column is 6rem wider than the text column
// (two buttons of 2.25rem and two gaps of 0.75rem). When the pane is wide
// enough, the buttons sit next to the text, not on it.
function ConversationJumpButtons({
  centerMessages,
  conversationItemsStore,
  draft,
  jumpStateStore,
  onFirst,
  onLatest,
  onNext,
  onPrevious,
  streaming,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  jumpStateStore: MessageJumpStateStore
  onFirst: () => void
  onLatest: () => void
  onNext: () => void
  onPrevious: () => void
  streaming: boolean
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 md:inset-x-[18px] md:bottom-[18px]">
      <div
        className={cn(
          "flex flex-col items-end gap-2",
          centerMessages && "mx-auto w-full max-w-[calc(80ch+6rem)]"
        )}
      >
        <ConversationFirstMessageButton
          conversationItemsStore={conversationItemsStore}
          draft={draft}
          onClick={onFirst}
        />
        <ConversationMessageJumpButton
          direction="previous"
          jumpStateStore={jumpStateStore}
          onClick={onPrevious}
        />
        <ConversationMessageJumpButton
          direction="next"
          jumpStateStore={jumpStateStore}
          onClick={onNext}
        />
        <ConversationLatestMessageButton
          conversationItemsStore={conversationItemsStore}
          draft={draft}
          onClick={onLatest}
          streaming={streaming}
        />
      </div>
    </div>
  )
}

type AppShellConversationSessionState = Pick<
  SessionState,
  | "cwd"
  | "draft"
  | "historyOffset"
  | "historyTotalCount"
  | "sessionFile"
  | "sessionId"
  | "streaming"
>

function useAppShellConversationSessionState(store: PicoStore<SessionState>) {
  return useSelector(
    store,
    (sessionState) => ({
      cwd: sessionState.cwd,
      draft: sessionState.draft,
      historyOffset: sessionState.historyOffset,
      historyTotalCount: sessionState.historyTotalCount,
      sessionFile: sessionState.sessionFile,
      sessionId: sessionState.sessionId,
      streaming: sessionState.streaming,
    }),
    { compare: shallowRecordEqual }
  )
}

const HISTORY_AUTOLOAD_THRESHOLD_PX = 48

// This row sits above the scroller content, not inside it. The first message
// row then stays the first item, so the scroller keeps the reader in place
// when older messages are prepended.
function ConversationEarlierMessages({
  isLoading,
  onLoad,
  viewport,
}: {
  isLoading: boolean
  onLoad: () => Promise<void>
  viewport: HTMLDivElement | null
}) {
  const scrollable = useMessageScrollerScrollable()
  const load = React.useCallback(() => {
    if (isLoading) return
    void onLoad()
  }, [isLoading, onLoad])

  React.useEffect(() => {
    if (!viewport || isLoading || scrollable.start) return
    if (viewport.scrollTop > HISTORY_AUTOLOAD_THRESHOLD_PX) return
    load()
  }, [isLoading, load, scrollable.start, viewport])

  return (
    <div className="flex justify-center py-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isLoading}
        onClick={load}
      >
        {isLoading ? <Spinner /> : null}
        {isLoading ? "Loading earlier messages…" : "Load earlier messages"}
      </Button>
    </div>
  )
}

type AppShellConversationFrameProps = {
  autoScrollEnabled: boolean
  centerMessages: boolean
  children: React.ReactNode
  conversationItemsStore: ConversationItemsStore
  emptyState: React.ReactNode
  isLoadingOlderHistory: boolean
  isSessionViewLoading: boolean
  onLoadOlderHistory: () => Promise<void>
  ref?: React.Ref<AppShellConversationFrameHandle>
  sessionState: AppShellConversationSessionState
  viewportElementRef?: React.RefObject<HTMLElement | null>
}

/**
 * Keep the scroll position of the conversation while the app shell of this
 * machine is hidden (see `routes/index.tsx`). A hidden shell gets
 * `display: none`, which loses the position. When the shell shows again,
 * the message scroller sees its viewport grow from zero and scrolls to the
 * end in an animation frame from its resize observer. Its observer starts
 * in a passive effect of a child. This observer starts in a passive effect
 * of the parent, so its callback and its animation frame come later: this
 * restore wins. The observer stops after a short time.
 */
function usePreservedScrollWhileHidden(
  elementRef: React.RefObject<HTMLElement | null>
) {
  const savedRef = React.useRef<{ element: HTMLElement; top: number } | null>(
    null
  )
  React.useLayoutEffect(() => {
    // React attaches the viewport ref again only after this effect, so use
    // the element from the hide. It is the same element when it is still in
    // the document.
    const saved = savedRef.current
    if (saved?.element.isConnected) saved.element.scrollTop = saved.top
    return () => {
      const element = elementRef.current
      savedRef.current = element ? { element, top: element.scrollTop } : null
    }
  }, [elementRef])
  React.useEffect(() => {
    const saved = savedRef.current
    if (!saved?.element.isConnected) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        saved.element.scrollTop = saved.top
      })
    })
    observer.observe(saved.element)
    const stop = window.setTimeout(() => observer.disconnect(), 500)
    return () => {
      window.clearTimeout(stop)
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
}

function AppShellConversationFrame(props: AppShellConversationFrameProps) {
  const viewportElementRef = React.useRef<HTMLElement | null>(null)
  usePreservedScrollWhileHidden(viewportElementRef)
  // Remount the scroller for each session so the opening position applies
  // again and no follow state leaks between sessions.
  // The key also changes when the session view finishes loading, because
  // the scroller treats rows that arrive later as new turns.
  const sessionScrollKey = `${picoSessionScopeKey(props.sessionState) || "none"}:${
    props.isSessionViewLoading ? "loading" : "ready"
  }`

  return (
    <MessageScrollerProvider
      key={sessionScrollKey}
      autoScroll={props.autoScrollEnabled}
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={64}
    >
      <AppShellConversationScroller
        {...props}
        viewportElementRef={viewportElementRef}
      />
    </MessageScrollerProvider>
  )
}

function AppShellConversationScroller({
  children,
  centerMessages,
  conversationItemsStore,
  emptyState,
  isLoadingOlderHistory,
  isSessionViewLoading,
  onLoadOlderHistory,
  ref,
  sessionState,
  viewportElementRef,
}: AppShellConversationFrameProps) {
  const {
    jumpStateStore,
    jumpToNextMessage,
    jumpToPreviousMessage,
    scrollConversationToBottom,
    scrollConversationToTop,
    setViewport,
    viewport,
  } = useAppShellMessageScroll()

  React.useLayoutEffect(() => {
    if (viewportElementRef) viewportElementRef.current = viewport
  }, [viewport, viewportElementRef])

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
    <MessageScroller className="min-h-0 flex-1">
      <MessageScrollerViewport
        ref={setViewport}
        data-conversation-viewport="true"
        aria-label="Conversation messages"
        className="overflow-x-hidden px-9 outline-none"
      >
        {sessionState.historyOffset > 0 && !isSessionViewLoading ? (
          <ConversationEarlierMessages
            isLoading={isLoadingOlderHistory}
            onLoad={onLoadOlderHistory}
            viewport={viewport}
          />
        ) : null}
        <MessageScrollerContent
          aria-busy={sessionState.streaming}
          className="gap-4 py-4"
        >
          {isSessionViewLoading ? null : children}
        </MessageScrollerContent>
      </MessageScrollerViewport>

      {emptyState}

      {!isSessionViewLoading ? (
        <ConversationJumpButtons
          centerMessages={centerMessages}
          conversationItemsStore={conversationItemsStore}
          draft={sessionState.draft}
          jumpStateStore={jumpStateStore}
          onFirst={scrollConversationToTop}
          onLatest={scrollConversationToBottom}
          onNext={jumpToNextMessage}
          onPrevious={jumpToPreviousMessage}
          streaming={sessionState.streaming}
        />
      ) : null}
    </MessageScroller>
  )
}

function AppShellWorkingIndicatorLabel({ label }: { label: string }) {
  if (!label.trim()) {
    return (
      <div aria-hidden="true" className="invisible leading-5 font-medium">
        Working…
      </div>
    )
  }

  return <div className="leading-5 font-medium text-foreground">{label}</div>
}

function AppShellMessagesWorkingIndicator({
  onCancel,
  state,
}: {
  onCancel?: () => void
  state: AppShellWorkingState
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
              <AppShellWorkingIndicatorLabel label={state.label} />
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

// Paint containment from content-visibility clips list markers and other
// content that overflows the row, so rows stay fully painted.
// The working footer can share the last row, so rows stack with a gap.
const conversationItemClassName =
  "flex flex-col gap-4 [content-visibility:visible]"

function ConversationGroupView({
  className,
  group,
  hideFooter,
  hideThinking,
  hideToolBlocks,
  messageId,
  store,
  workingFooter,
}: {
  className: string
  group: RenderConversationGroupDescriptor
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  messageId: string
  store: ConversationItemsStore
  workingFooter?: React.ReactNode
}) {
  if (group.kind === "compaction") {
    // The pending row and the summary row share this element, so keep the
    // same element type at the root for both.
    return (
      <MessageScrollerItem
        messageId={messageId}
        scrollAnchor
        className={conversationItemClassName}
      >
        {group.pending ? null : (
          <ConversationAssistantGroupView
            className={className}
            groupKey={group.key}
            hideFooter={hideFooter}
            hideThinking={hideThinking}
            hideToolBlocks={hideToolBlocks}
            store={store}
          />
        )}
        {workingFooter}
      </MessageScrollerItem>
    )
  }

  if (group.kind === "user") {
    return (
      <MessageScrollerItem
        messageId={messageId}
        scrollAnchor
        className={conversationItemClassName}
      >
        <ConversationUserGroupView
          className={className}
          itemKey={group.itemKey}
          store={store}
        />
        {workingFooter}
      </MessageScrollerItem>
    )
  }

  return (
    <MessageScrollerItem
      messageId={messageId}
      className={conversationItemClassName}
    >
      <ConversationAssistantGroupView
        className={className}
        groupKey={group.key}
        hideFooter={hideFooter}
        hideThinking={hideThinking}
        hideToolBlocks={hideToolBlocks}
        store={store}
      />
      {workingFooter}
    </MessageScrollerItem>
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
    <div data-user-message-anchor="true" className={className}>
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
    }

    updateSnapshot()
    return store.subscribeItems(itemKeys, updateSnapshot)
  }, [assistantMessagesStore, hideThinking, hideToolBlocks, itemKeys, store])

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
  compacting,
  conversationItemsStore,
  hideFooter,
  hideThinking,
  hideToolBlocks,
  workingFooter,
}: {
  centerMessages: boolean
  compacting: boolean
  conversationItemsStore: ConversationItemsStore
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  workingFooter: React.ReactNode
}) {
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const conversationGroups = useConversationGroupDescriptors({
    store: conversationItemsStore,
    hideFooter,
    hideThinking,
    hideToolBlocks,
  })
  const { groups: renderedConversationGroups, rowKey } =
    usePendingCompactionRow(conversationGroups, compacting)

  if (renderedConversationGroups.length === 0) {
    return (
      <MessageScrollerItem
        messageId="working-footer"
        className={conversationItemClassName}
      >
        {workingFooter}
      </MessageScrollerItem>
    )
  }

  const lastGroupIndex = renderedConversationGroups.length - 1

  // The working footer renders inside the last row, not as a row of its own.
  // The scroller looks for a new turn only after the rows it already knows,
  // so a footer row at the end would hide the new user message from it.
  return (
    <>
      {renderedConversationGroups.map((group, index) => (
        <ConversationGroupView
          key={rowKey(group)}
          className={conversationMessageColumnClassName}
          group={group}
          hideFooter={hideFooter}
          hideThinking={hideThinking}
          hideToolBlocks={hideToolBlocks}
          messageId={rowKey(group)}
          store={conversationItemsStore}
          workingFooter={index === lastGroupIndex ? workingFooter : null}
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
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
        <Spinner />
        {conversationLoadingLabel ? (
          <div>{conversationLoadingLabel}</div>
        ) : null}
      </div>
    )
  }

  if (hasMessages) return null

  return (
    <Empty className="absolute inset-0">
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
  onCancelCompaction,
  workingStateStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  onCancelCompaction: () => void
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
    <div className={conversationMessageColumnClassName}>
      <AppShellMessagesWorkingIndicator
        onCancel={onCancelCompaction}
        state={displayedWorkingState}
      />
    </div>
  )
}

function AppShellConversationMessageStack({
  centerMessages,
  conversationItemsStore,
  hideToolBlocks,
  sessionStore,
  workingFooter,
  workingStateStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideToolBlocks: boolean
  sessionStore: PicoStore<SessionState>
  workingFooter: React.ReactNode
  workingStateStore: PicoStore<AppShellWorkingState | null>
}) {
  const hideThinking = useSelector(
    sessionStore,
    (sessionState) => sessionState.hideThinkingBlock
  )
  const compacting = useSelector(
    workingStateStore,
    (workingState) => workingState?.label === COMPACT_WORKING_LABEL
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  if (!hasMessages) return null

  return (
    <AppShellConversationItemGroups
      centerMessages={centerMessages}
      compacting={compacting}
      conversationItemsStore={conversationItemsStore}
      hideFooter={false}
      hideThinking={hideThinking}
      hideToolBlocks={hideToolBlocks}
      workingFooter={workingFooter}
    />
  )
}

export const AppShellSessionConversation = React.memo(
  function AppShellSessionConversation({
    awaitingFirstTurn,
    conversationFrameRef,
    conversationItemsStore,
    displaySettingsStore,
    isLoadingOlderHistory,
    isSessionViewLoading,
    isSubmitting,
    onCancelCompaction,
    onCreateSession,
    onLoadOlderHistory,
    sessionStore,
    viewerContextId,
    workingStateStore,
  }: {
    awaitingFirstTurn: boolean
    conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
    conversationItemsStore: ConversationItemsStore
    displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
    isLoadingOlderHistory: boolean
    isSessionViewLoading: boolean
    isSubmitting: boolean
    onCancelCompaction: () => void
    onCreateSession: () => void
    onLoadOlderHistory: () => Promise<void>
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
        isLoadingOlderHistory={isLoadingOlderHistory}
        isSessionViewLoading={isSessionViewLoading}
        onLoadOlderHistory={onLoadOlderHistory}
        sessionState={sessionState}
        emptyState={
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
        }
      >
        <AppShellConversationMessageStack
          centerMessages={centerMessages}
          conversationItemsStore={conversationItemsStore}
          hideToolBlocks={hideToolBlocks}
          sessionStore={sessionStore}
          workingFooter={
            <AppShellConversationWorkingFooter
              centerMessages={centerMessages}
              conversationItemsStore={conversationItemsStore}
              onCancelCompaction={onCancelCompaction}
              workingStateStore={workingStateStore}
            />
          }
          workingStateStore={workingStateStore}
        />
      </AppShellConversationFrame>
    )
  }
)
