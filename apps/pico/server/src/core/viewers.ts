/**
 * Viewer contexts: one per browser tab or window. A context selects a session
 * or a draft (a new session that has no prompt yet), keeps its sidebar
 * directories, and tracks which sessions it has not read. Contexts are saved,
 * so a reload returns to the same place.
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
  unread: string[]
  updatedAt: number
}

const MAX_CONTEXTS = 200

export class Viewers {
  readonly #file: string
  readonly #contexts = new Map<string, ViewerContext>()
  #saveTimer: NodeJS.Timeout | undefined

  constructor(file: string) {
    this.#file = file
    try {
      const stored = JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        ViewerContext
      >
      for (const [id, context] of Object.entries(stored)) {
        this.#contexts.set(id, {
          ...(context.selectedSession
            ? { selectedSession: context.selectedSession }
            : {}),
          ...(context.activeDraft ? { activeDraft: context.activeDraft } : {}),
          sidebarDirectories: Array.isArray(context.sidebarDirectories)
            ? context.sidebarDirectories
            : [],
          unread: Array.isArray(context.unread) ? context.unread : [],
          updatedAt:
            typeof context.updatedAt === "number" ? context.updatedAt : 0,
        })
      }
    } catch {
      // No saved contexts yet.
    }
  }

  get(id: string): ViewerContext | undefined {
    return this.#contexts.get(id)
  }

  #ensure(id: string): ViewerContext {
    let context = this.#contexts.get(id)
    if (!context) {
      context = { sidebarDirectories: [], unread: [], updatedAt: Date.now() }
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
      context.unread = context.unread.filter(
        (sessionId) => sessionId !== selectedSession
      )
      context.selectedSession = selectedSession
      delete context.activeDraft
    }
    if (sidebarDirectories.length > 0)
      context.sidebarDirectories = sidebarDirectories
    this.#save()
    return context
  }

  selectSession(id: string, sessionId: string) {
    const context = this.#ensure(id)
    context.unread = context.unread.filter((unread) => unread !== sessionId)
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

  /** A finished run is unread everywhere it is not on screen. */
  markDone(sessionId: string) {
    for (const context of this.#contexts.values()) {
      if (context.selectedSession === sessionId) continue
      if (!context.unread.includes(sessionId)) context.unread.push(sessionId)
    }
    this.#save()
  }

  setRead(id: string, sessionId: string, read: boolean) {
    const context = this.#ensure(id)
    context.unread = context.unread.filter((unread) => unread !== sessionId)
    if (!read) context.unread.push(sessionId)
    this.#save()
  }

  unread(id: string | undefined): Set<string> {
    return new Set(id ? (this.#contexts.get(id)?.unread ?? []) : [])
  }

  /** Forget a session everywhere, for example after it was deleted. */
  forget(sessionId: string) {
    for (const context of this.#contexts.values()) {
      context.unread = context.unread.filter((unread) => unread !== sessionId)
      if (context.selectedSession === sessionId) delete context.selectedSession
    }
    this.#save()
  }

  #save() {
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
    try {
      mkdirSync(dirname(this.#file), { recursive: true })
      const temporary = `${this.#file}.tmp`
      writeFileSync(
        temporary,
        JSON.stringify(Object.fromEntries(entries), null, 2)
      )
      renameSync(temporary, this.#file)
    } catch (error) {
      console.error("[pico] could not save viewer contexts:", error)
    }
  }
}
