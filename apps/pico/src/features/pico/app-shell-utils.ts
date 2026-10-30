import {
  buildItemsFromSync,
  createInitialAgentState,
  previewUrlForImage,
  promptDraftKey,
  sameContextUsage,
  type ConversationItem,
  type PromptImage,
  type AgentState,
} from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"
import {
  assertMachineWritable,
  hubUrl,
  isUnaddressedServerPath,
  MachineOfflineError,
  machineApiUrl,
} from "@/lib/pico/machine"
import {
  checkServerConnection,
  isGatewayFailure,
  markServerOnline,
  ServerUnreachableError,
} from "@/lib/pico/server-connection"

/** The hub's answer when a machine is not online and has no offline copy. */
function offlineMachineLabel(status: number, data: unknown) {
  if (status !== 503 || !data || typeof data !== "object") return undefined
  const { state, machine } = data as { state?: unknown; machine?: unknown }
  return state === "offline" && typeof machine === "string"
    ? machine
    : undefined
}

function sameStringArray(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function sameStatusMap(
  left: Record<string, string>,
  right: Record<string, string>
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false
  }

  return true
}

function sameModel(left: AgentState["model"], right: AgentState["model"]) {
  if (!left && !right) return true
  if (!left || !right) return false

  return (
    left.id === right.id &&
    left.provider === right.provider &&
    left.name === right.name &&
    Boolean(left.reasoning) === Boolean(right.reasoning)
  )
}

function sameModelArray(
  left: AgentState["availableModels"],
  right: AgentState["availableModels"]
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (!sameModel(left[index], right[index])) return false
  }

  return true
}

function sameSkillArray(
  left: AgentState["availableSkills"],
  right: AgentState["availableSkills"]
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftSkill = left[index]
    const rightSkill = right[index]

    if (!leftSkill || !rightSkill) return false
    if (leftSkill.name !== rightSkill.name) return false
    if (leftSkill.description !== rightSkill.description) return false
    if (leftSkill.scope !== rightSkill.scope) return false
    if (leftSkill.source !== rightSkill.source) return false
  }

  return true
}

function normalizeStatuses(
  value: AgentState["uiState"] | undefined
): Record<string, string> {
  const source = value?.statuses
  if (!source || typeof source !== "object") return {}

  const normalized: Record<string, string> = {}
  for (const [key, statusValue] of Object.entries(source)) {
    if (typeof statusValue === "string") {
      normalized[key] = statusValue
    }
  }

  return normalized
}

function shareUiState(
  previous: AgentState["uiState"],
  next: AgentState["uiState"] | undefined
) {
  if (!next) return previous

  const statuses = normalizeStatuses(next)
  const sharedStatuses = sameStatusMap(previous.statuses, statuses)
    ? previous.statuses
    : statuses

  const sharedUiState = {
    statuses: sharedStatuses,
    title: typeof next.title === "string" ? next.title : undefined,
    editorText:
      typeof next.editorText === "string" ? next.editorText : undefined,
    workingMessage:
      typeof next.workingMessage === "string" ? next.workingMessage : undefined,
  } satisfies AgentState["uiState"]

  return sharedStatuses === previous.statuses &&
    previous.title === sharedUiState.title &&
    previous.editorText === sharedUiState.editorText &&
    previous.workingMessage === sharedUiState.workingMessage
    ? previous
    : sharedUiState
}

type RequestSearchParams = Record<
  string,
  string | number | boolean | Array<string | number | boolean> | undefined
>

function withRequestParams(
  base: string,
  {
    contextId,
    agentId,
    searchParams,
  }: {
    contextId: string
    agentId?: string
    searchParams?: RequestSearchParams
  }
) {
  const url = new URL(base, window.location.origin)
  url.searchParams.set("context", contextId)
  if (agentId) {
    url.searchParams.set("agent", agentId)
  }

  for (const [key, rawValue] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        url.searchParams.append(key, String(value))
      }
      continue
    }

    if (rawValue == null) continue
    url.searchParams.set(key, String(rawValue))
  }

  return url.toString()
}

/** The URL of a request to a machine; see `useMachineId()`. */
export function buildRequestUrl(
  path: string,
  {
    machineId,
    ...options
  }: {
    /** The machine that gets the request. */
    machineId: string
    contextId: string
    agentId?: string
    searchParams?: RequestSearchParams
  }
) {
  return withRequestParams(machineApiUrl(machineId, path), options)
}

/** The URL of a request for global hub data, such as Web Push. */
export function buildHubRequestUrl(
  path: string,
  options: {
    contextId: string
    searchParams?: RequestSearchParams
  }
) {
  return withRequestParams(hubUrl(path), options)
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  if (typeof input === "string" && isUnaddressedServerPath(input)) {
    throw new Error(
      `${input} has no machine. Use buildRequestUrl or machineApiUrl.`
    )
  }
  assertMachineWritable(input, init?.method)
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    // fetch throws a TypeError when it gets no response at all.
    if (!(error instanceof TypeError)) throw error
    checkServerConnection()
    throw new ServerUnreachableError()
  }
  const text = await response.text()
  if (isGatewayFailure(response.status, text)) {
    checkServerConnection()
    throw new ServerUnreachableError()
  }
  markServerOnline()
  const data = text ? (JSON.parse(text) as T) : ({} as T)

  if (!response.ok) {
    const offlineLabel = offlineMachineLabel(response.status, data)
    if (offlineLabel !== undefined) throw new MachineOfflineError(offlineLabel)
    const message = isApiErrorResponse(data)
      ? data.error
      : `${response.status} ${response.statusText}`
    throw new Error(message)
  }

  if (isApiErrorResponse(data)) {
    throw new Error(data.error)
  }

  return data
}

/** The image files of a paste or a drop. */
export function getClipboardImageFiles(data: DataTransfer) {
  const itemFiles = Array.from(data.items).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return []
    const file = item.getAsFile()
    return file?.type.startsWith("image/") ? [file] : []
  })

  if (itemFiles.length > 0) {
    return itemFiles
  }

  return Array.from(data.files).filter((file) => file.type.startsWith("image/"))
}

export async function readFileAsPromptImage(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const data = window.btoa(binary)
  return {
    type: "image",
    mimeType: file.type || "image/png",
    data,
    previewUrl: previewUrlForImage({
      mimeType: file.type || "image/png",
      data,
    }),
  } satisfies PromptImage
}

function isLocalOnlyConversationItem(item: ConversationItem) {
  if (item.kind === "user") {
    return Boolean(item.pendingId) || Boolean(item.queued)
  }

  return item.kind === "assistant" && item.streaming && item.blocks.length === 0
}

function conversationPatchPrefixLength(
  items: Array<ConversationItem>,
  previousLength: number
) {
  const authoritativeCount = items.filter(
    (item) => !isLocalOnlyConversationItem(item)
  ).length
  let remaining = Math.max(0, authoritativeCount - previousLength)
  if (remaining === 0) return 0

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item && !isLocalOnlyConversationItem(item)) remaining -= 1
    if (remaining === 0) return index + 1
  }
  return 0
}

function applyConversationItemsPatch(
  previousItems: Array<ConversationItem>,
  patch: Parameters<typeof buildItemsFromSync>[0]["itemsPatch"]
) {
  if (!patch) return previousItems

  const authoritativeItems = previousItems.filter(
    (item) => !isLocalOnlyConversationItem(item)
  )
  const previousLength = Number.isInteger(patch.previousLength)
    ? patch.previousLength
    : authoritativeItems.length
  const start = Number.isInteger(patch.start) ? patch.start : -1
  const deleteCount = Number.isInteger(patch.deleteCount)
    ? patch.deleteCount
    : -1
  const items = Array.isArray(patch.items) ? patch.items : null

  if (
    start < 0 ||
    start > authoritativeItems.length ||
    deleteCount < 0 ||
    !items
  ) {
    return previousItems
  }

  const effectiveDeleteCount =
    previousLength === authoritativeItems.length &&
    start + deleteCount <= authoritativeItems.length
      ? deleteCount
      : Math.min(deleteCount, authoritativeItems.length - start)

  return [
    ...authoritativeItems.slice(0, start),
    ...items,
    ...authoritativeItems.slice(start + effectiveDeleteCount),
  ]
}

export function updateStateFromSync(
  previous: AgentState,
  sync: Parameters<typeof buildItemsFromSync>[0]
) {
  const replacingAgent =
    typeof sync.agentKey === "string" &&
    sync.agentKey !== (previous.agentKey || "")
  const base = replacingAgent
    ? {
        ...createInitialAgentState(),
        connected: previous.connected,
      }
    : previous
  const nextDraftOwnerKey = promptDraftKey({
    cwd: typeof sync.cwd === "string" ? sync.cwd : previous.cwd,
  })
  const replacingOptimisticDraft =
    replacingAgent && previous.agentKey === `optimistic:${nextDraftOwnerKey}`
  const incomingHistoryOffset =
    typeof sync.historyOffset === "number"
      ? sync.historyOffset
      : base.historyOffset
  const preservedHistoryItemCount =
    !replacingAgent && sync.itemsPatch
      ? conversationPatchPrefixLength(
          base.items,
          sync.itemsPatch.previousLength
        )
      : !replacingAgent && incomingHistoryOffset > base.historyOffset
        ? Math.min(
            base.items.length,
            incomingHistoryOffset - base.historyOffset
          )
        : 0
  const preservedHistoryItems = base.items.slice(0, preservedHistoryItemCount)
  const currentHistoryWindow = preservedHistoryItemCount
    ? base.items.slice(preservedHistoryItemCount)
    : base.items
  const previousItems = replacingOptimisticDraft
    ? previous.items
    : currentHistoryWindow
  const streaming =
    typeof sync.streaming === "boolean" ? sync.streaming : base.streaming
  const compacting =
    typeof sync.compacting === "boolean" ? sync.compacting : base.compacting
  const draft = typeof sync.draft === "boolean" ? sync.draft : base.draft
  const syncForItems = sync.itemsPatch
    ? {
        ...sync,
        draft,
        streaming,
        items: applyConversationItemsPatch(previousItems, sync.itemsPatch),
      }
    : {
        ...sync,
        draft,
        streaming,
      }
  const messages = Array.isArray(sync.messages) ? sync.messages : base.messages
  // Display-only patches must not synthesize a streaming update from the
  // retained streaming flag or rebuild the current conversation.
  const hasConversationUpdate =
    Array.isArray(sync.items) ||
    Boolean(sync.itemsPatch) ||
    Array.isArray(sync.messages) ||
    Array.isArray(sync.pendingUserMessages) ||
    typeof sync.streaming === "boolean" ||
    Object.prototype.hasOwnProperty.call(sync, "streamingMessage")
  const currentItems = hasConversationUpdate
    ? buildItemsFromSync(syncForItems, previousItems).items
    : previousItems
  const items = preservedHistoryItems.length
    ? [...preservedHistoryItems, ...currentItems]
    : currentItems
  const historyOffset =
    preservedHistoryItems.length > 0
      ? base.historyOffset
      : incomingHistoryOffset
  const historyTotalCount =
    typeof sync.historyTotalCount === "number"
      ? sync.historyTotalCount
      : base.historyTotalCount
  const agentKey =
    typeof sync.agentKey === "string" ? sync.agentKey : base.agentKey
  const agentId = Object.prototype.hasOwnProperty.call(sync, "agentId")
    ? sync.agentId
    : base.agentId
  const agentName = Object.prototype.hasOwnProperty.call(sync, "agentName")
    ? sync.agentName
    : base.agentName
  const firstMessage = Object.prototype.hasOwnProperty.call(
    sync,
    "firstMessage"
  )
    ? sync.firstMessage || ""
    : base.firstMessage
  const agentFile = Object.prototype.hasOwnProperty.call(sync, "agentFile")
    ? sync.agentFile
    : base.agentFile
  const cwd = Object.prototype.hasOwnProperty.call(sync, "cwd")
    ? sync.cwd
    : base.cwd
  const directory = Object.prototype.hasOwnProperty.call(sync, "directory")
    ? sync.directory
    : Object.prototype.hasOwnProperty.call(sync, "cwd")
      ? undefined
      : base.directory
  const modified = Object.prototype.hasOwnProperty.call(sync, "modified")
    ? sync.modified
    : base.modified
  const model = Object.prototype.hasOwnProperty.call(sync, "model")
    ? sameModel(base.model, sync.model)
      ? base.model
      : sync.model
    : base.model
  const thinkingLevel = Object.prototype.hasOwnProperty.call(
    sync,
    "thinkingLevel"
  )
    ? sync.thinkingLevel || base.thinkingLevel
    : base.thinkingLevel
  const availableThinkingLevels = sync.availableThinkingLevels
    ? sameStringArray(
        base.availableThinkingLevels,
        sync.availableThinkingLevels
      )
      ? base.availableThinkingLevels
      : sync.availableThinkingLevels
    : base.availableThinkingLevels
  const availableModels = sync.availableModels
    ? sameModelArray(base.availableModels, sync.availableModels)
      ? base.availableModels
      : sync.availableModels
    : base.availableModels
  const availableSkills = sync.availableSkills
    ? sameSkillArray(base.availableSkills, sync.availableSkills)
      ? base.availableSkills
      : sync.availableSkills
    : base.availableSkills
  const hideThinkingBlock =
    typeof sync.hideThinkingBlock === "boolean"
      ? sync.hideThinkingBlock
      : base.hideThinkingBlock
  const contextUsage = Object.prototype.hasOwnProperty.call(
    sync,
    "contextUsage"
  )
    ? sameContextUsage(base.contextUsage, sync.contextUsage)
      ? base.contextUsage
      : sync.contextUsage
    : base.contextUsage
  const uiState = shareUiState(base.uiState, sync.uiState)

  if (
    previous.connected &&
    !previous.replaying &&
    previous.streaming === streaming &&
    previous.compacting === compacting &&
    previous.draft === draft &&
    previous.messages === messages &&
    previous.items === items &&
    previous.historyOffset === historyOffset &&
    previous.historyTotalCount === historyTotalCount &&
    previous.agentId === agentId &&
    previous.agentKey === agentKey &&
    previous.agentName === agentName &&
    previous.firstMessage === firstMessage &&
    previous.agentFile === agentFile &&
    previous.cwd === cwd &&
    previous.directory === directory &&
    previous.modified === modified &&
    previous.model === model &&
    previous.thinkingLevel === thinkingLevel &&
    previous.availableThinkingLevels === availableThinkingLevels &&
    previous.availableModels === availableModels &&
    previous.availableSkills === availableSkills &&
    previous.hideThinkingBlock === hideThinkingBlock &&
    previous.contextUsage === contextUsage &&
    previous.uiState === uiState
  ) {
    return previous
  }

  return {
    ...base,
    connected: true,
    replaying: false,
    streaming,
    compacting,
    draft,
    messages,
    items,
    historyOffset,
    historyTotalCount,
    agentId,
    agentKey,
    agentName,
    firstMessage,
    agentFile,
    cwd,
    directory,
    modified,
    model,
    thinkingLevel,
    availableThinkingLevels,
    availableModels,
    availableSkills,
    hideThinkingBlock,
    contextUsage,
    uiState,
  } satisfies AgentState
}
