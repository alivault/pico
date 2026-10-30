import {
  detectPlatform,
  formatForDisplay,
  matchesKeyboardEvent,
  type Hotkey,
} from "@tanstack/react-hotkeys"

export const isMacPlatform = detectPlatform() === "mac"

// The modifier for Pico shortcuts. On macOS, Control is free because the
// browser uses Command. On Windows and Linux, the browser uses Control, so
// Pico uses Alt.
export const appModifier = isMacPlatform ? "Control" : "Alt"

export const appModifierFlag = isMacPlatform
  ? ({ ctrl: true } as const)
  : ({ alt: true } as const)

// Pull uses Alt+P on macOS. On Windows and Linux, Alt+P is Push, so Pull
// uses Alt+L.
export const pullShortcut = isMacPlatform ? "Alt+P" : "Alt+L"

// Keys that open a right sidebar pane, with the app modifier and Shift.
export const rightSidebarPaneShortcutKeys = {
  files: "F",
  review: "G",
  history: "H",
  agent: "A",
} as const

export type RightSidebarShortcutPane = keyof typeof rightSidebarPaneShortcutKeys

export function rightSidebarPaneShortcut(pane: RightSidebarShortcutPane) {
  return appShortcut(`Shift+${rightSidebarPaneShortcutKeys[pane]}`)
}

export function appShortcut(keys: string) {
  return `${appModifier}+${keys}`
}

export function formatShortcutLabel(hotkey: string) {
  return formatForDisplay(hotkey, { useSymbols: true })
}

export function matchesShortcutEvent(event: KeyboardEvent, hotkey: string) {
  return matchesKeyboardEvent(event, hotkey as Hotkey)
}
