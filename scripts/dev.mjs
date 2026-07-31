#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const backendPort = process.env.PICO_DEV_SERVER_PORT ?? "3142"
const backendUrl = `http://127.0.0.1:${backendPort}`
const serverBinary = join(
  root,
  "target",
  "debug",
  process.platform === "win32" ? "pico-server.exe" : "pico-server"
)
const bridgeBinary = join(
  root,
  "target",
  process.platform === "win32" ? "pico-pi-bridge.exe" : "pico-pi-bridge"
)
const bridgeSource = join(root, "native", "pi-bridge.ts")

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("cargo", ["build", "-p", "pico-server"])
if (
  !existsSync(bridgeBinary) ||
  statSync(bridgeBinary).mtimeMs < statSync(bridgeSource).mtimeMs
) {
  run("pnpm", ["build:pi-bridge"])
}
if (process.platform !== "win32") chmodSync(bridgeBinary, 0o755)

const server = spawn(
  serverBinary,
  [
    "serve",
    "--port",
    backendPort,
    "--data-dir",
    join(root, ".pico-dev"),
    "--pi-bridge-bin",
    bridgeBinary,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }
)
async function waitForBackend() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Native Pico dev server exited with ${server.exitCode}`)
    }
    try {
      const response = await fetch(`${backendUrl}/api/system/health`)
      if (response.ok) return
    } catch {
      // The native server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Native Pico dev server did not become ready")
}

try {
  await waitForBackend()
} catch (error) {
  if (!server.killed) server.kill("SIGTERM")
  throw error
}

const vite = spawn("vp", ["dev"], {
  cwd: root,
  stdio: "inherit",
  detached: process.platform !== "win32",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PICO_DEV_BACKEND_URL: backendUrl,
  },
})

let stopping = false
function stop(signal = "SIGTERM") {
  if (stopping) return
  stopping = true
  if (!vite.killed) {
    if (process.platform === "win32") vite.kill("SIGTERM")
    else {
      try {
        process.kill(-vite.pid, "SIGTERM")
      } catch {
        // The Vite process group already exited.
      }
    }
  }
  if (!server.killed) server.kill(signal)
}

process.once("SIGINT", () => stop("SIGINT"))
process.once("SIGTERM", () => stop("SIGTERM"))

function childResult(child, label) {
  return new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(`${label} failed: ${error.message}`)
      resolve(1)
    })
    child.once("exit", (code) => resolve(code ?? 0))
  })
}

const serverResult = childResult(server, "Native Pico dev server")
const viteResult = childResult(vite, "Vite dev server")
const exitCode = await Promise.race([serverResult, viteResult])
stop()
await Promise.allSettled([serverResult, viteResult])
process.exitCode = exitCode
