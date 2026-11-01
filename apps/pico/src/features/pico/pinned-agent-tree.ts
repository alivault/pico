/**
 * The Pinned group draws each pinned agent with its subagent tree. The
 * project and state groups do not show these agents again.
 */
import { sortSidebarAgents } from "@/features/pico/agent-order"
import type { AgentListEntry } from "@/lib/pico/api"
import { agentListEntryKey } from "@/lib/pico/storage"

/** The links between agents, for `pinnedAgentRows`. */
export type AgentTree = {
  /** The key of each agent ID. */
  keyById: Map<string, string>
  /** The agent ID of each key. */
  idByKey: Map<string, string>
  /** The parent ID of each agent key, for a subagent. */
  parentByKey: Map<string, string>
  /** The subagent keys of each agent ID, in sidebar order. */
  subagentKeysById: Map<string, Array<string>>
}

export type PinnedAgentRow = {
  key: string
  /** 0 for the pinned agent, 1 for its subagent, and so on. */
  depth: number
}

/** The most nesting levels that the Pinned group indents. */
const MAX_PINNED_DEPTH = 4

export function buildAgentTree(entries: Iterable<AgentListEntry>): AgentTree {
  const keyById = new Map<string, string>()
  const idByKey = new Map<string, string>()
  const parentByKey = new Map<string, string>()
  const subagentKeysById = new Map<string, Array<string>>()
  const sorted = sortSidebarAgents([...entries])
  for (const entry of sorted) {
    const key = agentListEntryKey(entry)
    if (!key || !entry.id || keyById.has(entry.id)) continue
    keyById.set(entry.id, key)
    idByKey.set(key, entry.id)
  }
  for (const entry of sorted) {
    const key = agentListEntryKey(entry)
    const parent = entry.parent
    if (!key || !parent || parent === entry.id || !keyById.has(parent)) continue
    if (parentByKey.has(key)) continue
    parentByKey.set(key, parent)
    const siblings = subagentKeysById.get(parent) ?? []
    siblings.push(key)
    subagentKeysById.set(parent, siblings)
  }
  return { keyById, idByKey, parentByKey, subagentKeysById }
}

/**
 * The rows of the Pinned group: each pinned agent, then its subagent tree.
 * A pinned agent with a pinned agent above it shows in that agent's tree,
 * not as a second row.
 */
export function pinnedAgentRows(
  tree: AgentTree,
  pinnedKeys: ReadonlyArray<string>
): Array<PinnedAgentRow> {
  const pinned = new Set(pinnedKeys)
  const hasPinnedAbove = (key: string) => {
    const seen = new Set([key])
    let parent = tree.parentByKey.get(key)
    while (parent) {
      const parentKey = tree.keyById.get(parent)
      if (!parentKey || seen.has(parentKey)) return false
      if (pinned.has(parentKey)) return true
      seen.add(parentKey)
      parent = tree.parentByKey.get(parentKey)
    }
    return false
  }
  const rows: Array<PinnedAgentRow> = []
  const drawn = new Set<string>()
  const visit = (key: string, depth: number) => {
    if (drawn.has(key)) return
    drawn.add(key)
    rows.push({ key, depth: Math.min(depth, MAX_PINNED_DEPTH) })
    const id = tree.idByKey.get(key)
    for (const subagent of (id && tree.subagentKeysById.get(id)) || [])
      visit(subagent, depth + 1)
  }
  for (const key of pinnedKeys) if (!hasPinnedAbove(key)) visit(key, 0)
  return rows
}

/** The keys of all rows of the Pinned group. */
export function pinnedAgentTreeKeys(
  tree: AgentTree,
  pinnedKeys: ReadonlyArray<string>
) {
  return new Set([
    ...pinnedKeys,
    ...pinnedAgentRows(tree, pinnedKeys).map((row) => row.key),
  ])
}

export function samePinnedAgentRows(
  left: Array<PinnedAgentRow>,
  right: Array<PinnedAgentRow>
) {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.key === right[index].key && row.depth === right[index].depth
    )
  )
}
