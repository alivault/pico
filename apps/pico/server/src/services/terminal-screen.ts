/**
 * A server-side screen for a terminal: a headless xterm that gets the same
 * output as the viewers, so an agent can read what a person sees (the
 * visible rows of a full-screen program, or the recent lines).
 *
 * A screen exists only for terminals that an agent reads. It keeps
 * `SCROLLBACK` lines, and goes away when the terminal exits.
 */
import { createRequire } from "node:module"

import type { Terminal as HeadlessTerminal } from "@xterm/headless"

export const SCROLLBACK = 1000

type HeadlessModule = typeof import("@xterm/headless")

let headless: HeadlessModule | undefined

/** Load xterm only when the first screen is made. */
function loadHeadless() {
  headless ??= createRequire(import.meta.url)(
    "@xterm/headless"
  ) as HeadlessModule
  return headless
}

export class TerminalScreen {
  readonly #terminal: HeadlessTerminal
  #pending: Promise<void> = Promise.resolve()
  #disposed = false

  constructor(cols: number, rows: number) {
    const { Terminal } = loadHeadless()
    this.#terminal = new Terminal({
      cols,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    })
  }

  write(data: string) {
    if (this.#disposed || !data) return
    this.#pending = new Promise((resolve) => {
      this.#terminal.write(data, resolve)
    })
  }

  resize(cols: number, rows: number) {
    if (this.#disposed) return
    this.#terminal.resize(cols, rows)
  }

  /** Wait until all written output is on the screen. */
  async flush() {
    await this.#pending
  }

  get size() {
    return { cols: this.#terminal.cols, rows: this.#terminal.rows }
  }

  /** The rows on the screen now, as a person sees them. */
  async visible() {
    await this.flush()
    const buffer = this.#terminal.buffer.active
    const rows: string[] = []
    for (let row = 0; row < this.#terminal.rows; row += 1)
      rows.push(
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ""
      )
    return {
      rows,
      cursor: { row: buffer.cursorY, col: buffer.cursorX },
      alternate: this.#terminal.buffer.active.type === "alternate",
    }
  }

  /** The last `count` lines, scrollback included; wrapped lines joined. */
  async recent(count: number) {
    await this.flush()
    const buffer = this.#terminal.buffer.active
    const lines: string[] = []
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
      else lines.push(text)
    }
    while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop()
    return lines.slice(-count)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#terminal.dispose()
  }
}

/** Trim the blank rows at the end of a screen. */
export function trimRows(rows: string[]) {
  const copy = [...rows]
  while (copy.length > 0 && !copy[copy.length - 1]!.trim()) copy.pop()
  return copy
}
