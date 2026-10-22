/**
 * Machine routes.
 *
 * Every Pico server has the `/api/machine/*` routes. A hub uses them on a
 * remote server through SSH: a summary of the sessions, a stream of summary
 * events, and the session operations of the agent tools.
 *
 * The `/api/machines*` routes are the hub's own: the list of machines and
 * their states for the client, and changes to the profiles.
 */
import { hostname } from "node:os"
import { homedir } from "node:os"

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context"

import { VERSION } from "../config.ts"
import type { Runtime } from "../core/runtime.ts"
import type { Viewers } from "../core/viewers.ts"
import { conversationIdOf, type Sessions } from "../core/sessions.ts"
import type { EventHub } from "../events.ts"
import {
  lastAnswer,
  normalizeSessionId,
  transcriptText,
} from "../extensions/sessions.ts"
import {
  ApiError,
  badRequest,
  HANDLED,
  notFound,
  SseStream,
  stringField,
  type Router,
} from "../http.ts"
import * as files from "../services/files.ts"
import { LOCAL_MACHINE_ID } from "./profiles.ts"
import {
  MachineError,
  type MachineInfo,
  type MachineManager,
  type MachineSummary,
} from "./manager.ts"

/** The events after which a summary can change. */
const SUMMARY_EVENTS = new Set([
  "sessions",
  "session_status",
  "session_done",
  "sidebar_state",
])

/** The events that a hub sends a push notification for. */
function isNotifyEvent(payload: { type: string; [key: string]: unknown }) {
  return (
    (payload.type === "session_done" && payload.reason === "agent") ||
    (payload.type === "session_status" && payload.needsInput === true)
  )
}

export function localSummary(
  sessions: Sessions,
  runtime: Runtime,
  viewers: Viewers
): MachineSummary {
  return {
    hostname: hostname(),
    version: VERSION,
    directories: runtime.sidebar.snapshot().directories,
    sessions: sessions
      .list({})
      .slice(0, 200)
      .map((session) => {
        const meta = sessions.meta(session.id)
        return {
          id: session.id,
          title: session.title,
          cwd: session.cwd,
          directory: meta.group ?? session.cwd,
          busy: session.busy,
          needsInput: session.needsInput,
          ...(viewers.isUnread(session.id) ? { unread: true } : {}),
          ...(session.parent ? { parent: session.parent } : {}),
          ...(session.lastMessageAt
            ? { lastMessageAt: session.lastMessageAt }
            : {}),
          ...(meta.lastUserMessageAt
            ? { lastUserMessageAt: meta.lastUserMessageAt }
            : {}),
        }
      }),
  }
}

/** Call `listener` (at most every 250 ms) when the summary can change. */
function onSummaryChange(
  hub: EventHub,
  viewers: Viewers,
  listener: () => void
) {
  let timer: NodeJS.Timeout | undefined
  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      listener()
    }, 250)
  }
  const unsubscribeHub = hub.subscribe((event) => {
    if (SUMMARY_EVENTS.has(event.payload.type)) schedule()
  })
  // Read states change the unread sessions of a summary.
  const unsubscribeViewers = viewers.subscribe(schedule)
  return () => {
    unsubscribeHub()
    unsubscribeViewers()
    if (timer) clearTimeout(timer)
  }
}

function parseModel(
  sessions: Sessions,
  value: string | undefined
): { provider: string; modelId: string } | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const slash = trimmed.indexOf("/")
  if (slash > 0)
    return {
      provider: trimmed.slice(0, slash),
      modelId: trimmed.slice(slash + 1),
    }
  const match = sessions
    .availableModels()
    .find((candidate) => candidate.id === trimmed)
  if (!match?.provider) throw badRequest(`Unknown model: ${trimmed}`)
  return { provider: match.provider, modelId: match.id }
}

/** The routes that a hub calls on this server. */
export function addMachineServerRoutes(
  router: Router,
  context: {
    sessions: Sessions
    runtime: Runtime
    hub: EventHub
    viewers: Viewers
  }
) {
  const { sessions, runtime, hub, viewers } = context

  const requireSession = (value: unknown) => {
    const text = typeof value === "string" ? value : ""
    const id = sessions.current(normalizeSessionId(text))
    if (!id || !sessions.has(id)) throw notFound(`Unknown session: ${text}`)
    return id
  }

  const sessionInfo = (id: string) => {
    const summary = sessions.list({}).find((entry) => entry.id === id)
    const meta = sessions.meta(id)
    return {
      sessionId: id,
      title: summary?.title ?? meta.name ?? id,
      cwd: meta.cwd,
      busy: sessions.isBusy(id),
      needsInput: sessions.needsInput(id),
      ...(meta.worktree ? { worktree: meta.worktree } : {}),
    }
  }

  router.get("/api/machine/summary", () => ({
    ok: true,
    ...localSummary(sessions, runtime, viewers),
  }))

  router.get("/api/machine/events", (request, response) => {
    const stream = new SseStream(request.raw, response)
    const send = () =>
      stream.send({
        type: "machine_summary",
        summary: localSummary(sessions, runtime, viewers),
      })
    send()
    const stopSummary = onSummaryChange(hub, viewers, send)
    const stopNotify = hub.subscribe((event) => {
      if (isNotifyEvent(event.payload)) stream.send(event.payload)
    })
    void stream.closed.then(() => {
      stopSummary()
      stopNotify()
    })
    return HANDLED
  })

  router.get("/api/machine/sessions", (request) => {
    const directory = stringField(request.query.get("directory"))
    return {
      ok: true,
      sessions: sessions.list(directory ? { directory } : {}).slice(0, 50),
    }
  })

  router.post("/api/machine/session/spawn", async (request) => {
    const body = await request.body<{
      goal?: unknown
      name?: unknown
      cwd?: unknown
      model?: unknown
      thinking?: unknown
      profile?: unknown
      requestId?: unknown
    }>()
    const goal = stringField(body.goal)
    const requestId = stringField(body.requestId)
    if (!goal) throw badRequest("goal is required")
    if (!requestId) throw badRequest("requestId is required")
    const marker = `hub:${requestId}`
    let id = sessions
      .list({})
      .find((entry) => sessions.meta(entry.id).spawnedByCall === marker)?.id
    if (!id) {
      const requestedCwd = stringField(body.cwd)
      const cwd = await files.canonicalDirectory(
        requestedCwd ?? runtime.sidebar.snapshot().directories[0] ?? homedir()
      )
      const model = parseModel(sessions, stringField(body.model))
      const name = stringField(body.name)
      const thinking = stringField(body.thinking)
      const profile = stringField(body.profile)
      id = await sessions.create(cwd, {
        spawnedByCall: marker,
        ...(model ? { model } : {}),
        ...(thinking ? { thinkingLevel: thinking } : {}),
        ...(profile ? { profile } : {}),
        ...(name ? { name } : {}),
      })
    }
    await sessions.prompt(id, {
      message: goal,
      images: [],
      requestId: `spawn:${marker}`,
    })
    return { ok: true, ...sessionInfo(id) }
  })

  router.post("/api/machine/session/prompt", async (request) => {
    const body = await request.body<{
      id?: unknown
      message?: unknown
      mode?: unknown
      requestId?: unknown
    }>()
    const id = requireSession(body.id)
    const message = stringField(body.message)
    const requestId = stringField(body.requestId)
    if (!message) throw badRequest("message is required")
    if (!requestId) throw badRequest("requestId is required")
    await sessions.prompt(id, {
      message,
      images: [],
      streamingBehavior: body.mode === "steer" ? "steer" : "followUp",
      requestId: `hub:${requestId}`,
    })
    return { ok: true, ...sessionInfo(id) }
  })

  router.get("/api/machine/session/read", async (request) => {
    const id = requireSession(request.query.get("id"))
    const last = Number(request.query.get("last") ?? 6) || 6
    const text = await transcriptText(
      runtime.harness,
      conversationIdOf(id),
      {
        last: Math.min(50, Math.max(1, last)),
        includeTools: request.query.get("includeTools") === "1",
      },
      BACKGROUND_CONTEXT
    )
    return { ok: true, ...sessionInfo(id), text: text ?? "" }
  })

  // Wait (up to `timeoutMs`) until the session is idle; then its answer.
  router.get("/api/machine/session/wait", async (request) => {
    const id = requireSession(request.query.get("id"))
    const timeoutMs = Math.min(
      55_000,
      Math.max(0, Number(request.query.get("timeoutMs") ?? 25_000) || 0)
    )
    const conversation = await runtime.harness.conversation(
      conversationIdOf(id),
      BACKGROUND_CONTEXT
    )
    let idle = true
    if (conversation && timeoutMs > 0) {
      try {
        await conversation.waitForIdle(
          withAbortSignal(AbortSignal.timeout(timeoutMs), BACKGROUND_CONTEXT)
        )
      } catch {
        idle = false
      }
    }
    if (idle && sessions.isBusy(id)) idle = false
    const answer = idle
      ? await lastAnswer(
          runtime.harness,
          conversationIdOf(id),
          BACKGROUND_CONTEXT
        )
      : undefined
    return {
      ok: true,
      ...sessionInfo(id),
      idle,
      ...(answer !== undefined ? { answer } : {}),
    }
  })

  router.post("/api/machine/session/stop", async (request) => {
    const body = await request.body<{ id?: unknown }>()
    const id = requireSession(body.id)
    await sessions.abort(id)
    return { ok: true, ...sessionInfo(id) }
  })

  // Read state is global, so a hub agent changes it for every client.
  router.post("/api/machine/session/read-state", async (request) => {
    const body = await request.body<{ id?: unknown; unread?: unknown }>()
    const id = requireSession(body.id)
    viewers.setRead(id, body.unread !== true)
    return { ok: true, sessionId: id, unread: body.unread === true }
  })

  router.post("/api/machine/session/archive", async (request) => {
    const body = await request.body<{ id?: unknown; restore?: unknown }>()
    const id = requireSession(body.id)
    if (body.restore === true) sessions.restore(id)
    else sessions.archive(id)
    return { ok: true, sessionId: id, archived: body.restore !== true }
  })

  router.get("/api/machine/sessions/archived", () => ({
    ok: true,
    sessions: sessions.archivedSessions().slice(0, 50),
  }))
}

/** The hub's view of its own runtime, as a machine. */
export function localMachine(
  sessions: Sessions,
  runtime: Runtime,
  viewers: Viewers,
  startedAt: number
): MachineInfo {
  return {
    id: LOCAL_MACHINE_ID,
    label: hostname().replace(/\.local$/, ""),
    target: "",
    dataDir: null,
    enabled: true,
    state: "online",
    since: startedAt,
    version: VERSION,
    summary: localSummary(sessions, runtime, viewers),
  }
}

function machineError(error: unknown): never {
  if (error instanceof MachineError)
    throw new ApiError(error.status, error.message)
  throw error
}

/** The hub routes for the client. */
export function addHubRoutes(
  router: Router,
  context: {
    sessions: Sessions
    runtime: Runtime
    hub: EventHub
    viewers: Viewers
    machines: MachineManager
    startedAt: number
  }
) {
  const { sessions, runtime, hub, viewers, machines } = context
  const snapshot = () => ({
    machines: [
      localMachine(sessions, runtime, viewers, context.startedAt),
      ...machines.list(),
    ],
    ...(machines.fileError ? { fileError: machines.fileError } : {}),
  })

  router.get("/api/machines", () => ({ ok: true, ...snapshot() }))

  router.get("/api/machines/events", (request, response) => {
    const stream = new SseStream(request.raw, response)
    let timer: NodeJS.Timeout | undefined
    const send = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        stream.send({ type: "machines", ...snapshot() })
      }, 100)
    }
    stream.send({ type: "machines", ...snapshot() })
    const stopLocal = onSummaryChange(hub, viewers, send)
    const stopRemote = machines.subscribe(send)
    void stream.closed.then(() => {
      stopLocal()
      stopRemote()
      if (timer) clearTimeout(timer)
    })
    return HANDLED
  })

  const mutate =
    (change: (id: string, body: Record<string, unknown>) => void) =>
    async (request: {
      params: Record<string, string>
      body(): Promise<Record<string, unknown>>
    }) => {
      const id = request.params.id ?? ""
      if (id === LOCAL_MACHINE_ID)
        throw badRequest("The local machine cannot change")
      try {
        change(id, await request.body())
      } catch (error) {
        machineError(error)
      }
      return { ok: true, ...snapshot() }
    }

  router.post(
    "/api/machines/:id/retry",
    mutate((id) => machines.retry(id))
  )
  router.post(
    "/api/machines/:id/rename",
    mutate((id, body) =>
      machines.rename(id, typeof body.label === "string" ? body.label : "")
    )
  )
  router.post(
    "/api/machines/:id/enable",
    mutate((id) => machines.setEnabled(id, true))
  )
  router.post(
    "/api/machines/:id/disable",
    mutate((id) => machines.setEnabled(id, false))
  )
  router.post(
    "/api/machines/:id/remove",
    mutate((id) => machines.remove(id))
  )
}
