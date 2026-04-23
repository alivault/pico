import {
  buildItemsFromSync,
  previewUrlForImage,
  sameContextUsage,
  type PromptImage,
  type SessionState,
} from "@/lib/pi-web"
import { isApiErrorResponse } from "@/lib/pi-web-api"

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
    hiddenThinkingLabel:
      typeof next.hiddenThinkingLabel === "string"
        ? next.hiddenThinkingLabel
        : undefined,
  } satisfies SessionState["uiState"]

  return sharedStatuses === previous.statuses &&
    previous.title === sharedUiState.title &&
    previous.editorText === sharedUiState.editorText &&
    previous.workingMessage === sharedUiState.workingMessage &&
    previous.hiddenThinkingLabel === sharedUiState.hiddenThinkingLabel
    ? previous
    : sharedUiState
}

export function buildRequestUrl(
  path: string,
  {
    contextId,
    sessionId,
  }: {
    contextId: string
    sessionId?: string
  }
) {
  const url = new URL(path, window.location.origin)
  url.searchParams.set("context", contextId)
  if (sessionId) {
    url.searchParams.set("session", sessionId)
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

export function updateStateFromSync(
  previous: SessionState,
  sync: Parameters<typeof buildItemsFromSync>[0]
) {
  const { items } = buildItemsFromSync(sync, previous.items)
  const streaming = Boolean(sync.streaming)
  const draft = Boolean(sync.draft)
  const firstMessage = sync.firstMessage || ""
  const model = sameModel(previous.model, sync.model)
    ? previous.model
    : sync.model
  const thinkingLevel = sync.thinkingLevel || previous.thinkingLevel
  const availableThinkingLevels = sync.availableThinkingLevels
    ? sameStringArray(
        previous.availableThinkingLevels,
        sync.availableThinkingLevels
      )
      ? previous.availableThinkingLevels
      : sync.availableThinkingLevels
    : previous.availableThinkingLevels
  const availableModels = sync.availableModels
    ? sameModelArray(previous.availableModels, sync.availableModels)
      ? previous.availableModels
      : sync.availableModels
    : previous.availableModels
  const availableSkills = sync.availableSkills
    ? sameSkillArray(previous.availableSkills, sync.availableSkills)
      ? previous.availableSkills
      : sync.availableSkills
    : previous.availableSkills
  const hideThinkingBlock =
    typeof sync.hideThinkingBlock === "boolean"
      ? sync.hideThinkingBlock
      : previous.hideThinkingBlock
  const contextUsage = sameContextUsage(
    previous.contextUsage,
    sync.contextUsage
  )
    ? previous.contextUsage
    : sync.contextUsage
  const uiState = shareUiState(previous.uiState, sync.uiState)

  if (
    previous.connected &&
    !previous.replaying &&
    previous.streaming === streaming &&
    previous.draft === draft &&
    previous.items === items &&
    previous.sessionId === sync.sessionId &&
    previous.sessionKey === sync.sessionKey &&
    previous.sessionName === sync.sessionName &&
    previous.firstMessage === firstMessage &&
    previous.sessionFile === sync.sessionFile &&
    previous.cwd === sync.cwd &&
    previous.modified === sync.modified &&
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
    ...previous,
    connected: true,
    replaying: false,
    streaming,
    draft,
    items,
    sessionId: sync.sessionId,
    sessionKey: sync.sessionKey,
    sessionName: sync.sessionName,
    firstMessage,
    sessionFile: sync.sessionFile,
    cwd: sync.cwd,
    modified: sync.modified,
    model,
    thinkingLevel,
    availableThinkingLevels,
    availableModels,
    availableSkills,
    hideThinkingBlock,
    contextUsage,
    uiState,
  } satisfies SessionState
}
