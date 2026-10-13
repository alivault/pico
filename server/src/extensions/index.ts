/**
 * Pico's own extensions, in install order. Their prompt sections render after
 * the `pico` prompt extension, so sections that change often come last and
 * keep the provider prompt cache warm.
 */
import type { Extension } from "@earendil-works/pi-durable"

import { createAskExtension } from "./ask.ts"
import type { HostBridge } from "./host.ts"
import { createJobsExtension, type JobsExtension } from "./jobs.ts"
import { createRenderExtension } from "./render.ts"
import { createScheduleExtension } from "./schedule.ts"
import { createScratchpadExtension, type Scratchpad } from "./scratchpad.ts"
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
}

export function createPicoExtensions(options: PicoExtensionOptions): {
  extensions: Extension[]
  services: PicoExtensionServices
} {
  const { host, dataDir } = options
  const jobs = createJobsExtension(host, dataDir)
  const scratchpad = createScratchpadExtension(host, dataDir)
  return {
    extensions: [
      createAskExtension(),
      createRenderExtension(),
      createScheduleExtension(host),
      createWatchExtension(host),
      jobs.extension,
      scratchpad.extension,
      createTodoExtension(),
    ],
    services: { jobs: jobs.runner, scratch: scratchpad.scratch },
  }
}
