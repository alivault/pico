/**
 * `pico-app agent …` and `pico-app mcp`: control the agents of a running
 * Pico from a shell or a script.
 *
 *   agent list [--project DIR] [--machine M] [--json]
 *   agent start [DIR] GOAL [--name N] [--model M] [--thinking L] [--profile P]
 *               [--worktree] [--branch B] [--base B] [--machine M]
 *               [--wait] [--timeout S] [--json]
 *   agent send ID MESSAGE [--steer] [--wait] [--timeout S] [--json]
 *   agent search QUERY [--project DIR] [--limit N] [--machine M] [--json]
 *   agent show ID [--last N] [--tools] [--entry E] [--json]
 *   agent wait ID [--timeout S] [--json]
 *   agent stop ID
 *   mcp      print the MCP URL and how to add it to Claude Code and Codex
 *
 * A GOAL or MESSAGE of `-` comes from stdin. The command finds the server in
 * `<data>/server.json`; `--url` (or `PICO_URL`) names another one, for
 * example a hub on the tailnet. An ID such as `workbox:s12`, or `--machine`,
 * names an agent on another machine of the hub.
 *
 * Exit codes of `--wait` and `wait`: 0 done, 1 failed or stopped (and
 * every error), 2 the agent waits for the user, 3 it still works when the
 * timeout passes.
 */
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { serverPaths } from "../config.ts"
import { LOCAL_MACHINE_ID } from "../machines/profiles.ts"
import {
  RouteAgentBackend,
  waitUntilSettled,
  type RunState,
} from "./agent-ops.ts"
import {
  aroundText,
  formatSearchResult,
  plainSnippet,
} from "../core/agent-search.ts"
import { formatAgentList, formatPlace, formatWaitResult } from "./format.ts"

const BOOLEAN_FLAGS = new Set([
  "wait",
  "json",
  "steer",
  "tools",
  "worktree",
  "help",
])

const USAGE = `Usage: pico-app agent <command> [options]

  list [--project DIR] [--machine M]       List agents, the most recently active first
  start [DIR] GOAL [options]               Start an agent in DIR (default: this directory)
      --name N  --model M  --thinking L  --profile P
      --worktree [--branch B] [--base B]   Work in a new git worktree
      --machine M                          Start it on another machine of the hub
  send ID MESSAGE [--steer]                Send a message (after the current turn,
                                           or at once with --steer)
  search QUERY [--project DIR]             Search the messages of all agents
  show ID [--last N] [--tools]             Show the last messages
      --entry E                            Show the messages around entry E of a
                                           search hit
  wait ID                                  Wait until the run is done
  stop ID                                  Stop the current turn

  start and send take --wait and --timeout S. GOAL or MESSAGE "-" reads stdin.
  --json prints JSON. --url URL (or PICO_URL) talks to another Pico server.

Exit codes with --wait and wait: 0 done, 1 failed, stopped, or an error,
2 the agent waits for the user, 3 it still works after --timeout.

Add Pico to an MCP client with: pico-app mcp`

export const EXIT_CODES: Record<RunState, number> = {
  done: 0,
  stopped: 1,
  failed: 1,
  needs_input: 2,
  working: 3,
  waiting: 3,
}

class UsageError extends Error {}

export function parseCommandArgs(argv: string[]) {
  const positional: string[] = []
  const options = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === "--") {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (!arg.startsWith("--") || arg.length === 2) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split("=", 2) as [
      string,
      string | undefined,
    ]
    if (inline !== undefined) options.set(key, inline)
    else if (BOOLEAN_FLAGS.has(key)) options.set(key, true)
    else {
      const value = argv[index + 1]
      if (value === undefined) throw new UsageError(`--${key} needs a value`)
      options.set(key, value)
      index += 1
    }
  }
  return { positional, options }
}

function readServerUrl(dataDir: string) {
  const fromEnv = process.env.PICO_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, "")
  let state: { host?: string; port?: number }
  try {
    state = JSON.parse(readFileSync(serverPaths(dataDir).stateFile, "utf8"))
  } catch {
    throw new Error(
      "Pico is not running. Start it with `pico-app serve --detach`."
    )
  }
  const host =
    !state.host || state.host === "0.0.0.0" || state.host === "::"
      ? "127.0.0.1"
      : state.host.includes(":")
        ? `[${state.host}]`
        : state.host
  return `http://${host}:${state.port}`
}

async function readStdin() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

/** A JSON request to the Pico server at `base`. */
function requester(base: string) {
  return async (
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<unknown> => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000)
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(options.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        signal: options.signal
          ? AbortSignal.any([timeout, options.signal])
          : timeout,
      })
    } catch (error) {
      const reason =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : error instanceof Error
            ? error.message
            : String(error)
      throw new Error(`Could not reach Pico at ${base}: ${reason}`)
    }
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
    }
    if (!response.ok || data.ok === false)
      throw new Error(data.error ?? `${path} failed with ${response.status}`)
    return data
  }
}

type MachineEntry = { id: string; label: string; state: string }

/**
 * The machine of a command and the agent ID on it, from `--machine` or an ID
 * such as `workbox:s12`.
 */
async function resolveTarget(
  request: ReturnType<typeof requester>,
  machine: string | undefined,
  id?: string
) {
  const prefixed = id ? /^([^:\s]+):(.+)$/.exec(id) : null
  const prefix = prefixed && prefixed[1] !== "pico" ? prefixed[1] : undefined
  const wanted = machine ?? prefix
  let found: MachineEntry | undefined
  if (wanted && wanted !== LOCAL_MACHINE_ID) {
    const list = (
      (await request("GET", "/api/machines")) as { machines: MachineEntry[] }
    ).machines
    const lower = wanted.toLowerCase()
    found = list.find(
      (entry) => entry.id === wanted || entry.label.toLowerCase() === lower
    )
    if (!found && machine)
      throw new UsageError(
        `Unknown machine: ${machine}. Machines: ${list.map((entry) => entry.label).join(", ")}.`
      )
  }
  const remote = found && found.id !== LOCAL_MACHINE_ID ? found : undefined
  const agentId =
    id === undefined ? undefined : found && prefix ? prefixed![2]! : id
  const prefixPath = remote ? `/m/${encodeURIComponent(remote.id)}` : ""
  return {
    backend: new RouteAgentBackend((method, path, options) =>
      request(method, `${prefixPath}${path}`, options)
    ),
    id: agentId,
    remote: Boolean(remote),
    name: (value: string) => (remote ? `${remote.label}:${value}` : value),
  }
}

function seconds(options: Map<string, string | true>, key: string) {
  const value = options.get(key)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0)
    throw new UsageError(`--${key} needs a number of seconds`)
  return number
}

function stringOption(options: Map<string, string | true>, key: string) {
  const value = options.get(key)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function print(json: boolean, value: unknown, text: string) {
  console.log(json ? JSON.stringify(value, null, 2) : text)
}

/** `pico-app agent …`. Returns the exit code. */
export async function agentCommand(
  argv: string[],
  dataDir: string
): Promise<number> {
  let parsed: ReturnType<typeof parseCommandArgs>
  try {
    parsed = parseCommandArgs(argv)
  } catch (error) {
    console.error((error as Error).message)
    return 1
  }
  const { positional, options } = parsed
  const [command, ...rest] = positional
  if (!command || command === "help" || options.has("help")) {
    console.log(USAGE)
    return command || options.has("help") ? 0 : 1
  }
  const json = options.get("json") === true
  try {
    const urlOption = stringOption(options, "url")
    const explicitUrl = Boolean(urlOption || process.env.PICO_URL?.trim())
    const request = requester(
      urlOption?.replace(/\/+$/, "") ?? readServerUrl(dataDir)
    )
    const machine = stringOption(options, "machine")
    const need = (value: string | undefined, what: string) => {
      if (!value) throw new UsageError(`${command} needs ${what}.\n\n${USAGE}`)
      return value
    }
    const text = async (value: string) =>
      value === "-" ? (await readStdin()).trim() : value

    /** Wait for a run, print how it ended, and give the exit code. */
    const finish = async (
      target: Awaited<ReturnType<typeof resolveTarget>>,
      id: string,
      runRequest: string | undefined
    ) => {
      const timeout = seconds(options, "timeout")
      const result = await waitUntilSettled(target.backend, {
        id,
        ...(runRequest ? { request: runRequest } : {}),
        ...(timeout ? { timeoutMs: timeout * 1000 } : {}),
      })
      const name = target.name(id)
      print(
        json,
        {
          id: name,
          state: result.state,
          title: result.title,
          ...(result.answer !== undefined ? { answer: result.answer } : {}),
        },
        result.state === "done"
          ? (result.answer ?? "")
          : formatWaitResult(name, result, timeout)
      )
      return EXIT_CODES[result.state]
    }

    switch (command) {
      case "list": {
        const target = await resolveTarget(request, machine)
        const project = stringOption(options, "project")
        const local = !target.remote && !explicitUrl
        const items = await target.backend.list(
          project ? { project: local ? resolve(project) : project } : {}
        )
        print(
          json,
          items.map((item) => ({ ...item, id: target.name(item.id) })),
          formatAgentList(items, target.name)
        )
        return 0
      }
      case "start": {
        if (rest.length > 2)
          throw new UsageError(`Too many arguments.\n\n${USAGE}`)
        const goal = await text(need(rest.at(-1), "a goal"))
        if (!goal) throw new UsageError("The goal is empty.")
        const target = await resolveTarget(request, machine)
        const dir = rest.length === 2 ? rest[0] : undefined
        // A directory on this computer means nothing to another server.
        const local = !target.remote && !explicitUrl
        const cwd = dir
          ? local
            ? resolve(dir)
            : dir
          : local
            ? process.cwd()
            : undefined
        const branch = stringOption(options, "branch")
        const base = stringOption(options, "base")
        const worktree =
          options.get("worktree") === true || branch || base
            ? branch || base
              ? { ...(branch ? { branch } : {}), ...(base ? { base } : {}) }
              : true
            : undefined
        const optional = (key: string) => {
          const value = stringOption(options, key)
          return value ? { [key]: value } : {}
        }
        const started = await target.backend.spawn({
          goal,
          requestId: randomUUID(),
          ...(cwd ? { cwd } : {}),
          ...optional("name"),
          ...optional("model"),
          ...optional("thinking"),
          ...optional("profile"),
          ...(worktree ? { worktree } : {}),
        })
        if (options.get("wait") === true)
          return finish(target, started.agentId, started.request)
        const name = target.name(started.agentId)
        print(
          json,
          {
            id: name,
            title: started.title,
            cwd: started.cwd,
            ...(started.worktree ? { worktree: started.worktree } : {}),
          },
          name
        )
        if (!json)
          console.error(`Started agent ${name} ${formatPlace(started)}.`)
        return 0
      }
      case "send": {
        const target = await resolveTarget(
          request,
          machine,
          need(rest[0], "an agent ID")
        )
        const message = await text(need(rest[1], "a message"))
        if (!message) throw new UsageError("The message is empty.")
        const sent = await target.backend.prompt({
          id: target.id!,
          message,
          requestId: randomUUID(),
          mode: options.get("steer") === true ? "steer" : "followUp",
        })
        if (options.get("wait") === true)
          return finish(target, sent.agentId, sent.request)
        const name = target.name(sent.agentId)
        print(json, { id: name, title: sent.title, busy: sent.busy }, name)
        return 0
      }
      case "show": {
        const target = await resolveTarget(
          request,
          machine,
          need(rest[0], "an agent ID")
        )
        const last = stringOption(options, "last")
        const entry = stringOption(options, "entry")
        if (entry) {
          const around = await target.backend.around({
            entry: Number(entry),
            ...(last ? { count: Number(last) || 6 } : {}),
          })
          print(
            json,
            { ...around, agentId: target.name(around.agentId) },
            [
              `Agent ${target.name(around.agentId)}: ${around.title}, around entry ${entry}`,
              "",
              aroundText(around.entries, Number(entry)) || "(no messages)",
            ].join("\n")
          )
          return 0
        }
        const result = await target.backend.read({
          id: target.id!,
          ...(last ? { last: Number(last) || 6 } : {}),
          includeTools: options.get("tools") === true,
        })
        const name = target.name(result.agentId)
        const state = result.needsInput
          ? "waits for the user"
          : result.busy
            ? "working"
            : "idle"
        print(
          json,
          { ...result, agentId: name },
          [
            `Agent ${name}: ${result.title} (${state}), ${formatPlace(result)}`,
            ...(result.running ?? []).map((line) => `Now: ${line}`),
            "",
            result.text || "(no messages)",
          ].join("\n")
        )
        return 0
      }
      case "search": {
        const query = rest.join(" ").trim()
        if (!query) throw new UsageError(`search needs a query.\n\n${USAGE}`)
        const target = await resolveTarget(request, machine)
        const project = stringOption(options, "project")
        const local = !target.remote && !explicitUrl
        const limit = Number(stringOption(options, "limit") ?? 0) || undefined
        const result = await target.backend.search({
          query,
          ...(project ? { project: local ? resolve(project) : project } : {}),
          ...(limit ? { limit } : {}),
        })
        print(
          json,
          {
            ...result,
            agents: result.agents.map((match) => ({
              ...match,
              agentId: target.name(match.agentId),
              hits: match.hits.map((hit) => ({
                ...hit,
                snippet: plainSnippet(hit.snippet),
              })),
            })),
          },
          formatSearchResult(query, result, target.name)
        )
        return 0
      }
      case "wait": {
        const target = await resolveTarget(
          request,
          machine,
          need(rest[0], "an agent ID")
        )
        return finish(target, target.id!, undefined)
      }
      case "stop": {
        const target = await resolveTarget(
          request,
          machine,
          need(rest[0], "an agent ID")
        )
        const result = await target.backend.stop(target.id!)
        print(
          json,
          { id: target.name(result.agentId), stopped: true },
          `Stopped agent ${target.name(result.agentId)}.`
        )
        return 0
      }
      default:
        throw new UsageError(`Unknown command: ${command}\n\n${USAGE}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** `pico-app mcp`: the MCP URL, and how to add it to MCP clients. */
export function mcpCommand(argv: string[], dataDir: string) {
  const { options } = parseCommandArgs(argv)
  let base: string
  try {
    base = stringOption(options, "url") ?? readServerUrl(dataDir)
  } catch (error) {
    console.error((error as Error).message)
    return 1
  }
  const url = `${base.replace(/\/+$/, "")}/mcp`
  if (options.get("json") === true) {
    console.log(JSON.stringify({ url }))
    return 0
  }
  console.log(`Pico's MCP server: ${url}

Claude Code:  claude mcp add --transport http pico ${url}
Codex:        codex mcp add pico --url ${url}
Other clients: add a remote MCP server (Streamable HTTP) with this URL.

The server has no sign-in, like the rest of Pico: anyone who can reach
this address can use it. Keep Pico on loopback or on your tailnet.`)
  return 0
}
