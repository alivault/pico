import { useTheme } from "next-themes"
import {
  RegisteredCustomThemes,
  createCSSVariablesTheme,
  registerCustomTheme,
  type ThemesType,
  type ThemeTypes,
} from "@pierre/diffs"

import {
  SMITH_DIFF_SHIKI_THEMES,
  SMITH_SHIKI_VARIABLE_DEFAULTS,
  appliedThemeClassColorMode,
  type ResolvedThemeMode,
} from "@/lib/smith"

const SMITH_DIFF_THEME_PAIR = {
  light: SMITH_DIFF_SHIKI_THEMES.light,
  dark: SMITH_DIFF_SHIKI_THEMES.dark,
} satisfies ThemesType

const SMITH_DIFF_COLOR_CSS = `
:host {
  --diffs-addition-color-override: var(--success);
  --diffs-deletion-color-override: var(--danger);
  --diffs-modified-color-override: var(--primary);
  --diffs-bg-addition-emphasis-override: color-mix(in lab, var(--diffs-bg) 42%, var(--diffs-addition-base));
  --diffs-bg-deletion-emphasis-override: color-mix(in lab, var(--diffs-bg) 42%, var(--diffs-deletion-base));
}

[data-overflow="wrap"] [data-annotation-content] {
  inline-size: var(--diffs-column-content-width, auto);
  max-inline-size: min(100%, calc(100vw - 1rem));
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

type SmithDiffThemeOptions = {
  theme: ThemesType
  themeType: Exclude<ThemeTypes, "system">
  unsafeCSS: string
}

function registerSmithDiffTheme(name: string, type: ResolvedThemeMode) {
  if (RegisteredCustomThemes.has(name)) return

  const theme = createCSSVariablesTheme({
    name,
    variablePrefix: "--diffs-",
    variableDefaults: { ...SMITH_SHIKI_VARIABLE_DEFAULTS },
    fontStyle: false,
  })

  registerCustomTheme(name, () => Promise.resolve({ ...theme, type }))
}

function ensureSmithDiffThemes() {
  registerSmithDiffTheme(SMITH_DIFF_SHIKI_THEMES.light, "light")
  registerSmithDiffTheme(SMITH_DIFF_SHIKI_THEMES.dark, "dark")
}

function resolveSmithDiffThemeType({
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

ensureSmithDiffThemes()

export function useSmithDiffThemeOptions(): SmithDiffThemeOptions {
  const { resolvedTheme, systemTheme, theme } = useTheme()

  return {
    theme: SMITH_DIFF_THEME_PAIR,
    themeType: resolveSmithDiffThemeType({ resolvedTheme, systemTheme, theme }),
    unsafeCSS: SMITH_DIFF_COLOR_CSS,
  }
}
