/**
 * Dev servers that an agent starts. A job that prints a local address, as
 * Vite's `Local: http://localhost:5173/`, or the agent's browser on a local
 * address, sends `preview_available`, so the web client can show the page
 * in the Preview of the Browser tab (`preview-proxy.ts`).
 */
import { connect } from "node:net"
import { setTimeout as delay } from "node:timers/promises"

import type { ConversationId } from "@earendil-works/pi-durable"

import { agentIdOf, type HostServices } from "../extensions/host.ts"
import { plainText } from "./job-log.ts"

export type PreviewAvailableEvent = {
  type: "preview_available"
  agentId: string
  cwd: string
  port: number
  path: string
}

const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s"'<>`)\]]*)?/gi

/** The local addresses in text, without terminal colors, in order. */
export function findLocalUrls(text: string) {
  const found: Array<{ port: number; path: string }> = []
  for (const match of plainText(text).matchAll(LOCAL_URL)) {
    const port = Number(match[1])
    if (port <= 0 || port >= 65536) continue
    if (found.some((entry) => entry.port === port)) continue
    found.push({ port, path: match[2] ?? "/" })
  }
  return found
}

/** Whether something listens on a local port. */
export function isListening(port: number, timeoutMs = 1000) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: "localhost", port })
    const done = (listening: boolean) => {
      socket.destroy()
      resolve(listening)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

/**
 * Whether a Pico server listens on a local port: this one or another. An
 * agent that opens Pico in its browser does not start a dev server, and
 * Pico cannot show itself in the Preview.
 */
export async function isPicoServer(port: number, timeoutMs = 1000) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/system/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const health = (await response.json()) as { engine?: unknown }
    return health.engine === "pi-durable"
  } catch {
    return false
  }
}

/**
 * Tell the clients of a dev server that an agent started or opened. True
 * when the port listens, is not a Pico server, and the clients were told.
 */
export async function announcePreview(
  services: Pick<HostServices, "agents" | "events">,
  conversationId: ConversationId,
  cwd: string,
  url: { port: number; path: string }
) {
  // Some servers print the address a moment before they listen.
  let listening = false
  for (let attempt = 0; attempt < 5 && !listening; attempt += 1) {
    if (attempt > 0) await delay(1000)
    listening = await isListening(url.port)
  }
  if (!listening || (await isPicoServer(url.port))) return false
  const agentId =
    services.agents.current(agentIdOf(conversationId)) ??
    agentIdOf(conversationId)
  const event: PreviewAvailableEvent = {
    type: "preview_available",
    agentId,
    cwd,
    port: url.port,
    path: url.path,
  }
  services.events.push(event, { agentId })
  return true
}

/** How much output of a job the search reads. Dev servers print early. */
const SCAN_LIMIT = 64 * 1024

/**
 * Finds the local addresses in a job's output as it comes. Each port
 * counts one time for a job.
 */
export class DevServerScanner {
  #scanned = 0
  #tail = ""
  readonly #seen = new Set<number>()
  readonly #onFound: (url: { port: number; path: string }) => void

  constructor(onFound: (url: { port: number; path: string }) => void) {
    this.#onFound = onFound
  }

  output(data: string) {
    if (this.#scanned >= SCAN_LIMIT) return
    this.#scanned += data.length
    // Keep the open line, so an address split over two chunks is found.
    const text = this.#tail + data
    const lineEnd = text.lastIndexOf("\n")
    this.#tail = lineEnd < 0 ? text.slice(-512) : text.slice(lineEnd + 1)
    const complete = lineEnd < 0 ? "" : text.slice(0, lineEnd)
    for (const url of findLocalUrls(complete)) {
      if (this.#seen.has(url.port)) continue
      this.#seen.add(url.port)
      this.#onFound(url)
    }
  }
}
