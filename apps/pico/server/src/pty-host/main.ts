/**
 * The pty-host: a small process that owns the pseudo-terminals of one Pico
 * data directory, so terminals and jobs keep running while the server
 * restarts. See docs/plans/pty-host.md and ./protocol.ts.
 *
 *   node pty-host.mjs --data-dir <dir>
 *
 * It runs in its own session (the server starts it detached), so a signal
 * to the server's process group or the end of an SSH session does not reach
 * it. It exits by itself when no pty runs and no server is connected for a
 * while. To stop it by hand: `kill <pid>` (the pid is in
 * `<data>/pty-host/host-v<protocol>.pid`); its ptys end with it.
 */
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { createServer, type Socket } from "node:net"
import { dirname } from "node:path"

import * as pty from "@lydell/node-pty"

import { JobLogWriter } from "../services/job-log.ts"
import {
  lineReader,
  PTY_HOST_PROTOCOL,
  ptyHostPaths,
  type HostEvent,
  type HostRequest,
  type OutputChunk,
  type PtyExit,
  type PtyInfo,
  type PtyMeta,
} from "./protocol.ts"

const BACKLOG_MAX_CHUNKS = 500
const BACKLOG_MAX_BYTES = 512 * 1024
const MAX_VIEWERS = 64
/** Exited ptys stay this long for a server to read them. */
const EXITED_TTL_MS = 30 * 60 * 1000
const IDLE_MS = Number(process.env.PICO_PTY_HOST_IDLE_MS) || 10 * 60 * 1000

type Pty = {
  ptyId: string
  process: pty.IPty
  device?: string
  meta: PtyMeta
  backlog: OutputChunk[]
  backlogBytes: number
  nextSeq: number
  viewerSeqs: Map<string, number>
  cols: number
  rows: number
  exited?: PtyExit
  exitedAt?: number
  log?: JobLogWriter
  sockets: Set<Socket>
}

type JournalEntry = {
  ptyId: string
  meta: PtyMeta
  exit: PtyExit
  at: number
}

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const dataDir = argument("data-dir")
if (!dataDir) {
  console.error("Usage: pty-host --data-dir <dir>")
  process.exit(2)
}
const paths = ptyHostPaths(dataDir)
process.title = `pico-pty-host ${dataDir}`

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Take the pid file; false when another host runs. */
function lock() {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  chmodSync(paths.dir, 0o700)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(paths.pidFile, "wx", 0o600)
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const pid = Number(readFileSync(paths.pidFile, "utf8").trim())
      if (pid && pid !== process.pid && alive(pid)) return false
      // A stale lock: its host is gone.
      unlinkSync(paths.pidFile)
    }
  }
  return false
}

if (!lock()) {
  console.log("[pty-host] another host runs for this data directory")
  process.exit(0)
}

const ptys = new Map<string, Pty>()
const clients = new Set<Socket>()
let lastActivity = Date.now()

function readJournal() {
  const entries = new Map<string, JournalEntry>()
  if (!existsSync(paths.journal)) return entries
  for (const line of readFileSync(paths.journal, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as JournalEntry & { forget?: boolean }
      if (entry.forget) entries.delete(entry.ptyId)
      else entries.set(entry.ptyId, entry)
    } catch {
      // A torn last line after a crash.
    }
  }
  return entries
}

/** Exits that no server has taken yet; they survive a host restart. */
const journal = readJournal()
writeJournal()

function writeJournal() {
  writeFileSync(
    paths.journal,
    [...journal.values()].map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    { mode: 0o600 }
  )
}

function send(socket: Socket, message: object) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
}

function emit(record: Pty, event: HostEvent) {
  for (const socket of record.sockets) send(socket, event)
}

function info(record: Pty): PtyInfo {
  return {
    ptyId: record.ptyId,
    pid: record.process.pid,
    ...(record.device ? { device: record.device } : {}),
    cols: record.cols,
    rows: record.rows,
    meta: record.meta,
    nextSeq: record.nextSeq,
    viewerSeqs: Object.fromEntries(record.viewerSeqs),
    ...(record.exited ? { exited: record.exited } : {}),
  }
}

function spawn(
  socket: Socket,
  request: Extract<HostRequest, { type: "spawn" }>
) {
  const options = request.spawn
  const child = pty.spawn(options.file, options.args, {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  })
  const device = (child as { ptsName?: unknown }).ptsName
  const record: Pty = {
    ptyId: crypto.randomUUID(),
    process: child,
    ...(typeof device === "string" && device ? { device } : {}),
    meta: options.meta,
    backlog: [],
    backlogBytes: 0,
    nextSeq: 1,
    viewerSeqs: new Map(),
    cols: options.cols,
    rows: options.rows,
    sockets: new Set([socket]),
    ...(options.logJobId
      ? { log: new JobLogWriter(dataDir!, options.logJobId) }
      : {}),
  }
  ptys.set(record.ptyId, record)
  child.onData((data) => {
    lastActivity = Date.now()
    record.log?.write(data)
    const chunk = { seq: record.nextSeq, data }
    record.nextSeq += 1
    record.backlog.push(chunk)
    record.backlogBytes += data.length
    while (
      record.backlog.length > BACKLOG_MAX_CHUNKS ||
      record.backlogBytes > BACKLOG_MAX_BYTES
    ) {
      const removed = record.backlog.shift()
      if (!removed) break
      record.backlogBytes -= removed.data.length
    }
    emit(record, { type: "output", ptyId: record.ptyId, ...chunk })
  })
  child.onExit(({ exitCode, signal }) => {
    lastActivity = Date.now()
    record.exited = { exitCode, ...(signal ? { signal } : {}) }
    record.exitedAt = Date.now()
    record.log?.end()
    const entry = {
      ptyId: record.ptyId,
      meta: record.meta,
      exit: record.exited,
      at: Date.now(),
    }
    journal.set(record.ptyId, entry)
    appendFileSync(paths.journal, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    emit(record, { type: "exit", ptyId: record.ptyId, exit: record.exited })
  })
  return info(record)
}

function handle(socket: Socket, request: HostRequest & { id: number }) {
  const record = "ptyId" in request ? ptys.get(request.ptyId) : undefined
  switch (request.type) {
    case "hello":
      return {
        protocol: PTY_HOST_PROTOCOL,
        pid: process.pid,
        version: request.version,
      }
    case "list":
      return [
        ...[...ptys.values()].map(info),
        // Exits from before a host restart.
        ...[...journal.values()]
          .filter((entry) => !ptys.has(entry.ptyId))
          .map(
            (entry): PtyInfo => ({
              ptyId: entry.ptyId,
              pid: 0,
              cols: 0,
              rows: 0,
              meta: entry.meta,
              nextSeq: 1,
              viewerSeqs: {},
              exited: entry.exit,
              journal: true,
            })
          ),
      ]
    case "spawn":
      return spawn(socket, request)
    case "stats":
      return {
        pid: process.pid,
        rss: process.memoryUsage().rss,
        ptys: ptys.size,
        running: [...ptys.values()].filter((item) => !item.exited).length,
      }
    case "forget": {
      if (record) {
        if (!record.exited)
          try {
            record.process.kill()
          } catch {
            // Gone.
          }
        ptys.delete(request.ptyId)
      }
      if (journal.delete(request.ptyId))
        appendFileSync(
          paths.journal,
          `${JSON.stringify({ ptyId: request.ptyId, forget: true })}\n`
        )
      return {}
    }
  }
  if (!record) throw new Error("No such pty")
  switch (request.type) {
    case "attach": {
      record.sockets.add(socket)
      const from = request.fromSeq ?? 0
      const first = record.backlog[0]?.seq ?? record.nextSeq
      return {
        info: info(record),
        gap: from + 1 < first,
        chunks: record.backlog.filter((chunk) => chunk.seq > from),
      }
    }
    case "write": {
      if (record.exited) throw new Error("The terminal has exited.")
      if (request.inputSeq !== undefined && request.inputSeq > 0) {
        const key = request.viewer ?? ""
        if (request.inputSeq <= (record.viewerSeqs.get(key) ?? 0))
          return { written: false }
        record.viewerSeqs.delete(key)
        record.viewerSeqs.set(key, request.inputSeq)
        if (record.viewerSeqs.size > MAX_VIEWERS) {
          const oldest = record.viewerSeqs.keys().next().value
          if (oldest !== undefined) record.viewerSeqs.delete(oldest)
        }
      }
      lastActivity = Date.now()
      record.process.write(request.data)
      return { written: true }
    }
    case "resize":
      if (!record.exited) {
        record.cols = request.cols
        record.rows = request.rows
        record.process.resize(request.cols, request.rows)
      }
      return {}
    case "signal":
      if (!record.exited) {
        if (request.group && process.platform !== "win32") {
          // The pty's child leads its own session and process group.
          process.kill(-record.process.pid, request.signal as NodeJS.Signals)
        } else record.process.kill(request.signal)
      }
      return {}
  }
  throw new Error("Unknown request")
}

const server = createServer((socket) => {
  clients.add(socket)
  lastActivity = Date.now()
  socket.setNoDelay(true)
  socket.on(
    "data",
    lineReader((message) => {
      const request = message as HostRequest & { id: number }
      try {
        const result = handle(socket, request)
        send(socket, { id: request.id, ok: true, result })
      } catch (error) {
        send(socket, {
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  )
  const drop = () => {
    clients.delete(socket)
    lastActivity = Date.now()
    for (const record of ptys.values()) record.sockets.delete(socket)
  }
  socket.on("close", drop)
  socket.on("error", drop)
})

function stop(code: number) {
  for (const record of ptys.values())
    if (!record.exited)
      try {
        record.process.kill()
      } catch {
        // Gone.
      }
  server.close()
  try {
    if (readFileSync(paths.pidFile, "utf8").trim() === String(process.pid))
      unlinkSync(paths.pidFile)
  } catch {
    // Gone.
  }
  if (process.platform !== "win32")
    try {
      unlinkSync(paths.socket)
    } catch {
      // Gone.
    }
  setTimeout(() => process.exit(code), 200).unref()
}

// The host outlives the terminal or SSH session that started Pico.
process.on("SIGHUP", () => undefined)
process.on("SIGTERM", () => stop(0))
process.on("SIGINT", () => stop(0))

if (process.platform !== "win32") {
  mkdirSync(dirname(paths.socket), { recursive: true, mode: 0o700 })
  chmodSync(dirname(paths.socket), 0o700)
  // We hold the lock, so a socket file here is stale.
  try {
    unlinkSync(paths.socket)
  } catch {
    // None.
  }
}
server.listen(paths.socket, () => {
  if (process.platform !== "win32") chmodSync(paths.socket, 0o600)
  console.log(`[pty-host] ${process.pid} listens on ${paths.socket}`)
})

setInterval(
  () => {
    const now = Date.now()
    for (const [id, record] of ptys)
      if (
        record.exited &&
        record.sockets.size === 0 &&
        now - (record.exitedAt ?? now) > EXITED_TTL_MS
      )
        ptys.delete(id)
    const running = [...ptys.values()].some((record) => !record.exited)
    if (!running && clients.size === 0 && now - lastActivity > IDLE_MS) {
      console.log("[pty-host] idle: stopping")
      stop(0)
    }
  },
  Math.min(30_000, IDLE_MS / 2)
).unref()
