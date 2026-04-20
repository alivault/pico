const FLOATING_ROOT_ID = "floating-ui-root"
const openFloatingControllers = new Set()
let floatingListenersBound = false
let floatingFrame = 0

export const FLOATING_PLACEMENTS = Object.freeze({
  BOTTOM_START: "bottom-start",
  BOTTOM_END: "bottom-end",
  TOP_START: "top-start",
  TOP_END: "top-end",
})

export function createFloatingPlacement({
  side = "bottom",
  align = "start",
} = {}) {
  const normalizedSide = side === "top" ? "top" : "bottom"
  const normalizedAlign = align === "end" || align === "right" ? "end" : "start"
  return `${normalizedSide}-${normalizedAlign}`
}

function ensureFloatingRoot() {
  let root = document.getElementById(FLOATING_ROOT_ID)
  if (root) return root

  root = document.createElement("div")
  root.id = FLOATING_ROOT_ID
  root.className = "floating-ui-root"
  document.body.appendChild(root)
  return root
}

function normalizePlacement(value = FLOATING_PLACEMENTS.BOTTOM_START) {
  const parts = String(value)
    .trim()
    .toLowerCase()
    .split(/[-\s]+/)
    .filter(Boolean)
  const side = parts[0] === "top" ? "top" : "bottom"
  const align = parts[1] === "end" || parts[1] === "right" ? "end" : "start"
  return { side, align, value: createFloatingPlacement({ side, align }) }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function oppositeSide(side) {
  return side === "top" ? "bottom" : "top"
}

function oppositeAlign(align) {
  return align === "end" ? "start" : "end"
}

function sideSpace(side, anchorRect, viewportHeight, padding) {
  return side === "top"
    ? anchorRect.top - padding
    : viewportHeight - anchorRect.bottom - padding
}

function alignSpace(align, anchorRect, viewportWidth, padding) {
  return align === "end"
    ? anchorRect.right - padding
    : viewportWidth - anchorRect.left - padding
}

function resolveSide(
  preferredSide,
  anchorRect,
  floatingRect,
  viewportHeight,
  padding
) {
  const preferredSpace = sideSpace(
    preferredSide,
    anchorRect,
    viewportHeight,
    padding
  )
  const alternateSide = oppositeSide(preferredSide)
  const alternateSpace = sideSpace(
    alternateSide,
    anchorRect,
    viewportHeight,
    padding
  )

  if (floatingRect.height <= preferredSpace) return preferredSide
  if (floatingRect.height <= alternateSpace) return alternateSide
  return preferredSpace >= alternateSpace ? preferredSide : alternateSide
}

function resolveAlign(
  preferredAlign,
  anchorRect,
  floatingRect,
  viewportWidth,
  padding
) {
  const preferredSpace = alignSpace(
    preferredAlign,
    anchorRect,
    viewportWidth,
    padding
  )
  const alternateAlign = oppositeAlign(preferredAlign)
  const alternateSpace = alignSpace(
    alternateAlign,
    anchorRect,
    viewportWidth,
    padding
  )

  if (floatingRect.width <= preferredSpace) return preferredAlign
  if (floatingRect.width <= alternateSpace) return alternateAlign
  return preferredSpace >= alternateSpace ? preferredAlign : alternateAlign
}

function resolveFloatingPosition({
  anchorRect,
  floatingRect,
  placement,
  offset,
  padding,
}) {
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0
  const preferred = normalizePlacement(placement)
  const side = resolveSide(
    preferred.side,
    anchorRect,
    floatingRect,
    viewportHeight,
    padding
  )
  const align = resolveAlign(
    preferred.align,
    anchorRect,
    floatingRect,
    viewportWidth,
    padding
  )

  const unclampedTop =
    side === "top"
      ? anchorRect.top - floatingRect.height - offset
      : anchorRect.bottom + offset
  const unclampedLeft =
    align === "end" ? anchorRect.right - floatingRect.width : anchorRect.left

  const maxTop = Math.max(
    padding,
    viewportHeight - padding - floatingRect.height
  )
  const maxLeft = Math.max(
    padding,
    viewportWidth - padding - floatingRect.width
  )

  return {
    top: clamp(unclampedTop, padding, maxTop),
    left: clamp(unclampedLeft, padding, maxLeft),
    placement: `${side}-${align}`,
  }
}

function queueFloatingReposition() {
  if (floatingFrame) return
  floatingFrame = window.requestAnimationFrame(() => {
    floatingFrame = 0
    for (const controller of openFloatingControllers) {
      controller.reposition()
    }
  })
}

function isFloatingPortalScrollTarget(target) {
  const root = document.getElementById(FLOATING_ROOT_ID)
  return target instanceof Node && Boolean(root?.contains(target))
}

function handleFloatingScroll(event) {
  if (isFloatingPortalScrollTarget(event.target)) return
  queueFloatingReposition()
}

function bindFloatingListeners() {
  if (floatingListenersBound) return
  floatingListenersBound = true
  window.addEventListener("resize", queueFloatingReposition)
  window.addEventListener("scroll", handleFloatingScroll, true)
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", queueFloatingReposition)
    window.visualViewport.addEventListener("scroll", queueFloatingReposition)
  }
}

function clearFloatingStyles(element) {
  if (!element) return
  element.classList.remove("floating-portal-item")
  element.style.removeProperty("position")
  element.style.removeProperty("left")
  element.style.removeProperty("top")
  element.style.removeProperty("right")
  element.style.removeProperty("bottom")
  element.style.removeProperty("margin")
  element.style.removeProperty("visibility")
  element.style.removeProperty("min-width")
  element.style.removeProperty("max-width")
  element.style.removeProperty("pointer-events")
  delete element.dataset.floatingPlacement
}

export function createFloatingPortal(
  element,
  {
    defaultPlacement = FLOATING_PLACEMENTS.BOTTOM_START,
    offset = 8,
    padding = 12,
    matchTriggerWidth = false,
  } = {}
) {
  if (!element) {
    return {
      contains() {
        return false
      },
      destroy() {},
      hide() {},
      isOpen() {
        return false
      },
      reposition() {},
      show() {},
    }
  }

  const originalParent = element.parentNode || null
  const originalNextSibling = element.nextSibling || null
  let currentAnchor = null
  let currentOptions = null
  let open = false

  function mountToRoot() {
    const root = ensureFloatingRoot()
    if (element.parentNode !== root) {
      root.appendChild(element)
    }
  }

  function restoreToOrigin() {
    if (!originalParent) {
      element.remove()
      return
    }
    if (element.parentNode === originalParent) return
    originalParent.insertBefore(
      element,
      originalNextSibling?.parentNode === originalParent
        ? originalNextSibling
        : null
    )
  }

  function measureAndPosition(options = currentOptions || {}) {
    if (!open) return
    if (!currentAnchor?.isConnected) {
      controller.hide()
      return
    }

    const anchorRect = currentAnchor.getBoundingClientRect()
    if (anchorRect.width === 0 && anchorRect.height === 0) {
      controller.hide()
      return
    }

    mountToRoot()
    element.classList.add("floating-portal-item")
    element.style.position = "fixed"
    element.style.left = "0px"
    element.style.top = "0px"
    element.style.right = "auto"
    element.style.bottom = "auto"
    element.style.margin = "0"
    element.style.visibility = "hidden"
    element.style.pointerEvents = "auto"
    if (matchTriggerWidth || options.matchTriggerWidth) {
      element.style.minWidth = `${Math.round(anchorRect.width)}px`
    } else {
      element.style.removeProperty("min-width")
    }

    const floatingRect = element.getBoundingClientRect()
    const position = resolveFloatingPosition({
      anchorRect,
      floatingRect,
      placement: options.placement || defaultPlacement,
      offset: options.offset ?? offset,
      padding: options.padding ?? padding,
    })

    element.dataset.floatingPlacement = position.placement
    element.style.left = `${Math.round(position.left)}px`
    element.style.top = `${Math.round(position.top)}px`
    element.style.visibility = "visible"
  }

  const controller = {
    contains(target) {
      return target instanceof Node && element.contains(target)
    },
    destroy() {
      controller.hide()
    },
    hide() {
      if (!open) {
        clearFloatingStyles(element)
        restoreToOrigin()
        return
      }
      open = false
      currentAnchor = null
      currentOptions = null
      openFloatingControllers.delete(controller)
      clearFloatingStyles(element)
      restoreToOrigin()
    },
    isOpen() {
      return open
    },
    reposition() {
      measureAndPosition()
    },
    show(anchor, options = {}) {
      if (!(anchor instanceof Element)) return
      bindFloatingListeners()
      open = true
      currentAnchor = anchor
      currentOptions = options
      openFloatingControllers.add(controller)
      measureAndPosition(options)
    },
  }

  return controller
}
