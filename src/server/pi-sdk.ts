import fs from "node:fs"
import path from "node:path"

const SELF_CONTAINED_SETTINGS_MANAGER = Symbol(
  "pi-to-go.self-contained-settings-manager"
)

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
      const versions = fs.readdirSync(jsRuntimeRoot).sort((left, right) =>
        left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: "base",
        })
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

export async function loadPiSdk() {
  const sdkDir = resolvePiSdkDir()
  const entry = path.join(sdkDir, "dist", "index.js")
  return await import(entry)
}

export async function loadPiAi() {
  const sdkDir = resolvePiSdkDir()
  const entry = path.join(
    sdkDir,
    "node_modules",
    "@mariozechner",
    "pi-ai",
    "dist",
    "index.js"
  )
  return await import(entry)
}

export function makeSelfContainedSettingsManager<T extends object>(
  settingsManager: T
) {
  if (
    !settingsManager ||
    (
      settingsManager as T & {
        [SELF_CONTAINED_SETTINGS_MANAGER]?: boolean
      }
    )[SELF_CONTAINED_SETTINGS_MANAGER]
  ) {
    return settingsManager
  }

  const stripResourceSettings = (settings: unknown) => {
    if (!settings || typeof settings !== "object") return {}

    const next = { ...(settings as Record<string, unknown>) }
    delete next.packages
    delete next.extensions
    delete next.skills
    delete next.prompts
    delete next.themes
    return next
  }

  const manager = settingsManager as T & {
    getGlobalSettings?: () => unknown
    getProjectSettings?: () => unknown
    getPackages?: () => unknown[]
    getExtensionPaths?: () => string[]
    getSkillPaths?: () => string[]
    getPromptTemplatePaths?: () => string[]
    getThemePaths?: () => string[]
    [SELF_CONTAINED_SETTINGS_MANAGER]?: boolean
  }

  const originalGetGlobalSettings =
    typeof manager.getGlobalSettings === "function"
      ? manager.getGlobalSettings.bind(manager)
      : undefined
  const originalGetProjectSettings =
    typeof manager.getProjectSettings === "function"
      ? manager.getProjectSettings.bind(manager)
      : undefined

  if (originalGetGlobalSettings) {
    manager.getGlobalSettings = () =>
      stripResourceSettings(originalGetGlobalSettings())
  }

  if (originalGetProjectSettings) {
    manager.getProjectSettings = () =>
      stripResourceSettings(originalGetProjectSettings())
  }

  if (typeof manager.getPackages === "function") {
    manager.getPackages = () => []
  }
  if (typeof manager.getExtensionPaths === "function") {
    manager.getExtensionPaths = () => []
  }
  if (typeof manager.getSkillPaths === "function") {
    manager.getSkillPaths = () => []
  }
  if (typeof manager.getPromptTemplatePaths === "function") {
    manager.getPromptTemplatePaths = () => []
  }
  if (typeof manager.getThemePaths === "function") {
    manager.getThemePaths = () => []
  }

  Object.defineProperty(manager, SELF_CONTAINED_SETTINGS_MANAGER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  })

  return manager
}
