import { createHash } from "node:crypto"

import type { SessionListInfoLike } from "@/server/pi-sdk-types"

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
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

export function normalizeSessionListName(value: unknown) {
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
  if (fallback.firstMessage) {
    target.firstMessage = fallback.firstMessage
  }
  return target
}

export function compareSessionListEntriesByModified(
  left: SessionListInfoLike,
  right: SessionListInfoLike
) {
  return (
    modifiedTimestampValue(right.modified) -
    modifiedTimestampValue(left.modified)
  )
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
  }

  return hash.digest("hex")
}
