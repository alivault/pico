import {
  buildItemsFromSync,
  createInitialSessionState,
  previewUrlForImage,
  promptDraftKey,
  sameContextUsage,
  thinkingSummaryText,
  type ConversationItem,
  type PromptImage,
  type SessionState,
} from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"

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

function sameModel(left: SessionState["model"], right: SessionState["model"]) {
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
  left: SessionState["availableModels"],
  right: SessionState["availableModels"]
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (!sameModel(left[index], right[index])) return false
  }

  return true
}

function sameSkillArray(
  left: SessionState["availableSkills"],
  right: SessionState["availableSkills"]
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
  value: SessionState["uiState"] | undefined
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

function isCurrentResponseBoundaryUser(item: SessionState["items"][number]) {
  return (
    item.kind === "user" &&
    !item.queued &&
    item.streamingBehavior !== "followUp" &&
    item.streamingBehavior !== "steer"
  )
}

function latestCurrentTurnThinkingSummaryText(items: SessionState["items"]) {
  // Keep the current-response scope narrow: scan backwards until the latest
  // real user turn, but ignore queued follow-ups/steering messages.
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex]
    if (!item) continue

    if (isCurrentResponseBoundaryUser(item)) return undefined
    if (item.kind !== "assistant") continue

    for (
      let blockIndex = item.blocks.length - 1;
      blockIndex >= 0;
      blockIndex -= 1
    ) {
      const block = item.blocks[blockIndex]
      if (block?.type !== "thinking") continue

      const summary = thinkingSummaryText(block, { allowPlaceholder: true })
      if (summary) return summary
    }
  }

  return undefined
}

function shareUiState(
  previous: SessionState["uiState"],
  next: SessionState["uiState"] | undefined
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
  } satisfies SessionState["uiState"]

  return sharedStatuses === previous.statuses &&
    previous.title === sharedUiState.title &&
    previous.editorText === sharedUiState.editorText &&
    previous.workingMessage === sharedUiState.workingMessage
    ? previous
    : sharedUiState
}

export function buildRequestUrl(
  path: string,
  {
    contextId,
    sessionId,
    searchParams,
  }: {
    contextId: string
    sessionId?: string
    searchParams?: Record<
      string,
      string | number | boolean | Array<string | number | boolean> | undefined
    >
  }
) {
  const url = new URL(path, window.location.origin)
  url.searchParams.set("context", contextId)
  if (sessionId) {
    url.searchParams.set("session", sessionId)
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

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const response = await fetch(input, init)
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)

  if (!response.ok) {
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
  previous: SessionState,
  sync: Parameters<typeof buildItemsFromSync>[0]
) {
  const replacingSession =
    typeof sync.sessionKey === "string" &&
    sync.sessionKey !== (previous.sessionKey || "")
  const base = replacingSession
    ? {
        ...createInitialSessionState(),
        connected: previous.connected,
      }
    : previous
  const nextDraftOwnerKey = promptDraftKey({
    cwd: typeof sync.cwd === "string" ? sync.cwd : previous.cwd,
  })
  const replacingOptimisticDraft =
    replacingSession &&
    previous.sessionKey === `optimistic:${nextDraftOwnerKey}`
  const previousItems = replacingOptimisticDraft ? previous.items : base.items
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
  const { items } = buildItemsFromSync(syncForItems, previousItems)
  const historyOffset =
    typeof sync.historyOffset === "number"
      ? sync.historyOffset
      : base.historyOffset
  const historyTotalCount =
    typeof sync.historyTotalCount === "number"
      ? sync.historyTotalCount
      : base.historyTotalCount
  const sessionKey =
    typeof sync.sessionKey === "string" ? sync.sessionKey : base.sessionKey
  const sessionId = Object.prototype.hasOwnProperty.call(sync, "sessionId")
    ? sync.sessionId
    : base.sessionId
  const sessionName = Object.prototype.hasOwnProperty.call(sync, "sessionName")
    ? sync.sessionName
    : base.sessionName
  const firstMessage = Object.prototype.hasOwnProperty.call(
    sync,
    "firstMessage"
  )
    ? sync.firstMessage || ""
    : base.firstMessage
  const sessionFile = Object.prototype.hasOwnProperty.call(sync, "sessionFile")
    ? sync.sessionFile
    : base.sessionFile
  const cwd = Object.prototype.hasOwnProperty.call(sync, "cwd")
    ? sync.cwd
    : base.cwd
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
  const hiddenThinkingPreview =
    streaming && hideThinkingBlock
      ? latestCurrentTurnThinkingSummaryText(items)
      : undefined

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
    previous.sessionId === sessionId &&
    previous.sessionKey === sessionKey &&
    previous.sessionName === sessionName &&
    previous.firstMessage === firstMessage &&
    previous.sessionFile === sessionFile &&
    previous.cwd === cwd &&
    previous.modified === modified &&
    previous.model === model &&
    previous.thinkingLevel === thinkingLevel &&
    previous.availableThinkingLevels === availableThinkingLevels &&
    previous.availableModels === availableModels &&
    previous.availableSkills === availableSkills &&
    previous.hideThinkingBlock === hideThinkingBlock &&
    previous.hiddenThinkingPreview === hiddenThinkingPreview &&
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
    sessionId,
    sessionKey,
    sessionName,
    firstMessage,
    sessionFile,
    cwd,
    modified,
    model,
    thinkingLevel,
    availableThinkingLevels,
    availableModels,
    availableSkills,
    hideThinkingBlock,
    hiddenThinkingPreview,
    contextUsage,
    uiState,
  } satisfies SessionState
}
