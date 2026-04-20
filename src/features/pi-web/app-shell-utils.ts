import {
  buildItemsFromSync,
  previewUrlForImage,
  type PromptImage,
  type SessionState,
} from "@/lib/pi-web"
import { isApiErrorResponse } from "@/lib/pi-web-api"

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
  const { items } = buildItemsFromSync(sync)
  return {
    ...previous,
    connected: true,
    replaying: false,
    streaming: Boolean(sync.streaming),
    draft: Boolean(sync.draft),
    items,
    sessionId: sync.sessionId,
    sessionKey: sync.sessionKey,
    sessionName: sync.sessionName,
    firstMessage: sync.firstMessage || "",
    sessionFile: sync.sessionFile,
    cwd: sync.cwd,
    modified: sync.modified,
    model: sync.model,
    thinkingLevel: sync.thinkingLevel || previous.thinkingLevel,
    availableThinkingLevels:
      sync.availableThinkingLevels || previous.availableThinkingLevels,
    availableModels: sync.availableModels || previous.availableModels,
    availableSkills: sync.availableSkills || previous.availableSkills,
    hideThinkingBlock:
      typeof sync.hideThinkingBlock === "boolean"
        ? sync.hideThinkingBlock
        : previous.hideThinkingBlock,
    contextUsage: sync.contextUsage,
    uiState: sync.uiState || previous.uiState,
  } satisfies SessionState
}
