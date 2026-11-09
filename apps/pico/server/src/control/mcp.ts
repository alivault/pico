/**
 * Pico's MCP server, at `/mcp`: agents outside Pico (Claude Code, Codex, and
 * others) list, start, message, read, wait for, and stop Pico agents.
 *
 * It speaks the Streamable HTTP transport without sessions: each POST
 * carries JSON-RPC messages and gets one JSON answer. There is no server
 * event stream, so GET is refused. Access is the same as for the rest of
 * Pico's API: the server checks the host and the origin (`security.ts`),
 * and the network (loopback or Tailscale) decides who can reach it.
 *
 * On a hub, the tools take a `machine`, or an ID such as `workbox:s12`, and
 * work on that machine through its connection.
 */
import { randomUUID } from "node:crypto"
import type { ServerResponse } from "node:http"
import { hostname } from "node:os"

import { VERSION } from "../config.ts"
import { normalizeAgentId } from "../extensions/agents.ts"
import { HANDLED, sendJson, type Router } from "../http.ts"
import type { MachineManager } from "../machines/manager.ts"
import {
  LocalAgentOps,
  RouteAgentBackend,
  waitUntilSettled,
  type AgentBackend,
} from "./agent-ops.ts"
import {
  aroundText,
  formatSearchResult,
  plainSnippet,
} from "../core/agent-search.ts"
import { formatAgentList, formatPlace, formatWaitResult } from "./format.ts"

/** Protocol versions that this server speaks; the first is the newest. */
const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]

/**
 * How long a wait lasts when the call does not say. MCP clients stop a tool
 * call after a time (Codex after 60 s by default), so a wait ends before
 * that, and the agent waits again.
 */
const DEFAULT_WAIT_SECONDS = 50
const MAX_WAIT_SECONDS = 3600

const INSTRUCTIONS = [
  "Pico runs coding agents that keep working in the background, also when no client is open.",
  "Start an agent with start_agent and a complete brief: it does not see your conversation. Each agent has an ID such as s12; an agent on another machine of the hub has an ID such as workbox:s12.",
  "send_message never interrupts: a busy agent gets the message after its current turn, unless steer is true.",
  "search_agents finds past work in the messages of all agents.",
  "With wait, a call returns the agent's answer when it is done, or its state when the wait ends first. Wait again with wait_for_agent.",
].join(" ")

type JsonRpcMessage = {
  jsonrpc?: unknown
  id?: string | number | null
  method?: unknown
  params?: unknown
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

class ToolError extends Error {}

const MACHINE = {
  type: "string",
  description:
    "Another machine of this Pico hub (label or ID). Without it, the tool works on the hub. An ID such as workbox:s12 also names the machine.",
}
const ID = {
  type: "string",
  description: "The agent ID, for example s12, or workbox:s12",
}
const WAIT = {
  type: "boolean",
  description: "Wait for the answer (up to timeout seconds)",
}
const TIMEOUT = {
  type: "number",
  description: `With wait: stop waiting after this many seconds (default ${DEFAULT_WAIT_SECONDS}). The agent works on.`,
}

const TOOLS = [
  {
    name: "list_machines",
    title: "List machines",
    description: "List the machines of this Pico hub and their states.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_agents",
    title: "List agents",
    description:
      "List the agents of a machine, the most recently active first: ID, state, title, and directory.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Only agents of this project directory",
        },
        machine: MACHINE,
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "start_agent",
    title: "Start an agent",
    description:
      "Start a Pico agent that works on goal. It works in the background; the user can open it in Pico. Write goal as a complete brief.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The first message" },
        cwd: {
          type: "string",
          description:
            "The directory to work in (absolute, or with ~). Default: the first project of Pico.",
        },
        name: { type: "string", description: "A short name" },
        model: {
          type: "string",
          description: "provider/modelId, or a model ID. Default: Pico's.",
        },
        thinking: {
          type: "string",
          description: "Thinking level: off, minimal, low, medium, high, xhigh",
        },
        profile: {
          type: "string",
          description:
            "Tools profile: builder, researcher, reviewer, read-only, full (default), or a profile of the user",
        },
        worktree: {
          type: "boolean",
          description:
            "Work in a new git worktree and branch, so parallel agents do not edit the same files",
        },
        branch: {
          type: "string",
          description: "With worktree: the branch name",
        },
        base: {
          type: "string",
          description: "With worktree: the branch to start from",
        },
        wait: WAIT,
        timeout: TIMEOUT,
        machine: MACHINE,
      },
      required: ["goal"],
    },
  },
  {
    name: "send_message",
    title: "Send a message",
    description:
      "Send a message to an agent. A busy agent gets it after its current turn; with steer, it gets it at once.",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        message: { type: "string" },
        steer: {
          type: "boolean",
          description:
            "Give the message to a busy agent at once. A steer also answers a question that the agent asks the user.",
        },
        wait: WAIT,
        timeout: TIMEOUT,
        machine: MACHINE,
      },
      required: ["id", "message"],
    },
  },
  {
    name: "search_agents",
    title: "Search agents",
    description:
      "Find past work: search the messages of all Pico agents, also archived ones. Returns the best agents, each with matching excerpts and their entry IDs. Read the messages around a hit with read_agent and entry.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Words that must all match; "a phrase" in quotes',
        },
        project: {
          type: "string",
          description: "Only agents of this project directory",
        },
        limit: {
          type: "number",
          description: "The most agents (default 10, at most 50)",
        },
        machine: MACHINE,
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_agent",
    title: "Read an agent",
    description:
      "Read the last messages of an agent, with its state and what it runs now.",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        last: {
          type: "number",
          description: "How many messages (default 6, at most 50)",
        },
        include_tools: {
          type: "boolean",
          description: "Also show tool results",
        },
        entry: {
          type: "number",
          description:
            "The messages around this entry of a search hit, not the last ones",
        },
        machine: MACHINE,
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "wait_for_agent",
    title: "Wait for an agent",
    description:
      "Wait until an agent is done, stopped, failed, or waits for the user, and get its answer. An agent that waits on a job is not done.",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        timeout: {
          type: "number",
          description: `Stop waiting after this many seconds (default ${DEFAULT_WAIT_SECONDS})`,
        },
        machine: MACHINE,
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "stop_agent",
    title: "Stop an agent",
    description:
      "Stop the current turn of an agent. The agent stays; send it a message to go on.",
    inputSchema: {
      type: "object",
      properties: { id: ID, machine: MACHINE },
      required: ["id"],
    },
    annotations: { destructiveHint: true },
  },
]

function text(value: string, structured?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: value }],
    ...(structured ? { structuredContent: structured } : {}),
  }
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") throw new ToolError(`${key} must be a string`)
  return value.trim() || undefined
}

function requiredArg(args: Record<string, unknown>, key: string) {
  const value = stringArg(args, key)
  if (!value) throw new ToolError(`${key} is required`)
  return value
}

function waitSeconds(args: Record<string, unknown>) {
  const value = args.timeout
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return DEFAULT_WAIT_SECONDS
  return Math.min(MAX_WAIT_SECONDS, value)
}

export function addMcpRoutes(
  router: Router,
  context: { ops: LocalAgentOps; machines: MachineManager }
) {
  const { ops, machines } = context
  const localLabel = hostname().replace(/\.local$/, "")

  /**
   * The machine of a call and the agent ID on it. `name` gives the ID that
   * other calls take: `workbox:s12` for an agent on another machine.
   */
  const target = (args: Record<string, unknown>, id?: string) => {
    const machine = stringArg(args, "machine")
    const prefixed = id ? /^([^:\s]+):(.+)$/.exec(id) : null
    const prefix = prefixed && prefixed[1] !== "pico" ? prefixed[1]! : undefined
    const wanted = machine ?? prefix
    const local =
      !wanted ||
      wanted === "local" ||
      wanted.toLowerCase() === localLabel.toLowerCase()
    const connection = local ? undefined : machines.find(wanted)
    if (!local && !connection) {
      if (machine)
        throw new ToolError(
          `Unknown machine: ${machine}. Use list_machines to see the machines.`
        )
    }
    const agentId =
      id === undefined
        ? undefined
        : normalizeAgentId(prefix && (connection || local) ? prefixed![2]! : id)
    if (!connection)
      return {
        backend: ops as AgentBackend,
        id: agentId,
        name: (value: string) => value,
      }
    if (!connection.online)
      throw new ToolError(
        `${connection.profile.label} is ${connection.state}. Try again when it is online.`
      )
    const label = connection.profile.label
    return {
      backend: new RouteAgentBackend((method, path, options) =>
        connection.request(method, path, {
          ...(options?.body !== undefined ? { body: options.body } : {}),
          ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        })
      ) as AgentBackend,
      id: agentId,
      name: (value: string) => `${label}:${value}`,
    }
  }

  /** Wait for a run, and say how it ended. */
  const waitText = async (
    backend: AgentBackend,
    name: string,
    id: string,
    request: string | undefined,
    seconds: number,
    signal: AbortSignal
  ) => {
    const result = await waitUntilSettled(backend, {
      id,
      timeoutMs: seconds * 1000,
      signal,
      ...(request ? { request } : {}),
    })
    return text(formatWaitResult(name, result, seconds), {
      id: name,
      state: result.state,
      title: result.title,
      ...(result.answer !== undefined ? { answer: result.answer } : {}),
    })
  }

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<ToolResult> => {
    switch (name) {
      case "list_machines": {
        const list = [
          { id: "local", label: localLabel, state: "online", hub: true },
          ...machines.list().map((machine) => ({
            id: machine.id,
            label: machine.label,
            state: machine.state,
            hub: false,
          })),
        ]
        return text(
          list
            .map(
              (machine) =>
                `${machine.label}\t${machine.state}${machine.hub ? "\t(this hub)" : ""}`
            )
            .join("\n"),
          { machines: list }
        )
      }
      case "list_agents": {
        const { backend, name: nameOf } = target(args)
        const project = stringArg(args, "project")
        const items = await backend.list(project ? { project } : {})
        return text(formatAgentList(items, nameOf), {
          agents: items.map((item) => ({ ...item, id: nameOf(item.id) })),
        })
      }
      case "start_agent": {
        const { backend, name: nameOf } = target(args)
        const worktree = args.worktree === true
        const branch = stringArg(args, "branch")
        const base = stringArg(args, "base")
        const optional = (key: string) => {
          const value = stringArg(args, key)
          return value ? { [key]: value } : {}
        }
        const started = await backend.spawn({
          goal: requiredArg(args, "goal"),
          requestId: randomUUID(),
          ...optional("cwd"),
          ...optional("name"),
          ...optional("model"),
          ...optional("thinking"),
          ...optional("profile"),
          ...(worktree
            ? {
                worktree:
                  branch || base
                    ? {
                        ...(branch ? { branch } : {}),
                        ...(base ? { base } : {}),
                      }
                    : true,
              }
            : {}),
        })
        const id = nameOf(started.agentId)
        if (args.wait === true)
          return waitText(
            backend,
            id,
            started.agentId,
            started.request,
            waitSeconds(args),
            signal
          )
        return text(
          `Started agent ${id} ${formatPlace(started)}. Use wait_for_agent or read_agent with id ${id}.`,
          { id, state: "working", title: started.title, cwd: started.cwd }
        )
      }
      case "send_message": {
        const {
          backend,
          id,
          name: nameOf,
        } = target(args, requiredArg(args, "id"))
        const sent = await backend.prompt({
          id: id!,
          message: requiredArg(args, "message"),
          requestId: randomUUID(),
          mode: args.steer === true ? "steer" : "followUp",
        })
        const name = nameOf(sent.agentId)
        if (args.wait === true)
          return waitText(
            backend,
            name,
            sent.agentId,
            sent.request,
            waitSeconds(args),
            signal
          )
        return text(
          `Sent to agent ${name}${sent.busy && args.steer !== true ? ". It gets the message after its current turn" : ""}. Use wait_for_agent with id ${name} for its answer.`,
          { id: name, title: sent.title }
        )
      }
      case "search_agents": {
        const { backend, name: nameOf } = target(args)
        const query = requiredArg(args, "query")
        const project = stringArg(args, "project")
        const limit = typeof args.limit === "number" ? args.limit : undefined
        const result = await backend.search({
          query,
          ...(project ? { project } : {}),
          ...(limit ? { limit } : {}),
        })
        return text(formatSearchResult(query, result, nameOf), {
          agents: result.agents.map((match) => ({
            ...match,
            agentId: nameOf(match.agentId),
            hits: match.hits.map((hit) => ({
              ...hit,
              snippet: plainSnippet(hit.snippet),
            })),
          })),
          ...(result.indexing ? { indexing: result.indexing } : {}),
        })
      }
      case "read_agent": {
        const {
          backend,
          id,
          name: nameOf,
        } = target(args, requiredArg(args, "id"))
        const last = typeof args.last === "number" ? args.last : undefined
        if (typeof args.entry === "number") {
          const result = await backend.around({
            entry: args.entry,
            ...(last ? { count: last } : {}),
          })
          return text(
            [
              `Agent ${nameOf(result.agentId)}: ${result.title}, around entry ${args.entry}`,
              "",
              aroundText(result.entries, args.entry) || "(no messages)",
            ].join("\n")
          )
        }
        const result = await backend.read({
          id: id!,
          ...(last ? { last } : {}),
          includeTools: args.include_tools === true,
        })
        const state = result.needsInput
          ? "waits for the user"
          : result.busy
            ? "working"
            : "idle"
        return text(
          [
            `Agent ${nameOf(result.agentId)}: ${result.title} (${state}), ${formatPlace(result)}`,
            ...(result.running ?? []).map((line) => `Now: ${line}`),
            "",
            result.text || "(no messages)",
          ].join("\n")
        )
      }
      case "wait_for_agent": {
        const {
          backend,
          id,
          name: nameOf,
        } = target(args, requiredArg(args, "id"))
        return waitText(
          backend,
          nameOf(id!),
          id!,
          undefined,
          waitSeconds(args),
          signal
        )
      }
      case "stop_agent": {
        const {
          backend,
          id,
          name: nameOf,
        } = target(args, requiredArg(args, "id"))
        const result = await backend.stop(id!)
        return text(`Stopped agent ${nameOf(result.agentId)}.`)
      }
      default:
        throw new RpcError(-32602, `Unknown tool: ${name}`)
    }
  }

  const handle = async (
    message: JsonRpcMessage,
    signal: AbortSignal
  ): Promise<Record<string, unknown> | undefined> => {
    const id = message.id
    // A notification (no ID) gets no answer.
    const isRequest = id !== undefined && id !== null
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string")
      return isRequest
        ? rpcError(id, -32600, "Not a JSON-RPC 2.0 request")
        : undefined
    if (!isRequest) return undefined
    const params =
      message.params && typeof message.params === "object"
        ? (message.params as Record<string, unknown>)
        : {}
    try {
      switch (message.method) {
        case "initialize": {
          const requested =
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : undefined
          return rpcResult(id, {
            protocolVersion:
              requested && PROTOCOL_VERSIONS.includes(requested)
                ? requested
                : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "pico", title: "Pico", version: VERSION },
            instructions: INSTRUCTIONS,
          })
        }
        case "ping":
          return rpcResult(id, {})
        case "tools/list":
          return rpcResult(id, { tools: TOOLS })
        case "tools/call": {
          const name = typeof params.name === "string" ? params.name : ""
          const args =
            params.arguments && typeof params.arguments === "object"
              ? (params.arguments as Record<string, unknown>)
              : {}
          try {
            return rpcResult(id, await callTool(name, args, signal))
          } catch (error) {
            if (error instanceof RpcError) throw error
            return rpcResult(id, {
              ...text(error instanceof Error ? error.message : String(error)),
              isError: true,
            })
          }
        }
        default:
          return rpcError(id, -32601, `Unknown method: ${message.method}`)
      }
    } catch (error) {
      if (error instanceof RpcError)
        return rpcError(id, error.code, error.message)
      return rpcError(
        id,
        -32603,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  router.post("/mcp", async (request, response) => {
    let body: unknown
    try {
      body = await request.body<unknown>()
    } catch (error) {
      sendJson(
        response,
        400,
        rpcError(
          null,
          -32700,
          error instanceof Error ? error.message : "Parse error"
        )
      )
      return HANDLED
    }
    // Stop waits when the client goes away before the answer.
    const closed = new AbortController()
    response.once("close", () => {
      if (!response.writableEnded) closed.abort()
    })
    const batch = Array.isArray(body)
    const messages = (batch ? body : [body]) as JsonRpcMessage[]
    const answers = (
      await Promise.all(
        messages.map((message) =>
          handle(
            message && typeof message === "object" ? message : {},
            closed.signal
          )
        )
      )
    ).filter((answer) => answer !== undefined)
    if (answers.length === 0) {
      response.writeHead(202)
      response.end()
      return HANDLED
    }
    sendJson(response, 200, batch ? answers : answers[0])
    return HANDLED
  })

  // No server event stream and no sessions.
  const refuse = (_request: unknown, response: ServerResponse) => {
    response.writeHead(405, { allow: "POST" })
    response.end()
    return HANDLED
  }
  router.get("/mcp", refuse)
  router.delete("/mcp", refuse)
}

class RpcError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string
) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}
