#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import process from "node:process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJsonPath = join(packageRoot, "package.json")
const serverEntry = join(packageRoot, ".output", "server", "index.mjs")
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

function ensureSupportedNodeVersion() {
  if (nodeVersionMeetsMinimum(process.versions.node)) return

  console.error(
    `Pico requires Node.js >=${minimumNodeVersionLabel}; current version is ${process.versions.node}.`
  )
  console.error("Upgrade Node.js and run Pico again.")
  process.exit(1)
}

ensureSupportedNodeVersion()

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
    }
  } catch {
    return { name: "@alivault/pico", version: "0.0.0" }
  }
}

function readPackageVersion() {
  return readPackageMetadata().version
}

function printHelp() {
  console.log(`Pico - local browser workspace for Pi coding-agent sessions

Usage:
  pico-app [options]
  pico-app update

Commands:
  update           Update the globally installed Pico package to latest

Options:
  --port <port>    Port to listen on (default: 3141; tries next free port)
  --host <host>    Host to bind to
  --open           Open Pico in your browser (default)
  --no-open        Do not open a browser window
  --version        Print the Pico version
  --help           Show this help message

Environment:
  PICO_PORT        Port to listen on
  PICO_HOST        Host to bind to
  PORT             Fallback port used by the server
  HOST             Fallback host used by the server
`)
}

function readOptionValue(args, index, name) {
  const value = args[index + 1]
  if (!value || value.startsWith("-")) {
    console.error(`Missing value for ${name}`)
    process.exit(1)
  }
  return value
}

function packageManagerCommandFor(packageName) {
  const packageSpec = `${packageName}@latest`
  const npmExecPath = process.env.npm_execpath || ""
  const npmUserAgent = process.env.npm_config_user_agent || ""
  const detectionText = `${npmExecPath} ${npmUserAgent}`.toLowerCase()
  const packageRootSegments = packageRoot.split(/[\\/]+/)
  const normalizedPackageRoot = packageRoot.replaceAll("\\", "/")
  const isPnpmLayout =
    packageRootSegments.includes(".pnpm") ||
    normalizedPackageRoot.includes("/pnpm/global/")
  const isBunLayout = normalizedPackageRoot.includes("/.bun/install/global/")
  const isYarnLayout = normalizedPackageRoot.includes("/yarn/global/")

  if (detectionText.includes("pnpm") || isPnpmLayout) {
    return { command: "pnpm", args: ["add", "-g", packageSpec] }
  }

  if (detectionText.includes("bun") || isBunLayout) {
    return { command: "bun", args: ["add", "-g", packageSpec] }
  }

  if (detectionText.includes("yarn") || isYarnLayout) {
    return { command: "yarn", args: ["global", "add", packageSpec] }
  }

  return { command: "npm", args: ["install", "-g", packageSpec] }
}

function runUpdate(args) {
  if (args.includes("--help")) {
    console.log(`Pico self update

Usage:
  pico-app update

Updates the globally installed Pico package to the latest npm release.`)
    process.exit(0)
  }

  if (args.length > 0) {
    console.error(`Unknown update option: ${args[0]}`)
    console.error("Run `pico-app update --help` for usage.")
    process.exit(1)
  }

  const metadata = readPackageMetadata()
  const updateCommand = packageManagerCommandFor(metadata.name)

  console.log(
    `Updating ${metadata.name} from ${metadata.version} to latest with ${updateCommand.command}...`
  )

  const result = spawnSync(updateCommand.command, updateCommand.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  })

  if (result.error) {
    console.error(
      `Failed to run ${updateCommand.command}: ${result.error.message}`
    )
    process.exit(1)
  }

  if (result.signal) {
    process.kill(process.pid, result.signal)
    return
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  console.log("Pico update complete.")
  process.exit(0)
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
      console.log(readPackageVersion())
      process.exit(0)
    }

    if (arg === "--open") {
      options.open = true
      continue
    }

    if (arg === "--no-open") {
      options.open = false
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

    console.error(`Unknown option: ${arg}`)
    console.error("Run `pico-app --help` for usage.")
    process.exit(1)
  }

  return options
}

function browserHostFor(host) {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "localhost"
  }
  return host
}

function normalizePort(port) {
  const portNumber = Number(port)
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65_535) {
    console.error(`Invalid port: ${port}`)
    process.exit(1)
  }
  return portNumber
}

function canRetryPortError(error) {
  return error?.code === "EADDRINUSE"
}

function isPortAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    const listenOptions = host ? { port, host } : { port }

    probe.once("error", (error) => {
      if (canRetryPortError(error)) {
        resolve(false)
        return
      }
      reject(error)
    })
    probe.once("listening", () => {
      probe.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(true)
      })
    })
    probe.listen(listenOptions)
  })
}

async function resolveAvailablePort(port, host) {
  const requestedPort = normalizePort(port)
  if (requestedPort === 0) return String(requestedPort)

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

  console.error(
    `No available port found between ${requestedPort} and ${lastPort}.`
  )
  process.exit(1)
}

async function waitForServer(url, timeoutMs = 15_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" })
      if (response.status < 500) return true
    } catch {
      // Server is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return false
}

function openBrowser(url) {
  const opener = (() => {
    if (process.platform === "darwin") return ["open", [url]]
    if (process.platform === "win32") return ["cmd", ["/c", "start", "", url]]
    return ["xdg-open", [url]]
  })()

  const child = spawn(opener[0], opener[1], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

const args = process.argv.slice(2)

if (args[0] === "update") {
  runUpdate(args.slice(1))
}

const options = parseArgs(args)

if (!existsSync(serverEntry)) {
  console.error("Pico server build was not found in this package.")
  console.error("If you are developing Pico locally, run `pnpm build` first.")
  process.exit(1)
}

try {
  options.port = await resolveAvailablePort(options.port, options.host)
} catch (error) {
  console.error(
    `Could not check port ${options.port}${
      options.host ? ` on ${options.host}` : ""
    }.`
  )
  console.error(error?.message ?? String(error))
  process.exit(1)
}

const url = `http://${browserHostFor(options.host)}:${options.port}`

console.log(`Starting Pico at ${url}`)
console.log("Press Ctrl+C to stop.")

const server = spawn(process.execPath, [serverEntry], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: options.port,
    NITRO_PORT: options.port,
    ...(options.host
      ? {
          HOST: options.host,
          NITRO_HOST: options.host,
        }
      : {}),
  },
})

if (options.open) {
  void waitForServer(url).then((isReady) => {
    if (isReady) openBrowser(url)
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!server.killed) {
      server.kill(signal)
      setTimeout(() => process.exit(1), 5_000).unref()
      return
    }

    process.exit(1)
  })
}

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
