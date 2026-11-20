import * as React from "react"
import { useTheme } from "next-themes"

import {
  APPLIED_THEME_STORAGE_KEY,
  THEME_COLOR_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  appliedThemeClass,
  appliedThemeClassColorMode,
  normalizeThemeColorMode,
  normalizeThemeFamily,
  readStoredTheme,
  readStoredThemeColorMode,
  safeLocalStorageSetItem,
  themeFamilyFixedMode,
  type ThemeColorMode,
  type ThemeFamily,
} from "@/lib/pico"

type ThemeState = { themeFamily: ThemeFamily; colorMode: ThemeColorMode }

/**
 * The theme is window state: one store for the page, not one for each
 * machine's app shell. A shell that shows again after a machine switch
 * reads the same value, so it cannot put back an old theme. A change in
 * another tab comes in with the `storage` event.
 */
let themeSnapshot: ThemeState | undefined
const themeListeners = new Set<() => void>()

function readThemeState(): ThemeState {
  const themeFamily = readStoredTheme()
  return {
    themeFamily,
    colorMode: themeFamilyFixedMode(themeFamily) ?? readStoredThemeColorMode(),
  }
}

function getThemeSnapshot() {
  themeSnapshot ??= readThemeState()
  return themeSnapshot
}

function setThemeState(next: Partial<ThemeState>) {
  const current = getThemeSnapshot()
  const merged = { ...current, ...next }
  if (
    merged.themeFamily === current.themeFamily &&
    merged.colorMode === current.colorMode
  ) {
    return
  }
  themeSnapshot = merged
  for (const listener of themeListeners) listener()
}

function onStorage(event: StorageEvent) {
  if (
    event.key !== THEME_STORAGE_KEY &&
    event.key !== THEME_COLOR_MODE_STORAGE_KEY
  ) {
    return
  }
  setThemeState(readThemeState())
}

function subscribeTheme(listener: () => void) {
  if (themeListeners.size === 0) window.addEventListener("storage", onStorage)
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size === 0) {
      window.removeEventListener("storage", onStorage)
    }
  }
}

export function usePicoTheme() {
  const { setTheme, systemTheme } = useTheme()
  const { themeFamily, colorMode } = React.useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeSnapshot
  )
  const appliedTheme = appliedThemeClass(themeFamily, colorMode, systemTheme)

  React.useEffect(() => {
    setTheme(appliedTheme)
    safeLocalStorageSetItem(APPLIED_THEME_STORAGE_KEY, appliedTheme)

    const appliedThemeMode = appliedThemeClassColorMode(appliedTheme)
    if (appliedThemeMode) {
      document.documentElement.dataset.picoThemeMode = appliedThemeMode
    }
  }, [appliedTheme, setTheme])

  /** Shows a theme without saving it, for example while a picker is open. */
  const previewThemeFamily = (
    value: ThemeFamily,
    nextColorMode?: ThemeColorMode
  ) => {
    const nextTheme = normalizeThemeFamily(value)
    const fixedMode = themeFamilyFixedMode(nextTheme)
    setThemeState({
      themeFamily: nextTheme,
      ...(nextColorMode || fixedMode
        ? { colorMode: normalizeThemeColorMode(nextColorMode ?? fixedMode) }
        : {}),
    })
  }

  const setThemeFamily = (value: ThemeFamily) => {
    const nextTheme = normalizeThemeFamily(value)
    const fixedMode = themeFamilyFixedMode(nextTheme)
    safeLocalStorageSetItem(THEME_STORAGE_KEY, nextTheme)
    if (fixedMode) {
      safeLocalStorageSetItem(THEME_COLOR_MODE_STORAGE_KEY, fixedMode)
    }
    setThemeState({
      themeFamily: nextTheme,
      ...(fixedMode ? { colorMode: fixedMode } : {}),
    })
  }

  const setColorMode = (value: ThemeColorMode) => {
    const nextMode = normalizeThemeColorMode(value)
    safeLocalStorageSetItem(THEME_COLOR_MODE_STORAGE_KEY, nextMode)
    setThemeState({ colorMode: nextMode })
  }

  return {
    appliedTheme,
    colorMode,
    previewThemeFamily,
    setColorMode,
    setThemeFamily,
    systemTheme,
    themeFamily,
  }
}
