import { useTheme } from "next-themes"
import {
  RegisteredCustomThemes,
  createCSSVariablesTheme,
  registerCustomTheme,
  type ThemesType,
  type ThemeTypes,
} from "@pierre/diffs"

import {
  PICO_DIFF_SHIKI_THEMES,
  PICO_SHIKI_VARIABLE_DEFAULTS,
  appliedThemeClassColorMode,
  type ResolvedThemeMode,
} from "@/lib/pico"

const PICO_DIFF_THEME_PAIR = {
  light: PICO_DIFF_SHIKI_THEMES.light,
  dark: PICO_DIFF_SHIKI_THEMES.dark,
} satisfies ThemesType

type PicoDiffThemeOptions = {
  theme: ThemesType
  themeType: Exclude<ThemeTypes, "system">
}

function registerPicoDiffTheme(name: string, type: ResolvedThemeMode) {
  if (RegisteredCustomThemes.has(name)) return

  const theme = createCSSVariablesTheme({
    name,
    variablePrefix: "--diffs-",
    variableDefaults: { ...PICO_SHIKI_VARIABLE_DEFAULTS },
    fontStyle: false,
  })

  registerCustomTheme(name, () => Promise.resolve({ ...theme, type }))
}

function ensurePicoDiffThemes() {
  registerPicoDiffTheme(PICO_DIFF_SHIKI_THEMES.light, "light")
  registerPicoDiffTheme(PICO_DIFF_SHIKI_THEMES.dark, "dark")
}

function resolvePicoDiffThemeType({
  resolvedTheme,
  systemTheme,
  theme,
}: {
  resolvedTheme?: string
  systemTheme?: string
  theme?: string
}): ResolvedThemeMode {
  return (
    appliedThemeClassColorMode(theme) ??
    appliedThemeClassColorMode(resolvedTheme) ??
    (resolvedTheme === "dark" || systemTheme === "dark" ? "dark" : "light")
  )
}

ensurePicoDiffThemes()

export function usePicoDiffThemeOptions(): PicoDiffThemeOptions {
  const { resolvedTheme, systemTheme, theme } = useTheme()

  return {
    theme: PICO_DIFF_THEME_PAIR,
    themeType: resolvePicoDiffThemeType({ resolvedTheme, systemTheme, theme }),
  }
}
