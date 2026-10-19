import * as React from "react"

// The app shell has three columns: the left sidebar, the center column (the
// conversation), and the right sidebar. This module divides the window width
// between them.
//
// - Each sidebar keeps the width that the user chose. When the columns do not
//   fit, the sidebars become narrower, but never narrower than their minimum.
//   The chosen widths stay stored, so the sidebars grow again when there is
//   room.
// - When the minimums of both sidebars and the center column do not fit, the
//   sidebar with less priority hides. The sidebar that the user opened or
//   resized last has priority.
// - When the left sidebar and the center column do not fit side by side, the
//   app uses the compact (mobile) layout.

export const SHELL_LEFT_MIN_WIDTH = 240
export const SHELL_CENTER_MIN_WIDTH = 440
export const SHELL_RIGHT_MIN_WIDTH = 240

// Below this window width, the app uses the compact layout. Tailwind uses the
// same value for the `md` breakpoint (`--breakpoint-md: 42.5rem` in
// styles.css). The compact check uses the same media query, so the `md:`
// classes and this module always agree. Keep the two values the same.
export const SHELL_COMPACT_MAX_WIDTH =
  SHELL_LEFT_MIN_WIDTH + SHELL_CENTER_MIN_WIDTH
const SHELL_COMPACT_MEDIA_QUERY = `(width < ${SHELL_COMPACT_MAX_WIDTH / 16}rem)`

export type ShellSide = "left" | "right"

export type ShellLayoutInput = {
  compact: boolean
  viewportWidth: number
  leftOpen: boolean
  leftWidth: number
  rightOpen: boolean
  rightWidth: number
  rightMinWidth: number
  priority: ShellSide
}

export type ShellLayout = {
  compact: boolean
  leftShown: boolean
  leftWidth: number
  leftMaxWidth: number
  rightShown: boolean
  rightWidth: number
  rightMaxWidth: number
}

function clamp(value: number, min: number, max: number) {
  if (max <= min) return Math.max(0, max)
  return Math.min(max, Math.max(min, value))
}

export function solveShellLayout(input: ShellLayoutInput): ShellLayout {
  const compact = input.compact
  // The width that the sidebars can use together.
  const space = Math.max(0, input.viewportWidth - SHELL_CENTER_MIN_WIDTH)
  const leftMin = Math.min(SHELL_LEFT_MIN_WIDTH, space)
  const rightMin = Math.min(input.rightMinWidth, space)
  const layout: ShellLayout = {
    compact,
    leftShown: false,
    leftWidth: input.leftWidth,
    leftMaxWidth: space,
    rightShown: false,
    rightWidth: input.rightWidth,
    rightMaxWidth: space,
  }
  if (compact) return layout

  let leftShown = input.leftOpen
  let rightShown = input.rightOpen
  if (leftShown && rightShown && leftMin + rightMin > space) {
    // The minimums do not fit. Hide the sidebar with less priority.
    if (input.priority === "left") rightShown = false
    else leftShown = false
  }

  if (leftShown && rightShown) {
    const priorityPreferred =
      input.priority === "left" ? input.leftWidth : input.rightWidth
    const otherPreferred =
      input.priority === "left" ? input.rightWidth : input.leftWidth
    const otherMin = input.priority === "left" ? rightMin : leftMin
    const deficit = Math.max(0, priorityPreferred + otherPreferred - space)
    // The sidebar with less priority becomes narrower first.
    const otherWidth = Math.max(otherMin, otherPreferred - deficit)
    const priorityWidth = Math.min(priorityPreferred, space - otherWidth)
    const leftWidth = input.priority === "left" ? priorityWidth : otherWidth
    const rightWidth = input.priority === "left" ? otherWidth : priorityWidth
    return {
      ...layout,
      leftShown,
      leftWidth: Math.round(leftWidth),
      leftMaxWidth: Math.max(leftMin, space - rightWidth),
      rightShown,
      rightWidth: Math.round(rightWidth),
      rightMaxWidth: Math.max(rightMin, space - leftWidth),
    }
  }

  return {
    ...layout,
    leftShown,
    leftWidth: leftShown
      ? Math.round(clamp(input.leftWidth, leftMin, space))
      : input.leftWidth,
    rightShown,
    rightWidth: rightShown
      ? Math.round(clamp(input.rightWidth, rightMin, space))
      : input.rightWidth,
  }
}

function sameShellLayout(left: ShellLayout, right: ShellLayout) {
  return (
    left.compact === right.compact &&
    left.leftShown === right.leftShown &&
    left.leftWidth === right.leftWidth &&
    left.leftMaxWidth === right.leftMaxWidth &&
    left.rightShown === right.rightShown &&
    left.rightWidth === right.rightWidth &&
    left.rightMaxWidth === right.rightMaxWidth
  )
}

function readViewportWidth() {
  return typeof window === "undefined" ? 1200 : window.innerWidth
}

const compactMediaQuery =
  typeof window === "undefined"
    ? null
    : window.matchMedia(SHELL_COMPACT_MEDIA_QUERY)

let shellLayoutInput: ShellLayoutInput = {
  compact: compactMediaQuery?.matches ?? false,
  viewportWidth: readViewportWidth(),
  leftOpen: true,
  leftWidth: 320,
  rightOpen: false,
  rightWidth: 320,
  rightMinWidth: SHELL_RIGHT_MIN_WIDTH,
  priority: "left",
}
let shellLayout = solveShellLayout(shellLayoutInput)
const shellLayoutListeners = new Set<() => void>()

export function getShellLayout() {
  return shellLayout
}

export function updateShellLayout(patch: Partial<ShellLayoutInput>) {
  let changed = false
  for (const key of Object.keys(patch) as Array<keyof ShellLayoutInput>) {
    if (patch[key] !== undefined && patch[key] !== shellLayoutInput[key]) {
      changed = true
      break
    }
  }
  if (!changed) return

  shellLayoutInput = { ...shellLayoutInput, ...patch }
  const nextLayout = solveShellLayout(shellLayoutInput)
  if (sameShellLayout(shellLayout, nextLayout)) return

  shellLayout = nextLayout
  for (const listener of shellLayoutListeners) listener()
}

// Give a sidebar priority, for example when the user opens or resizes it. If
// both sidebars do not fit, the other sidebar hides.
export function focusShellSide(side: ShellSide) {
  updateShellLayout({ priority: side })
}

function updateShellViewport() {
  updateShellLayout({
    compact: compactMediaQuery?.matches ?? false,
    viewportWidth: readViewportWidth(),
  })
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", updateShellViewport)
  compactMediaQuery?.addEventListener("change", updateShellViewport)
}

function subscribeShellLayout(listener: () => void) {
  shellLayoutListeners.add(listener)
  return () => {
    shellLayoutListeners.delete(listener)
  }
}

export function useShellLayout<T>(selector: (layout: ShellLayout) => T): T {
  return React.useSyncExternalStore(
    subscribeShellLayout,
    () => selector(shellLayout),
    () => selector(shellLayout)
  )
}
