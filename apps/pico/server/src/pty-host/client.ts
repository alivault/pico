/**
 * The server's side of the pty-host: find or start the host of a data
 * directory, and send it requests over its socket.
 */
import { spawn as spawnProcess } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs"
import { connect, type Socket } from "node:net"

import {
  isPtyHost,
  lineReader,
  PTY_HOST_PROTOCOL,
  ptyHostPaths,
  type HostEvent,
  type HostReply,
  type HostRequest,
} from "./protocol.ts"

const CONNECT_TIMEOUT_MS = 8000

/**
 * Whether this process runs in a systemd service's cgroup. A stop of that
 * service kills every process in its cgroup, also detached ones.
 */
export function inServiceCgroup() {
  if (process.platform !== "linux") return false
  try {
    // The cgroup v2 line ("0::/path"); the first line with cgroup v1.
    const lines = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n")
    const line = lines.find((item) => item.startsWith("0::")) ?? lines[0]
    const path = line?.split(":").at(-1) ?? ""
    return (path.split("/").at(-1) ?? "").endsWith(".service")
  } catch {
    return false
  }
}

function systemdRun() {
  for (const path of ["/usr/bin/systemd-run", "/bin/systemd-run"])
    if (existsSync(path)) return path
  return undefined
}

/**
 * Start the host, detached in its own session: a signal to the server's
 * process group, a Ctrl+C, or the end of an SSH session does not reach it.
 * In a systemd service, it also gets its own scope (cgroup), so a stop of
 * the service does not kill it.
 */
export function startPtyHost(dataDir: string, script: string) {
  const paths = ptyHostPaths(dataDir)
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  const log = openSync(paths.log, "a", 0o600)
  const node = [process.execPath, script, "--data-dir", dataDir]
  const run = systemdRun()
  const useScope =
    process.env.PICO_PTY_HOST_SYSTEMD !== "0" &&
    run !== undefined &&
    inServiceCgroup()
  const hash = createHash("sha256").update(dataDir).digest("hex").slice(0, 8)
  const command = useScope
    ? [
        run!,
        "--user",
        "--scope",
        "--quiet",
        `--unit=pico-pty-host-${hash}-${Date.now().toString(36)}`,
        "--",
        ...node,
      ]
    : node
  const child = spawnProcess(command[0]!, command.slice(1), {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  })
  child.unref()
  if (useScope) {
    // systemd-run fails at once when it cannot make the scope (no user
    // manager): start the host without a scope then. With a scope, its exit
    // is the host's exit, so a later exit is not that.
    const started = Date.now()
    child.once("exit", (code) => {
      if (code !== 0 && code !== null && Date.now() - started < 2000) {
        const plain = spawnProcess(node[0]!, node.slice(1), {
          detached: true,
          stdio: ["ignore", log, log],
          env: process.env,
        })
        plain.unref()
      }
    })
  }
  return child
}

/**
 * Stop the pty-host of a data directory (its terminals and jobs end with
 * it). Returns its pid, or undefined when none runs.
 */
export async function stopPtyHost(dataDir: string) {
  let pid = 0
  try {
    pid = Number(readFileSync(ptyHostPaths(dataDir).pidFile, "utf8").trim())
  } catch {
    return undefined
  }
  if (!isPtyHost(pid)) return undefined
  process.kill(pid, "SIGTERM")
  const deadline = Date.now() + 5000
  while (isPtyHost(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100))
  return pid
}

/** Remove the socket and the pid file of a host that is gone. */
function removeStale(dataDir: string) {
  const paths = ptyHostPaths(dataDir)
  try {
    const pid = Number(readFileSync(paths.pidFile, "utf8").trim())
    if (isPtyHost(pid)) return false
    unlinkSync(paths.pidFile)
  } catch {
    // No pid file.
  }
  if (process.platform !== "win32")
    try {
      unlinkSync(paths.socket)
    } catch {
      // No socket.
    }
  return true
}

function connectSocket(path: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(path)
    socket.once("connect", () => {
      socket.off("error", reject)
      resolve(socket)
    })
    socket.once("error", reject)
  })
}

export class PtyHostClient {
  readonly #dataDir: string
  readonly #script: string
  readonly #version: string
  readonly #onEvent: (event: HostEvent) => void
  readonly #onClose: () => void
  #socket: Socket | undefined
  #connecting: Promise<void> | undefined
  #nextId = 1
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  #closing = false
  /** The pid of the host, from its hello. */
  hostPid = 0

  constructor(options: {
    dataDir: string
    script: string
    version: string
    onEvent: (event: HostEvent) => void
    onClose: () => void
  }) {
    this.#dataDir = options.dataDir
    this.#script = options.script
    this.#version = options.version
    this.#onEvent = options.onEvent
    this.#onClose = options.onClose
  }

  get connected() {
    return Boolean(this.#socket && !this.#socket.destroyed)
  }

  /** Connect to the host; start it when none runs. */
  connect() {
    if (this.connected) return Promise.resolve()
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = undefined
    })
    return this.#connecting
  }

  async #connect() {
    const paths = ptyHostPaths(this.#dataDir)
    const deadline = Date.now() + CONNECT_TIMEOUT_MS
    let started = false
    for (;;) {
      try {
        const socket = await connectSocket(paths.socket)
        this.#attach(socket)
        const hello = (await this.request({
          type: "hello",
          protocol: PTY_HOST_PROTOCOL,
          version: this.#version,
        })) as { protocol: number; pid: number }
        if (hello.protocol !== PTY_HOST_PROTOCOL)
          throw new Error(`pty-host protocol ${hello.protocol}`)
        this.hostPid = hello.pid
        return
      } catch (error) {
        if (Date.now() > deadline)
          throw new Error(
            `Could not reach the pty-host: ${error instanceof Error ? error.message : String(error)}. See ${paths.log}`
          )
        if (!started && removeStale(this.#dataDir)) {
          startPtyHost(this.#dataDir, this.#script)
          started = true
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  #attach(socket: Socket) {
    this.#socket = socket
    socket.setNoDelay(true)
    socket.setEncoding("utf8")
    socket.on(
      "data",
      lineReader((message) => {
        const reply = message as HostReply | HostEvent
        if ("id" in reply) {
          const pending = this.#pending.get(reply.id)
          if (!pending) return
          this.#pending.delete(reply.id)
          if (reply.ok) pending.resolve(reply.result)
          else pending.reject(new Error(reply.error))
          return
        }
        this.#onEvent(reply)
      })
    )
    const closed = () => {
      if (this.#socket !== socket) return
      this.#socket = undefined
      for (const pending of this.#pending.values())
        pending.reject(new Error("The pty-host connection closed."))
      this.#pending.clear()
      if (!this.#closing) this.#onClose()
    }
    socket.on("close", closed)
    socket.on("error", closed)
  }

  request<T = unknown>(request: HostRequest): Promise<T> {
    const socket = this.#socket
    if (!socket || socket.destroyed)
      return Promise.reject(new Error("The pty-host is not connected."))
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      socket.write(`${JSON.stringify({ ...request, id })}\n`)
    })
  }

  /** Send a request and do not wait; errors go to the log. */
  send(request: HostRequest) {
    void this.request(request).catch((error: unknown) => {
      if (!this.#closing)
        console.warn(`[pico] pty-host ${request.type} failed:`, error)
    })
  }

  /** Disconnect; the host and its ptys keep running. */
  close() {
    this.#closing = true
    this.#socket?.end()
    this.#socket = undefined
  }
}
