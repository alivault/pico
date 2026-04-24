import { createHash, randomUUID } from "node:crypto"
import { stat, unlink } from "node:fs/promises"

import type {
  DirectoryState,
  ModelOption,
  SessionUiState,
  SkillOption,
  StateSyncPayload,
  TreeNode,
} from "@/lib/pi-web"
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
} from "@/server/pi-web-runtime-contexts"
import {
  buildHighlightPayload,
  type HighlightPayload,
} from "@/server/pi-web-runtime-highlight"
import {
  compareSessionListEntriesByModified,
  createDirectorySessionRevision,
  getSessionListTitle,
  laterModifiedTimestamp,
  listKnownDirectories,
  mergeSessionListEntry,
  normalizeModifiedTimestamp,
  normalizeSessionListTitle,
  serializeSessionListEntry,
} from "@/server/pi-web-runtime-session-list"
import {
  createForkedInMemorySessionManager,
  extractForkableUserMessages,
  extractMessageText,
  serializeSessionTreeNode,
} from "@/server/pi-web-runtime-tree-fork"
import {
  createUiRequestBridge,
  resolvePendingUiRequest,
} from "@/server/pi-web-runtime-ui-requests"
import { loadPiSdk, makeSelfContainedSettingsManager } from "@/server/pi-sdk"
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
const SESSION_HISTORY_INITIAL_ITEM_LIMIT = 60
const SESSION_HISTORY_PAGE_LIMIT_DEFAULT = 50
const SESSION_HISTORY_PAGE_LIMIT_MAX = 200
const SESSION_NAME_MAX_LENGTH = 48
const HEARTBEAT_INTERVAL_MS = 20_000

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

type SessionEntry = {
  key: string
  cwd: string
  services: SessionServicesLike
  runtime: AgentSessionRuntimeLike
  session: AgentSessionLike
  draft: boolean
  streamingState: boolean
  pendingUserMessages: Array<PendingUserMessage>
  pendingQueueMutation: boolean
  firstMessageHint: string
  modifiedAt?: string
  uiState: SessionUiState
  unsubscribe?: (() => void) | undefined
  restoreSessionMetadataSync?: (() => void) | undefined
  sessionNaming: SessionNamingState
  promptRequestChain: Promise<void>
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

function createStateSyncSnapshot(payload: StateSyncPayload): StateSyncSnapshot {
  const scalarValues: Partial<Record<StateSyncScalarField, unknown>> = {}
  for (const field of STATE_SYNC_SCALAR_FIELDS) {
    scalarValues[field] = payload[field]
  }

  const jsonValues: Partial<Record<StateSyncJsonField, string>> = {}
  for (const field of STATE_SYNC_JSON_FIELDS) {
    jsonValues[field] = stringifyStateSyncValue(payload[field])
  }

  return {
    scalarValues,
    jsonValues,
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
    const nextValue = next[field]
    const nextJson = stringifyStateSyncValue(nextValue)
    if (previous.jsonValues[field] === nextJson) {
      continue
    }
    patch[field] = nextValue as never
    changed = true
  }

  return changed ? patch : null
}

function createInitialUiState(): SessionUiState {
  return {
    statuses: {},
    title: undefined,
    editorText: "",
    workingMessage: undefined,
    hiddenThinkingLabel: undefined,
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

function createPendingUserMessage(
  text: string,
  images: Array<PromptImageInput>,
  streamingBehavior: "steer" | "followUp"
) {
  return {
    pendingId: `pending:${cryptoRandomId()}`,
    text,
    images,
    queued: true,
    streamingBehavior,
  } satisfies PendingUserMessage
}

export class PiWebRuntime {
  private readonly encoder = new TextEncoder()
  private readonly contexts = new Map<string, ContextState>()
  private readonly sessionEntries = new Map<string, SessionEntry>()
  private readonly servicesByCwd = new Map<string, SessionServicesLike>()
  private readonly pendingUiRequests = new Map<string, PendingUiRequest>()
  private readonly highlightCache = new Map<string, HighlightPayload>()
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
    this.sdkPromise ??= loadPiSdk().then((sdk) => sdk as unknown as PiSdkLike)
    return await this.sdkPromise
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
      console.log(`[pi-web:${prefix}] ${diagnostic.message}`)
    }
  }

  private async getServicesForCwd(cwd: string) {
    const cached = this.servicesByCwd.get(cwd)
    if (cached) return cached

    const sdk = await this.getSdk()
    const agentDir = sdk.getAgentDir()
    const settingsManager = makeSelfContainedSettingsManager(
      sdk.SettingsManager.create(cwd, agentDir)
    ) as SettingsManagerLike

    const services = await sdk.createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
      },
    })

    this.logRuntimeDiagnostics(services.diagnostics)
    this.servicesByCwd.set(cwd, services)
    return services
  }

  private async createSessionRuntime(
    sessionManager: SessionManagerLike,
    options?: {
      sessionStartEvent?: SessionStartEventLike
    }
  ) {
    const sdk = await this.getSdk()
    const agentDir = sdk.getAgentDir()
    const cwd = sessionManager.getCwd()

    return await sdk.createAgentSessionRuntime(
      async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
        const services = await this.getServicesForCwd(runtimeCwd)
        const result = await sdk.createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
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
    return entry.streamingState || entry.session.isStreaming
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

  private currentStatePayload(entry: SessionEntry): StateSyncPayload {
    const draft = this.isDraftEntry(entry)
    const sanitizedMessages = entry.session.messages.map((message) =>
      sanitizeSessionMessage(message)
    )
    const historyTotalCount = sanitizedMessages.length
    const historyOffset = Math.max(
      0,
      historyTotalCount - SESSION_HISTORY_INITIAL_ITEM_LIMIT
    )

    return {
      type: "state_sync",
      sessionKey: entry.key,
      messages: sanitizedMessages.slice(historyOffset),
      pendingUserMessages: entry.pendingUserMessages.map((message) =>
        clonePendingUserMessage(message)
      ),
      draft,
      streaming: this.getEntryStreamingState(entry),
      streamingMessage: this.getEntryStreamingState(entry)
        ? sanitizeSessionMessage(entry.session.state.streamingMessage || {})
        : undefined,
      historyOffset,
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
    }
  }

  private async listSessionIndexEntries() {
    const sdk = await this.getSdk()
    try {
      return (await sdk.SessionManager.listAll()).filter(
        (entry) => (entry.messageCount ?? 0) > 0
      )
    } catch (error) {
      console.error("[pi-web] failed to list sessions:", error)
      return []
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

  private compareSessionListEntriesByModified(
    left: SessionListInfoLike,
    right: SessionListInfoLike
  ) {
    return compareSessionListEntriesByModified(left, right)
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
      this.compareSessionListEntriesByModified(left, right)
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
    const allSessions = await this.listSessionIndexEntries()
    const activeEntry = this.getActiveEntry(context)
    const directories = this.listKnownDirectories(allSessions)
    const bootstrapDirectories = options?.includeBootstrapIndexes
      ? normalizeRequestedDirectories(context.sidebarBootstrapDirectories)
      : []
    const allDirectories = normalizeRequestedDirectories([
      ...directories,
      ...bootstrapDirectories,
    ])
    const entriesByDirectory = await this.collectDirectoryEntries(
      allSessions,
      allDirectories
    )
    const streamingPaths = this.buildStreamingPaths()
    const directoryIndexes =
      bootstrapDirectories.length > 0
        ? Object.fromEntries(
            bootstrapDirectories.map((directoryPath) => [
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
    const { activeEntry } = await this.resolveRequest(request)
    const sanitizedMessages = activeEntry.session.messages.map((message) =>
      sanitizeSessionMessage(message)
    )
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

    return {
      ok: true,
      offset,
      limit: safeLimit,
      totalCount,
      hasMoreBefore: offset > 0,
      messages: sanitizedMessages.slice(offset, safeBefore),
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
    const nextPayload = options?.forceFull
      ? payload
      : createStateSyncPatch(client.lastStateSyncSnapshot, payload)
    if (!nextPayload) return false

    const sent = this.sendPayloadToClient(context, client, nextPayload)
    if (sent) {
      client.lastStateSyncSnapshot = createStateSyncSnapshot(payload)
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

    const payload = this.currentStatePayload(entry)
    for (const client of context.clients) {
      this.sendStatePayloadToClient(context, client, payload, options)
    }
  }

  private async sendSessionsToContext(context: ContextState) {
    this.sendToContext(context, await this.listSessionsPayload(context))
  }

  private async broadcastSessionsAll() {
    await Promise.all(
      [...this.contexts.values()].map((context) =>
        this.sendSessionsToContext(context)
      )
    )
  }

  private markUnreadFinished(entry: SessionEntry) {
    const sessionPath = this.getSessionPath(entry)
    for (const context of this.contexts.values()) {
      if (context.activeKey !== entry.key) {
        context.unreadFinished.add(sessionPath)
      }
    }
  }

  private async activateContextSession(
    context: ContextState,
    entry: SessionEntry
  ) {
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
      sendSessionsToContext: async (activeContext) =>
        await this.sendSessionsToContext(activeContext),
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
    for (const entry of this.sessionEntries.values()) {
      if (entry.session.sessionId === sessionId) {
        return entry
      }
    }

    const sessions = await this.listSessionIndexEntries()
    const match = sessions.find((entry) => entry.id === sessionId && entry.path)
    if (!match?.path) return undefined
    return await this.ensureSessionEntryByPath(match.path)
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
    return draftEntry
  }

  private async resolveRequestedEntry(url: URL, context: ContextState) {
    return await resolveRuntimeRequestedEntry({
      url,
      context,
      getSessionEntryByKey: (key) => this.sessionEntries.get(key),
      ensureSessionEntryById: async (sessionId) =>
        await this.ensureSessionEntryById(sessionId),
      getActiveEntry: (activeContext) => this.getActiveEntry(activeContext),
      getOrCreateDraftEntry: async (activeContext) =>
        await this.getOrCreateDraftEntry(activeContext),
      activateContextSession: async (activeContext, entry) =>
        await this.activateContextSession(activeContext, entry),
    })
  }

  async resolveRequest(request: Request): Promise<ResolveRequestResult> {
    const url = new URL(request.url)
    const context = this.ensureContext(
      url.searchParams.get("context") || "default"
    )
    context.sessionScope = normalizeSessionScope(
      url.searchParams.get("scope"),
      process.cwd()
    )
    const activeEntry = await this.resolveRequestedEntry(url, context)
    return { url, context, activeEntry }
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
    this.logRuntimeDiagnostics(runtime.diagnostics)

    const session = runtime.session
    const services = runtime.services
    const cwd = runtime.cwd
    const key = session.sessionFile ?? `ephemeral:${cryptoRandomId()}`
    const existing = this.sessionEntries.get(key)
    if (existing) {
      await runtime.dispose()
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
      pendingUserMessages: [],
      pendingQueueMutation: false,
      firstMessageHint: "",
      modifiedAt: undefined,
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
    }

    this.sessionEntries.set(key, entry)
    this.installSessionMetadataSync(entry)
    this.maybeAutoNameSession(entry)
    await this.bindSessionEntry(entry)
    return entry
  }

  private async createSessionEntry(
    sessionManager: SessionManagerLike,
    options?: {
      draft?: boolean
      sessionStartEvent?: SessionStartEventLike
    }
  ) {
    const runtime = await this.createSessionRuntime(sessionManager, {
      sessionStartEvent: options?.sessionStartEvent,
    })
    return await this.createSessionEntryFromRuntime(runtime, {
      draft: options?.draft,
    })
  }

  async createNewSessionEntry(
    cwd: string,
    options?: {
      draft?: boolean
      newSessionOptions?: { parentSession?: string }
      sessionStartEvent?: SessionStartEventLike
    }
  ) {
    const sdk = await this.getSdk()
    const sessionManager = sdk.SessionManager.create(cwd)
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
    if (existing) return existing

    const sdk = await this.getSdk()
    const sessionManager = sdk.SessionManager.open(sessionPath)
    return await this.createSessionEntry(sessionManager, {
      sessionStartEvent: {
        type: "session_start",
        reason: "resume",
      },
    })
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
      void this.broadcastSessionsAll()
      return result
    }) satisfies typeof manager.appendSessionInfo

    entry.restoreSessionMetadataSync = () => {
      manager.appendSessionInfo = originalAppendSessionInfo
      entry.restoreSessionMetadataSync = undefined
    }
  }

  private async disposeSessionEntry(entry: SessionEntry) {
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
      console.error("[pi-web] session dispose error:", error)
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
    console.error("[pi-web] auto session naming failed:", {
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
    const normalizedUpdates = Array.isArray(pendingMessagesUpdate)
      ? pendingMessagesUpdate
          .map((message) => ({
            pendingId:
              typeof message?.pendingId === "string" ? message.pendingId : "",
            streamingBehavior:
              message?.streamingBehavior === "steer"
                ? "steer"
                : message?.streamingBehavior === "followUp"
                  ? "followUp"
                  : undefined,
          }))
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
      nextPendingMessages.push({
        ...existing,
        streamingBehavior:
          update.streamingBehavior === "steer"
            ? "steer"
            : existing.streamingBehavior,
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
    entry.unsubscribe?.()
    const session = entry.session

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
        setHiddenThinkingLabel: (label: string | undefined) => {
          entry.uiState.hiddenThinkingLabel = label
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
            "Custom extension UI is not supported in Pi browser mode."
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
          error: "Theme switching is not supported in Pi browser mode.",
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
          console.error("[pi-web] shutdown failed:", error)
        })
      },
      onError: (error: Record<string, unknown>) => {
        this.broadcastToViewers(entry.key, {
          type: "extension_error",
          ...error,
        })
      },
    })

    entry.unsubscribe = session.subscribe((event) => {
      void this.handleSessionEvent(entry, event)
    })
  }

  private async broadcastEntryState(entry: SessionEntry) {
    for (const context of this.contexts.values()) {
      if (context.activeKey === entry.key) {
        this.sendStateToContext(context)
      }
    }
  }

  private async handleSessionEvent(
    entry: SessionEntry,
    event: SessionEventLike
  ) {
    const type = typeof event.type === "string" ? event.type : ""

    if (type === "agent_start") {
      entry.streamingState = true
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
      this.touchSessionEntry(entry)
    }

    if (type === "agent_end") {
      entry.streamingState = false
      this.touchSessionEntry(entry)
      this.reconcilePendingUserMessages(entry)
      this.markUnreadFinished(entry)
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
    try {
      client.controller.close()
    } catch {
      // stream may already be closed
    }
  }

  async createEventsResponse(request: Request) {
    const { url, context, activeEntry } = await this.resolveRequest(request)
    context.sidebarBootstrapDirectories = normalizeRequestedDirectories(
      url.searchParams.getAll("sidebarDirectory")
    )
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
        this.writeRawToClient(context, client, ": connected\n\n")

        void (async () => {
          this.sendStatePayloadToClient(
            context,
            client,
            this.currentStatePayload(activeEntry),
            {
              forceFull: true,
            }
          )
          this.sendPayloadToClient(
            context,
            client,
            await this.listSessionsPayload(context, {
              includeBootstrapIndexes: true,
            })
          )
        })()

        cleanup = () => {
          this.closeSseClient(context, client)
          if (context.clients.size === 0) {
            const draftEntry = context.draftKey
              ? this.sessionEntries.get(context.draftKey)
              : undefined
            this.contexts.delete(context.id)
            void this.disposeDraftIfUnused(draftEntry)
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
    }
  ) {
    const { context, activeEntry } = await this.resolveRequest(request)
    const message = typeof body.message === "string" ? body.message : ""
    const images = normalizePromptImages(body.images)
    if (!message.trim() && images.length === 0) {
      throw new Error("message or image is required")
    }

    const streamingBehavior =
      body.streamingBehavior === "steer"
        ? "steer"
        : body.streamingBehavior === "followUp"
          ? "followUp"
          : undefined

    return await this.runSerializedPromptRequest(activeEntry, async () => {
      const promptOptions = images.length > 0 ? { images } : undefined
      const promotedDraft = this.isDraftEntry(activeEntry)
      const isAlreadyStreaming = this.getEntryStreamingState(activeEntry)
      const firstPromptMissing = !this.getSessionFirstMessage(activeEntry)
      if (firstPromptMissing) {
        activeEntry.firstMessageHint = message.trim()
        this.startAutoSessionNaming(activeEntry, message.trim(), images.length)
      }

      if (isAlreadyStreaming) {
        const queuedStreamingBehavior = streamingBehavior ?? "steer"
        this.touchSessionEntry(activeEntry)
        await activeEntry.session.prompt(message, {
          ...promptOptions,
          streamingBehavior: queuedStreamingBehavior,
        })
        activeEntry.pendingUserMessages.push(
          createPendingUserMessage(message, images, queuedStreamingBehavior)
        )
        this.reconcilePendingUserMessages(activeEntry)
        await this.broadcastEntryState(activeEntry)
        await this.broadcastSessionsAll()
        return { ok: true, queued: true }
      }

      activeEntry.streamingState = true
      this.touchSessionEntry(activeEntry)

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

      void Promise.resolve()
        .then(() => activeEntry.session.prompt(message, promptOptions))
        .catch(async (error) => {
          const endedRun = !activeEntry.session.isStreaming
          if (endedRun) {
            activeEntry.streamingState = false
            this.reconcilePendingUserMessages(activeEntry)
            await this.broadcastEntryState(activeEntry)
            await this.broadcastSessionsAll()
          }
          console.error("[pi-web] prompt error", error)
          this.broadcastToViewers(activeEntry.key, {
            type: "request_error",
            scope: "prompt",
            message,
            error: formatError(error),
          })
        })

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
      throw new Error("Pending prompt not found")
    }

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

    const nextEntry =
      nextCwd === activeEntry.cwd
        ? (
            await this.createTransitionSessionEntry(
              activeEntry,
              async (runtime) => {
                const next = await runtime.newSession()
                return {
                  cancelled: next.cancelled,
                  draft: true,
                }
              }
            )
          ).entry
        : await this.createNewSessionEntry(nextCwd, {
            draft: true,
            sessionStartEvent: {
              type: "session_start",
              reason: "new",
              previousSessionFile: activeEntry.session.sessionFile,
            },
          })

    if (!nextEntry) {
      return { ok: true, draft: true, cancelled: true }
    }

    context.draftKey = nextEntry.key
    await this.activateContextSession(context, nextEntry)
    await this.broadcastSessionsAll()
    return { ok: true, draft: true }
  }

  async selectSession(request: Request) {
    const { url, context } = await this.resolveRequest(request)
    const requestedSessionId = url.searchParams.get("session")?.trim() || ""

    if (!requestedSessionId) {
      throw new Error("session is required")
    }

    const nextEntry = await this.ensureSessionEntryById(requestedSessionId)
    if (!nextEntry) {
      throw new Error(`Unknown session: ${requestedSessionId}`)
    }

    await this.activateContextSession(context, nextEntry)
    return { ok: true }
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
      return { leafId: null, tree: [] as Array<TreeNode> }
    }

    return {
      leafId: manager.getLeafId?.() ?? null,
      tree: (manager.getTree() || [])
        .map((node) => serializeSessionTreeNode(node))
        .filter((node): node is TreeNode => Boolean(node)),
    }
  }

  async getSessionTreeForRequest(request: Request) {
    const { activeEntry } = await this.resolveRequest(request)
    const tree = this.getSessionTree(activeEntry)
    return { ok: true, leafId: tree.leafId, tree: tree.tree }
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
    return { ok: true, leafId: tree.leafId, tree: tree.tree }
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

    await this.broadcastSessionsAll()
    return { ok: true, name: nextName }
  }

  async deleteSession(request: Request, body: { path?: unknown }) {
    const { context } = await this.resolveRequest(request)
    const sessionPath = typeof body.path === "string" ? body.path : ""
    if (!sessionPath) {
      throw new Error("path is required")
    }

    const loadedEntry = this.sessionEntries.get(sessionPath)
    let replacementEntry: SessionEntry | undefined
    if (loadedEntry) {
      const affectedContexts = [...this.contexts.values()].filter(
        (ctx) => ctx.activeKey === loadedEntry.key
      )
      if (affectedContexts.length > 0) {
        replacementEntry = await this.createNewSessionEntry(loadedEntry.cwd, {
          draft: true,
        })
        for (const affected of affectedContexts) {
          affected.draftKey = replacementEntry.key
          await this.activateContextSession(affected, replacementEntry)
        }
      }
      for (const ctx of this.contexts.values()) {
        ctx.unreadFinished.delete(sessionPath)
      }
      await this.disposeSessionEntry(loadedEntry)
    }

    try {
      await unlink(sessionPath)
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code
      if (code !== "ENOENT") {
        throw error
      }
    }

    await this.broadcastSessionsAll()
    return {
      ok: true,
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

  async runSlashCommand(
    request: Request,
    body: { name?: unknown; args?: unknown }
  ) {
    const { activeEntry } = await this.resolveRequest(request)
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const args = typeof body.args === "string" ? body.args : ""

    if (name !== "compact") {
      throw new Error(`Unknown slash command: /${name || "(empty)"}`)
    }

    await activeEntry.session.compact(args.trim() || undefined)
    await this.broadcastEntryState(activeEntry)
    await this.broadcastSessionsAll()
    return { ok: true, commandName: name }
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
          `[pi-web:warn] Syntax highlighting unavailable: ${formatError(error)}`
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
  var __piToGoRuntime: PiWebRuntime | undefined
}

export function getPiWebRuntime() {
  globalThis.__piToGoRuntime ??= new PiWebRuntime()
  return globalThis.__piToGoRuntime
}
