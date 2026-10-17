/**
 * The last state that a hub saw of a remote machine, for its offline view.
 *
 * While a machine is online, the proxy keeps copies of small JSON answers to
 * GET requests and follows the event streams of the browsers: the newest
 * state of each open session and the session lists. When the machine goes
 * offline, the proxy answers from these copies, so the page shows the last
 * state, also after a reload. The copies are in memory only.
 */

type Payload = Record<string, unknown> & { type?: unknown }

const MAX_RESPONSES = 300
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const MAX_CONTEXTS = 20
const MAX_SESSIONS_PER_CONTEXT = 6

/** Whether the proxy may keep a copy of the answer to a GET request. */
export function cacheableGet(path: string) {
  return (
    path.startsWith("/api/") &&
    !path.startsWith("/api/terminal/") &&
    !path.startsWith("/api/machine/") &&
    path !== "/api/system/health"
  )
}

export const MAX_CACHED_RESPONSE_BYTES = MAX_RESPONSE_BYTES

/** Apply an `itemsPatch` of a state sync; undefined when it does not fit. */
export function applyStatePatch(
  state: Payload,
  payload: Payload
): Payload | undefined {
  const patch = payload.itemsPatch as
    | {
        previousLength?: unknown
        start?: unknown
        deleteCount?: unknown
        items?: unknown
      }
    | undefined
  const items = Array.isArray(state.items) ? (state.items as unknown[]) : []
  if (
    !patch ||
    patch.previousLength !== items.length ||
    typeof patch.start !== "number" ||
    typeof patch.deleteCount !== "number" ||
    !Array.isArray(patch.items) ||
    patch.start < 0 ||
    patch.start + patch.deleteCount > items.length
  )
    return undefined
  const { itemsPatch: _patch, ...rest } = payload
  return {
    ...state,
    ...rest,
    items: [
      ...items.slice(0, patch.start),
      ...(patch.items as unknown[]),
      ...items.slice(patch.start + patch.deleteCount),
    ],
  }
}

export class OfflineCache {
  readonly #responses = new Map<string, { type: string; body: Buffer }>()
  #bytes = 0
  /** Context → session (or "draft") → the newest full state sync. */
  readonly #states = new Map<string, Map<string, Payload>>()
  /** Context → the newest session list payload. */
  readonly #sessions = new Map<string, Payload>()

  putResponse(key: string, type: string, body: Buffer) {
    if (body.length > MAX_RESPONSE_BYTES) return
    this.#deleteResponse(key)
    this.#responses.set(key, { type, body })
    this.#bytes += body.length
    for (const [oldest] of this.#responses) {
      if (
        this.#responses.size <= MAX_RESPONSES &&
        this.#bytes <= MAX_TOTAL_BYTES
      )
        break
      this.#deleteResponse(oldest)
    }
  }

  #deleteResponse(key: string) {
    const entry = this.#responses.get(key)
    if (!entry) return
    this.#bytes -= entry.body.length
    this.#responses.delete(key)
  }

  response(key: string) {
    const entry = this.#responses.get(key)
    if (!entry) return undefined
    // Most recently used goes last.
    this.#responses.delete(key)
    this.#responses.set(key, entry)
    return entry
  }

  #touch<T>(map: Map<string, T>, key: string, value: T, max: number) {
    map.delete(key)
    map.set(key, value)
    while (map.size > max) map.delete(map.keys().next().value!)
  }

  /**
   * An observer for one event stream. State syncs after the first are
   * patches against what this stream sent before, so each stream follows
   * its own state.
   */
  observeStream(contextId: string) {
    let current: Payload | undefined
    return (payload: Payload) => {
      if (payload.type === "sessions") {
        const previous = this.#sessions.get(contextId)
        this.#touch(
          this.#sessions,
          contextId,
          { ...previous, ...payload },
          MAX_CONTEXTS
        )
        return
      }
      if (payload.type !== "state_sync") return
      if (Array.isArray(payload.items)) current = payload
      else if (payload.itemsPatch !== undefined)
        current = current ? applyStatePatch(current, payload) : undefined
      else if (current) current = { ...current, ...payload }
      if (!current) return
      const key =
        typeof current.sessionId === "string" && current.sessionId
          ? current.sessionId
          : "draft"
      const sessions = this.#states.get(contextId) ?? new Map()
      this.#touch(sessions, key, current, MAX_SESSIONS_PER_CONTEXT)
      this.#touch(this.#states, contextId, sessions, MAX_CONTEXTS)
    }
  }

  /** The events that start an offline stream; empty when nothing is known. */
  bootstrap(contextId: string, sessionId: string | undefined) {
    const sessions = this.#states.get(contextId)
    const state =
      (sessionId ? sessions?.get(sessionId) : undefined) ??
      (sessions ? [...sessions.values()].at(-1) : undefined)
    const list = this.#sessions.get(contextId)
    return [state, list].filter((entry): entry is Payload => Boolean(entry))
  }
}
