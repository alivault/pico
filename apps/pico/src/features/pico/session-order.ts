import type { SessionListEntry } from "@/lib/pico/api"

/**
 * The sidebar order of sessions, in three groups:
 *
 * 1. Sessions with a finished run that you did not see yet, newest first.
 * 2. Streaming sessions.
 * 3. Idle sessions that you saw.
 *
 * Groups 2 and 3 are sorted by the time of your last message. A session moves
 * only when its run starts or ends, or when you prompt it. New messages of a
 * running agent do not move it, so the rows stay in place while agents work.
 */
export function compareSidebarSessions(
  left: SessionListEntry,
  right: SessionListEntry
) {
  const byGroup = sessionGroup(left) - sessionGroup(right)
  if (byGroup) return byGroup
  if (isUnreadDone(left)) {
    const byFinish = doneTime(right) - doneTime(left)
    if (byFinish) return byFinish
  }
  return (
    lastPromptTime(right) - lastPromptTime(left) ||
    timestampValue(right.modified) - timestampValue(left.modified)
  )
}

/** `sessions` in sidebar order, in a new array. */
export function sortSidebarSessions(sessions: Array<SessionListEntry>) {
  return sessions.toSorted(compareSidebarSessions)
}

function sessionGroup(entry: SessionListEntry) {
  if (isUnreadDone(entry)) return 0
  if (entry.streaming) return 1
  return 2
}

function isUnreadDone(entry: SessionListEntry) {
  return Boolean(entry.unread) && !entry.streaming
}

/** The last message of a finished run is near its end. */
function doneTime(entry: SessionListEntry) {
  return timestampValue(entry.lastMessageAt || entry.modified)
}

function lastPromptTime(entry: SessionListEntry) {
  return timestampValue(
    entry.lastUserMessageAt || entry.modified || entry.lastMessageAt
  )
}

function timestampValue(value: string | undefined) {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}
