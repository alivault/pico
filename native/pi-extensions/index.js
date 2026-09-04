import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import codexConversion from "@howaboua/pi-codex-conversion"
import webRunExtension from "@howaboua/pi-codex-web-run"

import { reconcileWebRun } from "./scope.js"

const CONVERSION_PACKAGE = "@howaboua/pi-codex-conversion"
const WEB_RUN_PACKAGE = "@howaboua/pi-codex-web-run"

function agentDirectory() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function packageSource(entry) {
  if (typeof entry === "string") return entry
  if (!entry || typeof entry !== "object") return undefined
  return typeof entry.source === "string" ? entry.source : undefined
}

function packageIsConfigured(packageName) {
  const prefix = `npm:${packageName}`
  return [
    join(agentDirectory(), "settings.json"),
    join(process.cwd(), ".pi", "settings.json"),
  ].some((settingsPath) => {
    const settings = readJson(settingsPath)
    if (!Array.isArray(settings?.packages)) return false
    return settings.packages.some((entry) => {
      const source = packageSource(entry)
      return source === prefix || source?.startsWith(`${prefix}@`)
    })
  })
}

function configuredConversionIncludesWebRun() {
  if (!packageIsConfigured(CONVERSION_PACKAGE)) return false
  const manifest = readJson(
    join(
      agentDirectory(),
      "npm",
      "node_modules",
      ...CONVERSION_PACKAGE.split("/"),
      "package.json"
    )
  )
  const major = Number.parseInt(manifest?.version?.split(".")[0] ?? "", 10)
  return Number.isInteger(major) && major < 3
}

async function loadDefaultPackages(pi) {
  if (!packageIsConfigured(CONVERSION_PACKAGE)) {
    await codexConversion(pi)
  }

  if (
    !packageIsConfigured(WEB_RUN_PACKAGE) &&
    !configuredConversionIncludesWebRun()
  ) {
    await webRunExtension(pi)
  }
}

export default async function picoCodexWeb(pi) {
  await loadDefaultPackages(pi)

  pi.on("session_start", (_event, context) => {
    reconcileWebRun(pi, context.model)
  })
  pi.on("model_select", (event) => {
    reconcileWebRun(pi, event.model)
  })
}
