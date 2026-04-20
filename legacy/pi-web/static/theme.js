import {
  THEME_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "./state.js"

const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]'

function syncThemeColorToBackground() {
  if (typeof document === "undefined") return
  const themeColorMeta = document.querySelector(THEME_COLOR_META_SELECTOR)
  if (!themeColorMeta) return
  const backgroundColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim()
  if (!backgroundColor) return
  themeColorMeta.setAttribute("content", backgroundColor)
}

export function normalizeThemePreference(value) {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system"
}

export function readStoredThemePreference() {
  return normalizeThemePreference(safeLocalStorageGetItem(THEME_STORAGE_KEY))
}

export function resolvedThemeMode(theme, systemThemeMedia) {
  const normalizedTheme = normalizeThemePreference(theme)
  if (normalizedTheme === "system") {
    return systemThemeMedia?.matches ? "light" : "dark"
  }
  return normalizedTheme
}

export function themeModeLabel(theme, systemThemeMedia) {
  const normalizedTheme = normalizeThemePreference(theme)
  if (normalizedTheme === "system") {
    return `System (${resolvedThemeMode(normalizedTheme, systemThemeMedia) === "light" ? "Light mode" : "Dark mode"})`
  }
  return normalizedTheme === "light" ? "Light mode" : "Dark mode"
}

export function applyTheme(
  state,
  theme,
  { systemThemeMedia, persist = true, onAfterApply } = {}
) {
  const nextTheme = normalizeThemePreference(theme)
  const resolvedTheme = resolvedThemeMode(nextTheme, systemThemeMedia)
  state.theme = nextTheme
  document.documentElement.dataset.theme = resolvedTheme
  syncThemeColorToBackground()

  if (persist) {
    safeLocalStorageSetItem(THEME_STORAGE_KEY, nextTheme)
  }

  onAfterApply?.(nextTheme)
}
