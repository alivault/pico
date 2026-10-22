/**
 * Viewer contexts: one per browser tab or window. A context selects a session
 * or a draft (a new session that has no prompt yet) and keeps its sidebar
 * directories. Contexts are saved, so a reload returns to the same place.
 *
 * Read state is global: a session read in one tab or client is read in all of
 * them. Agents can also change it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type DraftSelection = {
  sessionKey: string
  cwd: string
  /** Model and thinking chosen before the first prompt. */
  model?: { provider: string; modelId: string }
  thinkingLevel?: string
  /** Make a git worktree for the session when the first prompt creates it. */
  worktree?: { branch?: string; base?: string }
  /** The tool profile of the session that the first prompt creates. */
  profile?: string
}

export type ViewerContext = {
  selectedSession?: string
  activeDraft?: DraftSelection
  sidebarDirectories: string[]
  updatedAt: number
}

type StoredContext = Partial<ViewerContext> & { unread?: unknown }

type StoredViewers = {
  version: 2
  contexts: Record<string, StoredContext>
  unread: string[]
}

/** A session became read or unread. */
export type ReadListener = (sessionId: string, unread: boolean) => void

const MAX_CONTEXTS = 200

export class Viewers {
  readonly #file: string
  readonly #contexts = new Map<string, ViewerContext>()
  /** The sessions with a finished run that nobody has read. */
  readonly #unread = new Set<string>()
  /** The number of open event streams of each context. */
  readonly #attached = new Map<string, number>()
  readonly #listeners = new Set<() => void>()
  readonly #readListeners = new Set<ReadListener>()
  #saveTimer: NodeJS.Timeout | undefined

  constructor(file: string) {
    this.#file = file
    let stored: unknown
    try {
      stored = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      return // No saved contexts yet.
    }
    if (!stored || typeof stored !== "object") return
    const current = (stored as Partial<StoredViewers>).version === 2
    const contexts = (
      current ? ((stored as StoredViewers).contexts ?? {}) : stored
    ) as Record<string, StoredContext>
    for (const [id, context] of Object.entries(contexts)) {
      if (!context || typeof context !== "object") continue
      this.#contexts.set(id, {
        ...(context.selectedSession
          ? { selectedSession: context.selectedSession }
          : {}),
        ...(context.activeDraft ? { activeDraft: context.activeDraft } : {}),
        sidebarDirectories: Array.isArray(context.sidebarDirectories)
          ? context.sidebarDirectories
          : [],
        updatedAt:
          typeof context.updatedAt === "number" ? context.updatedAt : 0,
      })
    }
    const unread = current
      ? (stored as StoredViewers).unread
      : // Before version 2, each context had its own unread sessions. Keep
        // those of the context used last: they are closest to what the user saw.
        Object.values(contexts)
          .filter((context) => context && typeof context === "object")
          .sort(
            (left, right) =>
              (typeof right.updatedAt === "number" ? right.updatedAt : 0) -
              (typeof left.updatedAt === "number" ? left.updatedAt : 0)
          )[0]?.unread
    if (Array.isArray(unread))
      for (const id of unread) if (typeof id === "string") this.#unread.add(id)
  }

  get(id: string): ViewerContext | undefined {
    return this.#contexts.get(id)
  }

  #ensure(id: string): ViewerContext {
    let context = this.#contexts.get(id)
    if (!context) {
      context = { sidebarDirectories: [], updatedAt: Date.now() }
      this.#contexts.set(id, context)
    }
    context.updatedAt = Date.now()
    return context
  }

  all() {
    return [...this.#contexts.entries()]
  }

  /** A connecting event stream: remember the requested session and sidebar. */
  connect(
    id: string,
    selectedSession: string | undefined,
    sidebarDirectories: string[]
  ) {
    const context = this.#ensure(id)
    if (selectedSession) {
      this.#setUnread(selectedSession, false)
      context.selectedSession = selectedSession
      delete context.activeDraft
    }
    if (sidebarDirectories.length > 0)
      context.sidebarDirectories = sidebarDirectories
    this.#save()
    return context
  }

  /**
   * An event stream of a context is open. A finished run is not unread while
   * an open tab shows it. Call the returned function when the stream closes.
   */
  attach(id: string) {
    this.#attached.set(id, (this.#attached.get(id) ?? 0) + 1)
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      const count = (this.#attached.get(id) ?? 1) - 1
      if (count > 0) this.#attached.set(id, count)
      else this.#attached.delete(id)
    }
  }

  selectSession(id: string, sessionId: string) {
    const context = this.#ensure(id)
    this.#setUnread(sessionId, false)
    context.selectedSession = sessionId
    delete context.activeDraft
    this.#save()
  }

  selectDraft(id: string, draft: DraftSelection) {
    const context = this.#ensure(id)
    delete context.selectedSession
    context.activeDraft = draft
    this.#save()
  }

  updateDraft(id: string, change: Partial<DraftSelection>) {
    const context = this.#ensure(id)
    if (!context.activeDraft) return
    const next: DraftSelection = { ...context.activeDraft, ...change }
    for (const [key, value] of Object.entries(change))
      if (value === undefined) delete (next as Record<string, unknown>)[key]
    context.activeDraft = next
    this.#save()
  }

  /** True when an open tab shows the session. */
  isOnScreen(sessionId: string) {
    for (const id of this.#attached.keys())
      if (this.#contexts.get(id)?.selectedSession === sessionId) return true
    return false
  }

  /** A finished run is unread, unless an open tab shows it. */
  markDone(sessionId: string) {
    if (this.isOnScreen(sessionId)) return
    this.#setUnread(sessionId, true)
    this.#save()
  }

  /** Mark a session read or unread for all tabs and clients. */
  setRead(sessionId: string, read: boolean) {
    this.#setUnread(sessionId, !read)
    this.#save()
  }

  isUnread(sessionId: string) {
    return this.#unread.has(sessionId)
  }

  unread(): Set<string> {
    return new Set(this.#unread)
  }

  #setUnread(sessionId: string, unread: boolean) {
    if (this.#unread.has(sessionId) === unread) return
    if (unread) this.#unread.add(sessionId)
    else this.#unread.delete(sessionId)
    for (const listener of this.#readListeners) listener(sessionId, unread)
  }

  /** Call `listener` after a change, for example of the unread sessions. */
  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Call `listener` when a session becomes read or unread. */
  onReadChange(listener: ReadListener) {
    this.#readListeners.add(listener)
    return () => {
      this.#readListeners.delete(listener)
    }
  }

  /** Forget a session everywhere, for example after it was archived. */
  forget(sessionId: string) {
    this.#unread.delete(sessionId)
    for (const context of this.#contexts.values())
      if (context.selectedSession === sessionId) delete context.selectedSession
    this.#save()
  }

  #save() {
    for (const listener of this.#listeners) listener()
    if (this.#saveTimer) return
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = undefined
      this.flush()
    }, 250)
    this.#saveTimer.unref()
  }

  flush() {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer)
      this.#saveTimer = undefined
    }
    const entries = [...this.#contexts.entries()]
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_CONTEXTS)
    const stored: StoredViewers = {
      version: 2,
      contexts: Object.fromEntries(entries),
      unread: [...this.#unread],
    }
    try {
      mkdirSync(dirname(this.#file), { recursive: true })
      const temporary = `${this.#file}.tmp`
      writeFileSync(temporary, JSON.stringify(stored, null, 2))
      renameSync(temporary, this.#file)
    } catch (error) {
      console.error("[pico] could not save viewer contexts:", error)
    }
  }
}
