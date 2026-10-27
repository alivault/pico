/**
 * Provider sign-in and API keys, on Pi's own credential store (`auth.json`),
 * and provider quota for the usage indicator. Login flows ask the browser for
 * input through UI requests.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  readStoredCredential,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent"

import type { EventHub } from "../events.ts"
import { badRequest, notFound } from "../http.ts"

const UI_TIMEOUT_MS = 10 * 60 * 1000

const API_KEY_PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  "amazon-bedrock": "Amazon Bedrock",
  "azure-openai-responses": "Azure OpenAI Responses",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI",
  groq: "Groq",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi For Coding",
  mistral: "Mistral",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax (China)",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
  zai: "ZAI",
}

export type UiResponse = {
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

/** Requests the browser answers with `/api/ui/:id`. */
export class UiRequests {
  readonly #hub: EventHub
  readonly #pending = new Map<
    string,
    { resolve: (response: UiResponse) => void; timeout: NodeJS.Timeout }
  >()

  constructor(hub: EventHub) {
    this.#hub = hub
  }

  has(id: string) {
    return this.#pending.has(id)
  }

  request(
    contextId: string | undefined,
    payload: Record<string, unknown>,
    waitForResponse = true,
    id: string = crypto.randomUUID()
  ) {
    this.#hub.push(
      { type: "extension_ui_request", id, ...payload },
      contextId ? { contextId } : {}
    )
    if (!waitForResponse) return Promise.resolve<UiResponse>({})
    return new Promise<UiResponse>((resolve) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        resolve({ cancelled: true })
      }, UI_TIMEOUT_MS)
      timeout.unref()
      this.#pending.set(id, { resolve, timeout })
    })
  }

  respond(id: string, response: UiResponse) {
    const pending = this.#pending.get(id)
    if (!pending) throw notFound(`Unknown UI request id: ${id}`)
    this.#pending.delete(id)
    clearTimeout(pending.timeout)
    pending.resolve(response)
  }

  /** Cancels a request and closes its dialog in the browser. */
  dismiss(contextId: string | undefined, id: string) {
    const pending = this.#pending.get(id)
    if (pending) {
      this.#pending.delete(id)
      clearTimeout(pending.timeout)
      pending.resolve({ cancelled: true })
    }
    this.#hub.push(
      { type: "extension_ui_dismiss", id },
      contextId ? { contextId } : {}
    )
  }

  cancelAll() {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timeout)
      pending.resolve({ cancelled: true })
      this.#pending.delete(id)
    }
  }
}

type UsageWindow = { label: string; usedPercent: number; resetsIn?: string }

export class Auth {
  readonly #models: ModelRuntime
  readonly #ui: UiRequests
  readonly #authPath: string
  readonly #activeLogins = new Map<string, AbortController>()

  constructor(models: ModelRuntime, ui: UiRequests, agentDir: string) {
    this.#models = models
    this.#ui = ui
    this.#authPath = join(agentDir, "auth.json")
  }

  availableModels() {
    return this.#models.getAvailableSnapshot().map((model) => ({
      id: model.id,
      provider: model.provider,
      name: model.name,
      reasoning: model.reasoning,
    }))
  }

  #status(provider: string) {
    const status = this.#models.getProviderAuthStatus(provider)
    return {
      configured: status.configured,
      ...(status.source ? { source: status.source } : {}),
      ...(status.label ? { label: status.label } : {}),
    }
  }

  async providers() {
    await this.#models.refresh({ allowNetwork: false })
    const providers = this.#models.getProviders()
    const oauthProviders = providers
      .filter((provider) => provider.auth.oauth)
      .map((provider) => ({
        id: provider.id,
        name: provider.auth.oauth?.name ?? provider.name,
        authType: "oauth" as const,
        ...this.#status(provider.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    const apiKeyProviders = providers
      .filter((provider) => provider.auth.apiKey)
      .map((provider) => ({
        id: provider.id,
        name:
          provider.auth.apiKey?.name ??
          API_KEY_PROVIDER_NAMES[provider.id] ??
          provider.id,
        authType: "api_key" as const,
        ...this.#status(provider.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    const names = new Map(
      [...oauthProviders, ...apiKeyProviders].map((provider) => [
        provider.id,
        provider.name,
      ])
    )
    const loggedInProviders = (await this.#models.listCredentials())
      .map((credential) => ({
        id: credential.providerId,
        name:
          names.get(credential.providerId) ??
          API_KEY_PROVIDER_NAMES[credential.providerId] ??
          credential.providerId,
        authType:
          credential.type === "oauth"
            ? ("oauth" as const)
            : ("api_key" as const),
        ...this.#status(credential.providerId),
        configured: true,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return {
      ok: true,
      oauthProviders,
      apiKeyProviders,
      loggedInProviders,
      availableModels: this.availableModels(),
    }
  }

  async setApiKey(provider: string, key: string) {
    if (!provider) throw badRequest("Provider and API key are required")
    if (!key) throw badRequest("Provider and API key are required")
    await this.#models.login(provider, "api_key", {
      prompt: async (prompt) => {
        if (prompt.type !== "select") return key
        return (
          prompt.options.find((option) =>
            /api.?key|bearer.?token/i.test(option.id)
          )?.id ??
          prompt.options[0]?.id ??
          key
        )
      },
      notify: () => {},
    })
    return { ok: true, provider, availableModels: this.availableModels() }
  }

  async logout(provider: string) {
    if (!provider) throw badRequest("Provider is required")
    await this.#models.logout(provider)
    return { ok: true, provider, availableModels: this.availableModels() }
  }

  async login(provider: string, contextId: string | undefined) {
    if (!provider) throw badRequest("Provider is required")
    const oauth = this.#models.getProvider(provider)?.auth.oauth
    if (!oauth) throw badRequest(`Unknown OAuth provider: ${provider}`)
    const existing = this.#activeLogins.get(provider)
    if (existing) {
      existing.abort()
      throw badRequest(
        `Cancelled the existing ${oauth.name} login. Try login again.`
      )
    }
    const abort = new AbortController()
    this.#activeLogins.set(provider, abort)
    const title = `Log in to ${oauth.name}`
    // The login can end while its dialogs are still open, for example when
    // the provider redirects back to the callback server. Close them then.
    const requestIds: string[] = []
    const ask = (payload: Record<string, unknown>, waitForResponse = true) => {
      const id = crypto.randomUUID()
      if (waitForResponse) requestIds.push(id)
      return this.#ui.request(contextId, payload, waitForResponse, id)
    }
    // One toast for the login: each progress message replaces the last, and
    // the browser replaces the last one with the result.
    const toastId = `auth:${provider}`
    let manualInput: Promise<UiResponse> | undefined
    try {
      await this.#models.login(provider, "oauth", {
        signal: abort.signal,
        prompt: async (prompt) => {
          const request =
            prompt.type === "manual_code" && manualInput
              ? manualInput
              : ask({
                  method:
                    prompt.type === "select" ? "auth_select" : "auth_input",
                  title,
                  message: prompt.message,
                  ...(prompt.type === "select"
                    ? {
                        options: prompt.options.map((option) => ({
                          value: option.id,
                          label: option.label,
                        })),
                      }
                    : { placeholder: prompt.placeholder }),
                })
          const response = await request
          if (response.cancelled || typeof response.value !== "string")
            throw new Error("Login cancelled")
          return response.value
        },
        notify: (event) => {
          if (event.type === "auth_url") {
            manualInput = ask({
              method: "auth",
              title,
              message:
                event.instructions ??
                "Open the login page in your browser to continue.",
              authUrl: event.url,
              authManualAllowed: true,
            })
            void manualInput.then((response) => {
              if (response.cancelled) abort.abort()
            })
            return
          }
          if (event.type === "device_code") {
            void ask({
              method: "auth",
              title,
              message: `Enter code ${event.userCode} to continue.`,
              authUrl: event.verificationUri,
              authManualAllowed: false,
            }).then((response) => {
              if (response.cancelled) abort.abort()
            })
            return
          }
          const link = event.type === "info" ? event.links?.[0] : undefined
          void ask(
            {
              method: "notify",
              message: event.message,
              notifyType: "info",
              toastId,
              ...(link ? { authUrl: link.url } : {}),
            },
            false
          )
        },
      })
      return { ok: true, provider, availableModels: this.availableModels() }
    } finally {
      this.#activeLogins.delete(provider)
      for (const id of requestIds) this.#ui.dismiss(contextId, id)
    }
  }

  async #oauthToken(provider: string) {
    const credential = readStoredCredential(provider, this.#authPath)
    if (credential?.type !== "oauth") return undefined
    await this.#models.getAuth(provider).catch(() => undefined)
    const refreshed = readStoredCredential(provider, this.#authPath)
    return refreshed?.type === "oauth" ? refreshed : credential
  }

  async #claudeToken() {
    const stored = await this.#oauthToken("anthropic")
    if (stored?.access) return stored.access
    if (process.platform !== "darwin") return undefined
    const keychain = spawnSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      {
        encoding: "utf8",
      }
    )
    if (keychain.status !== 0 || !keychain.stdout.trim()) return undefined
    try {
      const value = JSON.parse(keychain.stdout) as {
        claudeAiOauth?: { accessToken?: unknown }
      }
      return typeof value.claudeAiOauth?.accessToken === "string"
        ? value.claudeAiOauth.accessToken
        : undefined
    } catch {
      return undefined
    }
  }

  async #codexCredential(): Promise<
    { token: string; accountId?: string } | undefined
  > {
    const stored = await this.#oauthToken("openai-codex")
    if (stored?.access) {
      const accountId = (stored as { accountId?: unknown }).accountId
      return {
        token: stored.access,
        ...(typeof accountId === "string" ? { accountId } : {}),
      }
    }
    const path = join(
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      "auth.json"
    )
    if (!existsSync(path)) return undefined
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        OPENAI_API_KEY?: string
        tokens?: { access_token?: string; account_id?: string }
      }
      if (value.OPENAI_API_KEY) return { token: String(value.OPENAI_API_KEY) }
      if (value.tokens?.access_token) {
        return {
          token: String(value.tokens.access_token),
          ...(value.tokens.account_id
            ? { accountId: String(value.tokens.account_id) }
            : {}),
        }
      }
    } catch {
      // Ignore malformed external credential files.
    }
    return undefined
  }

  async providerUsage(provider: string | undefined) {
    const windows: UsageWindow[] = []
    if (provider === "anthropic") {
      const token = await this.#claudeToken()
      if (!token) return { ok: true, windows }
      const response = await fetch(
        "https://api.anthropic.com/api/oauth/usage",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
          },
          signal: AbortSignal.timeout(5000),
        }
      ).catch(() => undefined)
      if (!response?.ok) return { ok: true, windows }
      const value = (await response.json()) as Record<
        string,
        { utilization?: number; resets_at?: string }
      >
      for (const [key, label] of [
        ["five_hour", "5h"],
        ["seven_day", "Week"],
      ] as const) {
        const usage = value[key]
        if (typeof usage?.utilization !== "number") continue
        windows.push({
          label,
          usedPercent: normalizePercent(usage.utilization),
          ...(usage.resets_at
            ? { resetsIn: formatResetTime(usage.resets_at) }
            : {}),
        })
      }
    } else if (provider === "openai-codex") {
      const credential = await this.#codexCredential()
      if (!credential) return { ok: true, windows }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential.token}`,
        "User-Agent": "pico",
        Accept: "application/json",
      }
      if (credential.accountId)
        headers["ChatGPT-Account-Id"] = credential.accountId
      const response = await fetch(
        "https://chatgpt.com/backend-api/wham/usage",
        {
          headers,
          signal: AbortSignal.timeout(5000),
        }
      ).catch(() => undefined)
      if (!response?.ok) return { ok: true, windows }
      const value = (await response.json()) as {
        rate_limit?: {
          primary_window?: CodexWindow
          secondary_window?: CodexWindow
        }
      }
      for (const [window, fallback] of [
        [value.rate_limit?.primary_window, "5h"],
        [value.rate_limit?.secondary_window, "Week"],
      ] as const) {
        if (!window) continue
        windows.push({
          label: usageWindowLabel(window.limit_window_seconds, fallback),
          usedPercent: clampPercent(window.used_percent ?? 0),
          ...(window.reset_at
            ? { resetsIn: formatResetTime(window.reset_at) }
            : {}),
        })
      }
    }
    return { ok: true, windows }
  }

  cancelLogins() {
    for (const login of this.#activeLogins.values()) login.abort()
  }
}

type CodexWindow = {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

function normalizePercent(value: number) {
  return clampPercent(value >= 0 && value <= 1 ? value * 100 : value)
}

function formatResetTime(value: string | number) {
  const date = new Date(typeof value === "number" ? value * 1000 : value)
  const difference = date.getTime() - Date.now()
  if (!Number.isFinite(difference) || difference < 0) return "now"
  const minutes = Math.floor(difference / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24)
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
}

function usageWindowLabel(seconds: number | undefined, fallback: string) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return fallback
  const hours = Math.round(seconds / 3600)
  if (Math.abs(hours - 168) <= 2 || fallback === "Week") return "Week"
  if (Math.abs(hours - 5) <= 2 || fallback === "5h") return fallback
  return hours >= 1 && hours < 48 ? `${hours}h` : fallback
}
