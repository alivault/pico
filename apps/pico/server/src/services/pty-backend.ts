/**
 * Where pseudo-terminals run: in the server process (`LocalPtyBackend`, for
 * tests and `--no-pty-host`), or in the pty-host process (`HostPtyBackend`),
 * so they survive a server restart. `Terminals` uses either one.
 */
import * as pty from "@lydell/node-pty"

import { PtyHostClient } from "../pty-host/client.ts"
import type {
  HostEvent,
  OutputChunk,
  PtyExit,
  PtyInfo,
  SpawnRequest,
} from "../pty-host/protocol.ts"
import { JobLogWriter } from "./job-log.ts"

export type PtyEnd = PtyExit & {
  /** The pty-host went away: the process is gone, its exit is unknown. */
  lost?: boolean
}

export type PtySink = {
  output(data: string, seq?: number): void
  exit(exit: PtyEnd): void
}

export type PtyHandle = {
  readonly pid: number
  readonly device?: string
  write(data: string, viewer?: string, inputSeq?: number): void
  resize(cols: number, rows: number): void
  /** Send a signal, to the whole process group with `group`. */
  kill(signal?: string, group?: boolean): void
  /** The server has what it needs: drop the pty and its exit record. */
  forget(): void
}

/** A pty that a pty-host kept while the server was down. */
export type RecoveredPty = {
  info: PtyInfo
  /**
   * Attach: the output the host keeps goes to `sink` (with its sequence
   * numbers), then the later events.
   */
  attach(sink: PtySink): Promise<{ gap: boolean }>
  handle: PtyHandle
}

export interface PtyBackend {
  readonly kind: "local" | "host"
  spawn(request: SpawnRequest, sink: PtySink): Promise<PtyHandle>
  /** The ptys that run (or ended) without a server. */
  recover(): Promise<RecoveredPty[]>
  stats(): Promise<{ pid: number; rss: number } | undefined>
  /** Stop using the backend: a local one ends its ptys, a host keeps them. */
  close(): void
}

function killGroup(pid: number, signal: string) {
  process.kill(-pid, signal as NodeJS.Signals)
}

export class LocalPtyBackend implements PtyBackend {
  readonly kind = "local" as const
  readonly #dataDir: string | undefined
  readonly #handles = new Set<pty.IPty>()

  constructor(dataDir?: string) {
    this.#dataDir = dataDir
  }

  async spawn(request: SpawnRequest, sink: PtySink): Promise<PtyHandle> {
    const child = pty.spawn(request.file, request.args, {
      name: "xterm-256color",
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: request.env,
    })
    this.#handles.add(child)
    const log =
      request.logJobId && this.#dataDir
        ? new JobLogWriter(this.#dataDir, request.logJobId)
        : undefined
    child.onData((data) => {
      log?.write(data)
      sink.output(data)
    })
    child.onExit(({ exitCode, signal }) => {
      this.#handles.delete(child)
      log?.end()
      sink.exit({ exitCode, ...(signal ? { signal } : {}) })
    })
    const device = (child as { ptsName?: unknown }).ptsName
    return {
      pid: child.pid,
      ...(typeof device === "string" && device ? { device } : {}),
      write: (data) => child.write(data),
      resize: (cols, rows) => child.resize(cols, rows),
      kill: (signal, group) => {
        if (group && process.platform !== "win32")
          killGroup(child.pid, signal ?? "SIGHUP")
        else child.kill(signal)
      },
      forget: () => undefined,
    }
  }

  async recover() {
    return []
  }

  async stats() {
    return undefined
  }

  close() {
    for (const child of this.#handles)
      try {
        child.kill()
      } catch {
        // Gone.
      }
    this.#handles.clear()
  }
}

type Entry = {
  sink: PtySink
  /** The last output sequence that the sink got. */
  lastSeq: number
  /** Events that wait while the backlog of an attach is on its way. */
  held?: HostEvent[]
}

/** How long events for a pty that no sink knows yet wait for it. */
const ORPHAN_MS = 30_000

export class HostPtyBackend implements PtyBackend {
  readonly kind = "host" as const
  readonly #client: PtyHostClient
  readonly #entries = new Map<string, Entry>()
  /**
   * Events for ptys without a sink yet: the output and exit lines of a new
   * pty can come in the same chunk as the spawn reply, before `spawn` sets
   * its sink.
   */
  readonly #orphans = new Map<string, { events: HostEvent[]; at: number }>()
  /** Forgets that wait for the connection to come back. */
  readonly #pendingForgets = new Set<string>()
  #closed = false

  constructor(options: { dataDir: string; script: string; version: string }) {
    this.#client = new PtyHostClient({
      ...options,
      onEvent: (event) => this.#event(event),
      onClose: () => void this.#reconnect(),
    })
  }

  #event(event: HostEvent) {
    const entry = this.#entries.get(event.ptyId)
    if (!entry) {
      const now = Date.now()
      for (const [id, orphan] of this.#orphans)
        if (now - orphan.at > ORPHAN_MS) this.#orphans.delete(id)
      const orphan = this.#orphans.get(event.ptyId) ?? { events: [], at: now }
      if (orphan.events.length < 1000) orphan.events.push(event)
      this.#orphans.set(event.ptyId, orphan)
      return
    }
    if (entry.held) entry.held.push(event)
    else this.#deliver(event.ptyId, entry, event)
  }

  #deliver(ptyId: string, entry: Entry, event: HostEvent) {
    if (event.type === "output") {
      if (event.seq <= entry.lastSeq) return
      entry.lastSeq = event.seq
      entry.sink.output(event.data, event.seq)
      return
    }
    this.#entries.delete(ptyId)
    entry.sink.exit(event.exit)
  }

  /** Give a pty its sink, with the events that came before it. */
  #register(ptyId: string, sink: PtySink) {
    const entry: Entry = { sink, lastSeq: 0 }
    this.#entries.set(ptyId, entry)
    const orphan = this.#orphans.get(ptyId)
    this.#orphans.delete(ptyId)
    for (const event of orphan?.events ?? []) this.#deliver(ptyId, entry, event)
  }

  /**
   * Attach to a pty: its backlog first, then the live events that came in
   * the meantime, without the ones the backlog has.
   */
  async #attach(ptyId: string, entry: Entry) {
    entry.held = []
    this.#entries.set(ptyId, entry)
    this.#orphans.delete(ptyId)
    let attached: { info: PtyInfo; gap: boolean; chunks: OutputChunk[] }
    try {
      attached = await this.#client.request({
        type: "attach",
        ptyId,
        fromSeq: entry.lastSeq,
      })
    } catch (error) {
      this.#entries.delete(ptyId)
      throw error
    }
    for (const chunk of attached.chunks)
      this.#deliver(ptyId, entry, { type: "output", ptyId, ...chunk })
    const held = entry.held
    delete entry.held
    for (const event of held) {
      if (!this.#entries.has(ptyId)) break
      this.#deliver(ptyId, entry, event)
    }
    return attached
  }

  /**
   * The connection closed. When the same host answers again, attach again
   * and go on; when the host is gone, its ptys are gone too.
   */
  async #reconnect() {
    if (this.#closed) return
    const before = this.#client.hostPid
    try {
      await this.#client.connect()
    } catch {
      this.#lostAll()
      return
    }
    if (this.#client.hostPid !== before) {
      this.#lostAll()
      return
    }
    for (const ptyId of this.#pendingForgets)
      this.#client.send({ type: "forget", ptyId })
    this.#pendingForgets.clear()
    for (const [ptyId, entry] of this.#entries) {
      try {
        const attached = await this.#attach(ptyId, entry)
        if (attached.info.exited && this.#entries.get(ptyId) === entry) {
          this.#entries.delete(ptyId)
          entry.sink.exit(attached.info.exited)
        }
      } catch {
        this.#entries.delete(ptyId)
        entry.sink.exit({ exitCode: -1, lost: true })
      }
    }
  }

  /** The host went away: its ptys are gone, and their ends are unknown. */
  #lostAll() {
    if (this.#closed) return
    console.warn("[pico] the pty-host went away: its terminals are lost")
    const entries = [...this.#entries.values()]
    this.#entries.clear()
    this.#orphans.clear()
    this.#pendingForgets.clear()
    for (const entry of entries) entry.sink.exit({ exitCode: -1, lost: true })
  }

  #handle(info: PtyInfo): PtyHandle {
    const ptyId = info.ptyId
    return {
      pid: info.pid,
      ...(info.device ? { device: info.device } : {}),
      write: (data, viewer, inputSeq) =>
        this.#client.send({
          type: "write",
          ptyId,
          data,
          ...(viewer !== undefined ? { viewer } : {}),
          ...(inputSeq !== undefined ? { inputSeq } : {}),
        }),
      resize: (cols, rows) =>
        this.#client.send({ type: "resize", ptyId, cols, rows }),
      kill: (signal, group) =>
        this.#client.send({
          type: "signal",
          ptyId,
          signal: signal ?? "SIGHUP",
          ...(group ? { group } : {}),
        }),
      forget: () => {
        this.#entries.delete(ptyId)
        this.#orphans.delete(ptyId)
        if (this.#client.connected) this.#client.send({ type: "forget", ptyId })
        else if (!this.#closed) this.#pendingForgets.add(ptyId)
      },
    }
  }

  async spawn(request: SpawnRequest, sink: PtySink) {
    await this.#client.connect()
    const info = await this.#client.request<PtyInfo>({
      type: "spawn",
      spawn: request,
    })
    this.#register(info.ptyId, sink)
    return this.#handle(info)
  }

  async recover(): Promise<RecoveredPty[]> {
    await this.#client.connect()
    const list = await this.#client.request<PtyInfo[]>({ type: "list" })
    return list.map((info) => ({
      info,
      handle: this.#handle(info),
      attach: async (sink) => {
        if (info.journal) return { gap: false }
        const entry: Entry = { sink, lastSeq: 0 }
        const attached = await this.#attach(info.ptyId, entry)
        // It may have exited between the list and the attach.
        if (attached.info.exited) {
          this.#entries.delete(info.ptyId)
          info.exited = attached.info.exited
        }
        return { gap: attached.gap }
      },
    }))
  }

  async stats() {
    if (!this.#client.connected) return undefined
    return this.#client
      .request<{ pid: number; rss: number }>({ type: "stats" })
      .catch(() => undefined)
  }

  close() {
    this.#closed = true
    this.#client.close()
  }
}
