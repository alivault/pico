/**
 * Pico's own extensions, in install order. Their prompt sections render after
 * the `pico` prompt extension, so sections that change often come last and
 * keep the provider prompt cache warm.
 */
import type { Extension } from "@earendil-works/pi-durable"

import { createAskExtension } from "./ask.ts"
import { createBrowserExtension } from "./browser.ts"
import { createGitExtension } from "./git.ts"
import { createGithubExtension } from "./github.ts"
import type { HostBridge } from "./host.ts"
import { createJobsExtension, type JobsExtension } from "./jobs.ts"
import { createLspExtension } from "./lsp.ts"
import { createNotifyExtension } from "./notify.ts"
import { createPreviewExtension } from "./preview.ts"
import { createRenderExtension } from "./render.ts"
import { createScheduleExtension } from "./schedule.ts"
import { createScratchpadExtension, type Scratchpad } from "./scratchpad.ts"
import { createSessionsExtension } from "./sessions.ts"
import { createTestsExtension } from "./tests.ts"
import { createTodoExtension } from "./todo.ts"
import { createWatchExtension } from "./watch.ts"

export type PicoExtensionOptions = {
  host: HostBridge
  dataDir: string
}

/** Services of Pico extensions that the HTTP API uses. */
export type PicoExtensionServices = {
  jobs: JobsExtension["runner"]
  scratch: Scratchpad
  /** Stop language servers at shutdown. */
  close(): Promise<void>
}

export function createPicoExtensions(options: PicoExtensionOptions): {
  extensions: Extension[]
  services: PicoExtensionServices
} {
  const { host, dataDir } = options
  const jobs = createJobsExtension(host, dataDir)
  const scratchpad = createScratchpadExtension(host, dataDir)
  const lsp = createLspExtension(host)
  return {
    extensions: [
      createAskExtension(),
      createRenderExtension(),
      createScheduleExtension(host),
      createWatchExtension(host),
      jobs.extension,
      scratchpad.extension,
      createSessionsExtension(host),
      createGitExtension(host),
      createGithubExtension(),
      createTestsExtension(),
      lsp.extension,
      createPreviewExtension(host),
      createNotifyExtension(host),
      createBrowserExtension(host),
      createTodoExtension(),
    ],
    services: {
      jobs: jobs.runner,
      scratch: scratchpad.scratch,
      close: () => lsp.pool.shutdown(),
    },
  }
}
