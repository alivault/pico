import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"

const MAX_BODY_BYTES = 64 * 1024 * 1024

/** An error with an HTTP status; its message goes to the client as `{ ok: false, error }`. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const badRequest = (message: string) => new ApiError(400, message)
export const notFound = (message: string) => new ApiError(404, message)
export const conflict = (message: string) => new ApiError(409, message)
export const unavailable = (message: string) => new ApiError(503, message)

export type Request = {
  readonly raw: IncomingMessage
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly params: Record<string, string>
  body<T = Record<string, unknown>>(): Promise<T>
}

export type Handler = (
  request: Request,
  response: ServerResponse
) => Promise<unknown> | unknown

type Route = {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

/** Marker a handler returns when it wrote the response itself. */
export const HANDLED = Symbol("handled")

export class Router {
  readonly #routes: Route[] = []

  get(path: string, handler: Handler) {
    return this.add("GET", path, handler)
  }

  post(path: string, handler: Handler) {
    return this.add("POST", path, handler)
  }

  delete(path: string, handler: Handler) {
    return this.add("DELETE", path, handler)
  }

  add(method: string, path: string, handler: Handler) {
    const keys: string[] = []
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z]+)/g, (_match, key: string) => {
        keys.push(key)
        return "([^/]+)"
      })}$`
    )
    this.#routes.push({ method, pattern, keys, handler })
    return this
  }

  /** Whether a route matches the path for any method. */
  matches(path: string) {
    return this.#routes.some((route) => route.pattern.test(path))
  }

  async handle(raw: IncomingMessage, response: ServerResponse) {
    const url = new URL(raw.url ?? "/", "http://localhost")
    const method = raw.method ?? "GET"
    for (const route of this.#routes) {
      if (route.method !== method) continue
      const match = route.pattern.exec(url.pathname)
      if (!match) continue
      const params: Record<string, string> = {}
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? "")
      })
      let parsedBody: Promise<unknown> | undefined
      const request: Request = {
        raw,
        method,
        path: url.pathname,
        query: url.searchParams,
        params,
        body: <T>() => (parsedBody ??= readJsonBody(raw)) as Promise<T>,
      }
      try {
        const result = await route.handler(request, response)
        if (result === HANDLED || response.headersSent) return true
        sendJson(response, 200, result ?? { ok: true })
      } catch (error) {
        sendError(response, error)
      }
      return true
    }
    return false
  }
}

export function sendJson(response: ServerResponse, status: number, value: unknown) {
  if (response.headersSent) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

export function sendError(response: ServerResponse, error: unknown) {
  const status = error instanceof ApiError ? error.status : 500
  const message = error instanceof Error ? error.message : String(error)
  if (status >= 500) console.error("[pico] request failed:", error)
  if (response.headersSent) {
    response.end()
    return
  }
  sendJson(response, status, { ok: false, error: message })
}

async function readJsonBody(raw: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of raw) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large")
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest("Request body must be JSON")
  }
}

/** A server-sent event stream with keepalives. */
export class SseStream {
  readonly #response: ServerResponse
  readonly #keepalive: NodeJS.Timeout
  #closed = false
  readonly closed: Promise<void>

  constructor(request: IncomingMessage, response: ServerResponse) {
    this.#response = response
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })
    response.flushHeaders()
    this.#keepalive = setInterval(() => this.comment("keepalive"), 15_000)
    this.closed = new Promise((resolveClosed) => {
      const close = () => {
        this.#closed = true
        clearInterval(this.#keepalive)
        resolveClosed()
      }
      request.on("close", close)
      response.on("close", close)
    })
  }

  get isClosed() {
    return this.#closed
  }

  send(payload: unknown, id?: number) {
    if (this.#closed) return
    const lines = id === undefined ? "" : `id: ${id}\n`
    this.#response.write(`${lines}data: ${JSON.stringify(payload)}\n\n`)
  }

  comment(text: string) {
    if (this.#closed) return
    this.#response.write(`: ${text}\n\n`)
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    clearInterval(this.#keepalive)
    this.#response.end()
  }
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
}

/**
 * Serve the built single-page app. Unknown paths fall back to `index.html`, except
 * API and event routes, which must never answer with the app shell.
 */
export async function serveStatic(
  webDir: string,
  raw: IncomingMessage,
  response: ServerResponse
) {
  const url = new URL(raw.url ?? "/", "http://localhost")
  const pathname = decodeURIComponent(url.pathname)
  if (pathname.startsWith("/api/") || pathname === "/events") return false
  const root = resolve(webDir)
  const candidate = normalize(join(root, pathname))
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return false

  let file = candidate
  let info = await stat(file).catch(() => undefined)
  if (info?.isDirectory()) {
    file = join(file, "index.html")
    info = await stat(file).catch(() => undefined)
  }
  if (!info?.isFile()) {
    if (extname(pathname)) return false
    file = join(root, "index.html")
    info = await stat(file).catch(() => undefined)
    if (!info?.isFile()) return false
  }
  const immutable = file.includes(`${sep}assets${sep}`)
  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  })
  if (raw.method === "HEAD") {
    response.end()
    return true
  }
  createReadStream(file).pipe(response)
  return true
}

/** Read a string field, trimmed; empty strings count as absent. */
export function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
