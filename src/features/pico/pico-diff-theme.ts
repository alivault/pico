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

const PICO_DIFF_COLOR_CSS = `
:host {
  --diffs-addition-color-override: var(--success);
  --diffs-deletion-color-override: var(--danger);
  --diffs-modified-color-override: var(--primary);
  --diffs-bg-addition-emphasis-override: color-mix(in lab, var(--diffs-bg) 42%, var(--diffs-addition-base));
  --diffs-bg-deletion-emphasis-override: color-mix(in lab, var(--diffs-bg) 42%, var(--diffs-deletion-base));
}

@media (max-width: 640px) {
  [data-annotation-content] {
    inline-size: min(100%, calc(100vw - var(--diffs-column-number-width, 0px) - 1rem));
  }
}

[data-line-type="change-addition"]:is(
  [data-gutter-buffer],
  [data-column-number],
  [data-line],
  [data-no-newline]
) {
  --mix-light: 84%;
  --mix-dark: 76%;
}

[data-line-type="change-deletion"]:is(
  [data-gutter-buffer],
  [data-column-number],
  [data-line],
  [data-no-newline]
) {
  --mix-light: 84%;
  --mix-dark: 76%;
}
`

type PicoDiffThemeOptions = {
  theme: ThemesType
  themeType: Exclude<ThemeTypes, "system">
  unsafeCSS: string
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
    unsafeCSS: PICO_DIFF_COLOR_CSS,
  }
}
