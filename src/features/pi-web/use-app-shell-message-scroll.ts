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
  isSessionViewLoading: boolean
  sessionState: ScrollSessionState
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
  if (currentIndex <= 0) return null
  return anchors[currentIndex - 1]
}

function nextMessageJumpTarget(viewport: HTMLDivElement) {
  const anchors = messageAnchors(viewport)
  const currentIndex = currentMessageAnchorIndex(anchors, viewport)
  if (currentIndex < 0 || currentIndex >= anchors.length - 1) return null
  return anchors[currentIndex + 1]
}

function syncViewportState(options: {
  viewport: HTMLDivElement
  setIsMessagesNearTop: React.Dispatch<React.SetStateAction<boolean>>
  setIsMessagesNearBottom: React.Dispatch<React.SetStateAction<boolean>>
  setHasPreviousMessageJumpTarget: React.Dispatch<React.SetStateAction<boolean>>
  setHasNextMessageJumpTarget: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const {
    viewport,
    setHasNextMessageJumpTarget,
    setHasPreviousMessageJumpTarget,
    setIsMessagesNearBottom,
    setIsMessagesNearTop,
  } = options

  setIsMessagesNearTop(isViewportNearTop(viewport))
  setIsMessagesNearBottom(isViewportNearBottom(viewport))
  setHasPreviousMessageJumpTarget(Boolean(previousMessageJumpTarget(viewport)))
  setHasNextMessageJumpTarget(Boolean(nextMessageJumpTarget(viewport)))
}

export function useAppShellMessageScroll({
  isSessionViewLoading,
  sessionState,
}: UseAppShellMessageScrollOptions) {
  const messagesScrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const messageViewportRef = React.useRef<HTMLDivElement | null>(null)
  const lastLoadedSessionScrollKeyRef = React.useRef("")
  const [isMessagesNearTop, setIsMessagesNearTop] = React.useState(true)
  const [isMessagesNearBottom, setIsMessagesNearBottom] = React.useState(true)
  const [hasPreviousMessageJumpTarget, setHasPreviousMessageJumpTarget] =
    React.useState(false)
  const [hasNextMessageJumpTarget, setHasNextMessageJumpTarget] =
    React.useState(false)

  const scrollConversationToTop = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const scrollConversationToBottom = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
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
      syncViewportState({
        viewport,
        setHasNextMessageJumpTarget,
        setHasPreviousMessageJumpTarget,
        setIsMessagesNearBottom,
        setIsMessagesNearTop,
      })
    }

    handleScroll()
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", handleScroll)
    }
  }, [])

  React.useEffect(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    if (!isMessagesNearBottom && !sessionState.streaming) return

    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [isMessagesNearBottom, sessionState.streaming])

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
    syncViewportState({
      viewport,
      setHasNextMessageJumpTarget,
      setHasPreviousMessageJumpTarget,
      setIsMessagesNearBottom,
      setIsMessagesNearTop,
    })
  }, [isSessionViewLoading, sessionState])

  return {
    bottomRef,
    hasNextMessageJumpTarget,
    hasPreviousMessageJumpTarget,
    isMessagesNearBottom,
    isMessagesNearTop,
    jumpToNextMessage,
    jumpToPreviousMessage,
    messagesScrollAreaRef,
    scrollConversationToBottom,
    scrollConversationToTop,
  }
}
