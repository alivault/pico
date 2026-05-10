import * as React from "react"
import { useTheme } from "next-themes"

import {
  APPLIED_THEME_STORAGE_KEY,
  THEME_COLOR_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  appliedThemeClass,
  normalizeThemeColorMode,
  normalizeThemeFamily,
  readStoredTheme,
  readStoredThemeColorMode,
  safeLocalStorageSetItem,
  type AppliedThemeClass,
  type ThemeColorMode,
  type ThemeFamily,
} from "@/lib/pico"

export function usePicoTheme() {
  const { setTheme, systemTheme } = useTheme()
  const [themeFamily, setThemeFamilyState] = React.useState<ThemeFamily>(() =>
    readStoredTheme()
  )
  const [colorMode, setColorModeState] = React.useState<ThemeColorMode>(() =>
    readStoredThemeColorMode()
  )
  const appliedTheme = appliedThemeClass(
    themeFamily,
    colorMode,
    systemTheme
  ) as AppliedThemeClass

  React.useEffect(() => {
    setTheme(appliedTheme)
    safeLocalStorageSetItem(APPLIED_THEME_STORAGE_KEY, appliedTheme)
  }, [appliedTheme, setTheme])

  const setThemeFamily = (value: ThemeFamily) => {
    const nextTheme = normalizeThemeFamily(value)
    setThemeFamilyState(nextTheme)
    safeLocalStorageSetItem(THEME_STORAGE_KEY, nextTheme)
  }

  const setColorMode = (value: ThemeColorMode) => {
    const nextMode = normalizeThemeColorMode(value)
    setColorModeState(nextMode)
    safeLocalStorageSetItem(THEME_COLOR_MODE_STORAGE_KEY, nextMode)
  }

  return {
    appliedTheme,
    colorMode,
    setColorMode,
    setThemeFamily,
    systemTheme,
    themeFamily,
  }
}
