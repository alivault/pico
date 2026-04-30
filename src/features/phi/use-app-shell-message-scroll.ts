import * as React from "react"

import { phiSessionScopeKey } from "@/features/phi/query-keys"

type ScrollSessionState = {
  draft: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
  streaming: boolean
}

type UseAppShellMessageScrollOptions = {
  autoScrollEnabled: boolean
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

const SCROLL_STICKY_THRESHOLD_PX = 48

function viewportBottomDistance(viewport: HTMLDivElement) {
  return Math.max(
    0,
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  )
}

function isViewportNearTop(
  viewport: HTMLDivElement,
  threshold = SCROLL_STICKY_THRESHOLD_PX
) {
  return viewport.scrollTop < threshold
}

function isViewportNearBottom(
  viewport: HTMLDivElement,
  threshold = SCROLL_STICKY_THRESHOLD_PX
) {
  return viewportBottomDistance(viewport) < threshold
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

function scrollViewportToBottom(viewport: HTMLDivElement) {
  viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" })
}

function isScrollUpKey(event: KeyboardEvent) {
  return (
    event.key === "ArrowUp" ||
    event.key === "PageUp" ||
    event.key === "Home" ||
    (event.key === " " && event.shiftKey)
  )
}

function isToolAccordionToggleKey(event: KeyboardEvent) {
  return event.key === "Enter" || event.key === " "
}

function findOpeningToolAccordionTrigger(
  target: EventTarget | null,
  viewport: HTMLDivElement
) {
  if (!(target instanceof Element)) return null

  const trigger = target.closest<HTMLElement>(
    "[data-conversation-tool-accordion-trigger='true']"
  )
  if (!trigger || !viewport.contains(trigger)) return null

  return trigger.getAttribute("aria-expanded") === "true" ? null : trigger
}

export function useAppShellMessageScroll({
  autoScrollEnabled,
  isSessionViewLoading,
  sessionState,
}: UseAppShellMessageScrollOptions) {
  const messagesScrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const messageViewportRef = React.useRef<HTMLDivElement | null>(null)
  const lastLoadedSessionScrollKeyRef = React.useRef("")
  const lastMessagesScrollTopRef = React.useRef(0)
  const lastMessagesScrollHeightRef = React.useRef(0)
  const lastMessagesClientHeightRef = React.useRef(0)
  const followMessagesRef = React.useRef(true)
  const userScrollIntentUntilRef = React.useRef(0)
  const previousStreamingRef = React.useRef(sessionState.streaming)
  const followScrollFrameRef = React.useRef(0)
  const scrollStateStoreRef = React.useRef(createMessageScrollStateStore())

  const syncViewportState = React.useCallback((viewport: HTMLDivElement) => {
    scrollStateStoreRef.current.setSnapshot(viewportStateSnapshot(viewport))
  }, [])

  const rememberViewportLayout = React.useCallback(
    (viewport: HTMLDivElement) => {
      lastMessagesScrollTopRef.current = viewport.scrollTop
      lastMessagesScrollHeightRef.current = viewport.scrollHeight
      lastMessagesClientHeightRef.current = viewport.clientHeight
    },
    []
  )

  const scrollViewportToBottomIfFollowing = React.useCallback(
    (viewport: HTMLDivElement) => {
      if (autoScrollEnabled && followMessagesRef.current) {
        scrollViewportToBottom(viewport)
      }
      rememberViewportLayout(viewport)
      syncViewportState(viewport)
    },
    [autoScrollEnabled, rememberViewportLayout, syncViewportState]
  )

  const scheduleFollowScrollIfFollowing = React.useCallback(
    (viewport: HTMLDivElement) => {
      if (!autoScrollEnabled || !followMessagesRef.current) return

      window.cancelAnimationFrame(followScrollFrameRef.current)
      followScrollFrameRef.current = window.requestAnimationFrame(() => {
        followScrollFrameRef.current = 0
        if (!viewport.isConnected) return

        scrollViewportToBottomIfFollowing(viewport)
        followScrollFrameRef.current = window.requestAnimationFrame(() => {
          followScrollFrameRef.current = 0
          if (!viewport.isConnected) return

          scrollViewportToBottomIfFollowing(viewport)
        })
      })
    },
    [autoScrollEnabled, scrollViewportToBottomIfFollowing]
  )

  const scrollConversationToTop = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    followMessagesRef.current = false
    viewport.scrollTo({ top: 0, behavior: "auto" })
  }, [])

  const scrollConversationToBottom = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    followMessagesRef.current = autoScrollEnabled
    scrollViewportToBottom(viewport)
    rememberViewportLayout(viewport)
    syncViewportState(viewport)
    scheduleFollowScrollIfFollowing(viewport)
  }, [
    autoScrollEnabled,
    rememberViewportLayout,
    scheduleFollowScrollIfFollowing,
    syncViewportState,
  ])

  const jumpToPreviousMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = previousMessageJumpTarget(viewport)
    if (!target) return
    followMessagesRef.current = false
    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "auto",
    })
  }, [])

  const jumpToNextMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = nextMessageJumpTarget(viewport)
    if (!target) return
    followMessagesRef.current = false
    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "auto",
    })
  }, [])

  React.useEffect(() => {
    const viewport = findMessageViewport(messagesScrollAreaRef.current)
    messageViewportRef.current = viewport
    if (!viewport) return

    const markUserScrollIntent = () => {
      userScrollIntentUntilRef.current = window.performance.now() + 500
    }

    const hasRecentUserScrollIntent = () =>
      window.performance.now() < userScrollIntentUntilRef.current

    const handleScroll = () => {
      const currentScrollTop = viewport.scrollTop
      const movedUp = currentScrollTop < lastMessagesScrollTopRef.current - 1
      const movedDown = currentScrollTop > lastMessagesScrollTopRef.current + 1

      if (
        movedUp &&
        hasRecentUserScrollIntent() &&
        !isViewportNearBottom(viewport)
      ) {
        followMessagesRef.current = false
      } else if (movedDown && isViewportNearBottom(viewport)) {
        followMessagesRef.current = autoScrollEnabled
      }

      rememberViewportLayout(viewport)
      syncViewportState(viewport)
    }

    const handleWheel = () => {
      markUserScrollIntent()
    }

    const handlePointerDown = (event: PointerEvent) => {
      markUserScrollIntent()
      if (findOpeningToolAccordionTrigger(event.target, viewport)) {
        followMessagesRef.current = false
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const openingToolAccordionTrigger = findOpeningToolAccordionTrigger(
        event.target,
        viewport
      )
      if (openingToolAccordionTrigger && isToolAccordionToggleKey(event)) {
        followMessagesRef.current = false
        return
      }

      markUserScrollIntent()
      if (isScrollUpKey(event)) {
        followMessagesRef.current = false
      }
    }

    handleScroll()
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    viewport.addEventListener("wheel", handleWheel, { passive: true })
    viewport.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    })
    viewport.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => {
      viewport.removeEventListener("scroll", handleScroll)
      viewport.removeEventListener("wheel", handleWheel)
      viewport.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      })
      viewport.removeEventListener("keydown", handleKeyDown, { capture: true })
    }
  }, [autoScrollEnabled, rememberViewportLayout, syncViewportState])

  React.useEffect(() => {
    if (!autoScrollEnabled) {
      followMessagesRef.current = false
      window.cancelAnimationFrame(followScrollFrameRef.current)
      followScrollFrameRef.current = 0
      return
    }

    const viewport = messageViewportRef.current
    if (!viewport || !isViewportNearBottom(viewport)) return
    followMessagesRef.current = true
    scheduleFollowScrollIfFollowing(viewport)
  }, [autoScrollEnabled, scheduleFollowScrollIfFollowing])

  React.useEffect(() => {
    return () => {
      window.cancelAnimationFrame(followScrollFrameRef.current)
    }
  }, [])

  const syncAfterConversationChange = React.useCallback(() => {
    if (isSessionViewLoading) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    scrollViewportToBottomIfFollowing(viewport)
    scheduleFollowScrollIfFollowing(viewport)
  }, [
    isSessionViewLoading,
    scheduleFollowScrollIfFollowing,
    scrollViewportToBottomIfFollowing,
  ])

  React.useLayoutEffect(() => {
    const wasStreaming = previousStreamingRef.current
    if (!wasStreaming && sessionState.streaming && autoScrollEnabled) {
      followMessagesRef.current = true
    }
    previousStreamingRef.current = sessionState.streaming

    syncAfterConversationChange()
  }, [autoScrollEnabled, sessionState.streaming, syncAfterConversationChange])

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
        scrollViewportToBottomIfFollowing(viewport)
        scheduleFollowScrollIfFollowing(viewport)
      })
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(content)
    resizeObserver.observe(viewport)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [scheduleFollowScrollIfFollowing, scrollViewportToBottomIfFollowing])

  React.useLayoutEffect(() => {
    if (isSessionViewLoading) return

    const nextSessionScrollKey = phiSessionScopeKey(sessionState)
    if (!nextSessionScrollKey) return
    if (lastLoadedSessionScrollKeyRef.current === nextSessionScrollKey) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    lastLoadedSessionScrollKeyRef.current = nextSessionScrollKey
    followMessagesRef.current = autoScrollEnabled
    previousStreamingRef.current = sessionState.streaming
    scrollViewportToBottom(viewport)
    rememberViewportLayout(viewport)
    syncViewportState(viewport)
    scheduleFollowScrollIfFollowing(viewport)
  }, [
    autoScrollEnabled,
    isSessionViewLoading,
    sessionState.cwd,
    sessionState.draft,
    sessionState.sessionFile,
    sessionState.sessionId,
    rememberViewportLayout,
    scheduleFollowScrollIfFollowing,
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
    syncAfterConversationChange,
  }
}
