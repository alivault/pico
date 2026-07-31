import { spawnSync } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  AuthStorage,
  createAgentSessionServices,
  getAgentDir,
  type AgentSessionServices,
} from "@earendil-works/pi-coding-agent"

const MAX_LINE_BYTES = 1024 * 1024
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

const authStorage = AuthStorage.create(join(getAgentDir(), "auth.json"))
const servicesByCwd = new Map<string, Promise<AgentSessionServices>>()
const pendingUi = new Map<
  string,
  {
    resolve: (response: BridgeUiResponse) => void
    timeout: ReturnType<typeof setTimeout>
  }
>()
const activeLogins = new Map<string, AbortController>()

interface BridgeCommand {
  id?: string
  type?: string
  cwd?: string
  contextId?: string
  sessionId?: string
  provider?: string
  key?: string
}

interface BridgeUiResponse {
  type: "extension_ui_response"
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

interface UiScope {
  contextId?: string
  sessionId?: string
}

interface ProviderUsageWindow {
  label: string
  usedPercent: number
  resetsIn?: string
}

function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function success(command: BridgeCommand, data?: unknown) {
  output({
    id: command.id,
    type: "response",
    command: command.type,
    success: true,
    ...(data === undefined ? {} : { data }),
  })
}

function failure(command: BridgeCommand, error: unknown) {
  output({
    id: command.id,
    type: "response",
    command: command.type ?? "unknown",
    success: false,
    error: error instanceof Error ? error.message : String(error),
  })
}

async function services(cwd: string) {
  const resolvedCwd = cwd || process.cwd()
  let pending = servicesByCwd.get(resolvedCwd)
  if (!pending) {
    pending = createAgentSessionServices({
      cwd: resolvedCwd,
      agentDir: getAgentDir(),
      authStorage,
    })
    servicesByCwd.set(resolvedCwd, pending)
    pending.catch(() => servicesByCwd.delete(resolvedCwd))
  }
  return await pending
}

function providerDisplayName(provider: string) {
  return API_KEY_PROVIDER_NAMES[provider] ?? provider
}

function availableModels(runtime: AgentSessionServices) {
  return runtime.modelRegistry.getAvailable().map((model) => ({
    id: model.id,
    provider: model.provider,
    name: model.name,
    reasoning: model.reasoning,
  }))
}

function authStatus(runtime: AgentSessionServices, provider: string) {
  const status = runtime.modelRegistry.getProviderAuthStatus(provider)
  return {
    configured: status.configured,
    ...(status.source ? { source: status.source } : {}),
    ...(status.label ? { label: status.label } : {}),
  }
}

async function authProviders(cwd: string) {
  authStorage.reload()
  const runtime = await services(cwd)
  runtime.modelRegistry.refresh()
  const oauthProviders = authStorage.getOAuthProviders()
  const oauthIds = new Set(oauthProviders.map((provider) => provider.id))
  const providerIds = new Set(
    runtime.modelRegistry.getAll().map((model) => model.provider)
  )
  const oauthOptions = oauthProviders
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      authType: "oauth" as const,
      ...authStatus(runtime, provider.id),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const apiKeyOptions = [...providerIds]
    .filter(
      (provider) =>
        provider in API_KEY_PROVIDER_NAMES || !oauthIds.has(provider)
    )
    .map((provider) => ({
      id: provider,
      name: providerDisplayName(provider),
      authType: "api_key" as const,
      ...authStatus(runtime, provider),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const names = new Map(
    [...oauthOptions, ...apiKeyOptions].map((provider) => [
      provider.id,
      provider.name,
    ])
  )
  const authTypes = new Map(
    [...oauthOptions, ...apiKeyOptions].map((provider) => [
      provider.id,
      provider.authType,
    ])
  )
  const loggedInProviders = authStorage
    .list()
    .map((provider) => {
      const credential = authStorage.get(provider)
      return {
        id: provider,
        name: names.get(provider) ?? providerDisplayName(provider),
        authType:
          credential?.type ?? authTypes.get(provider) ?? ("api_key" as const),
        ...authStatus(runtime, provider),
        configured: true,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    ok: true,
    oauthProviders: oauthOptions,
    apiKeyProviders: apiKeyOptions,
    loggedInProviders,
    availableModels: availableModels(runtime),
  }
}

function emitUiRequest(
  scope: UiScope,
  payload: Record<string, unknown>,
  waitForResponse = true
) {
  const id = crypto.randomUUID()
  output({
    type: "extension_ui_request",
    id,
    ...payload,
    ...(scope.contextId ? { picoContextId: scope.contextId } : {}),
    ...(scope.sessionId ? { picoSessionId: scope.sessionId } : {}),
  })
  if (!waitForResponse)
    return Promise.resolve<BridgeUiResponse>({
      type: "extension_ui_response",
      id,
    })
  return new Promise<BridgeUiResponse>((resolve) => {
    const timeout = setTimeout(() => {
      pendingUi.delete(id)
      output({ type: "extension_ui_expired", id })
      resolve({ type: "extension_ui_response", id, cancelled: true })
    }, UI_TIMEOUT_MS)
    timeout.unref?.()
    pendingUi.set(id, { resolve, timeout })
  })
}

function resolveUiResponse(response: BridgeUiResponse) {
  const pending = pendingUi.get(response.id)
  if (!pending) return
  pendingUi.delete(response.id)
  clearTimeout(pending.timeout)
  pending.resolve(response)
}

function cancelPendingUi() {
  for (const [id, pending] of pendingUi) {
    clearTimeout(pending.timeout)
    pending.resolve({ type: "extension_ui_response", id, cancelled: true })
  }
  pendingUi.clear()
}

async function login(command: BridgeCommand) {
  authStorage.reload()
  const provider = command.provider?.trim() ?? ""
  if (!provider) throw new Error("provider is required")
  const runtime = await services(command.cwd ?? process.cwd())
  const providerInfo = authStorage
    .getOAuthProviders()
    .find((candidate) => candidate.id === provider)
  if (!providerInfo) throw new Error(`Unknown OAuth provider: ${provider}`)

  const existing = activeLogins.get(provider)
  if (existing) {
    existing.abort()
    throw new Error(
      `Cancelled the existing ${providerInfo.name} login. Try login again.`
    )
  }
  const abortController = new AbortController()
  activeLogins.set(provider, abortController)
  const scope = {
    contextId: command.contextId,
    sessionId: command.sessionId,
  }
  let manualInput: Promise<BridgeUiResponse> | undefined

  try {
    await authStorage.login(provider, {
      onAuth: (info) => {
        manualInput = emitUiRequest(scope, {
          method: "auth",
          title: `Log in to ${providerInfo.name}`,
          message:
            info.instructions ??
            "Open the login page in your browser to continue.",
          authUrl: info.url,
          authManualAllowed: Boolean(providerInfo.usesCallbackServer),
        })
      },
      onDeviceCode: (info) => {
        void emitUiRequest(scope, {
          method: "auth",
          title: `Log in to ${providerInfo.name}`,
          message: `Enter code ${info.userCode} to continue.`,
          authUrl: info.verificationUri,
          authManualAllowed: false,
        }).then((response) => {
          if (response.cancelled) abortController.abort()
        })
      },
      onPrompt: async (prompt) => {
        const response = await emitUiRequest(scope, {
          method: "auth_input",
          title: `Log in to ${providerInfo.name}`,
          message: prompt.message,
          placeholder: prompt.placeholder,
          allowEmpty: Boolean(prompt.allowEmpty),
        })
        if (response.cancelled) throw new Error("Login cancelled")
        const value = typeof response.value === "string" ? response.value : ""
        if (!value && !prompt.allowEmpty) throw new Error("Login cancelled")
        return value
      },
      onProgress: (message) => {
        void emitUiRequest(
          scope,
          { method: "notify", message, notifyType: "info" },
          false
        )
      },
      onManualCodeInput: async () => {
        const response = await (manualInput ??
          emitUiRequest(scope, {
            method: "auth_input",
            title: `Log in to ${providerInfo.name}`,
            message: "Paste the authorization code or redirect URL.",
          }))
        if (response.cancelled || typeof response.value !== "string") {
          throw new Error("Login cancelled")
        }
        return response.value
      },
      onSelect: async (prompt) => {
        const response = await emitUiRequest(scope, {
          method: "auth_select",
          title: `Log in to ${providerInfo.name}`,
          message: prompt.message,
          options: prompt.options.map((option) => ({
            value: option.id,
            label: option.label,
          })),
        })
        return response.cancelled ? undefined : response.value
      },
      signal: abortController.signal,
    })
    runtime.modelRegistry.refresh()
    return {
      ok: true,
      provider,
      availableModels: availableModels(runtime),
    }
  } finally {
    activeLogins.delete(provider)
  }
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
  if (hours < 24) {
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
}

async function oauthCredential(provider: string) {
  const credential = authStorage.get(provider)
  if (credential?.type !== "oauth") return undefined
  const token =
    (await authStorage
      .getApiKey(provider, { includeFallback: false })
      .catch(() => undefined)) ?? credential.access
  const refreshed = authStorage.get(provider)
  return {
    token,
    credential: refreshed?.type === "oauth" ? refreshed : credential,
  }
}

async function claudeToken() {
  const stored = await oauthCredential("anthropic")
  if (stored?.token) return stored.token
  const keychain = spawnSync(
    "security",
    ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
    { encoding: "utf8" }
  )
  if (keychain.status !== 0 || !keychain.stdout.trim()) return undefined
  try {
    const value = JSON.parse(keychain.stdout)
    return typeof value.claudeAiOauth?.accessToken === "string"
      ? value.claudeAiOauth.accessToken
      : undefined
  } catch {
    return undefined
  }
}

async function codexCredential() {
  const stored = await oauthCredential("openai-codex")
  if (stored?.token) {
    return {
      token: stored.token,
      accountId:
        typeof stored.credential.accountId === "string"
          ? stored.credential.accountId
          : undefined,
    }
  }
  const path = join(
    process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    "auth.json"
  )
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    if (value.OPENAI_API_KEY) return { token: String(value.OPENAI_API_KEY) }
    if (value.tokens?.access_token) {
      return {
        token: String(value.tokens.access_token),
        accountId: value.tokens.account_id
          ? String(value.tokens.account_id)
          : undefined,
      }
    }
  } catch {
    // Ignore malformed external credential files.
  }
  return undefined
}

async function providerUsage(provider: string | undefined) {
  authStorage.reload()
  const windows: ProviderUsageWindow[] = []
  if (provider === "anthropic") {
    const token = await claudeToken()
    if (!token) return { windows }
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    if (!response?.ok) return { windows }
    const value = (await response.json()) as Record<
      string,
      {
        utilization?: number
        resets_at?: string
      }
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
    const credential = await codexCredential()
    if (!credential) return { windows }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.token}`,
      "User-Agent": "pico",
      Accept: "application/json",
    }
    if (credential.accountId) {
      headers["ChatGPT-Account-Id"] = credential.accountId
    }
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers,
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    if (!response?.ok) return { windows }
    const value = (await response.json()) as {
      rate_limit?: {
        primary_window?: UsageWindow
        secondary_window?: UsageWindow
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
  return { windows }
}

interface UsageWindow {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

function usageWindowLabel(seconds: number | undefined, fallback: string) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return fallback
  const hours = Math.round(seconds / 3600)
  if (Math.abs(hours - 168) <= 2 || fallback === "Week") return "Week"
  if (Math.abs(hours - 5) <= 2 || fallback === "5h") return fallback
  return hours >= 1 && hours < 48 ? `${hours}h` : fallback
}

async function handleCommand(command: BridgeCommand) {
  const cwd = command.cwd ?? process.cwd()
  switch (command.type) {
    case "get_auth_providers":
      success(command, await authProviders(cwd))
      break
    case "set_api_key": {
      const provider = command.provider?.trim() ?? ""
      const key = command.key?.trim() ?? ""
      if (!provider) throw new Error("provider is required")
      if (!key) throw new Error("API key is required")
      authStorage.reload()
      authStorage.set(provider, { type: "api_key", key })
      const runtime = await services(cwd)
      runtime.modelRegistry.refresh()
      success(command, {
        ok: true,
        provider,
        availableModels: availableModels(runtime),
      })
      break
    }
    case "logout": {
      const provider = command.provider?.trim() ?? ""
      if (!provider) throw new Error("provider is required")
      authStorage.reload()
      authStorage.logout(provider)
      const runtime = await services(cwd)
      runtime.modelRegistry.refresh()
      success(command, {
        ok: true,
        provider,
        availableModels: availableModels(runtime),
      })
      break
    }
    case "login":
      success(command, await login(command))
      break
    case "get_provider_usage":
      success(command, await providerUsage(command.provider))
      break
    default:
      throw new Error(`Unknown bridge command: ${command.type ?? "(empty)"}`)
  }
}

async function handleLine(line: string) {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    failure({ type: "parse" }, error)
    return
  }
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "extension_ui_response" &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    resolveUiResponse(value as BridgeUiResponse)
    return
  }
  const command = value as BridgeCommand
  try {
    await handleCommand(command)
  } catch (error) {
    failure(command, error)
  }
}

const decoder = new StringDecoder("utf8")
let input = ""
process.stdin.on("data", (chunk: Buffer) => {
  input += decoder.write(chunk)
  if (Buffer.byteLength(input) > MAX_LINE_BYTES && !input.includes("\n")) {
    failure({ type: "parse" }, new Error("Bridge input line exceeds limit"))
    input = ""
    return
  }
  while (true) {
    const newline = input.indexOf("\n")
    if (newline < 0) break
    let line = input.slice(0, newline)
    input = input.slice(newline + 1)
    if (line.endsWith("\r")) line = line.slice(0, -1)
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      failure({ type: "parse" }, new Error("Bridge input line exceeds limit"))
      continue
    }
    if (line) void handleLine(line)
  }
  if (Buffer.byteLength(input) > MAX_LINE_BYTES) {
    failure({ type: "parse" }, new Error("Bridge input line exceeds limit"))
    input = ""
  }
})
process.stdin.on("end", () => {
  input += decoder.end()
  if (input) void handleLine(input.endsWith("\r") ? input.slice(0, -1) : input)
})
process.on("SIGTERM", () => {
  for (const login of activeLogins.values()) login.abort()
  cancelPendingUi()
  process.exit(0)
})
