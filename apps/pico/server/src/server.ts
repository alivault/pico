/**
 * The Pico server: the durable runtime, the API, the web client, and the
 * terminal WebSocket, on one HTTP port.
 */
import { createServer, type IncomingMessage, type Server } from "node:http"
import { homedir } from "node:os"
import type { Duplex } from "node:stream"

import { WebSocketServer, type WebSocket } from "ws"

import { createApi } from "./api.ts"
import { VERSION, type ServerPaths } from "./config.ts"
import { Auth, UiRequests } from "./core/auth.ts"
import { openRuntime, type Runtime } from "./core/runtime.ts"
import { parseSessionId, Sessions } from "./core/sessions.ts"
import { Viewers } from "./core/viewers.ts"
import { EventHub } from "./events.ts"
import { HostBridge } from "./extensions/host.ts"
import { BrowserManager } from "./services/browser.ts"
import { Notifier } from "./services/notify.ts"
import { parsePortRange, PreviewProxies } from "./services/preview.ts"
import { ApiError, sendError, sendJson, serveStatic } from "./http.ts"
import { GitWatcher } from "./services/git.ts"
import { HighlightService } from "./services/highlight.ts"
import { HostPtyBackend } from "./services/pty-backend.ts"
import { MemoryPressure } from "./services/resources.ts"
import {
  looseNumber,
  Terminals,
  type TerminalEvent,
} from "./services/terminal.ts"
import { Security } from "./security.ts"
import {
  MachineManager,
  type RemoteEvent,
  type TransportFactory,
} from "./machines/manager.ts"
import { MachineProxy } from "./machines/proxy.ts"
import { addHubRoutes, addMachineServerRoutes } from "./machines/routes.ts"

export type PicoServer = {
  readonly server: Server
  readonly runtime: Runtime
  readonly sessions: Sessions
  readonly machines: MachineManager
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
  /** The transport to remote machines; tests use a fake. */
  machineTransport?: TransportFactory
  /**
   * Run terminals and jobs in the pty-host (at this script), so they
   * survive a restart. Without it, they run in this process.
   */
  ptyHost?: { script: string }
}): Promise<PicoServer> {
  const security = new Security(options.host)
  const host = new HostBridge()
  const runtime = await openRuntime(options.paths, host)
  const hub = new EventHub()
  const viewers = new Viewers(options.paths.viewersFile)
  const sessions = new Sessions(runtime, hub, viewers)
  const terminals = new Terminals({
    dataDir: options.paths.dataDir,
    ...(options.ptyHost
      ? {
          backend: new HostPtyBackend({
            dataDir: options.paths.dataDir,
            script: options.ptyHost.script,
            version: VERSION,
          }),
        }
      : {}),
  })
  if (options.ptyHost) {
    // Find the terminals and jobs that ran on while the server was down.
    const kept = await terminals.start().catch((error: unknown) => {
      terminals.useLocalBackend(
        error instanceof Error ? error.message : String(error)
      )
      return 0
    })
    if (kept) console.log(`[pico] the pty-host kept ${kept} terminal(s)`)
  }
  const previews = new PreviewProxies(options.host, () =>
    parsePortRange(runtime.settings.data.previewPorts)
  )
  const notifier = new Notifier(
    options.paths.dataDir,
    () => runtime.settings.data.ntfyUrl
  )
  const browser = new BrowserManager(
    options.paths.dataDir,
    () => runtime.settings.data.browserHeadless
  )
  const machines = new MachineManager({
    machinesFile: options.paths.machinesFile,
    machinesDir: options.paths.machinesDir,
    ...(options.machineTransport
      ? { transport: options.machineTransport }
      : {}),
  })
  hub.subscribe((event) => notifyFromEvent(event.payload))
  /** The words of a notification for a job that needs the user. */
  const jobNotice = (payload: Record<string, unknown>) => {
    if (payload.reason !== "job") return undefined
    const name = typeof payload.jobName === "string" ? payload.jobName : "job"
    const prompt =
      typeof payload.prompt === "string" && payload.prompt.trim()
        ? payload.prompt.trim()
        : "Type in its terminal"
    return { title: `${name} needs you`, body: prompt }
  }
  const sessionLink = (sessionId: unknown, machineId?: string) => {
    const base = runtime.settings.data.publicUrl.replace(/\/+$/, "")
    const query = new URLSearchParams()
    if (machineId) query.set("machine", machineId)
    if (typeof sessionId === "string") query.set("session", sessionId)
    const path = query.size ? `/?${query.toString()}` : "/"
    return base ? `${base}${path}` : path
  }
  /** Web Push for a remote session; the title names the machine. */
  const notifyFromRemote = ({ machine, payload }: RemoteEvent) => {
    const settings = runtime.settings.data
    const id = typeof payload.sessionId === "string" ? payload.sessionId : ""
    const title =
      (typeof payload.title === "string" ? payload.title : undefined) ??
      machine.summary?.sessions.find((session) => session.id === id)?.title ??
      "Session"
    if (payload.type === "session_done" && payload.reason === "agent") {
      // The agent goes on when its timer, watch, or job fires.
      if (!settings.notifyRunDone || payload.waiting) return
      void notifier.send(
        {
          title:
            payload.outcome === "error"
              ? `Pico (${machine.label}): run failed`
              : `Pico (${machine.label}): run finished`,
          body: title,
          url: sessionLink(id || undefined, machine.id),
          tag: `done-${machine.id}-${id}`,
          level: payload.outcome === "error" ? "error" : "success",
        },
        { ntfy: false }
      )
    } else if (
      payload.type === "session_status" &&
      payload.needsInput === true
    ) {
      if (!settings.notifyNeedsInput) return
      const job = jobNotice(payload)
      void notifier.send(
        {
          title: job
            ? `Pico (${machine.label}): ${job.title}`
            : `Pico (${machine.label}): the agent asks a question`,
          body: job ? `${job.body} · ${title}` : title,
          url: sessionLink(id || undefined, machine.id),
          tag: `ask-${machine.id}-${id}`,
          level: "warning",
        },
        { ntfy: false }
      )
    }
  }
  machines.onRemoteEvent(notifyFromRemote)
  const notifyFromEvent = (payload: {
    type: string
    [key: string]: unknown
  }) => {
    const settings = runtime.settings.data
    if (payload.type === "session_done" && payload.reason === "agent") {
      // The agent goes on when its timer, watch, or job fires.
      if (!settings.notifyRunDone || payload.waiting) return
      void notifier.send({
        title:
          payload.outcome === "error"
            ? "Pico: run failed"
            : "Pico: run finished",
        body: typeof payload.title === "string" ? payload.title : "Session",
        url: sessionLink(payload.sessionId),
        tag: `done-${String(payload.sessionId)}`,
        level: payload.outcome === "error" ? "error" : "success",
      })
    } else if (
      payload.type === "session_status" &&
      payload.needsInput === true
    ) {
      if (!settings.notifyNeedsInput) return
      const id = typeof payload.sessionId === "string" ? payload.sessionId : ""
      const title = sessions.has(id)
        ? (sessions.list({}).find((item) => item.id === id)?.title ?? "Session")
        : "Session"
      const job = jobNotice(payload)
      void notifier.send({
        title: job ? `Pico: ${job.title}` : "Pico: the agent asks a question",
        body: job ? `${job.body} · ${title}` : title,
        url: sessionLink(payload.sessionId),
        tag: `ask-${id}`,
        level: "warning",
      })
    }
  }
  host.bind({
    sessions,
    events: hub,
    terminals,
    harness: runtime.harness,
    settings: () => runtime.settings.data,
    dataDir: options.paths.dataDir,
    previews,
    notifier,
    browser,
    machines,
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
    dataDir: options.paths.dataDir,
    host,
    notifier,
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
  addMachineServerRoutes(router, { sessions, runtime, hub, viewers })
  addHubRoutes(router, {
    sessions,
    runtime,
    hub,
    viewers,
    machines,
    startedAt: Date.now(),
  })
  const proxy = new MachineProxy(machines, previews)
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
        if (proxy.handle(request, response)) return
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
      if (proxy.upgrade(request, socket, head)) return
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
        : // The same cwd as `baseCwd` in api.ts, so both scopes match.
          ((key?.startsWith("draft:") &&
          key.slice(6).trim() &&
          key.slice(6).trim() !== "default"
            ? key.slice(6).trim()
            : undefined) ??
          viewer?.activeDraft?.cwd ??
          viewer?.sidebarDirectories[0] ??
          homedir())
    return `${contextId}:${scopeTarget}:${cwd}`
  }

  const runTerminalSocket = (
    websocket: WebSocket,
    id: string,
    query: URLSearchParams
  ) => {
    const scopeKey = terminalScope(query)
    const viewer = query.get("viewer") ?? undefined
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
        send,
        viewer
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
            looseNumber(message.inputSeq),
            viewer
          )
          if (acknowledged !== undefined)
            send({ type: "input_ack", inputSeq: acknowledged })
        } else if (message.type === "resize") {
          terminals.resize(
            scopeKey,
            id,
            looseNumber(message.cols),
            looseNumber(message.rows),
            viewer
          )
        } else if (message.type === "focus") {
          terminals.focus(scopeKey, id, viewer)
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
  machines.start()
  // Free idle memory when the machine is short of it (Linux).
  const pressure = new MemoryPressure({
    terminals,
    jobs: () => runtime.extensions.jobs.liveJobs(),
    browser,
    previews,
    dropTranscripts: () => sessions.dropUnwatchedTranscripts(),
    notifier,
    sessionLink: (sessionId) => sessionLink(sessionId),
  })
  pressure.start()

  let closing: Promise<void> | undefined
  return {
    server,
    runtime,
    sessions,
    machines,
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
        host.stopping = true
        pressure.stop()
        ui.cancelAll()
        auth.cancelLogins()
        gitWatcher.stop()
        terminals.shutdown()
        await machines.close()
        await previews.shutdown()
        await browser.shutdown()
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
