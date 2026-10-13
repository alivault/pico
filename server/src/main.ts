/**
 * `pico-server`: run, inspect, and stop the Pico server.
 *
 *   pico-server serve [--port 3141] [--host 127.0.0.1] [--data-dir ~/.pico] [--web-dir dir]
 *   pico-server status
 *   pico-server stop [--wait]
 *
 * Only one server may own a data directory: the durable database has no
 * locking across processes. A second `serve` finds the running server and
 * reports it instead of starting.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_PORT,
  defaultDataDir,
  serverPaths,
  VERSION,
  type ServerPaths,
} from "./config.ts"
import { startServer, type PicoServer } from "./server.ts"

type ServerState = {
  pid: number
  port: number
  host: string
  version: string
  startedAt: string
}

function parseArgs(argv: string[]) {
  const [command = "serve", ...rest] = argv
  const options = new Map<string, string | boolean>()
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!
    if (!arg.startsWith("--")) continue
    const [key, inline] = arg.slice(2).split("=", 2) as [
      string,
      string | undefined,
    ]
    if (inline !== undefined) options.set(key, inline)
    else if (rest[index + 1] && !rest[index + 1]!.startsWith("--"))
      options.set(key, rest[++index]!)
    else options.set(key, true)
  }
  return { command, options }
}

function readState(paths: ServerPaths): ServerState | undefined {
  try {
    return JSON.parse(readFileSync(paths.stateFile, "utf8")) as ServerState
  } catch {
    return undefined
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function health(state: ServerState) {
  const host =
    state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host
  try {
    const response = await fetch(
      `http://${host}:${state.port}/api/system/health`,
      {
        signal: AbortSignal.timeout(2000),
        headers: process.env.PICO_TOKEN
          ? { authorization: `Bearer ${process.env.PICO_TOKEN}` }
          : {},
      }
    )
    return response.ok
      ? ((await response.json()) as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Take the data directory's lock, or report the server that holds it. */
async function acquireLock(paths: ServerPaths): Promise<() => void> {
  mkdirSync(paths.dataDir, { recursive: true })
  // Serialize lock creation and stale-owner takeover. Without this guard,
  // two starting processes could both remove the same stale PID file.
  const guard = `${paths.lockFile}.guard`
  try {
    mkdirSync(guard)
  } catch {
    throw new Error(
      `Lock acquisition is already in progress. If no Pico process is running, move ${guard} to Trash and retry.`
    )
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(paths.lockFile, "wx")
        writeSync(fd, String(process.pid))
        closeSync(fd)
        return () => {
          try {
            if (
              readFileSync(paths.lockFile, "utf8").trim() ===
              String(process.pid)
            )
              unlinkSync(paths.lockFile)
          } catch {
            // Already gone.
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const owner = Number(readFileSync(paths.lockFile, "utf8").trim())
        if (!Number.isInteger(owner) || owner <= 0) {
          throw new Error(
            `Invalid lock file: ${paths.lockFile}. Refusing to open storage.`
          )
        }
        if (alive(owner)) {
          const state = readState(paths)
          const where = state ? ` at http://${state.host}:${state.port}` : ""
          throw new Error(
            `Pico is already running (pid ${owner})${where}. Stop it with \`pico-server stop\`.`
          )
        }
        // A crashed server left the lock; take it over.
        unlinkSync(paths.lockFile)
      }
    }
    throw new Error("Could not take the Pico data directory lock")
  } finally {
    rmdirSync(guard)
  }
}

function defaultWebDir() {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "..", "..", ".output", "public")
}

async function listen(
  paths: ServerPaths,
  host: string,
  port: number,
  searchPorts: boolean,
  onShutdownRequest: () => void
) {
  let lastError: unknown
  for (let offset = 0; offset < (searchPorts ? 20 : 1); offset += 1) {
    try {
      return await startServer({
        paths,
        host,
        port: port + offset,
        onShutdownRequest,
      })
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    }
  }
  throw lastError
}

async function serve(options: Map<string, string | boolean>) {
  const dataDir = resolve(String(options.get("data-dir") ?? defaultDataDir()))
  const webOption = options.get("web-dir")
  const webDir =
    webOption === false || webOption === "none"
      ? undefined
      : resolve(String(webOption ?? defaultWebDir()))
  const paths = serverPaths(dataDir, webDir)
  const host = String(
    options.get("host") ?? process.env.PICO_HOST ?? "127.0.0.1"
  )
  const requestedPort = options.get("port") ?? process.env.PICO_PORT
  const port = requestedPort ? Number(requestedPort) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port")
  const release = await acquireLock(paths)
  let server: PicoServer
  let requestStop: (drain: boolean) => void = () => undefined
  try {
    server = await listen(paths, host, port, !requestedPort, () =>
      requestStop(true)
    )
  } catch (error) {
    release()
    throw error
  }
  const state: ServerState = {
    pid: process.pid,
    port: server.port(),
    host,
    version: VERSION,
    startedAt: new Date().toISOString(),
  }
  writeFileSync(paths.stateFile, JSON.stringify(state, null, 2))
  console.log(
    `Pico ${VERSION} is running at http://${host === "0.0.0.0" ? "localhost" : host}:${server.port()}`
  )
  console.log(`Data: ${dataDir}${webDir ? `\nWeb: ${webDir}` : ""}`)

  let stopping = false
  const stop = async (drain: boolean) => {
    if (stopping) return
    stopping = true
    console.log(
      drain ? "Pico is stopping after active runs finish…" : "Pico is stopping…"
    )
    const force = setTimeout(
      () => process.exit(1),
      drain ? 11 * 60_000 : 15_000
    )
    force.unref()
    try {
      await server.shutdown({ drain })
    } catch (error) {
      console.error("[pico] shutdown failed:", error)
    }
    release()
    process.exit(0)
  }
  requestStop = (drain) => void stop(drain)
  process.on("SIGINT", () => void stop(false))
  process.on("SIGTERM", () => void stop(false))
  process.on("SIGHUP", () => void stop(true))
}

async function status(options: Map<string, string | boolean>) {
  const paths = serverPaths(
    resolve(String(options.get("data-dir") ?? defaultDataDir()))
  )
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    console.log("Pico is not running.")
    process.exitCode = 1
    return
  }
  const result = await health(state)
  console.log(
    JSON.stringify({ ...state, health: result ?? "unreachable" }, null, 2)
  )
}

async function stopCommand(options: Map<string, string | boolean>) {
  const paths = serverPaths(
    resolve(String(options.get("data-dir") ?? defaultDataDir()))
  )
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    console.log("Pico is not running.")
    return
  }
  const host =
    state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host
  await fetch(`http://${host}:${state.port}/api/system/shutdown`, {
    method: "POST",
    headers: process.env.PICO_TOKEN
      ? { authorization: `Bearer ${process.env.PICO_TOKEN}` }
      : {},
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Shutdown failed: ${response.status}`)
    })
    .catch(() => {
      process.kill(state.pid, "SIGTERM")
    })
  if (!options.get("wait")) {
    console.log("Pico is stopping.")
    return
  }
  while (alive(state.pid))
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  console.log("Pico stopped.")
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (options.get("version") || command === "--version") {
    console.log(VERSION)
    return
  }
  switch (command) {
    case "serve":
      await serve(options)
      break
    case "status":
      await status(options)
      break
    case "stop":
      await stopCommand(options)
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.error(
        "Usage: pico-server serve|status|stop [--port N] [--host H] [--data-dir D] [--web-dir D]"
      )
      process.exitCode = 2
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
