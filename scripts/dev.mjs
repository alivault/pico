#!/usr/bin/env node
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const port = process.env.PICO_DEV_PORT ?? "3142"
const host = "127.0.0.1"
const backendUrl = `http://${host}:${port}`
const server = spawn(
  process.execPath,
  [
    "server/build.mjs",
    "--watch",
    "--",
    "serve",
    "--port",
    port,
    "--host",
    host,
    "--data-dir",
    process.env.PICO_DEV_DATA_DIR ?? join(homedir(), ".pico-dev"),
    "--web-dir",
    "none",
  ],
  { stdio: "inherit" }
)
let vite
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  if (vite?.pid) {
    if (process.platform === "win32") vite.kill("SIGTERM")
    else {
      try {
        process.kill(-vite.pid, "SIGTERM")
      } catch {
        /* Already stopped. */
      }
    }
  }
  server.kill("SIGTERM")
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop)
server.on("error", (error) => {
  console.error(error)
  stop()
  process.exitCode = 1
})
server.on("exit", (code) => {
  stop()
  process.exitCode = code ?? 1
})
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
  console.error("Pico development server did not become ready")
  stop()
  process.exitCode = 1
} else {
  vite = spawn(
    "vp",
    ["dev", "--port", process.env.PICO_DEV_WEB_PORT ?? "5173"],
    {
      stdio: "inherit",
      detached: process.platform !== "win32",
      shell: process.platform === "win32",
      env: { ...process.env, PICO_DEV_BACKEND_URL: backendUrl },
    }
  )
  vite.on("error", (error) => {
    console.error(error)
    stop()
    process.exitCode = 1
  })
  vite.on("exit", (code) => {
    stop()
    process.exitCode = code ?? 1
  })
}
