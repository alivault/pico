/**
 * The sidebar layout that all devices share, in `~/.pico/sidebar.json`: the
 * added projects in order, the pinned agents, and the collapsed projects.
 * Each change increases `revision`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type SidebarStateData = {
  projects: string[]
  pinnedAgentKeys: string[]
  collapsedProjects: Record<string, true>
}

/**
 * The fields in `sidebar.json`. Stored names: do not change. They are the
 * names from before the rename of agents to agents.
 */
type StoredSidebarState = {
  directories?: unknown
  pinnedSessionKeys?: unknown
  collapsedDirectories?: unknown
  revision?: unknown
}

export type SidebarStateSnapshot = SidebarStateData & {
  revision: number
  /** False until a client has saved or merged a state. */
  initialized: boolean
}

export type SidebarStateChange = Partial<{
  projects: unknown
  pinnedAgentKeys: unknown
  collapsedProjects: unknown
}>

/** Trimmed, unique, non-empty strings in their first order. */
export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const text = typeof entry === "string" ? entry.trim() : ""
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

/** Only the collapsed projects; a false value is the same as absent. */
export function normalizeCollapsed(value: unknown): Record<string, true> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, true> = {}
  for (const [key, collapsed] of Object.entries(value)) {
    const project = key.trim()
    if (project && collapsed) result[project] = true
  }
  return result
}

function appendMissing(base: string[], extra: string[]) {
  const seen = new Set(base)
  return [...base, ...extra.filter((entry) => !seen.has(entry))]
}

export class SidebarState {
  readonly #file: string
  #data: SidebarStateData
  #revision: number
  #initialized: boolean

  constructor(file: string) {
    this.#file = file
    let stored: StoredSidebarState | undefined
    try {
      stored = JSON.parse(readFileSync(file, "utf8")) as typeof stored
    } catch {
      // No shared sidebar yet.
    }
    this.#initialized = Boolean(stored)
    this.#revision =
      typeof stored?.revision === "number" && stored.revision >= 0
        ? stored.revision
        : 0
    this.#data = {
      projects: normalizeStringList(stored?.directories),
      pinnedAgentKeys: normalizeStringList(stored?.pinnedSessionKeys),
      collapsedProjects: normalizeCollapsed(stored?.collapsedDirectories),
    }
  }

  snapshot(): SidebarStateSnapshot {
    return {
      projects: [...this.#data.projects],
      pinnedAgentKeys: [...this.#data.pinnedAgentKeys],
      collapsedProjects: { ...this.#data.collapsedProjects },
      revision: this.#revision,
      initialized: this.#initialized,
    }
  }

  /** Replace the given fields. */
  update(change: SidebarStateChange) {
    const next = { ...this.#data }
    if (change.projects !== undefined)
      next.projects = normalizeStringList(change.projects)
    if (change.pinnedAgentKeys !== undefined)
      next.pinnedAgentKeys = normalizeStringList(change.pinnedAgentKeys)
    if (change.collapsedProjects !== undefined)
      next.collapsedProjects = normalizeCollapsed(change.collapsedProjects)
    return this.#save(next)
  }

  /**
   * Add a device's own lists to the shared state: the shared order comes
   * first, then the entries that only the device has.
   */
  merge(change: SidebarStateChange) {
    return this.#save({
      projects: appendMissing(
        this.#data.projects,
        normalizeStringList(change.projects)
      ),
      pinnedAgentKeys: appendMissing(
        this.#data.pinnedAgentKeys,
        normalizeStringList(change.pinnedAgentKeys)
      ),
      collapsedProjects: {
        ...normalizeCollapsed(change.collapsedProjects),
        ...this.#data.collapsedProjects,
      },
    })
  }

  #save(next: SidebarStateData) {
    this.#data = next
    this.#revision += 1
    this.#initialized = true
    mkdirSync(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.tmp`
    const stored: StoredSidebarState = {
      directories: this.#data.projects,
      pinnedSessionKeys: this.#data.pinnedAgentKeys,
      collapsedDirectories: this.#data.collapsedProjects,
      revision: this.#revision,
    }
    writeFileSync(temporary, JSON.stringify(stored, null, 2))
    renameSync(temporary, this.#file)
    return this.snapshot()
  }
}
