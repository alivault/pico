/**
 * Pico's own settings, in `~/.pico/settings.json`. Model defaults, compaction,
 * and retry come from Pi's settings instead, so Pico and Pi agree.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type Transport = "auto" | "sse" | "websocket" | "websocket-cached"
export type CacheRetention = "standard" | "long"

export type PicoSettingsData = {
  hideThinkingBlock: boolean
  transport: Transport
  cacheRetention: CacheRetention
}

const DEFAULTS: PicoSettingsData = {
  hideThinkingBlock: false,
  transport: "auto",
  cacheRetention: "standard",
}

export class PicoSettings {
  readonly #file: string
  #data: PicoSettingsData

  constructor(file: string) {
    this.#file = file
    let stored: Partial<PicoSettingsData> = {}
    try {
      stored = JSON.parse(
        readFileSync(file, "utf8")
      ) as Partial<PicoSettingsData>
    } catch {
      // No settings yet.
    }
    this.#data = { ...DEFAULTS, ...stored }
  }

  get data(): Readonly<PicoSettingsData> {
    return this.#data
  }

  update(change: Partial<PicoSettingsData>) {
    this.#data = { ...this.#data, ...change }
    mkdirSync(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.tmp`
    writeFileSync(temporary, JSON.stringify(this.#data, null, 2))
    renameSync(temporary, this.#file)
  }
}
