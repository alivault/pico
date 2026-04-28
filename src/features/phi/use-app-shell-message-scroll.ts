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

const MESSAGE_VIEWPORT_TOP_PADDING = 8

type StreamingScrollMode = "bottom" | "assistant-message-cap" | "tool-reveal"
type FollowScrollPreference = "auto" | "bottom"

function scrollViewportToBottom(
  viewport: HTMLDivElement,
  behavior: ScrollBehavior
) {
  viewport.scrollTo({ top: viewport.scrollHeight, behavior })
}

function latestElement<T extends HTMLElement>(elements: Iterable<T>) {
  const list = [...elements]
  return list[list.length - 1] || null
}

function latestAssistantGroup(viewport: HTMLDivElement) {
  return latestElement(
    viewport.querySelectorAll<HTMLElement>(
      '[data-conversation-assistant-group="true"]'
    )
  )
}

function latestStreamingAssistantGroup(viewport: HTMLDivElement) {
  return latestElement(
    viewport.querySelectorAll<HTMLElement>(
      '[data-conversation-assistant-group="true"][data-conversation-streaming="true"]'
    )
  )
}

function assistantBlocks(group: HTMLElement) {
  return [
    ...group.querySelectorAll<HTMLElement>(
      '[data-conversation-assistant-block="true"]'
    ),
  ]
}

function latestAssistantBlock(group: HTMLElement) {
  return latestElement(assistantBlocks(group))
}

function latestAssistantTextBlock(group: HTMLElement) {
  return latestElement(
    assistantBlocks(group).filter(
      (block) => block.dataset.conversationAssistantBlockType === "text"
    )
  )
}

function cappedAssistantMessageScrollTop(
  viewport: HTMLDivElement,
  textBlock: HTMLElement
) {
  const maxScrollTop = Math.max(
    0,
    viewport.scrollHeight - viewport.clientHeight
  )
  const capScrollTop = Math.max(
    0,
    textBlock.offsetTop - MESSAGE_VIEWPORT_TOP_PADDING
  )

  return Math.min(maxScrollTop, capScrollTop)
}

function scrollViewportToAssistantMessageCap(
  viewport: HTMLDivElement,
  textBlock: HTMLElement
) {
  viewport.scrollTo({
    top: cappedAssistantMessageScrollTop(viewport, textBlock),
    behavior: "auto",
  })
}

function scrollViewportToRevealElement(
  viewport: HTMLDivElement,
  element: HTMLElement
) {
  const viewportTop = viewport.scrollTop
  const viewportBottom = viewportTop + viewport.clientHeight
  const elementTop = element.offsetTop
  const elementBottom = elementTop + element.offsetHeight
  const bottomPadding = 16
  const maxScrollTop = Math.max(
    0,
    viewport.scrollHeight - viewport.clientHeight
  )

  if (elementBottom > viewportBottom - bottomPadding) {
    viewport.scrollTo({
      top: Math.min(
        maxScrollTop,
        elementBottom - viewport.clientHeight + bottomPadding
      ),
      behavior: "auto",
    })
    return
  }

  if (elementTop < viewportTop + MESSAGE_VIEWPORT_TOP_PADDING) {
    viewport.scrollTo({
      top: Math.max(0, elementTop - MESSAGE_VIEWPORT_TOP_PADDING),
      behavior: "auto",
    })
  }
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
  const followScrollPreferenceRef = React.useRef<FollowScrollPreference>("auto")
  const streamingScrollModeRef = React.useRef<StreamingScrollMode>("bottom")
  const lastRevealedToolBlockKeyRef = React.useRef("")
  const previousStreamingRef = React.useRef(sessionState.streaming)
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

  const scrollViewportIfFollowing = React.useCallback(
    (viewport: HTMLDivElement) => {
      if (!followMessagesRef.current) {
        rememberViewportLayout(viewport)
        syncViewportState(viewport)
        return
      }

      const shouldForceBottom = followScrollPreferenceRef.current === "bottom"
      const streamingAssistantGroup = latestStreamingAssistantGroup(viewport)

      if (!shouldForceBottom && streamingAssistantGroup) {
        const latestBlock = latestAssistantBlock(streamingAssistantGroup)
        const latestBlockType =
          latestBlock?.dataset.conversationAssistantBlockType

        if (latestBlockType === "text") {
          const textBlock = latestAssistantTextBlock(streamingAssistantGroup)
          if (textBlock) {
            streamingScrollModeRef.current = "assistant-message-cap"
            scrollViewportToAssistantMessageCap(viewport, textBlock)
            rememberViewportLayout(viewport)
            syncViewportState(viewport)
            return
          }
        }

        if (latestBlockType === "tool" && latestBlock) {
          const blockKey =
            latestBlock.dataset.conversationAssistantBlockKey || ""
          if (blockKey && blockKey !== lastRevealedToolBlockKeyRef.current) {
            lastRevealedToolBlockKeyRef.current = blockKey
            streamingScrollModeRef.current = "tool-reveal"
            scrollViewportToRevealElement(viewport, latestBlock)
          }
          rememberViewportLayout(viewport)
          syncViewportState(viewport)
          return
        }

        rememberViewportLayout(viewport)
        syncViewportState(viewport)
        return
      }

      if (
        !shouldForceBottom &&
        streamingScrollModeRef.current === "assistant-message-cap"
      ) {
        const assistantGroup = latestAssistantGroup(viewport)
        const textBlock = assistantGroup
          ? latestAssistantTextBlock(assistantGroup)
          : null
        if (textBlock) {
          scrollViewportToAssistantMessageCap(viewport, textBlock)
          rememberViewportLayout(viewport)
          syncViewportState(viewport)
          return
        }
      }

      if (shouldForceBottom) {
        streamingScrollModeRef.current = "bottom"
        scrollViewportToBottom(viewport, "auto")
      }
      rememberViewportLayout(viewport)
      syncViewportState(viewport)
    },
    [rememberViewportLayout, syncViewportState]
  )

  const scrollConversationToTop = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    followMessagesRef.current = false
    followScrollPreferenceRef.current = "auto"
    viewport.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const scrollConversationToBottom = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    followMessagesRef.current = true
    followScrollPreferenceRef.current = "bottom"
    streamingScrollModeRef.current = "bottom"
    lastRevealedToolBlockKeyRef.current = ""
    scrollViewportToBottom(viewport, "smooth")
  }, [])

  const jumpToPreviousMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = previousMessageJumpTarget(viewport)
    if (!target) return
    followMessagesRef.current = false
    followScrollPreferenceRef.current = "auto"
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
    followScrollPreferenceRef.current = "auto"
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
        followScrollPreferenceRef.current = "auto"
      } else if (isViewportNearBottom(viewport)) {
        followMessagesRef.current = true
      }

      rememberViewportLayout(viewport)
      syncViewportState(viewport)
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        followMessagesRef.current = false
        followScrollPreferenceRef.current = "auto"
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (findOpeningToolAccordionTrigger(event.target, viewport)) {
        followMessagesRef.current = false
        followScrollPreferenceRef.current = "auto"
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const openingToolAccordionTrigger = findOpeningToolAccordionTrigger(
        event.target,
        viewport
      )
      if (openingToolAccordionTrigger && isToolAccordionToggleKey(event)) {
        followMessagesRef.current = false
        followScrollPreferenceRef.current = "auto"
        return
      }

      if (isScrollUpKey(event)) {
        followMessagesRef.current = false
        followScrollPreferenceRef.current = "auto"
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

  const syncAfterConversationChange = React.useCallback(() => {
    if (isSessionViewLoading) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    scrollViewportIfFollowing(viewport)
  }, [isSessionViewLoading, scrollViewportIfFollowing])

  React.useLayoutEffect(() => {
    const wasStreaming = previousStreamingRef.current
    if (!wasStreaming && sessionState.streaming) {
      followScrollPreferenceRef.current = "auto"
      streamingScrollModeRef.current = "bottom"
      lastRevealedToolBlockKeyRef.current = ""
    }
    previousStreamingRef.current = sessionState.streaming

    syncAfterConversationChange()
  }, [sessionState.streaming, syncAfterConversationChange])

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
        scrollViewportIfFollowing(viewport)
      })
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(content)
    resizeObserver.observe(viewport)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [scrollViewportIfFollowing])

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
    followMessagesRef.current = true
    followScrollPreferenceRef.current = "auto"
    streamingScrollModeRef.current = "bottom"
    lastRevealedToolBlockKeyRef.current = ""
    previousStreamingRef.current = sessionState.streaming
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
    syncAfterConversationChange,
  }
}
