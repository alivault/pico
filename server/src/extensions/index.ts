/**
 * Pico's own extensions, in install order. Their prompt sections render after
 * the `pico` prompt extension, so sections that change often come last and
 * keep the provider prompt cache warm.
 */
import type { Extension } from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"

export type PicoExtensionOptions = {
  host: HostBridge
  dataDir: string
}

export function createPicoExtensions(
  _options: PicoExtensionOptions
): Extension[] {
  return []
}
