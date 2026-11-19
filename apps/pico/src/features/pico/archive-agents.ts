import type { AgentListEntry } from "@/lib/pico/api"

/**
 * What a request to archive agents did: archived them at once (`true`),
 * opened the confirmation dialog (`"confirm"`), or did nothing (`false`).
 *
 * Archive asks first only when it loses something that Undo cannot bring
 * back: the reports of subagents that still work (an archived agent drops
 * them), or a worktree that the user chose to remove. The server does not
 * archive a working agent, so archive refuses it at once.
 */
export type ArchiveAgentsResult = boolean | "confirm"

export function agentTitle(entry: AgentListEntry) {
  return entry.title || "New agent"
}

/** The agents with a running turn: the server does not archive them. */
export function workingAgents(targets: Array<AgentListEntry>) {
  return targets.filter((target) => target.streaming)
}

export function workingAgentsMessage(working: Array<AgentListEntry>) {
  return working.length === 1
    ? `"${agentTitle(working[0]!)}" is working. Stop it before you archive it.`
    : `${working.length} agents are working. Stop them before you archive them.`
}

/**
 * The subagents of the targets that still work or wait on a job. They report
 * to their parent when they finish, and an archived parent drops the report.
 */
export function workingSubagents(
  targets: Array<AgentListEntry>,
  agents: Array<AgentListEntry>
) {
  const targetIds = new Set(targets.flatMap((target) => target.id ?? []))
  return agents.filter(
    (agent) =>
      agent.parent &&
      targetIds.has(agent.parent) &&
      !(agent.id && targetIds.has(agent.id)) &&
      (agent.streaming || agent.waiting)
  )
}

export function archivedAgentsMessage(targets: Array<AgentListEntry>) {
  return targets.length === 1
    ? `Archived "${agentTitle(targets[0]!)}"`
    : `Archived ${targets.length} agents`
}

export function restoredAgentsMessage(targets: Array<AgentListEntry>) {
  return targets.length === 1
    ? `Restored "${agentTitle(targets[0]!)}"`
    : `Restored ${targets.length} agents`
}
