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
  /** Save tool output larger than this many KB to the scratchpad; 0 is off. */
  scratchSpillKb: number
  /** Files that git ignores which a new worktree gets a copy of, such as `.env*`. */
  worktreeCopy: string[]
  /** Live child sessions that one session may have. */
  maxChildSessions: number
  /** How deep `spawn_session` may nest. */
  maxSpawnDepth: number
  /** Add language server errors to the results of edit and write. */
  lspAfterEdit: boolean
  /** Notify devices when a run finishes. */
  notifyRunDone: boolean
  /** Notify devices when the agent asks a question. */
  notifyNeedsInput: boolean
  /** An ntfy topic URL that gets the same notifications; empty is off. */
  ntfyUrl: string
  /** The address of Pico for links in notifications, for example a Tailscale URL. */
  publicUrl: string
  /** Ports for preview proxies, as "start-end". */
  previewPorts: string
  /** Run the durable browser without a window. */
  browserHeadless: boolean
}

export const DEFAULT_SETTINGS: PicoSettingsData = {
  hideThinkingBlock: false,
  transport: "auto",
  cacheRetention: "standard",
  scratchSpillKb: 0,
  worktreeCopy: [".env*"],
  maxChildSessions: 6,
  maxSpawnDepth: 3,
  lspAfterEdit: false,
  notifyRunDone: true,
  notifyNeedsInput: true,
  ntfyUrl: "",
  publicUrl: "",
  previewPorts: "4100-4199",
  browserHeadless: true,
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
    this.#data = { ...DEFAULT_SETTINGS, ...stored }
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
