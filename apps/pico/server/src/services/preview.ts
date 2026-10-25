/**
 * Preview proxies: one listener port for each previewed dev server.
 *
 * A dev server listens on `localhost` of this machine, which a phone on the
 * network cannot reach. A preview proxy listens on the same host as Pico, on
 * a port from a range (default 4100–4199), and forwards HTTP and WebSocket
 * traffic (for hot reload) to the dev server. Paths stay at `/`, so apps that
 * use absolute paths work.
 *
 * When the browser reaches Pico through Tailscale Serve (HTTPS), it does not
 * show an HTTP page in a frame. Then Pico also serves the preview port with
 * Tailscale Serve, so the preview gets its own HTTPS origin on the same host
 * (`https://<machine>.ts.net:<port>/`).
 *
 * Only local targets are allowed. Anyone who can reach Pico can reach a
 * previewed dev server; that is the same trust as Pico's terminals.
 */
import { execFile } from "node:child_process"
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

/** Runs the `tailscale` command with arguments and gives its stdout. */
export type TailscaleRunner = (args: string[]) => Promise<string>

const runTailscale: TailscaleRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      "tailscale",
      args,
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const code = (error as NodeJS.ErrnoException).code
        reject(
          new Error(
            code === "ENOENT"
              ? "The tailscale command is not installed"
              : stderr.trim() || error.message
          )
        )
      }
    )
  })

type ServeStatus = {
  TCP?: Record<string, unknown>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
}

/**
 * Tailscale Serve entries for preview ports. Pico removes only the entries
 * that it added.
 */
export class TailscalePreviewServe {
  readonly #run: TailscaleRunner
  readonly #urls = new Map<number, Promise<string>>()
  readonly #owned = new Set<number>()

  constructor(run: TailscaleRunner = runTailscale) {
    this.#run = run
  }

  /** The HTTPS address of a port; adds the Serve entry when it is missing. */
  url(port: number, target: string) {
    let url = this.#urls.get(port)
    if (!url) {
      url = this.#serve(port, target)
      this.#urls.set(port, url)
      url.catch(() => this.#urls.delete(port))
    }
    return url
  }

  async remove(port: number) {
    this.#urls.delete(port)
    if (!this.#owned.delete(port)) return
    await this.#run(["serve", `--https=${port}`, "off"])
  }

  async #status() {
    return JSON.parse(
      (await this.#run(["serve", "status", "--json"])) || "{}"
    ) as ServeStatus
  }

  /** The `host:port` key of the Serve entry for a port, if it is there. */
  #entry(status: ServeStatus, port: number) {
    const key = Object.keys(status.Web ?? {}).find((name) =>
      name.endsWith(`:${port}`)
    )
    if (key) return { key, proxy: status.Web?.[key]?.Handlers?.["/"]?.Proxy }
    return status.TCP?.[String(port)] ? { key: undefined } : undefined
  }

  async #serve(port: number, target: string) {
    let entry = this.#entry(await this.#status(), port)
    if (!entry) {
      await this.#run(["serve", "--bg", `--https=${port}`, target])
      this.#owned.add(port)
      entry = this.#entry(await this.#status(), port)
    }
    if (!entry?.key || entry.proxy?.replace(/\/$/, "") !== target)
      throw new Error(
        `Tailscale Serve already uses port ${port} for something else`
      )
    return `https://${entry.key}/`
  }
}

/** True when the browser reaches Pico at a Tailscale (MagicDNS) host. */
export function isTailscaleRequest(request: IncomingMessage) {
  const host = request.headers.host ?? ""
  return /\.ts\.net(:\d+)?$/i.test(host)
}

/**
 * The HTTPS address of a preview, for a browser that shows Pico on HTTPS.
 * The result goes into the answer of `/api/session/preview/ensure`.
 */
export async function previewHttps(
  previews: PreviewProxies | undefined,
  port: number,
  request: IncomingMessage,
  wanted: unknown
): Promise<{ httpsUrl?: string; httpsError?: string }> {
  if (wanted !== true || !previews) return {}
  if (!isTailscaleRequest(request))
    return {
      httpsError:
        "Pico gives previews an HTTPS address only through Tailscale Serve",
    }
  try {
    return { httpsUrl: await previews.httpsUrl(port) }
  } catch (error) {
    return {
      httpsError: error instanceof Error ? error.message : String(error),
    }
  }
}

export class PreviewProxies {
  readonly #host: string
  readonly #range: () => { start: number; end: number }
  readonly #serve: TailscalePreviewServe | undefined
  readonly #servers = new Map<
    number,
    { server: Server; proxy: PreviewProxy; sockets: Set<Duplex> }
  >()

  constructor(
    host: string,
    range: () => { start: number; end: number },
    serve?: TailscalePreviewServe
  ) {
    this.#host = host
    this.#range = range
    this.#serve = serve
  }

  /** The HTTPS address of an open proxy, through Tailscale Serve. */
  async httpsUrl(port: number) {
    if (!this.#servers.has(port)) throw new Error(`No preview on port ${port}`)
    if (!this.#serve) throw new Error("HTTPS previews are not available")
    const host =
      this.#host === "0.0.0.0" || this.#host === "::" || this.#host === ""
        ? "127.0.0.1"
        : this.#host.includes(":")
          ? `[${this.#host}]`
          : this.#host
    return this.#serve.url(port, `http://${host}:${port}`)
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
          // Without a cache header, a browser keeps old pages for a time,
          // and Reload shows them. Make it ask the dev server each time.
          const headers = { ...reply.headers }
          headers["cache-control"] ??= "no-cache"
          response.writeHead(reply.statusCode ?? 502, headers)
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
    await this.#serve?.remove(port).catch((error: unknown) => {
      console.warn(
        `[pico] could not remove the Tailscale Serve entry for port ${port}: ${error instanceof Error ? error.message : String(error)}`
      )
    })
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
