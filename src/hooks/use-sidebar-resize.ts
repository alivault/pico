import * as React from "react"

type SidebarResizeState = "expanded" | "collapsed"
type SidebarResizeSide = "left" | "right"

type SidebarResizeOptions = {
  enabled?: boolean
  expandThreshold?: number
  isMobile: boolean
  maxWidth: string
  minWidth: string
  state: SidebarResizeState
  width: string
  onOpenChange: (open: boolean) => void
  onResize: (width: string) => void
  onResizeActiveChange: (resizing: boolean) => void
}

type SidebarDragState = {
  collapsed: boolean
  latestWidth: string | null
  moved: boolean
  previewAnimationFrame: number | null
  previewElement: HTMLElement | null
  previousCursor: string
  previousUserSelect: string
  side: SidebarResizeSide
  startWidth: number
  startX: number
}

const SIDEBAR_RESIZE_START_THRESHOLD_PX = 4
const SIDEBAR_COLLAPSE_DISTANCE_RATIO = 0.5
const SIDEBAR_EXPAND_DISTANCE_RATIO = 0.2
const SIDEBAR_RESIZE_TARGET_MINIMUM_COARSE_PX = 20
const SIDEBAR_RESIZE_TARGET_MINIMUM_FINE_PX = 10
const DEFAULT_SIDEBAR_WIDTH_PX = 320
const DEFAULT_SIDEBAR_MIN_WIDTH_PX = 256
const DEFAULT_SIDEBAR_MAX_WIDTH_PX = 512

export type SidebarHorizontalResizeCursor = "ew-resize" | "col-resize"

export function getSidebarHorizontalResizeCursor(): SidebarHorizontalResizeCursor {
  if (typeof window === "undefined") return "col-resize"

  const userAgent = window.navigator.userAgent
  return userAgent.includes("Chrome") || userAgent.includes("Firefox")
    ? "ew-resize"
    : "col-resize"
}

export function getSidebarResizeTargetMinimumSize() {
  if (typeof window === "undefined") {
    return SIDEBAR_RESIZE_TARGET_MINIMUM_FINE_PX
  }

  return window.matchMedia("(pointer:coarse)").matches
    ? SIDEBAR_RESIZE_TARGET_MINIMUM_COARSE_PX
    : SIDEBAR_RESIZE_TARGET_MINIMUM_FINE_PX
}

function installGlobalResizeCursor(cursor: SidebarHorizontalResizeCursor) {
  const style = document.createElement("style")
  style.dataset.sidebarResizeCursor = "true"
  style.textContent = `*, *:hover { cursor: ${cursor} !important; }`
  document.head.append(style)

  return () => style.remove()
}

function parseCssLengthToPixels(value: string, fallback: number) {
  const trimmedValue = value.trim()
  const numericValue = Number.parseFloat(trimmedValue)

  if (!Number.isFinite(numericValue)) return fallback
  if (trimmedValue.endsWith("rem")) {
    const rootFontSize =
      typeof window === "undefined"
        ? 16
        : Number.parseFloat(
            window.getComputedStyle(document.documentElement).fontSize
          ) || 16
    return numericValue * rootFontSize
  }

  return numericValue
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getResizeSide(element: HTMLElement): SidebarResizeSide {
  const sidebar = element.closest<HTMLElement>("[data-slot='sidebar']")
  return sidebar?.dataset.side === "right" ? "right" : "left"
}

function getSidebarWrapper(element: HTMLElement) {
  return element.closest<HTMLElement>("[data-slot='sidebar-wrapper']")
}

function previewSidebarWidth(dragState: SidebarDragState, width: string) {
  dragState.latestWidth = width
  if (!dragState.previewElement) return
  if (dragState.previewAnimationFrame !== null) return

  dragState.previewAnimationFrame = window.requestAnimationFrame(() => {
    dragState.previewAnimationFrame = null
    if (!dragState.previewElement || !dragState.latestWidth) return

    dragState.previewElement.style.setProperty(
      "--sidebar-width",
      dragState.latestWidth
    )
  })
}

function cancelSidebarWidthPreview(dragState: SidebarDragState) {
  if (dragState.previewAnimationFrame === null) return

  window.cancelAnimationFrame(dragState.previewAnimationFrame)
  dragState.previewAnimationFrame = null
}

function calculateResizeWidth(dragState: SidebarDragState, clientX: number) {
  const delta = clientX - dragState.startX
  return dragState.side === "left"
    ? dragState.startWidth + delta
    : dragState.startWidth - delta
}

function isExpandingDrag(dragState: SidebarDragState, clientX: number) {
  return dragState.side === "left"
    ? clientX > dragState.startX
    : clientX < dragState.startX
}

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)
  ref.current = value
  return ref
}

export function useSidebarResize({
  enabled = true,
  expandThreshold = SIDEBAR_EXPAND_DISTANCE_RATIO,
  isMobile,
  maxWidth,
  minWidth,
  state,
  width,
  onOpenChange,
  onResize,
  onResizeActiveChange,
}: SidebarResizeOptions) {
  const optionsRef = useLatestRef({
    enabled,
    expandThreshold,
    isMobile,
    maxWidth,
    minWidth,
    state,
    width,
    onOpenChange,
    onResize,
    onResizeActiveChange,
  })
  const skipNextClickRef = React.useRef(false)
  const cleanupResizeRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    return () => cleanupResizeRef.current?.()
  }, [])

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (skipNextClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      skipNextClickRef.current = false
      return
    }

    const { onOpenChange, state } = optionsRef.current
    onOpenChange(state !== "expanded")
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const options = optionsRef.current
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      options.isMobile ||
      !options.enabled
    ) {
      return
    }

    const minWidthPx = parseCssLengthToPixels(
      options.minWidth,
      DEFAULT_SIDEBAR_MIN_WIDTH_PX
    )
    const maxWidthPx = parseCssLengthToPixels(
      options.maxWidth,
      DEFAULT_SIDEBAR_MAX_WIDTH_PX
    )
    const currentWidthPx = parseCssLengthToPixels(
      options.width,
      DEFAULT_SIDEBAR_WIDTH_PX
    )
    const dragState: SidebarDragState = {
      collapsed: options.state !== "expanded",
      latestWidth: null,
      moved: false,
      previewAnimationFrame: null,
      previewElement: getSidebarWrapper(event.currentTarget),
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
      side: getResizeSide(event.currentTarget),
      startWidth: options.state === "expanded" ? currentWidthPx : 0,
      startX: event.clientX,
    }

    cleanupResizeRef.current?.()

    let cleanupGlobalResizeCursor: (() => void) | null = null

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
      cleanupGlobalResizeCursor?.()
      cancelSidebarWidthPreview(dragState)
      document.body.style.cursor = dragState.previousCursor
      document.body.style.userSelect = dragState.previousUserSelect
      if (dragState.moved) optionsRef.current.onResizeActiveChange(false)
      cleanupResizeRef.current = null
    }

    const startDragging = () => {
      const cursor = getSidebarHorizontalResizeCursor()
      dragState.moved = true
      skipNextClickRef.current = true
      optionsRef.current.onResizeActiveChange(true)
      cleanupGlobalResizeCursor = installGlobalResizeCursor(cursor)
      document.body.style.cursor = cursor
      document.body.style.userSelect = "none"
    }

    const collapseSidebar = (clientX: number) => {
      const nextWidth = `${Math.round(minWidthPx)}px`
      previewSidebarWidth(dragState, nextWidth)
      optionsRef.current.onResize(nextWidth)
      optionsRef.current.onOpenChange(false)
      dragState.collapsed = true
      dragState.startWidth = 0
      dragState.startX = clientX
    }

    const expandSidebar = (clientX: number) => {
      const nextWidth = `${Math.round(minWidthPx)}px`
      previewSidebarWidth(dragState, nextWidth)
      optionsRef.current.onResize(nextWidth)
      optionsRef.current.onOpenChange(true)
      dragState.collapsed = false
      dragState.startWidth = minWidthPx
      dragState.startX = clientX
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const dragDistance = Math.abs(pointerEvent.clientX - dragState.startX)
      if (
        !dragState.moved &&
        dragDistance < SIDEBAR_RESIZE_START_THRESHOLD_PX
      ) {
        return
      }

      if (!dragState.moved) startDragging()
      pointerEvent.preventDefault()

      const attemptedWidth = calculateResizeWidth(
        dragState,
        pointerEvent.clientX
      )

      if (dragState.collapsed) {
        const expandDistance = minWidthPx * optionsRef.current.expandThreshold
        if (
          isExpandingDrag(dragState, pointerEvent.clientX) &&
          attemptedWidth >= expandDistance
        ) {
          expandSidebar(pointerEvent.clientX)
        }
        return
      }

      const collapseWidth = minWidthPx * SIDEBAR_COLLAPSE_DISTANCE_RATIO
      if (attemptedWidth <= collapseWidth) {
        collapseSidebar(pointerEvent.clientX)
        return
      }

      const nextWidth = clamp(attemptedWidth, minWidthPx, maxWidthPx)
      previewSidebarWidth(dragState, `${Math.round(nextWidth)}px`)
    }

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (dragState.moved) {
        pointerEvent.preventDefault()
        if (dragState.latestWidth) {
          optionsRef.current.onResize(dragState.latestWidth)
        }
        window.setTimeout(() => {
          skipNextClickRef.current = false
        }, 0)
      }
      cleanup()
    }

    cleanupResizeRef.current = cleanup
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)
  }

  return {
    handleClick,
    handlePointerDown,
  }
}
