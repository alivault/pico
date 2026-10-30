/**
 * The `agents` extension: agents that start and talk to other agents.
 *
 * `spawn_subagent` makes a subagent: a normal Pico agent with a `parent`
 * link, which the user can open in the web client. It is ownerless, so it
 * outlives the call that made it. Without `wait`, a background
 * `pico.child-report` task waits for the subagent and puts its answer in the
 * parent's follow-up queue. The `agents` tool lists, reads, waits for, and
 * stops agents, and its `send` action sends a message to one.
 *
 * Messages from a subagent never steer: they go into the parent's follow-up
 * queue, in arrival order with the user's prompts. Each turn end of a
 * subagent is a question, done, or waiting (it ended on a job; see
 * `subagentMessageKind`). Waiting sends nothing: the agents list action
 * shows it. A subagent has limited tools (see `core/profiles.ts`): the
 * parent picks a profile and adds or removes tools. A subagent asks by
 * ending its turn with a message that starts with `Question:`.
 *
 * Restarts: the tools are replay-safe. A rerun finds the subagent by the call
 * ID stored in its metadata (written in the commit that creates it), and
 * prompts carry request IDs, so nothing is created or sent twice.
 *
 * Machines: on a hub, the tools take an optional `machine` (a label or an
 * ID), or an ID such as `workbox:s12`. They then call the remote server
 * through the hub's SSH connection. An offline machine fails at once. A
 * remote agent cannot call back to the hub.
 */
import { createHash } from "node:crypto"

import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  AgentDoc,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Harness,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable"

import { bashCalls, commandLine, formatDuration } from "../core/bash-calls.ts"
import { createWorktree } from "../services/worktree.ts"
import {
  conversationOf,
  agentIdOf,
  type HostBridge,
  type HostServices,
} from "./host.ts"
import { allProfiles, findProfile, nameList } from "../core/profiles.ts"
import { JobsDoc } from "./jobs.ts"
import { waitingLabel } from "./waiting.ts"
import { clip, deniedAction, errorResult, json, textResult } from "./util.ts"

/** An agent ID from `s123`, `123`, or `pico:s123`. */
export function normalizeAgentId(value: string) {
  const trimmed = value.trim().replace(/^pico:/, "")
  return /^\d+$/.test(trimmed) ? `s${trimmed}` : trimmed
}

function entryText(entry: EntryRecord) {
  const message = entry.model?.[0] as
    | { role?: string; content?: unknown }
    | undefined
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return ""
  return (
    message.content as Array<{ type?: string; text?: string; name?: string }>
  )
    .map((part) =>
      part.type === "text"
        ? (part.text ?? "")
        : part.type === "toolCall"
          ? `[tool call: ${part.name}]`
          : ""
    )
    .filter(Boolean)
    .join("\n")
}

export const STOPPED_ANSWER = "(stopped before it answered)"

/**
 * The answer of the newest turn of a conversation: assistant text after its
 * last user input, with the ID of its entry. A turn that was stopped or failed
 * before it answered says so, instead of returning the answer of an earlier
 * turn. With `at`, the answer of the turn that ends at that entry.
 */
export async function lastAnswerEntry(
  harness: Pick<Harness, "conversation">,
  conversationId: ConversationId,
  context: Context,
  at?: EntryId
): Promise<{ text: string; id?: EntryId } | undefined> {
  const conversation = await harness.conversation(conversationId, context)
  if (!conversation) return undefined
  const view = await conversation.context(
    context,
    at === undefined ? undefined : { at }
  )
  let stopped = false
  for (let index = view.entries.length - 1; index >= 0; index -= 1) {
    const entry = view.entries[index]!
    if (entry.kind === "pi.user") break
    const message = entry.model?.[0] as
      | { stopReason?: string; errorMessage?: string }
      | undefined
    if (entry.kind === "pi.tool-result" && /\baborted\b/.test(entryText(entry)))
      stopped = true
    if (entry.kind !== "pi.assistant") continue
    if (message?.stopReason === "aborted") stopped = true
    const text = entryText(entry)
      .split("\n")
      .filter((line) => !line.startsWith("[tool call:"))
      .join("\n")
      .trim()
    if (text) return { text, id: entry.id }
    if (message?.stopReason === "error")
      return {
        text: `(the turn failed: ${message.errorMessage ?? "unknown error"})`,
        id: entry.id,
      }
  }
  if (!stopped) return undefined
  const last = view.entries.at(-1)
  return { text: STOPPED_ANSWER, ...(last ? { id: last.id } : {}) }
}

/** The text of `lastAnswerEntry`. */
export async function lastAnswer(
  harness: Pick<Harness, "conversation">,
  conversationId: ConversationId,
  context: Context,
  at?: EntryId
) {
  return (await lastAnswerEntry(harness, conversationId, context, at))?.text
}

/**
 * The key of one answer of an agent: its entry ID, or a hash of its text
 * when the entry ID is not known (older remote machines).
 */
export function answerKey(answer: string, id?: EntryId | number | string) {
  return id !== undefined
    ? `e${String(id)}`
    : `h${createHash("sha1").update(answer).digest("hex").slice(0, 12)}`
}

/**
 * The answers that an agent has seen of other agents, by agent name:
 * reports, waits, and reads put the answer keys here. A report task does not
 * send an answer that is here, so an answer comes to an agent one time.
 */
export const DeliveredDoc = defineDoc<{ items: Record<string, string[]> }>({
  kind: "pico.delivered",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {} }),
})

const MAX_DELIVERED = 20

async function addDelivered(
  tx: Tx,
  watcher: ConversationId,
  marks: Array<{ agent: string; key: string }>
) {
  const draft = await tx.doc(DeliveredDoc, watcher)
  for (const { agent, key } of marks) {
    const keys = (draft.items[agent] ?? []).filter((item) => item !== key)
    keys.push(key)
    draft.items[agent] = keys.slice(-MAX_DELIVERED)
  }
}

/** Record that the calling agent saw `key`, an answer of `agent`. */
async function markDelivered(
  api: Pick<ToolExecutionApi, "commit" | "conversationId">,
  marks: Array<{ agent: string; key: string }>,
  context: Context
) {
  if (marks.length === 0) return
  await api.commit((tx) => addDelivered(tx, api.conversationId, marks), context)
}

/** The agent that a conversation ID names now, after tree navigation. */
function currentAgent(
  services: { agents: { current(id: string): string | undefined } },
  conversation: number
) {
  const id = agentIdOf(conversation as unknown as ConversationId)
  return services.agents.current(id) ?? id
}

async function wasDelivered(
  harness: Pick<Harness, "snapshot">,
  watcher: ConversationId,
  agent: string,
  key: string,
  context: Context
) {
  const state = await harness.snapshot(DeliveredDoc, watcher, context)
  return Boolean(state?.items[agent]?.includes(key))
}

/** The last messages of an agent as text, for the agents read action. */
export async function transcriptText(
  harness: Pick<Harness, "conversation">,
  conversationId: ConversationId,
  options: { last: number; includeTools: boolean },
  context: Context
) {
  const conversation = await harness.conversation(conversationId, context)
  if (!conversation) return undefined
  const view = await conversation.context(context)
  const parts: string[] = []
  for (const entry of view.entries) {
    if (entry.kind === "pi.user") parts.push(`## User\n${entryText(entry)}`)
    else if (entry.kind === "pi.assistant") {
      const text = entryText(entry)
      if (text) parts.push(`## Assistant\n${text}`)
    } else if (entry.kind === "pi.tool-result" && options.includeTools) {
      const message = entry.model?.[0] as { toolName?: string } | undefined
      parts.push(
        `## Tool result (${message?.toolName ?? "tool"})\n${clip(entryText(entry), 2000)}`
      )
    } else if (entry.kind === "pi.compaction") {
      parts.push(`## Summary of earlier work\n${entryText(entry)}`)
    }
  }
  return parts.slice(-Math.max(1, options.last)).join("\n\n")
}

async function waitIdle(
  services: HostServices,
  conversationId: ConversationId,
  context: Context
) {
  const conversation = await services.harness.conversation(
    conversationId,
    context
  )
  await conversation?.waitForIdle(context)
}

/** Wait with a time limit; true when it finished in time. */
async function within(promise: Promise<unknown>, ms: number | undefined) {
  if (!ms) {
    await promise
    return true
  }
  let timer: NodeJS.Timeout | undefined
  const done = await Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms)
    }),
  ])
  if (timer) clearTimeout(timer)
  return done
}

/** True when an answer asks something: a subagent ends its turn with `Question:`. */
export function isQuestion(answer: string, needsInput: boolean) {
  if (needsInput) return true
  const text = answer.trim()
  if (/^(?:[*_#>\s]*)question\b/i.test(text)) return true
  const lastLine = text.split("\n").at(-1)?.trim() ?? ""
  return /\?[*_)\s]*$/.test(lastLine)
}

/**
 * What the end of a subagent's turn means:
 * - `question`: it asks its parent (or waits in `ask_user`).
 * - `waiting`: its turn ended on a job, and it goes on when that job ends.
 *   The parent does not get a message for it.
 * - `done`: the work is finished, or it stopped.
 */
export type SubagentMessageKind = "question" | "done" | "waiting"

export function subagentMessageKind(
  answer: string,
  needsInput: boolean,
  waiting: string | undefined
): SubagentMessageKind {
  if (isQuestion(answer, needsInput)) return "question"
  return waiting ? "waiting" : "done"
}

/**
 * What an agent waits on when its turn ended: running jobs that report their
 * exit. Undefined when it waits on nothing.
 */
export async function waitingOn(
  harness: Pick<Harness, "snapshot">,
  conversationId: ConversationId,
  context: Context
) {
  return waitingLabel(await harness.snapshot(JobsDoc, conversationId, context))
}

/**
 * The text of a message from another agent for the follow-up queue,
 * marked as a question or as done.
 */
export function reportMessage(input: {
  /** `s12`, or `workbox:s12` for a remote agent. */
  name: string
  title: string
  answer: string
  needsInput: boolean
  subagent: boolean
}) {
  const who = `${input.subagent ? "Subagent" : "Agent"} ${input.name}`
  const question = isQuestion(input.answer, input.needsInput)
  const head = question
    ? `[${who}: question] ${input.title}`
    : `[${who}: done${input.answer === STOPPED_ANSWER ? ", stopped" : ""}] ${input.title}`
  return [
    head,
    clip(input.answer, 12_000),
    question
      ? input.needsInput
        ? `It waits for the user in its ask_user question. You can also answer with agents send (id ${input.name}).`
        : `Answer it with agents send (id ${input.name}). To give it a tool, use agents send with add.`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * The input of a report task. A task input is stored, so its field names are
 * stored names: do not change them (`child` is the subagent, or the agent
 * that got a message).
 */
type ReportInput = {
  /** The agent that gets the report, as a conversation ID. */
  parent: number
  child: string
  childTitle: string
  /**
   * Distinguishes reports of several messages to one agent. Reports of
   * tasks of older versions use it in their request ID.
   */
  key: string
  /**
   * The request ID of the message to the agent. The report gives the answer
   * to this message. Without it (tasks of older versions), the report gives
   * the agent's newest answer.
   */
  request?: string
}

/**
 * The answer of the agent to the message with request ID `request`.
 * Undefined when the message has no answer yet, for example when it was
 * withdrawn from the queue.
 */
async function answerTo(
  harness: Harness,
  agent: ConversationId,
  request: string,
  context: Context
) {
  const record = await harness.commit(
    (tx) => tx.submissionByRequest(agent, request),
    context
  )
  if (record?.type !== "input" || record.status !== "done") return undefined
  const answer = await lastAnswerEntry(harness, agent, context, record.answer)
  return answer
    ? { text: answer.text, id: answer.id ?? record.answer }
    : undefined
}

type ReportCheckpoint =
  | { phase: "wait" }
  | {
      phase: "report"
      answer: string
      /** The `answerKey` of the answer; absent in tasks of older versions. */
      answerKey?: string
    }

function createReportTask(host: HostBridge) {
  return defineTask<ReportInput, ReportCheckpoint, null>({
    // Stored name: do not change.
    name: "pico.child-report",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, runtime, context) => {
        const services = await host.ready(runtime.signal)
        const target = conversationOf(task.input.child)
        const handle = await runtime.conversation(target, context)
        let answer: string
        let key: string
        let first = true
        // A turn that ends on a job is `waiting`: wait
        // until the agent works again and ends with a question or done.
        for (;;) {
          if (handle) await handle.waitForIdle(context)
          // An agent can answer several queued messages before it is idle.
          // Each report gives the answer to its own message. Messages that
          // join one turn share its answer: the answer key lets only one
          // report of it through.
          const own =
            first && task.input.request
              ? await answerTo(
                  services.harness,
                  target,
                  task.input.request,
                  context
                )
              : undefined
          first = false
          const found =
            own ?? (await lastAnswerEntry(services.harness, target, context))
          answer = found?.text ?? "(no answer)"
          key = answerKey(answer, found?.id)
          const needsInput = Boolean(
            services.agents
              .list({})
              .find((agent) => agent.id === task.input.child)?.needsInput
          )
          const waiting = () => waitingOn(services.harness, target, context)
          if (
            !handle ||
            subagentMessageKind(answer, needsInput, await waiting()) !==
              "waiting"
          )
            break
          // Sleep at least one time in each pass. If the agent is busy but
          // the harness is idle, waitForIdle resolves at once, and without a
          // sleep this loop never yields to the event loop.
          do await sleep(WAITING_POLL_MS, runtime.signal)
          while (!services.agents.isBusy(task.input.child) && (await waiting()))
        }
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: { phase: "report", answer, answerKey: key },
          }),
          context
        )
      },
      report: async (task, runtime, context) => {
        const { input } = task
        const services = await host.ready(runtime.signal)
        const needsInput = Boolean(
          services.agents.list({}).find((agent) => agent.id === input.child)
            ?.needsInput
        )
        // Tree navigation can replace the parent after the spawn.
        const parent = currentAgent(services, input.parent)
        const parentConversation = conversationOf(parent)
        const { answerKey: key } = task.state.checkpoint
        const seen =
          key !== undefined &&
          (await wasDelivered(
            services.harness,
            parentConversation,
            input.child,
            key,
            context
          ))
        if (services.agents.has(parent) && !seen)
          await services.agents.followUp(
            parent,
            reportMessage({
              name: input.child,
              title: input.childTitle,
              answer: task.state.checkpoint.answer,
              needsInput,
              subagent:
                services.agents.has(input.child) &&
                services.agents.meta(input.child).parent === parent,
            }),
            `report:${input.child}:${key ?? input.key}`
          )
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: null },
          }),
          context
        )
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "aborted", reason: "cancelled" },
        }),
        context
      )
    },
  })
}

function parseModel(
  value: string | undefined
): { provider: string; modelId: string } | string | undefined {
  if (!value?.trim()) return undefined
  const trimmed = value.trim()
  const slash = trimmed.indexOf("/")
  return slash > 0
    ? { provider: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) }
    : trimmed
}

type RemoteConnection = NonNullable<
  ReturnType<NonNullable<HostServices["machines"]>["find"]>
>

type RemoteAgent = {
  agentId: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  /** What the agent waits on: a job. */
  waiting?: string
  worktree?: { path: string; branch: string }
  /** The tool calls that run now (see `runningToolLines`). */
  running?: string[]
}

/**
 * The tool calls that run now in an agent, one per line: the tool, how long
 * it has run, and for bash the command and how long it has had no output.
 */
export function runningToolLines(
  agents: Pick<HostServices["agents"], "runningTools">,
  id: string,
  now = Date.now()
) {
  const bash = bashCalls().filter((call) => call.agentId === id)
  return agents.runningTools(id).map((tool) => {
    // A bash call made through codemode has the ID `<call>/<key>`.
    const call = bash.find(
      (item) =>
        item.callId === tool.callId || item.callId.startsWith(`${tool.callId}/`)
    )
    const ran = `running ${tool.name} for ${formatDuration(now - tool.startedAt)}`
    if (!call) return ran
    const silent = now - call.lastOutputAt
    return `${ran}${tool.name === "bash" ? "" : " (bash)"}${silent >= 60_000 ? `, no output for ${formatDuration(silent)}` : ""}: ${commandLine(call.command, 120)}`
  })
}

/** How often a report task checks a waiting agent. */
const WAITING_POLL_MS = 3000

/** The state of an agent for the agents list action. */
function status(item: {
  busy: boolean
  needsInput: boolean
  unread?: boolean
  waiting?: string
}) {
  if (item.needsInput) return "waiting for the user"
  if (item.busy) return "working"
  if (item.waiting) return `waiting on ${item.waiting}`
  return item.unread ? "idle, unread" : "idle"
}

const MACHINE_PARAMETER = Type.Optional(
  Type.String({
    description:
      "Another machine of this Pico hub (label or ID). Without it, the tool works on this machine.",
  })
)

/**
 * The remote machine of a tool call: from `machine`, or from an ID such as
 * `workbox:s12`. Undefined means this machine. Throws for an unknown or
 * offline machine.
 */
export function remoteTarget(
  services: HostServices,
  machine: string | undefined,
  id?: string
): { connection: RemoteConnection; id?: string } | undefined {
  const prefixed = id ? /^([^:\s]+):(.+)$/.exec(id.trim()) : null
  const name =
    machine?.trim() ||
    (prefixed && prefixed[1] !== "pico" && services.machines?.find(prefixed[1]!)
      ? prefixed[1]
      : undefined)
  if (!name || name === "local") return undefined
  const connection = services.machines?.find(name)
  if (!connection) {
    const known = services.machines?.list().map((entry) => entry.label) ?? []
    throw new Error(
      `Unknown machine: ${name}.${known.length ? ` Machines: ${known.join(", ")}.` : " This Pico has no other machines."}`
    )
  }
  if (!connection.online)
    throw new Error(
      `${connection.profile.label} is ${connection.state}. Try again when it is online.`
    )
  const agentId =
    id === undefined
      ? undefined
      : normalizeAgentId(
          prefixed && !machine?.trim()
            ? prefixed[2]!
            : id.replace(/^[^:]+:/, "")
        )
  return { connection, ...(agentId ? { id: agentId } : {}) }
}

/** How agents and users write a remote agent: `workbox:s12`. */
function remoteName(connection: RemoteConnection, id: string) {
  return `${connection.profile.label}:${id}`
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error("Aborted"))
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}

/**
 * Wait until a remote agent is idle, with long polls. Undefined when the
 * deadline passes first. Network errors end the wait with an error.
 */
async function remoteWait(
  connection: RemoteConnection,
  id: string,
  deadline: number | undefined,
  signal?: AbortSignal
) {
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted")
    const left = deadline === undefined ? 25_000 : deadline - Date.now()
    if (left <= 0) return undefined
    const result = (await connection.request(
      "GET",
      `/api/machine/agent/wait?id=${encodeURIComponent(id)}&timeoutMs=${Math.min(25_000, left)}`,
      { timeoutMs: 45_000 }
    )) as RemoteAgent & { idle: boolean; answer?: string; answerId?: number }
    if (result.idle) return result
  }
}

/** Stored as a task input, like `ReportInput`: do not change the names. */
type RemoteReportInput = {
  parent: number
  machine: string
  child: string
  childTitle: string
  key: string
}

type RemoteReportCheckpoint =
  | { phase: "wait" }
  | {
      phase: "report"
      answer: string
      needsInput: boolean
      /** The `answerKey` of the answer; absent in tasks of older versions. */
      answerKey?: string
    }

/**
 * Post the answer of a remote agent to the caller when it is idle. It
 * waits through offline periods; the request ID lets only one message through.
 */
function createRemoteReportTask(host: HostBridge) {
  return defineTask<RemoteReportInput, RemoteReportCheckpoint, null>({
    // Stored name: do not change.
    name: "pico.remote-child-report",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, runtime, context) => {
        let answer: string | undefined
        let answerId: number | undefined
        let needsInput = false
        for (;;) {
          const services = await host.ready(runtime.signal)
          const connection = services.machines?.find(task.input.machine)
          if (!connection) {
            answer = "(the machine was removed from this hub)"
            break
          }
          try {
            if (!connection.online) throw new Error("offline")
            const result = await remoteWait(
              connection,
              task.input.child,
              undefined,
              runtime.signal
            )
            if (result) {
              answer = result.answer ?? "(no answer)"
              answerId = result.answerId
              needsInput = result.needsInput
              if (
                subagentMessageKind(answer, needsInput, result.waiting) !==
                "waiting"
              )
                break
              await sleep(WAITING_POLL_MS, runtime.signal)
              continue
            }
          } catch (error) {
            if (runtime.signal.aborted) throw error
            await sleep(15_000, runtime.signal)
          }
        }
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: {
              phase: "report",
              answer,
              needsInput,
              answerKey: answerKey(answer, answerId),
            },
          }),
          context
        )
      },
      report: async (task, runtime, context) => {
        const { input } = task
        const checkpoint = task.state.checkpoint
        const services = await host.ready(runtime.signal)
        const label =
          services.machines?.find(input.machine)?.profile.label ?? input.machine
        const name = `${label}:${input.child}`
        const parent = currentAgent(services, input.parent)
        const parentConversation = conversationOf(parent)
        const key = checkpoint.answerKey
        const seen =
          key !== undefined &&
          (await wasDelivered(
            services.harness,
            parentConversation,
            `${input.machine}:${input.child}`,
            key,
            context
          ))
        if (services.agents.has(parent) && !seen)
          await services.agents.followUp(
            parent,
            reportMessage({
              name,
              title: input.childTitle,
              answer: checkpoint.answer,
              needsInput: checkpoint.needsInput,
              subagent: false,
            }),
            `report:${input.machine}:${input.child}:${key ?? input.key}`
          )
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: null },
          }),
          context
        )
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "aborted", reason: "cancelled" },
        }),
        context
      )
    },
  })
}

export function createAgentsExtension(host: HostBridge) {
  const ReportTask = createReportTask(host)
  const RemoteReportTask = createRemoteReportTask(host)

  /** Like `scheduleReport`, for an agent on another machine. */
  const scheduleRemoteReport = async (
    api: ToolExecutionApi,
    input: RemoteReportInput,
    context: Context
  ) => {
    if (await api.memo<boolean>("report", context)) return
    await api.commit(async (tx) => {
      await tx.createTask(RemoteReportTask, input, {
        ownership: { kind: "conversation" },
        conversationId: api.conversationId,
        background: true,
      })
    }, context)
    await api.memo("report", true, context)
  }

  /** A request ID that is the same when a tool call runs again. */
  const callRequestId = (api: ToolExecutionApi) =>
    `${String(api.conversationId)}:${api.callId}`

  /** The tool's remote target, or an error result. */
  const resolveRemote = (
    services: HostServices,
    machine: string | undefined,
    id?: string
  ) => {
    try {
      return { target: remoteTarget(services, machine, id) }
    } catch (error) {
      return {
        error: errorResult(
          error instanceof Error ? error.message : String(error)
        ),
      }
    }
  }

  const requireAgent = (services: HostServices, value: string) => {
    const id = services.agents.current(normalizeAgentId(value))
    if (!id || !services.agents.has(id))
      throw new Error(`Unknown agent: ${value}`)
    return id
  }

  /**
   * Post the answer of `input.child` back to the caller when it is idle. A
   * second report task after a crash is harmless: the message's request ID
   * lets only one message through.
   */
  const scheduleReport = async (
    api: ToolExecutionApi,
    input: ReportInput,
    context: Context
  ) => {
    if (await api.memo<boolean>("report", context)) return
    await api.commit(async (tx) => {
      await tx.createTask(ReportTask, input, {
        ownership: { kind: "conversation" },
        conversationId: api.conversationId,
        background: true,
      })
    }, context)
    await api.memo("report", true, context)
  }

  const spawnTool = defineTool({
    name: "spawn_subagent",
    executionMode: "sequential",
    description: [
      "Start a subagent: a full agent with its own context that works on `goal`. The user can open it in the sidebar.",
      "Use it to split independent work or to get a fresh review. It works in the background: its messages (done or a question) come in your follow-up queue after your current turn, so keep working. A subagent that waits on a job sends no message until it is done or asks. Set wait to get the answer as the result.",
      "Without worktree, the subagent works in the same directory as you and can edit the same files. Set worktree: true for parallel edits; the subagent gets its own git branch and worktree.",
      "Tools: profile picks a set (builder, researcher, reviewer, read-only, or full; default full). A subagent has no ask_user or spawn_subagent unless you put them in add. remove takes more tools away. Bash in a subagent refuses git push to main, sudo, and the commands in deny_commands.",
      "Write the goal as a complete brief: the subagent does not see this conversation.",
    ].join(" "),
    parameters: Type.Object({
      goal: Type.String(),
      name: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
      model: Type.Optional(
        Type.String({ description: "provider/modelId, or a model id" })
      ),
      thinking: Type.Optional(Type.String()),
      profile: Type.Optional(
        Type.String({
          description:
            "Tools profile: builder, researcher, reviewer, read-only, full (default), or a profile of the user",
        })
      ),
      add: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Tools to give the subagent, also ask_user or spawn_subagent",
        })
      ),
      remove: Type.Optional(
        Type.Array(Type.String(), { description: "Tools to take away" })
      ),
      deny_commands: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Commands that the subagent's bash refuses, by their first words, for example `npm publish` or `git reset --hard`",
        })
      ),
      worktree: Type.Optional(
        Type.Union([
          Type.Boolean(),
          Type.Object({
            branch: Type.Optional(Type.String()),
            base: Type.Optional(Type.String()),
          }),
        ])
      ),
      wait: Type.Optional(Type.Boolean()),
      timeout: Type.Optional(
        Type.Number({
          description: "With wait: give up after this many seconds",
        })
      ),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const parent = agentIdOf(api.conversationId)
      if (!services.agents.has(parent))
        return errorResult("spawn_subagent works only in a Pico agent")
      const remote = resolveRemote(services, args.machine)
      if (remote.error) return remote.error
      if (remote.target) {
        if (args.worktree)
          return errorResult(
            "worktree is not available for an agent on another machine."
          )
        const { connection } = remote.target
        let created: RemoteAgent
        try {
          created = (await connection.request(
            "POST",
            "/api/machine/agent/spawn",
            {
              body: {
                goal: args.goal,
                ...(args.name ? { name: args.name } : {}),
                ...(args.cwd ? { cwd: args.cwd } : {}),
                ...(args.model ? { model: args.model } : {}),
                ...(args.thinking ? { thinking: args.thinking } : {}),
                ...(args.profile ? { profile: args.profile } : {}),
                requestId: callRequestId(api),
              },
            }
          )) as RemoteAgent
        } catch (error) {
          return errorResult(
            `Could not start the agent on ${connection.profile.label}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        const name = remoteName(connection, created.agentId)
        const title = args.name ?? created.title ?? args.goal.slice(0, 60)
        const details = {
          agentId: created.agentId,
          machine: connection.profile.id,
          machineLabel: connection.profile.label,
          title,
        }
        if (!args.wait) {
          await scheduleRemoteReport(
            api,
            {
              parent: Number(api.conversationId),
              machine: connection.profile.id,
              child: created.agentId,
              childTitle: title,
              key: `spawn-${api.callId}`,
            },
            context
          )
          return textResult(
            `Started agent ${name} in ${created.cwd} on ${connection.profile.label}. Its answer comes to you as a message when it finishes. Use agents (read, wait, stop, send) with id ${name}.`,
            { details: json({ ...details, status: "running" }) }
          )
        }
        try {
          const done = await remoteWait(
            connection,
            created.agentId,
            args.timeout ? Date.now() + args.timeout * 1000 : undefined,
            context.abortSignal
          )
          if (done)
            await markDelivered(
              api,
              [
                {
                  agent: `${connection.profile.id}:${created.agentId}`,
                  key: answerKey(done.answer ?? "", done.answerId),
                },
              ],
              context
            )
          return textResult(
            done
              ? `Agent ${name} (in ${created.cwd}) finished.\nIts answer:\n${clip(done.answer ?? "(no answer)", 20_000)}`
              : `Agent ${name} still works after ${args.timeout}s. Check it later with agents read or wait.`,
            {
              details: json({
                ...details,
                status: done ? "done" : "running",
              }),
            }
          )
        } catch (error) {
          return errorResult(
            `Agent ${name} started, but the wait failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      const parentMeta = services.agents.meta(parent)
      const settings = services.settings()
      let subagent = services.agents
        .list({ parent })
        .find(
          (agent) => services.agents.meta(agent.id).spawnedByCall === api.callId
        )?.id
      if (!subagent) {
        if (args.profile && !findProfile(args.profile, settings.profiles))
          return errorResult(
            `Unknown profile: ${args.profile}. Profiles: ${allProfiles(
              settings.profiles
            )
              .map((profile) => profile.name)
              .join(", ")}.`
          )
        if ((parentMeta.depth ?? 0) >= settings.maxSubagentDepth)
          return errorResult(
            `Subagents may nest only ${settings.maxSubagentDepth} levels deep.`
          )
        const live = services.agents
          .list({ parent })
          .filter((agent) => agent.busy).length
        if (live >= settings.maxSubagents)
          return errorResult(
            `This agent already has ${live} running subagents. Wait for one or stop one.`
          )
        const agentState = await api.snapshot(
          AgentDoc,
          api.conversationId,
          context
        )
        const requested = parseModel(args.model)
        let model = agentState?.model as
          | { provider: string; modelId: string }
          | undefined
        if (typeof requested === "object") model = requested
        else if (typeof requested === "string") {
          const match = services.agents
            .availableModels()
            .find((candidate) => candidate.id === requested)
          if (!match?.provider)
            return errorResult(`Unknown model: ${requested}`)
          model = { provider: match.provider, modelId: match.id }
        }
        let cwd = args.cwd?.trim() || parentMeta.cwd
        let group: string | undefined = parentMeta.group ?? parentMeta.cwd
        let worktree:
          | { repoRoot: string; path: string; branch: string }
          | undefined
        if (args.worktree) {
          const options = typeof args.worktree === "object" ? args.worktree : {}
          try {
            const created = await createWorktree(cwd, {
              dataDir: services.dataDir,
              copy: settings.worktreeCopy,
              name: args.name ?? args.goal.slice(0, 40),
              ...(options.branch ? { branch: options.branch } : {}),
              ...(options.base ? { base: options.base } : {}),
            })
            worktree = {
              repoRoot: created.repoRoot,
              path: created.path,
              branch: created.branch,
            }
            cwd = created.cwd
          } catch (error) {
            return errorResult(
              `Could not create the worktree: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        } else if (args.cwd) {
          group = undefined
        }
        subagent = await services.agents.create(cwd, {
          parent,
          spawnedByCall: api.callId,
          ...(model ? { model } : {}),
          ...(args.thinking ? { thinkingLevel: args.thinking } : {}),
          ...(args.profile
            ? {
                profile:
                  findProfile(args.profile, settings.profiles)?.name ??
                  args.profile,
              }
            : {}),
          limits: {
            ...(nameList(args.add) ? { add: nameList(args.add) } : {}),
            ...(nameList(args.remove) ? { remove: nameList(args.remove) } : {}),
            ...(nameList(args.deny_commands)
              ? { denyCommands: nameList(args.deny_commands) }
              : {}),
          },
          ...(args.name ? { name: args.name } : {}),
          ...(group ? { group } : {}),
          ...(worktree ? { worktree } : {}),
        })
      }
      await api.details(
        { agentId: subagent, status: "running", wait: Boolean(args.wait) },
        context
      )
      await services.agents.prompt(subagent, {
        message: args.goal,
        images: [],
        requestId: `spawn:${api.callId}`,
      })
      const meta = services.agents.meta(subagent)
      const title = args.name ?? meta.name ?? args.goal.slice(0, 60)
      const where = meta.worktree
        ? `in worktree ${meta.worktree.path} (branch ${meta.worktree.branch})`
        : `in ${meta.cwd}`
      if (!args.wait) {
        await scheduleReport(
          api,
          {
            parent: Number(api.conversationId),
            child: subagent,
            childTitle: title,
            key: `spawn-${api.callId}`,
            request: `spawn:${api.callId}`,
          },
          context
        )
        return textResult(
          `Started subagent ${subagent} ${where}. Its answer comes to you as a message when it finishes. Use agents (read, wait, stop, send) with id ${subagent}.`,
          {
            details: json({
              agentId: subagent,
              title,
              status: "running",
              ...(meta.worktree ? { worktree: meta.worktree } : {}),
            }),
          }
        )
      }
      const finished = await within(
        waitIdle(services, conversationOf(subagent), context),
        args.timeout ? args.timeout * 1000 : undefined
      )
      const found = await lastAnswerEntry(
        services.harness,
        conversationOf(subagent),
        context
      )
      if (finished && found)
        await markDelivered(
          api,
          [{ agent: subagent, key: answerKey(found.text, found.id) }],
          context
        )
      const answer = found?.text
      return textResult(
        finished
          ? `Subagent ${subagent} (${where}) finished.\nIts answer:\n${clip(answer ?? "(no answer)", 20_000)}`
          : `Subagent ${subagent} still works after ${args.timeout}s. Check it later with agents read or wait.`,
        {
          details: json({
            agentId: subagent,
            title,
            status: finished ? "done" : "running",
            ...(meta.worktree ? { worktree: meta.worktree } : {}),
          }),
        }
      )
    },
  })

  type AgentsArgs = {
    action: string
    id?: string | undefined
    ids?: string[] | undefined
    scope?: string | undefined
    last?: number | undefined
    include_tools?: boolean | undefined
    timeout?: number | undefined
    any?: boolean | undefined
    message?: string | undefined
    mode?: "followUp" | "steer" | undefined
    wait?: boolean | undefined
    add?: string[] | undefined
    remove?: string[] | undefined
    machine?: string | undefined
  }

  /** The send action: a message to another agent. */
  const sendMessage = async (
    args: AgentsArgs,
    api: ToolExecutionApi,
    context: Context
  ) => {
    const services = await host.ready(context.abortSignal)
    if (!args.id || args.message === undefined)
      return errorResult("send needs id and message.")
    const message = args.message
    const remote = resolveRemote(services, args.machine, args.id)
    if ((args.add?.length || args.remove?.length) && remote.target)
      return errorResult(
        "add and remove work only for a subagent on this machine."
      )
    if (remote.error) return remote.error
    if (remote.target?.id) {
      const { connection, id } = remote.target
      const name = remoteName(connection, id)
      const from = agentIdOf(api.conversationId)
      let sent: RemoteAgent
      try {
        sent = (await connection.request("POST", "/api/machine/agent/prompt", {
          body: {
            id,
            message: `[Message from agent ${from} on the hub] ${message}`,
            mode: args.mode ?? "followUp",
            requestId: callRequestId(api),
          },
        })) as RemoteAgent
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      if (!args.wait) {
        await scheduleRemoteReport(
          api,
          {
            parent: Number(api.conversationId),
            machine: connection.profile.id,
            child: id,
            childTitle: sent.title,
            key: `send-${api.callId}`,
          },
          context
        )
        return textResult(
          `Sent to agent ${name}. Its answer comes to you as a message.`,
          {
            details: {
              agentId: id,
              machine: connection.profile.id,
              title: sent.title,
            },
          }
        )
      }
      try {
        const done = await remoteWait(
          connection,
          id,
          args.timeout ? Date.now() + args.timeout * 1000 : undefined,
          context.abortSignal
        )
        if (done)
          await markDelivered(
            api,
            [
              {
                agent: `${connection.profile.id}:${id}`,
                key: answerKey(done.answer ?? "", done.answerId),
              },
            ],
            context
          )
        return textResult(
          done
            ? `Agent ${name} answered:\n${clip(done.answer ?? "(no answer)", 20_000)}`
            : `Agent ${name} still works after ${args.timeout}s.`,
          {
            details: {
              agentId: id,
              machine: connection.profile.id,
              title: sent.title,
            },
          }
        )
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    let target: string
    try {
      target = requireAgent(services, args.id)
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
    if (target === agentIdOf(api.conversationId))
      return errorResult("An agent cannot send a message to itself.")
    const from = agentIdOf(api.conversationId)
    const toParent =
      services.agents.has(from) && services.agents.meta(from).parent === target
    let granted = ""
    if (args.add?.length || args.remove?.length) {
      if (services.agents.meta(target).parent !== from)
        return errorResult("add and remove work only for your own subagents.")
      await services.agents.changeLimits(target, {
        ...(nameList(args.add) ? { add: nameList(args.add) } : {}),
        ...(nameList(args.remove) ? { remove: nameList(args.remove) } : {}),
      })
      granted = [
        args.add?.length ? `You now have: ${args.add.join(", ")}.` : "",
        args.remove?.length
          ? `You no longer have: ${args.remove.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    }
    if (toParent) {
      // A message to the parent is a note: the parent answers with
      // agents send when it wants to, so no report comes back.
      await services.agents.followUp(
        target,
        reportMessage({
          name: from,
          title: services.agents.meta(from).name ?? from,
          answer: message,
          needsInput: false,
          subagent: true,
        }),
        `send:${api.callId}`
      )
      return textResult(
        `Sent to your parent agent ${target}. It gets the message in its follow-up queue. Keep working: its answer, if any, comes as a message.`,
        { details: { agentId: target } }
      )
    } else {
      await services.agents.prompt(target, {
        message: `[Message from agent ${from}] ${granted ? `${granted} ` : ""}${message}`,
        images: [],
        streamingBehavior: args.mode ?? "followUp",
        requestId: `send:${api.callId}`,
      })
    }
    const title =
      services.agents.list({}).find((item) => item.id === target)?.title ??
      target
    if (!args.wait) {
      await scheduleReport(
        api,
        {
          parent: Number(api.conversationId),
          child: target,
          childTitle: title,
          key: `send-${api.callId}`,
          request: `send:${api.callId}`,
        },
        context
      )
      return textResult(
        `Sent to agent ${target}. Its answer comes to you as a message.`,
        { details: { agentId: target, title } }
      )
    }
    const finished = await within(
      waitIdle(services, conversationOf(target), context),
      args.timeout ? args.timeout * 1000 : undefined
    )
    const found = await lastAnswerEntry(
      services.harness,
      conversationOf(target),
      context
    )
    if (finished && found)
      await markDelivered(
        api,
        [{ agent: target, key: answerKey(found.text, found.id) }],
        context
      )
    const answer = found?.text
    return textResult(
      finished
        ? `Agent ${target} answered:\n${clip(answer ?? "(no answer)", 20_000)}`
        : `Agent ${target} still works after ${args.timeout}s.`,
      { details: { agentId: target, title } }
    )
  }

  const readAgent = async (
    args: AgentsArgs,
    api: ToolExecutionApi,
    context: Context
  ) => {
    const services = await host.ready(context.abortSignal)
    const value = args.id ?? args.ids?.[0]
    if (!value) return errorResult("read needs id.")
    const last = Math.min(50, Math.max(1, args.last ?? 6))
    const remote = resolveRemote(services, args.machine, value)
    if (remote.error) return remote.error
    if (remote.target?.id) {
      const { connection, id } = remote.target
      try {
        const result = (await connection.request(
          "GET",
          `/api/machine/agent/read?id=${encodeURIComponent(id)}&last=${last}${args.include_tools ? "&includeTools=1" : ""}`
        )) as RemoteAgent & { text: string }
        return textResult(
          [
            `Agent ${remoteName(connection, id)}: ${result.title} (${result.busy ? "working" : "idle"}${result.needsInput ? ", waiting for the user" : ""})`,
            `Machine: ${connection.profile.label}. Directory: ${result.cwd}${result.worktree ? ` (worktree, branch ${result.worktree.branch})` : ""}`,
            ...(result.running ?? []).map((line) => `Now: ${line}`),
            "",
            clip(result.text || "(no messages)", 40_000),
          ].join("\n")
        )
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    let target: string
    try {
      target = requireAgent(services, value)
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
    const summary = services.agents.list({}).find((item) => item.id === target)
    const text = await transcriptText(
      services.harness,
      conversationOf(target),
      { last, includeTools: Boolean(args.include_tools) },
      context
    )
    // An idle agent's transcript ends with its answer: the caller has
    // seen it, so no report sends it again.
    if (summary && !summary.busy) {
      const found = await lastAnswerEntry(
        services.harness,
        conversationOf(target),
        context
      )
      if (found)
        await markDelivered(
          api,
          [{ agent: target, key: answerKey(found.text, found.id) }],
          context
        )
    }
    const meta = services.agents.meta(target)
    const running = runningToolLines(services.agents, target)
    return textResult(
      [
        `Agent ${target}: ${summary?.title ?? ""} (${summary?.busy ? "working" : "idle"}${summary?.needsInput ? ", waiting for the user" : ""})`,
        `Directory: ${meta.cwd}${meta.worktree ? ` (worktree, branch ${meta.worktree.branch})` : ""}`,
        ...running.map((line) => `Now: ${line}`),
        "",
        clip(text || "(no messages)", 40_000),
      ].join("\n")
    )
  }

  const listAgents = async (
    args: AgentsArgs,
    api: ToolExecutionApi,
    context: Context
  ) => {
    const services = await host.ready(context.abortSignal)
    const remote = resolveRemote(services, args.machine)
    if (remote.error) return remote.error
    if (remote.target) {
      const { connection } = remote.target
      try {
        if (args.scope === "archived") {
          const archived = (await connection.request(
            "GET",
            "/api/machine/agents/archived"
          )) as {
            agents: Array<{ id: string; title: string; cwd: string }>
          }
          if (archived.agents.length === 0)
            return textResult(
              `No archived agents on ${connection.profile.label}.`
            )
          return textResult(
            archived.agents
              .map(
                (item) =>
                  `${remoteName(connection, item.id)} — ${item.title} [archived]\n  ${item.cwd}`
              )
              .join("\n")
          )
        }
        const result = (await connection.request(
          "GET",
          "/api/machine/agents"
        )) as {
          agents: Array<{
            id: string
            title: string
            cwd: string
            busy: boolean
            needsInput: boolean
            unread?: boolean
            lastMessagePreview?: string
            waiting?: string
            running?: string[]
          }>
        }
        if (result.agents.length === 0)
          return textResult(`No agents on ${connection.profile.label}.`)
        return textResult(
          result.agents
            .map(
              (item) =>
                `${remoteName(connection, item.id)} — ${item.title} [${status(item)}]\n  ${item.cwd}${(item.running ?? []).map((line) => `\n  now: ${line}`).join("")}${item.lastMessagePreview ? `\n  last: ${item.lastMessagePreview}` : ""}`
            )
            .join("\n")
        )
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    const self = agentIdOf(api.conversationId)
    const scope = args.scope ?? "subagents"
    if (scope === "archived") {
      const archived = services.agents.archivedAgents().slice(0, 50)
      if (archived.length === 0) return textResult("No archived agents.")
      return textResult(
        archived
          .map(
            (item) =>
              `${item.id} — ${item.title} [archived${item.archivedAt ? ` ${item.archivedAt}` : ""}]\n  ${item.cwd}`
          )
          .join("\n")
      )
    }
    const meta = services.agents.has(self)
      ? services.agents.meta(self)
      : undefined
    const items = services.agents
      .list(
        scope === "subagents"
          ? { parent: self }
          : scope === "project" && meta
            ? { project: meta.group ?? meta.cwd }
            : {}
      )
      .slice(0, 50)
    if (items.length === 0) return textResult(`No agents (${scope}).`)
    const withWaiting = await Promise.all(
      items.map(async (item) => {
        if (item.busy || item.needsInput) return item
        const waiting = await waitingOn(
          services.harness,
          conversationOf(item.id),
          context
        )
        return waiting ? { ...item, waiting } : item
      })
    )
    return textResult(
      withWaiting
        .map(
          (item) =>
            `${item.id}${item.id === self ? " (you)" : ""} — ${item.title} [${status(item)}]${item.parent ? ` subagent of ${item.parent}` : ""}${item.worktreeBranch ? ` branch ${item.worktreeBranch}` : ""}\n  ${item.cwd}${
              item.id === self
                ? ""
                : runningToolLines(services.agents, item.id)
                    .map((line) => `\n  now: ${line}`)
                    .join("")
            }${item.lastMessagePreview ? `\n  last: ${item.lastMessagePreview}` : ""}`
        )
        .join("\n")
    )
  }

  /** One agent that `wait` looks at, on this machine or a remote one. */
  type WaitTarget =
    | { kind: "local"; id: string }
    | { kind: "remote"; connection: RemoteConnection; id: string }

  type WaitState = {
    name: string
    /** The delivered-list name of the agent. */
    agent: string
    state: "working" | "idle" | "waiting" | "unknown"
    waiting?: string
    answer?: string
    key?: string
    error?: string
  }

  /** The state of an agent now, without waiting. */
  const waitState = async (
    services: HostServices,
    target: WaitTarget,
    context: Context
  ): Promise<WaitState> => {
    if (target.kind === "remote") {
      const name = remoteName(target.connection, target.id)
      const agent = `${target.connection.profile.id}:${target.id}`
      try {
        const result = await remoteWait(
          target.connection,
          target.id,
          Date.now() + 1,
          context.abortSignal
        )
        if (!result) return { name, agent, state: "working" }
        const answer = result.answer ?? "(no answer)"
        return {
          name,
          agent,
          state: result.waiting ? "waiting" : "idle",
          ...(result.waiting ? { waiting: result.waiting } : {}),
          answer,
          key: answerKey(answer, result.answerId),
        }
      } catch (error) {
        return {
          name,
          agent,
          state: "unknown",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    const { id } = target
    if (services.agents.isBusy(id))
      return { name: id, agent: id, state: "working" }
    const waiting = await waitingOn(
      services.harness,
      conversationOf(id),
      context
    )
    const found = await lastAnswerEntry(
      services.harness,
      conversationOf(id),
      context
    )
    const answer = found?.text ?? "(no answer)"
    return {
      name: id,
      agent: id,
      state: waiting ? "waiting" : "idle",
      ...(waiting ? { waiting } : {}),
      answer,
      key: answerKey(answer, found?.id),
    }
  }

  const waitAgents = async (
    args: AgentsArgs,
    api: ToolExecutionApi,
    context: Context
  ) => {
    const services = await host.ready(context.abortSignal)
    const values = args.ids ?? (args.id ? [args.id] : [])
    if (values.length === 0) return errorResult("wait needs ids.")
    const targets: WaitTarget[] = []
    try {
      for (const value of values) {
        const remote = remoteTarget(services, args.machine, value)
        if (remote?.id)
          targets.push({
            kind: "remote",
            connection: remote.connection,
            id: remote.id,
          })
        else targets.push({ kind: "local", id: requireAgent(services, value) })
      }
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
    const deadline = args.timeout ? Date.now() + args.timeout * 1000 : undefined
    const delivered =
      (await api.snapshot(DeliveredDoc, api.conversationId, context))?.items ??
      {}
    // How the caller knows each answer: shown by a tool before, sent as a
    // report (still in its queue, or read), or not at all.
    const seen = new Map<string, "shown" | "queued" | "read" | "new">()
    const known = async (state: WaitState) => {
      if (state.state !== "idle" || state.key === undefined) return "none"
      const id = `${state.agent}:${state.key}`
      const cached = seen.get(id)
      if (cached && cached !== "new") return cached
      let result: "shown" | "queued" | "read" | "new"
      if (delivered[state.agent]?.includes(state.key)) result = "shown"
      else {
        const report = await services.harness.commit(
          (tx) =>
            tx.submissionByRequest(
              api.conversationId,
              `report:${state.agent}:${state.key}`
            ),
          context
        )
        result = !report
          ? "new"
          : report.status === "queued"
            ? "queued"
            : "read"
      }
      seen.set(id, result)
      return result
    }
    // `any` waits for an answer that the caller has not seen yet; `all`
    // waits until no agent works.
    const arrived = async (state: WaitState) => {
      const how = await known(state)
      return how === "new" || how === "queued"
    }
    let states: WaitState[]
    for (;;) {
      states = await Promise.all(
        targets.map((target) => waitState(services, target, context))
      )
      const done = args.any
        ? (await Promise.all(states.map(arrived))).some(Boolean)
        : states.every((state) => state.state !== "working")
      if (done || (deadline !== undefined && Date.now() >= deadline)) break
      // Local agents end their turns in the harness; a short poll keeps
      // this simple for a mix of local and remote agents.
      await sleep(
        Math.min(
          targets.some((target) => target.kind === "remote") ? 3000 : 500,
          deadline === undefined ? 3000 : Math.max(0, deadline - Date.now())
        ),
        context.abortSignal
      )
    }
    const hows = await Promise.all(states.map(known))
    const finished = args.any
      ? hows.some((how) => how === "new" || how === "queued")
      : states.every((state) => state.state !== "working")
    // The caller sees the new answers now: no report sends them again.
    await markDelivered(
      api,
      states.flatMap((state, index) =>
        hows[index] === "new" && state.key
          ? [{ agent: state.agent, key: state.key }]
          : []
      ),
      context
    )
    const rank = { new: 0, queued: 1, read: 2, shown: 2, none: 3 } as const
    const parts = states
      .map((state, index) => ({ state, how: hows[index]! }))
      .toSorted((a, b) => rank[a.how] - rank[b.how])
      .map(({ state, how }) => {
        if (state.state === "unknown")
          return `## ${state.name} (unknown: ${state.error})`
        if (state.state === "working") return `## ${state.name} (still working)`
        if (state.state === "waiting")
          return `## ${state.name} (idle, waiting on ${state.waiting})\n${clip(state.answer ?? "(no answer)", 8000)}`
        if (how === "queued")
          return `## ${state.name} (idle, new answer: it is in your follow-up queue as a message, so it is not repeated here)`
        if (how === "new")
          return `## ${state.name} (idle, new answer)\n${clip(state.answer ?? "(no answer)", 8000)}`
        return `## ${state.name} (idle, you saw this answer before)\n${clip(state.answer ?? "(no answer)", 2000)}`
      })
    const head = finished
      ? args.any
        ? "An agent has a new answer."
        : "No agent works now."
      : `Timed out after ${args.timeout}s.`
    return textResult(`${head}\n\n${parts.join("\n\n")}`)
  }

  const stopAgents = async (
    services: HostServices,
    ids: string[],
    args: AgentsArgs,
    api: ToolExecutionApi
  ) =>
    forEachAgent(
      services,
      ids,
      args.machine,
      async (id) => {
        if (id === agentIdOf(api.conversationId))
          throw new Error("An agent cannot stop itself this way.")
        await services.agents.abort(id)
        return `Stopped agent ${id}.`
      },
      async (connection, id) => {
        await connection.request("POST", "/api/machine/agent/stop", {
          body: { id },
        })
        return `Stopped agent ${remoteName(connection, id)}.`
      }
    )

  /**
   * Run `action` for each ID, on this machine or a remote one. Returns one
   * line for each agent, so a bad ID does not stop the others.
   */
  const forEachAgent = async (
    services: HostServices,
    ids: string[],
    machine: string | undefined,
    local: (id: string) => string | Promise<string>,
    remote: (connection: RemoteConnection, id: string) => Promise<string>
  ) => {
    const lines: string[] = []
    let failed = 0
    for (const value of ids) {
      try {
        const target = remoteTarget(services, machine, value)
        if (target) {
          if (!target.id) throw new Error(`Unknown agent: ${value}`)
          lines.push(await remote(target.connection, target.id))
        } else lines.push(await local(requireAgent(services, value)))
      } catch (error) {
        failed += 1
        lines.push(
          `${value}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    const text = lines.join("\n")
    return failed === ids.length ? errorResult(text) : textResult(text)
  }

  const markAgents = (
    services: HostServices,
    ids: string[],
    args: AgentsArgs,
    unread: boolean
  ) => {
    const word = unread ? "unread" : "read"
    return forEachAgent(
      services,
      ids,
      args.machine,
      (id) => {
        services.agents.setRead(id, !unread)
        return `Marked ${id} ${word}.`
      },
      async (connection, id) => {
        await connection.request("POST", "/api/machine/agent/read-state", {
          body: { id, unread },
        })
        return `Marked ${remoteName(connection, id)} ${word}.`
      }
    )
  }

  const archiveAgents = (
    services: HostServices,
    ids: string[],
    args: AgentsArgs,
    api: ToolExecutionApi,
    restore: boolean
  ) => {
    const self = agentIdOf(api.conversationId)
    return forEachAgent(
      services,
      ids,
      args.machine,
      (id) => {
        if (restore) {
          services.agents.restore(id)
          return `Restored ${id}.`
        }
        if (id === self) throw new Error("An agent cannot archive itself.")
        if (
          services.agents.has(self) &&
          id === services.agents.meta(self).parent
        )
          throw new Error("An agent cannot archive its parent.")
        services.agents.archive(id)
        return `Archived ${id}.`
      },
      async (connection, id) => {
        await connection.request("POST", "/api/machine/agent/archive", {
          body: { id, restore },
        })
        return `${restore ? "Restored" : "Archived"} ${remoteName(connection, id)}.`
      }
    )
  }

  const AGENT_ACTIONS = [
    "list",
    "read",
    "wait",
    "send",
    "stop",
    "archive",
    "restore",
    "mark_read",
    "mark_unread",
  ] as const

  const agentsTool = defineTool({
    name: "agents",
    description: [
      "Look at, message, and manage other agents. Actions:",
      "list (scope: subagents (default), project, all, or archived);",
      "read (the last messages of agent id; last, default 6; include_tools);",
      "wait (until no agent of ids works, or with any: true until one of them has an answer you have not seen; timeout in seconds; returns their answers);",
      "send (send message to agent id, for example your subagent, your parent, or an agent that builds what you review; mode: followUp (default; after its current work) or steer (into its current work); with wait: true the result is its answer, otherwise its answer comes to you as a message; add and remove change the tools of your subagent, for example add: ['ask_user'] answers a subagent that asked for a tool; a message to your parent always goes into its follow-up queue);",
      "stop (stop the current work of ids, like Esc);",
      "archive and restore (hide ids from the sidebar, or show them again; a busy agent cannot be archived);",
      "mark_read and mark_unread.",
      "An answer that you got from wait or read does not come to you again as a message.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(AGENT_ACTIONS.map((name) => Type.Literal(name))),
      id: Type.Optional(Type.String()),
      ids: Type.Optional(
        Type.Array(
          Type.String({
            description: "Agent IDs; workbox:s12 is an agent on workbox",
          })
        )
      ),
      scope: Type.Optional(
        Type.Union([
          Type.Literal("subagents"),
          Type.Literal("project"),
          Type.Literal("all"),
          Type.Literal("archived"),
        ])
      ),
      last: Type.Optional(Type.Number()),
      include_tools: Type.Optional(Type.Boolean()),
      timeout: Type.Optional(
        Type.Number({ description: "wait, and send with wait: seconds" })
      ),
      any: Type.Optional(Type.Boolean()),
      message: Type.Optional(Type.String({ description: "send: the text" })),
      mode: Type.Optional(
        Type.Union([Type.Literal("followUp"), Type.Literal("steer")])
      ),
      wait: Type.Optional(
        Type.Boolean({ description: "send: wait for the answer" })
      ),
      add: Type.Optional(
        Type.Array(Type.String(), {
          description: "send: tools to give your subagent",
        })
      ),
      remove: Type.Optional(
        Type.Array(Type.String(), {
          description: "send: tools to take away from your subagent",
        })
      ),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, api, context) {
      const action = String(args.action)
      if (action === "list") return listAgents(args, api, context)
      if (action === "read") return readAgent(args, api, context)
      if (action === "wait") return waitAgents(args, api, context)
      if (action === "send")
        return (
          deniedAction(host, api.conversationId, "agents.send") ??
          sendMessage(args, api, context)
        )
      const services = await host.ready(context.abortSignal)
      const ids = args.ids ?? (args.id ? [args.id] : [])
      if (ids.length === 0) return errorResult(`${action} needs ids.`)
      if (action === "stop")
        return (
          deniedAction(host, api.conversationId, "agents.stop") ??
          stopAgents(services, ids, args, api)
        )
      if (action === "archive" || action === "restore")
        return (
          deniedAction(host, api.conversationId, "agents.archive") ??
          archiveAgents(services, ids, args, api, action === "restore")
        )
      if (action === "mark_read" || action === "mark_unread")
        return markAgents(services, ids, args, action === "mark_unread")
      return errorResult(`Unknown action: ${action}`)
    },
  })

  return defineExtension({
    name: "agents",
    tools: [spawnTool, agentsTool],
    tasks: [ReportTask, RemoteReportTask],
  })
}
