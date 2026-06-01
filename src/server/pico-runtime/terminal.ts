import { randomUUID } from "node:crypto"
import { chmod, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

import type { IDisposable, IPty } from "node-pty"

const TERMINAL_BACKLOG_MAX_CHUNKS = 500
const TERMINAL_BACKLOG_MAX_BYTES = 512 * 1024
const TERMINAL_IDLE_TTL_MS = 30 * 60 * 1000
const TERMINAL_CLEANUP_INTERVAL_MS = 60 * 1000
const TERMINAL_MIN_COLS = 20
const TERMINAL_MAX_COLS = 500
const TERMINAL_MIN_ROWS = 5
const TERMINAL_MAX_ROWS = 200
const TERMINAL_DEFAULT_COLS = 100
const TERMINAL_DEFAULT_ROWS = 30

const require = createRequire(import.meta.url)
let ensureSpawnHelperExecutablePromise: Promise<void> | undefined

export type TerminalServerEvent =
  | {
      type: "ready"
      id: string
      cwd: string
      shell: string
    }
  | {
      type: "output"
      data: string
    }
  | {
      type: "exit"
      exitCode: number
      signal?: number
    }
  | {
      type: "error"
      error: string
    }

export type CreateTerminalOptions = {
  cols?: unknown
  cwd: string
  rows?: unknown
  scopeKey: string
}

type TerminalRecord = {
  id: string
  scopeKey: string
  cwd: string
  shell: string
  pty: IPty
  dataDisposable: IDisposable
  exitDisposable: IDisposable
  subscribers: Set<(event: TerminalServerEvent) => void>
  backlog: Array<TerminalServerEvent>
  backlogBytes: number
  createdAt: number
  lastUsedAt: number
  exited?: {
    exitCode: number
    signal?: number
  }
}

function normalizeDimension(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  const numericValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numericValue)) return fallback

  return Math.min(max, Math.max(min, Math.round(numericValue)))
}

function createTerminalEnv() {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  return env
}

function defaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }

  return process.env.SHELL || "/bin/sh"
}

async function ensureNodePtySpawnHelperExecutable() {
  if (process.platform === "win32") return

  ensureSpawnHelperExecutablePromise ??= (async () => {
    try {
      const entryPath = require.resolve("node-pty")
      const packageRoot = dirname(dirname(entryPath))
      const helperPath = join(
        packageRoot,
        "prebuilds",
        `${process.platform}-${process.arch}`,
        "spawn-helper"
      )
      const helperStat = await stat(helperPath).catch(() => null)
      if (!helperStat) return
      if ((helperStat.mode & 0o111) !== 0) return

      await chmod(helperPath, helperStat.mode | 0o755)
    } catch {
      // node-pty will surface the real spawn failure if the helper is missing.
    }
  })()

  await ensureSpawnHelperExecutablePromise
}

function terminalLabel(shell: string) {
  return basename(shell) || shell
}

function eventSize(event: TerminalServerEvent) {
  if (event.type === "output") return event.data.length
  return JSON.stringify(event).length
}

function formatTerminalError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Unknown terminal error"
}

function sseFrame(event: TerminalServerEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}

function exitPayload(exitCode: number, signal?: number) {
  return typeof signal === "number" ? { exitCode, signal } : { exitCode }
}

function exitEvent(exitCode: number, signal?: number): TerminalServerEvent {
  return {
    type: "exit",
    ...exitPayload(exitCode, signal),
  }
}

export class PicoTerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly encoder = new TextEncoder()
  private readonly cleanupTimer: NodeJS.Timeout

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleTerminals()
    }, TERMINAL_CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }

  async createTerminal({ cols, cwd, rows, scopeKey }: CreateTerminalOptions) {
    await ensureNodePtySpawnHelperExecutable()

    const nodePty = await import("node-pty")
    const shell = defaultShell()
    const pty = nodePty.spawn(shell, [], {
      cols: normalizeDimension(
        cols,
        TERMINAL_DEFAULT_COLS,
        TERMINAL_MIN_COLS,
        TERMINAL_MAX_COLS
      ),
      cwd,
      env: createTerminalEnv(),
      name: "xterm-256color",
      rows: normalizeDimension(
        rows,
        TERMINAL_DEFAULT_ROWS,
        TERMINAL_MIN_ROWS,
        TERMINAL_MAX_ROWS
      ),
    })
    const id = randomUUID()
    const now = Date.now()
    const record: TerminalRecord = {
      id,
      scopeKey,
      cwd,
      shell,
      pty,
      dataDisposable: { dispose: () => {} },
      exitDisposable: { dispose: () => {} },
      subscribers: new Set(),
      backlog: [],
      backlogBytes: 0,
      createdAt: now,
      lastUsedAt: now,
    }

    record.dataDisposable = pty.onData((data) => {
      this.publish(record, { type: "output", data })
    })
    record.exitDisposable = pty.onExit((event) => {
      record.exited = exitPayload(event.exitCode, event.signal)
      this.publish(record, exitEvent(event.exitCode, event.signal))
    })

    this.terminals.set(id, record)

    return {
      id,
      cwd,
      shell: terminalLabel(shell),
      reused: false,
    }
  }

  createEventsResponse(id: string, scopeKey: string, signal: AbortSignal) {
    const record = this.assertTerminalScope(id, scopeKey)
    record.lastUsedAt = Date.now()

    let cleanupStream = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false
        const send = (event: TerminalServerEvent) => {
          if (closed) return

          try {
            controller.enqueue(this.encoder.encode(sseFrame(event)))
          } catch {
            cleanup()
          }
        }
        const cleanup = () => {
          if (closed) return
          closed = true
          record.subscribers.delete(send)
          signal.removeEventListener("abort", cleanup)
          try {
            controller.close()
          } catch {
            // Ignore already closed streams.
          }
        }

        cleanupStream = cleanup
        record.subscribers.add(send)
        signal.addEventListener("abort", cleanup, { once: true })
        send({
          type: "ready",
          id: record.id,
          cwd: record.cwd,
          shell: terminalLabel(record.shell),
        })
        for (const event of record.backlog) {
          send(event)
        }
        if (record.exited) {
          send(exitEvent(record.exited.exitCode, record.exited.signal))
        }
      },
      cancel: () => {
        cleanupStream()
      },
    })

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    })
  }

  writeTerminal(id: string, scopeKey: string, data: unknown) {
    const record = this.assertTerminalScope(id, scopeKey)
    if (record.exited) {
      throw new Error("Terminal has exited.")
    }
    if (typeof data !== "string") {
      throw new Error("Terminal input data is required.")
    }

    record.lastUsedAt = Date.now()
    record.pty.write(data)
  }

  resizeTerminal(
    id: string,
    scopeKey: string,
    dimensions: { cols?: unknown; rows?: unknown }
  ) {
    const record = this.assertTerminalScope(id, scopeKey)
    if (record.exited) return

    const cols = normalizeDimension(
      dimensions.cols,
      record.pty.cols,
      TERMINAL_MIN_COLS,
      TERMINAL_MAX_COLS
    )
    const rows = normalizeDimension(
      dimensions.rows,
      record.pty.rows,
      TERMINAL_MIN_ROWS,
      TERMINAL_MAX_ROWS
    )

    record.lastUsedAt = Date.now()
    record.pty.resize(cols, rows)
  }

  closeTerminal(id: string, scopeKey: string) {
    this.assertTerminalScope(id, scopeKey)
    this.deleteTerminal(id)
  }

  dispose() {
    clearInterval(this.cleanupTimer)
    for (const id of this.terminals.keys()) {
      this.deleteTerminal(id)
    }
  }

  private assertTerminalScope(id: string, scopeKey: string) {
    const record = this.terminals.get(id)
    if (!record) {
      throw new Error("Terminal not found.")
    }
    if (record.scopeKey !== scopeKey) {
      throw new Error("Terminal not found for this session.")
    }

    return record
  }

  private publish(record: TerminalRecord, event: TerminalServerEvent) {
    record.lastUsedAt = Date.now()
    this.rememberBacklog(record, event)

    for (const subscriber of record.subscribers) {
      try {
        subscriber(event)
      } catch {
        record.subscribers.delete(subscriber)
      }
    }
  }

  private rememberBacklog(record: TerminalRecord, event: TerminalServerEvent) {
    if (event.type !== "output") return

    record.backlog.push(event)
    record.backlogBytes += eventSize(event)

    while (
      record.backlog.length > TERMINAL_BACKLOG_MAX_CHUNKS ||
      record.backlogBytes > TERMINAL_BACKLOG_MAX_BYTES
    ) {
      const removed = record.backlog.shift()
      if (!removed) break
      record.backlogBytes = Math.max(
        0,
        record.backlogBytes - eventSize(removed)
      )
    }
  }

  private deleteTerminal(id: string) {
    const record = this.terminals.get(id)
    if (!record) return

    this.terminals.delete(id)

    record.subscribers.clear()
    try {
      record.dataDisposable.dispose()
    } catch {
      // Ignore dispose failures.
    }
    try {
      record.exitDisposable.dispose()
    } catch {
      // Ignore dispose failures.
    }
    try {
      record.pty.kill()
    } catch (error) {
      const message = formatTerminalError(error)
      if (!record.exited) {
        this.rememberBacklog(record, { type: "error", error: message })
      }
    }
  }

  private cleanupIdleTerminals() {
    const now = Date.now()
    for (const record of this.terminals.values()) {
      if (record.subscribers.size > 0) continue
      if (now - record.lastUsedAt < TERMINAL_IDLE_TTL_MS) continue
      this.deleteTerminal(record.id)
    }
  }
}
