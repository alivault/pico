/**
 * The hub's proxy to remote machines:
 *
 *   /m/<machineId>/api/...                  → remote /api/...
 *   /m/<machineId>/events                   → remote /events (SSE)
 *   /m/<machineId>/api/terminal/<id>/ws     → remote WebSocket
 *
 * The server runs `security.check()` on the browser request first. The proxy
 * sends the request with `Host: 127.0.0.1` and no `Origin`, so the remote
 * check passes. It streams bodies, never retries, and answers at once when
 * the machine is not online: from the offline cache (`offline-cache.ts`)
 * for GET requests and event streams, else with 503. It forwards only
 * `/api/` and `/events`, and never `/api/system/shutdown`.
 */
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { Duplex } from "node:stream"
import { StringDecoder } from "node:string_decoder"

import { sendJson, SseStream } from "../http.ts"
import type { PreviewProxies } from "../services/preview.ts"
import { MachineError, SseParser, type MachineManager } from "./manager.ts"
import {
  cacheableGet,
  MAX_CACHED_RESPONSE_BYTES,
  OfflineCache,
} from "./offline-cache.ts"

/** `/m/<id>/<rest>`: the machine ID and the remote path, or undefined. */
export function machineRoute(url: string) {
  const match = /^\/m\/([^/?#]+)(\/[^?#]*)?(\?.*)?$/.exec(url)
  if (!match) return undefined
  return {
    machineId: decodeURIComponent(match[1]!),
    path: match[2] ?? "/",
    search: match[3] ?? "",
  }
}

/** Whether the proxy may forward a remote path. */
export function allowedRemotePath(path: string) {
  if (path === "/events") return true
  if (!path.startsWith("/api/")) return false
  if (path.includes("/../") || path.includes("/./")) return false
  return path !== "/api/system/shutdown"
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "origin",
  "referer",
  "cookie",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
])

function forwardHeaders(headers: IncomingHttpHeaders) {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(key)) continue
    result[key] = value
  }
  result.host = "127.0.0.1"
  return result
}

function offline(response: ServerResponse, error: unknown, label: string) {
  const status = error instanceof MachineError ? error.status : 502
  sendJson(response, status, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    machine: label,
    state: status === 503 ? "offline" : "error",
  })
}

export class MachineProxy {
  readonly #machines: MachineManager
  readonly #previews: PreviewProxies
  readonly #caches = new Map<string, OfflineCache>()
  /** Offline event streams; they close when their machine is online again. */
  readonly #offlineStreams = new Map<SseStream, string>()

  constructor(machines: MachineManager, previews: PreviewProxies) {
    this.#machines = machines
    this.#previews = previews
    machines.subscribe(() => {
      for (const [stream, machineId] of this.#offlineStreams) {
        const connection = machines.get(machineId)
        // The browser connects again and gets the live state.
        if (!connection || connection.online) {
          this.#offlineStreams.delete(stream)
          stream.close()
        }
      }
      for (const machineId of this.#caches.keys())
        if (!machines.get(machineId)) this.#caches.delete(machineId)
    })
  }

  #cache(machineId: string) {
    let cache = this.#caches.get(machineId)
    if (!cache) {
      cache = new OfflineCache()
      this.#caches.set(machineId, cache)
    }
    return cache
  }

  /** Answer from the offline cache; false when it has nothing. */
  #fromCache(
    request: IncomingMessage,
    response: ServerResponse,
    route: { machineId: string; path: string; search: string }
  ) {
    const cache = this.#caches.get(route.machineId)
    if (!cache || (request.method !== "GET" && request.method !== "HEAD"))
      return false
    if (route.path === "/events") {
      const query = new URLSearchParams(route.search)
      const events = cache.bootstrap(
        query.get("context")?.trim() || "default",
        query.get("session")?.trim() || undefined
      )
      if (events.length === 0) return false
      const stream = new SseStream(request, response)
      // No event IDs: the browser keeps the last live ID for its replay.
      for (const event of events) stream.send(event)
      this.#offlineStreams.set(stream, route.machineId)
      void stream.closed.then(() => this.#offlineStreams.delete(stream))
      return true
    }
    const entry = cache.response(`${route.path}${route.search}`)
    if (!entry) return false
    response.writeHead(200, {
      "content-type": entry.type,
      "content-length": entry.body.length,
      "cache-control": "no-store",
      "x-pico-offline": "1",
    })
    response.end(request.method === "HEAD" ? undefined : entry.body)
    return true
  }

  /** Handle an HTTP request to `/m/...`; false when the URL is not one. */
  handle(request: IncomingMessage, response: ServerResponse) {
    const route = machineRoute(request.url ?? "")
    if (!route) return false
    const connection = this.#machines.get(route.machineId)
    if (!connection) {
      sendJson(response, 404, {
        ok: false,
        error: `Unknown machine: ${route.machineId}`,
      })
      return true
    }
    if (!allowedRemotePath(route.path)) {
      sendJson(response, 403, {
        ok: false,
        error: `${route.path} is not available through the hub`,
      })
      return true
    }
    let target: ReturnType<typeof connection.endpoint>
    try {
      target = connection.endpoint()
    } catch (error) {
      if (!this.#fromCache(request, response, route))
        offline(response, error, connection.profile.label)
      return true
    }
    if (
      request.method === "POST" &&
      route.path === "/api/session/preview/ensure"
    ) {
      void this.#preview(request, response, route, connection)
      return true
    }
    const upstream = httpRequest(
      {
        ...target.endpoint,
        // SSE and long requests hold their socket; keep-alive is for the rest.
        agent: route.path === "/events" ? false : target.agent,
        method: request.method,
        path: `${route.path}${route.search}`,
        headers: forwardHeaders(request.headers),
      },
      (reply) => {
        const headers = { ...reply.headers }
        delete headers.connection
        delete headers["keep-alive"]
        response.writeHead(reply.statusCode ?? 502, headers)
        response.flushHeaders()
        reply.on("data", () => connection.activity())
        if (reply.statusCode === 200)
          this.#keepCopy(route, request.method ?? "GET", reply)
        reply.pipe(response)
      }
    )
    upstream.on("error", (error) => {
      if (!response.headersSent)
        offline(
          response,
          new MachineError(
            502,
            `${connection.profile.label}: ${error.message}`
          ),
          connection.profile.label
        )
      else response.destroy()
    })
    response.once("close", () => {
      if (!upstream.writableFinished || !response.writableFinished)
        upstream.destroy()
    })
    request.pipe(upstream)
    return true
  }

  /** Follow an answer for the offline cache while it streams through. */
  #keepCopy(
    route: { machineId: string; path: string; search: string },
    method: string,
    reply: IncomingMessage
  ) {
    const cache = this.#cache(route.machineId)
    if (route.path === "/events") {
      const observe = cache.observeStream(
        new URLSearchParams(route.search).get("context")?.trim() || "default"
      )
      const parser = new SseParser((data) => {
        try {
          const payload = JSON.parse(data) as unknown
          if (payload && typeof payload === "object")
            observe(payload as Record<string, unknown>)
        } catch {
          // Not JSON: nothing to keep.
        }
      })
      const decoder = new StringDecoder("utf8")
      reply.on("data", (chunk: Buffer) => parser.push(decoder.write(chunk)))
      return
    }
    const type = String(reply.headers["content-type"] ?? "")
    if (method !== "GET" || !cacheableGet(route.path) || !type.includes("json"))
      return
    const chunks: Buffer[] = []
    let size = 0
    reply.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_CACHED_RESPONSE_BYTES) chunks.push(chunk)
    })
    reply.once("end", () => {
      if (size <= MAX_CACHED_RESPONSE_BYTES)
        cache.putResponse(
          `${route.path}${route.search}`,
          type,
          Buffer.concat(chunks)
        )
    })
  }

  /**
   * The remote opens its preview proxy on its own loopback. The hub forwards
   * a local port to it and opens its own preview proxy, so the browser and
   * the phone reach it as a local preview.
   */
  async #preview(
    request: IncomingMessage,
    response: ServerResponse,
    route: { machineId: string; path: string; search: string },
    connection: NonNullable<ReturnType<MachineManager["get"]>>
  ) {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const text = Buffer.concat(chunks).toString("utf8").trim()
      const result = (await connection.request(
        "POST",
        `${route.path}${route.search}`,
        { body: text ? (JSON.parse(text) as unknown) : {} }
      )) as { ok: true; port?: number; [key: string]: unknown }
      if (typeof result.port !== "number") {
        sendJson(response, 200, result)
        return
      }
      const forward = await connection.forward(result.port)
      const proxy = await this.#previews.open(
        `http://127.0.0.1:${forward.localPort}`,
        `${route.machineId}:${typeof result.sessionId === "string" ? result.sessionId : ""}`
      )
      sendJson(response, 200, {
        ...result,
        port: proxy.port,
        remotePort: result.port,
      })
    } catch (error) {
      offline(response, error, connection.profile.label)
    }
  }

  /** Handle a WebSocket upgrade to `/m/...`; false when the URL is not one. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const route = machineRoute(request.url ?? "")
    if (!route) return false
    const connection = this.#machines.get(route.machineId)
    if (
      !connection ||
      !/^\/api\/terminal\/[^/]+\/ws$/.test(route.path) ||
      !connection.online
    ) {
      socket.destroy()
      return true
    }
    let upstream: ReturnType<typeof connection.socket>
    try {
      upstream = connection.socket()
    } catch {
      socket.destroy()
      return true
    }
    upstream.once("connect", () => {
      const headers: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue
        if (["host", "origin", "cookie", "referer"].includes(key)) continue
        headers[key] = value
      }
      headers.host = "127.0.0.1"
      const lines = [
        `${request.method} ${route.path}${route.search} HTTP/${request.httpVersion}`,
        ...Object.entries(headers).flatMap(([key, value]) =>
          Array.isArray(value)
            ? value.map((item) => `${key}: ${item}`)
            : [`${key}: ${value}`]
        ),
      ]
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on("data", () => connection.activity())
    upstream.once("close", () => socket.destroy())
    socket.once("close", () => upstream.destroy())
    upstream.once("error", () => socket.destroy())
    socket.once("error", () => upstream.destroy())
    return true
  }
}
