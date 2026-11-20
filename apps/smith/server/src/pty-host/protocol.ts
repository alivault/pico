/**
 * The protocol between the Pico server and its pty-host.
 *
 * The pty-host is a small process that owns the pseudo-terminals of one data
 * directory, so terminals and jobs keep running while the server restarts
 * (see docs/plans/pty-host.md). The server talks to it over a Unix socket:
 * one JSON object for each line. Requests carry an `id`, and their replies
 * carry the same `id`. Events (`output`, `exit`) have no `id`.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Change this when the messages change: a new protocol gets a new host. */
export const PTY_HOST_PROTOCOL = 1

/** What the server keeps with a pty, so it can find it again after a restart. */
export type PtyMeta = {
  kind: "job" | "shell"
  /** The server's lookup key (a job ID, or a scope and a client key). */
  key: string
  scopeKey: string
  cwd: string
  shell: string
  label?: string
  jobId?: string
  /** The server's ID of the terminal, kept so clients reconnect to it. */
  terminalId?: string
}

export type PtyExit = { exitCode: number; signal?: number }

export type PtyInfo = {
  ptyId: string
  pid: number
  device?: string
  cols: number
  rows: number
  meta: PtyMeta
  /** The sequence number of the next output chunk. */
  nextSeq: number
  /** The last input sequence of each viewer. */
  viewerSeqs: Record<string, number>
  exited?: PtyExit
  /** Exited while no server was connected, or found in the exit journal. */
  journal?: boolean
}

export type SpawnRequest = {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  meta: PtyMeta
  /** Write the output to the log of this job. */
  logJobId?: string
}

export type OutputChunk = { seq: number; data: string }

export type HostRequest =
  | { type: "hello"; protocol: number; version: string }
  | { type: "list" }
  | { type: "spawn"; spawn: SpawnRequest }
  | { type: "attach"; ptyId: string; fromSeq?: number }
  | {
      type: "write"
      ptyId: string
      data: string
      viewer?: string
      inputSeq?: number
    }
  | { type: "resize"; ptyId: string; cols: number; rows: number }
  | { type: "signal"; ptyId: string; signal: string; group?: boolean }
  | { type: "forget"; ptyId: string }
  | { type: "stats" }

export type HostEvent =
  | { type: "output"; ptyId: string; seq: number; data: string }
  | { type: "exit"; ptyId: string; exit: PtyExit }

export type HostReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

/** The files of the pty-host of a data directory. */
export function ptyHostPaths(dataDir: string) {
  const dir = join(dataDir, "pty-host")
  let socket = join(dir, `socket-v${PTY_HOST_PROTOCOL}`)
  // macOS allows 104 bytes for a socket path, Linux 108. The short path is
  // in a directory of this user (the host checks that it owns it).
  if (process.platform !== "win32" && Buffer.byteLength(socket) > 100) {
    const hash = createHash("sha256").update(dataDir).digest("hex").slice(0, 12)
    const uid = process.getuid?.() ?? 0
    socket = join(
      tmpdir(),
      `pico-pty-${uid}-${hash}`,
      `socket-v${PTY_HOST_PROTOCOL}`
    )
  }
  if (process.platform === "win32") {
    const hash = createHash("sha256").update(dataDir).digest("hex").slice(0, 12)
    socket = `\\\\.\\pipe\\pico-pty-host-${hash}-v${PTY_HOST_PROTOCOL}`
  }
  return {
    dir,
    socket,
    pidFile: join(dir, `host-v${PTY_HOST_PROTOCOL}.pid`),
    journal: join(dir, "exits.jsonl"),
    log: join(dir, "host.log"),
  }
}

/**
 * Whether a pid is a running pty-host. After a crash or a reboot, the pid of
 * an old pid file often belongs to another process.
 */
export function isPtyHost(pid: number) {
  if (!pid || pid === process.pid) return false
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false
  }
  try {
    const command =
      process.platform === "linux"
        ? readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ")
        : execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
            encoding: "utf8",
            timeout: 3000,
          })
    return command.includes("pty-host")
  } catch {
    return false
  }
}

/** Split a stream of text into lines, and parse each line as JSON. */
export function lineReader(onMessage: (message: unknown) => void) {
  let buffer = ""
  // Sockets use setEncoding("utf8"), so a character split over two chunks
  // arrives whole.
  return (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim()) {
        try {
          onMessage(JSON.parse(line))
        } catch (error) {
          console.warn("[pico] pty-host: a bad message:", error)
        }
      }
      newline = buffer.indexOf("\n")
    }
  }
}
