/**
 * Previews of dev servers for the Browser tab. The web client shows a dev
 * server, such as `localhost:5173` on a machine, in an iframe:
 *
 *   iframe → http://<page host>:<listener>/<path>      (this module, hub)
 *          → http://localhost:<port>/<path>            (local machine)
 *          → <remote Smith>/api/preview-proxy/<port>/<path>
 *            → http://localhost:<port>/<path>          (remote machine)
 *
 * Each preview gets its own listener port on the hub, so the page of the
 * dev server has its own origin. Its paths stay as they are, so absolute
 * paths and hot reload sockets work, and Smith's origin check keeps it away
 * from the Smith API. Network access is the same as for Smith itself.
 *
 * When the user opens Smith over HTTPS through Tailscale Serve, the listener
 * also gets a Serve entry on the same port (services/tailscale-serve.ts),
 * so the iframe loads `https://<machine>.ts.net:<listener>/<path>`.
 *
 * The listener puts a small script into HTML pages, which tells Smith the
 * page's background color (services/preview-background.ts).
 */
import {
  createServer,
  request as httpRequest,
  type Agent,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http"
import { connect as netConnect, type AddressInfo, type Socket } from "node:net"
import type { Duplex } from "node:stream"

import type { MachineManager } from "../machines/manager.ts"
import type { Security } from "../security.ts"
import { isSmithServer } from "./dev-server-url.ts"
import { previewPage } from "./preview-background.ts"
import { serveTarget, type TailscaleServe } from "./tailscale-serve.ts"

/** The hub sets it on requests to `/api/preview-proxy/`. */
export const PREVIEW_PROXY_HEADER = "x-smith-preview-proxy"
/** The browser request had an Origin header (the hub removes it). */
const PREVIEW_ORIGIN_HEADER = "x-smith-preview-origin"

const LOCAL_MACHINE_ID = "local"
const MAX_LISTENERS = 32

/** `/api/preview-proxy/<port>/<path>`: the port and the dev server path. */
export function previewProxyRoute(url: string) {
  const match = /^\/api\/preview-proxy\/(\d{1,5})(\/[^?#]*)?(\?[^#]*)?$/.exec(
    url
  )
  if (!match) return undefined
  const port = Number(match[1])
  if (!validPort(port)) return undefined
  return { port, path: `${match[2] ?? "/"}${match[3] ?? ""}` }
}

export function validPort(port: unknown): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536
  )
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
  PREVIEW_PROXY_HEADER,
  PREVIEW_ORIGIN_HEADER,
])

type Target = {
  endpoint: { host: string; port: number } | { socketPath: string }
  agent?: Agent | false
  path: string
  headers: OutgoingHttpHeaders
  socket: () => Socket
}

/** The request headers for the dev server on this machine. */
function localHeaders(headers: IncomingHttpHeaders, port: number) {
  const result: OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers))
    if (value !== undefined && !HOP_BY_HOP.has(key)) result[key] = value
  // Dev servers such as Vite allow only known hosts and origins.
  result.host = `localhost:${port}`
  if (headers.origin || headers[PREVIEW_ORIGIN_HEADER])
    result.origin = `http://localhost:${port}`
  return result
}

function localTarget(
  headers: IncomingHttpHeaders,
  port: number,
  path: string
): Target {
  return {
    endpoint: { host: "localhost", port },
    path,
    headers: localHeaders(headers, port),
    socket: () => netConnect({ host: "localhost", port }),
  }
}

/**
 * The response headers for the iframe: no frame block, and redirects to the
 * dev server stay in the preview.
 */
function previewResponseHeaders(headers: IncomingHttpHeaders, port: number) {
  const result: OutgoingHttpHeaders = { ...headers }
  delete result.connection
  delete result["keep-alive"]
  delete result["x-frame-options"]
  const policy = result["content-security-policy"]
  if (typeof policy === "string") {
    const kept = policy
      .split(";")
      .filter((part) => !/^\s*frame-ancestors\b/i.test(part))
      .join(";")
    if (kept.trim()) result["content-security-policy"] = kept
    else delete result["content-security-policy"]
  }
  const location = result.location
  if (typeof location === "string") {
    const own = new RegExp(
      `^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}(?=/|$)`,
      "i"
    )
    result.location = location.replace(own, "") || "/"
  }
  return result
}

function sendText(response: ServerResponse, status: number, text: string) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" })
  response.end(text)
}

function forwardHttp(
  request: IncomingMessage,
  response: ServerResponse,
  target: Target,
  port: number,
  label: string,
  inject = false
) {
  const upstream = httpRequest(
    {
      ...target.endpoint,
      ...(target.agent !== undefined ? { agent: target.agent } : {}),
      method: request.method,
      path: target.path,
      headers: target.headers,
    },
    (reply) => {
      const headers = previewResponseHeaders(reply.headers, port)
      const page = inject ? previewPage(request, reply, headers) : undefined
      if (page) {
        response.writeHead(200, page.headers)
        page.body.once("error", () => response.destroy())
        page.body.pipe(response)
        return
      }
      response.writeHead(reply.statusCode ?? 502, headers)
      reply.pipe(response)
    }
  )
  upstream.on("error", (error: NodeJS.ErrnoException) => {
    sendText(
      response,
      502,
      error.code === "ECONNREFUSED"
        ? `Nothing listens on port ${port} on ${label}. Start the dev server, then reload.`
        : `${label}: ${error.message}`
    )
  })
  response.once("close", () => {
    if (!upstream.writableFinished || !response.writableFinished)
      upstream.destroy()
  })
  request.pipe(upstream)
}

/** Send a WebSocket upgrade on as raw bytes, for hot reload. */
function forwardUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: Target
) {
  let upstream: Socket
  try {
    upstream = target.socket()
  } catch {
    socket.destroy()
    return
  }
  upstream.once("connect", () => {
    const headers: OutgoingHttpHeaders = {
      ...target.headers,
      connection: "Upgrade",
      upgrade: request.headers.upgrade ?? "websocket",
    }
    const lines = [
      `${request.method} ${target.path} HTTP/${request.httpVersion}`,
      ...Object.entries(headers).flatMap(([key, value]) =>
        value === undefined
          ? []
          : Array.isArray(value)
            ? value.map((item) => `${key}: ${item}`)
            : [`${key}: ${value}`]
      ),
    ]
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
    if (head.length > 0) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.once("close", () => socket.destroy())
  socket.once("close", () => upstream.destroy())
  upstream.once("error", () => socket.destroy())
  socket.once("error", () => upstream.destroy())
}

/**
 * The machine side: `/api/preview-proxy/<port>/<path>` from the hub, to the
 * dev server on this machine. Only the hub sends the header; a browser
 * cannot send it in a navigation, so the dev server never gets Smith's
 * origin. False when the request is not one.
 */
export function handlePreviewProxy(
  request: IncomingMessage,
  response: ServerResponse
) {
  const route = previewProxyRoute(request.url ?? "")
  if (!route) return false
  if (request.headers[PREVIEW_PROXY_HEADER] !== "1") {
    sendText(response, 403, "Only the Smith hub can use the preview proxy.")
    return true
  }
  forwardHttp(
    request,
    response,
    localTarget(request.headers, route.port, route.path),
    route.port,
    "this machine"
  )
  return true
}

/** The machine side of a WebSocket upgrade. False when it is not one. */
export function upgradePreviewProxy(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) {
  const route = previewProxyRoute(request.url ?? "")
  if (!route) return false
  if (request.headers[PREVIEW_PROXY_HEADER] !== "1") {
    socket.destroy()
    return true
  }
  forwardUpgrade(
    request,
    socket,
    head,
    localTarget(request.headers, route.port, route.path)
  )
  return true
}

/** The preview cannot use Tailscale Serve; plain HTTP can still work. */
export class TailscalePreviewError extends Error {}

type Listener = {
  server: Server
  port: number
  used: number
  /** The Tailscale Serve port, when the listener has an entry. */
  serve?: Promise<number>
}

/** Where the browser loads a preview. */
export type OpenedPreview = {
  /** The listener port on the hub. */
  port: number
  /** The origin to load, when the page host alone does not give it. */
  url?: string
}

/** The hub side: one listener for each previewed machine and port. */
export class PreviewProxy {
  readonly #host: string
  readonly #machines: MachineManager
  readonly #security: Security
  readonly #serve: TailscaleServe | undefined
  readonly #listeners = new Map<string, Promise<Listener>>()

  constructor(
    host: string,
    machines: MachineManager,
    security: Security,
    serve?: TailscaleServe
  ) {
    this.#host = host
    this.#machines = machines
    this.#security = security
    this.#serve = serve
  }

  /**
   * The listener that shows `port` of a machine. With `tailscaleHost`, the
   * page came through Tailscale Serve over HTTPS: the listener gets a Serve
   * entry, and `url` is its HTTPS origin.
   */
  async open(
    machineId: string,
    port: number,
    tailscaleHost?: string
  ): Promise<OpenedPreview> {
    if (machineId !== LOCAL_MACHINE_ID && !this.#machines.get(machineId))
      throw new Error(`Unknown machine: ${machineId}`)
    // Smith cannot show itself: its page would load in a broken frame.
    if (machineId === LOCAL_MACHINE_ID && (await isSmithServer(port)))
      throw new Error(
        `Port ${port} is a Smith server, not a dev server. Enter the address of your dev server.`
      )
    const key = `${machineId}:${port}`
    let listener = this.#listeners.get(key)
    if (!listener) {
      listener = this.#listen(machineId, port)
      this.#listeners.set(key, listener)
      listener.catch(() => this.#listeners.delete(key))
      void this.#trim()
    }
    const opened = await listener
    opened.used = Date.now()
    if (!tailscaleHost) return { port: opened.port }
    const servePort = await this.#tailscale(opened)
    return { port: opened.port, url: `https://${tailscaleHost}:${servePort}` }
  }

  /** The Tailscale Serve port of a listener; adds the entry the first time. */
  async #tailscale(listener: Listener) {
    const serve = this.#serve
    if (!serve)
      throw new TailscalePreviewError(
        "This Smith cannot share previews over Tailscale HTTPS."
      )
    if (!listener.serve) {
      const added = serve.add(
        listener.port,
        serveTarget(this.#host, listener.port)
      )
      listener.serve = added
      added.catch(() => {
        if (listener.serve === added) listener.serve = undefined
      })
    }
    try {
      return await listener.serve
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new TailscalePreviewError(
        `Smith could not share the preview over Tailscale HTTPS: tailscale serve failed (${reason}).`
      )
    }
  }

  /** Close a listener and remove its Tailscale Serve entry. */
  async #closeListener(listener: Listener) {
    await new Promise<void>((resolve) => {
      listener.server.close(() => resolve())
      listener.server.closeAllConnections()
    })
    const serve = listener.serve
    listener.serve = undefined
    if (serve && this.#serve) {
      const servePort = await serve.catch(() => undefined)
      if (servePort !== undefined)
        await this.#serve.remove(servePort).catch(() => {})
    }
  }

  /** Close the least recently used listeners over the limit. */
  async #trim() {
    if (this.#listeners.size <= MAX_LISTENERS) return
    const entries = await Promise.all(
      [...this.#listeners].map(async ([key, listener]) => ({
        key,
        listener: await listener.catch(() => undefined),
      }))
    )
    entries
      .filter((entry) => entry.listener)
      .sort((left, right) => left.listener!.used - right.listener!.used)
      .slice(0, this.#listeners.size - MAX_LISTENERS)
      .forEach((entry) => {
        this.#listeners.delete(entry.key)
        void this.#closeListener(entry.listener!)
      })
  }

  /** How to reach the dev server; undefined when the machine is offline. */
  #target(
    machineId: string,
    port: number,
    request: IncomingMessage
  ): Target | string {
    const path = request.url ?? "/"
    if (machineId === LOCAL_MACHINE_ID)
      return localTarget(request.headers, port, path)
    const connection = this.#machines.get(machineId)
    if (!connection) return `Unknown machine: ${machineId}`
    let remote: ReturnType<typeof connection.endpoint>
    try {
      remote = connection.endpoint()
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    const headers: OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(request.headers))
      if (value !== undefined && !HOP_BY_HOP.has(key)) headers[key] = value
    headers.host = "127.0.0.1"
    headers[PREVIEW_PROXY_HEADER] = "1"
    if (request.headers.origin) headers[PREVIEW_ORIGIN_HEADER] = "1"
    return {
      endpoint: remote.endpoint,
      agent: remote.agent,
      path: `/api/preview-proxy/${port}${path}`,
      headers,
      socket: () => connection.socket(),
    }
  }

  #label(machineId: string) {
    return machineId === LOCAL_MACHINE_ID
      ? "this machine"
      : (this.#machines.get(machineId)?.profile.label ?? machineId)
  }

  async #listen(machineId: string, port: number): Promise<Listener> {
    const server = createServer((request, response) => {
      try {
        this.#security.check(request)
      } catch {
        sendText(response, 403, "Not allowed")
        return
      }
      const target = this.#target(machineId, port, request)
      if (typeof target === "string") {
        sendText(response, 503, target)
        return
      }
      // Only the hub puts in the background script, so it goes in one time.
      forwardHttp(request, response, target, port, this.#label(machineId), true)
    })
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head) => {
      try {
        this.#security.check(request)
      } catch {
        socket.destroy()
        return
      }
      const target = this.#target(machineId, port, request)
      if (typeof target === "string") {
        socket.destroy()
        return
      }
      forwardUpgrade(request, socket, head as Buffer, target)
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, this.#host, () => {
        server.off("error", reject)
        resolve()
      })
    })
    return {
      server,
      port: (server.address() as AddressInfo).port,
      used: Date.now(),
    }
  }

  async close() {
    const listeners = await Promise.all(
      [...this.#listeners.values()].map((listener) =>
        listener.catch(() => undefined)
      )
    )
    this.#listeners.clear()
    await Promise.all(
      listeners
        .filter((listener) => listener !== undefined)
        .map((listener) => this.#closeListener(listener))
    )
  }
}
