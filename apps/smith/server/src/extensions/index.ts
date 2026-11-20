/**
 * Smith's own extensions, in install order. Their prompt sections render after
 * the `smith` prompt extension, so sections that change often come last and
 * keep the provider prompt cache warm.
 */
import type { Extension } from "@earendil-works/pi-durable"

import { createAskExtension } from "./ask.ts"
import { createBrowserExtension } from "./browser.ts"
import type { HostBridge } from "./host.ts"
import { createJobsExtension, type JobsExtension } from "./jobs.ts"
import { createOpenFileExtension } from "./open-file.ts"
import { createScheduleExtension } from "./schedule.ts"
import { createScratchpadExtension, type Scratchpad } from "./scratchpad.ts"
import { createAgentsExtension } from "./agents.ts"
import { createTodoExtension } from "./todo.ts"
import { createWatchExtension } from "./watch.ts"

export type SmithExtensionOptions = {
  host: HostBridge
  dataDir: string
}

/** Services of Smith extensions that the HTTP API uses. */
export type SmithExtensionServices = {
  jobs: JobsExtension["runner"]
  scratch: Scratchpad
}

export function createSmithExtensions(options: SmithExtensionOptions): {
  extensions: Extension[]
  services: SmithExtensionServices
} {
  const { host, dataDir } = options
  const jobs = createJobsExtension(host, dataDir)
  const scratchpad = createScratchpadExtension(host, dataDir)
  return {
    extensions: [
      createAskExtension(),
      createScheduleExtension(host),
      createWatchExtension(host),
      jobs.extension,
      scratchpad.extension,
      createAgentsExtension(host),
      createBrowserExtension(host),
      createOpenFileExtension(host),
      createTodoExtension(),
    ],
    services: {
      jobs: jobs.runner,
      scratch: scratchpad.scratch,
    },
  }
}
