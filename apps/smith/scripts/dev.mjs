#!/usr/bin/env node
// Runs the backend, the production web build, and the Vite dev server.
//
//   backend + production web  http://HOST:3141  (rebuild with `pnpm build:web`)
//   Vite dev web              http://HOST:3142  (hot reload)
import { spawn, spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const host = process.env.PICO_DEV_HOST ?? "127.0.0.1"
const port = process.env.PICO_DEV_PORT ?? "3141"
const webPort = process.env.PICO_DEV_WEB_PORT ?? "3142"
const dataDir = process.env.PICO_DEV_DATA_DIR ?? join(homedir(), ".pico")
const webDir = join(process.cwd(), ".output/public")
const localHost = ["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host
const backendUrl = `http://${localHost}:${port}`

const build = spawnSync("vp", ["build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
})
if (build.status !== 0) process.exit(build.status ?? 1)

const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    if (process.platform === "win32" || !child.detached) child.kill("SIGTERM")
    else {
      try {
        process.kill(-child.pid, "SIGTERM")
      } catch {
        /* Already stopped. */
      }
    }
  }
}
function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options })
  child.detached = Boolean(options.detached)
  child.on("error", (error) => {
    console.error(error)
    stop(1)
  })
  child.on("exit", (code) => stop(code ?? 1))
  children.push(child)
  return child
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop())

start(process.execPath, [
  "server/build.mjs",
  "--watch",
  "--",
  "serve",
  "--host",
  host,
  "--port",
  port,
  "--data-dir",
  dataDir,
  "--web-dir",
  webDir,
])

const deadline = Date.now() + 30_000
let ready = false
while (!stopping && Date.now() < deadline) {
  try {
    const result = await fetch(`${backendUrl}/api/system/health`, {
      signal: AbortSignal.timeout(1000),
    })
    if (result.ok) {
      ready = true
      break
    }
  } catch {
    /* Wait for the build and server. */
  }
  await new Promise((done) => setTimeout(done, 200))
}
if (!ready) {
  if (!stopping) console.error("Pico backend did not become ready")
  stop(1)
} else {
  start("vp", ["dev", "--host", host, "--port", webPort], {
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    env: { ...process.env, PICO_DEV_BACKEND_URL: backendUrl },
  })
}
