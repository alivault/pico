import * as React from "react"

import { piWebSessionScopeKey } from "@/features/pi-web/query-keys"

type ScrollSessionState = {
  draft: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
  streaming: boolean
}

type UseAppShellMessageScrollOptions = {
  conversationRevision: number
  isSessionViewLoading: boolean
  sessionState: ScrollSessionState
}

export type MessageScrollStateSnapshot = {
  isMessagesNearTop: boolean
  isMessagesNearBottom: boolean
  hasPreviousMessageJumpTarget: boolean
  hasNextMessageJumpTarget: boolean
}

export type MessageScrollStateStore = {
  getSnapshot: () => MessageScrollStateSnapshot
  subscribe: (listener: () => void) => () => void
}

function createMessageScrollStateStore(
  initialSnapshot: MessageScrollStateSnapshot = {
    isMessagesNearTop: true,
    isMessagesNearBottom: true,
    hasPreviousMessageJumpTarget: false,
    hasNextMessageJumpTarget: false,
  }
) {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot: MessageScrollStateSnapshot) => {
      if (
        snapshot.isMessagesNearTop === nextSnapshot.isMessagesNearTop &&
        snapshot.isMessagesNearBottom === nextSnapshot.isMessagesNearBottom &&
        snapshot.hasPreviousMessageJumpTarget ===
          nextSnapshot.hasPreviousMessageJumpTarget &&
        snapshot.hasNextMessageJumpTarget ===
          nextSnapshot.hasNextMessageJumpTarget
      ) {
        return
      }

      snapshot = nextSnapshot
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useMessageScrollValue<T>(
  store: MessageScrollStateStore,
  selector: (snapshot: MessageScrollStateSnapshot) => T
) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot())
  )
}

function findMessageViewport(root: HTMLElement | null) {
  if (!root) return null
  return (
    root.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ||
    (root instanceof HTMLDivElement ? root : null)
  )
}

function isViewportNearTop(viewport: HTMLDivElement, threshold = 48) {
  return viewport.scrollTop < threshold
}

function isViewportNearBottom(viewport: HTMLDivElement, threshold = 48) {
  return (
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
    threshold
  )
}

function messageAnchors(viewport: HTMLDivElement) {
  return [
    ...viewport.querySelectorAll<HTMLElement>("[data-message-anchor='true']"),
  ]
}

function currentMessageAnchorIndex(
  anchors: Array<HTMLElement>,
  viewport: HTMLDivElement
) {
  if (anchors.length === 0) return -1

  const viewportTop = viewport.scrollTop + 8
  let currentIndex = 0

  for (let index = 0; index < anchors.length; index += 1) {
    if (anchors[index].offsetTop <= viewportTop) {
      currentIndex = index
      continue
    }

    break
  }

  return currentIndex
}

function previousMessageJumpTarget(viewport: HTMLDivElement) {
  const anchors = messageAnchors(viewport)
  const currentIndex = currentMessageAnchorIndex(anchors, viewport)
  if (currentIndex < 0) return null

  const currentAnchor = anchors[currentIndex]
  const viewportTop = viewport.scrollTop + 8
  if (currentAnchor && currentAnchor.offsetTop < viewportTop - 1) {
    return currentAnchor
  }

  if (currentIndex === 0) return null
  return anchors[currentIndex - 1]
}

function nextMessageJumpTarget(viewport: HTMLDivElement) {
  const anchors = messageAnchors(viewport)
  const currentIndex = currentMessageAnchorIndex(anchors, viewport)
  if (currentIndex < 0 || currentIndex >= anchors.length - 1) return null
  return anchors[currentIndex + 1]
}

function viewportStateSnapshot(
  viewport: HTMLDivElement
): MessageScrollStateSnapshot {
  return {
    isMessagesNearTop: isViewportNearTop(viewport),
    isMessagesNearBottom: isViewportNearBottom(viewport),
    hasPreviousMessageJumpTarget: Boolean(previousMessageJumpTarget(viewport)),
    hasNextMessageJumpTarget: Boolean(nextMessageJumpTarget(viewport)),
  }
}

function scrollViewportToBottom(
  viewport: HTMLDivElement,
  behavior: ScrollBehavior
) {
  viewport.scrollTo({ top: viewport.scrollHeight, behavior })
}

export function useAppShellMessageScroll({
  conversationRevision,
  isSessionViewLoading,
  sessionState,
}: UseAppShellMessageScrollOptions) {
  const messagesScrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const messageViewportRef = React.useRef<HTMLDivElement | null>(null)
  const lastLoadedSessionScrollKeyRef = React.useRef("")
  const scrollStateStoreRef = React.useRef(createMessageScrollStateStore())

  const syncViewportState = React.useCallback((viewport: HTMLDivElement) => {
    scrollStateStoreRef.current.setSnapshot(viewportStateSnapshot(viewport))
  }, [])

  const scrollViewportToBottomIfPinned = React.useCallback(
    (viewport: HTMLDivElement) => {
      const wasNearBottom =
        scrollStateStoreRef.current.getSnapshot().isMessagesNearBottom
      syncViewportState(viewport)

      if (!wasNearBottom) {
        return
      }

      scrollViewportToBottom(viewport, "auto")
      syncViewportState(viewport)
    },
    [syncViewportState]
  )

  const scrollConversationToTop = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const scrollConversationToBottom = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    scrollViewportToBottom(viewport, "smooth")
  }, [])

  const jumpToPreviousMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = previousMessageJumpTarget(viewport)
    if (!target) return
    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "smooth",
    })
  }, [])

  const jumpToNextMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = nextMessageJumpTarget(viewport)
    if (!target) return
    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "smooth",
    })
  }, [])

  React.useEffect(() => {
    const viewport = findMessageViewport(messagesScrollAreaRef.current)
    messageViewportRef.current = viewport
    if (!viewport) return

    const handleScroll = () => {
      syncViewportState(viewport)
    }

    handleScroll()
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", handleScroll)
    }
  }, [syncViewportState])

  React.useLayoutEffect(() => {
    if (isSessionViewLoading) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    scrollViewportToBottomIfPinned(viewport)
  }, [
    conversationRevision,
    isSessionViewLoading,
    scrollViewportToBottomIfPinned,
    sessionState.streaming,
  ])

  React.useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    const content = messagesContentRef.current
    if (!viewport || !content) return

    messageViewportRef.current = viewport

    let animationFrame = 0
    const handleResize = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        if (!viewport.isConnected) return
        scrollViewportToBottomIfPinned(viewport)
      })
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(content)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [scrollViewportToBottomIfPinned])

  React.useLayoutEffect(() => {
    if (isSessionViewLoading) return

    const nextSessionScrollKey = piWebSessionScopeKey(sessionState)
    if (!nextSessionScrollKey) return
    if (lastLoadedSessionScrollKeyRef.current === nextSessionScrollKey) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    lastLoadedSessionScrollKeyRef.current = nextSessionScrollKey
    viewport.scrollTop = viewport.scrollHeight
    syncViewportState(viewport)
  }, [
    isSessionViewLoading,
    sessionState.cwd,
    sessionState.draft,
    sessionState.sessionFile,
    sessionState.sessionId,
    syncViewportState,
  ])

  return {
    bottomRef,
    jumpToNextMessage,
    jumpToPreviousMessage,
    messagesContentRef,
    messagesScrollAreaRef,
    scrollConversationToBottom,
    scrollConversationToTop,
    scrollStateStore: scrollStateStoreRef.current,
  }
}
