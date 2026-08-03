#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const uid = process.getuid?.()
if (process.platform !== "darwin" || uid === undefined) {
  throw new Error("The Pico dogfood server lifecycle currently requires macOS")
}

const label = "com.alivault.pico.development.server"
const launchTarget = `gui/${uid}/${label}`
const dataDir =
  process.env.PICO_DOGFOOD_DATA_DIR ??
  join(homedir(), "Library", "Application Support", "Pico Development")
const sessionDir = join(dataDir, "sessions")
const logDir = join(dataDir, "logs")
const binDir = join(dataDir, "bin")
const launchAgentPath = join(dataDir, `${label}.plist`)
const candidateServer = join(root, "target", "debug", "pico-server")
const candidateBridge = join(root, "target", "pico-pi-bridge")
const deployedServer = join(binDir, "pico-server")
const deployedBridge = join(binDir, "pico-pi-bridge")
const port = process.env.PICO_DOGFOOD_SERVER_PORT ?? "4142"
const agentDir =
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")
const stableDataDir = join(homedir(), "Library", "Application Support", "Pico")

function canonicalPath(path) {
  return existsSync(path) ? realpathSync(path) : resolve(path)
}

if (canonicalPath(dataDir) === canonicalPath(stableDataDir)) {
  throw new Error(
    "PICO_DOGFOOD_DATA_DIR cannot be Pico's stable application support directory"
  )
}
if (Number(port) === 3141) {
  throw new Error("PICO_DOGFOOD_SERVER_PORT cannot use Pico's stable port 3141")
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: process.env,
  })
  if (result.error) throw result.error
  if (!options.allowFailure && result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`
    )
  }
  return result
}

function ensureDirectories() {
  for (const directory of [dataDir, sessionDir, logDir, binDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
  }
}

function resolvePiBinary() {
  const explicit = process.env.PICO_DOGFOOD_PI_BIN
  if (explicit) return explicit
  const packaged = join(
    "/Applications",
    "Pico.app",
    "Contents",
    "Resources",
    "PicoServer",
    "pi"
  )
  if (existsSync(packaged)) return packaged
  const found = run("/usr/bin/which", ["pi"], {
    capture: true,
    allowFailure: true,
  }).stdout.trim()
  if (found) return found
  throw new Error(
    "Standalone Pi was not found; install Pico.app or set PICO_DOGFOOD_PI_BIN"
  )
}

function buildCandidates() {
  run("cargo", ["build", "-p", "pico-server"])
  run("pnpm", ["build:pi-bridge"])
  if (!existsSync(candidateServer) || !existsSync(candidateBridge)) {
    throw new Error("Dogfood server build did not produce both native binaries")
  }
}

function deployFile(source, destination) {
  const temporary = `${destination}.next-${process.pid}`
  copyFileSync(source, temporary)
  chmodSync(temporary, 0o755)
  renameSync(temporary, destination)
}

function deployCandidates() {
  deployFile(candidateServer, deployedServer)
  deployFile(candidateBridge, deployedBridge)
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function plistArray(values) {
  return values
    .map((value) => `      <string>${xmlEscape(value)}</string>`)
    .join("\n")
}

function writeLaunchAgent() {
  const piBinary = resolvePiBinary()
  const path = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"
  const programArguments = [
    deployedServer,
    "serve",
    "--port",
    port,
    "--data-dir",
    dataDir,
    "--agent-dir",
    agentDir,
    "--session-dir",
    sessionDir,
    "--pi-bin",
    piBinary,
    "--pi-bridge-bin",
    deployedBridge,
  ]
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${plistArray(programArguments)}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(homedir())}</string>
    <key>PATH</key>
    <string>${xmlEscape(path)}</string>
    <key>PI_CODING_AGENT_DIR</key>
    <string>${xmlEscape(agentDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(logDir, "launchd.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(logDir, "launchd.err.log"))}</string>
</dict>
</plist>
`
  writeFileSync(launchAgentPath, plist, { mode: 0o600 })
  chmodSync(launchAgentPath, 0o600)
}

function launchState() {
  return run("/bin/launchctl", ["print", launchTarget], {
    capture: true,
    allowFailure: true,
  })
}

function launchPid() {
  const state = launchState()
  if (state.status !== 0) return undefined
  const match = state.stdout.match(/^\s*pid = (\d+)\s*$/m)
  return match ? Number(match[1]) : undefined
}

function controlStatus(binary = deployedServer) {
  if (!existsSync(binary)) return undefined
  const result = run(binary, ["status", "--data-dir", dataDir], {
    capture: true,
    allowFailure: true,
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function drainRunningServer() {
  const status = controlStatus()
  if (status) {
    console.log("Draining the current Pico development server…")
    run(deployedServer, ["stop", "--data-dir", dataDir, "--wait"])
    return
  }
  const pid = launchPid()
  if (pid !== undefined) {
    throw new Error(
      `Development server process ${pid} is running without a compatible control socket; refusing to terminate it`
    )
  }
}

function unloadLaunchAgent() {
  if (launchState().status === 0) {
    run("/bin/launchctl", ["bootout", launchTarget])
  }
}

function start() {
  ensureDirectories()
  buildCandidates()
  drainRunningServer()
  unloadLaunchAgent()
  deployCandidates()
  writeLaunchAgent()
  run("/bin/launchctl", ["bootstrap", `gui/${uid}`, launchAgentPath])
  const status = waitForStatus()
  console.log(status)
  console.log(`Pico development server: http://127.0.0.1:${port}`)
  console.log(`Data: ${dataDir}`)
  console.log(`Sessions: ${sessionDir}`)
}

function waitForStatus() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const status = controlStatus()
    if (status) {
      try {
        const response = JSON.parse(status)
        if (response.status?.phase === "running") return status
      } catch {
        // A complete control response will be retried on the next interval.
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  const stderrPath = join(logDir, "launchd.err.log")
  const details = existsSync(stderrPath)
    ? `\n${readFileSync(stderrPath, "utf8").slice(-4000)}`
    : ""
  throw new Error(`Development server did not become ready${details}`)
}

function stop() {
  ensureDirectories()
  drainRunningServer()
  unloadLaunchAgent()
  console.log("Pico development server stopped")
}

function status() {
  const control = controlStatus()
  if (control) console.log(control)
  else console.log("Pico development server control socket is unavailable")
  const state = launchState()
  if (state.status === 0) {
    const summary = state.stdout
      .split("\n")
      .filter((line) => /^\s*(state|pid|last exit code) = /.test(line))
      .join("\n")
    if (summary) console.log(summary)
  } else {
    console.log("Development launch agent is not loaded")
  }
}

function network(args) {
  ensureDirectories()
  let binary = existsSync(deployedServer) ? deployedServer : candidateServer
  if (!existsSync(binary)) {
    run("cargo", ["build", "-p", "pico-server"])
    binary = candidateServer
  }
  const mode = args[0] ?? "status"
  if (mode === "status") {
    run(binary, ["network", "status", "--data-dir", dataDir])
  } else if (mode === "disable") {
    run(binary, ["network", "disable", "--data-dir", dataDir])
  } else {
    const address = mode === "set" ? args[1] : mode
    if (!address) {
      throw new Error(
        "Usage: dogfood:server:network -- <address|disable|status>"
      )
    }
    run(binary, ["network", "set", address, "--data-dir", dataDir])
  }
  if (launchPid() !== undefined) {
    console.log("Restart the development server to apply the listener change")
  }
}

const [action = "restart", ...rawArgs] = process.argv.slice(2)
const args = rawArgs.filter((argument) => argument !== "--")
switch (action) {
  case "start":
  case "restart":
    start()
    break
  case "stop":
    stop()
    break
  case "status":
    status()
    break
  case "network":
    network(args)
    break
  default:
    throw new Error(
      "Usage: dogfood-server.mjs <start|restart|stop|status|network>"
    )
}
