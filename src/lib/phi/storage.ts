import type {
  PromptDraftTarget,
  ResolvedThemeMode,
  SessionEntryIdentity,
  ThemeMode,
} from "@/lib/phi"

export const THEME_STORAGE_KEY = "phi-theme"
export const DRAFT_DIRECTORY_STORAGE_KEY = "phi-draft-directory"
export const SIDEBAR_DIRECTORIES_STORAGE_KEY = "phi-sidebar-directories"
export const COLLAPSED_DIRECTORIES_STORAGE_KEY = "phi-collapsed-directories"
export const RECENT_DIRECTORIES_STORAGE_KEY = "phi-recent-directories"
export const RECENT_DIRECTORIES_LIMIT = 8
export const SESSION_DONE_SOUND_ENABLED_STORAGE_KEY = "phi-session-done-sound"
export const SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "phi-session-done-desktop-notifications"
export const HIDE_TOOL_BLOCKS_STORAGE_KEY = "phi-hide-tools"
export const CENTER_MESSAGES_STORAGE_KEY = "phi-center-messages"
export const PROMPT_DRAFTS_STORAGE_KEY = "phi-prompt-drafts"
export const VIEWER_CONTEXT_STORAGE_KEY = "phi-context-id"

export function createContextId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `ctx-${crypto.randomUUID()}`
  }

  return `ctx-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

export function safeLocalStorageGetItem(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalStorageSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeSessionStorageGetItem(key: string) {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionStorageSetItem(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function normalizeStoredDirectoryList(value: unknown) {
  if (!Array.isArray(value)) return []

  const nextDirectories: Array<string> = []
  const seen = new Set<string>()

  for (const entry of value) {
    const normalized = typeof entry === "string" ? entry.trim() : ""
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    nextDirectories.push(normalized)
  }

  return nextDirectories
}

export function sessionListEntryKey(sessionLike: SessionEntryIdentity = {}) {
  if (sessionLike.path) return `path:${sessionLike.path}`
  if (sessionLike.id) return `id:${sessionLike.id}`
  return ""
}

export function normalizeSessionSelectionKeys(value: unknown) {
  if (!Array.isArray(value)) return []

  const keys: Array<string> = []
  const seen = new Set<string>()

  for (const entry of value) {
    const key = typeof entry === "string" ? entry.trim() : ""
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }

  return keys
}

export function promptDraftKey(target: PromptDraftTarget = {}) {
  if (target.sessionId) return `session:${target.sessionId}`
  if (target.sessionFile) return `file:${target.sessionFile}`
  return `draft:${target.cwd?.trim() || "default"}`
}

export function loadStoredPromptDrafts() {
  try {
    const raw = safeSessionStorageGetItem(PROMPT_DRAFTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readStoredPromptDraft(target: PromptDraftTarget = {}) {
  const drafts = loadStoredPromptDrafts()
  const key = promptDraftKey(target)
  const value = drafts[key]
  return typeof value === "string" ? value : undefined
}

export function rememberStoredPromptDraft(
  target: PromptDraftTarget = {},
  text = ""
) {
  const key = promptDraftKey(target)
  const drafts = loadStoredPromptDrafts()
  const nextValue = typeof text === "string" ? text : ""

  if (nextValue) {
    drafts[key] = nextValue
  } else {
    delete drafts[key]
  }

  return safeSessionStorageSetItem(
    PROMPT_DRAFTS_STORAGE_KEY,
    JSON.stringify(drafts)
  )
}

export function readStoredSidebarDirectories() {
  try {
    const raw = safeLocalStorageGetItem(SIDEBAR_DIRECTORIES_STORAGE_KEY)
    if (raw == null) {
      return { directories: [], hasStoredValue: false }
    }

    return {
      directories: normalizeStoredDirectoryList(JSON.parse(raw)),
      hasStoredValue: true,
    }
  } catch {
    return { directories: [], hasStoredValue: false }
  }
}

export function readStoredCollapsedDirectories() {
  try {
    const raw = safeLocalStorageGetItem(COLLAPSED_DIRECTORIES_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key.trim(), Boolean(value)])
        .filter(([key]) => Boolean(key))
    ) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function readStoredDraftDirectory() {
  return (safeLocalStorageGetItem(DRAFT_DIRECTORY_STORAGE_KEY) ?? "").trim()
}

export function readStoredRecentDirectories() {
  try {
    const raw = safeLocalStorageGetItem(RECENT_DIRECTORIES_STORAGE_KEY)
    if (!raw) return []
    return normalizeStoredDirectoryList(JSON.parse(raw))
  } catch {
    return []
  }
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system"
}

export function resolvedThemeMode(
  theme: ThemeMode,
  systemTheme?: string
): ResolvedThemeMode {
  if (theme === "system") {
    return systemTheme === "light" ? "light" : "dark"
  }

  return theme
}

export function themeModeLabel(theme: ThemeMode, systemTheme?: string) {
  if (theme === "system") {
    return `System (${resolvedThemeMode(theme, systemTheme) === "light" ? "Light mode" : "Dark mode"})`
  }

  return theme === "light" ? "Light mode" : "Dark mode"
}

export function readStoredTheme() {
  return normalizeThemeMode(
    (safeLocalStorageGetItem(THEME_STORAGE_KEY) ?? "system").trim()
  )
}

export function readStoredHideToolBlocks() {
  return safeLocalStorageGetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY) === "1"
}

export function readStoredCenterMessages() {
  return safeLocalStorageGetItem(CENTER_MESSAGES_STORAGE_KEY) === "1"
}

export function readStoredSessionDoneSoundEnabled() {
  const value = safeLocalStorageGetItem(SESSION_DONE_SOUND_ENABLED_STORAGE_KEY)
  return value == null ? true : value !== "0"
}

export function readStoredSessionDoneDesktopNotificationsEnabled() {
  const value = safeLocalStorageGetItem(
    SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY
  )
  return value == null ? true : value !== "0"
}
