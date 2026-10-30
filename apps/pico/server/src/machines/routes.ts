/**
 * Machine routes.
 *
 * Every Pico server has the `/api/machine/*` routes. A hub uses them on a
 * remote server through SSH: a summary of the agents, a stream of summary
 * events, and the agent operations of the agent tools.
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
import { conversationIdOf, type Agents } from "../core/agents.ts"
import type { EventHub } from "../events.ts"
import {
  lastAnswerEntry,
  normalizeAgentId,
  runningToolLines,
  transcriptText,
  waitingOn,
} from "../extensions/agents.ts"
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
  "agents",
  "agent_status",
  "agent_done",
  "sidebar_state",
])

/** The events that a hub sends a push notification for. */
function isNotifyEvent(payload: { type: string; [key: string]: unknown }) {
  return (
    (payload.type === "agent_done" &&
      payload.reason === "agent" &&
      !payload.waiting) ||
    (payload.type === "agent_status" && payload.needsInput === true)
  )
}

export function localSummary(
  agents: Agents,
  runtime: Runtime,
  viewers: Viewers
): MachineSummary {
  return {
    hostname: hostname(),
    version: VERSION,
    projects: runtime.sidebar.snapshot().projects,
    agents: agents
      .list({})
      .slice(0, 200)
      .map((agent) => {
        const meta = agents.meta(agent.id)
        return {
          id: agent.id,
          title: agent.title,
          cwd: agent.cwd,
          project: meta.group ?? agent.cwd,
          busy: agent.busy,
          needsInput: agent.needsInput,
          ...(agent.waiting ? { waiting: agent.waiting } : {}),
          ...(viewers.isUnread(agent.id) ? { unread: true } : {}),
          ...(agent.parent ? { parent: agent.parent } : {}),
          ...(agent.lastMessageAt
            ? { lastMessageAt: agent.lastMessageAt }
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
  // Read states change the unread agents of a summary.
  const unsubscribeViewers = viewers.subscribe(schedule)
  return () => {
    unsubscribeHub()
    unsubscribeViewers()
    if (timer) clearTimeout(timer)
  }
}

function parseModel(
  agents: Agents,
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
  const match = agents
    .availableModels()
    .find((candidate) => candidate.id === trimmed)
  if (!match?.provider) throw badRequest(`Unknown model: ${trimmed}`)
  return { provider: match.provider, modelId: match.id }
}

/** The routes that a hub calls on this server. */
export function addMachineServerRoutes(
  router: Router,
  context: {
    agents: Agents
    runtime: Runtime
    hub: EventHub
    viewers: Viewers
  }
) {
  const { agents, runtime, hub, viewers } = context

  const requireAgent = (value: unknown) => {
    const text = typeof value === "string" ? value : ""
    const id = agents.current(normalizeAgentId(text))
    if (!id || !agents.has(id)) throw notFound(`Unknown agent: ${text}`)
    return id
  }

  const agentInfo = (id: string) => {
    const summary = agents.list({}).find((entry) => entry.id === id)
    const meta = agents.meta(id)
    return {
      agentId: id,
      title: summary?.title ?? meta.name ?? id,
      cwd: meta.cwd,
      busy: agents.isBusy(id),
      needsInput: agents.needsInput(id),
      running: runningToolLines(agents, id),
      ...(meta.worktree ? { worktree: meta.worktree } : {}),
    }
  }

  router.get("/api/machine/summary", () => ({
    ok: true,
    ...localSummary(agents, runtime, viewers),
  }))

  router.get("/api/machine/events", (request, response) => {
    const stream = new SseStream(request.raw, response)
    const send = () =>
      stream.send({
        type: "machine_summary",
        summary: localSummary(agents, runtime, viewers),
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

  /** What an idle agent waits on: a timer, a watch, or a job. */
  const waitingOf = (id: string) =>
    waitingOn(runtime.harness, conversationIdOf(id), BACKGROUND_CONTEXT)

  router.get("/api/machine/agents", async (request) => {
    const project = stringField(request.query.get("project"))
    const list = agents.list(project ? { project } : {}).slice(0, 50)
    return {
      ok: true,
      agents: await Promise.all(
        list.map(async (item) => {
          if (item.busy) {
            const running = runningToolLines(agents, item.id)
            return running.length > 0 ? { ...item, running } : item
          }
          if (item.needsInput) return item
          const waiting = await waitingOf(item.id)
          return waiting ? { ...item, waiting } : item
        })
      ),
    }
  })

  router.post("/api/machine/agent/spawn", async (request) => {
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
    let id = agents
      .list({})
      .find((entry) => agents.meta(entry.id).spawnedByCall === marker)?.id
    if (!id) {
      const requestedCwd = stringField(body.cwd)
      const cwd = await files.canonicalDirectory(
        requestedCwd ?? runtime.sidebar.snapshot().projects[0] ?? homedir()
      )
      const model = parseModel(agents, stringField(body.model))
      const name = stringField(body.name)
      const thinking = stringField(body.thinking)
      const profile = stringField(body.profile)
      id = await agents.create(cwd, {
        spawnedByCall: marker,
        ...(model ? { model } : {}),
        ...(thinking ? { thinkingLevel: thinking } : {}),
        ...(profile ? { profile } : {}),
        ...(name ? { name } : {}),
      })
    }
    await agents.prompt(id, {
      message: goal,
      images: [],
      requestId: `spawn:${marker}`,
    })
    return { ok: true, ...agentInfo(id) }
  })

  router.post("/api/machine/agent/prompt", async (request) => {
    const body = await request.body<{
      id?: unknown
      message?: unknown
      mode?: unknown
      requestId?: unknown
    }>()
    const id = requireAgent(body.id)
    const message = stringField(body.message)
    const requestId = stringField(body.requestId)
    if (!message) throw badRequest("message is required")
    if (!requestId) throw badRequest("requestId is required")
    await agents.prompt(id, {
      message,
      images: [],
      streamingBehavior: body.mode === "steer" ? "steer" : "followUp",
      requestId: `hub:${requestId}`,
    })
    return { ok: true, ...agentInfo(id) }
  })

  router.get("/api/machine/agent/read", async (request) => {
    const id = requireAgent(request.query.get("id"))
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
    return { ok: true, ...agentInfo(id), text: text ?? "" }
  })

  // Wait (up to `timeoutMs`) until the agent is idle; then its answer.
  router.get("/api/machine/agent/wait", async (request) => {
    const id = requireAgent(request.query.get("id"))
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
    if (idle && agents.isBusy(id)) idle = false
    const answer = idle
      ? await lastAnswerEntry(
          runtime.harness,
          conversationIdOf(id),
          BACKGROUND_CONTEXT
        )
      : undefined
    return {
      ok: true,
      ...agentInfo(id),
      idle,
      ...(answer !== undefined ? { answer: answer.text } : {}),
      ...(answer?.id !== undefined ? { answerId: Number(answer.id) } : {}),
      ...(idle ? { waiting: await waitingOf(id) } : {}),
    }
  })

  router.post("/api/machine/agent/stop", async (request) => {
    const body = await request.body<{ id?: unknown }>()
    const id = requireAgent(body.id)
    await agents.abort(id)
    return { ok: true, ...agentInfo(id) }
  })

  // Read state is global, so a hub agent changes it for every client.
  router.post("/api/machine/agent/read-state", async (request) => {
    const body = await request.body<{ id?: unknown; unread?: unknown }>()
    const id = requireAgent(body.id)
    viewers.setRead(id, body.unread !== true)
    return { ok: true, agentId: id, unread: body.unread === true }
  })

  router.post("/api/machine/agent/archive", async (request) => {
    const body = await request.body<{ id?: unknown; restore?: unknown }>()
    const id = requireAgent(body.id)
    if (body.restore === true) agents.restore(id)
    else agents.archive(id)
    return { ok: true, agentId: id, archived: body.restore !== true }
  })

  router.get("/api/machine/agents/archived", () => ({
    ok: true,
    agents: agents.archivedAgents().slice(0, 50),
  }))
}

/** The hub's view of its own runtime, as a machine. */
export function localMachine(
  agents: Agents,
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
    summary: localSummary(agents, runtime, viewers),
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
    agents: Agents
    runtime: Runtime
    hub: EventHub
    viewers: Viewers
    machines: MachineManager
    startedAt: number
  }
) {
  const { agents, runtime, hub, viewers, machines } = context
  const snapshot = () => ({
    machines: [
      localMachine(agents, runtime, viewers, context.startedAt),
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
