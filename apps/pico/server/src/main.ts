/**
 * `pico-server`: run, inspect, and stop the Pico server.
 *
 *   pico-server serve [--port 3141] [--host 127.0.0.1] [--data-dir ~/.pico] [--web-dir dir] [--detach]
 *     Terminals and jobs run in a pty-host process, so they survive a restart;
 *     `--no-pty-host` (or PICO_NO_PTY_HOST=1) keeps them in the server.
 *   pico-server status [--json]
 *   pico-server stop [--wait]
 *   pico-server machine add|list|status|reconnect|rename|enable|disable|remove …
 *
 * Only one server may own a data directory: the durable database has no
 * locking across processes. A second `serve` finds the running server and
 * reports it instead of starting.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { spawn } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { Harness, createRegistry } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { importPiSessions } from "./core/import-pi.ts"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_PORT,
  defaultDataDir,
  serverPaths,
  VERSION,
  type ServerPaths,
} from "./config.ts"
import { machineCommand } from "./machines/cli.ts"
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

/** The data directory option; a leading `~` is the home directory. */
function dataDirOption(options: Map<string, string | boolean>) {
  const value = options.get("data-dir")
  return resolve(
    typeof value === "string"
      ? value.replace(/^~(?=$|\/)/, homedir())
      : defaultDataDir()
  )
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

/**
 * The pty-host program next to this one, so terminals and jobs survive a
 * restart; undefined with `--no-pty-host`, `PICO_NO_PTY_HOST=1`, or when
 * the program is missing (then they run in the server).
 */
function ptyHostOption(options: Map<string, string | boolean>) {
  if (options.get("no-pty-host") || process.env.PICO_NO_PTY_HOST === "1")
    return undefined
  const script = fileURLToPath(new URL("./pty-host.mjs", import.meta.url))
  if (!existsSync(script)) {
    console.warn(
      `[pico] ${script} is missing: terminals run in the server and stop with it`
    )
    return undefined
  }
  return { script }
}

async function listen(
  paths: ServerPaths,
  host: string,
  port: number,
  searchPorts: boolean,
  onShutdownRequest: () => void,
  ptyHost?: { script: string }
) {
  let lastError: unknown
  for (let offset = 0; offset < (searchPorts ? 20 : 1); offset += 1) {
    try {
      return await startServer({
        paths,
        host,
        port: port + offset,
        onShutdownRequest,
        ...(ptyHost ? { ptyHost } : {}),
      })
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    }
  }
  throw lastError
}

/**
 * `serve --detach`: start the server in the background with its output in
 * `<data>/server.log`, and return when it is healthy.
 */
async function serveDetached(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  const running = readState(paths)
  if (running && alive(running.pid) && (await health(running))) {
    console.log(
      `Pico is already running at http://${running.host}:${running.port}`
    )
    return
  }
  mkdirSync(paths.dataDir, { recursive: true })
  const log = openSync(paths.logFile, "a")
  const args = process.argv
    .slice(2)
    .filter((arg) => arg !== "--detach" && arg !== "--detach=true")
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1]!, ...args],
    { detached: true, stdio: ["ignore", log, log], env: process.env }
  )
  closeSync(log)
  child.unref()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `Pico stopped with exit code ${child.exitCode}. See ${paths.logFile}`
      )
    const state = readState(paths)
    if (state && state.pid === child.pid && (await health(state))) {
      console.log(
        `Pico ${state.version} is running at http://${state.host}:${state.port}`
      )
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Pico did not start in time. See ${paths.logFile}`)
}

async function serve(options: Map<string, string | boolean>) {
  if (options.get("detach")) return serveDetached(options)
  const dataDir = dataDirOption(options)
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
    server = await listen(
      paths,
      host,
      port,
      !requestedPort,
      () => requestStop(true),
      ptyHostOption(options)
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

/**
 * The server state as JSON. When Pico is not running, the exit code is 1;
 * with `--json`, stdout is then empty.
 */
async function status(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  const json = Boolean(options.get("json"))
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    if (json) console.error("Pico is not running.")
    else console.log("Pico is not running.")
    process.exitCode = 1
    return
  }
  const result = await health(state)
  console.log(
    JSON.stringify(
      { ...state, health: result ?? "unreachable" },
      null,
      json ? undefined : 2
    )
  )
}

async function stopCommand(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    console.log("Pico is not running.")
    return
  }
  const host =
    state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host
  await fetch(`http://${host}:${state.port}/api/system/shutdown`, {
    method: "POST",
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

async function importCommand(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  const source = resolve(
    String(
      options.get("source-dir") ?? join(homedir(), ".pi", "agent", "sessions")
    )
  )
  const release = await acquireLock(paths)
  let harness: Harness | undefined
  try {
    const backup = join(
      paths.dataDir,
      "backups",
      `before-pi-import-${new Date().toISOString().replace(/[:.]/g, "-")}`
    )
    mkdirSync(backup, { recursive: true })
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(paths.database + suffix))
        copyFileSync(
          paths.database + suffix,
          join(backup, "pico.sqlite" + suffix)
        )
    }
    console.log(`Database backup: ${backup}`)
    harness = await Harness.open(
      await openNodeSqliteStorage(paths.database),
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT
    )
    const result = await importPiSessions(harness, source)
    const report = join(backup, "import-report.json")
    writeFileSync(report, JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ ...result, report }, null, 2))
    if (result.failures.length) process.exitCode = 1
  } finally {
    try {
      await harness?.close(BACKGROUND_CONTEXT)
    } finally {
      release()
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === "machine") {
    const hubIndex = argv.indexOf("--hub-dir")
    await machineCommand(
      argv.slice(1),
      hubIndex >= 0 && argv[hubIndex + 1]
        ? resolve(argv[hubIndex + 1]!)
        : defaultDataDir()
    )
    return
  }
  const { command, options } = parseArgs(argv)
  if (options.get("version") || command === "--version") {
    console.log(VERSION)
    return
  }
  switch (command) {
    case "serve":
      await serve(options)
      break
    case "import-pi":
      await importCommand(options)
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
        "Usage: pico-server serve|status|stop|import-pi|machine [--port N] [--host H] [--data-dir D] [--web-dir D] [--source-dir D] [--detach] [--json]"
      )
      process.exitCode = 2
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
