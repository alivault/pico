/**
 * Find out when a background job waits for input.
 *
 * Two signs, checked only after the job is quiet for a moment:
 * - The terminal has ECHO off and line editing on: a password or secret
 *   prompt (getpass and ssh do this). `stty` reads the mode from the
 *   terminal's device, so no native code is needed. A full-screen program
 *   or a readline shortcut handler (for example Vite's) turns off line
 *   editing too, so that alone is not a sign.
 * - The last line looks like a prompt (ends with `:` or `?`, a `[y/N]`
 *   choice, or a shell prompt), and nothing came for a few seconds.
 *
 * After the user presses Enter in a waiting job, a job that shows no new
 * output and still waits is reported, so the agent does not wait in silence.
 */
import { execFile } from "node:child_process"

import { plainLine } from "./job-log.ts"

/** Quiet time before the first check. */
export const QUIET_MS = 1500
/** Quiet time before a prompt-like last line counts as a prompt. */
export const PROMPT_QUIET_MS = 5000
/** Time after Enter in which a waiting job must show a change. */
export const INPUT_CHECK_MS = 3000
const TAIL_CHARS = 4096

export type TerminalMode = { echo: boolean; icanon: boolean }

/** The ECHO and ICANON flags of a terminal device; undefined when unknown. */
export function readTerminalMode(
  device: string | undefined
): Promise<TerminalMode | undefined> {
  if (!device || process.platform === "win32") return Promise.resolve(undefined)
  const flag = process.platform === "linux" ? "-F" : "-f"
  return new Promise((resolve) => {
    execFile(
      "stty",
      ["-a", flag, device],
      { timeout: 2000 },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        resolve(parseTerminalMode(stdout))
      }
    )
  })
}

export function parseTerminalMode(stty: string): TerminalMode | undefined {
  const words = new Set(stty.split(/[\s;]+/))
  const echo = words.has("echo") ? true : words.has("-echo") ? false : undefined
  const icanon = words.has("icanon")
    ? true
    : words.has("-icanon")
      ? false
      : undefined
  if (echo === undefined || icanon === undefined) return undefined
  return { echo, icanon }
}

/** Whether a line of output looks like a prompt for input. */
export function promptLike(line: string) {
  const text = line.trim()
  if (!text || text.length > 200) return false
  return (
    /[:?]$/.test(text) ||
    /\[[yn]\/[yn]\]\s*[:?]?$/i.test(text) ||
    /\((?:yes\/no|y\/n)[^)]*\)\s*[:?]?$/i.test(text) ||
    /[$#❯]$/.test(text) ||
    /(^|\s)>$/.test(text)
  )
}

/** The last line of terminal output that is not empty, as plain text. */
export function lastLine(output: string) {
  const lines = output.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = plainLine(lines[index]!)
    if (line.trim()) return line
  }
  return ""
}

export type InputWaitEvents = {
  /** The job started to wait for input. */
  waiting(prompt: string, secret: boolean): void
  /** The job wrote output again after it waited. */
  resumed(): void
  /** The user pressed Enter, but the job still waits and shows nothing new. */
  ignored(prompt: string, secret: boolean): void
}

/** Watches one job's output and input for the signs of a prompt. */
export class InputWaitWatcher {
  readonly #device: string | undefined
  readonly #events: InputWaitEvents
  readonly #readMode: typeof readTerminalMode
  readonly #quietMs: number
  readonly #promptQuietMs: number
  readonly #inputCheckMs: number
  #tail = ""
  #lastOutputAt = Date.now()
  #waiting: { prompt: string; secret: boolean } | undefined
  #timer: NodeJS.Timeout | undefined
  #inputTimer: NodeJS.Timeout | undefined
  #checking = false
  #stopped = false
  readonly #promptLines: boolean

  constructor(
    device: string | undefined,
    events: InputWaitEvents,
    options: {
      readMode?: typeof readTerminalMode
      quietMs?: number
      promptQuietMs?: number
      inputCheckMs?: number
      /** Count a prompt-like last line as a wait (default true). */
      promptLines?: boolean
    } = {}
  ) {
    this.#promptLines = options.promptLines ?? true
    this.#device = device
    this.#events = events
    this.#readMode = options.readMode ?? readTerminalMode
    this.#quietMs = options.quietMs ?? QUIET_MS
    this.#promptQuietMs = options.promptQuietMs ?? PROMPT_QUIET_MS
    this.#inputCheckMs = options.inputCheckMs ?? INPUT_CHECK_MS
    this.#schedule(this.#quietMs)
  }

  get waiting() {
    return this.#waiting
  }

  output(data: string) {
    if (this.#stopped || !data) return
    this.#lastOutputAt = Date.now()
    this.#tail = (this.#tail + data).slice(-TAIL_CHARS)
    if (this.#inputTimer) {
      clearTimeout(this.#inputTimer)
      this.#inputTimer = undefined
    }
    // An echo of what the user types is not new output: keep waiting until
    // a line ends.
    if (this.#waiting && /[\r\n]/.test(data)) {
      this.#waiting = undefined
      this.#events.resumed()
    }
    this.#schedule(this.#quietMs)
  }

  input(data: string) {
    if (this.#stopped || !this.#waiting || !/[\r\n]/.test(data)) return
    const sentAt = Date.now()
    if (this.#inputTimer) clearTimeout(this.#inputTimer)
    this.#inputTimer = setTimeout(() => {
      this.#inputTimer = undefined
      void this.#checkInput(sentAt)
    }, this.#inputCheckMs)
    this.#inputTimer.unref()
  }

  stop() {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    if (this.#inputTimer) clearTimeout(this.#inputTimer)
  }

  #schedule(ms: number) {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#check()
    }, ms)
    this.#timer.unref()
  }

  async #state() {
    const mode = await this.#readMode(this.#device)
    const prompt = lastLine(this.#tail)
    const secret = Boolean(mode && !mode.echo && mode.icanon)
    const quiet = Date.now() - this.#lastOutputAt
    if (secret) return { prompt, secret, waiting: true, retryIn: 0 }
    if (this.#promptLines && promptLike(prompt)) {
      if (quiet >= this.#promptQuietMs)
        return { prompt, secret, waiting: true, retryIn: 0 }
      return {
        prompt,
        secret,
        waiting: false,
        retryIn: this.#promptQuietMs - quiet,
      }
    }
    return { prompt, secret, waiting: false, retryIn: 0 }
  }

  async #check() {
    if (this.#stopped || this.#waiting || this.#checking) return
    this.#checking = true
    const outputAt = this.#lastOutputAt
    try {
      const state = await this.#state()
      // Output came while stty ran: a later check decides.
      if (this.#stopped || outputAt !== this.#lastOutputAt) return
      if (state.waiting) {
        this.#waiting = { prompt: state.prompt, secret: state.secret }
        this.#events.waiting(state.prompt, state.secret)
      } else if (state.retryIn > 0) this.#schedule(state.retryIn)
    } finally {
      this.#checking = false
    }
  }

  async #checkInput(sentAt: number) {
    if (this.#stopped || this.#lastOutputAt > sentAt) return
    const state = await this.#state()
    if (this.#stopped || this.#lastOutputAt > sentAt) return
    // A prompt-like line counts here at once: the job had the whole wait.
    if (state.secret || (this.#promptLines && promptLike(state.prompt)))
      this.#events.ignored(state.prompt, state.secret)
  }
}
