import type { SessionListEntry } from "@/lib/pico/api"

/**
 * The sidebar order of sessions. Sessions with a finished run that you did
 * not see yet come first, newest first. All other sessions follow, by the
 * time of your last message to them. Streaming does not move a session, so
 * the rows stay in place while agents work.
 */
export function compareSidebarSessions(
  left: SessionListEntry,
  right: SessionListEntry
) {
  const leftDone = isUnreadDone(left)
  const rightDone = isUnreadDone(right)
  if (leftDone !== rightDone) return leftDone ? -1 : 1
  if (leftDone) {
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
