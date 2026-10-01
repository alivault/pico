#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const project = join(root, "apps", "apple", "Pico", "Pico.xcodeproj")
const derivedData =
  process.env.PICO_DOGFOOD_DERIVED_DATA ?? "/tmp/pico-macos-dogfood"
const builtAppPath = join(
  derivedData,
  "Build",
  "Products",
  "Dogfood",
  "Pico.app"
)
const installedAppPath =
  process.env.PICO_DOGFOOD_APP_PATH ??
  join(homedir(), "Applications", "Pico Dev.app")
const bundleIdentifier = "com.alivault.pico.macos.dev"

if (process.platform !== "darwin") {
  throw new Error("The Pico macOS dogfood client requires macOS")
}
if (basename(installedAppPath) !== "Pico Dev.app") {
  throw new Error(
    "PICO_DOGFOOD_APP_PATH must end in Pico Dev.app; refusing to replace another app"
  )
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

function build() {
  run("xcodebuild", [
    "-project",
    project,
    "-scheme",
    "Pico Dogfood",
    "-configuration",
    "Dogfood",
    "-destination",
    "platform=macOS",
    "-derivedDataPath",
    derivedData,
    "build",
  ])
  if (!existsSync(builtAppPath)) {
    throw new Error(`Dogfood build is missing at ${builtAppPath}`)
  }
  verifyBundle(builtAppPath)
  if (
    existsSync(join(builtAppPath, "Contents", "Resources", "PicoServer")) ||
    existsSync(join(builtAppPath, "Contents", "Library", "LoginItems")) ||
    existsSync(join(builtAppPath, "Contents", "Library", "LaunchAgents"))
  ) {
    throw new Error(
      "Dogfood client unexpectedly contains production background services"
    )
  }
  console.log(`Built Pico Dev: ${builtAppPath}`)
}

function verifyBundle(appPath) {
  verifyBundleValue(appPath, "CFBundleIdentifier", bundleIdentifier)
  verifyBundleValue(appPath, "CFBundleDisplayName", "Pico Dev")
  verifyBundleValue(appPath, "PicoURLScheme", "pico-dev")
  verifyBundleValue(
    appPath,
    "CFBundleURLTypes:0:CFBundleURLSchemes:0",
    "pico-dev"
  )
}

function verifyBundleValue(appPath, key, expected) {
  const result = run(
    "/usr/libexec/PlistBuddy",
    ["-c", `Print :${key}`, join(appPath, "Contents", "Info.plist")],
    { capture: true }
  )
  const actual = result.stdout.trim()
  if (actual !== expected) {
    throw new Error(`Expected ${key}=${expected}, found ${actual || "nothing"}`)
  }
}

function trashIfPresent(path) {
  if (existsSync(path)) run("trash", [path])
}

function install() {
  const installDirectory = dirname(installedAppPath)
  const temporaryAppPath = join(
    installDirectory,
    `.Pico Dev.next-${process.pid}.app`
  )
  mkdirSync(installDirectory, { recursive: true })
  trashIfPresent(temporaryAppPath)
  run("/usr/bin/ditto", [builtAppPath, temporaryAppPath])
  verifyBundle(temporaryAppPath)
  trashIfPresent(installedAppPath)
  renameSync(temporaryAppPath, installedAppPath)
  run(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", "-R", "-trusted", installedAppPath]
  )
  console.log(`Installed Pico Dev: ${installedAppPath}`)
}

function runningDogfoodPids() {
  const script = `tell application "System Events" to get unix id of every application process whose bundle identifier is "${bundleIdentifier}"`
  const result = run("/usr/bin/osascript", ["-e", script], {
    capture: true,
    allowFailure: true,
  })
  if (result.status !== 0 || !result.stdout.trim()) return []
  return result.stdout.trim().split(/,\s*/).map(Number).filter(Number.isInteger)
}

function stopRunningDogfoodClients() {
  const pids = runningDogfoodPids()
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (runningDogfoodPids().length === 0) return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  throw new Error("The previous Pico Dev instance did not stop")
}

function launch() {
  stopRunningDogfoodClients()
  install()
  run("/usr/bin/open", ["-n", installedAppPath])
  console.log(
    "Launched Pico Dev against its separately persisted connection profile"
  )
}

const action = process.argv[2] ?? "run"
switch (action) {
  case "build":
    build()
    break
  case "run":
    build()
    launch()
    break
  default:
    throw new Error("Usage: dogfood-macos.mjs <build|run>")
}
