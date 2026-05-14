import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import type { SessionListInfoLike } from "@/server/pi-sdk-types"

type UnknownRecord = Record<string, unknown>

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object"
}

function normalizeFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function completeTurnStopReason(value: unknown) {
  return typeof value === "string" && value !== "toolUse"
}

function extractSessionListMessageText(message: UnknownRecord) {
  const content = message.content

  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .flatMap((part) =>
      isRecord(part) && part.type === "text"
        ? [typeof part.text === "string" ? part.text : ""]
        : []
    )
    .join("\n")
}

function extractSessionListImagePreview(message: UnknownRecord) {
  const content = message.content
  if (!Array.isArray(content)) return ""

  const imageCount = content.filter(
    (part) => isRecord(part) && part.type === "image"
  ).length
  if (imageCount <= 0) return ""

  return `${imageCount.toLocaleString()} image${imageCount === 1 ? "" : "s"}`
}

export function getSessionLastCompleteMessageInfo(messages: Array<unknown>) {
  let preview = ""
  let timestamp: string | undefined

  const applyPreview = (message: UnknownRecord, nextPreview: string) => {
    if (!nextPreview) return
    preview = nextPreview
    timestamp = normalizeModifiedTimestamp(message.timestamp) || timestamp
  }

  for (const message of messages) {
    if (!isRecord(message)) continue

    if (message.role === "user") {
      applyPreview(
        message,
        normalizeSessionListTitle(extractSessionListMessageText(message)) ||
          extractSessionListImagePreview(message)
      )
      continue
    }

    if (message.role !== "assistant") continue
    if (!completeTurnStopReason(message.stopReason)) continue

    applyPreview(
      message,
      normalizeSessionListTitle(extractSessionListMessageText(message))
    )
  }

  return {
    preview: preview || undefined,
    timestamp,
  }
}

export function getSessionLastCompleteMessagePreview(messages: Array<unknown>) {
  return getSessionLastCompleteMessageInfo(messages).preview
}

function normalizeNonNegativeInteger(value: unknown) {
  const number = normalizeFiniteNumber(value)
  if (number == null || number < 0) return undefined
  return Math.floor(number)
}

export function normalizeSessionListContextUsage(value: unknown) {
  if (!isRecord(value)) return undefined

  const tokens = normalizeFiniteNumber(value.tokens)
  const contextWindow = normalizeFiniteNumber(value.contextWindow)
  const explicitPercent = normalizeFiniteNumber(value.percent)
  const percent =
    explicitPercent ??
    (tokens != null && contextWindow != null && contextWindow > 0
      ? (tokens / contextWindow) * 100
      : undefined)

  if (tokens == null && contextWindow == null && percent == null) {
    return undefined
  }

  return {
    ...(tokens != null ? { tokens } : {}),
    ...(contextWindow != null ? { contextWindow } : {}),
    ...(percent != null ? { percent } : {}),
  }
}

export function normalizeModifiedTimestamp(value: unknown) {
  if (!value) return undefined
  const timestamp = new Date(value as string | number | Date).getTime()
  if (Number.isNaN(timestamp)) return undefined
  return new Date(timestamp).toISOString()
}

export function modifiedTimestampValue(value: unknown) {
  const normalized = normalizeModifiedTimestamp(value)
  if (!normalized) return 0
  const timestamp = new Date(normalized).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function laterModifiedTimestamp(...values: Array<unknown>) {
  let nextValue: string | undefined
  let nextTime = 0

  for (const value of values) {
    const normalized = normalizeModifiedTimestamp(value)
    const timestamp = modifiedTimestampValue(normalized)
    if (!timestamp || timestamp < nextTime) continue
    nextTime = timestamp
    nextValue = normalized
  }

  return nextValue
}

function normalizeSessionListName(value: unknown) {
  const normalized = typeof value === "string" ? normalizeWhitespace(value) : ""
  return normalized || undefined
}

export function normalizeSessionListTitle(value: unknown, maxLength = 240) {
  const text = typeof value === "string" ? normalizeWhitespace(value) : ""
  if (!text) return ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function getSessionListTitle(entry: {
  name?: unknown
  firstMessage?: unknown
}) {
  const explicitName = normalizeSessionListName(entry.name)
  if (explicitName && explicitName !== "Current session") return explicitName
  const fallback = normalizeSessionListTitle(entry.firstMessage)
  return fallback || "New session"
}

export function mergeSessionListEntry(
  target: SessionListInfoLike,
  fallback: SessionListInfoLike & { title?: string }
) {
  target.path = fallback.path || target.path
  target.id = fallback.id || target.id
  target.cwd = fallback.cwd || target.cwd
  target.name = fallback.name || target.name
  target.modified = laterModifiedTimestamp(target.modified, fallback.modified)
  target.lastUserMessageAt = laterModifiedTimestamp(
    target.lastUserMessageAt,
    fallback.lastUserMessageAt
  )
  target.lastMessageAt = laterModifiedTimestamp(
    target.lastMessageAt,
    fallback.lastMessageAt
  )
  const fallbackMessageCount = normalizeNonNegativeInteger(
    fallback.messageCount
  )
  const targetMessageCount = normalizeNonNegativeInteger(target.messageCount)
  target.messageCount =
    fallbackMessageCount != null && targetMessageCount != null
      ? Math.max(fallbackMessageCount, targetMessageCount)
      : (fallbackMessageCount ?? targetMessageCount)
  target.contextUsage =
    normalizeSessionListContextUsage(fallback.contextUsage) ??
    normalizeSessionListContextUsage(target.contextUsage)
  if (fallback.lastMessagePreview) {
    target.lastMessagePreview = normalizeSessionListTitle(
      fallback.lastMessagePreview
    )
  }
  if (fallback.firstMessage) {
    target.firstMessage = fallback.firstMessage
  }
  return target
}

function sessionListLastUserMessageTimestampValue(entry: SessionListInfoLike) {
  return (
    modifiedTimestampValue(entry.lastUserMessageAt) ||
    modifiedTimestampValue(entry.modified)
  )
}

export function compareSessionListEntriesByLastUserMessage(
  left: SessionListInfoLike,
  right: SessionListInfoLike
) {
  return (
    sessionListLastUserMessageTimestampValue(right) -
      sessionListLastUserMessageTimestampValue(left) ||
    modifiedTimestampValue(right.modified) -
      modifiedTimestampValue(left.modified)
  )
}

export function countFullTurnUserAndAssistantMessages(
  messages: Array<unknown>
) {
  let count = 0
  let hasTurnUser = false
  let turnAssistantCount = 0
  let turnComplete = false

  const finishTurn = (assumeComplete: boolean) => {
    if (
      hasTurnUser &&
      turnAssistantCount > 0 &&
      (turnComplete || assumeComplete)
    ) {
      count += 1 + turnAssistantCount
    }
  }

  for (const message of messages) {
    if (!isRecord(message)) continue

    if (message.role === "user") {
      finishTurn(true)
      hasTurnUser = true
      turnAssistantCount = 0
      turnComplete = false
      continue
    }

    if (message.role !== "assistant" || !hasTurnUser) continue

    turnAssistantCount += 1
    if (completeTurnStopReason(message.stopReason)) {
      turnComplete = true
    }
  }

  finishTurn(false)
  return count
}

export async function readSessionListMetrics(sessionPath: string) {
  try {
    const content = await readFile(sessionPath, "utf8")
    let lastTimestamp = 0
    let lastValue: string | undefined
    const messages: Array<UnknownRecord> = []

    for (const line of content.split("\n")) {
      if (!line.trim()) continue

      let entry: unknown
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      if (!isRecord(entry) || entry.type !== "message") continue
      const message = isRecord(entry.message) ? entry.message : undefined
      if (!message) continue

      const messageWithTimestamp: UnknownRecord = {
        ...message,
        timestamp: message.timestamp ?? entry.timestamp,
      }

      if (messageWithTimestamp.role === "user") {
        const normalized = normalizeModifiedTimestamp(
          messageWithTimestamp.timestamp
        )
        const timestamp = modifiedTimestampValue(normalized)
        if (timestamp && timestamp >= lastTimestamp) {
          lastTimestamp = timestamp
          lastValue = normalized
        }
      }

      if (
        messageWithTimestamp.role === "user" ||
        messageWithTimestamp.role === "assistant"
      ) {
        messages.push(messageWithTimestamp)
      }
    }

    const lastMessage = getSessionLastCompleteMessageInfo(messages)

    return {
      lastUserMessageAt: lastValue,
      lastMessageAt: lastMessage.timestamp,
      lastMessagePreview: lastMessage.preview,
      messageCount: countFullTurnUserAndAssistantMessages(messages),
    }
  } catch {
    return undefined
  }
}

export async function readSessionLastUserMessageTimestamp(sessionPath: string) {
  return (await readSessionListMetrics(sessionPath))?.lastUserMessageAt
}

export function listKnownDirectories(options: {
  allSessions: Array<SessionListInfoLike>
  loadedDirectories: Array<string>
}) {
  const { allSessions, loadedDirectories } = options
  return [
    ...new Set([
      process.cwd(),
      ...allSessions.map((entry) => entry.cwd),
      ...loadedDirectories,
    ]),
  ]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

export function serializeSessionListEntry(options: {
  entry: SessionListInfoLike
  unreadSessionPaths: Set<string>
  streamingPaths: Set<string>
}) {
  const { entry, streamingPaths, unreadSessionPaths } = options
  const path =
    typeof entry.path === "string" && entry.path ? entry.path : undefined
  const name = normalizeSessionListName(entry.name)
  return {
    path,
    id: entry.id,
    cwd: entry.cwd,
    name,
    title: getSessionListTitle({ name, firstMessage: entry.firstMessage }),
    modified: normalizeModifiedTimestamp(entry.modified),
    lastUserMessageAt: normalizeModifiedTimestamp(entry.lastUserMessageAt),
    lastMessageAt: normalizeModifiedTimestamp(entry.lastMessageAt),
    lastMessagePreview: normalizeSessionListTitle(entry.lastMessagePreview),
    messageCount: normalizeNonNegativeInteger(entry.messageCount),
    contextUsage: normalizeSessionListContextUsage(entry.contextUsage),
    streaming: path ? streamingPaths.has(path) : false,
    unread: path ? unreadSessionPaths.has(path) : false,
  }
}

export function createDirectorySessionRevision(
  directoryPath: string,
  entries: Array<{
    path?: string
    id?: string
    name?: string
    title?: string
    modified?: string
    lastUserMessageAt?: string
    lastMessageAt?: string
    lastMessagePreview?: string
    messageCount?: number
    contextUsage?: {
      tokens?: number
      contextWindow?: number
      percent?: number
    }
  }>
) {
  const hash = createHash("sha1")
  hash.update(directoryPath)

  for (const entry of entries) {
    hash.update("\n")
    hash.update(String(entry.id || ""))
    hash.update("\0")
    hash.update(String(entry.path || ""))
    hash.update("\0")
    hash.update(String(entry.name || ""))
    hash.update("\0")
    hash.update(String(entry.title || ""))
    hash.update("\0")
    hash.update(String(entry.modified || ""))
    hash.update("\0")
    hash.update(String(entry.lastUserMessageAt || ""))
    hash.update("\0")
    hash.update(String(entry.lastMessageAt || ""))
    hash.update("\0")
    hash.update(String(entry.lastMessagePreview || ""))
    hash.update("\0")
    hash.update(String(entry.messageCount ?? ""))
    hash.update("\0")
    hash.update(String(entry.contextUsage?.tokens ?? ""))
    hash.update("\0")
    hash.update(String(entry.contextUsage?.contextWindow ?? ""))
    hash.update("\0")
    hash.update(String(entry.contextUsage?.percent ?? ""))
  }

  return hash.digest("hex")
}
