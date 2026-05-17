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

export function usePicoTheme() {
  const { setTheme, systemTheme } = useTheme()
  const initialThemeRef = React.useRef<ThemeFamily | undefined>(undefined)
  const initialTheme = initialThemeRef.current ?? readStoredTheme()
  initialThemeRef.current = initialTheme
  const [themeFamily, setThemeFamilyState] =
    React.useState<ThemeFamily>(initialTheme)
  const [colorMode, setColorModeState] = React.useState<ThemeColorMode>(
    () => themeFamilyFixedMode(initialTheme) ?? readStoredThemeColorMode()
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

  const previewThemeFamily = (
    value: ThemeFamily,
    nextColorMode?: ThemeColorMode
  ) => {
    const nextTheme = normalizeThemeFamily(value)
    const fixedMode = themeFamilyFixedMode(nextTheme)
    setThemeFamilyState(nextTheme)

    if (nextColorMode || fixedMode) {
      setColorModeState(normalizeThemeColorMode(nextColorMode ?? fixedMode))
    }
  }

  const setThemeFamily = (value: ThemeFamily) => {
    const nextTheme = normalizeThemeFamily(value)
    const fixedMode = themeFamilyFixedMode(nextTheme)
    setThemeFamilyState(nextTheme)
    safeLocalStorageSetItem(THEME_STORAGE_KEY, nextTheme)

    if (fixedMode) {
      setColorModeState(fixedMode)
      safeLocalStorageSetItem(THEME_COLOR_MODE_STORAGE_KEY, fixedMode)
    }
  }

  const setColorMode = (value: ThemeColorMode) => {
    const nextMode = normalizeThemeColorMode(value)
    setColorModeState(nextMode)
    safeLocalStorageSetItem(THEME_COLOR_MODE_STORAGE_KEY, nextMode)
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
