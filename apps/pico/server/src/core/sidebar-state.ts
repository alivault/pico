/**
 * The sidebar layout that all devices share, in `~/.pico/sidebar.json`: the
 * added directories in order, the pinned sessions, and the collapsed
 * directories. Each change increases `revision`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type SidebarStateData = {
  directories: string[]
  pinnedSessionKeys: string[]
  collapsedDirectories: Record<string, true>
}

export type SidebarStateSnapshot = SidebarStateData & {
  revision: number
  /** False until a client has saved or merged a state. */
  initialized: boolean
}

export type SidebarStateChange = Partial<{
  directories: unknown
  pinnedSessionKeys: unknown
  collapsedDirectories: unknown
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

/** Only the collapsed directories; a false value is the same as absent. */
export function normalizeCollapsed(value: unknown): Record<string, true> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, true> = {}
  for (const [key, collapsed] of Object.entries(value)) {
    const directory = key.trim()
    if (directory && collapsed) result[directory] = true
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
    let stored: Partial<SidebarStateData & { revision: number }> | undefined
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
      directories: normalizeStringList(stored?.directories),
      pinnedSessionKeys: normalizeStringList(stored?.pinnedSessionKeys),
      collapsedDirectories: normalizeCollapsed(stored?.collapsedDirectories),
    }
  }

  snapshot(): SidebarStateSnapshot {
    return {
      directories: [...this.#data.directories],
      pinnedSessionKeys: [...this.#data.pinnedSessionKeys],
      collapsedDirectories: { ...this.#data.collapsedDirectories },
      revision: this.#revision,
      initialized: this.#initialized,
    }
  }

  /** Replace the given fields. */
  update(change: SidebarStateChange) {
    const next = { ...this.#data }
    if (change.directories !== undefined)
      next.directories = normalizeStringList(change.directories)
    if (change.pinnedSessionKeys !== undefined)
      next.pinnedSessionKeys = normalizeStringList(change.pinnedSessionKeys)
    if (change.collapsedDirectories !== undefined)
      next.collapsedDirectories = normalizeCollapsed(
        change.collapsedDirectories
      )
    return this.#save(next)
  }

  /**
   * Add a device's own lists to the shared state: the shared order comes
   * first, then the entries that only the device has.
   */
  merge(change: SidebarStateChange) {
    return this.#save({
      directories: appendMissing(
        this.#data.directories,
        normalizeStringList(change.directories)
      ),
      pinnedSessionKeys: appendMissing(
        this.#data.pinnedSessionKeys,
        normalizeStringList(change.pinnedSessionKeys)
      ),
      collapsedDirectories: {
        ...normalizeCollapsed(change.collapsedDirectories),
        ...this.#data.collapsedDirectories,
      },
    })
  }

  #save(next: SidebarStateData) {
    this.#data = next
    this.#revision += 1
    this.#initialized = true
    mkdirSync(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.tmp`
    writeFileSync(
      temporary,
      JSON.stringify({ ...this.#data, revision: this.#revision }, null, 2)
    )
    renameSync(temporary, this.#file)
    return this.snapshot()
  }
}
