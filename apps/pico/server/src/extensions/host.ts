/**
 * The host bridge: Pico services that extensions use.
 *
 * The runtime and its extensions open before the services that need the
 * runtime (sessions, terminals, the event hub). Extensions get this bridge at
 * creation and wait for `bind()` when they first need a service. A tool that
 * restart recovery runs early waits here until the server is ready.
 */
import type { ConversationId, Harness } from "@earendil-works/pi-durable"

import type { ToolLimits } from "../core/profiles.ts"
import type { PicoSettingsData } from "../core/settings.ts"
import type { MachineManager } from "../machines/manager.ts"
import type { BrowserManager } from "../services/browser.ts"
import type { Notifier } from "../services/notify.ts"
import type { PreviewProxies } from "../services/preview.ts"
import type { Terminals } from "../services/terminal.ts"

/** Session operations that extensions use. `Sessions` implements it. */
export type HostSessions = {
  has(id: string | undefined): id is string
  /** The visible session for an ID, after tree navigation replacements. */
  current(id: string | undefined): string | undefined
  meta(id: string): HostSessionMeta
  isBusy(id: string): boolean
  create(cwd: string, options?: HostCreateOptions): Promise<string>
  prompt(
    id: string,
    input: {
      message: string
      images: Array<{ mimeType?: string; data?: string }>
      streamingBehavior?: "steer" | "followUp"
      requestId?: string
    }
  ): Promise<{ queued: boolean }>
  abort(id: string): Promise<void>
  /**
   * Put a message in the follow-up queue of a session, after the queued
   * prompts of the user. It never steers: the agent gets it when its run
   * answers, and an idle session starts a run. A paused queue keeps it.
   */
  followUp(id: string, message: string, requestId: string): Promise<void>
  /** Give tools to a session or take them away, and apply its profile again. */
  changeLimits(
    id: string,
    change: { add?: string[]; remove?: string[] }
  ): Promise<ToolLimits>
  /** Children that `spawn_session` made for a session. */
  children(id: string): string[]
  /** Sessions for tools, newest activity first. */
  list(filter: { parent?: string; directory?: string }): HostSessionSummary[]
  rename(id: string, name: string): string
  /** Mark a session read or unread for every client. */
  setRead(id: string, read: boolean): void
  /** Hide a session. It stays on disk and `restore` shows it again. */
  archive(id: string): void
  restore(id: string): void
  /** Archived sessions, most recently archived first. */
  archivedSessions(): Array<{
    id: string
    title: string
    cwd: string
    archivedAt?: string
  }>
  availableModels(): Array<{ id: string; provider?: string }>
  publishStateIfWatched(id: string): Promise<void>
  /** Tell clients that a session's extension state changed. */
  extensionStateChanged(id: string, kind: string): void
}

export type HostSessionMeta = {
  cwd: string
  name?: string
  parent?: string
  spawnedByCall?: string
  depth?: number
  profile?: string
  limits?: ToolLimits
  group?: string
  worktree?: { repoRoot: string; path: string; branch: string }
  archived?: boolean
  firstMessage: string
  lastMessagePreview?: string
  messageCount: number
}

export type HostSessionSummary = {
  id: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  /** Nobody has read the last run yet. */
  unread: boolean
  parent?: string
  worktreeBranch?: string
  messageCount: number
  lastMessagePreview?: string
  lastMessageAt?: number
}

export type HostCreateOptions = {
  model?: { provider: string; modelId: string }
  thinkingLevel?: string
  parent?: string
  spawnedByCall?: string
  profile?: string
  /** Tool limits of a child session: added and removed tools, denied commands. */
  limits?: ToolLimits
  name?: string
  /** Show the session under this directory in the sidebar. */
  group?: string
  worktree?: { repoRoot: string; path: string; branch: string }
}

export type HostEvents = {
  push(
    payload: { type: string; [key: string]: unknown },
    target?: { contextId?: string; sessionId?: string }
  ): unknown
}

export type HostTerminals = Pick<
  Terminals,
  | "spawnJob"
  | "releaseJobOutput"
  | "jobRunning"
  | "stopJob"
  | "jobTerminalId"
  | "readText"
  | "writeForAgent"
  | "device"
  | "sessionShells"
>

export type HostServices = {
  sessions: HostSessions
  events: HostEvents
  terminals: HostTerminals
  harness: Harness
  settings: () => Readonly<PicoSettingsData>
  dataDir: string
  previews?: PreviewProxies
  notifier?: Notifier
  browser?: BrowserManager
  /** The remote machines of a hub, for the session tools. */
  machines?: Pick<MachineManager, "find" | "list">
}

export class HostBridge {
  /**
   * The server is shutting down. Processes it stops are not finished work:
   * a job killed now is reported as lost after the restart.
   */
  stopping = false
  #services: HostServices | undefined
  #waiters: Array<(services: HostServices) => void> = []
  #onReady: Array<(services: HostServices) => void | Promise<void>> = []

  bind(services: HostServices) {
    this.#services = services
    for (const waiter of this.#waiters.splice(0)) waiter(services)
  }

  /** Run startup work once the server is ready, for example after sessions load. */
  onReady(listener: (services: HostServices) => void | Promise<void>) {
    this.#onReady.push(listener)
  }

  /** Called by the server after sessions load. */
  async started() {
    const services = this.#services
    if (!services) return
    for (const listener of this.#onReady) {
      try {
        await listener(services)
      } catch (error) {
        console.warn("[pico] extension startup failed:", error)
      }
    }
  }

  /** The services, when the server is ready. */
  get current(): HostServices | undefined {
    return this.#services
  }

  ready(signal?: AbortSignal): Promise<HostServices> {
    if (this.#services) return Promise.resolve(this.#services)
    return new Promise((resolve, reject) => {
      const waiter = (services: HostServices) => {
        signal?.removeEventListener("abort", abort)
        resolve(services)
      }
      const abort = () => {
        this.#waiters = this.#waiters.filter((entry) => entry !== waiter)
        reject(signal?.reason ?? new Error("Aborted"))
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.#waiters.push(waiter)
    })
  }
}

/** Public session IDs are `s<conversation id>`; see `sessions.ts`. */
export function sessionIdOf(conversationId: ConversationId) {
  return `s${conversationId}`
}

export function conversationOf(sessionId: string): ConversationId {
  return Number(
    sessionId.startsWith("s") ? sessionId.slice(1) : sessionId
  ) as unknown as ConversationId
}
