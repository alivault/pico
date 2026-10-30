import type { AgentListEntry } from "@/lib/pico/api"

/**
 * The sidebar order of agents, in three groups:
 *
 * 1. Agents with a finished run that you did not see yet, newest first.
 * 2. Streaming agents.
 * 3. Idle agents that you saw.
 *
 * Groups 2 and 3 are sorted by the time of your last message. An agent moves
 * only when its run starts or ends, or when you prompt it. New messages of a
 * running agent do not move it, so the rows stay in place while agents work.
 */
export function compareSidebarAgents(
  left: AgentListEntry,
  right: AgentListEntry
) {
  const byGroup = agentGroup(left) - agentGroup(right)
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

/** `agents` in sidebar order, in a new array. */
export function sortSidebarAgents(agents: Array<AgentListEntry>) {
  return agents.toSorted(compareSidebarAgents)
}

function agentGroup(entry: AgentListEntry) {
  if (isUnreadDone(entry)) return 0
  if (entry.streaming) return 1
  return 2
}

function isUnreadDone(entry: AgentListEntry) {
  return Boolean(entry.unread) && !entry.streaming
}

/** The last message of a finished run is near its end. */
function doneTime(entry: AgentListEntry) {
  return timestampValue(entry.lastMessageAt || entry.modified)
}

function lastPromptTime(entry: AgentListEntry) {
  return timestampValue(
    entry.lastUserMessageAt || entry.modified || entry.lastMessageAt
  )
}

function timestampValue(value: string | undefined) {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}
