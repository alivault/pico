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

import { VERSION } from "../config.ts"
import type { LocalAgentOps } from "../control/agent-ops.ts"
import type { Runtime } from "../core/runtime.ts"
import type { Viewers } from "../core/viewers.ts"
import type { Agents } from "../core/agents.ts"
import type { EventHub } from "../events.ts"
import {
  ApiError,
  badRequest,
  HANDLED,
  SseStream,
  stringField,
  type Router,
} from "../http.ts"
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
          ...(agent.jobs ? { jobs: agent.jobs } : {}),
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

/** The routes that a hub calls on this server. */
export function addMachineServerRoutes(
  router: Router,
  context: {
    agents: Agents
    runtime: Runtime
    hub: EventHub
    viewers: Viewers
    ops: LocalAgentOps
  }
) {
  const { agents, runtime, hub, viewers, ops } = context

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

  router.get("/api/machine/agents", async (request) => {
    const project = stringField(request.query.get("project"))
    return { ok: true, agents: await ops.list(project ? { project } : {}) }
  })

  router.post("/api/machine/agent/spawn", async (request) => {
    const body = await request.body<Record<string, unknown>>()
    const goal = stringField(body.goal)
    const requestId = stringField(body.requestId)
    if (!goal) throw badRequest("goal is required")
    if (!requestId) throw badRequest("requestId is required")
    const worktreeBody =
      body.worktree && typeof body.worktree === "object"
        ? (body.worktree as Record<string, unknown>)
        : undefined
    const branch = stringField(worktreeBody?.branch)
    const base = stringField(worktreeBody?.base)
    const worktree =
      body.worktree === true
        ? true
        : worktreeBody
          ? { ...(branch ? { branch } : {}), ...(base ? { base } : {}) }
          : undefined
    const optional = (key: string) => {
      const value = stringField(body[key])
      return value ? { [key]: value } : {}
    }
    return {
      ok: true,
      ...(await ops.spawn({
        goal,
        requestId,
        ...optional("name"),
        ...optional("cwd"),
        ...optional("model"),
        ...optional("thinking"),
        ...optional("profile"),
        ...(worktree ? { worktree } : {}),
      })),
    }
  })

  router.post("/api/machine/agent/prompt", async (request) => {
    const body = await request.body<{
      id?: unknown
      message?: unknown
      mode?: unknown
      requestId?: unknown
    }>()
    const message = stringField(body.message)
    const requestId = stringField(body.requestId)
    if (!message) throw badRequest("message is required")
    if (!requestId) throw badRequest("requestId is required")
    return {
      ok: true,
      ...(await ops.prompt({
        id: typeof body.id === "string" ? body.id : "",
        message,
        requestId,
        mode: body.mode === "steer" ? "steer" : "followUp",
      })),
    }
  })

  router.get("/api/machine/agent/read", async (request) => ({
    ok: true,
    ...(await ops.read({
      id: request.query.get("id") ?? "",
      last: Number(request.query.get("last") ?? 6) || 6,
      includeTools: request.query.get("includeTools") === "1",
    })),
  }))

  // Wait (up to `timeoutMs`) until the agent is idle; then its answer. With
  // `settle=1`, until the run settles (see `control/agent-ops.ts`), for the
  // run of the message with request ID `request` when it is given.
  router.get("/api/machine/agent/wait", async (request, response) => {
    const id = request.query.get("id") ?? ""
    const timeoutMs = Math.min(
      55_000,
      Math.max(0, Number(request.query.get("timeoutMs") ?? 25_000) || 0)
    )
    if (request.query.get("settle") !== "1")
      return { ok: true, ...(await ops.waitIdle({ id, timeoutMs })) }
    // Stop waiting when the client goes away.
    const closed = new AbortController()
    response.once("close", () => closed.abort())
    const wanted = stringField(request.query.get("request"))
    return {
      ok: true,
      ...(await ops.wait({
        id,
        timeoutMs,
        signal: closed.signal,
        ...(wanted ? { request: wanted } : {}),
      })),
    }
  })

  router.post("/api/machine/agent/stop", async (request) => {
    const body = await request.body<{ id?: unknown }>()
    return {
      ok: true,
      ...(await ops.stop(typeof body.id === "string" ? body.id : "")),
    }
  })

  // Search the messages of all agents (see `core/agent-search.ts`).
  router.get("/api/machine/agent/search", async (request) => {
    const query = stringField(request.query.get("q")) ?? ""
    const project = stringField(request.query.get("project"))
    const exclude = stringField(request.query.get("exclude"))
    const limit = Number(request.query.get("limit") ?? 0) || undefined
    return {
      ok: true,
      ...(await ops.search({
        query,
        ...(project ? { project } : {}),
        ...(exclude ? { exclude } : {}),
        ...(limit ? { limit } : {}),
        prefix: request.query.get("prefix") === "1",
      })),
    }
  })

  // The messages around an entry of a search hit.
  router.get("/api/machine/agent/around", async (request) => {
    const entry = Number(request.query.get("entry"))
    if (!Number.isInteger(entry) || entry <= 0)
      throw badRequest("entry must be an entry ID")
    const count = Number(request.query.get("count") ?? 0) || undefined
    return {
      ok: true,
      ...(await ops.around({ entry, ...(count ? { count } : {}) })),
    }
  })

  // Read state is global, so a hub agent changes it for every client.
  router.post("/api/machine/agent/read-state", async (request) => {
    const body = await request.body<{ id?: unknown; unread?: unknown }>()
    const id = ops.requireAgent(body.id)
    viewers.setRead(id, body.unread !== true)
    return { ok: true, agentId: id, unread: body.unread === true }
  })

  router.post("/api/machine/agent/archive", async (request) => {
    const body = await request.body<{ id?: unknown; restore?: unknown }>()
    const id = ops.requireAgent(body.id)
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
