import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ProviderUsageWindow = {
  label: string
  usedPercent: number
  resetsIn?: string
}

export type ProviderUsageSnapshot = {
  windows: Array<ProviderUsageWindow>
}

const PROVIDER_MAP: Record<string, string> = {
  anthropic: "claude",
  "openai-codex": "codex",
}

function loadAuthJson(): Record<string, any> {
  const authPath = join(homedir(), ".pi", "agent", "auth.json")
  try {
    if (existsSync(authPath)) {
      return JSON.parse(readFileSync(authPath, "utf-8"))
    }
  } catch {}
  return {}
}

function getClaudeToken() {
  const auth = loadAuthJson()
  if (auth.anthropic?.access) return String(auth.anthropic.access)

  try {
    const keychainData = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim()
    if (keychainData) {
      const parsed = JSON.parse(keychainData)
      if (parsed.claudeAiOauth?.accessToken) {
        return String(parsed.claudeAiOauth.accessToken)
      }
    }
  } catch {}

  return undefined
}

function getCodexToken(): { token: string; accountId?: string } | undefined {
  const auth = loadAuthJson()
  if (auth["openai-codex"]?.access) {
    return {
      token: String(auth["openai-codex"].access),
      accountId: auth["openai-codex"]?.accountId
        ? String(auth["openai-codex"].accountId)
        : undefined,
    }
  }

  const codexPath = join(
    process.env.CODEX_HOME || join(homedir(), ".codex"),
    "auth.json"
  )
  try {
    if (existsSync(codexPath)) {
      const data = JSON.parse(readFileSync(codexPath, "utf-8"))
      if (data.OPENAI_API_KEY) return { token: String(data.OPENAI_API_KEY) }
      if (data.tokens?.access_token) {
        return {
          token: String(data.tokens.access_token),
          accountId: data.tokens.account_id
            ? String(data.tokens.account_id)
            : undefined,
        }
      }
    }
  } catch {}

  return undefined
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function normalizePercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return clampPercent(value <= 1 && value >= 0 ? value * 100 : value)
}

function formatResetTime(date: Date) {
  const diffMs = date.getTime() - Date.now()
  if (diffMs < 0) return "now"

  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 60) return `${diffMins}m`

  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

function getWindowLabel(durationMs: number | undefined, fallback: string) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return fallback
  }

  const hourMs = 60 * 60 * 1000
  const weekMs = 7 * 24 * hourMs
  const isCloseToWeek = Math.abs(durationMs - weekMs) <= hourMs * 2
  const isCloseTo5h = Math.abs(durationMs - 5 * hourMs) <= hourMs * 2

  if (isCloseToWeek || fallback === "Week") return "Week"
  if (isCloseTo5h || fallback === "5h") return fallback

  const hours = Math.round(durationMs / hourMs)
  if (hours >= 1 && hours < 48) return `${hours}h`

  return fallback
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchClaudeUsage(): Promise<ProviderUsageSnapshot> {
  const token = getClaudeToken()
  if (!token) return { windows: [] }

  try {
    const res = await fetchWithTimeout(
      "https://api.anthropic.com/api/oauth/usage",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      }
    )
    if (!res.ok) return { windows: [] }

    const data = (await res.json()) as any
    const windows: Array<ProviderUsageWindow> = []
    if (data.five_hour?.utilization !== undefined) {
      windows.push({
        label: "5h",
        usedPercent: normalizePercent(data.five_hour.utilization),
        resetsIn: data.five_hour.resets_at
          ? formatResetTime(new Date(data.five_hour.resets_at))
          : undefined,
      })
    }
    if (data.seven_day?.utilization !== undefined) {
      windows.push({
        label: "Week",
        usedPercent: normalizePercent(data.seven_day.utilization),
        resetsIn: data.seven_day.resets_at
          ? formatResetTime(new Date(data.seven_day.resets_at))
          : undefined,
      })
    }
    return { windows }
  } catch {
    return { windows: [] }
  }
}

async function fetchCodexUsage(): Promise<ProviderUsageSnapshot> {
  const creds = getCodexToken()
  if (!creds) return { windows: [] }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.token}`,
      "User-Agent": "phi",
      Accept: "application/json",
    }
    if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId

    const res = await fetchWithTimeout(
      "https://chatgpt.com/backend-api/wham/usage",
      { headers }
    )
    if (!res.ok) return { windows: [] }

    const data = (await res.json()) as any
    const windows: Array<ProviderUsageWindow> = []
    const primary = data.rate_limit?.primary_window
    if (primary) {
      windows.push({
        label: getWindowLabel(
          typeof primary.limit_window_seconds === "number"
            ? primary.limit_window_seconds * 1000
            : undefined,
          "5h"
        ),
        usedPercent: clampPercent(primary.used_percent || 0),
        resetsIn: primary.reset_at
          ? formatResetTime(new Date(primary.reset_at * 1000))
          : undefined,
      })
    }
    const secondary = data.rate_limit?.secondary_window
    if (secondary) {
      windows.push({
        label: getWindowLabel(
          typeof secondary.limit_window_seconds === "number"
            ? secondary.limit_window_seconds * 1000
            : undefined,
          "Week"
        ),
        usedPercent: clampPercent(secondary.used_percent || 0),
        resetsIn: secondary.reset_at
          ? formatResetTime(new Date(secondary.reset_at * 1000))
          : undefined,
      })
    }
    return { windows }
  } catch {
    return { windows: [] }
  }
}

export async function fetchProviderUsage(
  modelProvider: string | undefined
): Promise<ProviderUsageSnapshot> {
  const provider = modelProvider ? PROVIDER_MAP[modelProvider] : undefined
  switch (provider) {
    case "claude":
      return fetchClaudeUsage()
    case "codex":
      return fetchCodexUsage()
    default:
      return { windows: [] }
  }
}
