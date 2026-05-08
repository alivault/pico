#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import process from "node:process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJsonPath = join(packageRoot, "package.json")
const serverEntry = join(packageRoot, ".output", "server", "index.mjs")

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "0.0.0"
  } catch {
    return "0.0.0"
  }
}

function printHelp() {
  console.log(`Pico - local browser workspace for Pi coding-agent sessions

Usage:
  pico-app [options]

Options:
  --port <port>    Port to listen on (default: 3141)
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

const options = parseArgs(process.argv.slice(2))

if (!existsSync(serverEntry)) {
  console.error("Pico server build was not found in this package.")
  console.error("If you are developing Pico locally, run `pnpm build` first.")
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
