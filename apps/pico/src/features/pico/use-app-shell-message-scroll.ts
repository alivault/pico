import * as React from "react"

import { useMessageScroller } from "@/components/ui/message-scroller"

// Scroll behavior comes from the shadcn MessageScroller primitive. This module
// adds the Pico extras on top of it: jumps to the previous or next user message and extra
// "the reader is busy here" signals that stop follow-output.

export type MessageJumpStateSnapshot = {
  hasPreviousMessageJumpTarget: boolean
  hasNextMessageJumpTarget: boolean
}

export type MessageJumpStateStore = {
  getSnapshot: () => MessageJumpStateSnapshot
  subscribe: (listener: () => void) => () => void
}

const JUMP_OFFSET_PX = 8

function createMessageJumpStateStore() {
  let snapshot: MessageJumpStateSnapshot = {
    hasPreviousMessageJumpTarget: false,
    hasNextMessageJumpTarget: false,
  }
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot: MessageJumpStateSnapshot) => {
      if (
        snapshot.hasPreviousMessageJumpTarget ===
          nextSnapshot.hasPreviousMessageJumpTarget &&
        snapshot.hasNextMessageJumpTarget ===
          nextSnapshot.hasNextMessageJumpTarget
      ) {
        return
      }
      snapshot = nextSnapshot
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useMessageJumpValue<T>(
  store: MessageJumpStateStore,
  selector: (snapshot: MessageJumpStateSnapshot) => T
) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot())
  )
}

function anchorScrollTop(anchor: HTMLElement, viewport: HTMLElement) {
  return (
    anchor.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top +
    viewport.scrollTop
  )
}

function messageAnchorTops(viewport: HTMLElement) {
  return [
    ...viewport.querySelectorAll<HTMLElement>(
      "[data-user-message-anchor='true']"
    ),
  ].map((anchor) => anchorScrollTop(anchor, viewport))
}

function previousMessageJumpTop(viewport: HTMLElement) {
  const viewportTop = viewport.scrollTop + JUMP_OFFSET_PX - 1
  let target: number | null = null
  for (const top of messageAnchorTops(viewport)) {
    if (top >= viewportTop) break
    target = top
  }
  return target
}

function nextMessageJumpTop(viewport: HTMLElement) {
  const viewportTop = viewport.scrollTop + JUMP_OFFSET_PX + 1
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
  if (viewport.scrollTop >= maxScrollTop - 1) return null
  for (const top of messageAnchorTops(viewport)) {
    if (top > viewportTop) return top
  }
  return null
}

// The primitive stops follow-output on wheel, touch, and scroll keys. A
// synthetic wheel event reuses that path for other reader signals.
function releaseFollowOutput(viewport: HTMLElement) {
  viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true }))
}

function isOpeningToolCollapsibleTrigger(
  target: EventTarget | null,
  viewport: HTMLElement
) {
  if (!(target instanceof Element)) return false
  const trigger = target.closest<HTMLElement>(
    "[data-conversation-tool-collapsible-trigger='true']"
  )
  if (!trigger || !viewport.contains(trigger)) return false
  return trigger.getAttribute("aria-expanded") !== "true"
}

export function useAppShellMessageScroll() {
  const { scrollToEnd, scrollToStart } = useMessageScroller()
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null)
  const jumpStateStoreRef = React.useRef(createMessageJumpStateStore())

  React.useEffect(() => {
    if (!viewport) return
    const jumpStateStore = jumpStateStoreRef.current

    let frame = 0
    const syncJumpState = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        if (!viewport.isConnected) return
        jumpStateStore.setSnapshot({
          hasPreviousMessageJumpTarget:
            previousMessageJumpTop(viewport) !== null,
          hasNextMessageJumpTarget: nextMessageJumpTop(viewport) !== null,
        })
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (isOpeningToolCollapsibleTrigger(event.target, viewport)) {
        releaseFollowOutput(viewport)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        isOpeningToolCollapsibleTrigger(event.target, viewport)
      ) {
        releaseFollowOutput(viewport)
      }
    }

    const handleSelectionChange = () => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed) return
      if (viewport.contains(selection.anchorNode)) {
        releaseFollowOutput(viewport)
      }
    }

    syncJumpState()
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncJumpState)
    resizeObserver?.observe(viewport)
    if (viewport.firstElementChild) {
      resizeObserver?.observe(viewport.firstElementChild)
    }
    viewport.addEventListener("scroll", syncJumpState, { passive: true })
    viewport.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    })
    viewport.addEventListener("keydown", handleKeyDown, { capture: true })
    document.addEventListener("selectionchange", handleSelectionChange)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      viewport.removeEventListener("scroll", syncJumpState)
      viewport.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      })
      viewport.removeEventListener("keydown", handleKeyDown, { capture: true })
      document.removeEventListener("selectionchange", handleSelectionChange)
    }
  }, [viewport])

  const jumpTo = React.useCallback(
    (getTop: (viewport: HTMLElement) => number | null) => {
      if (!viewport) return
      const top = getTop(viewport)
      if (top === null) return
      releaseFollowOutput(viewport)
      viewport.scrollTo({
        top: Math.max(0, top - JUMP_OFFSET_PX),
        behavior: "auto",
      })
    },
    [viewport]
  )

  const jumpToPreviousMessage = React.useCallback(
    () => jumpTo(previousMessageJumpTop),
    [jumpTo]
  )
  const jumpToNextMessage = React.useCallback(
    () => jumpTo(nextMessageJumpTop),
    [jumpTo]
  )
  const scrollConversationToBottom = React.useCallback(() => {
    scrollToEnd({ behavior: "auto" })
  }, [scrollToEnd])
  const scrollConversationToTop = React.useCallback(() => {
    scrollToStart({ behavior: "auto" })
  }, [scrollToStart])

  return {
    jumpStateStore: jumpStateStoreRef.current as MessageJumpStateStore,
    jumpToNextMessage,
    jumpToPreviousMessage,
    scrollConversationToBottom,
    scrollConversationToTop,
    setViewport,
    viewport,
  }
}
