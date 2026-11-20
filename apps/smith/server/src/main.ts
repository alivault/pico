/**
 * `smith-server`: run, inspect, and stop the Smith server.
 *
 *   smith-server serve [--port 3141] [--host 127.0.0.1] [--data-dir ~/.smith] [--web-dir dir] [--detach]
 *     Terminals and jobs run in a pty-host process, so they survive a restart;
 *     `--no-pty-host` (or SMITH_NO_PTY_HOST=1) keeps them in the server.
 *   smith-server status [--json]
 *   smith-server stop [--wait] [--pty-host]
 *     `--pty-host` also stops the pty-host, so terminals and jobs end too.
 *   smith-server restart
 *     Stop at once and start again with the same options. Turns that the
 *     restart cuts off continue. (`--now` is accepted and ignored.)
 *   smith-server update [version] [--check] [--channel stable|preview] [--no-restart]
 *     Install the newest version on the update channel the way this copy
 *     was installed, and restart a running server (see services/self-update.ts).
 *   smith-server channel [show | set stable|preview]
 *   smith-server machine add|list|status|reconnect|rename|enable|disable|remove …
 *   smith-server agent list|start|send|show|wait|stop …   (see control/cli.ts)
 *   smith-server mcp      the MCP URL (see control/mcp.ts)
 *   smith-server move-project <old-path> <new-path>
 *     After a project folder moved, rewrite the stored paths and repair its
 *     worktrees (see services/data-migration.ts).
 *
 * The first `serve` on the default data directory moves an old `~/.pico`
 * to `~/.smith` (see services/data-migration.ts), before it opens the
 * database.
 *
 * Only one server may own a data directory: the durable database has no
 * locking across processes. A second `serve` finds the running server and
 * reports it instead of starting. When that server answers, the exit code
 * is 0, so a supervisor (a systemd unit with `Restart=on-failure`) does not
 * start `serve` again and again.
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
import { agentCommand, mcpCommand } from "./control/cli.ts"
import { machineCommand } from "./machines/cli.ts"
import { startServer, type SmithServer } from "./server.ts"
import { stopPtyHost } from "./pty-host/client.ts"
import {
  applyQueuedProjectMoves,
  finishLegacyMigration,
  legacyDataDirFor,
  legacyMigrationInProgress,
  logMoveResult,
  moveLegacyDataDir,
  moveProjectPaths,
  projectMoveResult,
} from "./services/data-migration.ts"
import {
  compareVersions,
  detectInstall,
  diskVersion,
  fetchLatest,
  installCommand,
  installVersion,
  isUpdateChannel,
  readUpdateConfig,
  UPDATE_CHANNELS,
  writeUpdateConfig,
} from "./services/self-update.ts"

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

/** Remove the lock file when this process still owns it. */
function lockReleaser(lockFile: string) {
  return () => {
    try {
      if (readFileSync(lockFile, "utf8").trim() === String(process.pid))
        unlinkSync(lockFile)
    } catch {
      // Already gone.
    }
  }
}

function dataLog(message: string) {
  console.log(`[smith] data: ${message}`)
}

/**
 * Stop a command that would make the default data directory while an old
 * `~/.pico` still waits for its move: the move happens only when no
 * `~/.smith` exists.
 */
function refuseBeforeLegacyMove(dataDir: string) {
  const legacy = legacyDataDirFor(dataDir)
  if (legacy)
    throw new Error(
      `Start Smith one time first (smith serve): it moves the old data in ${legacy} to ${dataDir}.`
    )
}

/**
 * Take the data directory's lock for a server. First move an old `~/.pico`
 * there when needed, and finish an interrupted move and the queued project
 * moves, before anything opens the database.
 */
async function takeDataDir(paths: ServerPaths): Promise<() => void> {
  const legacy = legacyDataDirFor(paths.dataDir)
  let release: () => void
  if (legacy) {
    dataLog(`moving the old Pico data directory ${legacy} to ${paths.dataDir}`)
    let releaseLegacy: () => void
    try {
      releaseLegacy = await acquireLock(serverPaths(legacy))
    } catch (error) {
      throw new Error(
        `Cannot move ${legacy} to ${paths.dataDir}: ${error instanceof Error ? error.message : String(error)} Stop the old Pico first (pico-app stop).`,
        { cause: error }
      )
    }
    try {
      await moveLegacyDataDir(legacy, paths.dataDir, dataLog)
    } catch (error) {
      releaseLegacy()
      throw error
    }
    // The lock file moved with the folder.
    release = lockReleaser(paths.lockFile)
  } else {
    release = await acquireLock(paths)
  }
  try {
    if (legacyMigrationInProgress(paths.dataDir))
      finishLegacyMigration(paths.dataDir, dataLog)
    applyQueuedProjectMoves(paths.dataDir, dataLog)
  } catch (error) {
    release()
    throw error
  }
  return release
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
      `Lock acquisition is already in progress. If no Smith process is running, move ${guard} to Trash and retry.`
    )
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(paths.lockFile, "wx")
        writeSync(fd, String(process.pid))
        closeSync(fd)
        return lockReleaser(paths.lockFile)
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
            `Smith is already running (pid ${owner})${where}. Stop it with \`smith-server stop\`.`
          )
        }
        // A crashed server left the lock; take it over.
        unlinkSync(paths.lockFile)
      }
    }
    throw new Error("Could not take the Smith data directory lock")
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
 * restart; undefined with `--no-pty-host`, `SMITH_NO_PTY_HOST=1`, or when
 * the program is missing (then they run in the server).
 */
function ptyHostOption(options: Map<string, string | boolean>) {
  if (options.get("no-pty-host") || process.env.SMITH_NO_PTY_HOST === "1")
    return undefined
  const script = fileURLToPath(new URL("./pty-host.mjs", import.meta.url))
  if (!existsSync(script)) {
    console.warn(
      `[smith] ${script} is missing: terminals run in the server and stop with it`
    )
    return undefined
  }
  return { script }
}

/**
 * The exit code that asks a launcher (`bin/smith.mjs`, `build.mjs --watch`)
 * to start the server again. The launchers have their own copy of it.
 */
const RESTART_EXIT_CODE = 75

/**
 * A launcher waits for this process (SMITH_SUPERVISED=1). Read it one time
 * and take it out of the environment: terminals, jobs, and the servers that
 * they start have no launcher, so they must not exit to one.
 */
const SUPERVISED = process.env.SMITH_SUPERVISED === "1"
delete process.env.SMITH_SUPERVISED

/**
 * Start this server again, after it closed and released its lock. A
 * launcher (SMITH_SUPERVISED=1) starts the new process, so that it stays in
 * the launcher's terminal. Without one, start it in the background like
 * `serve --detach`, with its output in `<data>/server.log`.
 */
function relaunch(paths: ServerPaths) {
  if (SUPERVISED) process.exit(RESTART_EXIT_CODE)
  const log = openSync(paths.logFile, "a")
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)],
    { detached: true, stdio: ["ignore", log, log], env: process.env }
  )
  closeSync(log)
  child.unref()
  console.log(
    `Smith continues in the background (pid ${child.pid}). Output: ${paths.logFile}`
  )
}

async function listen(
  paths: ServerPaths,
  host: string,
  port: number,
  searchPorts: boolean,
  onShutdownRequest: () => void,
  onRestartRequest: () => void,
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
        onRestartRequest,
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
      `Smith is already running at http://${running.host}:${running.port}`
    )
    return
  }
  // Before the server moves an old ~/.pico here, log into it: the open
  // file moves with the folder.
  const legacy = legacyDataDirFor(paths.dataDir)
  if (!legacy) mkdirSync(paths.dataDir, { recursive: true })
  const log = openSync(legacy ? join(legacy, "server.log") : paths.logFile, "a")
  const args = process.argv
    .slice(2)
    .filter((arg) => arg !== "--detach" && arg !== "--detach=true")
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1]!, ...args],
    {
      detached: true,
      stdio: ["ignore", log, log],
      // No launcher waits for this server: it starts itself again.
      env: { ...process.env, SMITH_SUPERVISED: undefined },
    }
  )
  closeSync(log)
  child.unref()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `Smith stopped with exit code ${child.exitCode}. See ${paths.logFile}`
      )
    const state = readState(paths)
    if (state && state.pid === child.pid && (await health(state))) {
      console.log(
        `Smith ${state.version} is running at http://${state.host}:${state.port}`
      )
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Smith did not start in time. See ${paths.logFile}`)
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
    options.get("host") ?? process.env.SMITH_HOST ?? "127.0.0.1"
  )
  const requestedPort = options.get("port") ?? process.env.SMITH_PORT
  const port = requestedPort ? Number(requestedPort) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port")
  const running = readState(paths)
  if (running && alive(running.pid) && (await health(running))) {
    console.log(
      `Smith is already running (pid ${running.pid}) at http://${running.host}:${running.port}`
    )
    return
  }
  const release = await takeDataDir(paths)
  let server: SmithServer
  let requestStop: (drain: boolean) => void = () => undefined
  let requestRestart: () => void = () => undefined
  try {
    server = await listen(
      paths,
      host,
      port,
      !requestedPort,
      () => requestStop(true),
      () => requestRestart(),
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
    `Smith ${VERSION} is running at http://${host === "0.0.0.0" ? "localhost" : host}:${server.port()}`
  )
  console.log(`Data: ${dataDir}${webDir ? `\nWeb: ${webDir}` : ""}`)

  let stopping = false
  // What happens after the stop. A stop request during a restart wins.
  // Only a stop drains (waits for active turns); a restart is at once.
  let restartAfter = false
  const stop = async (drain: boolean, restart = false) => {
    if (stopping) {
      if (!restart) restartAfter = false
      if (!drain) server.hurry()
      return
    }
    stopping = true
    restartAfter = restart
    const waits = drain && server.agents.activeTurnCount() > 0
    console.log(
      `Smith is ${restart ? "restarting" : "stopping"}${waits ? " after active turns finish" : ""}…`
    )
    // This timer also keeps the process alive until the stop ends. Without
    // it, a step below that waits only for an unref'd timer (or for nothing)
    // lets Node exit with code 0 before the relaunch, and a launcher then
    // does not start the server again.
    const limit = drain ? 11 * 60_000 : 15_000
    setTimeout(() => {
      console.error(
        `[smith] the ${restartAfter ? "restart" : "stop"} did not finish in ${limit / 1000} s: stopping at once`
      )
      release()
      if (restartAfter) relaunch(paths)
      process.exit(1)
    }, limit)
    try {
      await server.shutdown({ drain })
    } catch (error) {
      console.error("[smith] shutdown failed:", error)
    }
    release()
    if (restartAfter) relaunch(paths)
    process.exit(0)
  }
  requestStop = (drain) => void stop(drain)
  requestRestart = () => void stop(false, true)
  process.on("SIGINT", () => void stop(false))
  process.on("SIGTERM", () => void stop(false))
  process.on("SIGHUP", () => void stop(true))
}

/**
 * The server state as JSON. When Smith is not running, the exit code is 1;
 * with `--json`, stdout is then empty.
 */
async function status(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  const json = Boolean(options.get("json"))
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    if (json) console.error("Smith is not running.")
    else console.log("Smith is not running.")
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
  // `--pty-host`: also stop the terminals and jobs (see stopPtyHost).
  const stopHost = async () => {
    if (!options.get("pty-host")) return
    const pid = await stopPtyHost(paths.dataDir)
    console.log(
      pid ? `The pty-host (pid ${pid}) stopped.` : "No pty-host runs."
    )
  }
  if (!state || !alive(state.pid)) {
    console.log("Smith is not running.")
    await stopHost()
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
  if (!options.get("wait") && !options.get("pty-host")) {
    console.log("Smith is stopping.")
    return
  }
  while (alive(state.pid))
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  console.log("Smith stopped.")
  await stopHost()
}

/**
 * `smith-server restart`: ask the server to restart at once, and wait until
 * the new process answers. `--now` is accepted and ignored: a restart
 * never waits for active turns.
 */
async function restartCommand(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    console.log("Smith is not running. Start it with `smith serve`.")
    process.exitCode = 1
    return
  }
  const host =
    state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host
  const response = await fetch(
    `http://${host}:${state.port}/api/system/restart`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      // An older server waits for active turns without `now`.
      body: JSON.stringify({ now: true }),
    }
  )
  const result = (await response.json().catch(() => ({}))) as {
    error?: string
  }
  if (!response.ok)
    throw new Error(result.error ?? `Restart failed: ${response.status}`)
  console.log("Smith is restarting…")
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    const next = readState(paths)
    if (!next || next.pid === state.pid || !alive(next.pid)) continue
    if (await health(next)) {
      console.log(
        `Smith ${next.version} is running at http://${next.host}:${next.port}`
      )
      return
    }
  }
  // A launcher (`smith serve`, `pnpm start`) and a server in the
  // background both write the server's output to the log file.
  throw new Error(
    `Smith did not start again in time. ${
      alive(state.pid)
        ? `The old server (pid ${state.pid}) still runs.`
        : `The old server (pid ${state.pid}) stopped, and no new server answers.`
    } See ${paths.logFile}`
  )
}

/**
 * `smith-server update`: install the newest version on the channel, then
 * restart a running server so that it runs it.
 */
async function updateCommand(
  argv: string[],
  options: Map<string, string | boolean>
) {
  const dataDir = dataDirOption(options)
  const channelOption = options.get("channel")
  if (channelOption !== undefined && !isUpdateChannel(channelOption))
    throw new Error("--channel must be stable or preview")
  const channel = isUpdateChannel(channelOption)
    ? channelOption
    : readUpdateConfig(dataDir).channel
  const install = detectInstall()
  const installed = diskVersion(install.root) ?? VERSION
  const wanted = positional(argv, ["channel", "data-dir"])[0]
  let target: string
  if (typeof wanted === "string") target = wanted.replace(/^v/, "")
  else {
    console.log(`Looking for the newest ${channel} version…`)
    target = await fetchLatest(channel)
  }
  const newer = compareVersions(target, installed) > 0
  if (typeof wanted !== "string" && !newer) {
    console.log(`Smith ${installed} is up to date (${channel} channel).`)
    return
  }
  if (options.get("check")) {
    console.log(
      `Smith ${target} is available (${channel} channel); ${installed} is installed. Run \`smith update\` to install it.`
    )
    return
  }
  if (install.kind !== "npm") {
    console.log(
      install.kind === "source"
        ? `This Smith runs from a source checkout (${install.root}). Update it with:\n  ${installCommand(install, target)}`
        : `Smith cannot update this install (${install.root}) by itself. Run:\n  ${installCommand(install, target)}`
    )
    process.exitCode = 1
    return
  }
  console.log(`Installing Smith ${target} into ${install.prefix}…`)
  await installVersion(install, target, {
    onOutput: (chunk) => process.stdout.write(chunk),
  })
  console.log(`Smith ${target} is installed.`)
  console.log(
    `Release notes: https://github.com/alivault/smith/releases/tag/v${target}`
  )
  const paths = serverPaths(dataDir)
  const state = readState(paths)
  if (!state || !alive(state.pid)) {
    console.log("Smith is not running. Start it with `smith serve --detach`.")
    return
  }
  if (options.get("no-restart")) {
    console.log("Run `smith restart` to load it.")
    return
  }
  await restartCommand(options)
}

/** The words that are not options or option values. */
function positional(argv: string[], valueOptions: string[]) {
  return argv.filter(
    (arg, index) =>
      !arg.startsWith("--") &&
      !valueOptions.some((name) => argv[index - 1] === `--${name}`)
  )
}

/** `smith-server channel [show | set stable|preview]`. */
function channelCommand(
  argv: string[],
  options: Map<string, string | boolean>
) {
  const dataDir = dataDirOption(options)
  const [action = "show", value] = positional(argv, ["data-dir"])
  if (action === "show") {
    console.log(readUpdateConfig(dataDir).channel)
    return
  }
  if (action === "set" && isUpdateChannel(value)) {
    writeUpdateConfig(dataDir, { channel: value })
    console.log(
      `The update channel is ${value}. Run \`smith update\` to install its newest version.`
    )
    return
  }
  console.error(
    `Usage: smith channel [show | set ${UPDATE_CHANNELS.join("|")}]`
  )
  process.exitCode = 2
}

/**
 * `smith-server move-project <old-path> <new-path>`: after the user moved a
 * project folder, rewrite the stored paths (agent and project cwd values,
 * sidebar, settings) and repair the project's worktrees in the data
 * directory. A running server applies it in a restart, before it opens
 * the database; else this process does it with the lock.
 */
async function moveProjectCommand(
  argv: string[],
  options: Map<string, string | boolean>
) {
  const [fromArg, toArg] = positional(argv, ["data-dir"])
  if (!fromArg || !toArg) {
    console.error("Usage: smith move-project <old-path> <new-path>")
    process.exitCode = 2
    return
  }
  const expand = (path: string) =>
    resolve(path.replace(/^~(?=$|\/)/, homedir()))
  const from = expand(fromArg)
  const to = expand(toArg)
  if (from === to) throw new Error("The old and the new path are the same.")
  if (!existsSync(to))
    throw new Error(`${to} does not exist. Move the folder first.`)
  const paths = serverPaths(dataDirOption(options))
  refuseBeforeLegacyMove(paths.dataDir)
  const state = readState(paths)
  if (state && alive(state.pid) && (await health(state))) {
    const host =
      state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host
    const response = await fetch(
      `http://${host}:${state.port}/api/system/move-project`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      }
    )
    const result = (await response.json().catch(() => ({}))) as {
      id?: string
      error?: string
    }
    if (!response.ok || !result.id)
      throw new Error(result.error ?? `Move failed: ${response.status}`)
    console.log("Smith restarts to rewrite the paths…")
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
      const moved = projectMoveResult(paths.dataDir, result.id)
      const next = readState(paths)
      if (
        moved &&
        next &&
        next.pid !== state.pid &&
        alive(next.pid) &&
        (await health(next))
      ) {
        logMoveResult(moved, (line) => console.log(line))
        return
      }
    }
    throw new Error(
      `Smith did not finish the move in time. See ${paths.logFile}`
    )
  }
  const release = await acquireLock(paths)
  try {
    logMoveResult(moveProjectPaths(paths.dataDir, from, to), (line) =>
      console.log(line)
    )
  } finally {
    release()
  }
}

async function importCommand(options: Map<string, string | boolean>) {
  const paths = serverPaths(dataDirOption(options))
  refuseBeforeLegacyMove(paths.dataDir)
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
          join(backup, "smith.sqlite" + suffix)
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
    const hubDir =
      hubIndex >= 0 && argv[hubIndex + 1]
        ? resolve(argv[hubIndex + 1]!)
        : defaultDataDir()
    refuseBeforeLegacyMove(hubDir)
    await machineCommand(argv.slice(1), hubDir)
    return
  }
  const { command, options } = parseArgs(argv)
  if (command === "agent") {
    process.exitCode = await agentCommand(argv.slice(1), dataDirOption(options))
    return
  }
  if (command === "mcp") {
    process.exitCode = mcpCommand(argv.slice(1), dataDirOption(options))
    return
  }
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
    case "restart":
      await restartCommand(options)
      break
    case "update":
      await updateCommand(argv.slice(1), options)
      break
    case "channel":
      refuseBeforeLegacyMove(dataDirOption(options))
      channelCommand(argv.slice(1), options)
      break
    case "move-project":
      await moveProjectCommand(argv.slice(1), options)
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.error(
        "Usage: smith-server serve|status|stop|restart|update|channel|import-pi|move-project|machine|agent|mcp [--port N] [--host H] [--data-dir D] [--web-dir D] [--source-dir D] [--detach] [--json]"
      )
      process.exitCode = 2
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
