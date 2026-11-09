/**
 * Agent operations for clients outside Pico: the `/api/machine/agent/*`
 * routes, the MCP server (`mcp.ts`), and the `pico-app agent` command
 * (`cli.ts`).
 *
 * `LocalAgentOps` works on the agents of this server. `RouteAgentBackend`
 * calls the same operations on another server through its routes: the hub
 * uses it for a remote machine, and the command uses it for the hub.
 * `waitUntilSettled` waits on either one until a run settles.
 *
 * A run settles when the agent is done, stopped, failed, or waits for the
 * user (`needs_input`). An agent that waits on a job has not settled: it
 * goes on when the job ends.
 */
import { relative, sep } from "node:path"
import { homedir } from "node:os"

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context"

import type {
  AgentSearch,
  AgentSearchInput,
  AgentSearchResult,
  AroundResult,
} from "../core/agent-search.ts"
import { conversationIdOf, type Agents } from "../core/agents.ts"
import type { Runtime } from "../core/runtime.ts"
import type { EventHub } from "../events.ts"
import {
  answerTo,
  lastAnswerEntry,
  normalizeAgentId,
  runningToolLines,
  STOPPED_ANSWER,
  transcriptText,
  waitingOn,
} from "../extensions/agents.ts"
import { badRequest, notFound } from "../http.ts"
import { findProfile } from "../core/profiles.ts"
import * as files from "../services/files.ts"
import { createWorktree } from "../services/worktree.ts"

/**
 * The state of a run:
 * - `working`: the agent works.
 * - `waiting`: its turn ended on a job, and it goes on when the job ends.
 * - `needs_input`: it waits for the user (`ask_user`, or a job that needs
 *   input).
 * - `done`, `stopped`, `failed`: the run ended.
 */
export type RunState =
  | "working"
  | "waiting"
  | "needs_input"
  | "done"
  | "stopped"
  | "failed"

export type AgentInfo = {
  agentId: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  /** The tool calls that run now. */
  running?: string[]
  worktree?: { path: string; branch: string }
}

export type AgentListItem = {
  id: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  waiting?: string
  unread?: boolean
  parent?: string
  worktreeBranch?: string
  lastMessageAt?: number
  running?: string[]
}

export type SpawnInput = {
  goal: string
  requestId: string
  name?: string
  cwd?: string
  model?: string
  thinking?: string
  profile?: string
  worktree?: boolean | { branch?: string; base?: string }
}

export type PromptInput = {
  id: string
  message: string
  requestId: string
  mode?: "followUp" | "steer"
}

/** A started run: the agent, and the request ID of its message. */
export type RunInfo = AgentInfo & { request?: string }

export type WaitResult = AgentInfo & {
  idle: boolean
  state?: RunState
  answer?: string
  answerId?: number
  waiting?: string
}

/** The operations; `RouteAgentBackend` and `LocalAgentOps` have them. */
export interface AgentBackend {
  list(filter: { project?: string }): Promise<AgentListItem[]>
  spawn(input: SpawnInput): Promise<RunInfo>
  prompt(input: PromptInput): Promise<RunInfo>
  read(input: {
    id: string
    last?: number
    includeTools?: boolean
  }): Promise<AgentInfo & { text: string }>
  /**
   * One wait of at most `timeoutMs` (a long poll). With `request`, the run
   * of that message; else the agent's newest run.
   */
  wait(input: {
    id: string
    timeoutMs: number
    request?: string
    signal?: AbortSignal
  }): Promise<WaitResult>
  stop(id: string): Promise<AgentInfo>
  /** Search the messages of all agents; the best agents first. */
  search(input: AgentSearchInput): Promise<AgentSearchResult>
  /** The messages around an entry of a search hit. */
  around(input: { entry: number; count?: number }): Promise<AroundResult>
}

/** The text that `lastAnswerEntry` gives for a turn that failed. */
const FAILED_PREFIX = "(the turn failed"

/**
 * The state of a wait result. Older servers send no `state`: then it comes
 * from the other fields.
 */
export function stateOf(result: WaitResult): RunState {
  if (result.state) return result.state
  if (result.needsInput) return "needs_input"
  if (!result.idle) return "working"
  if (result.waiting) return "waiting"
  if (result.answer === STOPPED_ANSWER) return "stopped"
  if (result.answer?.startsWith(FAILED_PREFIX)) return "failed"
  return "done"
}

/** True when the run settled: it will not go on without a new message. */
export function settled(state: RunState) {
  return state !== "working" && state !== "waiting"
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })
}

/**
 * Wait until a run settles or `timeoutMs` passes (no limit without it).
 * Returns the last result; its state tells which one happened.
 */
export async function waitUntilSettled(
  backend: AgentBackend,
  input: {
    id: string
    request?: string
    timeoutMs?: number
    signal?: AbortSignal
    /** The longest single wait; long polls over HTTP stay below proxy limits. */
    pollMs?: number
  }
): Promise<WaitResult & { state: RunState }> {
  const deadline =
    input.timeoutMs === undefined ? undefined : Date.now() + input.timeoutMs
  const poll = input.pollMs ?? 25_000
  for (;;) {
    const left = deadline === undefined ? poll : deadline - Date.now()
    const result = await backend.wait({
      id: input.id,
      timeoutMs: Math.max(0, Math.min(poll, left)),
      ...(input.request ? { request: input.request } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
    const state = stateOf(result)
    if (
      settled(state) ||
      input.signal?.aborted ||
      (deadline !== undefined && Date.now() >= deadline)
    )
      return { ...result, state }
    // An older server answers at once for an agent that waits on a job.
    if (state === "waiting" && !result.state) await sleep(3000, input.signal)
  }
}

/** The options of a JSON request to a Pico server. */
export type RouteRequest = (
  method: "GET" | "POST",
  path: string,
  options?: { body?: unknown; timeoutMs?: number; signal?: AbortSignal }
) => Promise<unknown>

/** The operations of another Pico server, through its routes. */
export class RouteAgentBackend implements AgentBackend {
  readonly #request: RouteRequest

  constructor(request: RouteRequest) {
    this.#request = request
  }

  async list(filter: { project?: string }) {
    const query = filter.project
      ? `?project=${encodeURIComponent(filter.project)}`
      : ""
    const result = (await this.#request(
      "GET",
      `/api/machine/agents${query}`
    )) as { agents: AgentListItem[] }
    return result.agents
  }

  async spawn(input: SpawnInput) {
    return (await this.#request("POST", "/api/machine/agent/spawn", {
      body: input,
    })) as RunInfo
  }

  async prompt(input: PromptInput) {
    return (await this.#request("POST", "/api/machine/agent/prompt", {
      body: input,
    })) as RunInfo
  }

  async read(input: { id: string; last?: number; includeTools?: boolean }) {
    const query = new URLSearchParams({ id: input.id })
    if (input.last) query.set("last", String(input.last))
    if (input.includeTools) query.set("includeTools", "1")
    return (await this.#request(
      "GET",
      `/api/machine/agent/read?${query.toString()}`
    )) as AgentInfo & { text: string }
  }

  async wait(input: {
    id: string
    timeoutMs: number
    request?: string
    signal?: AbortSignal
  }) {
    const query = new URLSearchParams({
      id: input.id,
      timeoutMs: String(input.timeoutMs),
      settle: "1",
    })
    if (input.request) query.set("request", input.request)
    return (await this.#request(
      "GET",
      `/api/machine/agent/wait?${query.toString()}`,
      {
        timeoutMs: input.timeoutMs + 20_000,
        ...(input.signal ? { signal: input.signal } : {}),
      }
    )) as WaitResult
  }

  async stop(id: string) {
    return (await this.#request("POST", "/api/machine/agent/stop", {
      body: { id },
    })) as AgentInfo
  }

  async search(input: AgentSearchInput) {
    const query = new URLSearchParams({ q: input.query })
    if (input.project) query.set("project", input.project)
    if (input.exclude) query.set("exclude", input.exclude)
    if (input.limit) query.set("limit", String(input.limit))
    if (input.prefix) query.set("prefix", "1")
    return (await this.#request(
      "GET",
      `/api/machine/agent/search?${query.toString()}`
    )) as AgentSearchResult
  }

  async around(input: { entry: number; count?: number }) {
    const query = new URLSearchParams({ entry: String(input.entry) })
    if (input.count) query.set("count", String(input.count))
    return (await this.#request(
      "GET",
      `/api/machine/agent/around?${query.toString()}`
    )) as AroundResult
  }
}

/** True when `path` is `root` or inside it. */
function isInside(root: string, path: string) {
  const rest = relative(root, path)
  return rest === "" || (!rest.startsWith("..") && !rest.startsWith(sep))
}

/** The operations on the agents of this server. */
export class LocalAgentOps implements AgentBackend {
  readonly #agents: Agents
  readonly #runtime: Runtime
  readonly #hub: EventHub
  readonly #dataDir: string
  readonly #search: AgentSearch

  constructor(context: {
    agents: Agents
    runtime: Runtime
    hub: EventHub
    search: AgentSearch
    dataDir: string
  }) {
    this.#agents = context.agents
    this.#runtime = context.runtime
    this.#hub = context.hub
    this.#search = context.search
    this.#dataDir = context.dataDir
  }

  async search(input: AgentSearchInput) {
    if (!input.query.trim()) throw badRequest("query is required")
    return this.#search.search(input).catch((error: unknown) => {
      throw badRequest(error instanceof Error ? error.message : String(error))
    })
  }

  async around(input: { entry: number; count?: number }) {
    try {
      return this.#search.around(input.entry, input.count ?? 6)
    } catch (error) {
      throw notFound(error instanceof Error ? error.message : String(error))
    }
  }

  /** The current ID of an agent from `s12`, `12`, or `pico:s12`. */
  requireAgent(value: unknown) {
    const text = typeof value === "string" ? value : ""
    const id = this.#agents.current(normalizeAgentId(text))
    if (!id || !this.#agents.has(id)) throw notFound(`Unknown agent: ${text}`)
    return id
  }

  info(id: string): AgentInfo {
    const agents = this.#agents
    const summary = agents.list({}).find((entry) => entry.id === id)
    const meta = agents.meta(id)
    const running = runningToolLines(agents, id)
    return {
      agentId: id,
      title: summary?.title ?? meta.name ?? id,
      cwd: meta.cwd,
      busy: agents.isBusy(id),
      needsInput: agents.needsInput(id),
      running,
      ...(meta.worktree
        ? {
            worktree: {
              path: meta.worktree.path,
              branch: meta.worktree.branch,
            },
          }
        : {}),
    }
  }

  /** What an idle agent waits on: a job. */
  #waitingOf(id: string) {
    return waitingOn(
      this.#runtime.harness,
      conversationIdOf(id),
      BACKGROUND_CONTEXT
    )
  }

  async list(filter: { project?: string }) {
    const list = this.#agents
      .list(filter.project ? { project: filter.project } : {})
      .slice(0, 50)
    return Promise.all(
      list.map(async (item): Promise<AgentListItem> => {
        const base: AgentListItem = {
          id: item.id,
          title: item.title,
          cwd: item.cwd,
          busy: item.busy,
          needsInput: item.needsInput,
          ...(item.unread ? { unread: true } : {}),
          ...(item.parent ? { parent: item.parent } : {}),
          ...(item.worktreeBranch
            ? { worktreeBranch: item.worktreeBranch }
            : {}),
          ...(item.lastMessageAt ? { lastMessageAt: item.lastMessageAt } : {}),
        }
        if (item.busy) {
          const running = runningToolLines(this.#agents, item.id)
          return running.length > 0 ? { ...base, running } : base
        }
        if (item.needsInput) return base
        const waiting = await this.#waitingOf(item.id)
        return waiting ? { ...base, waiting } : base
      })
    )
  }

  /**
   * The sidebar project for a new agent in `cwd`: the deepest project that
   * contains it. Without one, `cwd` becomes a project, so the agent shows.
   */
  #projectFor(cwd: string) {
    const projects = this.#runtime.sidebar.snapshot().projects
    const found = projects
      .filter((project) => isInside(project, cwd))
      .sort((left, right) => right.length - left.length)[0]
    if (found) return found
    const state = this.#runtime.sidebar.merge({ projects: [cwd] })
    this.#hub.push({ type: "sidebar_state", ...state, clientId: "" })
    return cwd
  }

  #parseModel(value: string | undefined) {
    const trimmed = value?.trim()
    if (!trimmed) return undefined
    const slash = trimmed.indexOf("/")
    if (slash > 0)
      return {
        provider: trimmed.slice(0, slash),
        modelId: trimmed.slice(slash + 1),
      }
    const match = this.#agents
      .availableModels()
      .find((candidate) => candidate.id === trimmed)
    if (!match?.provider) throw badRequest(`Unknown model: ${trimmed}`)
    return { provider: match.provider, modelId: match.id }
  }

  async spawn(input: SpawnInput): Promise<RunInfo> {
    const agents = this.#agents
    const goal = input.goal.trim()
    if (!goal) throw badRequest("goal is required")
    if (!input.requestId) throw badRequest("requestId is required")
    // The marker finds the agent when the same request comes again.
    const marker = `hub:${input.requestId}`
    let id = agents
      .list({})
      .find((entry) => agents.meta(entry.id).spawnedByCall === marker)?.id
    if (!id) {
      const settings = this.#runtime.settings.data
      if (input.profile && !findProfile(input.profile, settings.profiles))
        throw badRequest(`Unknown profile: ${input.profile}`)
      const model = this.#parseModel(input.model)
      const thinking = input.thinking?.trim()
      if (thinking) agents.validateThinkingLevel(thinking)
      let cwd = await files.canonicalDirectory(
        input.cwd?.trim() ||
          this.#runtime.sidebar.snapshot().projects[0] ||
          homedir()
      )
      const group = this.#projectFor(cwd)
      let worktree:
        | { repoRoot: string; path: string; branch: string }
        | undefined
      if (input.worktree) {
        const options = typeof input.worktree === "object" ? input.worktree : {}
        const created = await createWorktree(cwd, {
          dataDir: this.#dataDir,
          copy: settings.worktreeCopy,
          name: input.name ?? goal.slice(0, 40),
          ...(options.branch ? { branch: options.branch } : {}),
          ...(options.base ? { base: options.base } : {}),
        }).catch((error: unknown) => {
          throw badRequest(
            `Could not create the worktree: ${error instanceof Error ? error.message : String(error)}`
          )
        })
        worktree = {
          repoRoot: created.repoRoot,
          path: created.path,
          branch: created.branch,
        }
        cwd = created.cwd
      }
      const profile = input.profile
        ? findProfile(input.profile, settings.profiles)?.name
        : undefined
      id = await agents.create(cwd, {
        spawnedByCall: marker,
        group,
        ...(model ? { model } : {}),
        ...(thinking ? { thinkingLevel: thinking } : {}),
        ...(profile ? { profile } : {}),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(worktree ? { worktree } : {}),
      })
    }
    const request = `spawn:${marker}`
    await agents.prompt(id, { message: goal, images: [], requestId: request })
    return { ...this.info(id), request }
  }

  async prompt(input: PromptInput): Promise<RunInfo> {
    const id = this.requireAgent(input.id)
    if (!input.message.trim()) throw badRequest("message is required")
    if (!input.requestId) throw badRequest("requestId is required")
    const request = `hub:${input.requestId}`
    await this.#agents.prompt(id, {
      message: input.message,
      images: [],
      streamingBehavior: input.mode === "steer" ? "steer" : "followUp",
      requestId: request,
    })
    return { ...this.info(id), request }
  }

  async read(input: { id: string; last?: number; includeTools?: boolean }) {
    const id = this.requireAgent(input.id)
    const text = await transcriptText(
      this.#runtime.harness,
      conversationIdOf(id),
      {
        last: Math.min(50, Math.max(1, input.last ?? 6)),
        includeTools: Boolean(input.includeTools),
      },
      BACKGROUND_CONTEXT
    )
    return { ...this.info(id), text: text ?? "" }
  }

  /**
   * Wait up to `timeoutMs` until the agent is idle (the old wait of the
   * hub's agent tools; they look at `waiting` themselves).
   */
  async waitIdle(input: { id: string; timeoutMs: number }) {
    const id = this.requireAgent(input.id)
    const conversation = await this.#runtime.harness.conversation(
      conversationIdOf(id),
      BACKGROUND_CONTEXT
    )
    let idle = true
    if (conversation && input.timeoutMs > 0) {
      try {
        await conversation.waitForIdle(
          withAbortSignal(
            AbortSignal.timeout(input.timeoutMs),
            BACKGROUND_CONTEXT
          )
        )
      } catch {
        idle = false
      }
    }
    if (idle && this.#agents.isBusy(id)) idle = false
    return this.#result(id, idle, undefined)
  }

  /**
   * Wait up to `timeoutMs` until the run settles (see the file comment).
   * With `request`, the answer is the answer to that message.
   */
  async wait(input: {
    id: string
    timeoutMs: number
    request?: string
    signal?: AbortSignal
  }): Promise<WaitResult> {
    const id = this.requireAgent(input.id)
    const conversation = await this.#runtime.harness.conversation(
      conversationIdOf(id),
      BACKGROUND_CONTEXT
    )
    const deadline = Date.now() + input.timeoutMs
    // After a job ends, the agent's newest answer is the one to give.
    let request = input.request
    let waiting = false
    for (;;) {
      if (this.#agents.needsInput(id))
        return this.#result(id, false, request, "needs_input")
      waiting = false
      if (!this.#agents.isBusy(id)) {
        const done = request
          ? await answerTo(
              this.#runtime.harness,
              conversationIdOf(id),
              request,
              BACKGROUND_CONTEXT
            )
          : true
        if (done) {
          if (await this.#waitingOf(id)) {
            waiting = true
            request = undefined
          } else if (!this.#agents.isBusy(id))
            return this.#result(id, true, request)
        }
      }
      const left = deadline - Date.now()
      if (left <= 0 || input.signal?.aborted)
        return this.#result(id, false, request, waiting ? "waiting" : "working")
      const step = Math.min(1000, left)
      const signal = input.signal
        ? AbortSignal.any([AbortSignal.timeout(step), input.signal])
        : AbortSignal.timeout(step)
      const started = Date.now()
      try {
        await conversation?.waitForIdle(
          withAbortSignal(signal, BACKGROUND_CONTEXT)
        )
      } catch {
        // The step ended; look again.
      }
      // waitForIdle answers at once for an idle conversation: do not spin.
      if (Date.now() - started < 200) await sleep(200, input.signal)
    }
  }

  /** The result of a wait; `state` comes from the fields when it is not given. */
  async #result(
    id: string,
    idle: boolean,
    request: string | undefined,
    state?: RunState
  ): Promise<WaitResult> {
    const info = this.info(id)
    const harness = this.#runtime.harness
    const conversation = conversationIdOf(id)
    const answer = idle
      ? ((request
          ? await answerTo(harness, conversation, request, BACKGROUND_CONTEXT)
          : undefined) ??
        (await lastAnswerEntry(harness, conversation, BACKGROUND_CONTEXT)))
      : undefined
    const waiting =
      idle || state === "waiting" ? await this.#waitingOf(id) : undefined
    const result: WaitResult = {
      ...info,
      idle,
      ...(answer !== undefined ? { answer: answer.text } : {}),
      ...(answer?.id !== undefined ? { answerId: Number(answer.id) } : {}),
      ...(waiting ? { waiting } : {}),
    }
    return { ...result, state: state ?? stateOf(result) }
  }

  async stop(id: string) {
    const agent = this.requireAgent(id)
    await this.#agents.abort(agent)
    return this.info(agent)
  }
}
