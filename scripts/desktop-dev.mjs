#!/usr/bin/env node

import { spawn } from "node:child_process"
import { watch } from "node:fs"
import process from "node:process"

import { ensureDesktopZig } from "./with-desktop-zig.mjs"

const watchedPaths = ["crates/pico-desktop", "Cargo.toml"]
let child
let restartTimer
let stopping = false
const zig = await ensureDesktopZig()

function stopChild() {
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}

function run() {
  stopChild()
  console.log("\n[pico desktop] building and launching…")
  child = spawn("cargo", ["run", "-p", "pico-desktop"], {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, ZIG: zig },
  })
  child.on("exit", (code, signal) => {
    if (!stopping && code && signal !== "SIGTERM") {
      console.error(`[pico desktop] exited with code ${code}`)
    }
  })
}

function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(run, 180)
}

for (const path of watchedPaths) {
  watch(path, { recursive: true }, (_event, filename) => {
    if (!filename || filename.includes("target/")) return
    scheduleRestart()
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true
    stopChild()
    process.exit(0)
  })
}

run()
