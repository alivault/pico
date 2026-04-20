import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawn } from "node:child_process"

export const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
export const STATIC_DIR = path.join(PACKAGE_DIR, "static")

export function printUsage() {
  console.log(`pi-web

Usage:
  pi-web [dir] [--host 127.0.0.1] [--port 3141] [--no-session] [--open]

Modes:
  - default: starts the pi-web HTTP server plus browser UI
  - --open: same as default, but opens the browser automatically

Notes:
  - pi-web does not load pi extensions; browser sessions use a self-contained runtime`)
}

export function parseServeArgs(argv, { openBrowser = false } = {}) {
  const options = {
    host: "127.0.0.1",
    port: 3141,
    cwd: process.cwd(),
    noSession: false,
    openBrowser,
    help: false,
  }

  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true
        break
      case "--host":
      case "--hostname":
        options.host = requireValue(argv, ++i, arg)
        break
      case "--port": {
        const raw = requireValue(argv, ++i, arg)
        const port = Number.parseInt(raw, 10)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid --port value: ${raw}`)
        }
        options.port = port
        break
      }
      case "--dir":
      case "--cwd":
        options.cwd = path.resolve(requireValue(argv, ++i, arg))
        break
      case "--no-session":
        options.noSession = true
        break
      case "--open":
        options.openBrowser = true
        break
      case "--no-open":
        options.openBrowser = false
        break
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg}`)
        }
        positional.push(arg)
        break
    }
  }

  if (positional[0]) {
    options.cwd = path.resolve(positional[0])
  }

  return options
}

export function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value == null) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

export function formatError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isLoopbackHost(host) {
  const normalized = host.trim().toLowerCase()
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  )
}

export function toClientUrl(host, port) {
  let displayHost = host
  if (
    displayHost === "0.0.0.0" ||
    displayHost === "::" ||
    displayHost === "[::]"
  ) {
    displayHost = "127.0.0.1"
  }
  if (displayHost.includes(":") && !displayHost.startsWith("[")) {
    displayHost = `[${displayHost}]`
  }
  return `http://${displayHost}:${port}`
}

export async function loadPiSdk() {
  const sdkDir = resolvePiSdkDir()
  const entry = pathToFileURL(path.join(sdkDir, "dist", "index.js")).href
  return import(entry)
}

export async function loadPiAi() {
  const sdkDir = resolvePiSdkDir()
  const entry = pathToFileURL(
    path.join(
      sdkDir,
      "node_modules",
      "@mariozechner",
      "pi-ai",
      "dist",
      "index.js"
    )
  ).href
  return import(entry)
}

const SELF_CONTAINED_SETTINGS_MANAGER = Symbol(
  "pi-web.selfContainedSettingsManager"
)

export function makeSelfContainedSettingsManager(settingsManager) {
  if (!settingsManager || settingsManager[SELF_CONTAINED_SETTINGS_MANAGER]) {
    return settingsManager
  }

  const stripResourceSettings = (settings) => {
    if (!settings || typeof settings !== "object") return {}

    const next = { ...settings }
    delete next.packages
    delete next.extensions
    delete next.skills
    delete next.prompts
    delete next.themes
    return next
  }

  const originalGetGlobalSettings =
    typeof settingsManager.getGlobalSettings === "function"
      ? settingsManager.getGlobalSettings.bind(settingsManager)
      : undefined
  const originalGetProjectSettings =
    typeof settingsManager.getProjectSettings === "function"
      ? settingsManager.getProjectSettings.bind(settingsManager)
      : undefined

  if (originalGetGlobalSettings) {
    settingsManager.getGlobalSettings = () =>
      stripResourceSettings(originalGetGlobalSettings())
  }

  if (originalGetProjectSettings) {
    settingsManager.getProjectSettings = () =>
      stripResourceSettings(originalGetProjectSettings())
  }

  if (typeof settingsManager.getPackages === "function") {
    settingsManager.getPackages = () => []
  }
  if (typeof settingsManager.getExtensionPaths === "function") {
    settingsManager.getExtensionPaths = () => []
  }
  if (typeof settingsManager.getSkillPaths === "function") {
    settingsManager.getSkillPaths = () => []
  }
  if (typeof settingsManager.getPromptTemplatePaths === "function") {
    settingsManager.getPromptTemplatePaths = () => []
  }
  if (typeof settingsManager.getThemePaths === "function") {
    settingsManager.getThemePaths = () => []
  }

  Object.defineProperty(settingsManager, SELF_CONTAINED_SETTINGS_MANAGER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  })

  return settingsManager
}

export function resolvePiSdkDir() {
  if (process.env.PI_REMOTE_PI_SDK_DIR) {
    return process.env.PI_REMOTE_PI_SDK_DIR
  }

  const explicitPiBin = process.env.PI_REAL_PI_BIN
  if (explicitPiBin) {
    return path.dirname(path.dirname(fs.realpathSync(explicitPiBin)))
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, "pi")
    if (!fs.existsSync(candidate)) continue
    try {
      const resolved = fs.realpathSync(candidate)
      if (
        resolved.endsWith(
          path.join("@mariozechner", "pi-coding-agent", "dist", "cli.js")
        )
      ) {
        return path.dirname(path.dirname(resolved))
      }
    } catch {
      // ignore and keep scanning
    }
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE
  if (homeDir) {
    const jsRuntimeRoot = path.join(homeDir, ".vite-plus", "js_runtime", "node")
    try {
      const versions = fs
        .readdirSync(jsRuntimeRoot)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        )
      for (const version of versions.reverse()) {
        const sdkDir = path.join(
          jsRuntimeRoot,
          version,
          "lib",
          "node_modules",
          "@mariozechner",
          "pi-coding-agent"
        )
        if (fs.existsSync(path.join(sdkDir, "dist", "index.js"))) {
          return sdkDir
        }
      }
    } catch {
      // ignore and keep scanning
    }
  }

  throw new Error(
    "Could not locate the installed pi SDK package. Set PI_REMOTE_PI_SDK_DIR."
  )
}

export async function readJsonBody(req) {
  const chunks = []
  let total = 0
  const maxBytes = 10 * 1024 * 1024
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) {
      throw new Error("Request body too large")
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return {}
  return JSON.parse(text)
}

export function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  res.end(JSON.stringify(data))
}

export function sendSseEvent(res, payload, options = {}) {
  const lines = []
  if (options.id) {
    lines.push(`id: ${String(options.id)}`)
  }
  if (options.event) {
    lines.push(`event: ${String(options.event)}`)
  }
  lines.push(`data: ${JSON.stringify(payload)}`)
  res.write(`${lines.join("\n")}\n\n`)
}

export function serveStatic(req, res, rootDir) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost")
  let pathname = requestUrl.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // ignore malformed escapes and use raw path
  }

  const normalized = path.normalize(pathname).replace(/\\/g, "/")
  const relativePath =
    normalized === "/" ? "index.html" : normalized.replace(/^\//, "")
  const absolutePath = path.join(rootDir, relativePath)

  if (
    !absolutePath.startsWith(rootDir + path.sep) &&
    absolutePath !== rootDir
  ) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Forbidden")
    return
  }

  const mime =
    MIME_TYPES[path.extname(absolutePath).toLowerCase()] ??
    "application/octet-stream"

  fs.readFile(absolutePath, (error, data) => {
    if (!error) {
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" })
      res.end(data)
      return
    }

    if (
      error?.code === "ENOENT" ||
      error?.code === "EISDIR" ||
      error?.code === "ENOTDIR"
    ) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("Not found")
      return
    }

    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Internal server error")
  })
}

export function openBrowser(url) {
  const platform = process.platform
  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
    return
  }
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref()
    return
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref()
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".aac": "audio/aac",
}
