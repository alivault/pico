import * as React from "react"

import { cn } from "@/lib/utils"

const DEFAULT_SCROLL_GRADIENT_MAX_HEIGHT = 4
const EMPTY_SCROLL_GRADIENT_STATE = {
  bottomHeight: 0,
  topHeight: 0,
} satisfies ScrollGradientState

type ScrollGradientState = {
  bottomHeight: number
  topHeight: number
}

type UseScrollGradientsOptions = {
  disabled?: boolean
  maxHeight?: number
}

type ScrollGradientOverlaysProps = ScrollGradientState & {
  bottomClassName?: string
  className?: string
  topClassName?: string
}

function scrollDistanceFromBottom(element: HTMLElement) {
  return Math.max(
    0,
    element.scrollHeight - element.scrollTop - element.clientHeight
  )
}

function scrollGradientHeight(distanceFromEdge: number, maxHeight: number) {
  return Math.min(maxHeight, Math.max(0, distanceFromEdge))
}

function scrollGradientState(
  element: HTMLElement | null,
  maxHeight: number
): ScrollGradientState {
  if (!element) return EMPTY_SCROLL_GRADIENT_STATE

  return {
    bottomHeight: scrollGradientHeight(
      scrollDistanceFromBottom(element),
      maxHeight
    ),
    topHeight: scrollGradientHeight(element.scrollTop, maxHeight),
  }
}

function setScrollGradientState(
  setState: React.Dispatch<React.SetStateAction<ScrollGradientState>>,
  nextState: ScrollGradientState
) {
  setState((currentState) =>
    currentState.bottomHeight === nextState.bottomHeight &&
    currentState.topHeight === nextState.topHeight
      ? currentState
      : nextState
  )
}

export function useScrollGradients<TElement extends HTMLElement = HTMLElement>({
  disabled = false,
  maxHeight = DEFAULT_SCROLL_GRADIENT_MAX_HEIGHT,
}: UseScrollGradientsOptions = {}) {
  const elementRef = React.useRef<TElement | null>(null)
  const [state, setState] = React.useState<ScrollGradientState>(
    EMPTY_SCROLL_GRADIENT_STATE
  )

  const syncScrollGradients = React.useCallback(
    (element: TElement | null = elementRef.current) => {
      setScrollGradientState(
        setState,
        disabled
          ? EMPTY_SCROLL_GRADIENT_STATE
          : scrollGradientState(element, maxHeight)
      )
    },
    [disabled, maxHeight]
  )

  const setScrollElement = React.useCallback(
    (element: TElement | null) => {
      elementRef.current = element
      syncScrollGradients(element)
    },
    [syncScrollGradients]
  )

  const onScroll = React.useCallback(
    (event: React.UIEvent<TElement>) => {
      syncScrollGradients(event.currentTarget)
    },
    [syncScrollGradients]
  )

  React.useLayoutEffect(() => {
    const element = elementRef.current
    syncScrollGradients(element)

    if (!element || typeof ResizeObserver === "undefined") return

    let animationFrame = 0
    const scheduleSync = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        syncScrollGradients(elementRef.current)
      })
    }

    const resizeObserver = new ResizeObserver(scheduleSync)
    resizeObserver.observe(element)
    const content = element.firstElementChild
    if (content instanceof HTMLElement) {
      resizeObserver.observe(content)
    }

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [syncScrollGradients])

  return {
    bottomHeight: state.bottomHeight,
    onScroll,
    setScrollElement,
    syncScrollGradients,
    topHeight: state.topHeight,
  }
}

export function ScrollGradientOverlays({
  bottomClassName,
  bottomHeight,
  className,
  topClassName,
  topHeight,
}: ScrollGradientOverlaysProps) {
  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/10 to-transparent transition-[height,opacity] duration-150",
          topHeight > 0 ? "opacity-100" : "opacity-0",
          className,
          topClassName
        )}
        style={{ height: topHeight }}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/10 to-transparent transition-[height,opacity] duration-150",
          bottomHeight > 0 ? "opacity-100" : "opacity-0",
          className,
          bottomClassName
        )}
        style={{ height: bottomHeight }}
      />
    </>
  )
}
