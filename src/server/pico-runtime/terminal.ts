import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { chmod, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

import type { IDisposable, IPty } from "node-pty"

const TERMINAL_BACKLOG_MAX_CHUNKS = 500
const TERMINAL_BACKLOG_MAX_BYTES = 512 * 1024
const TERMINAL_IDLE_TTL_MS = 30 * 60 * 1000
const TERMINAL_CLEANUP_INTERVAL_MS = 60 * 1000
const TERMINAL_COMMAND_CHECK_TIMEOUT_MS = 1500
const TERMINAL_COMMAND_TIMEOUT_MS = 5000
const TERMINAL_MIN_COLS = 20
const TERMINAL_MAX_COLS = 500
const TERMINAL_MIN_ROWS = 5
const TERMINAL_MAX_ROWS = 200
const TERMINAL_DEFAULT_COLS = 100
const TERMINAL_DEFAULT_ROWS = 30
const TERMINAL_KEY_MAX_LENGTH = 256

const require = createRequire(import.meta.url)
let ensureSpawnHelperExecutablePromise: Promise<void> | undefined
let terminalMultiplexerBackendPromise:
  | Promise<TerminalMultiplexerBackend | null>
  | undefined

export type TerminalBackend = "zellij" | "tmux" | "shell"

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

type TerminalMultiplexerBackend = {
  type: Exclude<TerminalBackend, "shell">
  command: string
  label: string
}

type TerminalSpawnConfig = {
  args: Array<string>
  backend: TerminalBackend
  command: string
  multiplexerSessionName?: string
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
  backlog: Array<TerminalServerEvent>
  backlogBytes: number
  createdAt: number
  lastUsedAt: number
  lookupKey?: string
  multiplexerSessionName?: string
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

  // The Pico server itself is often launched from a terminal multiplexer. A
  // browser terminal is a fresh PTY, so do not let inherited multiplexer state
  // make child shells, zellij, or tmux think they are already nested.
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

function normalizeTerminalKey(value: unknown) {
  if (typeof value !== "string") return undefined

  const normalized = value.trim()
  if (!normalized) return undefined

  return normalized.slice(0, TERMINAL_KEY_MAX_LENGTH)
}

function terminalLookupKey(scopeKey: string, terminalKey: string) {
  return `${scopeKey}\0${terminalKey}`
}

function terminalMultiplexerSessionName(scopeKey: string, terminalKey: string) {
  const hash = createHash("sha256")
    .update(scopeKey)
    .update("\0")
    .update(terminalKey)
    .digest("hex")
    .slice(0, 32)

  return `pico-${hash}`
}

function multiplexerAttachArgs(
  backend: TerminalMultiplexerBackend,
  sessionName: string
) {
  switch (backend.type) {
    case "zellij":
      return ["attach", "--create", sessionName]
    case "tmux":
      return ["new-session", "-A", "-s", sessionName]
  }
}

function multiplexerKillArgs(record: TerminalRecord) {
  if (!record.multiplexerSessionName) return null

  switch (record.backend) {
    case "zellij":
      return {
        command: "zellij",
        args: ["kill-session", record.multiplexerSessionName],
      }
    case "tmux":
      return {
        command: "tmux",
        args: ["kill-session", "-t", record.multiplexerSessionName],
      }
    case "shell":
      return null
  }
}

function runCommand(
  command: string,
  args: Array<string>,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(command, args, {
      env: createTerminalEnv(),
      stdio: "ignore",
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve(false)
    }, timeoutMs)

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    child.once("error", () => finish(false))
    child.once("exit", (code) => finish(code === 0))
  })
}

async function resolveTerminalMultiplexerBackend() {
  terminalMultiplexerBackendPromise ??= (async () => {
    if (process.platform === "win32") return null

    if (
      await runCommand(
        "zellij",
        ["--version"],
        TERMINAL_COMMAND_CHECK_TIMEOUT_MS
      )
    ) {
      return {
        type: "zellij",
        command: "zellij",
        label: "zellij",
      } satisfies TerminalMultiplexerBackend
    }

    if (await runCommand("tmux", ["-V"], TERMINAL_COMMAND_CHECK_TIMEOUT_MS)) {
      return {
        type: "tmux",
        command: "tmux",
        label: "tmux",
      } satisfies TerminalMultiplexerBackend
    }

    return null
  })()

  return await terminalMultiplexerBackendPromise
}

export class PicoTerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly terminalKeys = new Map<string, string>()
  private readonly encoder = new TextEncoder()
  private readonly cleanupTimer: NodeJS.Timeout

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleTerminals()
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
      await this.disposeTerminalRecord(existingRecord.id, {
        destroyBackingSession: false,
      })
    }

    const nodePty = await import("node-pty")
    const spawnConfig = await this.createSpawnConfig(scopeKey, terminalKey)
    const pty = nodePty.spawn(spawnConfig.command, spawnConfig.args, {
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
      createdAt: now,
      lastUsedAt: now,
    }

    if (lookupKey) record.lookupKey = lookupKey
    if (spawnConfig.multiplexerSessionName) {
      record.multiplexerSessionName = spawnConfig.multiplexerSessionName
    }
    if (terminalKey) record.terminalKey = terminalKey

    record.dataDisposable = pty.onData((data) => {
      this.publish(record, { type: "output", data })
    })
    record.exitDisposable = pty.onExit((event) => {
      record.exited = exitPayload(event.exitCode, event.signal)
      this.publish(record, exitEvent(event.exitCode, event.signal))
    })

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
          backend: record.backend,
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

  async closeTerminal(id: string, scopeKey: string) {
    this.assertTerminalScope(id, scopeKey)
    await this.disposeTerminalRecord(id, { destroyBackingSession: true })
  }

  dispose() {
    clearInterval(this.cleanupTimer)
    for (const id of this.terminals.keys()) {
      void this.disposeTerminalRecord(id, { destroyBackingSession: false })
    }
  }

  private async createSpawnConfig(
    scopeKey: string,
    terminalKey: string | undefined
  ): Promise<TerminalSpawnConfig> {
    const multiplexerBackend = terminalKey
      ? await resolveTerminalMultiplexerBackend()
      : null

    if (multiplexerBackend && terminalKey) {
      const multiplexerSessionName = terminalMultiplexerSessionName(
        scopeKey,
        terminalKey
      )
      return {
        args: multiplexerAttachArgs(multiplexerBackend, multiplexerSessionName),
        backend: multiplexerBackend.type,
        command: multiplexerBackend.command,
        multiplexerSessionName,
        shellLabel: multiplexerBackend.label,
      }
    }

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

  private async disposeTerminalRecord(
    id: string,
    options: { destroyBackingSession: boolean }
  ) {
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

    if (options.destroyBackingSession) {
      await this.destroyMultiplexerSession(record)
    }
  }

  private async destroyMultiplexerSession(record: TerminalRecord) {
    const command = multiplexerKillArgs(record)
    if (!command) return

    await runCommand(command.command, command.args, TERMINAL_COMMAND_TIMEOUT_MS)
  }

  private cleanupIdleTerminals() {
    const now = Date.now()
    for (const record of this.terminals.values()) {
      if (record.subscribers.size > 0) continue
      if (now - record.lastUsedAt < TERMINAL_IDLE_TTL_MS) continue
      void this.disposeTerminalRecord(record.id, {
        destroyBackingSession: false,
      })
    }
  }
}
