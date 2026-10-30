/**
 * The HTTP API of the web client: session and prompt routes on the durable
 * session store, workspace routes (git, files, terminals, highlighting), and
 * provider auth. Request and response shapes follow the client's contract.
 */
import { homedir } from "node:os"

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"

import type { ServerResponse } from "node:http"

import {
  API_CONTRACT_VERSION,
  SERVER_PROTOCOL_VERSION,
  VERSION,
} from "./config.ts"
import type { Auth, UiRequests } from "./core/auth.ts"
import type { Runtime } from "./core/runtime.ts"
import {
  conversationIdOf,
  parseAgentId,
  agentKey,
  agentPath,
  type PendingEdit,
  type Agents,
} from "./core/agents.ts"
import type { Viewers } from "./core/viewers.ts"
import type { HostBridge } from "./extensions/host.ts"
import { JobsDoc, stopJob } from "./extensions/jobs.ts"
import type { TodoChange } from "./extensions/todo.ts"
import { eventMatches, type EventHub, type ServerEvent } from "./events.ts"
import {
  badRequest,
  HANDLED,
  notFound,
  Router,
  SseStream,
  stringField,
  unavailable,
  type Request,
} from "./http.ts"
import * as files from "./services/files.ts"
import * as git from "./services/git.ts"
import type { Notifier } from "./services/notify.ts"
import { createWorktree, repoRoot } from "./services/worktree.ts"
import type { HighlightService } from "./services/highlight.ts"
import { looseNumber, type Terminals } from "./services/terminal.ts"
import { jobLogParts, readLogTailRaw } from "./services/job-log.ts"
import { validSize } from "./services/containment.ts"
import { collectResources } from "./services/resources.ts"

export type ApiContext = {
  runtime: Runtime
  dataDir: string
  host: HostBridge
  notifier: Notifier
  agents: Agents
  viewers: Viewers
  hub: EventHub
  auth: Auth
  ui: UiRequests
  gitWatcher: git.GitWatcher
  terminals: Terminals
  highlight: HighlightService
  startedAt: number
  port: () => number
  listenHosts: () => string[]
  draining: () => boolean
}

type Target = {
  contextId: string
  session?: string
  agentKey?: string
}

function target(request: Request): Target {
  const contextId = stringField(request.query.get("context")) ?? "default"
  const session = parseAgentId(
    stringField(request.query.get("agentPath")) ??
      stringField(request.query.get("session"))
  )
  const key = stringField(request.query.get("agentKey"))
  return {
    contextId,
    ...(session ? { session } : {}),
    ...(key ? { agentKey: key } : {}),
  }
}

/** A numeric query parameter; absent stays absent. */
function queryNumber(request: Request, name: string) {
  const value = request.query.get(name)
  return value === null || !value.trim() ? undefined : looseNumber(value)
}

const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

function draftCwdFromKey(key: string | undefined) {
  if (!key?.startsWith("draft:")) return undefined
  const cwd = key.slice("draft:".length).trim()
  return cwd && cwd !== "default" ? cwd : undefined
}

export function createApi(api: ApiContext) {
  const { agents, viewers, hub, runtime } = api
  const router = new Router()
  const promptAdmissions = new Map<string, Promise<unknown>>()
  async function admitPrompt(contextId: string, work: () => Promise<unknown>) {
    const previous = promptAdmissions.get(contextId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    promptAdmissions.set(contextId, next)
    try {
      return await next
    } finally {
      if (promptAdmissions.get(contextId) === next)
        promptAdmissions.delete(contextId)
    }
  }

  /** The visible session a request is about, if any. */
  const agentOf = (request: Request): string | undefined => {
    const { contextId, session } = target(request)
    const selected = session ?? viewers.get(contextId)?.selectedAgent
    const current = agents.current(selected)
    return current && agents.has(current) ? current : undefined
  }

  const requireAgent = (request: Request) => {
    const id = agentOf(request)
    if (!id) {
      const requested = target(request).session
      throw requested
        ? notFound(`Unknown session: ${requested}`)
        : badRequest("session is required")
    }
    return id
  }

  const agentFromPath = (path: unknown) => {
    const id = agents.current(
      parseAgentId(typeof path === "string" ? path : undefined)
    )
    if (!id || !agents.has(id)) throw badRequest("Unknown session path")
    return id
  }

  /** The directory a request works in: its session's, its draft's, or the sidebar's first. */
  const baseCwd = (request: Request) => {
    const id = agentOf(request)
    if (id) return agents.meta(id).cwd
    const { contextId, agentKey: key } = target(request)
    const fromKey = draftCwdFromKey(key)
    if (fromKey) return fromKey
    const viewer = viewers.get(contextId)
    return (
      viewer?.activeDraft?.cwd ?? viewer?.sidebarDirectories[0] ?? homedir()
    )
  }

  const ensureAcceptingWork = () => {
    if (api.draining())
      throw unavailable("Pico is restarting; try again in a moment.")
  }

  // ---------------------------------------------------------------------------
  // Server

  router.get("/api/client/manifest", () => ({
    ok: true,
    name: "@alivault/pico",
    version: VERSION,
    displayName: "Pico",
    serverProtocolVersion: SERVER_PROTOCOL_VERSION,
    apiContractVersion: API_CONTRACT_VERSION,
    pairingRequired: false,
    authentication: { type: "none" },
    transport: { sse: true, httpsRequired: false, localHttpAllowed: true },
    capabilities: {
      events: [
        "state_sync",
        "conversation_delta",
        "agents",
        "session_status",
        "session_done",
        "user_message",
        "request_error",
        "extension_error",
        "extension_ui_request",
        "extension_ui_dismiss",
        "git_changed",
        "session_extensions",
      ],
      endpoints: [],
      features: [
        "durable-agents",
        "session-index",
        "conversation",
        "paginated-conversation-history",
        "state-sync",
        "sse-replay",
        "prompt",
        "prompt-queue",
        "session-mutations",
        "session-tree",
        "model-selection",
        "thinking-selection",
        "compaction",
        "directory-discovery",
        "path-completions",
        "project-files",
        "git-status",
        "git-history",
        "git-mutations",
        "git-watch",
        "native-pty",
        "terminal-replay",
        "native-highlighting",
        "pi-performance-settings",
        "provider-auth",
        "provider-usage",
        "extension-ui-bridge",
        "static-spa",
        "web-access",
        "mcp",
        "mcp-oauth",
        "agent-panel",
        "todo",
        "ask-user",
        "background-jobs",
        "scratchpad",
        "child-agents",
        "worktrees",
        "push-notifications",
        "browser",
        "tool-profiles",
        "machine-hub",
      ],
    },
  }))

  router.get("/api/system/health", () => ({
    ok: true,
    runtime: "node",
    engine: "pi-durable",
    version: VERSION,
    serverProtocolVersion: SERVER_PROTOCOL_VERSION,
    apiContractVersion: API_CONTRACT_VERSION,
    phase: api.draining() ? "draining" : "serving",
    listenHosts: api.listenHosts(),
    port: api.port(),
    activeTurnCount: agents.activeTurnCount(),
    uptimeSeconds: Math.round((Date.now() - api.startedAt) / 1000),
    mcp: runtime.mcp.status(),
  }))

  // ---------------------------------------------------------------------------
  // Event stream

  router.get("/events", (request, response) => {
    streamEvents(api, request, response)
    return HANDLED
  })

  // ---------------------------------------------------------------------------
  // Session lists

  router.get("/api/directory-agents", (request) => {
    const directory = stringField(request.query.get("directory"))
    if (!directory) throw badRequest("directory is required")
    const unread = viewers.unread()
    const ids = agents.projectAgents(directory)
    const offset = Math.min(
      ids.length,
      Math.max(0, Number(request.query.get("offset") ?? 0) || 0)
    )
    const limit = Math.min(
      100,
      Math.max(1, Number(request.query.get("limit") ?? 5) || 5)
    )
    return {
      ok: true,
      directory,
      totalCount: ids.length,
      offset,
      limit,
      agents: ids
        .slice(offset, offset + limit)
        .map((id) => agents.summary(id, unread)),
    }
  })

  router.get("/api/directory-agents-index", (request) => {
    const directory = stringField(request.query.get("directory"))
    if (!directory) throw badRequest("directory is required")
    return {
      ok: true,
      ...agents.directoryIndex(directory, viewers.unread()),
    }
  })

  router.get("/api/directory-agents-indexes", (request) => {
    const directories = request.query
      .getAll("directory")
      .map((value) => value.trim())
      .filter(Boolean)
    if (directories.length === 0)
      throw badRequest("at least one directory is required")
    const unread = viewers.unread()
    return {
      ok: true,
      directories,
      directoryIndexes: Object.fromEntries(
        directories.map((directory) => [
          directory,
          agents.directoryIndex(directory, unread),
        ])
      ),
    }
  })

  router.post("/api/directory-agents/cleanup", async (request) => {
    const body = await request.body<{
      directory?: string
      olderThanMs?: number
      dryRun?: boolean
      includeActiveAgent?: boolean
    }>()
    const olderThanMs = Number(body.olderThanMs)
    if (!Number.isFinite(olderThanMs) || olderThanMs <= 0)
      throw badRequest("olderThanMs must be greater than zero")
    const directory = await files.resolveDirectory(
      String(body.directory ?? ""),
      baseCwd(request)
    )
    const activeIds = new Set(
      viewers
        .all()
        .flatMap(([, context]) =>
          context.selectedAgent ? [context.selectedAgent] : []
        )
    )
    const dryRun = body.dryRun !== false
    const result = agents.cleanup(directory, olderThanMs, {
      dryRun,
      includeActive: Boolean(body.includeActiveAgent),
      activeIds,
    })
    return {
      ok: true,
      directory,
      cutoff: result.cutoff,
      dryRun,
      deletedAgentIds: result.deleted,
      matchingAgents: result.matching,
    }
  })

  // ---------------------------------------------------------------------------
  // Session selection and prompts

  router.post("/api/session/new", async (request) => {
    const body = await request.body<{ cwd?: string }>()
    const { contextId } = target(request)
    const cwd = body.cwd
      ? await files.canonicalDirectory(body.cwd)
      : baseCwd(request)
    const key = `draft:${cwd}`
    viewers.selectDraft(contextId, { agentKey: key, cwd })
    return { ok: true, draft: true, agentKey: key, cwd }
  })

  router.post("/api/session/select", async (request) => {
    const { contextId } = target(request)
    const id = requireAgent(request)
    viewers.selectAgent(contextId, id)
    await agents.publishState(id)
    return { ok: true }
  })

  router.post("/api/prompt", (request) =>
    admitPrompt(target(request).contextId, async () => {
      const body = await request.body<{
        message?: string
        images?: Array<{ mimeType?: string; data?: string }>
        streamingBehavior?: string
        pendingId?: string
        clientRequestId?: string
        thinkingLevel?: string
        draftOwnerKey?: string
        draftCwd?: string
      }>()
      const message = typeof body.message === "string" ? body.message : ""
      const images = Array.isArray(body.images) ? body.images : []
      if (!message.trim() && images.length === 0)
        throw badRequest("message or image is required")
      const behavior = body.streamingBehavior
      if (
        behavior !== undefined &&
        behavior !== "steer" &&
        behavior !== "followUp"
      ) {
        throw badRequest(`invalid streaming behavior: ${behavior}`)
      }
      ensureAcceptingWork()
      const { contextId, session, agentKey: queryKey } = target(request)
      const draftKey = queryKey ?? stringField(body.draftOwnerKey)
      let id = session ? agents.current(session) : undefined
      if (session && !id) throw notFound(`Unknown session: ${session}`)
      // A retry after a draft was admitted must reach the same conversation
      // so durable can deduplicate its clientRequestId, not create a new one.
      const viewerBeforeAdmission = viewers.get(contextId)
      if (
        !id &&
        (!draftKey ||
          (!viewerBeforeAdmission?.activeDraft && body.clientRequestId))
      )
        id = agents.current(viewerBeforeAdmission?.selectedAgent)
      if (!id) {
        const viewer = viewers.get(contextId)
        const draft = viewer?.activeDraft
        const requestedCwd =
          stringField(body.draftCwd) ??
          draftCwdFromKey(draftKey) ??
          draft?.cwd ??
          baseCwd(request)
        const cwd = await files.canonicalDirectory(requestedCwd)
        let agentCwd = cwd
        let worktree: Awaited<ReturnType<typeof createWorktree>> | undefined
        if (draft?.worktree && draft.cwd === cwd) {
          try {
            worktree = await createWorktree(cwd, {
              dataDir: api.dataDir,
              copy: runtime.settings.data.worktreeCopy,
              name: message.slice(0, 40),
              ...(draft.worktree.branch
                ? { branch: draft.worktree.branch }
                : {}),
              ...(draft.worktree.base ? { base: draft.worktree.base } : {}),
            })
          } catch (error) {
            throw badRequest(
              `Could not create the worktree: ${error instanceof Error ? error.message : String(error)}`
            )
          }
          agentCwd = worktree.cwd
        }
        id = await agents.create(agentCwd, {
          ...(draft?.profile ? { profile: draft.profile } : {}),
          ...(worktree
            ? {
                group: cwd,
                worktree: {
                  repoRoot: worktree.repoRoot,
                  path: worktree.path,
                  branch: worktree.branch,
                },
              }
            : {}),
          ...(draft?.model ? { model: draft.model } : {}),
          ...((stringField(body.thinkingLevel) ?? draft?.thinkingLevel)
            ? {
                thinkingLevel:
                  stringField(body.thinkingLevel) ?? draft?.thinkingLevel,
              }
            : {}),
        })
        viewers.selectAgent(contextId, id)
      }
      const result = await agents.prompt(id, {
        message,
        images,
        ...(behavior ? { streamingBehavior: behavior } : {}),
        ...(stringField(body.thinkingLevel)
          ? { thinkingLevel: stringField(body.thinkingLevel) }
          : {}),
        ...(stringField(body.clientRequestId)
          ? { requestId: stringField(body.clientRequestId) }
          : {}),
      })
      await agents.publishState(id)
      hub.push(
        { type: "user_message", message, images, queued: result.queued },
        { contextId, agentId: id }
      )
      return {
        ok: true,
        queued: result.queued,
        ...(result.pendingId ? { pendingId: result.pendingId } : {}),
        agentId: id,
        agentPath: agentPath(id),
      }
    })
  )

  router.post("/api/abort", async (request) => {
    await agents.abort(requireAgent(request))
    return { ok: true }
  })

  router.post("/api/pending-messages/reorder", async (request) => {
    const id = requireAgent(request)
    const body = await request.body<{
      pendingMessages?: Array<{
        pendingId?: unknown
        text?: unknown
        images?: unknown
        streamingBehavior?: unknown
      }>
      pendingIds?: string[]
      removedPendingIds?: unknown
      resume?: unknown
    }>()
    const edits: PendingEdit[] | undefined = Array.isArray(body.pendingMessages)
      ? body.pendingMessages.map(
          (message): PendingEdit => ({
            ...(typeof message?.pendingId === "string" && message.pendingId
              ? { pendingId: message.pendingId }
              : {}),
            ...(typeof message?.text === "string"
              ? { text: message.text }
              : {}),
            ...(Array.isArray(message?.images)
              ? { images: message.images as never }
              : {}),
            ...(message?.streamingBehavior === "steer" ||
            message?.streamingBehavior === "followUp"
              ? { streamingBehavior: message.streamingBehavior as never }
              : {}),
          })
        )
      : Array.isArray(body.pendingIds)
        ? body.pendingIds.map((pendingId) => ({ pendingId: String(pendingId) }))
        : undefined
    if (!edits) throw badRequest("pendingMessages must be an array")
    const removed = Array.isArray(body.removedPendingIds)
      ? body.removedPendingIds.filter(
          (value): value is string => typeof value === "string"
        )
      : []
    const { missed } = await agents.requeue(id, edits, removed, {
      resume: body.resume === true,
    })
    return {
      ok: true,
      missed,
      pendingMessages: await agents.pendingMessages(id),
    }
  })

  router.post("/api/pending-message/remove", async (request) => {
    const id = requireAgent(request)
    const body = await request.body<{ pendingId?: string }>()
    const pendingId = stringField(body.pendingId)
    if (!pendingId) throw badRequest("pendingId is required")
    await agents.removePending(id, pendingId)
    return { ok: true, pendingId }
  })

  router.post("/api/pending-messages/start", async (request) => {
    ensureAcceptingWork()
    const id = requireAgent(request)
    if (agents.isBusy(id) && !(await agents.isQueuePaused(id)))
      throw badRequest(
        "Wait for the current response to finish before starting the queue."
      )
    await agents.requeue(id)
    return { ok: true, pendingMessages: await agents.pendingMessages(id) }
  })

  // Hold the queue while the user edits it. Save or cancel resumes it.
  router.post("/api/pending-messages/hold", async (request) => {
    const id = requireAgent(request)
    const { wasPaused } = await agents.holdQueue(id)
    return {
      ok: true,
      wasPaused,
      pendingMessages: await agents.pendingMessages(id),
    }
  })

  router.post("/api/model", async (request) => {
    const body = await request.body<{ provider?: string; modelId?: string }>()
    const provider = stringField(body.provider)
    const modelId = stringField(body.modelId)
    if (!provider || !modelId)
      throw badRequest("provider and modelId are required")
    const id = agentOf(request)
    if (id) {
      await agents.setModel(id, provider, modelId)
      await agents.publishState(id)
      return {
        ok: true,
        ...(await agents.agentState(id)),
        availableModels: agents.availableModels(),
      }
    }
    if (!runtime.models.getModel(provider, modelId))
      throw badRequest(`Unknown model: ${provider}/${modelId}`)
    const { contextId } = target(request)
    ensureDraft(api, contextId, baseCwd(request))
    viewers.updateDraft(contextId, { model: { provider, modelId } })
    const draft = viewers.get(contextId)?.activeDraft
    return {
      ok: true,
      model: {
        id: modelId,
        provider,
        name: runtime.models.getModel(provider, modelId)?.name,
      },
      thinkingLevel: draft?.thinkingLevel ?? agents.defaultThinkingLevel(),
      availableThinkingLevels: agents.thinkingLevels({ provider, modelId }),
      availableModels: agents.availableModels(),
    }
  })

  router.post("/api/thinking", async (request) => {
    const body = await request.body<{ level?: string }>()
    const level = agents.validateThinkingLevel(String(body.level ?? ""))
    const id = agentOf(request)
    if (id) {
      await agents.setThinking(id, level)
      await agents.publishState(id)
      const state = await agents.agentState(id)
      return {
        ok: true,
        thinkingLevel: level,
        availableThinkingLevels: state.availableThinkingLevels,
      }
    }
    const { contextId } = target(request)
    ensureDraft(api, contextId, baseCwd(request))
    viewers.updateDraft(contextId, { thinkingLevel: level })
    const model =
      viewers.get(contextId)?.activeDraft?.model ?? agents.defaultModel()
    return {
      ok: true,
      thinkingLevel: level,
      availableThinkingLevels: agents.thinkingLevels(model),
    }
  })

  // The sidebar layout that all devices share. `clientId` comes back in the
  // event, so the page that made the change can skip its own event.
  router.get("/api/sidebar-state", () => ({
    ok: true,
    ...runtime.sidebar.snapshot(),
  }))

  const sidebarStateRoute = (mode: "update" | "merge") =>
    async function (request: Request) {
      const body = await request.body<{
        clientId?: unknown
        directories?: unknown
        pinnedAgentKeys?: unknown
        collapsedDirectories?: unknown
      }>()
      const change = {
        ...(body.directories !== undefined
          ? { directories: body.directories }
          : {}),
        ...(body.pinnedAgentKeys !== undefined
          ? { pinnedAgentKeys: body.pinnedAgentKeys }
          : {}),
        ...(body.collapsedDirectories !== undefined
          ? { collapsedDirectories: body.collapsedDirectories }
          : {}),
      }
      const state =
        mode === "merge"
          ? runtime.sidebar.merge(change)
          : runtime.sidebar.update(change)
      hub.push({
        type: "sidebar_state",
        ...state,
        clientId: stringField(body.clientId) ?? "",
      })
      return { ok: true, ...state }
    }

  router.post("/api/sidebar-state", sidebarStateRoute("update"))
  router.post("/api/sidebar-state/merge", sidebarStateRoute("merge"))

  router.post("/api/settings/hide-thinking", async (request) => {
    const body = await request.body<{ hide?: boolean }>()
    const hide = Boolean(body.hide)
    runtime.settings.update({ hideThinkingBlock: hide })
    hub.push({ type: "state_sync", hideThinkingBlock: hide })
    return { ok: true, hideThinkingBlock: hide }
  })

  router.get("/api/settings/performance", () => ({
    ok: true,
    transport: runtime.settings.data.transport,
    cacheRetention: runtime.settings.data.cacheRetention,
  }))

  router.post("/api/settings/performance", async (request) => {
    const body = await request.body<{
      transport?: string
      cacheRetention?: string
    }>()
    const transport = String(body.transport ?? "").trim()
    const cacheRetention = String(body.cacheRetention ?? "").trim()
    if (!["auto", "sse", "websocket", "websocket-cached"].includes(transport))
      throw badRequest("Invalid Pi transport")
    if (!["standard", "long"].includes(cacheRetention))
      throw badRequest("Invalid Pi cache retention")
    runtime.settings.update({
      transport: transport as "auto",
      cacheRetention: cacheRetention as "standard",
    })
    // Durable settings are read at each request, so the change applies at once.
    return {
      ok: true,
      transport,
      cacheRetention,
      appliesToActiveAgentAfterRestart: false,
    }
  })

  router.post("/api/slash-command", async (request) => {
    const body = await request.body<{ name?: string; args?: string }>()
    const name = String(body.name ?? "")
      .trim()
      .replace(/^\/+/, "")
    if (!name) throw badRequest("name is required")
    ensureAcceptingWork()
    const id = requireAgent(request)
    const args = String(body.args ?? "").trim()
    if (name === "compact") {
      const { compacted } = await agents.compact(id, args || undefined)
      return { ok: true, compacted }
    }
    await agents.prompt(id, {
      message: args ? `/${name} ${args}` : `/${name}`,
      images: [],
    })
    return { ok: true }
  })

  // ---------------------------------------------------------------------------
  // Directories and files

  router.post("/api/directory/resolve", async (request) => {
    const body = await request.body<{ path?: string }>()
    return {
      ok: true,
      path: await files.resolveDirectory(
        String(body.path ?? ""),
        baseCwd(request)
      ),
    }
  })

  router.post("/api/directory-search", async (request) => {
    const body = await request.body<{ query?: string }>()
    const query = String(body.query ?? "")
    const items = await files.searchDirectories(query, baseCwd(request))
    return { ok: true, query, totalCount: items.length, items }
  })

  router.post("/api/path-completions", async (request) => {
    const body = await request.body<{ prefix?: string }>()
    const prefix = String(body.prefix ?? "")
    const items = await files.pathCompletions(prefix, baseCwd(request))
    return { ok: true, prefix, totalCount: items.length, items }
  })

  router.post("/api/file-completions", async (request) => {
    const body = await request.body<{
      query?: string
      isQuotedPrefix?: boolean
    }>()
    const query = String(body.query ?? "")
    const items = await files.fileCompletions(
      query,
      baseCwd(request),
      Boolean(body.isQuotedPrefix)
    )
    return { ok: true, query, totalCount: items.length, items }
  })

  router.get("/api/files/tree", async (request) => {
    const requested = stringField(request.query.get("cwd"))
    if (!requested) throw badRequest("cwd is required")
    const cwd = await files.resolveDirectory(requested, baseCwd(request))
    const paths = await files.projectTree(cwd)
    return { ok: true, cwd, totalCount: paths.length, paths }
  })

  router.get("/api/files/read", async (request) => {
    const path = stringField(request.query.get("path"))
    if (!path) throw badRequest("path is required")
    const requested = stringField(request.query.get("cwd"))
    if (!requested) throw badRequest("cwd is required")
    const cwd = await files.resolveDirectory(requested, baseCwd(request))
    return { ok: true, cwd, ...(await files.readProjectFile(cwd, path)) }
  })

  router.post("/api/files/write", async (request) => {
    const body = await request.body<{
      cwd?: unknown
      path?: unknown
      content?: unknown
      version?: unknown
    }>()
    const path = stringField(body.path)
    if (!path) throw badRequest("path is required")
    const requested = stringField(body.cwd)
    if (!requested) throw badRequest("cwd is required")
    if (typeof body.content !== "string")
      throw badRequest("content is required")
    const version = typeof body.version === "string" ? body.version : undefined
    const cwd = await files.resolveDirectory(requested, baseCwd(request))
    return {
      ok: true,
      cwd,
      ...(await files.writeProjectFile(cwd, path, body.content, version)),
    }
  })

  // An image of a saved message (`imagePath` in core/items.ts). History
  // entries do not change, so the browser can keep the image for good.
  router.get(
    "/api/session-image/:session/:entry/:index",
    async (request, response) => {
      const { session, entry } = request.params
      const index =
        request.params.index === "details"
          ? "details"
          : Number(request.params.index)
      if (
        !agents.has(session) ||
        (index !== "details" && (!Number.isInteger(index) || index < 0))
      )
        throw notFound("Unknown image")
      const image = await agents.image(session, entry!, index)
      if (!image) throw notFound("Unknown image")
      response.writeHead(200, {
        // Only raster types: an SVG opened from this origin could run script.
        "content-type": INLINE_IMAGE_TYPES.has(image.mimeType)
          ? image.mimeType
          : "application/octet-stream",
        "content-length": image.bytes.length,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      })
      response.end(request.method === "HEAD" ? undefined : image.bytes)
      return HANDLED
    }
  )

  router.post("/api/highlight", async (request) => {
    const body = await request.body<{ code?: unknown; language?: unknown }>()
    return {
      ok: true,
      ...(await api.highlight.highlight(body.code, body.language)),
    }
  })

  // ---------------------------------------------------------------------------
  // Git

  const gitCwd = async (request: Request, requested: unknown) => {
    const value = typeof requested === "string" ? requested.trim() : ""
    if (!value) throw badRequest("cwd is required")
    const cwd = await files.resolveDirectory(value, baseCwd(request))
    api.gitWatcher.watch(cwd)
    return cwd
  }
  const required = (value: string | null, name: string) => {
    const trimmed = value?.trim()
    if (!trimmed) throw badRequest(`${name} is required`)
    return trimmed
  }
  const gitAction = (
    cwd: string,
    output: { stdout: string; stderr: string; pushedCommitMessages?: string[] }
  ) => {
    api.gitWatcher.mutated(cwd)
    return { ok: true, cwd, ...output }
  }

  router.get("/api/git-status", async (request) => {
    const cwd = await gitCwd(request, request.query.get("cwd"))
    return { ok: true, cwd, gitStatus: await git.status(cwd) }
  })

  router.get("/api/git-changes", async (request) => {
    const cwd = await gitCwd(request, request.query.get("cwd"))
    const requestedScope =
      request.query.get("gitScope") ?? request.query.get("scope") ?? "all"
    const scope = ["all", "files", "branches", "commits"].includes(
      requestedScope
    )
      ? requestedScope
      : "all"
    const limit = queryNumber(request, "commitsLimit")
    return { ok: true, cwd, ...(await git.changes(cwd, scope, limit)) }
  })

  router.get("/api/git-diff", async (request) => {
    const path = required(request.query.get("path"), "path")
    const cwd = await gitCwd(request, request.query.get("cwd"))
    return { ok: true, cwd, path, patch: await git.fileDiff(cwd, path) }
  })

  router.get("/api/git-review", async (request) => {
    const path = required(request.query.get("path"), "path")
    const cwd = await gitCwd(request, request.query.get("cwd"))
    return {
      ok: true,
      cwd,
      ...(await git.fileReview(
        cwd,
        path,
        stringField(request.query.get("previousPath"))
      )),
    }
  })

  router.get("/api/git-commit-files", async (request) => {
    const commit = required(request.query.get("commit"), "commit")
    const cwd = await gitCwd(request, request.query.get("cwd"))
    return { ok: true, cwd, commit, files: await git.commitFiles(cwd, commit) }
  })

  router.get("/api/git-commit-diff", async (request) => {
    const commit = required(request.query.get("commit"), "commit")
    const requestedMode = request.query.get("mode")
    const mode =
      requestedMode === "head" || requestedMode === "previous"
        ? requestedMode
        : "commit"
    const cwd = await gitCwd(request, request.query.get("cwd"))
    const diff = await git.commitDiff(
      cwd,
      commit,
      mode,
      stringField(request.query.get("path")),
      stringField(request.query.get("previousPath"))
    )
    return { ok: true, cwd, commit, mode, ...diff }
  })

  router.get("/api/git-commit-remote-url", async (request) => {
    const commit = required(request.query.get("commit"), "commit")
    const cwd = await gitCwd(request, request.query.get("cwd"))
    return {
      ok: true,
      cwd,
      commit,
      remoteUrl: await git.commitRemoteUrl(cwd, commit),
    }
  })

  type GitBody = {
    cwd?: string
    action?: string
    all?: boolean
    path?: string
    previousPath?: string
    status?: string
    branch?: string
    create?: boolean
    startPoint?: string
    track?: boolean
    message?: string
    includeUnstaged?: boolean
    push?: boolean
    force?: boolean
    forcePush?: boolean
    commit?: string
    tagName?: string
    resetMode?: string
  }

  router.post("/api/git-stage", async (request) => {
    const body = await request.body<GitBody>()
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(
      cwd,
      await git.stage(
        cwd,
        body.action ?? "stage",
        Boolean(body.all),
        stringField(body.path),
        stringField(body.previousPath)
      )
    )
  })

  router.post("/api/git-discard", async (request) => {
    const body = await request.body<GitBody>()
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(
      cwd,
      await git.discard(
        cwd,
        body.action ?? "discard",
        Boolean(body.all),
        stringField(body.path),
        stringField(body.previousPath),
        body.status
      )
    )
  })

  router.post("/api/git-checkout", async (request) => {
    const body = await request.body<GitBody>()
    const branch = stringField(body.branch)
    if (!branch) throw badRequest("branch is required")
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(
      cwd,
      await git.checkout(
        cwd,
        branch,
        Boolean(body.create),
        stringField(body.startPoint),
        Boolean(body.track)
      )
    )
  })

  router.post("/api/git-commit", async (request) => {
    const body = await request.body<GitBody>()
    const message = stringField(body.message)
    if (!message) throw badRequest("commit message is required")
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(
      cwd,
      await git.commit(
        cwd,
        message,
        body.includeUnstaged !== false,
        Boolean(body.push),
        Boolean(body.forcePush)
      )
    )
  })

  router.post("/api/git-commit-message", async (request) => {
    const body = await request.body<GitBody>()
    const cwd = await gitCwd(request, body.cwd)
    try {
      const message = await generateCommitMessage(api, cwd)
      if (message) return { ok: true, cwd, message, source: "ai" }
      throw new Error("AI returned an empty message")
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message = await git.heuristicCommitMessage(cwd)
      return { ok: true, cwd, message, source: "heuristic", reason }
    }
  })

  router.post("/api/git-push", async (request) => {
    const body = await request.body<GitBody>()
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(
      cwd,
      await git.push(cwd, Boolean(body.force || body.forcePush))
    )
  })

  router.post("/api/git-pull", async (request) => {
    const body = await request.body<GitBody>()
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(cwd, await git.pull(cwd))
  })

  router.post("/api/git-commit-action", async (request) => {
    const body = await request.body<GitBody>()
    const action = stringField(body.action)
    if (!action) throw badRequest("action is required")
    const commit = stringField(body.commit)
    if (!commit) throw badRequest("commit is required")
    const cwd = await gitCwd(request, body.cwd)
    return gitAction(
      cwd,
      await git.commitAction(cwd, action, commit, {
        ...(body.tagName ? { tagName: body.tagName } : {}),
        ...(body.resetMode ? { resetMode: body.resetMode } : {}),
        ...(body.message ? { message: body.message } : {}),
      })
    )
  })

  // ---------------------------------------------------------------------------
  // Terminals

  const terminalScope = (request: Request) => {
    const { contextId, session, agentKey: key } = target(request)
    const viewer = viewers.get(contextId)
    const scopeTarget =
      key ??
      session ??
      viewer?.activeDraft?.agentKey ??
      viewer?.selectedAgent ??
      "default"
    const cwd = baseCwd(request)
    return { scopeKey: `${contextId}:${scopeTarget}:${cwd}`, cwd }
  }

  /**
   * A tab of a finished job whose terminal is gone (for example after a
   * restart) shows the end of the job's log.
   */
  const addFinishedJobTerminal = async (
    request: Request,
    clientKey: string | undefined
  ) => {
    const jobId = clientKey?.startsWith("job:") ? clientKey.slice(4) : ""
    if (!/^[a-z0-9]+$/i.test(jobId) || api.terminals.hasJob(jobId)) return
    const id = agentOf(request)
    if (!id) return
    const jobs = await runtime.harness.snapshot(
      JobsDoc,
      conversationIdOf(id),
      BACKGROUND_CONTEXT
    )
    const job = jobs?.items[jobId]
    if (!job || job.status === "running") return
    const parts = jobLogParts(api.dataDir, jobId)
    if (parts.length === 0) return
    api.terminals.addFinishedJob(jobId, {
      label: job.name,
      cwd: job.cwd,
      exit: {
        exitCode: job.exitCode ?? -1,
        ...(job.signal ? { signal: job.signal } : {}),
      },
      replay: (maxBytes) => readLogTailRaw(parts, maxBytes),
    })
  }

  router.post("/api/terminal", async (request) => {
    const body = await request.body<{
      clientKey?: string
      cols?: unknown
      rows?: unknown
    }>()
    const { scopeKey, cwd } = terminalScope(request)
    await addFinishedJobTerminal(request, body.clientKey)
    const created = await api.terminals.create(
      scopeKey,
      cwd,
      body.clientKey,
      looseNumber(body.cols),
      looseNumber(body.rows)
    )
    return { ok: true, ...created }
  })

  router.post("/api/terminal/:id/input", async (request) => {
    const body = await request.body<{
      data?: unknown
      inputSeq?: unknown
      viewer?: unknown
    }>()
    if (typeof body.data !== "string")
      throw badRequest("Terminal input data is required.")
    api.terminals.write(
      terminalScope(request).scopeKey,
      request.params.id!,
      body.data,
      looseNumber(body.inputSeq),
      typeof body.viewer === "string" ? body.viewer : undefined
    )
    return { ok: true }
  })

  router.post("/api/terminal/:id/resize", async (request) => {
    const body = await request.body<{
      cols?: unknown
      rows?: unknown
      viewer?: unknown
    }>()
    api.terminals.resize(
      terminalScope(request).scopeKey,
      request.params.id!,
      looseNumber(body.cols),
      looseNumber(body.rows),
      typeof body.viewer === "string" ? body.viewer : undefined
    )
    return { ok: true }
  })

  router.post("/api/terminal/:id/close", (request) => {
    api.terminals.close(terminalScope(request).scopeKey, request.params.id!)
    return { ok: true }
  })

  router.get("/api/terminal/:id/events", (request, response) => {
    const header = request.raw.headers["last-event-id"]
    const lastSeq =
      (header
        ? looseNumber(Array.isArray(header) ? header[0] : header)
        : undefined) ?? queryNumber(request, "lastSeq")
    const { scopeKey } = terminalScope(request)
    let stream: SseStream | undefined
    const subscription = api.terminals.subscribe(
      scopeKey,
      request.params.id!,
      lastSeq,
      (event) => {
        stream?.send(event, event.type === "output" ? event.seq : undefined)
      },
      request.query.get("viewer") ?? undefined
    )
    stream = new SseStream(request.raw, response)
    for (const event of subscription.initial)
      stream.send(event, event.type === "output" ? event.seq : undefined)
    void stream.closed.then(subscription.unsubscribe)
    return HANDLED
  })

  // ---------------------------------------------------------------------------
  // Auth and UI requests

  router.get("/api/auth/providers", () => api.auth.providers())

  router.post("/api/auth/api-key", async (request) => {
    const body = await request.body<{ provider?: string; key?: string }>()
    return api.auth.setApiKey(
      String(body.provider ?? "").trim(),
      String(body.key ?? "").trim()
    )
  })

  router.post("/api/auth/oauth", async (request) => {
    const body = await request.body<{ provider?: string }>()
    return api.auth.login(
      String(body.provider ?? "").trim(),
      target(request).contextId
    )
  })

  router.post("/api/auth/logout", async (request) => {
    const body = await request.body<{ provider?: string }>()
    return api.auth.logout(String(body.provider ?? "").trim())
  })

  router.get("/api/provider-usage", (request) =>
    api.auth.providerUsage(stringField(request.query.get("provider")))
  )

  router.post("/api/ui/:id", async (request) => {
    const body = await request.body<{
      value?: unknown
      confirmed?: unknown
      cancelled?: unknown
    }>()
    api.ui.respond(request.params.id!, {
      ...(typeof body.value === "string" ? { value: body.value } : {}),
      ...(typeof body.confirmed === "boolean"
        ? { confirmed: body.confirmed }
        : {}),
      cancelled: body.cancelled === true,
    })
    return { ok: true }
  })

  // ---------------------------------------------------------------------------
  // Session operations

  router.get("/api/session/history", async (request) => {
    const id = requireAgent(request)
    const before = queryNumber(request, "before")
    const limit = Math.min(
      200,
      Math.max(1, queryNumber(request, "limit") ?? 50)
    )
    return agents.history(id, before, limit)
  })

  router.post("/api/session/answer", async (request) => {
    const id = requireAgent(request)
    const body = await request.body<{
      questionId?: unknown
      value?: unknown
      images?: unknown
    }>()
    const value = body.value
    const valid =
      typeof value === "string" ||
      (Array.isArray(value) &&
        value.every((part) => typeof part === "string")) ||
      (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.values(value).every((part) => typeof part === "string"))
    if (!valid) throw badRequest("value must be text, a list, or form values")
    await agents.answer(
      id,
      stringField(body.questionId),
      value as string | string[] | Record<string, string>,
      Array.isArray(body.images)
        ? (body.images as Array<{ mimeType?: string; data?: string }>)
        : []
    )
    return { ok: true }
  })

  router.post("/api/session/todo", async (request) => {
    const id = requireAgent(request)
    const body = await request.body<Record<string, unknown>>()
    const op = stringField(body.op)
    const status =
      typeof body.status === "string" &&
      ["pending", "active", "done", "blocked"].includes(body.status)
        ? (body.status as "pending")
        : undefined
    let change: TodoChange
    if (op === "add") {
      const text = stringField(body.text)
      if (!text) throw badRequest("text is required")
      change = { op, items: [{ text, ...(status ? { status } : {}) }] }
    } else if (op === "update") {
      const itemId = stringField(body.id)
      if (!itemId) throw badRequest("id is required")
      change = {
        op,
        id: itemId,
        ...(status ? { status } : {}),
        ...(typeof body.text === "string" ? { text: body.text } : {}),
        ...(typeof body.note === "string" ? { note: body.note } : {}),
      }
    } else if (op === "remove") {
      const itemId = stringField(body.id)
      if (!itemId) throw badRequest("id is required")
      change = { op, id: itemId }
    } else if (op === "clear") {
      change = { op, scope: body.scope === "all" ? "all" : "done" }
    } else {
      throw badRequest("op must be add, update, remove, or clear")
    }
    return { ok: true, items: await agents.changeTodo(id, change) }
  })

  router.post("/api/session/job/stop", async (request) => {
    const id = requireAgent(request)
    const body = await request.body<{ jobId?: unknown }>()
    const jobId = stringField(body.jobId)
    if (!jobId) throw badRequest("jobId is required")
    const result = await stopJob(
      { terminals: api.terminals, harness: runtime.harness },
      runtime.extensions.jobs,
      runtime.harness,
      conversationIdOf(id),
      jobId,
      BACKGROUND_CONTEXT
    )
    if (!result.ok) throw badRequest(result.error)
    return { ok: true }
  })

  router.get("/api/session/job/log", async (request) => {
    requireAgent(request)
    const jobId = stringField(request.query.get("jobId"))
    if (!jobId) throw badRequest("jobId is required")
    const lines = Math.min(
      5000,
      Math.max(1, queryNumber(request, "tail") ?? 500)
    )
    const text = await runtime.extensions.jobs.log(jobId, lines).catch(() => {
      throw badRequest("Invalid job id")
    })
    return { ok: true, jobId, text }
  })

  router.get("/api/session/scratch", async (request) => {
    const id = requireAgent(request)
    const scratchId = stringField(request.query.get("id"))
    if (!scratchId) throw badRequest("id is required")
    const text = await runtime.extensions.scratch.get(
      conversationIdOf(id),
      scratchId
    )
    if (text === undefined) throw notFound(`No scratch entry ${scratchId}`)
    return { ok: true, id: scratchId, text }
  })

  router.get("/api/session/instructions", async (request) => {
    const id = requireAgent(request)
    const path = stringField(request.query.get("path"))
    if (!path) throw badRequest("path is required")
    const text = await agents.instructionFile(id, path)
    if (text === undefined) throw notFound(`No instruction file ${path}`)
    return { ok: true, path, text }
  })

  // ---------------------------------------------------------------------------
  // Notifications

  router.get("/api/push/key", (request) => {
    const endpoint = stringField(request.query.get("endpoint"))
    return {
      ok: true,
      publicKey: api.notifier.publicKey,
      devices: api.notifier.subscriptionCount,
      ...(endpoint ? { subscribed: api.notifier.has(endpoint) } : {}),
    }
  })

  router.post("/api/push/subscribe", async (request) => {
    const body = await request.body<{
      subscription?: unknown
      label?: unknown
    }>()
    try {
      api.notifier.subscribe(
        body.subscription as never,
        stringField(body.label)?.slice(0, 80)
      )
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : String(error))
    }
    return { ok: true, devices: api.notifier.subscriptionCount }
  })

  router.post("/api/push/unsubscribe", async (request) => {
    const body = await request.body<{ endpoint?: unknown }>()
    const endpoint = stringField(body.endpoint)
    if (!endpoint) throw badRequest("endpoint is required")
    api.notifier.unsubscribe(endpoint)
    return { ok: true, devices: api.notifier.subscriptionCount }
  })

  router.post("/api/push/test", async () => {
    const delivered = await api.notifier.send({
      title: "Pico",
      body: "Notifications work on this device.",
      url: "/",
      tag: "test",
    })
    return { ok: true, delivered }
  })

  // ---------------------------------------------------------------------------
  // Agent settings

  // What uses memory on this machine (see services/resources.ts).
  router.get("/api/resources", async () => ({
    ok: true,
    ...(await collectResources({
      terminals: api.terminals,
      jobs: () => runtime.extensions.jobs.liveJobs(),
      browser: api.host.current?.browser,
    })),
  }))

  router.get("/api/settings/agent", () => ({
    ok: true,
    ...agentSettings(runtime),
  }))

  router.post("/api/settings/agent", async (request) => {
    const body = await request.body<Record<string, unknown>>()
    const change: Record<string, unknown> = {}
    const flag = (key: string) => {
      if (typeof body[key] === "boolean") change[key] = body[key]
    }
    const number = (key: string, min: number, max: number) => {
      if (body[key] === undefined) return
      const value = Number(body[key])
      if (!Number.isInteger(value) || value < min || value > max)
        throw badRequest(`${key} must be a whole number from ${min} to ${max}`)
      change[key] = value
    }
    const text = (key: string, test?: (value: string) => boolean) => {
      if (typeof body[key] !== "string") return
      const value = (body[key] as string).trim()
      if (value && test && !test(value)) throw badRequest(`Invalid ${key}`)
      change[key] = value
    }
    flag("notifyTurnDone")
    flag("notifyNeedsInput")
    flag("browserHeadless")
    number("scratchSpillKb", 0, 10_000)
    number("maxSubagents", 0, 50)
    number("maxSubagentDepth", 0, 10)
    number("compactAtTokens", 0, 100_000_000)
    if (
      typeof change.compactAtTokens === "number" &&
      change.compactAtTokens > 0 &&
      change.compactAtTokens < 10_000
    )
      throw badRequest("compactAtTokens must be 0 (off) or at least 10000")
    text("ntfyUrl", (value) => /^https?:\/\//.test(value))
    text("publicUrl", (value) => /^https?:\/\//.test(value))
    text("jobMemoryHigh", validSize)
    text("jobMemoryMax", validSize)
    if (Array.isArray(body.worktreeCopy))
      change.worktreeCopy = body.worktreeCopy
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    const compactAtChanged =
      change.compactAtTokens !== undefined &&
      change.compactAtTokens !== runtime.settings.data.compactAtTokens
    runtime.settings.update(change as never)
    // The context usage of each session shows the compaction level.
    if (compactAtChanged) await agents.publishWatchedStates()
    return { ok: true, ...agentSettings(runtime) }
  })

  // ---------------------------------------------------------------------------
  // MCP servers

  router.get("/api/mcp/servers", () => ({
    ok: true,
    servers: runtime.mcp.status(),
  }))

  router.post("/api/mcp/:name/auth", async (request) => {
    const headers = request.raw.headers
    const host = String(headers["x-forwarded-host"] ?? headers.host ?? "")
    if (!host) throw badRequest("The request has no host")
    const proto = String(
      headers["x-forwarded-proto"] ??
        ((request.raw.socket as { encrypted?: boolean }).encrypted
          ? "https"
          : "http")
    ).split(",")[0]!
    const redirectUrl = `${proto}://${host}/api/mcp/oauth/callback`
    try {
      return {
        ok: true,
        ...(await runtime.mcp.startAuth(request.params.name!, redirectUrl)),
      }
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : String(error))
    }
  })

  router.post("/api/mcp/:name/signout", async (request) => {
    await runtime.mcp.signOut(request.params.name!).catch((error: unknown) => {
      throw badRequest(error instanceof Error ? error.message : String(error))
    })
    return { ok: true }
  })

  router.post("/api/mcp/:name/reconnect", async (request) => {
    await runtime.mcp
      .reconnect(request.params.name!)
      .catch((error: unknown) => {
        throw badRequest(error instanceof Error ? error.message : String(error))
      })
    return { ok: true }
  })

  router.get("/api/mcp/oauth/callback", async (request, response) => {
    const code = stringField(request.query.get("code"))
    const state = stringField(request.query.get("state"))
    const failure =
      stringField(request.query.get("error_description")) ??
      stringField(request.query.get("error"))
    let title: string
    let message: string
    if (!code || !state) {
      title = "Sign-in failed"
      message = failure ?? "The response has no code."
    } else {
      try {
        const name = await runtime.mcp.finishAuth(
          state,
          code,
          stringField(request.query.get("iss"))
        )
        title = "Signed in"
        message = `Pico is signed in to the MCP server ${name}. You can close this tab.`
      } catch (error) {
        title = "Sign-in failed"
        message = error instanceof Error ? error.message : String(error)
      }
    }
    const escape = (text: string) =>
      text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)
    const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${escape(title)}</h1><p>${escape(message)}</p></body>`
    response.writeHead(title === "Signed in" ? 200 : 400, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    })
    response.end(body)
    return HANDLED
  })

  router.get("/api/profiles", (request) => {
    const { contextId } = target(request)
    const id = agentOf(request)
    return {
      ok: true,
      profiles: agents.profiles(),
      current: id
        ? (agents.meta(id).profile ?? "full")
        : (viewers.get(contextId)?.activeDraft?.profile ?? "full"),
    }
  })

  router.post("/api/session/profile", async (request) => {
    const body = await request.body<{ profile?: unknown; cwd?: unknown }>()
    const name = stringField(body.profile) ?? "full"
    const id = agentOf(request)
    if (id) return { ok: true, profile: await agents.setProfile(id, name) }
    if (!agents.profiles().some((profile) => profile.name === name))
      throw badRequest(`Unknown profile: ${name}`)
    const { contextId } = target(request)
    const cwd =
      typeof body.cwd === "string" && body.cwd.trim()
        ? await files.canonicalDirectory(body.cwd)
        : baseCwd(request)
    ensureDraft(api, contextId, cwd)
    viewers.updateDraft(contextId, {
      profile: name === "full" ? undefined : name,
    })
    return { ok: true, profile: name }
  })

  router.post("/api/settings/profiles", async (request) => {
    const body = await request.body<{ profiles?: unknown }>()
    const value = body.profiles
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw badRequest("profiles must be an object of profiles by name")
    const clean: Record<string, Record<string, unknown>> = {}
    for (const [name, raw] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (!/^[a-z0-9][a-z0-9-_]{0,31}$/i.test(name))
        throw badRequest(`Invalid profile name: ${name}`)
      const profile = (raw ?? {}) as Record<string, unknown>
      const list = (key: string) =>
        Array.isArray(profile[key])
          ? (profile[key] as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : undefined
      clean[name] = {
        description:
          typeof profile.description === "string" ? profile.description : name,
        ...(list("extensions") ? { extensions: list("extensions") } : {}),
        ...(list("removeTools") ? { removeTools: list("removeTools") } : {}),
        ...(typeof profile.instructions === "string"
          ? { instructions: profile.instructions }
          : {}),
      }
    }
    runtime.settings.update({ profiles: clean as never })
    return { ok: true, profiles: agents.profiles(), custom: clean }
  })

  router.get("/api/session/extensions", async (request) => {
    const id = requireAgent(request)
    return {
      ok: true,
      agentId: id,
      state: await agents.extensionState(id),
    }
  })

  router.post("/api/session/rename", async (request) => {
    const body = await request.body<{ path?: string; name?: string }>()
    const name = agents.rename(
      agentFromPath(body.path),
      String(body.name ?? "")
    )
    return { ok: true, name }
  })

  router.post("/api/session/name", async (request) => {
    const body = await request.body<{ path?: string }>()
    return {
      ok: true,
      ...(await agents.generateName(agentFromPath(body.path))),
    }
  })

  router.post("/api/session/delete", async (request) => {
    const body = await request.body<{
      path?: string
      removeWorktree?: boolean
      force?: boolean
    }>()
    const id = agentFromPath(body.path)
    if (body.removeWorktree)
      await agents.removeWorktree(id, Boolean(body.force))
    agents.archive(id)
    return { ok: true }
  })

  router.get("/api/session/draft-worktree", async (request) => {
    const { contextId } = target(request)
    const draft = viewers.get(contextId)?.activeDraft
    const cwd = stringField(request.query.get("cwd")) ?? draft?.cwd
    return {
      ok: true,
      enabled: Boolean(draft?.worktree && draft.cwd === cwd),
      ...(draft?.worktree?.branch ? { branch: draft.worktree.branch } : {}),
      gitRepository: cwd ? Boolean(await repoRoot(cwd)) : false,
    }
  })

  router.post("/api/session/draft-worktree", async (request) => {
    const body = await request.body<{
      cwd?: string
      enabled?: boolean
      branch?: string
    }>()
    const { contextId } = target(request)
    const cwd = body.cwd
      ? await files.canonicalDirectory(body.cwd)
      : baseCwd(request)
    ensureDraft(api, contextId, cwd)
    const branch = stringField(body.branch)
    viewers.updateDraft(contextId, {
      worktree: body.enabled ? (branch ? { branch } : {}) : undefined,
    })
    return {
      ok: true,
      enabled: Boolean(body.enabled),
      ...(branch ? { branch } : {}),
    }
  })

  router.post("/api/agents/delete", async (request) => {
    const body = await request.body<{
      paths?: string[]
      removeWorktree?: boolean
    }>()
    if (!Array.isArray(body.paths) || body.paths.length === 0)
      throw badRequest("paths must not be empty")
    const ids = body.paths.map((path) => agentFromPath(path))
    // Remove worktrees first: one with changes stops the request before archiving.
    if (body.removeWorktree)
      for (const id of ids) await agents.removeWorktree(id, false)
    const deletedPaths: string[] = []
    for (const [index, id] of ids.entries()) {
      agents.archive(id)
      deletedPaths.push(body.paths[index]!)
    }
    return { ok: true, deletedPaths }
  })

  router.get("/api/agents/archived", () => ({
    ok: true,
    agents: agents.archivedAgents(),
  }))

  router.post("/api/session/restore", async (request) => {
    const body = await request.body<{ path?: string }>()
    const id = agentFromPath(body.path)
    agents.restore(id)
    return {
      ok: true,
      path: agentPath(id),
      directory: agents.directoryOf(id),
    }
  })

  router.post("/api/session/move", async (request) => {
    const body = await request.body<{ path?: string; cwd?: string }>()
    const id = agentFromPath(body.path)
    const cwd = await files.canonicalDirectory(String(body.cwd ?? ""))
    const { previousCwd } = await agents.move(id, cwd)
    return {
      ok: true,
      previousPath: agentPath(id),
      previousCwd,
      path: agentPath(id),
      cwd,
      agentId: id,
    }
  })

  router.post("/api/session/read-state", async (request) => {
    const body = await request.body<{ path?: string; unread?: boolean }>()
    const id = agentFromPath(body.path)
    const unread = Boolean(body.unread)
    // The read state is global; Agents tells every tab about the change.
    viewers.setRead(id, !unread)
    return { ok: true, path: agentPath(id), unread }
  })

  router.get("/api/session/tree", async (request) =>
    agents.tree(requireAgent(request))
  )

  router.post("/api/session/tree", async (request) => {
    const body = await request.body<{ targetId?: string }>()
    const targetId = stringField(body.targetId)
    if (!targetId) throw badRequest("targetId is required")
    return {
      ok: true,
      ...(await agents.navigate(requireAgent(request), targetId)),
    }
  })

  router.post("/api/session/tree/label", async (request) => {
    const body = await request.body<{ entryId?: string; label?: string }>()
    const entryId = stringField(body.entryId)
    if (!entryId) throw badRequest("entryId is required")
    const id = requireAgent(request)
    if (agents.isBusy(id))
      throw badRequest(
        "Wait for the session to finish before changing a label."
      )
    agents.setLabel(
      id,
      entryId,
      typeof body.label === "string" ? body.label : undefined
    )
    return agents.tree(id)
  })

  router.get("/api/session/fork", async (request) => ({
    ok: true,
    messages: await agents.forkMessages(requireAgent(request)),
  }))

  router.post("/api/session/fork", async (request) => {
    const body = await request.body<{ entryId?: string }>()
    const entryId = stringField(body.entryId)
    if (!entryId) throw badRequest("entryId is required")
    const id = requireAgent(request)
    const forked = await agents.fork(id, entryId, target(request).contextId)
    return {
      ok: true,
      cancelled: false,
      draft: false,
      previousAgentFile: agentPath(id),
      agentKey: agentKey(forked),
      agentId: forked,
      agentFile: agentPath(forked),
    }
  })

  router.post("/api/session/clone", async (request) => {
    const id = requireAgent(request)
    const cloned = await agents.clone(id, target(request).contextId)
    return {
      ok: true,
      cancelled: false,
      draft: false,
      previousAgentFile: agentPath(id),
      agentId: cloned,
      agentFile: agentPath(cloned),
    }
  })

  return router
}

function agentSettings(runtime: Runtime) {
  const data = runtime.settings.data
  return {
    notifyTurnDone: data.notifyTurnDone,
    notifyNeedsInput: data.notifyNeedsInput,
    ntfyUrl: data.ntfyUrl,
    publicUrl: data.publicUrl,
    browserHeadless: data.browserHeadless,
    scratchSpillKb: data.scratchSpillKb,
    maxSubagents: data.maxSubagents,
    maxSubagentDepth: data.maxSubagentDepth,
    worktreeCopy: data.worktreeCopy,
    jobMemoryHigh: data.jobMemoryHigh,
    jobMemoryMax: data.jobMemoryMax,
    compactAtTokens: data.compactAtTokens,
  }
}

function ensureDraft(api: ApiContext, contextId: string, cwd: string) {
  if (api.viewers.get(contextId)?.activeDraft) return
  api.viewers.selectDraft(contextId, { agentKey: `draft:${cwd}`, cwd })
}

async function generateCommitMessage(api: ApiContext, cwd: string) {
  const diff = await git.commitMessageContext(cwd)
  if (!diff.trim()) throw badRequest("No changes to commit")
  const ref = api.agents.defaultModel()
  const model = ref
    ? api.runtime.models.getModel(ref.provider, ref.modelId)
    : undefined
  if (!model) throw new Error("No model is available")
  const response = await api.runtime.models.completeSimple(
    model,
    {
      messages: [
        {
          role: "user",
          content: `Write one concise imperative git commit subject, at most 72 characters. Return only the subject with no quotes or markdown.\n\n${diff}`,
          timestamp: Date.now(),
        },
      ],
    },
    { reasoning: "low", signal: AbortSignal.timeout(90_000) }
  )
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage || "commit message generation failed")
  }
  const text = response.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
  return (text.split("\n").find((line) => line.trim()) ?? "")
    .trim()
    .replace(/^[`"']+|[`"']+$/g, "")
    .slice(0, 72)
}

// -----------------------------------------------------------------------------
// The event stream

type Item = unknown

/**
 * One viewer context's event stream: a bootstrap (missed events, the selected
 * session's state, the session list), then live events for that context and
 * its selected session. State syncs are sent as patches against the items the
 * client already has.
 */
function streamEvents(
  api: ApiContext,
  request: Request,
  response: ServerResponse
) {
  const { agents, viewers, hub } = api
  const contextId = stringField(request.query.get("context")) ?? "default"
  const pinned = parseAgentId(stringField(request.query.get("session")))
  const queryKey = stringField(request.query.get("agentKey"))
  const sidebarDirectories = request.query
    .getAll("sidebarDirectory")
    .map((value) => value.trim())
    .filter(Boolean)
  const header = request.raw.headers["last-event-id"]
  const lastEventId =
    (header
      ? looseNumber(Array.isArray(header) ? header[0] : header)
      : undefined) ?? queryNumber(request, "lastEventId")

  const pending: ServerEvent[] = []
  let ready = false
  let stream: SseStream | undefined
  let liveAgent: string | undefined
  let releaseWatch: (() => void) | undefined
  let watchedAgent: string | undefined
  let previousItems: Item[] = []
  let previousHistoryOffset: unknown
  let itemsChangedByDelta = false

  // The URL session initializes this viewer. Later selections must follow
  // the viewer too: the client keeps the same EventSource when switching.
  const currentAgent = () => {
    const selected = viewers.get(contextId)?.selectedAgent
    const current = agents.current(selected)
    return current && agents.has(current) ? current : undefined
  }
  const bindWatch = (id: string | undefined) => {
    if (id === watchedAgent && releaseWatch) return
    releaseWatch?.()
    watchedAgent = id
    releaseWatch = id ? agents.watch(id) : undefined
  }

  const deliver = (event: ServerEvent) => {
    if (!stream || stream.isClosed) return
    const session = currentAgent()
    if (!eventMatches(event, contextId, session)) return
    const payload = event.payload
    if (payload.type === "state_sync") {
      const items = Array.isArray(payload.items)
        ? (payload.items as Item[])
        : undefined
      if (!items) {
        stream.send(payload, event.sequence)
        return
      }
      const syncedAgent =
        typeof payload.agentId === "string" ? payload.agentId : undefined
      // A patch has no history offset. When the history window slides,
      // send all items so the client can line up its older history.
      const historyOffset = payload.historyOffset
      if (
        syncedAgent !== liveAgent ||
        itemsChangedByDelta ||
        historyOffset !== previousHistoryOffset
      ) {
        liveAgent = syncedAgent
        bindWatch(syncedAgent)
        previousItems = items
        previousHistoryOffset = historyOffset
        itemsChangedByDelta = false
        stream.send(payload, event.sequence)
        return
      }
      stream.send(patchStateSync(previousItems, payload, items), event.sequence)
      previousItems = items
      return
    }
    if (payload.type === "conversation_delta") itemsChangedByDelta = true
    stream.send(payload, event.sequence)
  }

  const detach = viewers.attach(contextId)
  const unsubscribe = hub.subscribe((event) => {
    if (!ready) pending.push(event)
    else deliver(event)
  })

  void (async () => {
    const viewer = viewers.connect(
      contextId,
      pinned ? agents.current(pinned) : undefined,
      sidebarDirectories
    )
    if (!pinned && !viewer.selectedAgent && queryKey?.startsWith("draft:")) {
      const cwd = draftCwdFromKey(queryKey) ?? homedir()
      if (viewer.activeDraft?.agentKey !== queryKey)
        viewers.selectDraft(contextId, { agentKey: queryKey, cwd })
    }
    const session = currentAgent()
    const statePayload = session
      ? await agents.stateSync(session)
      : await agents.draftStateSync(
          viewers.get(contextId)?.activeDraft ?? {
            agentKey: "draft:default",
            cwd: viewer.sidebarDirectories[0] ?? homedir(),
          }
        )
    const agentsPayload = agents.agentsPayload({
      ...(session ? { activeAgentId: session } : {}),
      directories: sidebarDirectories,
      unread: viewers.unread(),
    })
    stream = new SseStream(request.raw, response)
    if (lastEventId !== undefined) {
      const missed = hub.eventsAfter(lastEventId)
      if (!missed) {
        stream.send({
          type: "request_error",
          scope: "events",
          message: "Event replay window expired; state was resynchronized",
        })
      } else {
        for (const event of missed) {
          if (
            event.payload.type === "state_sync" ||
            event.payload.type === "conversation_delta"
          )
            continue
          if (
            event.payload.type === "extension_ui_request" &&
            !api.ui.has(String(event.payload.id))
          )
            continue
          if (eventMatches(event, contextId, session))
            stream.send(event.payload, event.sequence)
        }
      }
    }
    liveAgent = session
    bindWatch(session)
    previousItems = Array.isArray(statePayload.items) ? statePayload.items : []
    stream.send(statePayload)
    stream.send(agentsPayload)
    ready = true
    for (const event of pending.splice(0)) {
      // The bootstrap already holds the state these carried.
      if (event.payload.type === "state_sync" && event.agentId === session)
        continue
      if (event.payload.type === "conversation_delta") continue
      deliver(event)
    }
    await stream.closed
  })()
    .catch((error: unknown) => {
      console.error("[pico] event stream failed:", error)
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        )
      } else {
        stream?.close()
      }
    })
    .finally(() => {
      unsubscribe()
      detach()
      releaseWatch?.()
    })
}

/** A state sync whose items are a splice against what the client has. */
function patchStateSync(
  previous: Item[],
  payload: Record<string, unknown>,
  next: Item[]
) {
  const same = (left: Item, right: Item) =>
    left === right || JSON.stringify(left) === JSON.stringify(right)
  let start = 0
  while (
    start < previous.length &&
    start < next.length &&
    same(previous[start], next[start])
  )
    start += 1
  let previousEnd = previous.length
  let nextEnd = next.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    same(previous[previousEnd - 1], next[nextEnd - 1])
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }
  const result: Record<string, unknown> = { ...payload }
  delete result.items
  result.itemsPatch = {
    previousLength: previous.length,
    start,
    deleteCount: previousEnd - start,
    items: next.slice(start, nextEnd),
  }
  for (const key of [
    "historyOffset",
    "historyTotalCount",
    "availableSkills",
    "firstMessage",
    "agentId",
    "agentFile",
    "cwd",
    "modified",
  ]) {
    delete result[key]
  }
  return result
}
