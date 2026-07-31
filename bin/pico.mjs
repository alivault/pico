#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:net"
import process from "node:process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  fetchLatestNativeManifest,
  nativeBundleSummary,
  resolveNativeBundle,
} from "./native-runtime.mjs"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJsonPath = join(packageRoot, "package.json")
const minimumNodeVersion = [22, 19, 0]
const minimumNodeVersionLabel = "22.19.0"
const portSearchLimit = 100

function nodeVersionMeetsMinimum(version) {
  const parts = version.split(".").map((part) => Number(part))
  for (let index = 0; index < minimumNodeVersion.length; index += 1) {
    const actual = Number.isFinite(parts[index]) ? parts[index] : 0
    const required = minimumNodeVersion[index]
    if (actual > required) return true
    if (actual < required) return false
  }
  return true
}

if (!nodeVersionMeetsMinimum(process.versions.node)) {
  console.error(
    `Pico requires Node.js >=${minimumNodeVersionLabel}; current version is ${process.versions.node}.`
  )
  process.exit(1)
}

function readPackageMetadata() {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    return {
      name:
        typeof packageJson.name === "string"
          ? packageJson.name
          : "@alivault/pico",
      version:
        typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
      serverProtocolVersion: packageJson.pico?.serverProtocolVersion ?? 1,
      apiContractVersion: packageJson.pico?.apiContractVersion ?? 1,
    }
  } catch {
    return {
      name: "@alivault/pico",
      version: "0.0.0",
      serverProtocolVersion: 1,
      apiContractVersion: 1,
    }
  }
}

function printHelp() {
  console.log(`Pico - local browser workspace for Pi coding-agent sessions

Usage:
  pico-app [options]
  pico-app update

Commands:
  update           Drain active work, update Pico, and restart the server

Options:
  --port <port>    Port to listen on (default: 3141; tries next free port)
  --host <host>    Host to bind to
  --open           Open Pico in your browser (default)
  --no-open        Do not open a browser window
  --version        Print the Pico version
  --help           Show this help message

Environment:
  PICO_SERVER_BIN            Explicit native pico-server binary
  PICO_NATIVE_CACHE_DIR      Downloaded native bundle cache
  PICO_NATIVE_RELEASE_URL    Native release asset base URL
  PICO_DISABLE_NATIVE_DOWNLOAD=1
  PICO_PORT / PICO_HOST      Server bind address
  PICO_PI_BIN                Explicit standalone Pi binary
  PICO_PI_BRIDGE_BIN         Explicit standalone Pi bridge
  PICO_WEB_DIR               Explicit static browser asset directory
`)
}

function readOptionValue(args, index, name) {
  const value = args[index + 1]
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

function parseArgs(args) {
  const options = {
    open: process.env.PICO_OPEN !== "0",
    port: process.env.PICO_PORT || process.env.PORT || "3141",
    host: process.env.PICO_HOST || process.env.HOST || undefined,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--help") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--version") {
      console.log(readPackageMetadata().version)
      process.exit(0)
    }
    if (arg === "--open" || arg === "--no-open") {
      options.open = arg === "--open"
      continue
    }
    if (arg === "--port") {
      options.port = readOptionValue(args, index, "--port")
      index += 1
      continue
    }
    if (arg.startsWith("--port=")) {
      options.port = arg.slice("--port=".length)
      continue
    }
    if (arg === "--host") {
      options.host = readOptionValue(args, index, "--host")
      index += 1
      continue
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length)
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function packageManagerCommandFor(packageName) {
  const packageSpec = `${packageName}@latest`
  const detectionText = `${process.env.npm_execpath || ""} ${
    process.env.npm_config_user_agent || ""
  }`.toLowerCase()
  const normalizedPackageRoot = packageRoot.replaceAll("\\", "/")

  if (
    detectionText.includes("pnpm") ||
    normalizedPackageRoot.includes("/.pnpm/") ||
    normalizedPackageRoot.includes("/pnpm/global/")
  ) {
    return { command: "pnpm", args: ["add", "-g", packageSpec] }
  }
  if (
    detectionText.includes("bun") ||
    normalizedPackageRoot.includes("/.bun/install/global/")
  ) {
    return { command: "bun", args: ["add", "-g", packageSpec] }
  }
  if (
    detectionText.includes("yarn") ||
    normalizedPackageRoot.includes("/yarn/global/")
  ) {
    return { command: "yarn", args: ["global", "add", packageSpec] }
  }
  return { command: "npm", args: ["install", "-g", packageSpec] }
}

function parseControlResponse(result) {
  const output = result.stdout?.trim()
  if (!output) return undefined
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}

function readRunningStatus(bundle) {
  const result = spawnSync(bundle.server, ["status"], {
    encoding: "utf8",
    env: process.env,
  })
  const response = parseControlResponse(result)
  if (!response) return undefined
  if (!response.ok) {
    throw new Error(response.error || "Pico control status failed")
  }
  return response.status
}

function ensureCompatibleStatus(status, metadata) {
  if (status.protocolVersion !== metadata.serverProtocolVersion) {
    throw new Error(
      `Running Pico server protocol ${status.protocolVersion} is incompatible with launcher protocol ${metadata.serverProtocolVersion}.`
    )
  }
  if (status.apiContractVersion !== metadata.apiContractVersion) {
    throw new Error(
      `Running Pico API contract ${status.apiContractVersion} is incompatible with launcher contract ${metadata.apiContractVersion}.`
    )
  }
}

function restartInstalledPico(status) {
  const restartArgs = ["--no-open", "--port", String(status.port)]
  if (status.host) restartArgs.push("--host", status.host)
  const restarted = spawn("pico-app", restartArgs, {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  })
  restarted.once("error", (error) => {
    console.error(`Pico was updated but could not restart: ${error.message}`)
  })
  restarted.unref()
}

async function runUpdate(args) {
  if (args.includes("--help")) {
    console.log(`Pico self update

Usage:
  pico-app update

Checks release protocol compatibility, drains active Pi work, updates the global
npm package, restarts the native server, and lets connected clients reconnect.`)
    return
  }
  if (args.length > 0) {
    throw new Error(`Unknown update option: ${args[0]}`)
  }

  const metadata = readPackageMetadata()
  const release = await fetchLatestNativeManifest()
  if (release.version === metadata.version) {
    console.log(`Pico ${metadata.version} is already up to date.`)
    return
  }
  if (
    release.serverProtocolVersion !== metadata.serverProtocolVersion ||
    release.apiContractVersion !== metadata.apiContractVersion
  ) {
    throw new Error(
      `Pico ${release.version} changes the server/API protocol. Update Pico clients before performing this upgrade manually.`
    )
  }

  const bundle = await resolveNativeBundle(packageRoot, metadata.version)
  const runningStatus = readRunningStatus(bundle)
  if (runningStatus) {
    ensureCompatibleStatus(runningStatus, metadata)
    console.log(
      runningStatus.activeRunCount > 0
        ? `Waiting for ${runningStatus.activeRunCount} active Pi run(s) before updating...`
        : "Stopping the native Pico server before updating..."
    )
    const stop = spawnSync(bundle.server, ["stop", "--wait"], {
      stdio: "inherit",
      env: process.env,
    })
    if (stop.error || stop.status !== 0) {
      throw (
        stop.error || new Error("The Pico server could not drain for update")
      )
    }
  }

  const updateCommand = packageManagerCommandFor(metadata.name)
  console.log(
    `Updating ${metadata.name} from ${metadata.version} to ${release.version} with ${updateCommand.command}...`
  )
  const result = spawnSync(updateCommand.command, updateCommand.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error || result.status !== 0) {
    if (runningStatus) restartInstalledPico(runningStatus)
    throw result.error || new Error(`${updateCommand.command} update failed`)
  }

  if (runningStatus) {
    restartInstalledPico(runningStatus)
    console.log("Pico update complete. The server is restarting now.")
  } else {
    console.log("Pico update complete.")
  }
}

function browserHostFor(host) {
  if (!host || host === "0.0.0.0" || host === "::") return "localhost"
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
}

function normalizePort(port) {
  const portNumber = Number(port)
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65_535) {
    throw new Error(`Invalid port: ${port}`)
  }
  return portNumber
}

function isPortAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", (error) => {
      if (error?.code === "EADDRINUSE") resolve(false)
      else reject(error)
    })
    probe.once("listening", () => {
      probe.close((error) => (error ? reject(error) : resolve(true)))
    })
    probe.listen(host ? { port, host } : { port })
  })
}

async function resolveAvailablePort(port, host) {
  const requestedPort = normalizePort(port)
  if (requestedPort === 0) {
    return new Promise((resolve, reject) => {
      const probe = createServer()
      probe.once("error", reject)
      probe.once("listening", () => {
        const address = probe.address()
        const selectedPort =
          typeof address === "object" && address ? address.port : undefined
        probe.close((error) => {
          if (error) reject(error)
          else if (selectedPort) resolve(String(selectedPort))
          else reject(new Error("Could not select an ephemeral Pico port"))
        })
      })
      probe.listen(host ? { port: 0, host } : { port: 0 })
    })
  }
  const lastPort = Math.min(65_535, requestedPort + portSearchLimit - 1)
  for (let candidate = requestedPort; candidate <= lastPort; candidate += 1) {
    if (await isPortAvailable(candidate, host)) {
      if (candidate !== requestedPort) {
        console.warn(
          `Port ${requestedPort} is not available; using ${candidate} instead.`
        )
      }
      return String(candidate)
    }
  }
  throw new Error(
    `No available port found between ${requestedPort} and ${lastPort}.`
  )
}

async function waitForServer(url, timeoutMs = 15_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/system/health`)
      if (response.ok) return true
    } catch {
      // Server is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]
  const child = spawn(opener[0], opener[1], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

async function run() {
  const args = process.argv.slice(2)
  if (args[0] === "update") {
    await runUpdate(args.slice(1))
    return
  }

  const metadata = readPackageMetadata()
  const options = parseArgs(args)
  const bundle = await resolveNativeBundle(packageRoot, metadata.version)
  const runningStatus = readRunningStatus(bundle)
  if (runningStatus) {
    ensureCompatibleStatus(runningStatus, metadata)
    if (runningStatus.phase !== "running") {
      throw new Error(
        `Pico server is ${runningStatus.phase}; wait for it to restart before submitting new work.`
      )
    }
    const url = `http://${browserHostFor(runningStatus.host)}:${runningStatus.port}`
    console.log(`Using running Pico server ${runningStatus.version} at ${url}`)
    if (options.open) openBrowser(url)
    return
  }

  options.port = await resolveAvailablePort(options.port, options.host)
  const url = `http://${browserHostFor(options.host)}:${options.port}`
  const serveArgs = [
    "serve",
    "--port",
    options.port,
    "--pi-bin",
    bundle.pi,
    "--web-dir",
    bundle.web,
  ]
  if (bundle.bridge) serveArgs.push("--pi-bridge-bin", bundle.bridge)
  if (options.host) serveArgs.push("--host", options.host)

  console.log(`Starting native Pico at ${url}`)
  console.log(`Runtime: ${nativeBundleSummary(bundle)}`)
  console.log("Press Ctrl+C to drain active work and stop.")
  const server = spawn(bundle.server, serveArgs, {
    stdio: "inherit",
    env: process.env,
  })

  if (options.open) {
    void waitForServer(url).then((isReady) => {
      if (isReady) openBrowser(url)
    })
  }

  let stopping = false
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!stopping) {
        stopping = true
        console.log("Draining active Pico work before shutdown...")
        server.kill(signal)
        return
      }
      console.error("Forcing Pico to stop before active work has drained.")
      server.kill("SIGKILL")
    })
  }

  server.on("error", (error) => {
    console.error(`Could not start native Pico: ${error.message}`)
    process.exit(1)
  })
  server.on("exit", (code, signal) => {
    if (signal && signal !== "SIGTERM" && signal !== "SIGINT") {
      console.error(`Native Pico exited from ${signal}.`)
      process.exit(1)
    }
    process.exit(code ?? 0)
  })
}

try {
  await run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
