import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isMainThread } from "node:worker_threads"

import { resolvePiSdkDir } from "@/server/pi-sdk-path"
import type {
  AgentSessionLike,
  AgentSessionRuntimeLike,
  PiAiModuleLike,
  PiSdkLike,
  SessionManagerLike,
  SessionServicesLike,
  SessionStartEventLike,
} from "@/server/pi-sdk-types"

const SELF_CONTAINED_SETTINGS_MANAGER = Symbol(
  "pico.self-contained-settings-manager"
)

type SessionRuntimeServices = SessionServicesLike & {
  cwd: string
  agentDir: string
}

type SessionRuntimeResult = {
  session: AgentSessionLike
  services: SessionRuntimeServices
  diagnostics: Array<{
    type: string
    message: string
  }>
  modelFallbackMessage?: string
}

type SessionRuntimeFactory = (options: {
  cwd: string
  agentDir: string
  sessionManager: SessionManagerLike
  sessionStartEvent?: SessionStartEventLike
}) => Promise<SessionRuntimeResult>

type AgentSessionRuntimeCtor = new (
  session: AgentSessionLike,
  services: SessionRuntimeServices,
  createRuntime: SessionRuntimeFactory,
  diagnostics?: SessionRuntimeResult["diagnostics"],
  modelFallbackMessage?: string
) => AgentSessionRuntimeLike & {
  apply(result: SessionRuntimeResult): void
  _session: AgentSessionLike
  _services: SessionRuntimeServices
  _diagnostics: SessionRuntimeResult["diagnostics"]
  _modelFallbackMessage?: string
}

type PiSdkModuleLike = PiSdkLike & {
  AgentSessionRuntime?: AgentSessionRuntimeCtor
}

async function importExternalModule<T>(entry: string): Promise<T> {
  const url = pathToFileURL(entry).href
  // eslint-disable-next-line react-doctor/no-dynamic-import-path -- Pico loads the bundled or explicitly configured Pi SDK from an absolute file URL at runtime.
  return (await import(/* @vite-ignore */ url)) as T
}

function patchSdkForWorkerThreads(sdk: PiSdkModuleLike): PiSdkLike {
  if (isMainThread || !sdk.AgentSessionRuntime) {
    return sdk
  }

  const BaseRuntime = sdk.AgentSessionRuntime

  class WorkerSafeAgentSessionRuntime extends BaseRuntime {
    override apply(result: SessionRuntimeResult) {
      this._session = result.session
      this._services = result.services
      this._diagnostics = result.diagnostics ?? []
      this._modelFallbackMessage = result.modelFallbackMessage
    }
  }

  return {
    ...sdk,
    createAgentSessionRuntime: async (
      createRuntime: SessionRuntimeFactory,
      options: {
        cwd: string
        agentDir: string
        sessionManager: SessionManagerLike
        sessionStartEvent?: SessionStartEventLike
      }
    ) => {
      const result = await createRuntime(options)
      return new WorkerSafeAgentSessionRuntime(
        result.session,
        result.services,
        createRuntime,
        result.diagnostics,
        result.modelFallbackMessage
      )
    },
  }
}

export async function loadPiSdk(): Promise<PiSdkLike> {
  const sdkDir = resolvePiSdkDir()
  const entry = path.join(sdkDir, "dist", "index.js")
  const sdk = await importExternalModule<PiSdkModuleLike>(entry)
  return patchSdkForWorkerThreads(sdk)
}

function getPiAiCandidates(sdkDir: string) {
  const candidates: string[] = []
  for (const scope of ["@earendil-works", "@mariozechner"]) {
    candidates.push(
      path.join(sdkDir, "node_modules", scope, "pi-ai", "dist", "index.js")
    )
  }

  try {
    const realSdkDir = fs.realpathSync(sdkDir)
    for (const scope of ["@earendil-works", "@mariozechner"]) {
      candidates.push(
        path.join(
          realSdkDir,
          "node_modules",
          scope,
          "pi-ai",
          "dist",
          "index.js"
        )
      )
    }
    candidates.push(
      path.join(path.dirname(realSdkDir), "pi-ai", "dist", "index.js")
    )
  } catch {
    // Fall back to the direct nested dependency paths above.
  }

  candidates.push(path.join(path.dirname(sdkDir), "pi-ai", "dist", "index.js"))
  return candidates
}

function resolvePiAiEntry(sdkDir: string) {
  const candidates = getPiAiCandidates(sdkDir)
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  )
}

export async function loadPiAi(): Promise<PiAiModuleLike> {
  const sdkDir = resolvePiSdkDir()
  const entry = resolvePiAiEntry(sdkDir)
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
