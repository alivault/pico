/**
 * Where pseudo-terminals run: in the server process (`LocalPtyBackend`, for
 * tests and `--no-pty-host`), or in the pty-host process (`HostPtyBackend`),
 * so they survive a server restart. `Terminals` uses either one.
 */
import * as pty from "@lydell/node-pty"

import { PtyHostClient } from "../pty-host/client.ts"
import type {
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
  /** Attach: the output the host keeps, and later events through `sink`. */
  attach(sink: PtySink): Promise<{ chunks: OutputChunk[]; gap: boolean }>
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

export class HostPtyBackend implements PtyBackend {
  readonly kind = "host" as const
  readonly #client: PtyHostClient
  readonly #sinks = new Map<string, PtySink>()
  #closed = false

  constructor(options: { dataDir: string; script: string; version: string }) {
    this.#client = new PtyHostClient({
      ...options,
      onEvent: (event) => {
        const sink = this.#sinks.get(event.ptyId)
        if (!sink) return
        if (event.type === "output") sink.output(event.data, event.seq)
        else {
          this.#sinks.delete(event.ptyId)
          sink.exit(event.exit)
        }
      },
      onClose: () => this.#lost(),
    })
  }

  /** The host went away: its ptys are gone, and their ends are unknown. */
  #lost() {
    if (this.#closed) return
    console.warn(
      "[pico] the pty-host connection closed: its terminals are lost"
    )
    const sinks = [...this.#sinks.values()]
    this.#sinks.clear()
    for (const sink of sinks) sink.exit({ exitCode: -1, lost: true })
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
        this.#sinks.delete(ptyId)
        if (this.#client.connected) this.#client.send({ type: "forget", ptyId })
      },
    }
  }

  async spawn(request: SpawnRequest, sink: PtySink) {
    await this.#client.connect()
    const info = await this.#client.request<PtyInfo>({
      type: "spawn",
      spawn: request,
    })
    this.#sinks.set(info.ptyId, sink)
    return this.#handle(info)
  }

  async recover(): Promise<RecoveredPty[]> {
    await this.#client.connect()
    const list = await this.#client.request<PtyInfo[]>({ type: "list" })
    return list.map((info) => ({
      info,
      handle: this.#handle(info),
      attach: async (sink) => {
        if (info.journal) return { chunks: [], gap: false }
        this.#sinks.set(info.ptyId, sink)
        const attached = await this.#client.request<{
          info: PtyInfo
          gap: boolean
          chunks: OutputChunk[]
        }>({ type: "attach", ptyId: info.ptyId, fromSeq: 0 })
        // It may have exited between the list and the attach.
        if (attached.info.exited) {
          this.#sinks.delete(info.ptyId)
          info.exited = attached.info.exited
        }
        return { chunks: attached.chunks, gap: attached.gap }
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
