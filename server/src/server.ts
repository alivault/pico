/**
 * The Pico server: the durable runtime, the API, the web client, and the
 * terminal WebSocket, on one HTTP port.
 */
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { Duplex } from "node:stream"

import { WebSocketServer, type WebSocket } from "ws"

import { createApi } from "./api.ts"
import type { ServerPaths } from "./config.ts"
import { Auth, UiRequests } from "./core/auth.ts"
import { openRuntime, type Runtime } from "./core/runtime.ts"
import { parseSessionId, Sessions } from "./core/sessions.ts"
import { Viewers } from "./core/viewers.ts"
import { EventHub } from "./events.ts"
import { HostBridge } from "./extensions/host.ts"
import { ApiError, sendError, sendJson, serveStatic } from "./http.ts"
import { GitWatcher } from "./services/git.ts"
import { HighlightService } from "./services/highlight.ts"
import {
  looseNumber,
  Terminals,
  type TerminalEvent,
} from "./services/terminal.ts"
import { Security } from "./security.ts"

export type PicoServer = {
  readonly server: Server
  readonly runtime: Runtime
  readonly sessions: Sessions
  port(): number
  /** Stop taking new work, wait for runs to finish (up to `timeoutMs`), and close. */
  shutdown(options?: { drain?: boolean; timeoutMs?: number }): Promise<void>
}

export async function startServer(options: {
  paths: ServerPaths
  host: string
  port: number
  /** `pico-server stop` asked this server to drain and stop. */
  onShutdownRequest?: () => void
}): Promise<PicoServer> {
  const security = new Security(options.host)
  const host = new HostBridge()
  const runtime = await openRuntime(options.paths, host)
  const hub = new EventHub()
  const viewers = new Viewers(options.paths.viewersFile)
  const sessions = new Sessions(runtime, hub, viewers)
  const terminals = new Terminals()
  host.bind({
    sessions,
    events: hub,
    terminals,
    harness: runtime.harness,
    settings: () => runtime.settings.data,
    dataDir: options.paths.dataDir,
  })
  await sessions.load()
  await host.started()
  const ui = new UiRequests(hub)
  const auth = new Auth(runtime.models, ui, runtime.agentDir)
  const gitWatcher = new GitWatcher(hub)
  const highlight = new HighlightService()
  let draining = false
  let listeningPort = options.port

  const router = createApi({
    runtime,
    sessions,
    viewers,
    hub,
    auth,
    ui,
    gitWatcher,
    terminals,
    highlight,
    startedAt: Date.now(),
    port: () => listeningPort,
    listenHosts: () => [options.host],
    draining: () => draining,
  })
  router.post("/api/system/shutdown", (request) => {
    const remote = request.raw.socket.remoteAddress ?? ""
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
      throw new ApiError(403, "Only a local client may stop Pico")
    }
    setImmediate(() => options.onShutdownRequest?.())
    return { ok: true }
  })

  const server = createServer((request, response) => {
    void (async () => {
      try {
        security.check(request)
        if (await router.handle(request, response)) return
        const path = new URL(request.url ?? "/", "http://localhost").pathname
        if (path.startsWith("/api/") || path === "/events") {
          sendJson(response, 404, {
            ok: false,
            error: `Unknown route: ${request.method} ${path}`,
          })
          return
        }
        if (
          options.paths.webDir &&
          (await serveStatic(options.paths.webDir, request, response))
        )
          return
        sendJson(response, 404, { ok: false, error: "Not found" })
      } catch (error) {
        sendError(response, error)
      }
    })()
  })
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000

  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
  })
  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      try {
        security.check(request)
      } catch {
        socket.destroy()
        return
      }
      const url = new URL(request.url ?? "/", "http://localhost")
      const match = /^\/api\/terminal\/([^/]+)\/ws$/.exec(url.pathname)
      if (!match) {
        socket.destroy()
        return
      }
      sockets.handleUpgrade(request, socket, head, (websocket) => {
        runTerminalSocket(
          websocket,
          decodeURIComponent(match[1]!),
          url.searchParams
        )
      })
    }
  )

  /** The terminal scope for a request, as the HTTP terminal routes compute it. */
  const terminalScope = (query: URLSearchParams) => {
    const contextId = query.get("context")?.trim() || "default"
    const session = parseSessionId(
      query.get("sessionPath") ?? query.get("session") ?? undefined
    )
    const key = query.get("sessionKey")?.trim() || undefined
    const viewer = viewers.get(contextId)
    const scopeTarget =
      key ??
      session ??
      viewer?.activeDraft?.sessionKey ??
      viewer?.selectedSession ??
      "default"
    const current = sessions.current(session ?? viewer?.selectedSession)
    const cwd =
      current && sessions.has(current)
        ? sessions.meta(current).cwd
        : ((key?.startsWith("draft:") ? key.slice(6) : undefined) ??
          viewer?.activeDraft?.cwd ??
          viewer?.sidebarDirectories[0] ??
          process.cwd())
    return `${contextId}:${scopeTarget}:${cwd}`
  }

  const runTerminalSocket = (
    websocket: WebSocket,
    id: string,
    query: URLSearchParams
  ) => {
    const scopeKey = terminalScope(query)
    const send = (event: TerminalEvent) => {
      if (websocket.readyState === websocket.OPEN)
        websocket.send(JSON.stringify(event))
    }
    let subscription: ReturnType<Terminals["subscribe"]>
    try {
      subscription = terminals.subscribe(
        scopeKey,
        id,
        query.get("lastSeq") ? looseNumber(query.get("lastSeq")) : undefined,
        send
      )
    } catch (error) {
      send({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      })
      websocket.close()
      return
    }
    for (const event of subscription.initial) send(event)
    websocket.on("message", (data) => {
      let message: {
        type?: string
        data?: unknown
        inputSeq?: unknown
        cols?: unknown
        rows?: unknown
      }
      try {
        message = JSON.parse(
          (Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : data
          ).toString("utf8")
        ) as typeof message
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
      try {
        if (message.type === "input") {
          if (typeof message.data !== "string")
            throw new Error("Terminal input data is required.")
          const acknowledged = terminals.write(
            scopeKey,
            id,
            message.data,
            looseNumber(message.inputSeq)
          )
          if (acknowledged !== undefined)
            send({ type: "input_ack", inputSeq: acknowledged })
        } else if (message.type === "resize") {
          terminals.resize(
            scopeKey,
            id,
            looseNumber(message.cols),
            looseNumber(message.rows)
          )
        } else if (message.type === "ping") {
          send({ type: "pong" })
        } else {
          throw new Error("Unknown terminal message type.")
        }
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    websocket.on("close", () => subscription.unsubscribe())
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(options.port, options.host, () => {
        server.off("error", reject)
        const address = server.address()
        if (address && typeof address === "object") listeningPort = address.port
        resolve()
      })
    })
  } catch (error) {
    gitWatcher.stop()
    terminals.shutdown()
    await runtime.close()
    throw error
  }

  let closing: Promise<void> | undefined
  return {
    server,
    runtime,
    sessions,
    port: () => listeningPort,
    shutdown(shutdownOptions = {}) {
      closing ??= (async () => {
        draining = true
        if (shutdownOptions.drain) {
          const deadline =
            Date.now() + (shutdownOptions.timeoutMs ?? 10 * 60_000)
          while (sessions.activeRunCount() > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
        ui.cancelAll()
        auth.cancelLogins()
        gitWatcher.stop()
        terminals.shutdown()
        for (const client of sockets.clients) client.terminate()
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await sessions.flushMeta()
        viewers.flush()
        await runtime.close()
      })()
      return closing
    },
  }
}
