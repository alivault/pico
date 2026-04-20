import path from "node:path"
import { pathToFileURL } from "node:url"

import { resolvePiSdkDir } from "@/server/pi-sdk-path"
import type { PiAiModuleLike, PiSdkLike } from "@/server/pi-sdk-types"

const SELF_CONTAINED_SETTINGS_MANAGER = Symbol(
  "pi-to-go.self-contained-settings-manager"
)

export { resolvePiSdkDir } from "@/server/pi-sdk-path"

async function importExternalModule<T>(entry: string): Promise<T> {
  const url = pathToFileURL(entry).href
  return (await import(/* @vite-ignore */ url)) as T
}

export async function loadPiSdk(): Promise<PiSdkLike> {
  const sdkDir = resolvePiSdkDir()
  const entry = path.join(sdkDir, "dist", "index.js")
  return await importExternalModule<PiSdkLike>(entry)
}

export async function loadPiAi(): Promise<PiAiModuleLike> {
  const sdkDir = resolvePiSdkDir()
  const entry = path.join(
    sdkDir,
    "node_modules",
    "@mariozechner",
    "pi-ai",
    "dist",
    "index.js"
  )
  return await importExternalModule<PiAiModuleLike>(entry)
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
