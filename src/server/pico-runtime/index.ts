import { createHash, randomUUID } from "node:crypto"
import { mkdir, rename, stat, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, resolve as resolvePath } from "node:path"
import { performance } from "node:perf_hooks"

import type {
  ConversationItem,
  ConversationItemsPatch,
  DirectoryState,
  ModelOption,
  SessionUiState,
  SkillOption,
  StateSyncPayload,
  TreeNode,
} from "@/lib/pico"
import { createCompactionSummaryItem } from "@/lib/pico"
import {
  cleanupSessionNameCandidate,
  deriveHeuristicSessionNameAttempt,
  generateSessionNameWithLlm,
  summarizePromptContent,
} from "@/server/session-naming"
import {
  activateContextSession as activateRuntimeContextSession,
  clearContextDraft as clearRuntimeContextDraft,
  normalizeSessionScope,
  resolveRequestedEntry as resolveRuntimeRequestedEntry,
  resolveScopeCwd,
  sendPayloadToClient as sendRuntimePayloadToClient,
  writeRawToClient as writeRuntimeRawToClient,
} from "@/server/pico-runtime/contexts"
import {
  buildHighlightPayload,
  type HighlightPayload,
} from "@/server/pico-runtime/highlight"
import {
  applyRetainedConversationEvent,
  createRetainedConversationState,
} from "@/server/pico-runtime/conversation-retainer"
import {
  compareSessionListEntriesByLastUserMessage,
  countFullTurnUserAndAssistantMessages,
  createDirectorySessionRevision,
  getSessionLastCompleteMessageInfo,
  getSessionListTitle,
  laterModifiedTimestamp,
  listKnownDirectories,
  mergeSessionListEntry,
  modifiedTimestampValue,
  normalizeModifiedTimestamp,
  normalizeSessionListContextUsage,
  normalizeSessionListTitle,
  readSessionListMetrics,
  serializeSessionListEntry,
} from "@/server/pico-runtime/session-list"
import {
  createForkedInMemorySessionManager,
  extractForkableUserMessages,
  extractMessageText,
  serializeSessionTreeNode,
} from "@/server/pico-runtime/tree-fork"
import {
  createUiRequestBridge,
  resolvePendingUiRequest,
} from "@/server/pico-runtime/ui-requests"
import { createPicoEditToolDefinition } from "@/server/pi-edit-tool"
import { loadPiSdk, makeSelfContainedSettingsManager } from "@/server/pi-sdk"
import { GitWatchManager, type GitWatchChange } from "@/server/git-watch"
import { fetchProviderUsage } from "@/server/provider-usage"
import {
  invalidateDirectoryGitCaches,
  readDirectoryGitFingerprint,
  type GitRepositoryFingerprint,
} from "@/server/git"
import type {
  GitChangedEvent,
  GitChangedScope,
  SessionDoneEvent,
  SessionStatusEvent,
} from "@/lib/pico/api"
import type {
  AgentSessionLike,
  AgentSessionRuntimeLike,
  MessageContentPartLike,
  MessageLike,
  ModelLike,
  PiSdkLike,
  PromptImageInputLike,
  SessionEventLike,
  SessionListInfoLike,
  SessionManagerLike,
  SessionServicesLike,
  SessionStartEventLike,
  SettingsManagerLike,
} from "@/server/pi-sdk-types"

const VALID_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])
const SESSION_LIST_LIMIT_DEFAULT = 5
const SESSION_LIST_LIMIT_MAX = 100
const SESSION_HISTORY_PAGE_LIMIT_DEFAULT = 50
const SESSION_HISTORY_PAGE_LIMIT_MAX = 200
const SESSION_NAME_MAX_LENGTH = 48
const HEARTBEAT_INTERVAL_MS = 20_000
const SESSION_INDEX_CACHE_TTL_MS = 5_000
const SESSION_LOAD_DEBUG_ENV_KEYS = [
  "PICO_DEBUG_SESSION_LOAD",
  "PICO_DEBUG_SESSIONS",
  "PICO_DEBUG",
]

function isTruthyEnvValue(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value ?? "")
}

function isSessionLoadDebugEnabled() {
  return SESSION_LOAD_DEBUG_ENV_KEYS.some((key) =>
    isTruthyEnvValue(process.env[key])
  )
}

function roundedDurationMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function debugJson(details: Record<string, unknown>) {
  try {
    return JSON.stringify(details)
  } catch {
    return JSON.stringify({ details: "[unserializable]" })
  }
}

const identityTheme = {
  fg: (_color: unknown, text: string) => text,
  bg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (text: string) => text,
  getBashModeBorderColor: () => (text: string) => text,
}

const API_KEY_LOGIN_PROVIDER_NAMES: Record<string, string> = {
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

const BUILT_IN_API_KEY_LOGIN_PROVIDERS = new Set(
  Object.keys(API_KEY_LOGIN_PROVIDER_NAMES)
)

function getApiKeyProviderDisplayName(providerId: string) {
  return API_KEY_LOGIN_PROVIDER_NAMES[providerId] ?? providerId
}

type PromptImageInput = PromptImageInputLike

type PendingUserMessage = {
  pendingId: string
  text: string
  images: Array<PromptImageInput>
  queued: true
  streamingBehavior: "steer" | "followUp"
}

type SessionNamingState = {
  nonce: number
  pendingGeneration: boolean
  managedSessionName?: string
  disposed: boolean
}

type SessionDoneReason = SessionDoneEvent["reason"]
type SessionDoneOutcome = NonNullable<SessionDoneEvent["outcome"]>

type SessionEntry = {
  key: string
  cwd: string
  services: SessionServicesLike
  runtime: AgentSessionRuntimeLike
  session: AgentSessionLike
  draft: boolean
  streamingState: boolean
  compactingState: boolean
  retainedConversationItems: Array<ConversationItem>
  pendingUserMessages: Array<PendingUserMessage>
  pendingQueueMutation: boolean
  canceledPendingUserMessageIds: Set<string>
  firstMessageHint: string
  modifiedAt?: string
  lastUserMessageAt?: string
  uiState: SessionUiState
  unsubscribe?: (() => void) | undefined
  restoreSessionMetadataSync?: (() => void) | undefined
  sessionNaming: SessionNamingState
  promptRequestChain: Promise<void>
  doneCheckTimeout?: ReturnType<typeof setTimeout>
  pendingDoneReason?: SessionDoneReason
  pendingDoneOutcome?: SessionDoneOutcome
  doneNotificationSuppressed: boolean
  lastDoneSignalSignature?: string
}

type ContextState = {
  id: string
  clients: Set<SseClient>
  activeKey?: string
  draftKey?: string
  sessionScope: string
  unreadFinished: Set<string>
  sidebarBootstrapDirectories: Array<string>
}

type StateSyncScalarField =
  | "sessionKey"
  | "draft"
  | "streaming"
  | "compacting"
  | "hideThinkingBlock"
  | "thinkingLevel"
  | "historyOffset"
  | "historyTotalCount"
  | "sessionId"
  | "sessionFile"
  | "sessionName"
  | "firstMessage"
  | "cwd"
  | "modified"

type StateSyncJsonField =
  | "messages"
  | "items"
  | "pendingUserMessages"
  | "streamingMessage"
  | "contextUsage"
  | "model"
  | "availableThinkingLevels"
  | "availableModels"
  | "availableSkills"
  | "uiState"

type StateSyncSnapshot = {
  scalarValues: Partial<Record<StateSyncScalarField, unknown>>
  jsonValues: Partial<Record<StateSyncJsonField, string>>
  itemSignatures?: Array<string>
}

type SseClient = {
  id: string
  closed: boolean
  controller: ReadableStreamDefaultController<Uint8Array>
  lastStateSyncSnapshot?: StateSyncSnapshot
}

type PendingUiRequest = {
  resolve: (value: Record<string, unknown>) => void
}

type ResolveRequestResult = {
  url: URL
  context: ContextState
  activeEntry: SessionEntry
}

const STATE_SYNC_SCALAR_FIELDS = [
  "sessionKey",
  "draft",
  "streaming",
  "compacting",
  "hideThinkingBlock",
  "thinkingLevel",
  "historyOffset",
  "historyTotalCount",
  "sessionId",
  "sessionFile",
  "sessionName",
  "firstMessage",
  "cwd",
  "modified",
] satisfies Array<StateSyncScalarField>

const STATE_SYNC_JSON_FIELDS = [
  "messages",
  "items",
  "pendingUserMessages",
  "streamingMessage",
  "contextUsage",
  "model",
  "availableThinkingLevels",
  "availableModels",
  "availableSkills",
  "uiState",
] satisfies Array<StateSyncJsonField>

function cryptoRandomId() {
  return randomUUID()
}

function normalizeRuntimeGitCwd(cwd: string) {
  const trimmed = typeof cwd === "string" ? cwd.trim() : ""
  return trimmed ? resolvePath(trimmed) : ""
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Unknown error"
}

function normalizeRequestedDirectories(values: Array<string>) {
  const nextDirectories: Array<string> = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalizedValue = value.trim()
    if (!normalizedValue || seen.has(normalizedValue)) continue
    seen.add(normalizedValue)
    nextDirectories.push(normalizedValue)
  }

  return nextDirectories
}

function sanitizeMessageContentPart(part: MessageContentPartLike) {
  const type = typeof part?.type === "string" ? part.type : ""

  if (type === "text") {
    return {
      type: "text",
      text: typeof part.text === "string" ? part.text : "",
    }
  }

  if (type === "thinking") {
    return {
      type: "thinking",
      thinking: typeof part.thinking === "string" ? part.thinking : "",
      ...(typeof part.summaryLabel === "string"
        ? { summaryLabel: part.summaryLabel }
        : {}),
    }
  }

  if (type === "toolCall") {
    return {
      type: "toolCall",
      ...(typeof part.id === "string" ? { id: part.id } : {}),
      ...(typeof part.name === "string" ? { name: part.name } : {}),
      ...(Object.prototype.hasOwnProperty.call(part, "arguments")
        ? { arguments: part.arguments }
        : {}),
    }
  }

  if (type === "image") {
    return {
      type: "image",
      ...(typeof part.mimeType === "string" ? { mimeType: part.mimeType } : {}),
      ...(typeof part.data === "string" ? { data: part.data } : {}),
    }
  }

  return null
}

function sanitizeSessionMessage(message: MessageLike) {
  const role = typeof message?.role === "string" ? message.role : ""
  const metadata =
    message?.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : undefined
  const sanitizedContent = Array.isArray(message?.content)
    ? message.content
        .map((part) =>
          sanitizeMessageContentPart(part as MessageContentPartLike)
        )
        .filter((part): part is NonNullable<typeof part> => Boolean(part))
    : typeof message?.content === "string"
      ? message.content
      : undefined

  return {
    ...(role ? { role } : {}),
    ...(sanitizedContent !== undefined ? { content: sanitizedContent } : {}),
    ...(typeof message?.stopReason === "string"
      ? { stopReason: message.stopReason }
      : {}),
    ...(typeof message?.errorMessage === "string"
      ? { errorMessage: message.errorMessage }
      : {}),
    ...(typeof message?.provider === "string"
      ? { provider: message.provider }
      : {}),
    ...(typeof message?.model === "string" ? { model: message.model } : {}),
    ...(message?.queued || metadata?.queued ? { queued: true } : {}),
    ...(message?.streamingBehavior === "steer" ||
    message?.streamingBehavior === "followUp"
      ? { streamingBehavior: message.streamingBehavior }
      : message?.deliverAs === "steer" || message?.deliverAs === "followUp"
        ? { streamingBehavior: message.deliverAs }
        : metadata?.streamingBehavior === "steer" ||
            metadata?.streamingBehavior === "followUp"
          ? { streamingBehavior: metadata.streamingBehavior }
          : metadata?.deliverAs === "steer" ||
              metadata?.deliverAs === "followUp"
            ? { streamingBehavior: metadata.deliverAs }
            : {}),
    ...(typeof message?.summary === "string"
      ? { summary: message.summary }
      : {}),
    ...(Number.isFinite(Number(message?.tokensBefore))
      ? { tokensBefore: Number(message.tokensBefore) }
      : {}),
    ...(typeof message?.toolCallId === "string"
      ? { toolCallId: message.toolCallId }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(message, "details")
      ? { details: message.details }
      : {}),
    ...(message?.isError ? { isError: true } : {}),
  }
}

function stringifyStateSyncValue(value: unknown) {
  return value === undefined ? "__pi_undefined__" : JSON.stringify(value)
}

function sameStringValues(left: Array<string> = [], right: Array<string> = []) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

const conversationItemSignatureCache = new WeakMap<ConversationItem, string>()

function conversationItemSignature(item: ConversationItem) {
  const cached = conversationItemSignatureCache.get(item)
  if (cached) return cached

  const json = stringifyStateSyncValue(item)
  const hash = createHash("sha1").update(json).digest("hex")
  const signature = `${json.length}:${hash}`
  conversationItemSignatureCache.set(item, signature)
  return signature
}

function createConversationItemsPatch(
  previousSignatures: Array<string>,
  nextItems: Array<ConversationItem>,
  nextSignatures: Array<string>
): ConversationItemsPatch | null {
  if (sameStringValues(previousSignatures, nextSignatures)) return null

  let prefixLength = 0
  const sharedLength = Math.min(
    previousSignatures.length,
    nextSignatures.length
  )
  while (
    prefixLength < sharedLength &&
    previousSignatures[prefixLength] === nextSignatures[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < sharedLength - prefixLength &&
    previousSignatures[previousSignatures.length - 1 - suffixLength] ===
      nextSignatures[nextSignatures.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return {
    previousLength: previousSignatures.length,
    start: prefixLength,
    deleteCount: previousSignatures.length - prefixLength - suffixLength,
    items: nextItems.slice(prefixLength, nextItems.length - suffixLength),
  }
}

function createStateSyncSnapshot(payload: StateSyncPayload): StateSyncSnapshot {
  const scalarValues: Partial<Record<StateSyncScalarField, unknown>> = {}
  for (const field of STATE_SYNC_SCALAR_FIELDS) {
    scalarValues[field] = payload[field]
  }

  const jsonValues: Partial<Record<StateSyncJsonField, string>> = {}
  let itemSignatures: Array<string> | undefined
  for (const field of STATE_SYNC_JSON_FIELDS) {
    if (field === "items" && Array.isArray(payload.items)) {
      itemSignatures = payload.items.map((item) =>
        conversationItemSignature(item)
      )
      continue
    }
    jsonValues[field] = stringifyStateSyncValue(payload[field])
  }

  return {
    scalarValues,
    jsonValues,
    itemSignatures,
  }
}

function createStateSyncPatch(
  previous: StateSyncSnapshot | undefined,
  next: StateSyncPayload
) {
  if (!previous || previous.scalarValues.sessionKey !== next.sessionKey) {
    return next
  }

  let changed = false
  const patch: StateSyncPayload = {
    type: "state_sync",
    sessionKey: next.sessionKey,
  }

  for (const field of STATE_SYNC_SCALAR_FIELDS) {
    if (field === "sessionKey") continue
    const nextValue = next[field]
    if (Object.is(previous.scalarValues[field], nextValue)) {
      continue
    }
    patch[field] = nextValue as never
    changed = true
  }

  for (const field of STATE_SYNC_JSON_FIELDS) {
    if (field === "items") continue

    const nextValue = next[field]
    const nextJson = stringifyStateSyncValue(nextValue)
    if (previous.jsonValues[field] === nextJson) {
      continue
    }
    patch[field] = nextValue as never
    changed = true
  }

  if (Array.isArray(next.items)) {
    const nextItemSignatures = next.items.map((item) =>
      conversationItemSignature(item)
    )
    if (!sameStringValues(previous.itemSignatures, nextItemSignatures)) {
      const itemPatch = previous.itemSignatures
        ? createConversationItemsPatch(
            previous.itemSignatures,
            next.items,
            nextItemSignatures
          )
        : null

      if (itemPatch) {
        patch.itemsPatch = itemPatch
      } else {
        patch.items = next.items
      }
      changed = true
    }
  }

  return changed ? patch : null
}

function createInitialUiState(): SessionUiState {
  return {
    statuses: {},
    title: undefined,
    editorText: "",
    workingMessage: undefined,
  }
}

function normalizePromptImages(rawImages: unknown) {
  if (!Array.isArray(rawImages)) return []

  return rawImages
    .map((image) => {
      if (!image || typeof image !== "object") return undefined

      const mimeType =
        typeof (image as { mimeType?: unknown }).mimeType === "string"
          ? (image as { mimeType: string }).mimeType.trim()
          : ""
      const data =
        typeof (image as { data?: unknown }).data === "string"
          ? (image as { data: string }).data.trim()
          : ""

      if (!mimeType || !/^image\//i.test(mimeType) || !data) return undefined

      return {
        type: "image",
        mimeType,
        data,
      } satisfies PromptImageInput
    })
    .filter((image): image is PromptImageInput => Boolean(image))
    .slice(0, 8)
}

function serializeModel(model: ModelLike | undefined): ModelOption | undefined {
  if (!model) return undefined

  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    reasoning: Boolean(model.reasoning),
  }
}

function clampSessionNameLength(value: string) {
  if (value.length <= SESSION_NAME_MAX_LENGTH) return value
  return `${value.slice(0, Math.max(0, SESSION_NAME_MAX_LENGTH - 1)).trimEnd()}…`
}

function clonePendingUserMessage(
  message: PendingUserMessage | Record<string, unknown>
): PendingUserMessage {
  return {
    pendingId:
      typeof message.pendingId === "string" && message.pendingId
        ? message.pendingId
        : `pending:${cryptoRandomId()}`,
    text: typeof message.text === "string" ? message.text : "",
    images: normalizePromptImages(message.images),
    queued: true,
    streamingBehavior:
      message.streamingBehavior === "steer" ? "steer" : "followUp",
  }
}

function sortPendingUserMessages(messages: Array<PendingUserMessage>) {
  return [
    ...messages.filter((message) => message.streamingBehavior === "steer"),
    ...messages.filter((message) => message.streamingBehavior !== "steer"),
  ]
}

function normalizePendingStreamingBehavior(
  value: unknown
): "steer" | "followUp" | undefined {
  return value === "steer" || value === "followUp" ? value : undefined
}

function hasOwnProperty(value: unknown, key: string) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, key)
  )
}

function createPendingUserMessage(
  text: string,
  images: Array<PromptImageInput>,
  streamingBehavior: "steer" | "followUp",
  pendingId?: string
) {
  return {
    pendingId: pendingId || `pending:${cryptoRandomId()}`,
    text,
    images,
    queued: true,
    streamingBehavior,
  } satisfies PendingUserMessage
}

function normalizeClientPendingId(value: unknown) {
  if (typeof value !== "string") return undefined

  const pendingId = value.trim()
  if (!pendingId.startsWith("optimistic:")) return undefined
  if (pendingId.length > 128) return undefined

  return pendingId
}

export class PicoRuntime {
  private readonly encoder = new TextEncoder()
  private readonly contexts = new Map<string, ContextState>()
  private readonly sessionEntries = new Map<string, SessionEntry>()
  private readonly servicesByCwd = new Map<string, SessionServicesLike>()
  private readonly pendingUiRequests = new Map<string, PendingUiRequest>()
  private readonly activeOAuthLogins = new Map<string, () => void>()
  private readonly highlightCache = new Map<string, HighlightPayload>()
  private readonly gitFingerprints = new Map<
    string,
    GitRepositoryFingerprint | null
  >()
  private readonly primingGitFingerprints = new Set<string>()
  private readonly gitWatchManager = new GitWatchManager((change) => {
    void this.handleGitWatchChange(change)
  })
  private sessionIndexCache?: {
    expiresAt: number
    entries: Array<SessionListInfoLike>
  }
  private sessionIndexPromise?: Promise<Array<SessionListInfoLike>>
  private sdkPromise?: Promise<PiSdkLike>
  private heartbeat: NodeJS.Timeout
  private highlightLoadErrorLogged = false

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const context of this.contexts.values()) {
        for (const client of context.clients) {
          this.writeRawToClient(context, client, ": heartbeat\n\n")
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
    this.heartbeat.unref?.()
  }

  private async getSdk() {
    if (this.sdkPromise) return await this.sdkPromise

    const startedAt = performance.now()
    this.logSessionLoadDebug("sdk_load:start")
    this.sdkPromise = loadPiSdk().then((sdk) => sdk as unknown as PiSdkLike)
    try {
      const sdk = await this.sdkPromise
      this.logSessionLoadDebug("sdk_load:done", {
        durationMs: roundedDurationMs(startedAt),
      })
      return sdk
    } catch (error) {
      this.logSessionLoadDebug("sdk_load:error", {
        durationMs: roundedDurationMs(startedAt),
        error: safeErrorMessage(error),
      })
      throw error
    }
  }

  private logSessionLoadDebug(
    event: string,
    details: Record<string, unknown> = {}
  ) {
    if (!isSessionLoadDebugEnabled()) return
    const suffix =
      Object.keys(details).length > 0 ? ` ${debugJson(details)}` : ""
    console.log(`[pico:session-load] ${event}${suffix}`)
  }

  private async timeSessionLoad<T>(
    event: string,
    details: Record<string, unknown>,
    action: () => Promise<T>
  ) {
    if (!isSessionLoadDebugEnabled()) return await action()

    const startedAt = performance.now()
    this.logSessionLoadDebug(`${event}:start`, details)
    try {
      const result = await action()
      this.logSessionLoadDebug(`${event}:done`, {
        ...details,
        durationMs: roundedDurationMs(startedAt),
      })
      return result
    } catch (error) {
      this.logSessionLoadDebug(`${event}:error`, {
        ...details,
        durationMs: roundedDurationMs(startedAt),
        error: safeErrorMessage(error),
      })
      throw error
    }
  }

  private sessionDebugDetails(entry: SessionEntry | undefined) {
    if (!entry) return {}
    return {
      key: entry.key,
      sessionId: entry.session.sessionId,
      sessionFile: entry.session.sessionFile,
      cwd: entry.cwd,
      draft: entry.draft,
      streaming: this.getEntryStreamingState(entry),
      compacting: this.getEntryCompactingState(entry),
      messageCount: entry.session.messages.length,
    }
  }

  private logRuntimeDiagnostics(
    diagnostics:
      | Array<{
          type: string
          message: string
        }>
      | undefined
  ) {
    for (const diagnostic of diagnostics ?? []) {
      const prefix =
        diagnostic.type === "error"
          ? "error"
          : diagnostic.type === "warning"
            ? "warn"
            : "info"
      console.log(`[pico:${prefix}] ${diagnostic.message}`)
    }
  }

  private async getServicesForCwd(cwd: string) {
    const cached = this.servicesByCwd.get(cwd)
    if (cached) {
      this.logSessionLoadDebug("services_for_cwd:cache_hit", { cwd })
      return cached
    }

    return await this.timeSessionLoad(
      "services_for_cwd:create",
      { cwd },
      async () => {
        const sdk = await this.getSdk()
        const agentDir = sdk.getAgentDir()
        const settingsStartedAt = performance.now()
        const settingsManager = makeSelfContainedSettingsManager(
          sdk.SettingsManager.create(cwd, agentDir)
        ) as SettingsManagerLike
        this.logSessionLoadDebug("settings_manager:create", {
          cwd,
          durationMs: roundedDurationMs(settingsStartedAt),
        })

        const servicesStartedAt = performance.now()
        const services = await sdk.createAgentSessionServices({
          cwd,
          agentDir,
          settingsManager,
          resourceLoaderOptions: {
            noExtensions: true,
          },
        })
        this.logSessionLoadDebug("agent_session_services:create", {
          cwd,
          durationMs: roundedDurationMs(servicesStartedAt),
        })

        this.logRuntimeDiagnostics(services.diagnostics)
        this.servicesByCwd.set(cwd, services)
        return services
      }
    )
  }

  private async createSessionRuntime(
    sessionManager: SessionManagerLike,
    options?: {
      sessionStartEvent?: SessionStartEventLike
    }
  ) {
    const cwd = sessionManager.getCwd()
    const reason = options?.sessionStartEvent?.reason

    return await this.timeSessionLoad(
      "session_runtime:create",
      { cwd, reason },
      async () => {
        const sdk = await this.getSdk()
        const agentDir = sdk.getAgentDir()

        return await sdk.createAgentSessionRuntime(
          async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
            const services = await this.getServicesForCwd(runtimeCwd)
            const sessionStartedAt = performance.now()
            const editTool = await createPicoEditToolDefinition(sdk, runtimeCwd)
            const customTools = editTool ? [editTool] : []
            const result = await sdk.createAgentSessionFromServices({
              services,
              sessionManager,
              sessionStartEvent,
              customTools,
            })
            this.logSessionLoadDebug("agent_session_from_services:create", {
              cwd: runtimeCwd,
              reason: sessionStartEvent?.reason,
              durationMs: roundedDurationMs(sessionStartedAt),
              messageCount: result.session?.messages.length,
              sessionId: result.session?.sessionId,
              sessionFile: result.session?.sessionFile,
            })
            return {
              ...result,
              services,
              diagnostics: services.diagnostics ?? [],
            }
          },
          {
            cwd,
            agentDir,
            sessionManager,
            sessionStartEvent: options?.sessionStartEvent,
          }
        )
      }
    )
  }

  private listAvailableModels(entry: SessionEntry) {
    return entry.services.modelRegistry
      .getAvailable()
      .map((model) => serializeModel(model))
      .filter((model): model is ModelOption => Boolean(model))
      .sort((left, right) => {
        const providerCompare = (left.provider || "").localeCompare(
          right.provider || ""
        )
        if (providerCompare !== 0) return providerCompare
        return (left.name || left.id).localeCompare(right.name || right.id)
      })
  }

  private listAvailableSkills(entry: SessionEntry) {
    return entry.services.resourceLoader
      .getSkills()
      .skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        scope: skill.sourceInfo?.scope,
        source: skill.sourceInfo?.source,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          (left.description || "").localeCompare(right.description || "")
      ) satisfies Array<SkillOption>
  }

  private ensureContext(id: string) {
    const existing = this.contexts.get(id)
    if (existing) return existing

    const next: ContextState = {
      id,
      clients: new Set(),
      activeKey: undefined,
      draftKey: undefined,
      sessionScope: process.cwd(),
      unreadFinished: new Set(),
      sidebarBootstrapDirectories: [],
    }
    this.contexts.set(id, next)
    return next
  }

  private getSessionPath(entry: SessionEntry) {
    return entry.session.sessionFile ?? entry.key
  }

  private getActiveEntry(context: ContextState) {
    return context.activeKey
      ? this.sessionEntries.get(context.activeKey)
      : undefined
  }

  private getEntryStreamingState(entry: SessionEntry) {
    // Keep the browser-facing streaming state on our own lifecycle flag.
    // The SDK clears `session.isStreaming` only after awaited `agent_end`
    // listeners finish. Since this runtime broadcasts from inside that listener,
    // OR-ing with `session.isStreaming` can send a final stale `streaming: true`
    // patch and leave the UI stuck in "Working…" until reconnect/reload.
    return entry.streamingState
  }

  private getEntryCompactingState(entry: SessionEntry) {
    return entry.compactingState
  }

  private hasVisibleSessionContent(entry: SessionEntry) {
    return (
      Boolean(entry) &&
      (entry.session.messages.length > 0 || this.getEntryStreamingState(entry))
    )
  }

  private isDraftEntry(entry: SessionEntry | undefined) {
    if (!entry) return false
    return Boolean(entry.draft) && !this.hasVisibleSessionContent(entry)
  }

  private isSessionEntryReferenced(entry: SessionEntry) {
    for (const context of this.contexts.values()) {
      if (context.activeKey === entry.key || context.draftKey === entry.key) {
        return true
      }
    }

    return false
  }

  private async disposeUnreferencedSessionEntries() {
    const candidates = [...this.sessionEntries.values()]

    for (const entry of candidates) {
      if (this.sessionEntries.get(entry.key) !== entry) continue
      if (this.isSessionEntryReferenced(entry)) continue
      if (this.isSessionBusyForDone(entry)) continue
      await this.disposeSessionEntry(entry)
    }
  }

  private async cleanupInactiveContexts() {
    for (const context of this.contexts.values()) {
      if (context.clients.size > 0) continue

      const activeEntry = this.getActiveEntry(context)
      if (activeEntry && this.isSessionBusyForDone(activeEntry)) continue

      this.contexts.delete(context.id)
    }

    this.syncGitWatchDirectories()
    await this.disposeUnreferencedSessionEntries()
  }

  private touchSessionEntry(
    entry: SessionEntry,
    value: Date | string = new Date()
  ) {
    const nextValue =
      value instanceof Date
        ? value.toISOString()
        : normalizeModifiedTimestamp(value)
    if (!nextValue) return
    entry.modifiedAt =
      laterModifiedTimestamp(entry.modifiedAt, nextValue) || nextValue
  }

  private markSessionUserMessage(
    entry: SessionEntry,
    value: Date | string = new Date()
  ) {
    const nextValue =
      value instanceof Date
        ? value.toISOString()
        : normalizeModifiedTimestamp(value)
    if (!nextValue) return
    entry.lastUserMessageAt =
      laterModifiedTimestamp(entry.lastUserMessageAt, nextValue) || nextValue
    this.touchSessionEntry(entry, nextValue)
  }

  private async sessionEntryModified(entry: SessionEntry) {
    let modified = laterModifiedTimestamp(entry.modifiedAt)
    if (entry.session.sessionFile) {
      try {
        const stats = await stat(entry.session.sessionFile)
        modified =
          laterModifiedTimestamp(modified, stats.mtime.toISOString()) ||
          modified
      } catch {
        // ignore missing session files
      }
    }
    return modified
  }

  private getSessionFirstMessage(entry: SessionEntry) {
    for (const message of entry.session.messages) {
      if (message?.role !== "user") continue
      const text = extractMessageText(message)
      if (text) return text
      const summary = summarizePromptContent(message.content)
      if (summary.text) return summary.text
    }

    return entry.firstMessageHint.trim()
  }

  private getSessionLastUserMessageTimestamp(entry: SessionEntry) {
    let lastValue = laterModifiedTimestamp(entry.lastUserMessageAt)

    for (const message of entry.session.messages) {
      if (message?.role !== "user") continue
      lastValue =
        laterModifiedTimestamp(lastValue, message.timestamp) || lastValue
    }

    return lastValue
  }

  private currentStatePayload(entry: SessionEntry): StateSyncPayload {
    const draft = this.isDraftEntry(entry)
    const historyTotalCount = entry.session.messages.length

    return {
      type: "state_sync",
      sessionKey: entry.key,
      items: entry.retainedConversationItems,
      pendingUserMessages: entry.pendingUserMessages.map((message) =>
        clonePendingUserMessage(message)
      ),
      draft,
      streaming: this.getEntryStreamingState(entry),
      compacting: this.getEntryCompactingState(entry),
      historyOffset: 0,
      historyTotalCount,
      contextUsage:
        entry.session.getContextUsage() as StateSyncPayload["contextUsage"],
      hideThinkingBlock: entry.services.settingsManager.getHideThinkingBlock(),
      model: serializeModel(entry.session.model),
      thinkingLevel: entry.session.thinkingLevel,
      availableThinkingLevels: entry.session.getAvailableThinkingLevels(),
      availableModels: this.listAvailableModels(entry),
      availableSkills: this.listAvailableSkills(entry),
      sessionId: draft ? undefined : entry.session.sessionId,
      sessionFile: draft ? undefined : entry.session.sessionFile,
      sessionName: entry.session.sessionName,
      firstMessage: this.getSessionFirstMessage(entry),
      cwd: entry.cwd,
      modified: entry.modifiedAt,
      uiState: entry.uiState,
    }
  }

  private mergeSessionListEntry(
    target: SessionListInfoLike,
    fallback: SessionListInfoLike & { title?: string }
  ) {
    return mergeSessionListEntry(target, fallback)
  }

  private async sessionFallbackInfo(entry: SessionEntry) {
    const firstMessage = this.getSessionFirstMessage(entry)
    const lastMessage = getSessionLastCompleteMessageInfo(
      entry.session.messages
    )
    return {
      path: entry.session.sessionFile,
      id: entry.session.sessionId,
      cwd: entry.cwd,
      name: entry.session.sessionName,
      firstMessage,
      title: getSessionListTitle({
        name: entry.session.sessionName,
        firstMessage,
      }),
      modified: await this.sessionEntryModified(entry),
      lastUserMessageAt: this.getSessionLastUserMessageTimestamp(entry),
      lastMessageAt: lastMessage.timestamp,
      lastMessagePreview: lastMessage.preview,
      messageCount: countFullTurnUserAndAssistantMessages(
        entry.session.messages
      ),
      contextUsage: normalizeSessionListContextUsage(
        entry.session.getContextUsage()
      ),
    }
  }

  private invalidateSessionIndexCache() {
    this.sessionIndexCache = undefined
  }

  private async readSessionIndexEntries() {
    const sdk = await this.getSdk()
    try {
      const listStartedAt = performance.now()
      const allSessions = await sdk.SessionManager.listAll()
      this.logSessionLoadDebug("session_index:list_all", {
        durationMs: roundedDurationMs(listStartedAt),
        totalCount: allSessions.length,
      })

      const sessions = allSessions.filter(
        (entry) => (entry.messageCount ?? 0) > 0
      )
      const metricsStartedAt = performance.now()
      const withMetrics = await Promise.all(
        sessions.map(async (entry) => {
          const metrics = entry.path
            ? await readSessionListMetrics(entry.path)
            : undefined
          return {
            ...entry,
            lastUserMessageAt:
              metrics?.lastUserMessageAt ?? entry.lastUserMessageAt,
            lastMessageAt: metrics?.lastMessageAt ?? entry.lastMessageAt,
            lastMessagePreview:
              metrics?.lastMessagePreview ?? entry.lastMessagePreview,
            messageCount: metrics?.messageCount ?? entry.messageCount,
          }
        })
      )
      this.logSessionLoadDebug("session_index:metrics", {
        durationMs: roundedDurationMs(metricsStartedAt),
        sessionCount: sessions.length,
      })
      this.sessionIndexCache = {
        entries: withMetrics,
        expiresAt: Date.now() + SESSION_INDEX_CACHE_TTL_MS,
      }
      return withMetrics
    } catch (error) {
      console.error("[pico] failed to list sessions:", error)
      return []
    }
  }

  private async listSessionIndexEntries() {
    const cached = this.sessionIndexCache
    if (cached && cached.expiresAt > Date.now()) {
      this.logSessionLoadDebug("session_index:list:cache_hit", {
        sessionCount: cached.entries.length,
        ttlMs: cached.expiresAt - Date.now(),
      })
      return cached.entries
    }

    if (this.sessionIndexPromise) {
      this.logSessionLoadDebug("session_index:list:in_flight_hit")
      return await this.sessionIndexPromise
    }

    const promise = this.timeSessionLoad("session_index:list", {}, async () =>
      this.readSessionIndexEntries()
    )
    this.sessionIndexPromise = promise
    try {
      return await promise
    } finally {
      if (this.sessionIndexPromise === promise) {
        this.sessionIndexPromise = undefined
      }
    }
  }

  private listKnownDirectories(allSessions: Array<SessionListInfoLike>) {
    return listKnownDirectories({
      allSessions,
      loadedDirectories: [...this.sessionEntries.values()].map(
        (entry) => entry.cwd
      ),
    })
  }

  private compareSessionListEntriesByLastUserMessage(
    left: SessionListInfoLike,
    right: SessionListInfoLike
  ) {
    return compareSessionListEntriesByLastUserMessage(left, right)
  }

  private serializeSessionListEntry(
    entry: SessionListInfoLike,
    context: ContextState,
    streamingPaths: Set<string>
  ) {
    return serializeSessionListEntry({
      entry,
      unreadSessionPaths: context.unreadFinished,
      streamingPaths,
    })
  }

  private async listEntriesForDirectory(
    allSessions: Array<SessionListInfoLike>,
    directoryPath: string
  ) {
    const sessions = allSessions
      .filter((entry) => entry.cwd === directoryPath)
      .map((entry) => ({ ...entry }))

    const byPath = new Map(
      sessions
        .filter((entry) => entry.path)
        .map((entry) => [entry.path as string, entry])
    )
    const byId = new Map(
      sessions
        .filter((entry) => entry.id)
        .map((entry) => [entry.id as string, entry])
    )

    for (const entry of this.sessionEntries.values()) {
      if (
        entry.cwd !== directoryPath ||
        !this.hasVisibleSessionContent(entry)
      ) {
        continue
      }

      const fallback = await this.sessionFallbackInfo(entry)
      const existing =
        (fallback.path ? byPath.get(fallback.path) : undefined) ||
        (fallback.id ? byId.get(fallback.id) : undefined)

      if (existing) {
        this.mergeSessionListEntry(existing, fallback)
        continue
      }

      sessions.unshift(fallback)
      if (fallback.path) {
        byPath.set(fallback.path, fallback)
      }
      if (fallback.id) {
        byId.set(fallback.id, fallback)
      }
    }

    return sessions.sort((left, right) =>
      this.compareSessionListEntriesByLastUserMessage(left, right)
    )
  }

  private buildStreamingPaths() {
    return new Set(
      [...this.sessionEntries.values()]
        .filter((entry) => this.getEntryStreamingState(entry))
        .map((entry) => this.getSessionPath(entry))
    )
  }

  private async collectDirectoryEntries(
    allSessions: Array<SessionListInfoLike>,
    directories: Array<string>
  ) {
    const entriesByDirectory = new Map<string, Array<SessionListInfoLike>>()

    await Promise.all(
      directories.map(async (directoryPath) => {
        entriesByDirectory.set(
          directoryPath,
          await this.listEntriesForDirectory(allSessions, directoryPath)
        )
      })
    )

    return entriesByDirectory
  }

  private createDirectoryStatePayload(
    directoryPath: string,
    entries: Array<SessionListInfoLike>
  ) {
    const serializedEntries = entries.map((entry) => ({
      path: entry.path,
      id: entry.id,
      name: entry.name,
      title: getSessionListTitle({
        name: entry.name,
        firstMessage: entry.firstMessage,
      }),
      modified: normalizeModifiedTimestamp(entry.modified),
      lastUserMessageAt: normalizeModifiedTimestamp(entry.lastUserMessageAt),
      lastMessageAt: normalizeModifiedTimestamp(entry.lastMessageAt),
      lastMessagePreview: normalizeSessionListTitle(entry.lastMessagePreview),
      messageCount: entry.messageCount,
      contextUsage: normalizeSessionListContextUsage(entry.contextUsage),
    }))

    return {
      path: directoryPath,
      totalCount: entries.length,
      revision: createDirectorySessionRevision(
        directoryPath,
        serializedEntries
      ),
    } satisfies DirectoryState
  }

  private createDirectoryIndexPayload(
    directoryPath: string,
    entries: Array<SessionListInfoLike>,
    context: ContextState,
    streamingPaths: Set<string>
  ) {
    const serializedSessions = entries.map((entry) =>
      this.serializeSessionListEntry(entry, context, streamingPaths)
    )

    return {
      directory: directoryPath,
      totalCount: entries.length,
      revision: createDirectorySessionRevision(
        directoryPath,
        serializedSessions
      ),
      sessions: serializedSessions,
    }
  }

  private async listSessionsPayload(
    context: ContextState,
    options?: { includeBootstrapIndexes?: boolean }
  ) {
    return await this.timeSessionLoad(
      "sessions_payload:build",
      {
        contextId: context.id,
        includeBootstrapIndexes: Boolean(options?.includeBootstrapIndexes),
      },
      async () => {
        const allSessions = await this.listSessionIndexEntries()
        const activeEntry = this.getActiveEntry(context)
        const directories = this.listKnownDirectories(allSessions)
        const activeDirectory = activeEntry?.cwd?.trim() || ""
        const bootstrapDirectories = options?.includeBootstrapIndexes
          ? normalizeRequestedDirectories(context.sidebarBootstrapDirectories)
          : []
        const payloadIndexDirectories = normalizeRequestedDirectories([
          ...bootstrapDirectories,
          activeDirectory,
        ])
        const allDirectories = normalizeRequestedDirectories([
          ...directories,
          ...payloadIndexDirectories,
        ])
        const collectStartedAt = performance.now()
        const entriesByDirectory = await this.collectDirectoryEntries(
          allSessions,
          allDirectories
        )
        this.logSessionLoadDebug("sessions_payload:collect_directories", {
          contextId: context.id,
          durationMs: roundedDurationMs(collectStartedAt),
          directoryCount: allDirectories.length,
          payloadIndexDirectoryCount: payloadIndexDirectories.length,
        })
        const streamingPaths = this.buildStreamingPaths()
        const directoryIndexes =
          payloadIndexDirectories.length > 0
            ? Object.fromEntries(
                payloadIndexDirectories.map((directoryPath) => [
                  directoryPath,
                  this.createDirectoryIndexPayload(
                    directoryPath,
                    entriesByDirectory.get(directoryPath) ?? [],
                    context,
                    streamingPaths
                  ),
                ])
              )
            : undefined

        return {
          type: "sessions",
          directories,
          directoryStates: directories.map((directoryPath) =>
            this.createDirectoryStatePayload(
              directoryPath,
              entriesByDirectory.get(directoryPath) ?? []
            )
          ),
          ...(directoryIndexes ? { directoryIndexes } : {}),
          activeSessionPath: activeEntry?.session.sessionFile,
          activeSessionId: activeEntry?.session.sessionId,
          activeSessionKey: activeEntry?.key,
        }
      }
    )
  }

  async listDirectorySessions(
    request: Request,
    directoryPath: string,
    options?: { offset?: number; limit?: number }
  ) {
    const { context } = await this.resolveRequest(request)
    const safeOffset =
      Number.isInteger(options?.offset) && (options?.offset ?? 0) > 0
        ? Number(options?.offset)
        : 0
    const safeLimit =
      Number.isInteger(options?.limit) && (options?.limit ?? 0) > 0
        ? Math.min(Number(options?.limit), SESSION_LIST_LIMIT_MAX)
        : SESSION_LIST_LIMIT_DEFAULT

    const normalizedDirectoryPath = directoryPath.trim()
    const allSessions = await this.listSessionIndexEntries()
    const directorySessions = await this.listEntriesForDirectory(
      allSessions,
      normalizedDirectoryPath
    )
    const streamingPaths = this.buildStreamingPaths()

    return {
      ok: true,
      directory: normalizedDirectoryPath,
      totalCount: directorySessions.length,
      offset: safeOffset,
      limit: safeLimit,
      sessions: directorySessions
        .slice(safeOffset, safeOffset + safeLimit)
        .map((entry) =>
          this.serializeSessionListEntry(entry, context, streamingPaths)
        ),
    }
  }

  async listDirectorySessionIndexes(
    request: Request,
    directoryPaths: Array<string>
  ) {
    const { context } = await this.resolveRequest(request)
    const normalizedDirectories = normalizeRequestedDirectories(directoryPaths)

    if (normalizedDirectories.length === 0) {
      return {
        ok: true,
        directories: [],
        directoryIndexes: {},
      }
    }

    const allSessions = await this.listSessionIndexEntries()
    const entriesByDirectory = await this.collectDirectoryEntries(
      allSessions,
      normalizedDirectories
    )
    const streamingPaths = this.buildStreamingPaths()

    return {
      ok: true,
      directories: normalizedDirectories,
      directoryIndexes: Object.fromEntries(
        normalizedDirectories.map((directoryPath) => [
          directoryPath,
          this.createDirectoryIndexPayload(
            directoryPath,
            entriesByDirectory.get(directoryPath) ?? [],
            context,
            streamingPaths
          ),
        ])
      ),
    }
  }

  async listDirectorySessionIndex(request: Request, directoryPath: string) {
    const response = await this.listDirectorySessionIndexes(request, [
      directoryPath,
    ])
    const normalizedDirectoryPath = directoryPath.trim()
    const snapshot = response.directoryIndexes[normalizedDirectoryPath]

    return {
      ok: true,
      ...(snapshot || {
        directory: normalizedDirectoryPath,
        totalCount: 0,
        revision: createDirectorySessionRevision(normalizedDirectoryPath, []),
        sessions: [],
      }),
    }
  }

  async getSessionHistory(
    request: Request,
    options?: { before?: number; limit?: number }
  ) {
    const startedAt = performance.now()
    const { activeEntry } = await this.resolveRequest(request)
    const sanitizeStartedAt = performance.now()
    const sanitizedMessages = activeEntry.session.messages.map((message) =>
      sanitizeSessionMessage(message)
    )
    const sanitizeDurationMs = roundedDurationMs(sanitizeStartedAt)
    const totalCount = sanitizedMessages.length
    const safeLimit =
      Number.isInteger(options?.limit) && (options?.limit ?? 0) > 0
        ? Math.min(Number(options?.limit), SESSION_HISTORY_PAGE_LIMIT_MAX)
        : SESSION_HISTORY_PAGE_LIMIT_DEFAULT
    const safeBefore =
      Number.isInteger(options?.before) && (options?.before ?? 0) >= 0
        ? Math.min(Number(options?.before), totalCount)
        : totalCount
    const offset = Math.max(0, safeBefore - safeLimit)
    const messages = sanitizedMessages.slice(offset, safeBefore)

    this.logSessionLoadDebug("session_history:load", {
      before: options?.before,
      requestedLimit: options?.limit,
      offset,
      limit: safeLimit,
      totalCount,
      returnedCount: messages.length,
      sanitizeDurationMs,
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(activeEntry),
    })

    return {
      ok: true,
      offset,
      limit: safeLimit,
      totalCount,
      hasMoreBefore: offset > 0,
      messages,
    }
  }

  private sendToContext(context: ContextState, payload: unknown) {
    for (const client of context.clients) {
      this.sendPayloadToClient(context, client, payload)
    }
  }

  private sendStatePayloadToClient(
    context: ContextState,
    client: SseClient,
    payload: StateSyncPayload,
    options?: { forceFull?: boolean }
  ) {
    const debug = isSessionLoadDebugEnabled()
    const startedAt = performance.now()
    const patchStartedAt = performance.now()
    const nextPayload = options?.forceFull
      ? payload
      : createStateSyncPatch(client.lastStateSyncSnapshot, payload)
    const patchDurationMs = roundedDurationMs(patchStartedAt)
    if (!nextPayload) {
      this.logSessionLoadDebug("state_sync:client_noop", {
        contextId: context.id,
        clientId: client.id,
        sessionKey: payload.sessionKey,
        patchDurationMs,
      })
      return false
    }

    const sendStartedAt = performance.now()
    const sent = this.sendPayloadToClient(context, client, nextPayload)
    const sendDurationMs = roundedDurationMs(sendStartedAt)
    let snapshotDurationMs: number | undefined
    if (sent) {
      const snapshotStartedAt = performance.now()
      client.lastStateSyncSnapshot = createStateSyncSnapshot(payload)
      snapshotDurationMs = roundedDurationMs(snapshotStartedAt)
    }
    if (debug) {
      this.logSessionLoadDebug("state_sync:client_send", {
        contextId: context.id,
        clientId: client.id,
        sessionKey: payload.sessionKey,
        forceFull: Boolean(options?.forceFull),
        sent,
        patchDurationMs,
        sendDurationMs,
        snapshotDurationMs,
        durationMs: roundedDurationMs(startedAt),
        fieldCount: Object.keys(nextPayload).length,
        includesMessages: Object.prototype.hasOwnProperty.call(
          nextPayload,
          "messages"
        ),
        messageCount: nextPayload.messages?.length,
        approxBytes: JSON.stringify(nextPayload).length,
      })
    }
    return sent
  }

  private broadcastToViewers(sessionKey: string, payload: unknown) {
    for (const context of this.contexts.values()) {
      if (context.activeKey === sessionKey) {
        this.sendToContext(context, payload)
      }
    }
  }

  private sendStateToContext(
    context: ContextState,
    options?: { forceFull?: boolean }
  ) {
    const entry = this.getActiveEntry(context)
    if (!entry) return

    const startedAt = performance.now()
    const payloadStartedAt = performance.now()
    const payload = this.currentStatePayload(entry)
    const payloadDurationMs = roundedDurationMs(payloadStartedAt)
    let sentCount = 0
    for (const client of context.clients) {
      if (this.sendStatePayloadToClient(context, client, payload, options)) {
        sentCount += 1
      }
    }
    this.logSessionLoadDebug("state_sync:context_send", {
      contextId: context.id,
      clientCount: context.clients.size,
      sentCount,
      forceFull: Boolean(options?.forceFull),
      payloadDurationMs,
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(entry),
    })
  }

  private async sendSessionsToContext(context: ContextState) {
    if (context.clients.size === 0) {
      this.logSessionLoadDebug("sessions_payload:context_skip_no_clients", {
        contextId: context.id,
      })
      return
    }

    const startedAt = performance.now()
    const payload = await this.listSessionsPayload(context)
    this.sendToContext(context, payload)
    this.logSessionLoadDebug("sessions_payload:context_send", {
      contextId: context.id,
      clientCount: context.clients.size,
      directoryCount: payload.directories.length,
      directoryStateCount: payload.directoryStates.length,
      activeSessionId: payload.activeSessionId,
      activeSessionPath: payload.activeSessionPath,
      durationMs: roundedDurationMs(startedAt),
      approxBytes: isSessionLoadDebugEnabled()
        ? JSON.stringify(payload).length
        : undefined,
    })
  }

  private sessionStatusPayload(
    context: ContextState,
    entry: SessionEntry
  ): SessionStatusEvent {
    const sessionPath = this.getSessionPath(entry)

    return {
      type: "session_status",
      sessionKey: entry.key,
      sessionId: entry.session.sessionId,
      sessionPath: entry.session.sessionFile,
      streaming: this.getEntryStreamingState(entry),
      unread: context.unreadFinished.has(sessionPath),
    }
  }

  private sendSessionStatusToContext(
    context: ContextState,
    entry: SessionEntry
  ) {
    this.sendToContext(context, this.sessionStatusPayload(context, entry))
  }

  private broadcastSessionStatusAll(entry: SessionEntry) {
    for (const context of this.contexts.values()) {
      this.sendSessionStatusToContext(context, entry)
    }
  }

  private async broadcastSessionsAll() {
    const connectedContexts = [...this.contexts.values()].filter(
      (context) => context.clients.size > 0
    )
    if (connectedContexts.length === 0) {
      this.logSessionLoadDebug("sessions_payload:broadcast_skip_no_clients")
      return
    }

    await Promise.all(
      connectedContexts.map((context) => this.sendSessionsToContext(context))
    )
  }

  private syncGitWatchDirectories() {
    const cwds = new Set<string>()
    for (const context of this.contexts.values()) {
      if (context.clients.size === 0) continue

      const entry = this.getActiveEntry(context)
      const cwd = entry
        ? normalizeRuntimeGitCwd(this.getBaseCwd(entry, context))
        : ""
      if (cwd) {
        cwds.add(cwd)
      }
    }

    for (const cwd of this.gitFingerprints.keys()) {
      if (!cwds.has(cwd)) {
        this.gitFingerprints.delete(cwd)
      }
    }

    this.gitWatchManager.setWatchedDirectories(cwds)
    this.primeGitFingerprints(cwds)
  }

  private primeGitFingerprints(cwds: Iterable<string>) {
    for (const cwd of cwds) {
      if (this.gitFingerprints.has(cwd)) continue
      if (this.primingGitFingerprints.has(cwd)) continue

      this.primingGitFingerprints.add(cwd)
      void readDirectoryGitFingerprint(cwd)
        .then((fingerprint) => {
          this.gitFingerprints.set(cwd, fingerprint)
        })
        .catch(() => undefined)
        .finally(() => {
          this.primingGitFingerprints.delete(cwd)
        })
    }
  }

  private gitChangedScopes(
    previous: GitRepositoryFingerprint | null,
    next: GitRepositoryFingerprint | null
  ) {
    if (!previous || !next) {
      return ["status", "files", "refs"] satisfies Array<GitChangedScope>
    }

    const scopes: Array<GitChangedScope> = []
    if (previous.statusKey !== next.statusKey) scopes.push("status")
    if (previous.filesKey !== next.filesKey) scopes.push("files")
    if (previous.refsKey !== next.refsKey) scopes.push("refs")
    return scopes
  }

  private sameGitFingerprint(
    previous: GitRepositoryFingerprint | null,
    next: GitRepositoryFingerprint | null
  ) {
    if (!previous || !next) return previous === next
    return (
      previous.statusKey === next.statusKey &&
      previous.filesKey === next.filesKey &&
      previous.refsKey === next.refsKey
    )
  }

  private async handleGitWatchChange(change: GitWatchChange) {
    const previous = this.gitFingerprints.get(change.cwd)
    let next: Awaited<ReturnType<typeof readDirectoryGitFingerprint>>
    try {
      next = await readDirectoryGitFingerprint(change.cwd)
    } catch {
      return
    }
    this.gitFingerprints.set(change.cwd, next)

    if (previous !== undefined && this.sameGitFingerprint(previous, next)) {
      return
    }

    const scopes =
      previous === undefined
        ? (["status", "files", "refs"] satisfies Array<GitChangedScope>)
        : this.gitChangedScopes(previous, next)
    if (scopes.length === 0) return

    invalidateDirectoryGitCaches(change.cwd)

    for (const context of this.contexts.values()) {
      if (context.clients.size === 0) continue

      const entry = this.getActiveEntry(context)
      const cwd = entry ? this.getBaseCwd(entry, context).trim() : ""
      if (!cwd || normalizeRuntimeGitCwd(cwd) !== change.cwd) continue

      const payload = {
        type: "git_changed",
        cwd,
        repositoryRoot: change.repositoryRoot,
        changedAt: Date.now(),
        scopes,
      } satisfies GitChangedEvent
      this.sendToContext(context, payload)
    }
  }

  private markUnreadFinished(entry: SessionEntry) {
    const sessionPath = this.getSessionPath(entry)
    for (const context of this.contexts.values()) {
      if (context.activeKey !== entry.key) {
        context.unreadFinished.add(sessionPath)
      }
    }
  }

  private pendingSdkMessageCount(entry: SessionEntry) {
    const steeringCount = entry.session.getSteeringMessages?.().length ?? 0
    const followUpCount = entry.session.getFollowUpMessages?.().length ?? 0
    return steeringCount + followUpCount
  }

  private isSessionBusyForDone(entry: SessionEntry) {
    return (
      this.getEntryStreamingState(entry) ||
      Boolean(entry.session.isStreaming) ||
      Boolean(entry.session.isRetrying) ||
      Boolean(entry.session.isCompacting) ||
      this.pendingSdkMessageCount(entry) > 0 ||
      entry.pendingUserMessages.length > 0
    )
  }

  private clearSessionDoneTimeout(entry: SessionEntry) {
    if (!entry.doneCheckTimeout) return
    clearTimeout(entry.doneCheckTimeout)
    entry.doneCheckTimeout = undefined
  }

  private clearPendingSessionDone(entry: SessionEntry) {
    this.clearSessionDoneTimeout(entry)
    entry.pendingDoneReason = undefined
    entry.pendingDoneOutcome = undefined
  }

  private scheduleSessionDoneCheck(
    entry: SessionEntry,
    reason: SessionDoneReason,
    outcome: SessionDoneOutcome = "success"
  ) {
    entry.pendingDoneReason = reason
    entry.pendingDoneOutcome = outcome
    this.clearSessionDoneTimeout(entry)
    entry.doneCheckTimeout = setTimeout(() => {
      entry.doneCheckTimeout = undefined
      void this.maybeSignalSessionDone(entry)
    }, 0)
  }

  private agentEndOutcome(event: SessionEventLike) {
    const messages = Array.isArray(event.messages) ? event.messages : []

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index] as MessageLike | undefined
      if (message?.role !== "assistant") continue

      const stopReason =
        typeof message.stopReason === "string" ? message.stopReason : ""
      if (stopReason === "aborted") return "aborted" as const
      if (stopReason === "error" || message.errorMessage) {
        return "error" as const
      }
      return "success" as const
    }

    return "success" as const
  }

  private sessionDoneSignalSignature(
    entry: SessionEntry,
    reason: SessionDoneReason,
    outcome: SessionDoneOutcome
  ) {
    return [
      reason,
      outcome,
      this.getSessionPath(entry),
      entry.modifiedAt || "",
      entry.session.messages.length,
    ].join(":")
  }

  private sessionDonePayload(
    entry: SessionEntry,
    reason: SessionDoneReason,
    outcome: SessionDoneOutcome
  ): SessionDoneEvent {
    const firstMessage = this.getSessionFirstMessage(entry)
    const name = entry.session.sessionName
    return {
      type: "session_done",
      id: `done:${cryptoRandomId()}`,
      sessionKey: entry.key,
      sessionId: entry.session.sessionId,
      sessionPath: entry.session.sessionFile,
      cwd: entry.cwd,
      title: getSessionListTitle({ name, firstMessage }),
      reason,
      outcome,
      completedAt: new Date().toISOString(),
    }
  }

  private async signalSessionDone(
    entry: SessionEntry,
    reason: SessionDoneReason,
    outcome: SessionDoneOutcome
  ) {
    const signature = this.sessionDoneSignalSignature(entry, reason, outcome)
    if (entry.lastDoneSignalSignature === signature) return
    entry.lastDoneSignalSignature = signature

    const payload = this.sessionDonePayload(entry, reason, outcome)
    this.markUnreadFinished(entry)

    for (const context of this.contexts.values()) {
      this.sendToContext(context, payload)
      this.sendSessionStatusToContext(context, entry)
    }

    await this.broadcastSessionsAll()
  }

  private async maybeSignalSessionDone(entry: SessionEntry) {
    if (this.sessionEntries.get(entry.key) !== entry) return

    const reason = entry.pendingDoneReason
    const outcome = entry.pendingDoneOutcome ?? "success"
    if (!reason) return

    this.reconcilePendingUserMessages(entry)

    if (this.isSessionBusyForDone(entry)) return

    entry.pendingDoneReason = undefined
    entry.pendingDoneOutcome = undefined

    if (entry.doneNotificationSuppressed) {
      entry.doneNotificationSuppressed = false
      return
    }

    await this.signalSessionDone(entry, reason, outcome)
  }

  private async activateContextSession(
    context: ContextState,
    entry: SessionEntry,
    options?: { notify?: boolean; refreshSessions?: boolean }
  ) {
    const previousActiveKey = context.activeKey
    const startedAt = performance.now()
    await activateRuntimeContextSession({
      context,
      entry,
      getSessionEntryByKey: (key) => this.sessionEntries.get(key),
      isDraftEntry: (sessionEntry) => this.isDraftEntry(sessionEntry),
      disposeDraftIfUnused: async (draftEntry) =>
        await this.disposeDraftIfUnused(draftEntry),
      getSessionPath: (sessionEntry) => this.getSessionPath(sessionEntry),
      sendStateToContext: (activeContext) =>
        this.sendStateToContext(activeContext),
      sendSessionsToContext: async (activeContext) => {
        if (!options?.refreshSessions) {
          this.logSessionLoadDebug("sessions_payload:activation_skip", {
            contextId: activeContext.id,
            reason: "active-session-only",
          })
          return
        }
        await this.sendSessionsToContext(activeContext)
      },
      afterActiveChanged: async () =>
        await this.disposeUnreferencedSessionEntries(),
      notify: options?.notify,
    })
    const statusStartedAt = performance.now()
    if (options?.notify !== false) {
      this.sendSessionStatusToContext(context, entry)
    }
    const statusDurationMs = roundedDurationMs(statusStartedAt)
    const gitStartedAt = performance.now()
    this.syncGitWatchDirectories()
    this.logSessionLoadDebug("context_session:activate", {
      contextId: context.id,
      previousActiveKey,
      notify: options?.notify !== false,
      statusDurationMs,
      gitWatchDurationMs: roundedDurationMs(gitStartedAt),
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(entry),
    })
  }

  private async disposeDraftIfUnused(entry: SessionEntry | undefined) {
    if (!entry || !this.isDraftEntry(entry)) return

    const stillReferenced = [...this.contexts.values()].some(
      (context) =>
        context.activeKey === entry.key || context.draftKey === entry.key
    )
    if (!stillReferenced) {
      await this.disposeSessionEntry(entry)
    }
  }

  private async clearContextDraft(context: ContextState) {
    await clearRuntimeContextDraft({
      context,
      getSessionEntryByKey: (key) => this.sessionEntries.get(key),
      disposeDraftIfUnused: async (draftEntry) =>
        await this.disposeDraftIfUnused(draftEntry),
    })
  }

  private async ensureSessionEntryById(sessionId: string) {
    const startedAt = performance.now()
    for (const entry of this.sessionEntries.values()) {
      if (entry.session.sessionId === sessionId) {
        this.logSessionLoadDebug("session_entry_by_id:cache_hit", {
          sessionId,
          durationMs: roundedDurationMs(startedAt),
          ...this.sessionDebugDetails(entry),
        })
        return entry
      }
    }

    this.logSessionLoadDebug("session_entry_by_id:cache_miss", {
      sessionId,
      loadedEntryCount: this.sessionEntries.size,
    })
    const sessions = await this.listSessionIndexEntries()
    const match = sessions.find((entry) => entry.id === sessionId && entry.path)
    if (!match?.path) {
      this.logSessionLoadDebug("session_entry_by_id:not_found", {
        sessionId,
        durationMs: roundedDurationMs(startedAt),
        indexEntryCount: sessions.length,
      })
      return undefined
    }
    const entry = await this.ensureSessionEntryByPath(match.path)
    this.logSessionLoadDebug("session_entry_by_id:loaded", {
      sessionId,
      sessionPath: match.path,
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(entry),
    })
    return entry
  }

  private async getOrCreateDraftEntry(context: ContextState) {
    const desiredCwd = resolveScopeCwd(context.sessionScope, process.cwd())
    const existing = context.draftKey
      ? this.sessionEntries.get(context.draftKey)
      : undefined
    if (
      existing &&
      this.isDraftEntry(existing) &&
      existing.cwd === desiredCwd
    ) {
      context.activeKey = existing.key
      this.syncGitWatchDirectories()
      return existing
    }
    if (existing) {
      await this.clearContextDraft(context)
    }
    const draftEntry = await this.createNewSessionEntry(desiredCwd, {
      draft: true,
    })
    context.draftKey = draftEntry.key
    context.activeKey = draftEntry.key
    this.syncGitWatchDirectories()
    return draftEntry
  }

  private async resolveRequestedEntry(
    url: URL,
    context: ContextState,
    options?: { notifyOnActivate?: boolean }
  ) {
    return await resolveRuntimeRequestedEntry({
      url,
      context,
      getSessionEntryByKey: (key) => this.sessionEntries.get(key),
      ensureSessionEntryById: async (sessionId) =>
        await this.ensureSessionEntryById(sessionId),
      getActiveEntry: (activeContext) => this.getActiveEntry(activeContext),
      getOrCreateDraftEntry: async (activeContext) =>
        await this.getOrCreateDraftEntry(activeContext),
      activateContextSession: async (activeContext, entry, activateOptions) =>
        await this.activateContextSession(
          activeContext,
          entry,
          activateOptions
        ),
      notifyOnActivate: options?.notifyOnActivate,
    })
  }

  async resolveRequest(
    request: Request,
    options?: { notifyOnActivate?: boolean }
  ): Promise<ResolveRequestResult> {
    const startedAt = performance.now()
    const url = new URL(request.url)
    const context = this.ensureContext(
      url.searchParams.get("context") || "default"
    )
    context.sessionScope = normalizeSessionScope(
      url.searchParams.get("scope"),
      process.cwd()
    )
    this.logSessionLoadDebug("request_resolve:start", {
      pathname: url.pathname,
      contextId: context.id,
      requestedSession: url.searchParams.get("session"),
      requestedSessionKey: url.searchParams.get("sessionKey"),
      notifyOnActivate: options?.notifyOnActivate ?? false,
      scope: context.sessionScope,
    })
    try {
      const activeEntry = await this.resolveRequestedEntry(url, context, {
        notifyOnActivate: options?.notifyOnActivate ?? false,
      })
      this.logSessionLoadDebug("request_resolve:done", {
        pathname: url.pathname,
        contextId: context.id,
        durationMs: roundedDurationMs(startedAt),
        ...this.sessionDebugDetails(activeEntry),
      })
      return { url, context, activeEntry }
    } catch (error) {
      this.logSessionLoadDebug("request_resolve:error", {
        pathname: url.pathname,
        contextId: context.id,
        durationMs: roundedDurationMs(startedAt),
        error: safeErrorMessage(error),
      })
      throw error
    }
  }

  getBaseCwd(activeEntry: SessionEntry, context: ContextState) {
    return (
      activeEntry.cwd || resolveScopeCwd(context.sessionScope, process.cwd())
    )
  }

  private async createSessionEntryFromRuntime(
    runtime: AgentSessionRuntimeLike,
    options?: {
      draft?: boolean
    }
  ) {
    const startedAt = performance.now()
    this.logRuntimeDiagnostics(runtime.diagnostics)

    const session = runtime.session
    const services = runtime.services
    const cwd = runtime.cwd
    const key = session.sessionFile ?? `ephemeral:${cryptoRandomId()}`
    const existing = this.sessionEntries.get(key)
    if (existing) {
      const disposeStartedAt = performance.now()
      await runtime.dispose()
      this.logSessionLoadDebug("session_entry:create_duplicate", {
        key,
        cwd,
        disposeDurationMs: roundedDurationMs(disposeStartedAt),
        durationMs: roundedDurationMs(startedAt),
        ...this.sessionDebugDetails(existing),
      })
      return existing
    }

    const entry: SessionEntry = {
      key,
      cwd,
      services,
      runtime,
      session,
      draft: Boolean(options?.draft),
      streamingState: Boolean(session.isStreaming),
      compactingState: false,
      retainedConversationItems: createRetainedConversationState(
        session.messages.map((message) => sanitizeSessionMessage(message))
      ).items,
      pendingUserMessages: [],
      pendingQueueMutation: false,
      canceledPendingUserMessageIds: new Set(),
      firstMessageHint: "",
      modifiedAt: undefined,
      lastUserMessageAt: undefined,
      uiState: createInitialUiState(),
      unsubscribe: undefined,
      restoreSessionMetadataSync: undefined,
      sessionNaming: {
        nonce: 0,
        pendingGeneration: false,
        managedSessionName: undefined,
        disposed: false,
      },
      promptRequestChain: Promise.resolve(),
      doneNotificationSuppressed: false,
    }

    this.sessionEntries.set(key, entry)
    const metadataStartedAt = performance.now()
    this.installSessionMetadataSync(entry)
    this.logSessionLoadDebug("session_entry:metadata_sync_installed", {
      durationMs: roundedDurationMs(metadataStartedAt),
      ...this.sessionDebugDetails(entry),
    })
    const autoNameStartedAt = performance.now()
    this.maybeAutoNameSession(entry)
    this.logSessionLoadDebug("session_entry:auto_name_checked", {
      durationMs: roundedDurationMs(autoNameStartedAt),
      ...this.sessionDebugDetails(entry),
    })
    await this.bindSessionEntry(entry)
    this.logSessionLoadDebug("session_entry:create", {
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(entry),
    })
    return entry
  }

  private async createSessionEntry(
    sessionManager: SessionManagerLike,
    options?: {
      draft?: boolean
      sessionStartEvent?: SessionStartEventLike
    }
  ) {
    return await this.timeSessionLoad(
      "session_entry:create_from_manager",
      {
        cwd: sessionManager.getCwd(),
        draft: Boolean(options?.draft),
        reason: options?.sessionStartEvent?.reason,
      },
      async () => {
        const runtime = await this.createSessionRuntime(sessionManager, {
          sessionStartEvent: options?.sessionStartEvent,
        })
        return await this.createSessionEntryFromRuntime(runtime, {
          draft: options?.draft,
        })
      }
    )
  }

  async createNewSessionEntry(
    cwd: string,
    options?: {
      draft?: boolean
      newSessionOptions?: { parentSession?: string }
      sessionDir?: string
      sessionStartEvent?: SessionStartEventLike
    }
  ) {
    const sdk = await this.getSdk()
    const sessionManager = sdk.SessionManager.create(cwd, options?.sessionDir)
    if (options?.newSessionOptions && sessionManager.newSession) {
      sessionManager.newSession(options.newSessionOptions)
    }
    return await this.createSessionEntry(sessionManager, {
      draft: options?.draft,
      sessionStartEvent: options?.sessionStartEvent,
    })
  }

  private async ensureSessionEntryByPath(sessionPath: string) {
    const existing = this.sessionEntries.get(sessionPath)
    if (existing) {
      this.logSessionLoadDebug("session_entry_by_path:cache_hit", {
        sessionPath,
        ...this.sessionDebugDetails(existing),
      })
      return existing
    }

    return await this.timeSessionLoad(
      "session_entry_by_path:load",
      { sessionPath },
      async () => {
        const sdk = await this.getSdk()
        const openStartedAt = performance.now()
        const sessionManager = sdk.SessionManager.open(sessionPath)
        this.logSessionLoadDebug("session_manager:open", {
          sessionPath,
          cwd: sessionManager.getCwd(),
          durationMs: roundedDurationMs(openStartedAt),
        })
        return await this.createSessionEntry(sessionManager, {
          sessionStartEvent: {
            type: "session_start",
            reason: "resume",
          },
        })
      }
    )
  }

  private async cloneSessionManagerForEntry(entry: SessionEntry) {
    const currentManager = entry.session.sessionManager
    if (currentManager.isPersisted?.()) {
      const currentSessionFile = entry.session.sessionFile
      if (!currentSessionFile) {
        throw new Error("Persisted session is missing a session file")
      }

      const sdk = await this.getSdk()
      return sdk.SessionManager.open(
        currentSessionFile,
        currentManager.getSessionDir?.(),
        entry.cwd
      )
    }

    return await this.createForkedInMemorySessionManager(
      currentManager,
      currentManager.getLeafId?.(),
      entry.session.sessionFile
    )
  }

  private async createTransitionSessionEntry(
    sourceEntry: SessionEntry,
    transition: (runtime: AgentSessionRuntimeLike) => Promise<{
      cancelled?: boolean
      draft?: boolean
      selectedText?: string
    }>
  ) {
    const runtime = await this.createSessionRuntime(
      await this.cloneSessionManagerForEntry(sourceEntry)
    )

    try {
      const result = await transition(runtime)
      if (result.cancelled) {
        await runtime.dispose()
        return { cancelled: true as const, entry: undefined }
      }

      const nextEntry = await this.createSessionEntryFromRuntime(runtime, {
        draft: Boolean(result.draft),
      })
      if (result.selectedText && !nextEntry.uiState.editorText) {
        nextEntry.uiState.editorText = result.selectedText
      }
      return { cancelled: false as const, entry: nextEntry }
    } catch (error) {
      await runtime.dispose().catch(() => {})
      throw error
    }
  }

  private installSessionMetadataSync(entry: SessionEntry) {
    if (entry.restoreSessionMetadataSync) return

    const manager = entry.session.sessionManager
    if (!manager || typeof manager.appendSessionInfo !== "function") return

    const originalAppendSessionInfo = manager.appendSessionInfo.bind(manager)
    manager.appendSessionInfo = ((...args: [string]) => {
      const result = originalAppendSessionInfo(...args)
      void this.broadcastEntryState(entry)
      if (!this.getEntryStreamingState(entry)) {
        void this.broadcastSessionsAll()
      }
      return result
    }) satisfies typeof manager.appendSessionInfo

    entry.restoreSessionMetadataSync = () => {
      manager.appendSessionInfo = originalAppendSessionInfo
      entry.restoreSessionMetadataSync = undefined
    }
  }

  private async disposeSessionEntry(entry: SessionEntry) {
    this.clearPendingSessionDone(entry)
    entry.unsubscribe?.()
    entry.restoreSessionMetadataSync?.()
    entry.sessionNaming.disposed = true
    entry.sessionNaming.nonce += 1
    entry.sessionNaming.pendingGeneration = false
    try {
      if (entry.session.isStreaming) {
        await entry.session.abort()
      }
    } catch {
      // ignore abort errors during disposal
    }
    try {
      await entry.runtime.dispose()
    } catch (error) {
      console.error("[pico] session dispose error:", error)
    }
    this.sessionEntries.delete(entry.key)
  }

  private getCurrentSessionName(entry: SessionEntry) {
    return cleanupSessionNameCandidate(entry.session.sessionName)
  }

  private applyManagedSessionName(
    entry: SessionEntry,
    rawName: string,
    mode: "initial" | "refine"
  ) {
    const nextName = cleanupSessionNameCandidate(rawName)
    if (!nextName) return false

    const currentName = this.getCurrentSessionName(entry)
    if (mode === "initial") {
      if (currentName) return false
    } else if (
      currentName &&
      currentName !== entry.sessionNaming.managedSessionName
    ) {
      return false
    }

    if (currentName !== nextName) {
      entry.session.setSessionName(clampSessionNameLength(nextName))
      void this.broadcastEntryState(entry)
      void this.broadcastSessionsAll()
    }
    entry.sessionNaming.managedSessionName = nextName
    return true
  }

  private emitAutoSessionNamingFailure(
    entry: SessionEntry,
    input: {
      heuristicReason?: string
      refinementReason?: string
      text: string
      imageCount: number
    }
  ) {
    console.error("[pico] auto session naming failed:", {
      sessionId: entry.session.sessionId,
      cwd: entry.cwd,
      promptPreview: normalizeSessionListTitle(input.text, 160) || undefined,
      imageCount: input.imageCount,
      heuristicReason: input.heuristicReason,
      refinementReason: input.refinementReason,
    })

    this.broadcastToViewers(entry.key, {
      type: "auto_session_naming_error",
      sessionId: entry.session.sessionId,
      cwd: entry.cwd,
      promptPreview: normalizeSessionListTitle(input.text, 160) || undefined,
      imageCount: input.imageCount,
      heuristicReason: input.heuristicReason,
      refinementReason: input.refinementReason,
    })
  }

  private scheduleSessionNameRefinement(
    entry: SessionEntry,
    text: string,
    imageCount: number,
    heuristicReason?: string
  ) {
    if (entry.sessionNaming.pendingGeneration) return

    entry.sessionNaming.pendingGeneration = true
    const nonce = entry.sessionNaming.nonce
    const sessionId = entry.session.sessionId

    void (async () => {
      try {
        const generated = await generateSessionNameWithLlm(
          {
            cwd: entry.cwd,
            services: {
              modelRegistry: entry.services.modelRegistry,
            },
          },
          text,
          imageCount
        )

        if (!generated?.name) {
          if (
            !entry.sessionNaming.disposed &&
            entry.sessionNaming.nonce === nonce &&
            sessionId === entry.session.sessionId &&
            !this.getCurrentSessionName(entry)
          ) {
            this.emitAutoSessionNamingFailure(entry, {
              heuristicReason,
              refinementReason:
                generated?.reason ||
                "session name refinement returned no usable title",
              text,
              imageCount,
            })
          }
          return
        }

        if (
          entry.sessionNaming.disposed ||
          entry.sessionNaming.nonce !== nonce ||
          sessionId !== entry.session.sessionId
        ) {
          return
        }

        this.applyManagedSessionName(entry, generated.name, "refine")
      } catch (error) {
        if (
          !entry.sessionNaming.disposed &&
          entry.sessionNaming.nonce === nonce &&
          sessionId === entry.session.sessionId &&
          !this.getCurrentSessionName(entry)
        ) {
          this.emitAutoSessionNamingFailure(entry, {
            heuristicReason,
            refinementReason: formatError(error),
            text,
            imageCount,
          })
        }
      } finally {
        if (entry.sessionNaming.nonce === nonce) {
          entry.sessionNaming.pendingGeneration = false
        }
      }
    })()
  }

  private startAutoSessionNaming(
    entry: SessionEntry,
    text: string,
    imageCount: number
  ) {
    if (this.getCurrentSessionName(entry)) return

    const heuristic = deriveHeuristicSessionNameAttempt(text, imageCount)
    if (heuristic.name) {
      this.applyManagedSessionName(entry, heuristic.name, "initial")
    }
    this.scheduleSessionNameRefinement(
      entry,
      text,
      imageCount,
      heuristic.reason
    )
  }

  private maybeAutoNameSession(entry: SessionEntry) {
    if (this.getCurrentSessionName(entry)) return

    for (const message of entry.session.messages) {
      if (message?.role !== "user") continue
      const firstPrompt = summarizePromptContent(message.content)
      if (firstPrompt.text || firstPrompt.imageCount > 0) {
        this.startAutoSessionNaming(
          entry,
          firstPrompt.text,
          firstPrompt.imageCount
        )
        return
      }
    }

    if (entry.firstMessageHint.trim()) {
      this.startAutoSessionNaming(entry, entry.firstMessageHint.trim(), 0)
    }
  }

  private reconcilePendingUserMessages(
    entry: SessionEntry,
    queueState?: { steering: readonly string[]; followUp: readonly string[] }
  ) {
    const nextQueueState = queueState ?? {
      steering: entry.session.getSteeringMessages?.() ?? [],
      followUp: entry.session.getFollowUpMessages?.() ?? [],
    }

    const steering = [...nextQueueState.steering].filter(
      (text): text is string => typeof text === "string"
    )
    const followUp = [...nextQueueState.followUp].filter(
      (text): text is string => typeof text === "string"
    )
    const pending = entry.pendingUserMessages.map((message) =>
      clonePendingUserMessage(message)
    )

    const steeringCounts = new Map<string, number>()
    const followUpCounts = new Map<string, number>()

    for (const text of steering) {
      steeringCounts.set(text, (steeringCounts.get(text) ?? 0) + 1)
    }
    for (const text of followUp) {
      followUpCounts.set(text, (followUpCounts.get(text) ?? 0) + 1)
    }

    const nextPending: Array<PendingUserMessage> = []
    for (const message of pending) {
      const counts =
        message.streamingBehavior === "steer" ? steeringCounts : followUpCounts
      const count = counts.get(message.text) ?? 0
      if (count > 0) {
        nextPending.push(message)
        counts.set(message.text, count - 1)
      }
    }

    for (const text of steering) {
      const count = steeringCounts.get(text) ?? 0
      if (count <= 0) continue
      nextPending.push(createPendingUserMessage(text, [], "steer"))
      steeringCounts.set(text, count - 1)
    }

    for (const text of followUp) {
      const count = followUpCounts.get(text) ?? 0
      if (count <= 0) continue
      nextPending.push(createPendingUserMessage(text, [], "followUp"))
      followUpCounts.set(text, count - 1)
    }

    entry.pendingUserMessages = sortPendingUserMessages(nextPending)
    return entry.pendingUserMessages
  }

  private pendingMessagesFromClientUpdate(
    entry: SessionEntry,
    pendingMessagesUpdate: unknown
  ) {
    const pendingMessages = entry.pendingUserMessages.map((message) =>
      clonePendingUserMessage(message)
    )
    const normalizedUpdates: Array<{
      pendingId: string
      hasImages: boolean
      hasText: boolean
      images: Array<PromptImageInput>
      streamingBehavior?: "steer" | "followUp"
      text: string
    }> = Array.isArray(pendingMessagesUpdate)
      ? pendingMessagesUpdate
          .map((message) => {
            const hasImages = hasOwnProperty(message, "images")
            const hasText = hasOwnProperty(message, "text")
            return {
              pendingId:
                typeof message?.pendingId === "string" ? message.pendingId : "",
              hasImages,
              hasText,
              images: hasImages ? normalizePromptImages(message?.images) : [],
              streamingBehavior: normalizePendingStreamingBehavior(
                message?.streamingBehavior
              ),
              text:
                hasText && typeof message?.text === "string"
                  ? message.text
                  : "",
            }
          })
          .filter((message) => Boolean(message.pendingId))
      : []

    if (normalizedUpdates.length !== pendingMessages.length) {
      throw new Error(
        "pendingMessages must include every pending prompt exactly once."
      )
    }

    const pendingMessagesById = new Map(
      pendingMessages.map((message) => [message.pendingId, message])
    )
    if (pendingMessagesById.size !== pendingMessages.length) {
      throw new Error(
        "Pending prompt order is out of date. Refresh and try again."
      )
    }

    const nextPendingMessages: Array<PendingUserMessage> = []
    for (const update of normalizedUpdates) {
      const existing = pendingMessagesById.get(update.pendingId)
      if (!existing) {
        throw new Error(
          "pendingMessages must include every pending prompt exactly once."
        )
      }
      const text = update.hasText ? update.text : existing.text
      const images = update.hasImages ? update.images : existing.images
      if (!text.trim() && images.length === 0) {
        throw new Error("Pending prompt text or image is required.")
      }

      nextPendingMessages.push({
        ...existing,
        text,
        images,
        streamingBehavior:
          update.streamingBehavior ?? existing.streamingBehavior,
      })
      pendingMessagesById.delete(update.pendingId)
    }

    if (pendingMessagesById.size > 0) {
      throw new Error(
        "pendingMessages must include every pending prompt exactly once."
      )
    }

    return sortPendingUserMessages(nextPendingMessages)
  }

  private async replacePendingUserMessages(
    entry: SessionEntry,
    pendingMessages: Array<PendingUserMessage>
  ) {
    const nextPending = sortPendingUserMessages(pendingMessages)
    const canReplayPending = Boolean(entry.session.isStreaming)

    if (!canReplayPending && nextPending.length > 0) {
      throw new Error(
        "Pending prompts can only be changed while the session is streaming."
      )
    }

    entry.pendingQueueMutation = true
    try {
      entry.session.clearQueue()
      entry.pendingUserMessages = []

      if (canReplayPending) {
        for (const pendingMessage of nextPending) {
          const text = pendingMessage.text
          const images = normalizePromptImages(pendingMessage.images)
          if (!text.trim() && images.length === 0) continue
          await entry.session.prompt(text, {
            ...(images.length > 0 ? { images } : {}),
            streamingBehavior: pendingMessage.streamingBehavior,
          })
        }
      }

      entry.pendingUserMessages = nextPending
      this.reconcilePendingUserMessages(entry)
    } finally {
      entry.pendingQueueMutation = false
    }

    await this.broadcastEntryState(entry)
    return entry.pendingUserMessages
  }

  private async bindSessionEntry(entry: SessionEntry) {
    const startedAt = performance.now()
    const unsubscribeStartedAt = performance.now()
    entry.unsubscribe?.()
    this.logSessionLoadDebug("session_entry:unsubscribe_previous", {
      durationMs: roundedDurationMs(unsubscribeStartedAt),
      ...this.sessionDebugDetails(entry),
    })
    const session = entry.session
    entry.retainedConversationItems = createRetainedConversationState(
      session.messages.map((message) => sanitizeSessionMessage(message))
    ).items

    const viewers = () =>
      [...this.contexts.values()].filter(
        (context) => context.activeKey === entry.key
      )

    const uiRequestBridge = createUiRequestBridge({
      entryKey: entry.key,
      pendingUiRequests: this.pendingUiRequests,
      createRequestId: cryptoRandomId,
      broadcastToViewers: (sessionKey, payload) =>
        this.broadcastToViewers(sessionKey, payload),
    })

    const bindStartedAt = performance.now()
    await session.bindExtensions({
      uiContext: {
        select: (
          title: string,
          options: Array<unknown>,
          opts?: { signal?: AbortSignal; timeout?: number }
        ) =>
          uiRequestBridge.createDialogPromise(
            undefined,
            {
              signal: opts?.signal,
              timeout: opts?.timeout,
              payload: {
                method: "select",
                title,
                options,
                timeout: opts?.timeout,
              },
            },
            (response) =>
              response.cancelled
                ? undefined
                : (response.value as string | undefined)
          ),
        confirm: (
          title: string,
          message: string,
          opts?: { signal?: AbortSignal; timeout?: number }
        ) =>
          uiRequestBridge.createDialogPromise(
            false,
            {
              signal: opts?.signal,
              timeout: opts?.timeout,
              payload: {
                method: "confirm",
                title,
                message,
                timeout: opts?.timeout,
              },
            },
            (response) =>
              response.cancelled ? false : Boolean(response.confirmed)
          ),
        input: (
          title: string,
          placeholder?: string,
          opts?: { signal?: AbortSignal; timeout?: number }
        ) =>
          uiRequestBridge.createDialogPromise(
            undefined,
            {
              signal: opts?.signal,
              timeout: opts?.timeout,
              payload: {
                method: "input",
                title,
                placeholder,
                timeout: opts?.timeout,
              },
            },
            (response) =>
              response.cancelled
                ? undefined
                : (response.value as string | undefined)
          ),
        editor: (title: string, prefill?: string) =>
          uiRequestBridge.createDialogPromise(
            undefined,
            {
              payload: {
                method: "editor",
                title,
                prefill,
              },
            },
            (response) =>
              response.cancelled
                ? undefined
                : (response.value as string | undefined)
          ),
        notify: (message: string, type = "info") => {
          uiRequestBridge.notify(message, type)
        },
        onTerminalInput: () => () => {},
        setStatus: (key: string, text: string | undefined) => {
          if (!text) {
            delete entry.uiState.statuses[key]
          } else {
            entry.uiState.statuses[key] = text
          }
          void this.broadcastEntryState(entry)
        },
        setWorkingMessage: (message: string | undefined) => {
          entry.uiState.workingMessage = message
          void this.broadcastEntryState(entry)
        },
        setWidget: () => {},
        setFooter: () => {},
        setHeader: () => {},
        setTitle: (title: string | undefined) => {
          entry.uiState.title = title
          void this.broadcastEntryState(entry)
        },
        custom: async () => {
          throw new Error(
            "Custom extension UI is not supported in Pico browser mode."
          )
        },
        pasteToEditor: (text: string) => {
          entry.uiState.editorText = `${entry.uiState.editorText ?? ""}${text}`
          void this.broadcastEntryState(entry)
        },
        setEditorText: (text: string) => {
          entry.uiState.editorText = text
          void this.broadcastEntryState(entry)
        },
        getEditorText: () => entry.uiState.editorText ?? "",
        setEditorComponent: () => {},
        theme: identityTheme,
        getAllThemes: () => [],
        getTheme: () => undefined,
        setTheme: () => ({
          success: false,
          error: "Theme switching is not supported in Pico browser mode.",
        }),
      },
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async (newSessionOptions?: { parentSession?: string }) => {
          const result = await this.createTransitionSessionEntry(
            entry,
            async (runtime) => {
              const next = await runtime.newSession({
                parentSession: newSessionOptions?.parentSession,
              })
              return {
                cancelled: next.cancelled,
                draft: true,
              }
            }
          )
          if (!result.entry) {
            return { sessionId: undefined, sessionFile: undefined }
          }

          for (const context of viewers()) {
            context.draftKey = result.entry.key
            await this.activateContextSession(context, result.entry)
          }
          await this.broadcastSessionsAll()
          return { sessionId: undefined, sessionFile: undefined }
        },
        fork: async (branchEntryId: string) => {
          const branchedPath =
            session.sessionManager.createBranchedSession?.(branchEntryId)
          if (!branchedPath) {
            return { cancelled: true }
          }
          const nextEntry = await this.ensureSessionEntryByPath(branchedPath)
          for (const context of viewers()) {
            await this.activateContextSession(context, nextEntry)
          }
          await this.broadcastSessionsAll()
          return {
            sessionId: nextEntry.session.sessionId,
            sessionFile: nextEntry.session.sessionFile,
          }
        },
        navigateTree: async (
          targetId: string,
          navigateOptions?: {
            summarize?: boolean
            customInstructions?: string
            replaceInstructions?: boolean
            label?: string
          }
        ) => {
          const result = await session.navigateTree(targetId, navigateOptions)
          if (result.editorText != null) {
            entry.uiState.editorText = result.editorText
          }
          await this.broadcastEntryState(entry)
          if (result.summaryEntry) {
            this.touchSessionEntry(entry)
            await this.broadcastSessionsAll()
          }
          return {
            cancelled: Boolean(result.cancelled),
            aborted: Boolean(result.aborted),
          }
        },
        switchSession: async (sessionPath: string) => {
          const result = await this.createTransitionSessionEntry(
            entry,
            async (runtime) => {
              const next = await runtime.switchSession(sessionPath)
              return { cancelled: next.cancelled, draft: false }
            }
          )
          const nextEntry = result.entry
          if (!nextEntry) {
            return {
              sessionId: entry.session.sessionId,
              sessionFile: entry.session.sessionFile,
            }
          }
          for (const context of viewers()) {
            await this.activateContextSession(context, nextEntry)
          }
          await this.broadcastSessionsAll()
          return {
            sessionId: nextEntry.session.sessionId,
            sessionFile: nextEntry.session.sessionFile,
          }
        },
        reload: async () => {
          await session.reload?.()
          await this.bindSessionEntry(entry)
          await this.broadcastEntryState(entry)
          await this.broadcastSessionsAll()
        },
      },
      shutdownHandler: () => {
        this.dispose().catch((error) => {
          console.error("[pico] shutdown failed:", error)
        })
      },
      onError: (error: Record<string, unknown>) => {
        this.broadcastToViewers(entry.key, {
          type: "extension_error",
          ...error,
        })
      },
    })

    this.logSessionLoadDebug("session_entry:bind_extensions", {
      durationMs: roundedDurationMs(bindStartedAt),
      ...this.sessionDebugDetails(entry),
    })
    const subscribeStartedAt = performance.now()
    entry.unsubscribe = session.subscribe((event) => {
      void this.handleSessionEvent(entry, event)
    })
    this.logSessionLoadDebug("session_entry:subscribe", {
      durationMs: roundedDurationMs(subscribeStartedAt),
      ...this.sessionDebugDetails(entry),
    })
    this.logSessionLoadDebug("session_entry:bind", {
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(entry),
    })
  }

  private async broadcastEntryState(entry: SessionEntry) {
    for (const context of this.contexts.values()) {
      if (context.activeKey === entry.key) {
        this.sendStateToContext(context)
      }
    }
  }

  private applyRetainedConversationEvent(
    entry: SessionEntry,
    event: SessionEventLike
  ) {
    const type = typeof event.type === "string" ? event.type : ""
    if (type === "compaction_end" && !event.aborted && event.result) {
      const result =
        event.result && typeof event.result === "object" ? event.result : {}
      const state = createRetainedConversationState(
        entry.session.messages.map((message) => sanitizeSessionMessage(message))
      )
      const summary = (result as { summary?: unknown }).summary
      const tokensBefore = (result as { tokensBefore?: unknown }).tokensBefore
      state.items = [
        ...state.items,
        createCompactionSummaryItem(
          summary,
          tokensBefore,
          `compaction:live:${state.items.length}`
        ),
      ]
      entry.retainedConversationItems = state.items
      return
    }

    const retainedEvent = {
      ...event,
      ...(event.message
        ? { message: sanitizeSessionMessage(event.message) }
        : {}),
    }
    const state = { items: entry.retainedConversationItems }
    applyRetainedConversationEvent(state, retainedEvent)
    entry.retainedConversationItems = state.items
  }

  private async handleSessionEvent(
    entry: SessionEntry,
    event: SessionEventLike
  ) {
    const type = typeof event.type === "string" ? event.type : ""

    this.applyRetainedConversationEvent(entry, event)

    let statusChanged = false

    if (type === "agent_start") {
      this.clearPendingSessionDone(entry)
      entry.doneNotificationSuppressed = false
      entry.streamingState = true
      statusChanged = true
    }

    if (type === "compaction_start") {
      entry.compactingState = true
      this.clearSessionDoneTimeout(entry)
    }

    if (type === "auto_retry_start") {
      this.clearSessionDoneTimeout(entry)
    }

    if (type === "queue_update") {
      if (!entry.pendingQueueMutation) {
        this.reconcilePendingUserMessages(entry, {
          steering: Array.isArray(event.steering) ? event.steering : [],
          followUp: Array.isArray(event.followUp) ? event.followUp : [],
        })
      }
    }

    if (type === "message_end" && event.message?.role === "user") {
      this.touchSessionEntry(entry)
      this.reconcilePendingUserMessages(entry)
    }

    if (type === "compaction_end") {
      entry.compactingState = false
      this.touchSessionEntry(entry)

      const compactionReason =
        typeof event.reason === "string" ? event.reason : ""
      const compactionSucceeded = Boolean(event.result) && !event.aborted
      const willRetry = Boolean(event.willRetry)

      if (compactionReason === "manual" && compactionSucceeded) {
        this.scheduleSessionDoneCheck(entry, "manual_compaction")
      } else if (entry.pendingDoneReason === "agent" && !willRetry) {
        this.scheduleSessionDoneCheck(
          entry,
          "agent",
          entry.pendingDoneOutcome ?? "success"
        )
      }
    }

    if (type === "auto_retry_end") {
      if (entry.pendingDoneReason === "agent" && event.success === false) {
        this.scheduleSessionDoneCheck(entry, "agent", "error")
      }
    }

    if (type === "agent_end") {
      entry.streamingState = false
      this.touchSessionEntry(entry)
      this.reconcilePendingUserMessages(entry)

      const outcome = this.agentEndOutcome(event)
      if (outcome === "aborted") {
        this.clearPendingSessionDone(entry)
        entry.doneNotificationSuppressed = false
      } else {
        this.scheduleSessionDoneCheck(entry, "agent", outcome)
      }
      statusChanged = true
    }

    if (statusChanged) {
      this.broadcastSessionStatusAll(entry)
    }

    await this.broadcastEntryState(entry)

    if (
      type === "agent_start" ||
      type === "agent_end" ||
      type === "message_end" ||
      type === "compaction_end" ||
      type === "queue_update"
    ) {
      await this.broadcastSessionsAll()
    }

    if (type === "agent_end" || type === "compaction_end") {
      await this.cleanupInactiveContexts()
    }
  }

  private writeRawToClient(
    context: ContextState,
    client: SseClient,
    text: string
  ) {
    return writeRuntimeRawToClient({
      encoder: this.encoder,
      context,
      client,
      text,
      closeSseClient: (activeContext, activeClient) =>
        this.closeSseClient(
          activeContext as ContextState,
          activeClient as SseClient
        ),
    })
  }

  private sendPayloadToClient(
    context: ContextState,
    client: SseClient,
    payload: unknown
  ) {
    return sendRuntimePayloadToClient({
      encoder: this.encoder,
      context,
      client,
      payload,
      closeSseClient: (activeContext, activeClient) =>
        this.closeSseClient(
          activeContext as ContextState,
          activeClient as SseClient
        ),
    })
  }

  private closeSseClient(context: ContextState, client: SseClient) {
    if (client.closed) return
    client.closed = true
    context.clients.delete(client)
    this.syncGitWatchDirectories()
    try {
      client.controller.close()
    } catch {
      // stream may already be closed
    }
  }

  async createEventsResponse(request: Request) {
    const startedAt = performance.now()
    const { url, context, activeEntry } = await this.resolveRequest(request)
    context.sidebarBootstrapDirectories = normalizeRequestedDirectories(
      url.searchParams.getAll("sidebarDirectory")
    )
    this.logSessionLoadDebug("events_response:create", {
      contextId: context.id,
      sidebarBootstrapDirectoryCount:
        context.sidebarBootstrapDirectories.length,
      durationMs: roundedDurationMs(startedAt),
      ...this.sessionDebugDetails(activeEntry),
    })
    let cleanup: (() => void) | undefined

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const client: SseClient = {
          id: `client:${cryptoRandomId()}`,
          closed: false,
          controller,
          lastStateSyncSnapshot: undefined,
        }
        context.clients.add(client)
        this.syncGitWatchDirectories()
        this.writeRawToClient(context, client, ": connected\n\n")

        void (async () => {
          const bootstrapStartedAt = performance.now()
          try {
            const stateStartedAt = performance.now()
            this.sendStatePayloadToClient(
              context,
              client,
              this.currentStatePayload(activeEntry),
              {
                forceFull: true,
              }
            )
            this.logSessionLoadDebug("events_response:bootstrap_state", {
              contextId: context.id,
              clientId: client.id,
              durationMs: roundedDurationMs(stateStartedAt),
              ...this.sessionDebugDetails(activeEntry),
            })
            if (client.closed || request.signal.aborted) return
            const sessionsStartedAt = performance.now()
            this.sendPayloadToClient(
              context,
              client,
              await this.listSessionsPayload(context, {
                includeBootstrapIndexes: true,
              })
            )
            this.logSessionLoadDebug("events_response:bootstrap_sessions", {
              contextId: context.id,
              clientId: client.id,
              durationMs: roundedDurationMs(sessionsStartedAt),
            })
            this.logSessionLoadDebug("events_response:bootstrap_done", {
              contextId: context.id,
              clientId: client.id,
              durationMs: roundedDurationMs(bootstrapStartedAt),
            })
          } catch (error) {
            if (client.closed || request.signal.aborted) return
            throw error
          }
        })()

        cleanup = () => {
          this.closeSseClient(context, client)
          if (context.clients.size === 0) {
            void this.cleanupInactiveContexts()
          }
        }

        request.signal.addEventListener("abort", () => cleanup?.(), {
          once: true,
        })
      },
      cancel: () => {
        cleanup?.()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    })
  }

  private async runSerializedPromptRequest<T>(
    entry: SessionEntry,
    handler: () => Promise<T>
  ) {
    const previous = entry.promptRequestChain
    let release: (() => void) | undefined
    entry.promptRequestChain = previous
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
    await previous.catch(() => {})
    try {
      return await handler()
    } finally {
      release?.()
    }
  }

  async prompt(
    request: Request,
    body: {
      message?: unknown
      images?: unknown
      streamingBehavior?: unknown
      pendingId?: unknown
      thinkingLevel?: unknown
    }
  ) {
    const { context, activeEntry } = await this.resolveRequest(request)
    const message = typeof body.message === "string" ? body.message : ""
    const images = normalizePromptImages(body.images)
    if (!message.trim() && images.length === 0) {
      throw new Error("message or image is required")
    }

    const requestedThinkingLevel =
      typeof body.thinkingLevel === "string" && body.thinkingLevel
        ? body.thinkingLevel
        : undefined
    if (
      requestedThinkingLevel &&
      !VALID_THINKING_LEVELS.has(requestedThinkingLevel)
    ) {
      throw new Error(
        `Invalid thinking level: ${requestedThinkingLevel || "(empty)"}`
      )
    }

    const streamingBehavior =
      body.streamingBehavior === "steer"
        ? "steer"
        : body.streamingBehavior === "followUp"
          ? "followUp"
          : undefined
    const clientPendingId = normalizeClientPendingId(body.pendingId)

    return await this.runSerializedPromptRequest(activeEntry, async () => {
      if (
        requestedThinkingLevel &&
        activeEntry.session.thinkingLevel !== requestedThinkingLevel
      ) {
        activeEntry.session.setThinkingLevel(requestedThinkingLevel)
      }

      const promptOptions = images.length > 0 ? { images } : undefined
      const promotedDraft = this.isDraftEntry(activeEntry)
      const isAlreadyStreaming = this.getEntryStreamingState(activeEntry)
      if (
        clientPendingId &&
        activeEntry.canceledPendingUserMessageIds.delete(clientPendingId)
      ) {
        await this.broadcastEntryState(activeEntry)
        return {
          ok: true,
          queued: isAlreadyStreaming,
          pendingId: clientPendingId,
          canceled: true,
        }
      }

      const firstPromptMissing = !this.getSessionFirstMessage(activeEntry)
      if (firstPromptMissing) {
        activeEntry.firstMessageHint = message.trim()
        this.startAutoSessionNaming(activeEntry, message.trim(), images.length)
      }

      if (isAlreadyStreaming) {
        const queuedStreamingBehavior = streamingBehavior ?? "steer"
        const pendingMessage = createPendingUserMessage(
          message,
          images,
          queuedStreamingBehavior,
          clientPendingId
        )
        this.markSessionUserMessage(activeEntry)
        activeEntry.canceledPendingUserMessageIds.delete(
          pendingMessage.pendingId
        )
        activeEntry.pendingUserMessages.push(pendingMessage)
        await this.broadcastEntryState(activeEntry)

        try {
          await activeEntry.session.prompt(message, {
            ...promptOptions,
            streamingBehavior: queuedStreamingBehavior,
          })
        } catch (error) {
          activeEntry.pendingUserMessages =
            activeEntry.pendingUserMessages.filter(
              (entry) => entry.pendingId !== pendingMessage.pendingId
            )
          this.reconcilePendingUserMessages(activeEntry)
          await this.broadcastEntryState(activeEntry)
          throw error
        }

        this.reconcilePendingUserMessages(activeEntry)
        await this.broadcastEntryState(activeEntry)
        await this.broadcastSessionsAll()
        return { ok: true, queued: true, pendingId: pendingMessage.pendingId }
      }

      activeEntry.streamingState = true
      this.markSessionUserMessage(activeEntry)

      if (promotedDraft) {
        activeEntry.draft = false
        if (context.draftKey === activeEntry.key) {
          context.draftKey = undefined
        }
        await this.broadcastEntryState(activeEntry)
        await this.broadcastSessionsAll()
      }

      this.broadcastToViewers(activeEntry.key, {
        type: "user_message",
        message,
        images,
        queued: false,
      })

      let promptPreflightComplete: (() => void) | undefined
      let promptPreflightSettled = false
      const promptPreflight = new Promise<void>((resolve) => {
        promptPreflightComplete = resolve
      })
      const settlePromptPreflight = () => {
        if (promptPreflightSettled) return
        promptPreflightSettled = true
        promptPreflightComplete?.()
      }
      const promptPromise = activeEntry.session.prompt(message, {
        ...promptOptions,
        preflightResult: settlePromptPreflight,
      })
      const finishPromptIfIdle = async () => {
        if (!activeEntry.streamingState || activeEntry.session.isStreaming) {
          return
        }

        activeEntry.streamingState = false
        this.reconcilePendingUserMessages(activeEntry)
        await this.broadcastEntryState(activeEntry)
        await this.broadcastSessionsAll()
      }

      void promptPromise
        .then(() => {
          // Successful runs are finalized by session events. The SDK prompt
          // promise can resolve before the final message_end/agent_end events
          // reach our retained conversation, so do not publish completion here.
        })
        .catch(async (error) => {
          await finishPromptIfIdle()
          console.error("[pico] prompt error", error)
          this.broadcastToViewers(activeEntry.key, {
            type: "request_error",
            scope: "prompt",
            message,
            error: formatError(error),
          })
        })
        .finally(() => {
          settlePromptPreflight()
        })

      await promptPreflight

      return { ok: true, queued: false }
    })
  }

  async reorderPendingMessages(
    request: Request,
    body: {
      pendingMessages?: unknown
      pendingIds?: unknown
    }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const pendingMessages = Array.isArray(body.pendingMessages)
      ? body.pendingMessages
      : Array.isArray(body.pendingIds)
        ? body.pendingIds.map((pendingId) => ({ pendingId }))
        : null

    if (!pendingMessages) {
      throw new Error("pendingMessages must be an array")
    }

    const nextPendingMessages = this.pendingMessagesFromClientUpdate(
      activeEntry,
      pendingMessages
    )

    if (!activeEntry.session.isStreaming && nextPendingMessages.length > 0) {
      throw new Error(
        "Pending prompts can only be changed while the session is streaming."
      )
    }

    await this.replacePendingUserMessages(activeEntry, nextPendingMessages)
    return {
      ok: true,
      pendingMessages: nextPendingMessages.map((message) => ({
        pendingId: message.pendingId,
        text: message.text,
        images: message.images,
        streamingBehavior: message.streamingBehavior,
      })),
    }
  }

  async removePendingMessage(
    request: Request,
    body: {
      pendingId?: unknown
    }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const pendingId = typeof body.pendingId === "string" ? body.pendingId : ""
    if (!pendingId) {
      throw new Error("pendingId is required")
    }

    const pendingMessages = activeEntry.pendingUserMessages.map((message) =>
      clonePendingUserMessage(message)
    )
    const pendingIndex = pendingMessages.findIndex(
      (message) => message.pendingId === pendingId
    )
    if (pendingIndex === -1) {
      if (normalizeClientPendingId(pendingId)) {
        activeEntry.canceledPendingUserMessageIds.add(pendingId)
        return { ok: true, pendingId }
      }

      throw new Error("Pending prompt not found")
    }

    activeEntry.canceledPendingUserMessageIds.delete(pendingId)
    pendingMessages.splice(pendingIndex, 1)
    if (!activeEntry.session.isStreaming && pendingMessages.length > 0) {
      throw new Error(
        "Pending prompts can only be changed while the session is streaming."
      )
    }

    await this.replacePendingUserMessages(activeEntry, pendingMessages)
    return { ok: true, pendingId }
  }

  async abort(request: Request) {
    const { activeEntry } = await this.resolveRequest(request)
    activeEntry.doneNotificationSuppressed = true
    this.clearPendingSessionDone(activeEntry)
    activeEntry.session.abortCompaction?.()
    activeEntry.session.abortBranchSummary?.()
    await activeEntry.session.abort()
    return { ok: true }
  }

  async createNewSession(request: Request, body: { cwd?: unknown }) {
    const { context, activeEntry } = await this.resolveRequest(request)
    const requestedCwd =
      typeof body.cwd === "string" && body.cwd.trim()
        ? body.cwd.trim()
        : undefined
    const nextCwd = requestedCwd || context.sessionScope || activeEntry.cwd

    const nextEntry = await this.createNewSessionEntry(nextCwd, {
      draft: true,
      sessionDir:
        nextCwd === activeEntry.cwd
          ? activeEntry.session.sessionManager.getSessionDir?.()
          : undefined,
      sessionStartEvent: {
        type: "session_start",
        reason: "new",
        previousSessionFile: activeEntry.session.sessionFile,
      },
    })

    context.draftKey = nextEntry.key
    await this.activateContextSession(context, nextEntry)
    return { ok: true, draft: true }
  }

  async selectSession(request: Request) {
    const startedAt = performance.now()
    const url = new URL(request.url)
    const requestedSessionId = url.searchParams.get("session")?.trim() || ""
    const requestedSessionPath =
      url.searchParams.get("sessionPath")?.trim() || ""
    const context = this.ensureContext(
      url.searchParams.get("context") || "default"
    )
    context.sessionScope = normalizeSessionScope(
      url.searchParams.get("scope"),
      process.cwd()
    )
    this.logSessionLoadDebug("select_session:start", {
      requestedSessionId,
      requestedSessionPath,
      contextId: context.id,
    })

    try {
      if (!requestedSessionId && !requestedSessionPath) {
        throw new Error("session is required")
      }

      const ensureStartedAt = performance.now()
      const nextEntry = requestedSessionPath
        ? await this.ensureSessionEntryByPath(requestedSessionPath)
        : await this.ensureSessionEntryById(requestedSessionId)
      this.logSessionLoadDebug("select_session:ensure_entry", {
        requestedSessionId,
        requestedSessionPath,
        durationMs: roundedDurationMs(ensureStartedAt),
        found: Boolean(nextEntry),
        via: requestedSessionPath ? "path" : "id",
        ...this.sessionDebugDetails(nextEntry),
      })
      if (!nextEntry) {
        throw new Error(`Unknown session: ${requestedSessionId}`)
      }

      const activateStartedAt = performance.now()
      await this.activateContextSession(context, nextEntry)
      this.logSessionLoadDebug("select_session:activate", {
        requestedSessionId,
        requestedSessionPath,
        durationMs: roundedDurationMs(activateStartedAt),
        ...this.sessionDebugDetails(nextEntry),
      })
      this.logSessionLoadDebug("select_session:done", {
        requestedSessionId,
        requestedSessionPath,
        durationMs: roundedDurationMs(startedAt),
        ...this.sessionDebugDetails(nextEntry),
      })
      return { ok: true }
    } catch (error) {
      this.logSessionLoadDebug("select_session:error", {
        requestedSessionId,
        requestedSessionPath,
        durationMs: roundedDurationMs(startedAt),
        error: safeErrorMessage(error),
      })
      throw error
    }
  }

  async setModel(
    request: Request,
    body: { provider?: unknown; modelId?: unknown }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const provider = typeof body.provider === "string" ? body.provider : ""
    const modelId = typeof body.modelId === "string" ? body.modelId : ""
    if (!provider || !modelId) {
      throw new Error("provider and modelId are required")
    }

    const model = activeEntry.services.modelRegistry
      .getAvailable()
      .find((entry) => entry.provider === provider && entry.id === modelId)
    if (!model) {
      throw new Error(`Unknown model: ${provider}/${modelId}`)
    }

    await activeEntry.session.setModel(model)
    await this.broadcastEntryState(activeEntry)
    return {
      ok: true,
      model: serializeModel(activeEntry.session.model),
      thinkingLevel: activeEntry.session.thinkingLevel,
    }
  }

  async setThinking(request: Request, body: { level?: unknown }) {
    const { activeEntry } = await this.resolveRequest(request)
    const level = typeof body.level === "string" ? body.level : ""
    if (!VALID_THINKING_LEVELS.has(level)) {
      throw new Error(`Invalid thinking level: ${level || "(empty)"}`)
    }

    activeEntry.session.setThinkingLevel(level)
    await this.broadcastEntryState(activeEntry)
    return {
      ok: true,
      thinkingLevel: activeEntry.session.thinkingLevel,
      availableThinkingLevels: activeEntry.session.getAvailableThinkingLevels(),
    }
  }

  async setHideThinking(body: { hide?: unknown }) {
    const hide = Boolean(body.hide)
    for (const services of this.servicesByCwd.values()) {
      services.settingsManager.setHideThinkingBlock(hide)
    }
    await Promise.all(
      [...this.contexts.values()].map(async (context) => {
        this.sendStateToContext(context)
      })
    )
    return { ok: true, hideThinkingBlock: hide }
  }

  getSessionTree(entry: SessionEntry) {
    const manager = entry.session.sessionManager
    if (!manager.getTree) {
      return {
        leafId: null,
        streamingEntryId: null,
        tree: [] as Array<TreeNode>,
      }
    }

    const leafId = manager.getLeafId?.() ?? null
    const streamingEntryId =
      this.getEntryStreamingState(entry) || entry.session.isStreaming
        ? leafId
        : null
    const markStreamingNode = (node: TreeNode): TreeNode => ({
      ...node,
      streaming: Boolean(
        streamingEntryId && node.entry.id === streamingEntryId
      ),
      children: node.children.map((child) => markStreamingNode(child)),
    })

    return {
      leafId,
      streamingEntryId,
      tree: (manager.getTree() || [])
        .map((node) => serializeSessionTreeNode(node))
        .filter((node): node is TreeNode => Boolean(node))
        .map((node) => markStreamingNode(node)),
    }
  }

  async getSessionTreeForRequest(request: Request) {
    const { activeEntry } = await this.resolveRequest(request)
    const tree = this.getSessionTree(activeEntry)
    return {
      ok: true,
      leafId: tree.leafId,
      streamingEntryId: tree.streamingEntryId,
      tree: tree.tree,
    }
  }

  async setSessionTreeLabel(
    request: Request,
    body: { entryId?: unknown; label?: unknown }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const entryId = typeof body.entryId === "string" ? body.entryId.trim() : ""
    const label = typeof body.label === "string" ? body.label : ""
    if (!entryId) {
      throw new Error("entryId is required")
    }

    if (
      this.getEntryStreamingState(activeEntry) ||
      activeEntry.session.isStreaming
    ) {
      throw new Error(
        "Wait for the current response to finish before editing tree labels."
      )
    }

    const manager = activeEntry.session.sessionManager
    if (!manager.appendLabelChange || !manager.getLabel) {
      throw new Error("Label editing is not available for this session.")
    }

    const currentLabel = manager.getLabel(entryId) || ""
    const nextLabel = label.trim()
    if (currentLabel !== nextLabel) {
      manager.appendLabelChange(entryId, nextLabel || undefined)
      await this.broadcastEntryState(activeEntry)
    }

    const tree = this.getSessionTree(activeEntry)
    return {
      ok: true,
      leafId: tree.leafId,
      streamingEntryId: tree.streamingEntryId,
      tree: tree.tree,
    }
  }

  async navigateSessionTree(
    request: Request,
    body: {
      targetId?: unknown
      summarize?: unknown
      customInstructions?: unknown
      replaceInstructions?: unknown
      label?: unknown
    }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const targetId =
      typeof body.targetId === "string" ? body.targetId.trim() : ""
    if (!targetId) {
      throw new Error("targetId is required")
    }

    if (
      this.getEntryStreamingState(activeEntry) ||
      activeEntry.session.isStreaming
    ) {
      throw new Error("Abort the current response before navigating the tree.")
    }

    const result = await activeEntry.session.navigateTree(targetId, {
      summarize: Boolean(body.summarize),
      customInstructions:
        typeof body.customInstructions === "string"
          ? body.customInstructions
          : undefined,
      replaceInstructions: Boolean(body.replaceInstructions),
      label: typeof body.label === "string" ? body.label : undefined,
    })

    if (result.editorText != null) {
      activeEntry.uiState.editorText = result.editorText
    }
    if (result.summaryEntry) {
      this.touchSessionEntry(activeEntry)
      await this.broadcastSessionsAll()
    }
    await this.broadcastEntryState(activeEntry)
    return {
      ok: true,
      cancelled: Boolean(result.cancelled),
      aborted: Boolean(result.aborted),
      editorText: result.editorText,
    }
  }

  async getForkableMessages(request: Request) {
    const { activeEntry } = await this.resolveRequest(request)
    return {
      ok: true,
      messages: extractForkableUserMessages(activeEntry),
    }
  }

  private cloneSessionData<T>(value: T) {
    try {
      return structuredClone(value)
    } catch {
      return JSON.parse(JSON.stringify(value)) as T
    }
  }

  private createForkedInMemorySessionManager(
    sourceManager: SessionManagerLike,
    leafId: string | null | undefined,
    parentSession: string | undefined
  ) {
    return this.getSdk().then(
      async (sdk) =>
        await createForkedInMemorySessionManager({
          sourceManager,
          leafId,
          parentSession,
          cloneSessionData: (value) => this.cloneSessionData(value),
          createInMemorySessionManager: (cwd) =>
            sdk.SessionManager.inMemory(cwd),
        })
    )
  }

  private async cloneSessionForEntry(
    context: ContextState,
    activeEntry: SessionEntry
  ) {
    if (
      this.getEntryStreamingState(activeEntry) ||
      activeEntry.session.isStreaming ||
      activeEntry.compactingState ||
      activeEntry.session.isCompacting
    ) {
      throw new Error("Wait for the current response to finish before cloning.")
    }

    const leafId = activeEntry.session.sessionManager.getLeafId?.()
    if (!leafId) {
      throw new Error("Start the session before cloning it.")
    }

    const previousSessionFile = activeEntry.session.sessionFile
    const result = await this.createTransitionSessionEntry(
      activeEntry,
      async (runtime) => {
        const next = await runtime.fork(leafId, { position: "at" })
        return {
          cancelled: next.cancelled,
          draft: false,
        }
      }
    )

    const nextEntry = result.entry
    if (!nextEntry) {
      return { ok: true, cancelled: true as const }
    }

    nextEntry.uiState.editorText = ""
    const baseName =
      cleanupSessionNameCandidate(activeEntry.session.sessionName) ||
      getSessionListTitle({
        name: activeEntry.session.sessionName,
        firstMessage: this.getSessionFirstMessage(activeEntry),
      })
    if (baseName) {
      nextEntry.session.setSessionName(
        clampSessionNameLength(`${baseName} clone`)
      )
    }
    this.touchSessionEntry(nextEntry)

    await this.activateContextSession(context, nextEntry)
    await this.broadcastSessionsAll()
    return {
      ok: true,
      cancelled: false as const,
      draft: this.isDraftEntry(nextEntry),
      previousSessionFile,
      sessionId: nextEntry.session.sessionId,
      sessionFile: nextEntry.session.sessionFile,
    }
  }

  async cloneSession(request: Request) {
    const { context, activeEntry } = await this.resolveRequest(request)
    return await this.cloneSessionForEntry(context, activeEntry)
  }

  async forkSession(request: Request, body: { entryId?: unknown }) {
    const { context, activeEntry } = await this.resolveRequest(request)
    const entryId = typeof body.entryId === "string" ? body.entryId.trim() : ""
    if (!entryId) {
      throw new Error("entryId is required")
    }

    const currentManager = activeEntry.session.sessionManager
    const selectedEntry = currentManager.getEntry?.(entryId)
    const selectedParentId =
      typeof selectedEntry?.parentId === "string"
        ? selectedEntry.parentId
        : undefined
    if (
      !selectedEntry ||
      selectedEntry.type !== "message" ||
      selectedEntry.message?.role !== "user"
    ) {
      throw new Error("Invalid entry ID for forking")
    }

    const selectedText = extractMessageText(selectedEntry.message)
    const previousSessionFile = activeEntry.session.sessionFile
    const sourceSessionDir = currentManager.getSessionDir?.()

    let nextEntry: SessionEntry
    if (currentManager.isPersisted?.()) {
      const sdk = await this.getSdk()
      const currentSessionFile = activeEntry.session.sessionFile
      if (!currentSessionFile) {
        throw new Error("Persisted session is missing a session file")
      }

      const sourceManager = sdk.SessionManager.open(
        currentSessionFile,
        sourceSessionDir,
        activeEntry.cwd
      )
      const runtime = await this.createSessionRuntime(sourceManager)
      try {
        const result = await runtime.fork(entryId, {
          position: "before",
        })
        if (result.cancelled) {
          await runtime.dispose()
          return { ok: true, cancelled: true }
        }

        nextEntry = await this.createSessionEntryFromRuntime(runtime, {
          draft: !selectedParentId,
        })
        if (result.selectedText) {
          nextEntry.uiState.editorText = result.selectedText
        }
      } catch (error) {
        await runtime.dispose().catch(() => {})
        throw error
      }
    } else {
      const sessionStartEvent: SessionStartEventLike = {
        type: "session_start",
        reason: "fork",
        previousSessionFile,
      }
      const sessionManager = await this.createForkedInMemorySessionManager(
        currentManager,
        selectedParentId,
        previousSessionFile
      )
      nextEntry = await this.createSessionEntry(sessionManager, {
        draft: !selectedParentId,
        sessionStartEvent,
      })
    }
    if (!nextEntry.uiState.editorText) {
      nextEntry.uiState.editorText = selectedText
    }
    const baseName =
      cleanupSessionNameCandidate(activeEntry.session.sessionName) ||
      getSessionListTitle({
        name: activeEntry.session.sessionName,
        firstMessage: this.getSessionFirstMessage(activeEntry),
      })
    if (baseName) {
      nextEntry.session.setSessionName(
        clampSessionNameLength(`${baseName} fork`)
      )
    }
    nextEntry.uiState.editorText = selectedText
    if (!selectedParentId) {
      nextEntry.firstMessageHint = selectedText
    }
    this.touchSessionEntry(nextEntry)

    await this.activateContextSession(context, nextEntry)
    await this.broadcastSessionsAll()
    return {
      ok: true,
      draft: this.isDraftEntry(nextEntry),
      sessionId: nextEntry.session.sessionId,
      sessionFile: nextEntry.session.sessionFile,
    }
  }

  async renameSession(body: { path?: unknown; name?: unknown }) {
    const sessionPath = typeof body.path === "string" ? body.path : ""
    const nextName = typeof body.name === "string" ? body.name.trim() : ""
    if (!sessionPath) {
      throw new Error("path is required")
    }
    if (!nextName) {
      throw new Error("name is required")
    }

    const loadedEntry = this.sessionEntries.get(sessionPath)
    if (loadedEntry) {
      loadedEntry.session.setSessionName(clampSessionNameLength(nextName))
      await this.broadcastEntryState(loadedEntry)
    } else {
      const sdk = await this.getSdk()
      const manager = sdk.SessionManager.open(sessionPath)
      manager.appendSessionInfo?.(clampSessionNameLength(nextName))
    }

    this.invalidateSessionIndexCache()
    await this.broadcastSessionsAll()
    return { ok: true, name: nextName }
  }

  private async trashOrDeleteSessionFile(sessionPath: string) {
    if (process.platform === "darwin") {
      const trashDirectory = join(homedir(), ".Trash")
      await mkdir(trashDirectory, { recursive: true })
      const targetPath = join(
        trashDirectory,
        `${basename(sessionPath)}.${Date.now()}-${randomUUID()}`
      )
      try {
        await rename(sessionPath, targetPath)
        return
      } catch (error) {
        const code = (error as { code?: string } | undefined)?.code
        if (code === "ENOENT") return
        if (code !== "EXDEV") {
          throw error
        }
      }
    }

    try {
      await unlink(sessionPath)
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code
      if (code !== "ENOENT") {
        throw error
      }
    }
  }

  async deleteOldDirectorySessions(
    request: Request,
    body: {
      directory?: unknown
      olderThanMs?: unknown
      dryRun?: unknown
      includeActiveSession?: unknown
    }
  ) {
    const { context } = await this.resolveRequest(request)
    const directory =
      typeof body.directory === "string" ? body.directory.trim() : ""
    const olderThanMs =
      typeof body.olderThanMs === "number" && Number.isFinite(body.olderThanMs)
        ? body.olderThanMs
        : 0
    if (!directory) {
      throw new Error("directory is required")
    }
    if (olderThanMs <= 0) {
      throw new Error("olderThanMs must be greater than zero")
    }

    const cutoffTime = Date.now() - olderThanMs
    const allSessions = await this.listSessionIndexEntries()
    const directorySessions = await this.listEntriesForDirectory(
      allSessions,
      directory
    )
    const streamingPaths = this.buildStreamingPaths()
    const activeKeys = new Set(
      [...this.contexts.values()].map((ctx) => ctx.activeKey).filter(Boolean)
    )
    const activePaths = new Set(
      [...this.sessionEntries.values()]
        .filter((entry) => activeKeys.has(entry.key))
        .map((entry) => this.getSessionPath(entry))
    )
    const includeActiveSession = body.includeActiveSession === true

    const matchingSessions = directorySessions
      .map((entry) => {
        const activityAt =
          normalizeModifiedTimestamp(entry.lastUserMessageAt) ||
          normalizeModifiedTimestamp(entry.modified)
        return {
          ...this.serializeSessionListEntry(entry, context, streamingPaths),
          activityAt,
        }
      })
      .filter((entry) => {
        if (!entry.path) return false
        if (streamingPaths.has(entry.path)) return false
        if (!includeActiveSession && activePaths.has(entry.path)) return false
        const activityTime = modifiedTimestampValue(entry.activityAt)
        return activityTime > 0 && activityTime < cutoffTime
      })

    if (body.dryRun !== false) {
      return {
        ok: true,
        directory,
        cutoff: new Date(cutoffTime).toISOString(),
        dryRun: true,
        deletedSessionIds: [],
        matchingSessions,
      }
    }

    const deletedSessionIds = matchingSessions
      .map((session) => session.id)
      .filter((id): id is string => Boolean(id))
    const matchingPaths = matchingSessions
      .map((session) => session.path)
      .filter((path): path is string => Boolean(path))
    const matchingPathSet = new Set(matchingPaths)

    await Promise.all(
      [...this.sessionEntries.values()]
        .filter((entry) => matchingPathSet.has(this.getSessionPath(entry)))
        .map((entry) => this.disposeSessionEntry(entry))
    )

    for (const ctx of this.contexts.values()) {
      for (const sessionPath of matchingPaths) {
        ctx.unreadFinished.delete(sessionPath)
      }
    }

    await Promise.all(
      matchingPaths.map((sessionPath) =>
        this.trashOrDeleteSessionFile(sessionPath)
      )
    )

    this.invalidateSessionIndexCache()
    await this.broadcastSessionsAll()

    return {
      ok: true,
      directory,
      cutoff: new Date(cutoffTime).toISOString(),
      dryRun: false,
      deletedSessionIds,
      matchingSessions,
    }
  }

  async deleteSessions(request: Request, body: { paths?: unknown }) {
    const { context } = await this.resolveRequest(request)
    const paths = Array.isArray(body.paths)
      ? body.paths
          .filter((path): path is string => typeof path === "string")
          .map((path) => path.trim())
          .filter(Boolean)
      : []
    const sessionPaths = [...new Set(paths)]
    if (sessionPaths.length === 0) {
      throw new Error("paths are required")
    }

    const sessionPathSet = new Set(sessionPaths)
    const loadedEntries = [...this.sessionEntries.values()].filter((entry) =>
      sessionPathSet.has(this.getSessionPath(entry))
    )
    let replacementEntry: SessionEntry | undefined

    for (const loadedEntry of loadedEntries) {
      const affectedContexts = [...this.contexts.values()].filter(
        (ctx) => ctx.activeKey === loadedEntry.key
      )
      if (affectedContexts.length > 0) {
        const nextReplacementEntry = await this.createNewSessionEntry(
          loadedEntry.cwd,
          { draft: true }
        )
        replacementEntry = replacementEntry ?? nextReplacementEntry
        for (const affected of affectedContexts) {
          affected.draftKey = nextReplacementEntry.key
          await this.activateContextSession(affected, nextReplacementEntry)
        }
      }
    }

    for (const ctx of this.contexts.values()) {
      for (const sessionPath of sessionPaths) {
        ctx.unreadFinished.delete(sessionPath)
      }
    }

    await Promise.all(
      loadedEntries.map((entry) => this.disposeSessionEntry(entry))
    )
    await Promise.all(
      sessionPaths.map((sessionPath) =>
        this.trashOrDeleteSessionFile(sessionPath)
      )
    )

    this.invalidateSessionIndexCache()
    await this.broadcastSessionsAll()
    return {
      ok: true,
      deletedPaths: sessionPaths,
      sessionId:
        replacementEntry && !this.isDraftEntry(replacementEntry)
          ? replacementEntry.session.sessionId
          : context.activeKey === replacementEntry?.key
            ? replacementEntry?.session.sessionId
            : undefined,
      sessionFile:
        replacementEntry && !this.isDraftEntry(replacementEntry)
          ? replacementEntry.session.sessionFile
          : context.activeKey === replacementEntry?.key
            ? replacementEntry?.session.sessionFile
            : undefined,
    }
  }

  async deleteSession(request: Request, body: { path?: unknown }) {
    const sessionPath = typeof body.path === "string" ? body.path : ""
    if (!sessionPath) {
      throw new Error("path is required")
    }

    const response = await this.deleteSessions(request, {
      paths: [sessionPath],
    })
    return {
      ok: true,
      sessionId: response.sessionId,
      sessionFile: response.sessionFile,
    }
  }

  private requireAuthStorage(entry: SessionEntry) {
    const authStorage = entry.services.modelRegistry.authStorage
    if (!authStorage) {
      throw new Error("Provider authentication is unavailable")
    }
    return authStorage
  }

  private refreshModelRegistries() {
    for (const services of this.servicesByCwd.values()) {
      services.modelRegistry.refresh?.()
    }
  }

  private async finishAuthMutation(entry: SessionEntry, provider: string) {
    this.refreshModelRegistries()
    await this.broadcastEntryState(entry)
    return {
      ok: true,
      provider,
      availableModels: this.listAvailableModels(entry),
    }
  }

  async getAuthProviders(request: Request) {
    const { activeEntry } = await this.resolveRequest(request)
    const modelRegistry = activeEntry.services.modelRegistry
    const authStorage = this.requireAuthStorage(activeEntry)
    const oauthProviders = authStorage.getOAuthProviders()
    const oauthProviderIds = new Set(
      oauthProviders.map((provider) => provider.id)
    )
    const providerIds = new Set(
      (modelRegistry.getAll?.() ?? modelRegistry.getAvailable()).map(
        (model) => model.provider
      )
    )

    const authStatus = (providerId: string) => {
      const status = authStorage.getAuthStatus?.(providerId)
      const credential = authStorage.get(providerId)
      return {
        configured: status?.configured ?? Boolean(credential),
        source: status?.source,
        label: status?.label,
      }
    }

    const oauthOptions = oauthProviders
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        authType: "oauth" as const,
        ...authStatus(provider.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))

    const apiKeyOptions = Array.from(providerIds)
      .filter((providerId) => {
        if (BUILT_IN_API_KEY_LOGIN_PROVIDERS.has(providerId)) return true
        return !oauthProviderIds.has(providerId)
      })
      .map((providerId) => ({
        id: providerId,
        name: getApiKeyProviderDisplayName(providerId),
        authType: "api_key" as const,
        ...authStatus(providerId),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))

    const nameByProvider = new Map(
      [...oauthOptions, ...apiKeyOptions].map((option) => [
        option.id,
        option.name,
      ])
    )
    const authTypeByProvider = new Map(
      [...oauthOptions, ...apiKeyOptions].map((option) => [
        option.id,
        option.authType,
      ])
    )
    const loggedInProviders = authStorage
      .list()
      .map((providerId) => {
        const credential = authStorage.get(providerId)
        return {
          id: providerId,
          name:
            nameByProvider.get(providerId) ??
            getApiKeyProviderDisplayName(providerId),
          authType:
            credential?.type ?? authTypeByProvider.get(providerId) ?? "api_key",
          ...authStatus(providerId),
          configured: true,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))

    return {
      ok: true,
      oauthProviders: oauthOptions,
      apiKeyProviders: apiKeyOptions,
      loggedInProviders,
    }
  }

  async saveProviderApiKey(
    request: Request,
    body: { provider?: unknown; key?: unknown }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const provider =
      typeof body.provider === "string" ? body.provider.trim() : ""
    const key = typeof body.key === "string" ? body.key.trim() : ""
    if (!provider) throw new Error("provider is required")
    if (!key) throw new Error("API key is required")

    this.requireAuthStorage(activeEntry).set(provider, {
      type: "api_key",
      key,
    })
    return await this.finishAuthMutation(activeEntry, provider)
  }

  async logoutProvider(request: Request, body: { provider?: unknown }) {
    const { activeEntry } = await this.resolveRequest(request)
    const provider =
      typeof body.provider === "string" ? body.provider.trim() : ""
    if (!provider) throw new Error("provider is required")

    this.requireAuthStorage(activeEntry).logout(provider)
    return await this.finishAuthMutation(activeEntry, provider)
  }

  async getProviderUsage(request: Request, provider: string | undefined) {
    const { activeEntry } = await this.resolveRequest(request)
    return await fetchProviderUsage(
      provider,
      activeEntry.services.modelRegistry.authStorage
    )
  }

  async loginProviderOAuth(request: Request, body: { provider?: unknown }) {
    const { activeEntry } = await this.resolveRequest(request)
    const provider =
      typeof body.provider === "string" ? body.provider.trim() : ""
    if (!provider) throw new Error("provider is required")

    const authStorage = this.requireAuthStorage(activeEntry)
    const providerInfo = authStorage
      .getOAuthProviders()
      .find((candidate) => candidate.id === provider)
    if (!providerInfo) {
      throw new Error(`Unknown OAuth provider: ${provider}`)
    }

    const loginKey = providerInfo.id

    const ui = createUiRequestBridge({
      entryKey: activeEntry.key,
      pendingUiRequests: this.pendingUiRequests,
      createRequestId: () => randomUUID(),
      broadcastToViewers: (sessionKey, payload) =>
        this.broadcastToViewers(sessionKey, payload),
    })

    const loginAbortController = new AbortController()
    const loginSignal = loginAbortController.signal

    const requestInput = async (payload: Record<string, unknown>) => {
      const value = await ui.createDialogPromise(
        undefined as string | undefined,
        {
          payload,
          signal: loginSignal,
        },
        (response) => {
          if (response.cancelled) return undefined
          return typeof response.value === "string" ? response.value : undefined
        }
      )
      if (value === undefined) {
        throw new Error("Login cancelled")
      }
      return value
    }

    const requestSelection = async (payload: Record<string, unknown>) => {
      return await ui.createDialogPromise(
        undefined as string | undefined,
        {
          payload,
          signal: loginSignal,
        },
        (response) => {
          if (response.cancelled) return undefined
          return typeof response.value === "string" ? response.value : undefined
        }
      )
    }

    let manualRedirect:
      | {
          promise: Promise<string>
          resolve: (value: string) => void
          reject: (error: Error) => void
        }
      | undefined
    const getManualRedirect = () => {
      if (!manualRedirect) {
        let resolveManual!: (value: string) => void
        let rejectManual!: (error: Error) => void
        const promise = new Promise<string>((resolve, reject) => {
          resolveManual = resolve
          rejectManual = reject
        })
        manualRedirect = {
          promise,
          resolve: resolveManual,
          reject: rejectManual,
        }
      }
      return manualRedirect
    }

    const activeLogin = this.activeOAuthLogins.get(loginKey)
    if (activeLogin) {
      activeLogin()
      throw new Error(
        `Cancelled the existing ${providerInfo.name} login. Try login again.`
      )
    }

    this.activeOAuthLogins.set(loginKey, () => {
      loginAbortController.abort()
      manualRedirect?.reject(new Error("Login cancelled"))
    })

    try {
      await authStorage.login(provider, {
        onAuth: (info) => {
          void ui
            .createDialogPromise(
              { action: "cancel" as const },
              {
                payload: {
                  method: "auth",
                  title: `Log in to ${providerInfo.name}`,
                  message:
                    info.instructions ||
                    "Open the login page in your browser to continue.",
                  authUrl: info.url,
                  authManualAllowed: Boolean(providerInfo.usesCallbackServer),
                },
                signal: loginSignal,
                timeout: 10 * 60 * 1000,
              },
              (response) => {
                if (typeof response.value === "string") {
                  return {
                    action: "manual" as const,
                    value: response.value,
                  }
                }
                return { action: "cancel" as const }
              }
            )
            .then((result) => {
              const deferred = getManualRedirect()
              if (result.action !== "manual") {
                deferred.reject(new Error("Login cancelled"))
                return
              }

              deferred.resolve(result.value)
            })
        },
        onPrompt: async (prompt) => {
          return await requestInput({
            method: "auth_input",
            title: `Log in to ${providerInfo.name}`,
            message: prompt.message,
            placeholder: prompt.placeholder,
            allowEmpty: Boolean(prompt.allowEmpty),
          })
        },
        onProgress: (message) => {
          ui.notify(message, "info")
        },
        onManualCodeInput: async () => {
          return await getManualRedirect().promise
        },
        onSelect: async (prompt) => {
          return await requestSelection({
            method: "auth_select",
            title: `Log in to ${providerInfo.name}`,
            message: prompt.message,
            options: prompt.options.map((option) => ({
              value: option.id,
              label: option.label,
            })),
          })
        },
        signal: loginSignal,
      })

      return await this.finishAuthMutation(activeEntry, provider)
    } finally {
      if (this.activeOAuthLogins.get(loginKey)) {
        this.activeOAuthLogins.delete(loginKey)
      }
    }
  }

  async runSlashCommand(
    request: Request,
    body: { name?: unknown; args?: unknown }
  ) {
    const { context, activeEntry } = await this.resolveRequest(request)
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const args = typeof body.args === "string" ? body.args : ""

    if (name === "clone") {
      if (args.trim()) {
        throw new Error("/clone does not take any arguments.")
      }
      return await this.cloneSessionForEntry(context, activeEntry)
    }

    if (name !== "compact") {
      throw new Error(`Unknown slash command: /${name || "(empty)"}`)
    }

    activeEntry.compactingState = true
    await this.broadcastEntryState(activeEntry)

    try {
      await activeEntry.session.compact(args.trim() || undefined)
      return { ok: true, commandName: name }
    } finally {
      activeEntry.compactingState = false
      await this.broadcastEntryState(activeEntry)
      await this.broadcastSessionsAll()
    }
  }

  async resolveUiRequest(id: string, body: Record<string, unknown>) {
    return resolvePendingUiRequest(this.pendingUiRequests, id, body)
  }

  async highlightCode(code: unknown, language: unknown) {
    const text = typeof code === "string" ? code : ""

    try {
      const highlightInput = buildHighlightPayload({ code, language })

      if ("skipped" in highlightInput) {
        return {
          ok: true,
          skipped: true,
          language: highlightInput.language,
        }
      }

      const cacheKey = createHash("sha1")
        .update(highlightInput.language)
        .update("\0")
        .update(text)
        .digest("hex")
      const cached = this.highlightCache.get(cacheKey)
      if (cached) {
        return { ok: true, ...cached }
      }

      if ("unsupported" in highlightInput) {
        const payload = {
          unsupported: true,
          language: highlightInput.language,
        } satisfies HighlightPayload
        this.highlightCache.set(cacheKey, payload)
        return { ok: true, ...payload }
      }

      const payload = {
        language: highlightInput.language,
        html: highlightInput.html,
      } satisfies HighlightPayload
      this.highlightCache.set(cacheKey, payload)
      return { ok: true, ...payload }
    } catch (error) {
      if (!this.highlightLoadErrorLogged) {
        this.highlightLoadErrorLogged = true
        console.warn(
          `[pico:warn] Syntax highlighting unavailable: ${formatError(error)}`
        )
      }
      return {
        ok: true,
        unavailable: true,
      }
    }
  }

  async dispose() {
    clearInterval(this.heartbeat)
    for (const context of this.contexts.values()) {
      for (const client of context.clients) {
        this.closeSseClient(context, client)
      }
    }
    this.contexts.clear()

    for (const pending of this.pendingUiRequests.values()) {
      try {
        pending.resolve({ cancelled: true })
      } catch {
        // ignore
      }
    }
    this.pendingUiRequests.clear()

    for (const entry of this.sessionEntries.values()) {
      await this.disposeSessionEntry(entry)
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __picoRuntime: PicoRuntime | undefined
}

export function getPicoRuntime() {
  globalThis.__picoRuntime ??= new PicoRuntime()
  return globalThis.__picoRuntime
}
