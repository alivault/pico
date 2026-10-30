/**
 * The agent runtime: one durable Harness on Pico's SQLite database, with Pi's
 * model catalog and credentials, and the extensions every session runs with.
 */
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { CodemodeSandbox } from "@earendil-works/pi-codemode"
import {
  getAgentDir,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import {
  type CompactionPolicy,
  type CompactionSettings,
  createRegistry,
  Harness,
  type HarnessSettings,
  type Registry,
} from "@earendil-works/pi-durable"
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode"
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node"
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search"

import type { ServerPaths } from "../config.ts"
import type { HostBridge } from "../extensions/host.ts"
import {
  createPicoExtensions,
  type PicoExtensionServices,
} from "../extensions/index.ts"
import { createMcpExtension, type McpExtension } from "../extensions/mcp.ts"
import { createPromptExtension } from "../extensions/prompt.ts"
import { createWebAccessExtension } from "../extensions/web-access.ts"
import { createPicoCodingTools } from "./coding-tools.ts"
import { compactionSettings, modelCompactionPolicy } from "./compaction.ts"
import { ResourceCache } from "./resources.ts"
import { PicoSettings } from "./settings.ts"
import { SidebarState } from "./sidebar-state.ts"

/**
 * Tokens of tool declarations in the `codemode` prompt section. Zero: the
 * model already has every tool's schema as a tool definition, and scripts
 * find the others with `searchTools()` and `describeTool()`.
 */
const CODEMODE_INLINE_BUDGET = 0

export type Runtime = {
  readonly harness: Harness
  readonly models: ModelRuntime
  readonly registry: Registry
  readonly resources: ResourceCache
  readonly settings: PicoSettings
  /** The sidebar layout that all devices share. */
  readonly sidebar: SidebarState
  readonly agentDir: string
  readonly mcp: McpExtension
  readonly extensions: PicoExtensionServices
  /** Pi's global settings: default model, thinking level, compaction, retry. */
  piSettings(): SettingsManager
  /** The compaction policy that the harness uses for a model. */
  compactionPolicy(model: {
    provider: string
    modelId: string
  }): CompactionPolicy
  close(): Promise<void>
}

export async function openRuntime(
  paths: ServerPaths,
  host: HostBridge
): Promise<Runtime> {
  mkdirSync(paths.dataDir, { recursive: true })
  const agentDir = getAgentDir()
  const settings = new PicoSettings(paths.settingsFile)
  const sidebar = new SidebarState(paths.sidebarFile)

  let piSettings = SettingsManager.create(homedir(), agentDir)
  let piSettingsLoadedAt = Date.now()
  const currentPiSettings = () => {
    // Pi's settings file may change while Pico runs; reread it now and then.
    if (Date.now() - piSettingsLoadedAt > 10_000) {
      piSettings = SettingsManager.create(homedir(), agentDir)
      piSettingsLoadedAt = Date.now()
    }
    return piSettings
  }

  const models = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    allowModelNetwork: true,
  })
  void models.refresh({ allowNetwork: true }).catch(() => undefined)

  const resources = new ResourceCache(agentDir)
  const registry = createRegistry()
  const images = await createNodePhotonImages().catch((error: unknown) => {
    console.warn("[pico] image processing is unavailable:", error)
    return undefined
  })
  registry.install(
    createPicoCodingTools({
      ...(images ? { images } : {}),
      shellPrefix: () => currentPiSettings().getShellCommandPrefix(),
      host,
    })
  )
  registry.install(createWebAccessExtension())
  const mcp = createMcpExtension(agentDir, paths.dataDir)
  registry.install(mcp.extension)
  registry.install(createToolSearchExtension())
  registry.install(
    createCodemodeExtension({
      sandbox: new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 }),
      namespaces: mcp.namespaces(),
      inlineBudget: CODEMODE_INLINE_BUDGET,
    })
  )
  registry.install(createPromptExtension(resources))
  const pico = createPicoExtensions({ host, dataDir: paths.dataDir })
  for (const extension of pico.extensions) registry.install(extension)
  mcp.onChange(() => {
    registry.install(mcp.extension)
    registry.install(
      createCodemodeExtension({
        sandbox: new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 }),
        namespaces: mcp.namespaces(),
        inlineBudget: CODEMODE_INLINE_BUDGET,
      })
    )
  })

  const harnessSettings: HarnessSettings = {
    get stream() {
      const data = settings.data
      return {
        ...(data.transport !== "auto" ? { transport: data.transport } : {}),
        cacheRetention:
          data.cacheRetention === "long"
            ? ("long" as const)
            : ("short" as const),
      }
    },
    get retry() {
      const retry = currentPiSettings().getRetrySettings()
      return {
        enabled: retry.enabled,
        maxRetries: retry.maxRetries,
        baseDelayMs: retry.baseDelayMs,
      }
    },
    get compaction() {
      return currentCompaction()
    },
    get steeringMode() {
      return currentPiSettings().getSteeringMode()
    },
    get followUpMode() {
      return currentPiSettings().getFollowUpMode()
    },
    toolExecution: "parallel",
  }

  // The settings have an override for each model, so build them again only
  // when an input changes, or now and then for changes in the model catalog.
  let compaction:
    | {
        value: CompactionSettings
        pi: SettingsManager
        compactAt: number
        at: number
      }
    | undefined
  function currentCompaction() {
    const pi = currentPiSettings()
    const compactAt = settings.data.compactAtTokens
    if (
      compaction?.pi !== pi ||
      compaction.compactAt !== compactAt ||
      Date.now() - compaction.at > 10_000
    ) {
      compaction = {
        value: compactionSettings(
          (model) => pi.getCompactionSettings(model),
          models.getModels(),
          compactAt
        ),
        pi,
        compactAt,
        at: Date.now(),
      }
    }
    return compaction.value
  }

  const storage = await openNodeSqliteStorage(paths.database)
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      settings: harnessSettings,
      env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? homedir() }),
      onReport: (error) => console.warn("[pico] durable report:", error),
    },
    BACKGROUND_CONTEXT
  )

  return {
    harness,
    models,
    registry,
    resources,
    settings,
    sidebar,
    agentDir,
    mcp,
    extensions: pico.services,
    piSettings: currentPiSettings,
    compactionPolicy: (model) =>
      modelCompactionPolicy(currentCompaction(), model),
    async close() {
      await pico.services.close().catch(() => undefined)
      await mcp.close()
      await harness.close(BACKGROUND_CONTEXT)
    },
  }
}
