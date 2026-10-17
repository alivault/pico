/**
 * The hub's proxy to remote machines:
 *
 *   /m/<machineId>/api/...                  → remote /api/...
 *   /m/<machineId>/events                   → remote /events (SSE)
 *   /m/<machineId>/api/terminal/<id>/ws     → remote WebSocket
 *
 * The server runs `security.check()` on the browser request first. The proxy
 * sends the request with `Host: 127.0.0.1` and no `Origin`, so the remote
 * check passes. It streams bodies, never retries, and answers 503 at once
 * when the machine is not online. It forwards only `/api/` and `/events`,
 * and never `/api/system/shutdown`.
 */
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { Duplex } from "node:stream"

import { sendJson } from "../http.ts"
import type { PreviewProxies } from "../services/preview.ts"
import { MachineError, type MachineManager } from "./manager.ts"

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

  constructor(machines: MachineManager, previews: PreviewProxies) {
    this.#machines = machines
    this.#previews = previews
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
