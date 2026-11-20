#!/usr/bin/env node
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
// `agent` and `mcp` have their own help, and take any text as a message.
const ownArgs = ["agent", "mcp"].includes(args[0])
if (!ownArgs && args.includes("--help")) {
  console.log(`Smith — durable Pi sessions in your browser
Usage: smith [serve|status|stop|restart|import-pi] [--port N] [--host H]
             [--data-dir D] [--web-dir D] [--open|--no-open] [--wait]
             [--source-dir D] [--detach] [--json] [--no-pty-host]
             [--pty-host]
       smith update [version] [--check] [--channel stable|preview]
             [--no-restart]
       smith channel [show | set stable|preview]
       smith machine add|list|status|reconnect|rename|enable|disable|remove
       smith agent list|start|send|show|wait|stop
       smith mcp
       smith move-project <old-path> <new-path>
The default address is 127.0.0.1:3141. Data is stored in ~/.smith.
Use a separate --data-dir for development. Smith was called Pico: the first
start moves ~/.pico to ~/.smith.
serve --detach starts Smith in the background. The server output also goes
to <data>/server.log.
restart stops Smith at once and starts it again with the same options, for
example after an update. Turns that a restart cuts off continue.
update installs the newest version on the update channel (stable, or
preview for prereleases) where Smith is installed, and restarts Smith;
update --check only looks. Smith also looks in the background and shows a
new version in Settings, Server.
status --json prints the server state as JSON; the exit code is 1 when Smith is
not running.
Terminals and jobs run in a pty-host process and survive a restart;
serve --no-pty-host keeps them in the server, and stop --pty-host ends them.
Import old Pi sessions with import-pi while Smith is stopped.
Show sessions of other machines over SSH with smith machine add <target>.
Run smith machine help for details.
Control agents from a shell or a script with smith agent; run
smith agent help for details. smith mcp prints the address of Smith's
MCP server, for Claude Code, Codex, and other MCP clients.
After you move a project folder, run smith move-project <old-path>
<new-path>: it rewrites the paths that Smith stored and repairs the
project's worktrees.`)
  process.exit(0)
}
if (!ownArgs && args.includes("--version")) {
  console.log(pkg.version)
  process.exit(0)
}
const [major, minor] = process.versions.node.split(".").map(Number)
if (major < 22 || (major === 22 && minor < 19))
  throw new Error("Smith requires Node.js 22.19 or later")
const command = args[0] && !args[0].startsWith("-") ? args.shift() : "serve"
// Open a browser only for a person who starts Smith, not for a service
// manager: systemd sets INVOCATION_ID, and a unit that starts again after a
// failure would open a new tab each time.
const open =
  !args.includes("--no-open") &&
  !args.includes("--detach") &&
  process.env.SMITH_OPEN !== "0" &&
  !process.env.INVOCATION_ID &&
  command === "serve"
const forwarded = args.filter((arg) => !["--open", "--no-open"].includes(arg))
const expandHome = (path) => path?.replace(/^~(?=$|\/)/, homedir())
// For `machine`, --data-dir is the remote data directory; --hub-dir is ours.
const dataFlag = command === "machine" ? "--hub-dir" : "--data-dir"
const dataIndex = forwarded.indexOf(dataFlag)
const inlineData = forwarded
  .find((arg) => arg.startsWith(`${dataFlag}=`))
  ?.slice(dataFlag.length + 1)
const dataDir = resolve(
  expandHome(
    inlineData ??
      (dataIndex >= 0 ? forwarded[dataIndex + 1] : undefined) ??
      process.env.SMITH_DATA_DIR ??
      join(homedir(), ".smith")
  )
)
// `agent` takes text after `--`, so its data option goes first.
if (dataIndex < 0 && !inlineData) {
  if (command === "agent" || command === "mcp")
    forwarded.unshift(dataFlag, dataDir)
  else forwarded.push(dataFlag, dataDir)
}
if (
  command === "serve" &&
  !forwarded.some((arg) => arg.startsWith("--web-dir"))
) {
  forwarded.push(
    "--web-dir",
    process.env.SMITH_WEB_DIR ?? join(root, ".output/public")
  )
}
// A server that asks for a restart exits with this code, and this launcher
// starts it again (the same code is in server/src/main.ts).
const RESTART_EXIT_CODE = 75
const supervise = command === "serve" && !forwarded.includes("--detach")
// The server's output also goes to this file, as for a server in the
// background, so that `smith restart` can point to it when the server
// does not come back.
const logFile = join(dataDir, "server.log")
// The server moves an old ~/.pico to ~/.smith on its first start (see
// server/src/services/data-migration.ts). Until then, log into the old
// folder, and do not make ~/.smith: the move happens only when it is
// missing.
const legacyDir = join(homedir(), ".pico")
const moving =
  dataDir === join(homedir(), ".smith") &&
  !existsSync(dataDir) &&
  existsSync(legacyDir)
function writeLog(text) {
  try {
    appendFileSync(
      moving && !existsSync(dataDir) ? join(legacyDir, "server.log") : logFile,
      text
    )
  } catch {
    /* The terminal still shows it. */
  }
}
function note(text) {
  console.error(`[smith] ${text}`)
  writeLog(`[smith] ${new Date().toISOString()} ${text}\n`)
}
if (supervise) {
  if (!moving) mkdirSync(dataDir, { recursive: true })
  // A closed terminal must not stop the copy of the output.
  process.stdout.on("error", () => undefined)
  process.stderr.on("error", () => undefined)
}
// A server that fails at once after a restart (for example while a build
// rewrites server/dist) starts again, a few times.
const RETRY_MS = 10_000
const MAX_RETRIES = 3
let retries = 0
let stopSignal
let child
function startChild(afterRestart = false) {
  const startedAt = Date.now()
  child = spawn(
    process.execPath,
    [
      "--enable-source-maps",
      join(root, "server/dist/smith-server.mjs"),
      command,
      ...forwarded,
    ],
    {
      stdio: supervise ? ["inherit", "pipe", "pipe"] : "inherit",
      env: supervise ? { ...process.env, SMITH_SUPERVISED: "1" } : process.env,
    }
  )
  if (supervise) {
    writeLog(
      `[smith] ${new Date().toISOString()} ${afterRestart ? "restart" : "start"}: server pid ${child.pid}\n`
    )
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk)
      writeLog(chunk)
    })
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk)
      writeLog(chunk)
    })
  }
  child.on("error", (error) => {
    if (supervise) note(`could not start the server: ${error.message}`)
    else console.error(error.message)
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    if (supervise && code === RESTART_EXIT_CODE && !stopSignal) {
      retries = 0
      startChild(true)
      return
    }
    process.exitCode = code ?? 1
    if (!supervise || stopSignal || code === 0) return
    const how = signal ? `signal ${signal}` : `exit code ${code}`
    if (
      afterRestart &&
      Date.now() - startedAt < RETRY_MS &&
      retries < MAX_RETRIES
    ) {
      retries += 1
      note(
        `the server stopped with ${how} after a restart; starting it again (${retries}/${MAX_RETRIES})`
      )
      setTimeout(() => {
        if (!stopSignal) startChild(true)
      }, 1000)
      return
    }
    note(`the server stopped with ${how}. Output: ${logFile}`)
  })
}
startChild()
// The terminal sends these to the server too. Forward them, and wait for
// the server: SIGHUP drains active turns first.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    stopSignal = signal
    child.kill(signal)
  })
if (open) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    // Open our own server. When another server already runs, the child
    // reports it and exits with code 0; open that server one time. Until
    // the child has started, server.json can still name an older server.
    const exited = child.exitCode !== null
    if (exited && child.exitCode !== 0) break
    try {
      const state = JSON.parse(
        readFileSync(join(dataDir, "server.json"), "utf8")
      )
      if (!exited && state.pid !== child.pid) throw new Error("not ours yet")
      const host = ["0.0.0.0", "::"].includes(state.host)
        ? "localhost"
        : state.host
      const url = `http://${host.includes(":") ? `[${host}]` : host}:${state.port}`
      const response = await fetch(`${url}/api/system/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) {
        const [exe, options] =
          process.platform === "darwin"
            ? ["open", [url]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]]
        const browser = spawn(exe, options, { stdio: "ignore", detached: true })
        browser.on("error", () => console.log(`Open ${url} in your browser.`))
        browser.unref()
        break
      }
    } catch {
      /* Wait for the server. */
    }
    if (exited) break
    await new Promise((done) => setTimeout(done, 250))
  }
}
