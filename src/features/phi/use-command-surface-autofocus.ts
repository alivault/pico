import * as React from "react"

type InteractionModality = "keyboard" | "pointer" | "unknown"

let lastInteractionModality: InteractionModality = "unknown"
let interactionModalityListenersAttached = false

function hasKeyboardFriendlyPointer() {
  if (typeof window === "undefined" || !window.matchMedia) return false

  return (
    window.matchMedia("(pointer: fine)").matches ||
    window.matchMedia("(any-pointer: fine)").matches ||
    window.matchMedia("(hover: hover)").matches ||
    window.matchMedia("(any-hover: hover)").matches
  )
}

function attachInteractionModalityListeners() {
  if (typeof window === "undefined" || interactionModalityListenersAttached) {
    return
  }

  interactionModalityListenersAttached = true

  window.addEventListener(
    "keydown",
    () => {
      lastInteractionModality = "keyboard"
    },
    true
  )
  window.addEventListener(
    "pointerdown",
    () => {
      lastInteractionModality = "pointer"
    },
    true
  )
}

export function useCommandSurfaceAutoFocus(isMobile: boolean) {
  React.useEffect(() => {
    attachInteractionModalityListeners()
  }, [])

  if (!isMobile) return true
  if (lastInteractionModality === "keyboard") return true

  return hasKeyboardFriendlyPointer()
}
