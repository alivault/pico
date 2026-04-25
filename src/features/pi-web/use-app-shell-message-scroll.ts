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
  conversationRevision,
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
      if (!followMessagesRef.current) {
        rememberViewportLayout(viewport)
        syncViewportState(viewport)
        return
      }

      scrollViewportToBottom(viewport, "auto")
      rememberViewportLayout(viewport)
      syncViewportState(viewport)
    },
    [rememberViewportLayout, syncViewportState]
  )

  const scrollConversationToTop = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    followMessagesRef.current = false
    viewport.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const scrollConversationToBottom = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    followMessagesRef.current = true
    scrollViewportToBottom(viewport, "smooth")
  }, [])

  const jumpToPreviousMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = previousMessageJumpTarget(viewport)
    if (!target) return
    followMessagesRef.current = false
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
    followMessagesRef.current = false
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
      const currentScrollTop = viewport.scrollTop
      const currentScrollHeight = viewport.scrollHeight
      const currentClientHeight = viewport.clientHeight
      const movedUp = currentScrollTop < lastMessagesScrollTopRef.current - 1
      const layoutChanged =
        currentScrollHeight !== lastMessagesScrollHeightRef.current ||
        currentClientHeight !== lastMessagesClientHeightRef.current

      if (movedUp && !layoutChanged && !isViewportNearBottom(viewport)) {
        followMessagesRef.current = false
      } else if (isViewportNearBottom(viewport)) {
        followMessagesRef.current = true
      }

      rememberViewportLayout(viewport)
      syncViewportState(viewport)
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        followMessagesRef.current = false
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
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
  }, [rememberViewportLayout, syncViewportState])

  React.useLayoutEffect(() => {
    if (isSessionViewLoading) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    scrollViewportToBottomIfFollowing(viewport)
  }, [
    conversationRevision,
    isSessionViewLoading,
    scrollViewportToBottomIfFollowing,
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
        scrollViewportToBottomIfFollowing(viewport)
      })
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(content)
    resizeObserver.observe(viewport)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [scrollViewportToBottomIfFollowing])

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
    followMessagesRef.current = true
    viewport.scrollTop = viewport.scrollHeight
    rememberViewportLayout(viewport)
    syncViewportState(viewport)
  }, [
    isSessionViewLoading,
    sessionState.cwd,
    sessionState.draft,
    sessionState.sessionFile,
    sessionState.sessionId,
    rememberViewportLayout,
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
