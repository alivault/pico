import { randomUUID } from "node:crypto"
import { chmod, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

import type { IDisposable, IPty } from "node-pty"

const TERMINAL_BACKLOG_MAX_CHUNKS = 500
const TERMINAL_BACKLOG_MAX_BYTES = 512 * 1024
const TERMINAL_EXITED_TTL_MS = 30 * 60 * 1000
const TERMINAL_CLEANUP_INTERVAL_MS = 60 * 1000
const TERMINAL_MIN_COLS = 20
const TERMINAL_MAX_COLS = 500
const TERMINAL_MIN_ROWS = 5
const TERMINAL_MAX_ROWS = 200
const TERMINAL_DEFAULT_COLS = 100
const TERMINAL_DEFAULT_ROWS = 30
const TERMINAL_KEY_MAX_LENGTH = 256

const require = createRequire(import.meta.url)
let ensureSpawnHelperExecutablePromise: Promise<void> | undefined

export type TerminalBackend = "shell"

export type TerminalServerEvent =
  | {
      type: "ready"
      backend: TerminalBackend
      id: string
      cwd: string
      shell: string
    }
  | {
      type: "output"
      data: string
      seq: number
    }
  | {
      type: "reset"
      reason: "backlog_gap"
      firstSeq: number
      nextSeq: number
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
  clientKey?: unknown
  cols?: unknown
  cwd: string
  rows?: unknown
  scopeKey: string
}

type TerminalSpawnConfig = {
  args: Array<string>
  backend: TerminalBackend
  command: string
  shellLabel: string
}

type TerminalRecord = {
  id: string
  args: Array<string>
  backend: TerminalBackend
  command: string
  scopeKey: string
  cwd: string
  shell: string
  pty: IPty
  dataDisposable: IDisposable
  exitDisposable: IDisposable
  subscribers: Set<(event: TerminalServerEvent) => void>
  backlog: Array<Extract<TerminalServerEvent, { type: "output" }>>
  backlogBytes: number
  nextOutputSeq: number
  lastInputSeq: number
  createdAt: number
  lastUsedAt: number
  lookupKey?: string
  terminalKey?: string
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

  // The Pico server itself might be launched from a terminal multiplexer. A
  // browser terminal is a fresh PTY, so do not let inherited multiplexer state
  // leak into child shells.
  delete env.ZELLIJ
  delete env.ZELLIJ_SESSION_NAME
  delete env.TMUX
  delete env.TMUX_PANE

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
  const idLine = event.type === "output" ? `id: ${event.seq}\n` : ""
  return `${idLine}data: ${JSON.stringify(event)}\n\n`
}

function exitPayload(exitCode: number, signal?: number) {
  return typeof signal === "number" && signal > 0
    ? { exitCode, signal }
    : { exitCode }
}

function exitEvent(exitCode: number, signal?: number): TerminalServerEvent {
  return {
    type: "exit",
    ...exitPayload(exitCode, signal),
  }
}

function normalizeTerminalKey(value: unknown) {
  if (typeof value !== "string") return undefined

  const normalized = value.trim()
  if (!normalized) return undefined

  return normalized.slice(0, TERMINAL_KEY_MAX_LENGTH)
}

function terminalLookupKey(scopeKey: string, terminalKey: string) {
  return `${scopeKey}\0${terminalKey}`
}

export class PicoTerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly terminalKeys = new Map<string, string>()
  private readonly encoder = new TextEncoder()
  private readonly cleanupTimer: NodeJS.Timeout

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExitedTerminals()
    }, TERMINAL_CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }

  async createTerminal({
    clientKey,
    cols,
    cwd,
    rows,
    scopeKey,
  }: CreateTerminalOptions) {
    await ensureNodePtySpawnHelperExecutable()

    const terminalKey = normalizeTerminalKey(clientKey)
    const lookupKey = terminalKey
      ? terminalLookupKey(scopeKey, terminalKey)
      : undefined
    const existingId = lookupKey ? this.terminalKeys.get(lookupKey) : undefined
    const existingRecord = existingId
      ? this.terminals.get(existingId)
      : undefined

    if (existingRecord && !existingRecord.exited) {
      existingRecord.lastUsedAt = Date.now()
      return {
        id: existingRecord.id,
        backend: existingRecord.backend,
        cwd: existingRecord.cwd,
        shell: terminalLabel(existingRecord.shell),
        reused: true,
      }
    }

    if (existingRecord) {
      await this.disposeTerminalRecord(existingRecord.id)
    }

    const spawnConfig = this.createSpawnConfig()
    const pty = await this.spawnPty(spawnConfig, cwd, cols, rows)
    const id = randomUUID()
    const now = Date.now()
    const record: TerminalRecord = {
      id,
      args: spawnConfig.args,
      backend: spawnConfig.backend,
      command: spawnConfig.command,
      scopeKey,
      cwd,
      shell: spawnConfig.shellLabel,
      pty,
      dataDisposable: { dispose: () => {} },
      exitDisposable: { dispose: () => {} },
      subscribers: new Set(),
      backlog: [],
      backlogBytes: 0,
      nextOutputSeq: 1,
      lastInputSeq: 0,
      createdAt: now,
      lastUsedAt: now,
    }

    if (lookupKey) record.lookupKey = lookupKey
    if (terminalKey) record.terminalKey = terminalKey

    this.attachPtyHandlers(record)

    this.terminals.set(id, record)
    if (lookupKey) this.terminalKeys.set(lookupKey, id)

    return {
      id,
      backend: record.backend,
      cwd,
      shell: terminalLabel(record.shell),
      reused: false,
    }
  }

  createEventsResponse(
    id: string,
    scopeKey: string,
    signal: AbortSignal,
    lastSeq?: number
  ) {
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
          backend: record.backend,
          id: record.id,
          cwd: record.cwd,
          shell: terminalLabel(record.shell),
        })
        const firstSeq = record.backlog[0]?.seq
        if (
          typeof lastSeq === "number" &&
          firstSeq !== undefined &&
          lastSeq < firstSeq - 1
        ) {
          send({
            type: "reset",
            reason: "backlog_gap",
            firstSeq,
            nextSeq: record.nextOutputSeq,
          })
        }
        for (const event of record.backlog) {
          if (typeof lastSeq === "number" && event.seq <= lastSeq) continue
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

  writeTerminal(
    id: string,
    scopeKey: string,
    data: unknown,
    inputSeq?: unknown
  ) {
    const record = this.assertTerminalScope(id, scopeKey)
    if (record.exited) {
      throw new Error("Terminal has exited.")
    }
    if (typeof data !== "string") {
      throw new Error("Terminal input data is required.")
    }

    const normalizedInputSeq = normalizeDimension(
      inputSeq,
      0,
      0,
      Number.MAX_SAFE_INTEGER
    )
    if (normalizedInputSeq > 0) {
      if (normalizedInputSeq <= record.lastInputSeq) return
      record.lastInputSeq = normalizedInputSeq
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

  async closeTerminal(id: string, scopeKey: string) {
    this.assertTerminalScope(id, scopeKey)
    await this.disposeTerminalRecord(id)
  }

  dispose() {
    clearInterval(this.cleanupTimer)
    for (const id of this.terminals.keys()) {
      void this.disposeTerminalRecord(id)
    }
  }

  private async spawnPty(
    spawnConfig: TerminalSpawnConfig,
    cwd: string,
    cols: unknown,
    rows: unknown
  ) {
    const nodePty = await import("node-pty")
    return nodePty.spawn(spawnConfig.command, spawnConfig.args, {
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
  }

  private attachPtyHandlers(record: TerminalRecord) {
    record.dataDisposable = record.pty.onData((data) => {
      const seq = record.nextOutputSeq
      record.nextOutputSeq += 1
      this.publish(record, { type: "output", data, seq })
    })
    record.exitDisposable = record.pty.onExit((event) => {
      this.handlePtyExit(record, event.exitCode, event.signal)
    })
  }

  private handlePtyExit(
    record: TerminalRecord,
    exitCode: number,
    signal?: number
  ) {
    if (this.terminals.get(record.id) !== record) return

    record.exited = exitPayload(exitCode, signal)
    this.publish(record, exitEvent(exitCode, signal))
  }

  private createSpawnConfig(): TerminalSpawnConfig {
    const shell = defaultShell()
    return {
      args: [],
      backend: "shell",
      command: shell,
      shellLabel: shell,
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

  private async disposeTerminalRecord(id: string) {
    const record = this.terminals.get(id)
    if (!record) return

    this.terminals.delete(id)
    if (record.lookupKey) this.terminalKeys.delete(record.lookupKey)

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

  private cleanupExitedTerminals() {
    const now = Date.now()
    for (const record of this.terminals.values()) {
      if (record.subscribers.size > 0) continue
      if (!record.exited) continue
      if (now - record.lastUsedAt < TERMINAL_EXITED_TTL_MS) continue
      void this.disposeTerminalRecord(record.id)
    }
  }
}
