/**
 * Terminals for the workspace panel: login shells in pseudo-terminals.
 *
 * Output is numbered and kept in a bounded backlog, so a client that
 * reconnects gets what it missed, or a reset when the backlog no longer
 * covers it. Input carries sequence numbers, so a retried send is written once.
 * Each viewer (a tab in one client) has its own sequence numbers, so two
 * viewers of one terminal never drop each other's input.
 *
 * A background job that exited keeps no backlog in memory: viewers get the
 * end of its log file instead.
 */
import { userInfo } from "node:os"
import { basename } from "node:path"

import * as pty from "@lydell/node-pty"

import { posixShell } from "../extensions/util.ts"
import { plainText } from "./job-log.ts"
import { TerminalScreen, trimRows } from "./terminal-screen.ts"
import { badRequest } from "../http.ts"

const BACKLOG_MAX_CHUNKS = 500
const BACKLOG_MAX_BYTES = 512 * 1024
const EXITED_TTL_MS = 30 * 60 * 1000
const MIN_COLS = 20
const MAX_COLS = 500
const MIN_ROWS = 5
const MAX_ROWS = 200
const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30
const KEY_MAX_LENGTH = 256
const VIEWER_MAX_LENGTH = 64
const MAX_VIEWERS = 64
/** How much of an exited job's log a new viewer gets. */
const JOB_REPLAY_BYTES = BACKLOG_MAX_BYTES

export type TerminalEvent =
  | {
      type: "ready"
      backend: "shell"
      id: string
      cwd: string
      shell: string
      nextInputSeq: number
      label?: string
      jobId?: string
    }
  | { type: "output"; data: string; seq: number }
  | { type: "input_ack"; inputSeq: number }
  | { type: "pong" }
  | { type: "reset"; reason: "backlog_gap"; firstSeq: number; nextSeq: number }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; error: string }

type Listener = (event: TerminalEvent) => void

type Terminal = {
  id: string
  scopeKey: string
  lookupKey?: string
  cwd: string
  shell: string
  process: pty.IPty
  backlog: Array<Extract<TerminalEvent, { type: "output" }>>
  backlogBytes: number
  nextOutputSeq: number
  /** The last input sequence of each viewer, the least recent first. */
  lastInputSeq: Map<string, number>
  cols: number
  rows: number
  exited?: { exitCode: number; signal?: number }
  lastUsed: number
  listeners: Set<Listener>
  /** A background job: every viewer may attach; closing a tab does not stop it. */
  shared?: boolean
  jobId?: string
  label?: string
  /** The end of an exited job's output, read from its log file. */
  replay?: () => string
  /** The headless screen, while an agent reads this terminal. */
  screen?: TerminalScreen
  onInput?: (data: string) => void
}

/** A viewer ID from a client; an empty string for clients without one. */
function viewerKey(viewer: string | undefined) {
  return viewer?.trim().slice(0, VIEWER_MAX_LENGTH) ?? ""
}

/** The client key of the terminal tab that shows a background job. */
export function jobClientKey(jobId: string) {
  return `job:${jobId}`
}

const JOB_LOOKUP_PREFIX = "job\0"

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function loginShell() {
  const explicit = process.env.PICO_TERMINAL_SHELL?.trim()
  if (explicit) return explicit
  try {
    const shell = userInfo().shell
    if (shell) return shell
  } catch {
    // Fall through to $SHELL.
  }
  return process.env.SHELL?.trim() || "/bin/sh"
}

function shellEnvironment() {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const key of [
    "ZELLIJ",
    "ZELLIJ_SESSION_NAME",
    "TMUX",
    "TMUX_PANE",
    "STARSHIP_SESSION_KEY",
    "STARSHIP_SHELL",
    "TERMINFO",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
  ]) {
    delete env[key]
  }
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  env.TERM_PROGRAM = "Pico"
  return env
}

export class Terminals {
  readonly #terminals = new Map<string, Terminal>()
  readonly #lookup = new Map<string, string>()
  readonly #cleanup: NodeJS.Timeout

  constructor() {
    this.#cleanup = setInterval(() => this.#removeExpired(), 60_000)
    this.#cleanup.unref()
  }

  create(
    scopeKey: string,
    cwd: string,
    clientKey: string | undefined,
    cols?: number,
    rows?: number
  ) {
    this.#removeExpired()
    const key = clientKey?.trim().slice(0, KEY_MAX_LENGTH) || undefined
    if (key?.startsWith("job:")) {
      const jobTerminal = this.#terminals.get(
        this.#lookup.get(JOB_LOOKUP_PREFIX + key.slice(4)) ?? ""
      )
      if (!jobTerminal)
        throw badRequest("This job does not run in this server any more.")
      jobTerminal.lastUsed = Date.now()
      return {
        id: jobTerminal.id,
        backend: "shell" as const,
        cwd: jobTerminal.cwd,
        shell: basename(jobTerminal.shell),
        reused: true,
        ...(jobTerminal.label ? { label: jobTerminal.label } : {}),
        ...(jobTerminal.jobId ? { jobId: jobTerminal.jobId } : {}),
      }
    }
    const lookupKey = key ? `${scopeKey}\0${key}` : undefined
    const existingId = lookupKey ? this.#lookup.get(lookupKey) : undefined
    const existing = existingId ? this.#terminals.get(existingId) : undefined
    if (existing) {
      if (!existing.exited) {
        existing.lastUsed = Date.now()
        return {
          id: existing.id,
          backend: "shell" as const,
          cwd: existing.cwd,
          shell: basename(existing.shell),
          reused: true,
        }
      }
      this.close(scopeKey, existing.id)
    }

    const shell = loginShell()
    const columns = clamp(cols, MIN_COLS, MAX_COLS, DEFAULT_COLS)
    const lines = clamp(rows, MIN_ROWS, MAX_ROWS, DEFAULT_ROWS)
    let child: pty.IPty
    try {
      child = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: columns,
        rows: lines,
        cwd,
        env: shellEnvironment(),
      })
    } catch (error) {
      throw badRequest(
        `Could not start a terminal: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const id = crypto.randomUUID()
    const terminal: Terminal = {
      id,
      scopeKey,
      ...(lookupKey ? { lookupKey } : {}),
      cwd,
      shell,
      process: child,
      backlog: [],
      backlogBytes: 0,
      nextOutputSeq: 1,
      lastInputSeq: new Map(),
      cols: columns,
      rows: lines,
      lastUsed: Date.now(),
      listeners: new Set(),
    }
    this.#terminals.set(id, terminal)
    if (lookupKey) this.#lookup.set(lookupKey, id)
    child.onData((data) => this.#publishOutput(terminal, data))
    child.onExit(({ exitCode, signal }) => {
      terminal.exited = { exitCode, ...(signal ? { signal } : {}) }
      terminal.lastUsed = Date.now()
      this.#dropScreen(terminal)
      this.#emit(terminal, {
        type: "exit",
        exitCode,
        ...(signal ? { signal } : {}),
      })
    })
    return {
      id,
      backend: "shell" as const,
      cwd,
      shell: basename(shell),
      reused: false,
    }
  }

  #publishOutput(terminal: Terminal, data: string) {
    if (!data) return
    const event = { type: "output" as const, data, seq: terminal.nextOutputSeq }
    terminal.nextOutputSeq += 1
    terminal.backlog.push(event)
    terminal.backlogBytes += data.length
    while (
      terminal.backlog.length > BACKLOG_MAX_CHUNKS ||
      terminal.backlogBytes > BACKLOG_MAX_BYTES
    ) {
      const removed = terminal.backlog.shift()
      if (!removed) break
      terminal.backlogBytes -= removed.data.length
    }
    terminal.lastUsed = Date.now()
    terminal.screen?.write(data)
    this.#emit(terminal, event)
  }

  /** The screen of a running terminal; made at the first read. */
  #screen(terminal: Terminal) {
    if (!terminal.screen) {
      terminal.screen = new TerminalScreen(terminal.cols, terminal.rows)
      // The backlog is what the terminal shows now, as far as it goes back.
      terminal.screen.write(
        terminal.backlog.map((event) => event.data).join("")
      )
    }
    return terminal.screen
  }

  #dropScreen(terminal: Terminal) {
    const screen = terminal.screen
    if (!screen) return
    terminal.screen = undefined
    void screen.flush().finally(() => screen.dispose())
  }

  /** A terminal by ID, for the agent tools (no scope check). */
  #byId(id: string) {
    const terminal = this.#terminals.get(id)
    if (!terminal) throw new Error("No such terminal.")
    return terminal
  }

  /** The terminal ID of a job in this server, if any. */
  jobTerminalId(jobId: string) {
    return this.#lookup.get(JOB_LOOKUP_PREFIX + jobId)
  }

  /**
   * Read a terminal as text: `visible` is the screen a person sees now,
   * `recent` the last lines with scrollback. An exited terminal reads the
   * end of its output.
   */
  async readText(id: string, source: "visible" | "recent", lines: number) {
    const terminal = this.#byId(id)
    terminal.lastUsed = Date.now()
    if (terminal.exited) {
      const output = terminal.replay
        ? terminal.replay()
        : terminal.backlog.map((event) => event.data).join("")
      const text = plainText(output).trimEnd().split("\n")
      return {
        lines: text.slice(-(source === "visible" ? terminal.rows : lines)),
        exited: terminal.exited,
      }
    }
    const screen = this.#screen(terminal)
    if (source === "visible") {
      const view = await screen.visible()
      return {
        lines: trimRows(view.rows),
        cursor: view.cursor,
        alternate: view.alternate,
      }
    }
    return { lines: await screen.recent(lines) }
  }

  /** Write input for an agent: no input hooks, and no sequence numbers. */
  writeForAgent(id: string, data: string) {
    const terminal = this.#byId(id)
    if (terminal.exited) throw new Error("The terminal has exited.")
    terminal.lastUsed = Date.now()
    terminal.process.write(data)
  }

  /** The device of a terminal (Unix only), to read its mode. */
  device(id: string) {
    const device = (this.#terminals.get(id)?.process as { ptsName?: unknown })
      ?.ptsName
    return typeof device === "string" && device ? device : undefined
  }

  /** The user's shell terminals of a session (its terminal panel tabs). */
  sessionShells(sessionId: string) {
    return [...this.#terminals.values()]
      .filter(
        (terminal) =>
          !terminal.shared && terminal.scopeKey.split(":")[1] === sessionId
      )
      .map((terminal) => ({
        id: terminal.id,
        cwd: terminal.cwd,
        shell: basename(terminal.shell),
        exited: terminal.exited,
        lastUsed: terminal.lastUsed,
      }))
  }

  #emit(terminal: Terminal, event: TerminalEvent) {
    for (const listener of terminal.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error("[pico] terminal listener failed:", error)
      }
    }
  }

  /**
   * Run a command in a shared pseudo-terminal, for a background job. The
   * user's login shell runs it, so PATH matches an interactive terminal.
   */
  spawnJob(
    jobId: string,
    command: string,
    cwd: string,
    handlers: {
      label?: string
      onOutput: (data: string) => void
      onExit: (exit: { exitCode: number; signal?: number }) => void
      /** Input from a viewer, after it is written. */
      onInput?: (data: string) => void
    }
  ) {
    // Jobs run commands that models write, so they need a POSIX shell. A POSIX
    // login shell keeps the user's PATH; other shells get bash, with the
    // server's environment.
    const login = loginShell()
    const shell = posixShell(login)
    let child: pty.IPty
    try {
      child = pty.spawn(
        shell,
        shell === login ? ["-l", "-c", command] : ["-c", command],
        {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd,
          env: shellEnvironment(),
        }
      )
    } catch (error) {
      throw new Error(
        `Could not start the job: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const id = crypto.randomUUID()
    const lookupKey = JOB_LOOKUP_PREFIX + jobId
    const terminal: Terminal = {
      id,
      scopeKey: "job",
      lookupKey,
      cwd,
      shell,
      process: child,
      backlog: [],
      backlogBytes: 0,
      nextOutputSeq: 1,
      lastInputSeq: new Map(),
      cols: 120,
      rows: 30,
      lastUsed: Date.now(),
      listeners: new Set(),
      shared: true,
      jobId,
      ...(handlers.label ? { label: handlers.label } : {}),
      ...(handlers.onInput ? { onInput: handlers.onInput } : {}),
    }
    this.#terminals.set(id, terminal)
    this.#lookup.set(lookupKey, id)
    child.onData((data) => {
      this.#publishOutput(terminal, data)
      handlers.onOutput(data)
    })
    child.onExit(({ exitCode, signal }) => {
      terminal.exited = { exitCode, ...(signal ? { signal } : {}) }
      terminal.lastUsed = Date.now()
      this.#dropScreen(terminal)
      this.#emit(terminal, {
        type: "exit",
        exitCode,
        ...(signal ? { signal } : {}),
      })
      handlers.onExit(terminal.exited)
    })
    // The terminal device of the job (Unix only), to read its mode.
    const device = (child as { ptsName?: unknown }).ptsName
    return {
      terminalId: id,
      pid: child.pid,
      ...(typeof device === "string" && device ? { device } : {}),
    }
  }

  /**
   * Drop the in-memory backlog of a job that exited; viewers then get the
   * end of its log. Call it when the log has all the output.
   */
  releaseJobOutput(jobId: string, replay: (maxBytes: number) => string) {
    const terminal = this.#terminals.get(
      this.#lookup.get(JOB_LOOKUP_PREFIX + jobId) ?? ""
    )
    if (!terminal?.exited) return
    terminal.backlog = []
    terminal.backlogBytes = 0
    terminal.replay = () => replay(JOB_REPLAY_BYTES)
  }

  /** Whether this server has a terminal for a job, running or not. */
  hasJob(jobId: string) {
    return this.#lookup.has(JOB_LOOKUP_PREFIX + jobId)
  }

  /**
   * A terminal for a finished job that has no terminal in this server any
   * more (for example after a restart): it shows the end of the job's log.
   */
  addFinishedJob(
    jobId: string,
    info: {
      label?: string
      cwd: string
      exit: { exitCode: number; signal?: number }
      replay: (maxBytes: number) => string
    }
  ) {
    const existing = this.#lookup.get(JOB_LOOKUP_PREFIX + jobId)
    if (existing) return existing
    const id = crypto.randomUUID()
    const terminal: Terminal = {
      id,
      scopeKey: "job",
      lookupKey: JOB_LOOKUP_PREFIX + jobId,
      cwd: info.cwd,
      shell: "job",
      // No process: an exited terminal never uses it.
      process: undefined as unknown as pty.IPty,
      backlog: [],
      backlogBytes: 0,
      nextOutputSeq: 2,
      lastInputSeq: new Map(),
      cols: 120,
      rows: 30,
      exited: info.exit,
      lastUsed: Date.now(),
      listeners: new Set(),
      shared: true,
      jobId,
      ...(info.label ? { label: info.label } : {}),
      replay: () => info.replay(JOB_REPLAY_BYTES),
    }
    this.#terminals.set(id, terminal)
    this.#lookup.set(terminal.lookupKey!, id)
    return id
  }

  /** Whether a job still runs in this server. */
  jobRunning(jobId: string) {
    const terminal = this.#terminals.get(
      this.#lookup.get(JOB_LOOKUP_PREFIX + jobId) ?? ""
    )
    return Boolean(terminal && !terminal.exited)
  }

  /** Stop a job: SIGTERM, then SIGKILL when it is still alive after `graceMs`. */
  stopJob(jobId: string, graceMs = 3000) {
    const terminal = this.#terminals.get(
      this.#lookup.get(JOB_LOOKUP_PREFIX + jobId) ?? ""
    )
    if (!terminal || terminal.exited) return false
    try {
      terminal.process.kill("SIGTERM")
    } catch {
      return false
    }
    setTimeout(() => {
      if (terminal.exited) return
      try {
        terminal.process.kill("SIGKILL")
      } catch {
        // Already gone.
      }
    }, graceMs).unref()
    return true
  }

  #record(scopeKey: string, id: string) {
    const terminal = this.#terminals.get(id)
    if (!terminal) throw badRequest("Terminal not found.")
    if (terminal.shared) return terminal
    if (terminal.scopeKey !== scopeKey)
      throw badRequest("Terminal not found for this session.")
    return terminal
  }

  /**
   * Attach to a terminal: the ready event, what the client missed after
   * `lastSeq`, and later events through `listener`.
   */
  subscribe(
    scopeKey: string,
    id: string,
    lastSeq: number | undefined,
    listener: Listener,
    viewer?: string
  ) {
    const terminal = this.#record(scopeKey, id)
    terminal.lastUsed = Date.now()
    const initial: TerminalEvent[] = [
      {
        type: "ready",
        backend: "shell",
        id: terminal.id,
        cwd: terminal.cwd,
        shell: basename(terminal.shell),
        nextInputSeq: (terminal.lastInputSeq.get(viewerKey(viewer)) ?? 0) + 1,
        ...(terminal.label ? { label: terminal.label } : {}),
        ...(terminal.jobId ? { jobId: terminal.jobId } : {}),
      },
    ]
    const lastOutput = terminal.nextOutputSeq - 1
    if (terminal.replay) {
      // An exited job: the end of its log stands for all of its output.
      if (lastSeq === undefined || lastSeq < lastOutput) {
        if (lastSeq !== undefined && lastSeq > 0)
          initial.push({
            type: "reset",
            reason: "backlog_gap",
            firstSeq: lastOutput,
            nextSeq: terminal.nextOutputSeq,
          })
        const data = terminal.replay()
        if (data) initial.push({ type: "output", data, seq: lastOutput })
      }
    } else {
      const firstSeq = terminal.backlog[0]?.seq ?? terminal.nextOutputSeq
      if (lastSeq !== undefined && lastSeq + 1 < firstSeq) {
        initial.push({
          type: "reset",
          reason: "backlog_gap",
          firstSeq,
          nextSeq: terminal.nextOutputSeq,
        })
      }
      for (const event of terminal.backlog) {
        if (lastSeq === undefined || event.seq > lastSeq) initial.push(event)
      }
    }
    if (terminal.exited) initial.push({ type: "exit", ...terminal.exited })
    let latest = initial.reduce(
      (max, event) =>
        event.type === "output" ? Math.max(max, event.seq) : max,
      lastSeq ?? 0
    )
    const filtered: Listener = (event) => {
      if (event.type === "output") {
        if (event.seq <= latest) return
        latest = event.seq
      }
      listener(event)
    }
    terminal.listeners.add(filtered)
    return {
      initial,
      unsubscribe: () => {
        terminal.listeners.delete(filtered)
        terminal.lastUsed = Date.now()
      },
    }
  }

  /** Write input; returns the sequence to acknowledge, if the client sent one. */
  write(
    scopeKey: string,
    id: string,
    data: string,
    inputSeq: number | undefined,
    viewer?: string
  ) {
    const terminal = this.#record(scopeKey, id)
    if (terminal.exited) throw badRequest("Terminal has exited.")
    if (inputSeq !== undefined && inputSeq > 0) {
      const key = viewerKey(viewer)
      const last = terminal.lastInputSeq.get(key) ?? 0
      if (inputSeq <= last) return inputSeq
      // Keep the most recent viewers first out of the map's order.
      terminal.lastInputSeq.delete(key)
      terminal.lastInputSeq.set(key, inputSeq)
      if (terminal.lastInputSeq.size > MAX_VIEWERS) {
        const oldest = terminal.lastInputSeq.keys().next().value
        if (oldest !== undefined) terminal.lastInputSeq.delete(oldest)
      }
    }
    terminal.lastUsed = Date.now()
    terminal.process.write(data)
    terminal.onInput?.(data)
    return inputSeq !== undefined && inputSeq > 0 ? inputSeq : undefined
  }

  resize(
    scopeKey: string,
    id: string,
    cols: number | undefined,
    rows: number | undefined
  ) {
    const terminal = this.#record(scopeKey, id)
    if (terminal.exited) return
    terminal.cols = clamp(cols, MIN_COLS, MAX_COLS, terminal.cols)
    terminal.rows = clamp(rows, MIN_ROWS, MAX_ROWS, terminal.rows)
    terminal.lastUsed = Date.now()
    terminal.process.resize(terminal.cols, terminal.rows)
    terminal.screen?.resize(terminal.cols, terminal.rows)
  }

  close(scopeKey: string, id: string) {
    const terminal = this.#record(scopeKey, id)
    // A tab that shows a job only detaches; job_stop stops the job.
    if (terminal.shared) return
    terminal.screen?.dispose()
    this.#terminals.delete(id)
    if (terminal.lookupKey) this.#lookup.delete(terminal.lookupKey)
    if (!terminal.exited) {
      try {
        terminal.process.kill()
      } catch {
        // Already gone.
      }
    }
  }

  shutdown() {
    clearInterval(this.#cleanup)
    for (const terminal of this.#terminals.values()) {
      terminal.screen?.dispose()
      if (terminal.exited) continue
      try {
        terminal.process.kill()
      } catch {
        // Already gone.
      }
    }
    this.#terminals.clear()
    this.#lookup.clear()
  }

  #removeExpired() {
    for (const [id, terminal] of this.#terminals) {
      if (!terminal.exited || terminal.listeners.size > 0) continue
      if (Date.now() - terminal.lastUsed < EXITED_TTL_MS) continue
      this.#terminals.delete(id)
      if (terminal.lookupKey) this.#lookup.delete(terminal.lookupKey)
    }
  }
}

/** Numbers clients send as numbers, strings, or booleans. */
export function looseNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") {
    const parsed = Number(value.trim())
    return value.trim() && Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === "boolean") return value ? 1 : 0
  if (value === null) return 0
  return undefined
}
