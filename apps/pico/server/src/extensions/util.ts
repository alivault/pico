/**
 * Helpers that Pico's own extensions share.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"

import type { Context, JsonValue } from "@earendil-works/chord"
import type {
  ConversationHandle,
  ConversationId,
  DocumentReader,
  ToolExecutionApi,
  ToolExecutionResult,
} from "@earendil-works/pi-durable"

import { actionRemoved, findProfile } from "../core/profiles.ts"
import { conversationOf, agentIdOf, type HostBridge } from "./host.ts"

/** A tool result with one text item. */
export function textResult(
  text: string,
  extra: Omit<ToolExecutionResult, "output"> = {}
): ToolExecutionResult {
  return { output: [{ type: "text", text }], ...extra }
}

export function errorResult(text: string, details?: JsonValue) {
  return textResult(text, {
    isError: true,
    ...(details !== undefined ? { details } : {}),
  })
}

const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"])

/**
 * A shell for commands that models write: the user's shell when it speaks
 * POSIX sh, otherwise bash (fish, nushell, and others do not).
 */
export function posixShell(preferred = process.env.SHELL) {
  const name = preferred?.split("/").pop() ?? ""
  if (preferred && POSIX_SHELLS.has(name)) return preferred
  for (const candidate of ["/bin/bash", "/usr/bin/bash", "/bin/sh"])
    if (existsSync(candidate)) return candidate
  return "/bin/sh"
}

/** The working directory of the calling conversation. */
export async function cwdOf(api: ToolExecutionApi, context: Context) {
  const agentState = await api.agent(context)
  return agentState.cwd ?? api.env?.cwd ?? homedir()
}

/** JSON-safe copy of a value, for documents and details. */
export function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export type CommandResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Output was cut at `maxBytes`. */
  truncated: boolean
}

/**
 * Run a program without a shell (an argv array) or with the user's shell (a
 * string). Output is kept up to `maxBytes` for each stream.
 */
export function runCommand(
  command: string | readonly string[],
  options: {
    cwd: string
    timeoutMs?: number
    signal?: AbortSignal
    env?: Record<string, string>
    input?: string
    maxBytes?: number
  }
): Promise<CommandResult> {
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024
  const [file, args] =
    typeof command === "string"
      ? [posixShell(), ["-c", command]]
      : [command[0]!, command.slice(1)]
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let truncated = false
    let timedOut = false
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const append = (current: string, chunk: Buffer) => {
      if (current.length >= maxBytes) {
        truncated = true
        return current
      }
      const next = current + chunk.toString("utf8")
      if (next.length > maxBytes) truncated = true
      return next.slice(0, maxBytes)
    }
    child.stdout.on("data", (chunk: Buffer) => (stdout = append(stdout, chunk)))
    child.stderr.on("data", (chunk: Buffer) => (stderr = append(stderr, chunk)))
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM")
    }
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          kill()
        }, options.timeoutMs)
      : undefined
    options.signal?.addEventListener("abort", kill, { once: true })
    child.on("error", (error) => {
      stderr += error.message
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener("abort", kill)
      resolve({ code, stdout, stderr, timedOut, truncated })
    })
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

/** Parse `90s`, `20m`, `1h30m`, `2d`, or a plain number of seconds. */
export function parseDuration(value: string | number): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value * 1000 : undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000
  let total = 0
  let matched = ""
  for (const match of trimmed.matchAll(
    /(\d+(?:\.\d+)?)\s*(ms|sec|min|hr|s|m|h|d|w)/g
  )) {
    total += Number(match[1]) * UNIT_MS[match[2]!]!
    matched += match[0]
  }
  return matched.replace(/\s+/g, "") === trimmed.replace(/\s+/g, "")
    ? total
    : undefined
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 48) return rest ? `${hours}h${rest}m` : `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** Text cut to `limit` characters, with a note of what was cut. */
export function clip(text: string, limit: number) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`
}

/** The last `lines` lines of text. */
export function tail(text: string, lines: number) {
  const all = text.split("\n")
  return all.length <= lines ? text : all.slice(-lines).join("\n")
}

/**
 * Send a background message (a job exit, a child's answer, a timer, a watch)
 * to the session that owns `conversationId`, or to the session that replaced
 * it through tree navigation. It is a steer: a busy agent gets it at its next
 * turn boundary, not only when its run ends. `requestId` makes a retry after a
 * restart find the same submission.
 */
export async function notifyAgent(
  host: HostBridge,
  open: (id: ConversationId) => Promise<ConversationHandle | undefined>,
  conversationId: ConversationId,
  text: string,
  requestId: string,
  context: Context
) {
  const services = await host.ready(context.abortSignal)
  const current =
    services.agents.current(agentIdOf(conversationId)) ??
    agentIdOf(conversationId)
  const target = await open(conversationOf(current))
  if (!target) return
  await target.submit(
    { type: "input", content: text, requestId, whenBusy: "steer" },
    context
  )
}

// -----------------------------------------------------------------------------
// Session state for the web client

/**
 * A part of a session's state that the web client shows in its Agent panel.
 * `kinds` are the documents it reads; a change to one of them tells clients
 * to read it again.
 */
export type StateProvider = {
  key: string
  kinds: readonly string[]
  read(
    reader: DocumentReader,
    conversationId: ConversationId,
    context: Context
  ): Promise<JsonValue | undefined>
}

const providers = new Map<string, StateProvider>()

export function registerState(provider: StateProvider) {
  providers.set(provider.key, provider)
}

export function stateProviders(): readonly StateProvider[] {
  return [...providers.values()]
}

export function stateKinds(): Set<string> {
  return new Set([...providers.values()].flatMap((provider) => provider.kinds))
}

/**
 * An error result when the calling session may not use `action` (for example
 * `browser.eval`): its profile or its limits remove it. Undefined when it may.
 */
export function deniedAction(
  host: HostBridge,
  conversationId: ConversationId,
  action: string
) {
  const services = host.current
  const id = agentIdOf(conversationId)
  if (!services?.agents.has(id)) return undefined
  const meta = services.agents.meta(id)
  const profile = findProfile(meta.profile, services.settings().profiles)
  const removed = actionRemoved(
    action,
    profile?.name === "full" ? undefined : profile,
    {
      ...(meta.parent ? { child: { parent: meta.parent } } : {}),
      ...(meta.limits ? { limits: meta.limits } : {}),
    }
  )
  return removed
    ? errorResult(
        `This session may not use ${action}: its profile or its limits remove it.${meta.parent ? " Ask your parent for it with a Question." : ""}`
      )
    : undefined
}
