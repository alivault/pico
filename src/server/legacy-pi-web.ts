import net from "node:net"
import process from "node:process"

import { runServe } from "../../legacy/pi-web/server.mjs"

type ProxyMethod = "GET" | "POST"

type LegacyBackendState = {
  baseUrl?: string
  error?: unknown
  readyPromise?: Promise<string>
}

const LEGACY_BACKEND_KEY = "__pi_to_go_legacy_backend__"

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

declare global {
  // eslint-disable-next-line no-var
  var __pi_to_go_legacy_backend__: LegacyBackendState | undefined
}

function getLegacyBackendState() {
  if (!globalThis[LEGACY_BACKEND_KEY as keyof typeof globalThis]) {
    globalThis.__pi_to_go_legacy_backend__ = {}
  }

  return globalThis.__pi_to_go_legacy_backend__!
}

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Failed to allocate a backend port."))
        )
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

async function waitForBackend(baseUrl: string, state: LegacyBackendState) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 20_000) {
    if (state.error) {
      throw state.error
    }

    try {
      const response = await fetch(baseUrl)
      if (response.ok) {
        return baseUrl
      }
    } catch {
      // retry until the sidecar is ready
    }

    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new Error("Timed out while starting the embedded pi-web backend.")
}

export async function ensureLegacyPiWebBackend() {
  const state = getLegacyBackendState()
  if (state.baseUrl) {
    return state.baseUrl
  }

  if (!state.readyPromise) {
    state.readyPromise = (async () => {
      const port = await getAvailablePort()
      const baseUrl = `http://127.0.0.1:${port}`
      state.baseUrl = baseUrl
      state.error = undefined

      void runServe(
        [
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--cwd",
          process.cwd(),
          "--no-open",
        ],
        { openBrowser: false }
      ).catch((error) => {
        state.error = error
        state.baseUrl = undefined
        state.readyPromise = undefined
      })

      return await waitForBackend(baseUrl, state)
    })().catch((error) => {
      state.error = error
      state.baseUrl = undefined
      state.readyPromise = undefined
      throw error
    })
  }

  return await state.readyPromise
}

function forwardHeaders(headers: Headers) {
  const nextHeaders = new Headers()

  headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      nextHeaders.set(key, value)
    }
  })

  return nextHeaders
}

export async function proxyLegacyPiWebRequest(
  request: Request,
  targetPath: string
) {
  const baseUrl = await ensureLegacyPiWebBackend()
  const sourceUrl = new URL(request.url)
  const targetUrl = new URL(targetPath, `${baseUrl}/`)
  targetUrl.search = sourceUrl.search

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: forwardHeaders(request.headers),
    redirect: "manual",
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body
    init.duplex = "half"
  }

  return await fetch(targetUrl, init)
}

export function createLegacyProxyHandlers(
  targetPath: string,
  methods: ReadonlyArray<ProxyMethod>
) {
  return Object.fromEntries(
    methods.map((method) => [
      method,
      ({ request }: { request: Request }) =>
        proxyLegacyPiWebRequest(request, targetPath),
    ])
  ) as Record<
    ProxyMethod,
    ({ request }: { request: Request }) => Promise<Response>
  >
}
