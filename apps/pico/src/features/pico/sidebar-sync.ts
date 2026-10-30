/**
 * Sync the sidebar layout across devices: the added projects in order, the
 * pinned agents, and the collapsed projects. Each machine's server keeps
 * the shared copy of that machine. Local storage stays the copy that the UI
 * reads, so the sidebar shows at once when the page opens.
 *
 * All writes to the synced keys go through `machineLocalStorageSetItem`, so
 * this module sees each change without changes at the call sites. A change
 * from another device goes into local storage, and then a
 * `pico:sidebar-state` event tells the stores of that machine to read it
 * again.
 *
 * There is one sync for each machine, so several machines can sync at the
 * same time.
 */
import { emitPicoEvent } from "@/features/pico/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  COLLAPSED_PROJECTS_STORAGE_KEY,
  PINNED_AGENTS_STORAGE_KEY,
  SIDEBAR_PROJECTS_STORAGE_KEY,
  machineLocalStorageGetItem,
  machineLocalStorageSetItem,
  readStoredCollapsedProjects,
  readStoredPinnedAgentKeys,
  readStoredSidebarProjects,
} from "@/lib/pico"
import type { SidebarStateEvent, SidebarStateSnapshot } from "@/lib/pico/api"
import { setLocalStorageWriteListener } from "@/lib/pico/storage"

export type SidebarSyncField =
  | "projects"
  | "pinnedAgentKeys"
  | "collapsedProjects"

const FIELD_BY_KEY: Record<string, SidebarSyncField> = {
  [SIDEBAR_PROJECTS_STORAGE_KEY]: "projects",
  [PINNED_AGENTS_STORAGE_KEY]: "pinnedAgentKeys",
  [COLLAPSED_PROJECTS_STORAGE_KEY]: "collapsedProjects",
}

const KEY_BY_FIELD: Record<SidebarSyncField, string> = {
  projects: SIDEBAR_PROJECTS_STORAGE_KEY,
  pinnedAgentKeys: PINNED_AGENTS_STORAGE_KEY,
  collapsedProjects: COLLAPSED_PROJECTS_STORAGE_KEY,
}

/** Set after this browser added its own lists to the shared state once. */
const MERGED_STORAGE_KEY = "pico-sidebar-state-merged"
const FLUSH_DELAY_MS = 150
const RETRY_DELAY_MS = 5000

type SidebarStateResponse = SidebarStateSnapshot & { ok: true }

/** Identifies this page, so it can skip the events of its own changes. */
const clientId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

class MachineSidebarSync {
  readonly machineId: string
  #contextId = ""
  #started = false
  #ready = false
  #applyingRemote = false
  #lastRevision = -1
  #pendingEvent: SidebarStateSnapshot | null = null
  #flushTimer: ReturnType<typeof setTimeout> | undefined
  #flushing = false
  readonly #dirty = new Set<SidebarSyncField>()
  /** Fields that a request now sends; a read must not overwrite them. */
  readonly #sending = new Set<SidebarSyncField>()

  constructor(machineId: string) {
    this.machineId = machineId
  }

  #url() {
    return buildRequestUrl("/api/sidebar-state", {
      machineId: this.machineId,
      contextId: this.#contextId,
    })
  }

  #readLocal(field: SidebarSyncField) {
    if (field === "projects")
      return readStoredSidebarProjects(this.machineId).projects
    if (field === "pinnedAgentKeys")
      return readStoredPinnedAgentKeys(this.machineId)
    return readStoredCollapsedProjects(this.machineId)
  }

  #readAllLocal() {
    return {
      projects: this.#readLocal("projects"),
      pinnedAgentKeys: this.#readLocal("pinnedAgentKeys"),
      collapsedProjects: this.#readLocal("collapsedProjects"),
    }
  }

  onLocalWrite(key: string) {
    if (this.#applyingRemote) return
    const field = FIELD_BY_KEY[key]
    if (!field) return
    this.#dirty.add(field)
    if (this.#ready) this.#scheduleFlush(FLUSH_DELAY_MS)
  }

  #scheduleFlush(delay: number) {
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined
      void this.#flush()
    }, delay)
  }

  async #flush() {
    if (this.#flushing || this.#dirty.size === 0) return
    this.#flushing = true
    const fields = [...this.#dirty]
    this.#dirty.clear()
    for (const field of fields) this.#sending.add(field)
    const body: Record<string, unknown> = { clientId }
    for (const field of fields) body[field] = this.#readLocal(field)
    try {
      const state = await fetchJson<SidebarStateResponse>(this.#url(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      this.#lastRevision = Math.max(this.#lastRevision, state.revision)
    } catch {
      // Send it again later; a newer local change replaces the old value.
      for (const field of fields) this.#dirty.add(field)
      this.#scheduleFlush(RETRY_DELAY_MS)
    } finally {
      this.#sending.clear()
      this.#flushing = false
    }
    if (this.#dirty.size > 0 && !this.#flushTimer)
      this.#scheduleFlush(FLUSH_DELAY_MS)
  }

  /**
   * Write the shared state to local storage, except fields with local
   * changes. Events skip old revisions. A fresh read (`force`) is always
   * current, also when the server started again with a lower revision.
   */
  #applyRemote(state: SidebarStateSnapshot, force = false) {
    if (!force && state.revision <= this.#lastRevision) return
    this.#lastRevision = state.revision
    const changed: Array<SidebarSyncField> = []
    this.#applyingRemote = true
    try {
      for (const field of Object.keys(
        KEY_BY_FIELD
      ) as Array<SidebarSyncField>) {
        if (this.#dirty.has(field) || this.#sending.has(field)) continue
        const next = JSON.stringify(state[field])
        const key = KEY_BY_FIELD[field]
        if (machineLocalStorageGetItem(this.machineId, key) === next) continue
        machineLocalStorageSetItem(this.machineId, key, next)
        changed.push(field)
      }
    } finally {
      this.#applyingRemote = false
    }
    if (changed.length > 0)
      emitPicoEvent("pico:sidebar-state", {
        machineId: this.machineId,
        changed,
      })
  }

  async #load() {
    const state = await fetchJson<SidebarStateResponse>(this.#url())
    if (
      state.initialized &&
      machineLocalStorageGetItem(this.machineId, MERGED_STORAGE_KEY)
    ) {
      this.#applyRemote(state, true)
      return
    }
    // The first sync of this browser: add its own lists to the shared state.
    this.#dirty.clear()
    const merged = await fetchJson<SidebarStateResponse>(
      buildRequestUrl("/api/sidebar-state/merge", {
        machineId: this.machineId,
        contextId: this.#contextId,
      }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, ...this.#readAllLocal() }),
      }
    )
    machineLocalStorageSetItem(this.machineId, MERGED_STORAGE_KEY, "1")
    this.#applyRemote(merged, true)
  }

  start(contextId: string) {
    if (this.#started) return
    this.#started = true
    this.#contextId = contextId
    const attempt = async (): Promise<void> => {
      try {
        await this.#load()
      } catch {
        await new Promise((done) => setTimeout(done, RETRY_DELAY_MS))
        return attempt()
      }
      this.#ready = true
      if (this.#pendingEvent) this.#applyRemote(this.#pendingEvent)
      this.#pendingEvent = null
      // Changes made while the first load ran win over the shared state.
      if (this.#dirty.size > 0) this.#scheduleFlush(0)
    }
    void attempt()
  }

  handleEvent(event: SidebarStateEvent) {
    if (event.clientId === clientId) return
    if (!this.#ready) {
      if (!this.#pendingEvent || event.revision > this.#pendingEvent.revision)
        this.#pendingEvent = event
      return
    }
    this.#applyRemote(event)
  }

  refresh() {
    if (!this.#ready) return
    void fetchJson<SidebarStateResponse>(this.#url())
      .then((state) => {
        if (state.initialized) {
          this.#applyRemote(state, true)
          return
        }
        // The server lost its copy: send this page's copy again.
        for (const field of Object.keys(
          KEY_BY_FIELD
        ) as Array<SidebarSyncField>)
          this.#dirty.add(field)
        this.#scheduleFlush(0)
      })
      .catch(() => undefined)
  }
}

const syncs = new Map<string, MachineSidebarSync>()

function syncFor(machineId: string) {
  let sync = syncs.get(machineId)
  if (!sync) {
    sync = new MachineSidebarSync(machineId)
    syncs.set(machineId, sync)
  }
  return sync
}

let listening = false

/** Start the sync of a machine once per page. Safe to call again. */
export function startSidebarSync(machineId: string, contextId: string) {
  if (typeof window === "undefined") return
  if (!listening) {
    listening = true
    setLocalStorageWriteListener((key, keyMachineId) => {
      if (keyMachineId !== undefined) syncs.get(keyMachineId)?.onLocalWrite(key)
    })
  }
  syncFor(machineId).start(contextId)
}

/** Apply a `sidebar_state` event from the event stream of a machine. */
export function handleSidebarStateEvent(
  machineId: string,
  event: SidebarStateEvent
) {
  syncFor(machineId).handleEvent(event)
}

/**
 * Read the shared state of a machine again, for example after its event
 * stream reconnects.
 */
export function refreshSidebarState(machineId: string) {
  syncFor(machineId).refresh()
}
