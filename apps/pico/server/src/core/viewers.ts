/**
 * Viewer contexts: one per browser tab or window. A context selects an agent
 * or a draft (a new agent that has no prompt yet) and keeps its sidebar
 * projects. Contexts are saved, so a reload returns to the same place.
 *
 * Read state is global: an agent read in one tab or client is read in all of
 * them. Agents can also change it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type DraftSelection = {
  agentKey: string
  cwd: string
  /** Model and thinking chosen before the first prompt. */
  model?: { provider: string; modelId: string }
  thinkingLevel?: string
  /** Make a git worktree for the agent when the first prompt creates it. */
  worktree?: { branch?: string; base?: string }
  /** The tool profile of the agent that the first prompt creates. */
  profile?: string
}

export type ViewerContext = {
  selectedAgent?: string
  activeDraft?: DraftSelection
  sidebarProjects: string[]
  updatedAt: number
}

/**
 * A context in the viewers file. Stored names: do not change. They are the
 * names from before the rename of agents to agents.
 */
type StoredDraft = Omit<DraftSelection, "agentKey"> & { sessionKey?: string }

type StoredContext = {
  selectedSession?: string
  activeDraft?: StoredDraft
  sidebarDirectories?: unknown
  updatedAt?: unknown
  unread?: unknown
}

type StoredViewers = {
  version: 2
  contexts: Record<string, StoredContext>
  unread: string[]
}

function draftFromStored(draft: StoredDraft | undefined) {
  if (!draft || typeof draft !== "object") return undefined
  const { sessionKey, ...rest } = draft
  return typeof sessionKey === "string"
    ? ({ ...rest, agentKey: sessionKey } as DraftSelection)
    : undefined
}

function storedDraft(draft: DraftSelection): StoredDraft {
  const { agentKey, ...rest } = draft
  return { ...rest, sessionKey: agentKey }
}

function storedContext(context: ViewerContext): StoredContext {
  return {
    ...(context.selectedAgent
      ? { selectedSession: context.selectedAgent }
      : {}),
    ...(context.activeDraft
      ? { activeDraft: storedDraft(context.activeDraft) }
      : {}),
    sidebarDirectories: context.sidebarProjects,
    updatedAt: context.updatedAt,
  }
}

/** An agent became read or unread. */
export type ReadListener = (agentId: string, unread: boolean) => void

const MAX_CONTEXTS = 200

export class Viewers {
  readonly #file: string
  readonly #contexts = new Map<string, ViewerContext>()
  /** The agents with a finished turn that nobody has read. */
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
      const draft = draftFromStored(context.activeDraft)
      this.#contexts.set(id, {
        ...(typeof context.selectedSession === "string"
          ? { selectedAgent: context.selectedSession }
          : {}),
        ...(draft ? { activeDraft: draft } : {}),
        sidebarProjects: Array.isArray(context.sidebarDirectories)
          ? (context.sidebarDirectories as string[])
          : [],
        updatedAt:
          typeof context.updatedAt === "number" ? context.updatedAt : 0,
      })
    }
    const unread = current
      ? (stored as StoredViewers).unread
      : // Before version 2, each context had its own unread agents. Keep
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
      context = { sidebarProjects: [], updatedAt: Date.now() }
      this.#contexts.set(id, context)
    }
    context.updatedAt = Date.now()
    return context
  }

  all() {
    return [...this.#contexts.entries()]
  }

  /** A connecting event stream: remember the requested agent and sidebar. */
  connect(
    id: string,
    selectedAgent: string | undefined,
    sidebarProjects: string[]
  ) {
    const context = this.#ensure(id)
    if (selectedAgent) {
      this.#setUnread(selectedAgent, false)
      context.selectedAgent = selectedAgent
      delete context.activeDraft
    }
    if (sidebarProjects.length > 0) context.sidebarProjects = sidebarProjects
    this.#save()
    return context
  }

  /**
   * An event stream of a context is open. A finished turn is not unread while
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

  selectAgent(id: string, agentId: string) {
    const context = this.#ensure(id)
    this.#setUnread(agentId, false)
    context.selectedAgent = agentId
    delete context.activeDraft
    this.#save()
  }

  selectDraft(id: string, draft: DraftSelection) {
    const context = this.#ensure(id)
    delete context.selectedAgent
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

  /** True when an open tab shows the agent. */
  isOnScreen(agentId: string) {
    for (const id of this.#attached.keys())
      if (this.#contexts.get(id)?.selectedAgent === agentId) return true
    return false
  }

  /** A finished turn is unread, unless an open tab shows it. */
  markDone(agentId: string) {
    if (this.isOnScreen(agentId)) return
    this.#setUnread(agentId, true)
    this.#save()
  }

  /** Mark an agent read or unread for all tabs and clients. */
  setRead(agentId: string, read: boolean) {
    this.#setUnread(agentId, !read)
    this.#save()
  }

  isUnread(agentId: string) {
    return this.#unread.has(agentId)
  }

  unread(): Set<string> {
    return new Set(this.#unread)
  }

  #setUnread(agentId: string, unread: boolean) {
    if (this.#unread.has(agentId) === unread) return
    if (unread) this.#unread.add(agentId)
    else this.#unread.delete(agentId)
    for (const listener of this.#readListeners) listener(agentId, unread)
  }

  /** Call `listener` after a change, for example of the unread agents. */
  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Call `listener` when an agent becomes read or unread. */
  onReadChange(listener: ReadListener) {
    this.#readListeners.add(listener)
    return () => {
      this.#readListeners.delete(listener)
    }
  }

  /** Forget an agent everywhere, for example after it was archived. */
  forget(agentId: string) {
    this.#unread.delete(agentId)
    for (const context of this.#contexts.values())
      if (context.selectedAgent === agentId) delete context.selectedAgent
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
      contexts: Object.fromEntries(
        entries.map(([id, context]) => [id, storedContext(context)])
      ),
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
