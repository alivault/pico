/**
 * Sync the sidebar layout across devices: the added directories in order, the
 * pinned sessions, and the collapsed directories. The server keeps the shared
 * copy. Local storage stays the copy that the UI reads, so the sidebar shows
 * at once when the page opens.
 *
 * All writes to the synced keys go through `safeLocalStorageSetItem`, so this
 * module sees each change without changes at the call sites. A change from
 * another device goes into local storage, and then a `pico:sidebar-state`
 * event tells the stores to read it again.
 */
import { emitPicoEvent } from "@/features/pico/agent/events"
import { fetchJson } from "@/features/pico/app-shell-utils"
import {
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  PINNED_SESSIONS_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  readStoredCollapsedDirectories,
  readStoredPinnedSessionKeys,
  readStoredSidebarDirectories,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico"
import type { SidebarStateEvent, SidebarStateSnapshot } from "@/lib/pico/api"
import { setLocalStorageWriteListener } from "@/lib/pico/storage"

export type SidebarSyncField =
  | "directories"
  | "pinnedSessionKeys"
  | "collapsedDirectories"

const FIELD_BY_KEY: Record<string, SidebarSyncField> = {
  [SIDEBAR_DIRECTORIES_STORAGE_KEY]: "directories",
  [PINNED_SESSIONS_STORAGE_KEY]: "pinnedSessionKeys",
  [COLLAPSED_DIRECTORIES_STORAGE_KEY]: "collapsedDirectories",
}

const KEY_BY_FIELD: Record<SidebarSyncField, string> = {
  directories: SIDEBAR_DIRECTORIES_STORAGE_KEY,
  pinnedSessionKeys: PINNED_SESSIONS_STORAGE_KEY,
  collapsedDirectories: COLLAPSED_DIRECTORIES_STORAGE_KEY,
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

let started = false
let ready = false
let applyingRemote = false
let lastRevision = -1
let pendingEvent: SidebarStateSnapshot | null = null
let flushTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false
const dirty = new Set<SidebarSyncField>()
/** Fields that a request now sends; a read must not overwrite them. */
const sending = new Set<SidebarSyncField>()

function readLocal(field: SidebarSyncField) {
  if (field === "directories") return readStoredSidebarDirectories().directories
  if (field === "pinnedSessionKeys") return readStoredPinnedSessionKeys()
  return readStoredCollapsedDirectories()
}

function readAllLocal() {
  return {
    directories: readLocal("directories"),
    pinnedSessionKeys: readLocal("pinnedSessionKeys"),
    collapsedDirectories: readLocal("collapsedDirectories"),
  }
}

function onLocalWrite(key: string) {
  if (applyingRemote) return
  const field = FIELD_BY_KEY[key]
  if (!field) return
  dirty.add(field)
  if (ready) scheduleFlush(FLUSH_DELAY_MS)
}

function scheduleFlush(delay: number) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void flush()
  }, delay)
}

async function flush() {
  if (flushing || dirty.size === 0) return
  flushing = true
  const fields = [...dirty]
  dirty.clear()
  for (const field of fields) sending.add(field)
  const body: Record<string, unknown> = { clientId }
  for (const field of fields) body[field] = readLocal(field)
  try {
    const state = await fetchJson<SidebarStateResponse>("/api/sidebar-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    lastRevision = Math.max(lastRevision, state.revision)
  } catch {
    // Send it again later; a newer local change replaces the old value.
    for (const field of fields) dirty.add(field)
    scheduleFlush(RETRY_DELAY_MS)
  } finally {
    sending.clear()
    flushing = false
  }
  if (dirty.size > 0 && !flushTimer) scheduleFlush(FLUSH_DELAY_MS)
}

/**
 * Write the shared state to local storage, except fields with local changes.
 * Events skip old revisions. A fresh read (`force`) is always current, also
 * when the server started again with a lower revision.
 */
function applyRemote(state: SidebarStateSnapshot, force = false) {
  if (!force && state.revision <= lastRevision) return
  lastRevision = state.revision
  const changed: Array<SidebarSyncField> = []
  applyingRemote = true
  try {
    for (const field of Object.keys(KEY_BY_FIELD) as Array<SidebarSyncField>) {
      if (dirty.has(field) || sending.has(field)) continue
      const next = JSON.stringify(state[field])
      const key = KEY_BY_FIELD[field]
      if (safeLocalStorageGetItem(key) === next) continue
      safeLocalStorageSetItem(key, next)
      changed.push(field)
    }
  } finally {
    applyingRemote = false
  }
  if (changed.length > 0) emitPicoEvent("pico:sidebar-state", { changed })
}

async function load() {
  const state = await fetchJson<SidebarStateResponse>("/api/sidebar-state")
  if (state.initialized && safeLocalStorageGetItem(MERGED_STORAGE_KEY)) {
    applyRemote(state, true)
    return
  }
  // The first sync of this browser: add its own lists to the shared state.
  dirty.clear()
  const merged = await fetchJson<SidebarStateResponse>(
    "/api/sidebar-state/merge",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, ...readAllLocal() }),
    }
  )
  safeLocalStorageSetItem(MERGED_STORAGE_KEY, "1")
  applyRemote(merged, true)
}

/** Start the sync once per page. Safe to call again. */
export function startSidebarSync() {
  if (started || typeof window === "undefined") return
  started = true
  setLocalStorageWriteListener(onLocalWrite)
  const attempt = async (): Promise<void> => {
    try {
      await load()
    } catch {
      await new Promise((done) => setTimeout(done, RETRY_DELAY_MS))
      return attempt()
    }
    ready = true
    if (pendingEvent) applyRemote(pendingEvent)
    pendingEvent = null
    // Changes made while the first load ran win over the shared state.
    if (dirty.size > 0) scheduleFlush(0)
  }
  void attempt()
}

/** Apply a `sidebar_state` event from the server event stream. */
export function handleSidebarStateEvent(event: SidebarStateEvent) {
  if (event.clientId === clientId) return
  if (!ready) {
    if (!pendingEvent || event.revision > pendingEvent.revision)
      pendingEvent = event
    return
  }
  applyRemote(event)
}

/** Read the shared state again, for example after the event stream reconnects. */
export function refreshSidebarState() {
  if (!ready) return
  void fetchJson<SidebarStateResponse>("/api/sidebar-state")
    .then((state) => {
      if (state.initialized) {
        applyRemote(state, true)
        return
      }
      // The server lost its copy: send this page's copy again.
      for (const field of Object.keys(KEY_BY_FIELD) as Array<SidebarSyncField>)
        dirty.add(field)
      scheduleFlush(0)
    })
    .catch(() => undefined)
}
