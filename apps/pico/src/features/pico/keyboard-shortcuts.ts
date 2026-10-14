import {
  formatForDisplay,
  matchesKeyboardEvent,
  type Hotkey,
} from "@tanstack/react-hotkeys"

export function formatShortcutLabel(hotkey: string) {
  return formatForDisplay(hotkey, { useSymbols: true })
}

export function matchesShortcutEvent(event: KeyboardEvent, hotkey: string) {
  return matchesKeyboardEvent(event, hotkey as Hotkey)
}
