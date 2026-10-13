/**
 * Preview proxies: one listener port for each previewed dev server.
 *
 * A dev server listens on `localhost` of this machine, which a phone on the
 * network cannot reach. A preview proxy listens on the same host as Pico, on
 * a port from a range (default 4100–4199), and forwards HTTP and WebSocket
 * traffic (for hot reload) to the dev server. Paths stay at `/`, so apps that
 * use absolute paths work.
 *
 * Only local targets are allowed. Anyone who can reach Pico can reach a
 * previewed dev server; that is the same trust as Pico's terminals.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
} from "node:http"
import { connect, type Socket } from "node:net"
import type { Duplex } from "node:stream"

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
])

export type PreviewProxy = {
  port: number
  target: string
  sessionId: string
  createdAt: number
}

export function parsePortRange(value: string | undefined) {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(value?.trim() ?? "")
  const start = Number(match?.[1] ?? 4100)
  const end = Number(match?.[2] ?? 4199)
  return start > 0 && end >= start && end < 65536
    ? { start, end }
    : { start: 4100, end: 4199 }
}

/** A local target URL, or an error for any other host. */
export function localTarget(value: string) {
  const url = new URL(/^\w+:\/\//.test(value) ? value : `http://${value}`)
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Only http and https previews are supported")
  if (!LOCAL_HOSTS.has(url.hostname))
    throw new Error(
      `Only local dev servers can be previewed (localhost, 127.0.0.1), not ${url.hostname}`
    )
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  return url
}

export class PreviewProxies {
  readonly #host: string
  readonly #range: () => { start: number; end: number }
  readonly #servers = new Map<
    number,
    { server: Server; proxy: PreviewProxy; sockets: Set<Duplex> }
  >()

  constructor(host: string, range: () => { start: number; end: number }) {
    this.#host = host
    this.#range = range
  }

  list() {
    return [...this.#servers.values()].map((entry) => entry.proxy)
  }

  /** The proxy of a target, opened when it does not exist yet. */
  async open(targetValue: string, sessionId: string): Promise<PreviewProxy> {
    const target = localTarget(targetValue)
    const origin = target.origin
    for (const entry of this.#servers.values())
      if (entry.proxy.target === origin) return entry.proxy
    const { start, end } = this.#range()
    let lastError: unknown
    for (let port = start; port <= end; port += 1) {
      if (this.#servers.has(port)) continue
      try {
        return await this.#listen(port, target, sessionId)
      } catch (error) {
        lastError = error
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
      }
    }
    throw new Error(
      `No free preview port in ${start}-${end}${lastError instanceof Error ? `: ${lastError.message}` : ""}`
    )
  }

  #listen(port: number, target: URL, sessionId: string) {
    const sockets = new Set<Duplex>()
    const server = createServer((request, response) => {
      const upstream = httpRequest(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          method: request.method,
          path: request.url,
          headers: { ...request.headers, host: target.host },
        },
        (reply) => {
          response.writeHead(reply.statusCode ?? 502, reply.headers)
          reply.pipe(response)
        }
      )
      upstream.on("error", (error) => {
        if (!response.headersSent)
          response.writeHead(502, {
            "content-type": "text/plain; charset=utf-8",
          })
        response.end(
          `Pico preview: the dev server at ${target.origin} does not answer (${error.message}).`
        )
      })
      request.pipe(upstream)
    })
    server.on(
      "upgrade",
      (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        const upstream: Socket = connect(
          Number(target.port || 80),
          target.hostname,
          () => {
            const headers = { ...request.headers, host: target.host }
            const lines = [
              `${request.method} ${request.url} HTTP/${request.httpVersion}`,
              ...Object.entries(headers).flatMap(([key, value]) =>
                Array.isArray(value)
                  ? value.map((item) => `${key}: ${item}`)
                  : value === undefined
                    ? []
                    : [`${key}: ${value}`]
              ),
            ]
            upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
            if (head.length > 0) upstream.write(head)
            upstream.pipe(socket)
            socket.pipe(upstream)
          }
        )
        sockets.add(upstream)
        upstream.on("close", () => {
          sockets.delete(upstream)
          socket.destroy()
        })
        socket.on("close", () => upstream.destroy())
        upstream.on("error", () => socket.destroy())
        socket.on("error", () => upstream.destroy())
      }
    )
    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    })
    return new Promise<PreviewProxy>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, this.#host, () => {
        server.off("error", reject)
        const proxy: PreviewProxy = {
          port,
          target: target.origin,
          sessionId,
          createdAt: Date.now(),
        }
        this.#servers.set(port, { server, proxy, sockets })
        resolve(proxy)
      })
    })
  }

  async close(port: number) {
    const entry = this.#servers.get(port)
    if (!entry) return false
    this.#servers.delete(port)
    for (const socket of entry.sockets) socket.destroy()
    await new Promise<void>((resolve) => entry.server.close(() => resolve()))
    return true
  }

  async shutdown() {
    await Promise.all([...this.#servers.keys()].map((port) => this.close(port)))
  }
}

/** Wait until a URL answers (any HTTP status), up to `timeoutMs`. */
export async function waitForUrl(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
) {
  const deadline = Date.now() + timeoutMs
  let lastError = ""
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted")
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        redirect: "manual",
      })
      await response.body?.cancel()
      return response.status
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `${url} did not answer within ${Math.round(timeoutMs / 1000)}s (${lastError})`
  )
}
