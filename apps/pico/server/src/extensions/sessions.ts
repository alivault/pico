/**
 * The `sessions` extension: sessions that start and talk to other sessions.
 *
 * `spawn_session` makes a child: a normal Pico session with a `parent` link,
 * which the user can open in the web client. It is ownerless, so it outlives
 * the call that made it. Without `wait`, a background `pico.child-report` task
 * waits for the child and puts its answer in the parent's follow-up queue.
 *
 * Messages from a child never steer: they go into the parent's follow-up
 * queue, in arrival order with the user's prompts. Each turn end of a child
 * is a question, done, or waiting (it ended on a timer, a watch, or a job;
 * see `childMessageKind`). Waiting sends nothing: `list_sessions` shows it. A child has limited tools (see
 * `core/profiles.ts`): the parent picks a profile and adds or removes tools.
 * A child asks by ending its turn with a message that starts with `Question:`.
 *
 * Restarts: the tools are replay-safe. A rerun finds the child by the call ID
 * stored in the child's metadata (written in the commit that creates it), and
 * prompts carry request IDs, so nothing is created or sent twice.
 *
 * Machines: on a hub, the tools take an optional `machine` (a label or an
 * ID), or an ID such as `workbox:s12`. They then call the remote server
 * through the hub's SSH connection. An offline machine fails at once. A
 * remote agent cannot call back to the hub.
 */
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  AgentDoc,
  defineExtension,
  defineTask,
  defineTool,
  type ConversationId,
  type EntryRecord,
  type Harness,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"

import { createWorktree } from "../services/worktree.ts"
import {
  conversationOf,
  sessionIdOf,
  type HostBridge,
  type HostServices,
} from "./host.ts"
import { allProfiles, findProfile, nameList } from "../core/profiles.ts"
import { JobsDoc } from "./jobs.ts"
import { TimersDoc } from "./schedule.ts"
import { waitingLabel } from "./waiting.ts"
import { clip, errorResult, json, textResult } from "./util.ts"

/** A session ID from `s123`, `123`, or `pico:s123`. */
export function normalizeSessionId(value: string) {
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
 * The answer of the newest run of a conversation: assistant text after its
 * last user input. A run that was stopped or failed before it answered says
 * so, instead of returning the answer of an earlier run.
 */
export async function lastAnswer(
  harness: Pick<Harness, "conversation">,
  conversationId: ConversationId,
  context: Context
) {
  const conversation = await harness.conversation(conversationId, context)
  if (!conversation) return undefined
  const view = await conversation.context(context)
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
    if (text) return text
    if (message?.stopReason === "error")
      return `(the run failed: ${message.errorMessage ?? "unknown error"})`
  }
  return stopped ? STOPPED_ANSWER : undefined
}

/** The last messages of a session as text, for `read_session`. */
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

/** True when an answer asks something: a child ends its turn with `Question:`. */
export function isQuestion(answer: string, needsInput: boolean) {
  if (needsInput) return true
  const text = answer.trim()
  if (/^(?:[*_#>\s]*)question\b/i.test(text)) return true
  const lastLine = text.split("\n").at(-1)?.trim() ?? ""
  return /\?[*_)\s]*$/.test(lastLine)
}

/**
 * What the end of a child's turn means:
 * - `question`: it asks its parent (or waits in `ask_user`).
 * - `waiting`: its turn ended on a timer, a watch, or a job, and it goes on
 *   when that fires. The parent does not get a message for it.
 * - `done`: the work is finished, or it stopped.
 */
export type ChildMessageKind = "question" | "done" | "waiting"

export function childMessageKind(
  answer: string,
  needsInput: boolean,
  waiting: string | undefined
): ChildMessageKind {
  if (isQuestion(answer, needsInput)) return "question"
  return waiting ? "waiting" : "done"
}

/**
 * What a session waits on when its turn ended: pending timers and watches,
 * and running jobs that report their exit. Undefined when it waits on nothing.
 */
export async function waitingOn(
  harness: Pick<Harness, "snapshot">,
  conversationId: ConversationId,
  context: Context
) {
  const [timers, jobs] = await Promise.all([
    harness.snapshot(TimersDoc, conversationId, context),
    harness.snapshot(JobsDoc, conversationId, context),
  ])
  return waitingLabel(timers, jobs)
}

/**
 * The text of a message from another session for the follow-up queue,
 * marked as a question or as done.
 */
export function reportMessage(input: {
  /** `s12`, or `workbox:s12` for a remote session. */
  name: string
  title: string
  answer: string
  needsInput: boolean
  child: boolean
}) {
  const who = `${input.child ? "Child session" : "Session"} ${input.name}`
  const question = isQuestion(input.answer, input.needsInput)
  const head = question
    ? `[${who}: question] ${input.title}`
    : `[${who}: done${input.answer === STOPPED_ANSWER ? ", stopped" : ""}] ${input.title}`
  return [
    head,
    clip(input.answer, 12_000),
    question
      ? input.needsInput
        ? `It waits for the user in its ask_user question. You can also answer with send_to_session (id ${input.name}).`
        : `Answer it with send_to_session (id ${input.name}). To give it a tool, use send_to_session add.`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

type ReportInput = {
  /** The session that gets the report, as a conversation ID. */
  parent: number
  child: string
  childTitle: string
  /** Distinguishes reports of several messages to one child. */
  key: string
}

type ReportCheckpoint = { phase: "wait" } | { phase: "report"; answer: string }

function createReportTask(host: HostBridge) {
  return defineTask<ReportInput, ReportCheckpoint, null>({
    name: "pico.child-report",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, runtime, context) => {
        const services = await host.ready(runtime.signal)
        const child = conversationOf(task.input.child)
        const handle = await runtime.conversation(child, context)
        let answer: string
        // A turn that ends on a timer, a watch, or a job is `waiting`: wait
        // until the child runs again and ends with a question or done.
        for (;;) {
          if (handle) await handle.waitForIdle(context)
          answer =
            (await lastAnswer(services.harness, child, context)) ??
            "(no answer)"
          const needsInput = Boolean(
            services.sessions
              .list({})
              .find((session) => session.id === task.input.child)?.needsInput
          )
          const waiting = () => waitingOn(services.harness, child, context)
          if (
            !handle ||
            childMessageKind(answer, needsInput, await waiting()) !== "waiting"
          )
            break
          // Sleep at least one time in each pass. If the session is busy but
          // the harness is idle, waitForIdle resolves at once, and without a
          // sleep this loop never yields to the event loop.
          do await sleep(WAITING_POLL_MS, runtime.signal)
          while (
            !services.sessions.isBusy(task.input.child) &&
            (await waiting())
          )
        }
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: { phase: "report", answer },
          }),
          context
        )
      },
      report: async (task, runtime, context) => {
        const { input } = task
        const services = await host.ready(runtime.signal)
        const needsInput = Boolean(
          services.sessions
            .list({})
            .find((session) => session.id === input.child)?.needsInput
        )
        const parent = sessionIdOf(input.parent as unknown as ConversationId)
        if (services.sessions.has(parent))
          await services.sessions.followUp(
            parent,
            reportMessage({
              name: input.child,
              title: input.childTitle,
              answer: task.state.checkpoint.answer,
              needsInput,
              child:
                services.sessions.has(input.child) &&
                services.sessions.meta(input.child).parent === parent,
            }),
            `report:${input.child}:${input.key}`
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

type RemoteSession = {
  sessionId: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  /** What the session waits on: a timer, a watch, or a job. */
  waiting?: string
  worktree?: { path: string; branch: string }
}

/** How often a report task checks a waiting child. */
const WAITING_POLL_MS = 3000

/** The state of a session for `list_sessions`. */
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
  const sessionId =
    id === undefined
      ? undefined
      : normalizeSessionId(
          prefixed && !machine?.trim()
            ? prefixed[2]!
            : id.replace(/^[^:]+:/, "")
        )
  return { connection, ...(sessionId ? { id: sessionId } : {}) }
}

/** How agents and users write a remote session: `workbox:s12`. */
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
 * Wait until a remote session is idle, with long polls. Undefined when the
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
      `/api/machine/session/wait?id=${encodeURIComponent(id)}&timeoutMs=${Math.min(25_000, left)}`,
      { timeoutMs: 45_000 }
    )) as RemoteSession & { idle: boolean; answer?: string }
    if (result.idle) return result
  }
}

type RemoteReportInput = {
  parent: number
  machine: string
  child: string
  childTitle: string
  key: string
}

type RemoteReportCheckpoint =
  | { phase: "wait" }
  | { phase: "report"; answer: string; needsInput: boolean }

/**
 * Post the answer of a remote session to the caller when it is idle. It
 * waits through offline periods; the request ID lets only one message through.
 */
function createRemoteReportTask(host: HostBridge) {
  return defineTask<RemoteReportInput, RemoteReportCheckpoint, null>({
    name: "pico.remote-child-report",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, runtime, context) => {
        let answer: string | undefined
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
              needsInput = result.needsInput
              if (
                childMessageKind(answer, needsInput, result.waiting) !==
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
            checkpoint: { phase: "report", answer, needsInput },
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
        const parent = sessionIdOf(input.parent as unknown as ConversationId)
        if (services.sessions.has(parent))
          await services.sessions.followUp(
            parent,
            reportMessage({
              name,
              title: input.childTitle,
              answer: checkpoint.answer,
              needsInput: checkpoint.needsInput,
              child: false,
            }),
            `report:${input.machine}:${input.child}:${input.key}`
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

export function createSessionsExtension(host: HostBridge) {
  const ReportTask = createReportTask(host)
  const RemoteReportTask = createRemoteReportTask(host)

  /** Like `scheduleReport`, for a session on another machine. */
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

  const requireSession = (services: HostServices, value: string) => {
    const id = services.sessions.current(normalizeSessionId(value))
    if (!id || !services.sessions.has(id))
      throw new Error(`Unknown session: ${value}`)
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
    name: "spawn_session",
    executionMode: "sequential",
    description: [
      "Start a child session: a full agent with its own context that works on `goal`. The user can open it in the sidebar.",
      "Use it to split independent work or to get a fresh review. By default it runs in the background. Its messages (done or a question) go into your follow-up queue: you get them after your current run answers, so keep working instead of waiting. A child whose turn ends on a timer, a watch, or a job is waiting: list_sessions shows it, and you get no message until it ends with done or a question. Set wait to get the answer as the result.",
      "Without worktree, the child works in the same directory as you and can edit the same files. Set worktree: true for parallel edits; the child gets its own git branch and worktree.",
      "Tools: profile picks a set (builder, researcher, reviewer, read-only, or full; default full). A child has no ask_user, notify, or spawn_session unless you put them in add. remove takes more tools away. Bash in a child refuses git push to main, sudo, and the commands in deny_commands.",
      "Write the goal as a complete brief: the child does not see this conversation.",
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
            "Tools to give the child, also ask_user, notify, or spawn_session",
        })
      ),
      remove: Type.Optional(
        Type.Array(Type.String(), { description: "Tools to take away" })
      ),
      deny_commands: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Commands that the child's bash refuses, by their first words, for example `npm publish` or `git reset --hard`",
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
      const parent = sessionIdOf(api.conversationId)
      if (!services.sessions.has(parent))
        return errorResult("spawn_session works only in a Pico session")
      const remote = resolveRemote(services, args.machine)
      if (remote.error) return remote.error
      if (remote.target) {
        if (args.worktree)
          return errorResult(
            "worktree is not available for a session on another machine."
          )
        const { connection } = remote.target
        let created: RemoteSession
        try {
          created = (await connection.request(
            "POST",
            "/api/machine/session/spawn",
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
          )) as RemoteSession
        } catch (error) {
          return errorResult(
            `Could not start the session on ${connection.profile.label}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        const name = remoteName(connection, created.sessionId)
        const title = args.name ?? created.title ?? args.goal.slice(0, 60)
        const details = {
          sessionId: created.sessionId,
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
              child: created.sessionId,
              childTitle: title,
              key: `spawn-${api.callId}`,
            },
            context
          )
          return textResult(
            `Started session ${name} in ${created.cwd} on ${connection.profile.label}. Its answer comes to you as a message when it finishes. Use read_session, send_to_session, or stop_session with id ${name}.`,
            { details: json({ ...details, status: "running" }) }
          )
        }
        try {
          const done = await remoteWait(
            connection,
            created.sessionId,
            args.timeout ? Date.now() + args.timeout * 1000 : undefined,
            context.abortSignal
          )
          return textResult(
            done
              ? `Session ${name} (in ${created.cwd}) finished.\nIts answer:\n${clip(done.answer ?? "(no answer)", 20_000)}`
              : `Session ${name} still runs after ${args.timeout}s. Check it later with read_session or wait_for_sessions.`,
            {
              details: json({
                ...details,
                status: done ? "done" : "running",
              }),
            }
          )
        } catch (error) {
          return errorResult(
            `Session ${name} started, but the wait failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      const parentMeta = services.sessions.meta(parent)
      const settings = services.settings()
      let child = services.sessions
        .list({ parent })
        .find(
          (session) =>
            services.sessions.meta(session.id).spawnedByCall === api.callId
        )?.id
      if (!child) {
        if (args.profile && !findProfile(args.profile, settings.profiles))
          return errorResult(
            `Unknown profile: ${args.profile}. Profiles: ${allProfiles(
              settings.profiles
            )
              .map((profile) => profile.name)
              .join(", ")}.`
          )
        if ((parentMeta.depth ?? 0) >= settings.maxSpawnDepth)
          return errorResult(
            `Child sessions may nest only ${settings.maxSpawnDepth} levels deep.`
          )
        const live = services.sessions
          .list({ parent })
          .filter((session) => session.busy).length
        if (live >= settings.maxChildSessions)
          return errorResult(
            `This session already has ${live} running child sessions. Wait for one or stop one.`
          )
        const agent = await api.snapshot(AgentDoc, api.conversationId, context)
        const requested = parseModel(args.model)
        let model = agent?.model as
          | { provider: string; modelId: string }
          | undefined
        if (typeof requested === "object") model = requested
        else if (typeof requested === "string") {
          const match = services.sessions
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
        child = await services.sessions.create(cwd, {
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
        { sessionId: child, status: "running", wait: Boolean(args.wait) },
        context
      )
      await services.sessions.prompt(child, {
        message: args.goal,
        images: [],
        requestId: `spawn:${api.callId}`,
      })
      const meta = services.sessions.meta(child)
      const title = args.name ?? meta.name ?? args.goal.slice(0, 60)
      const where = meta.worktree
        ? `in worktree ${meta.worktree.path} (branch ${meta.worktree.branch})`
        : `in ${meta.cwd}`
      if (!args.wait) {
        await scheduleReport(
          api,
          {
            parent: Number(api.conversationId),
            child,
            childTitle: title,
            key: `spawn-${api.callId}`,
          },
          context
        )
        return textResult(
          `Started child session ${child} ${where}. Its answer comes to you as a message when it finishes. Use read_session, send_to_session, or stop_session with id ${child}.`,
          {
            details: json({
              sessionId: child,
              title,
              status: "running",
              ...(meta.worktree ? { worktree: meta.worktree } : {}),
            }),
          }
        )
      }
      const finished = await within(
        waitIdle(services, conversationOf(child), context),
        args.timeout ? args.timeout * 1000 : undefined
      )
      const answer = await lastAnswer(
        services.harness,
        conversationOf(child),
        context
      )
      return textResult(
        finished
          ? `Child session ${child} (${where}) finished.\nIts answer:\n${clip(answer ?? "(no answer)", 20_000)}`
          : `Child session ${child} still runs after ${args.timeout}s. Check it later with read_session or wait_for_sessions.`,
        {
          details: json({
            sessionId: child,
            title,
            status: finished ? "done" : "running",
            ...(meta.worktree ? { worktree: meta.worktree } : {}),
          }),
        }
      )
    },
  })

  const sendTool = defineTool({
    name: "send_to_session",
    description: [
      "Send a message to another session, for example a child session or a session that builds what you review.",
      "mode: followUp (default; after its current work) or steer (into its current work). With wait, the result is its answer; otherwise its answer comes to you as a message.",
      "add and remove change the tools of your child session; for example add: ['ask_user'] answers a child that asked for a tool. A message to your parent always goes into its follow-up queue.",
    ].join(" "),
    parameters: Type.Object({
      id: Type.String(),
      message: Type.String(),
      mode: Type.Optional(
        Type.Union([Type.Literal("followUp"), Type.Literal("steer")])
      ),
      wait: Type.Optional(Type.Boolean()),
      timeout: Type.Optional(Type.Number()),
      add: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tools to give your child session",
        })
      ),
      remove: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tools to take away from your child session",
        })
      ),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const remote = resolveRemote(services, args.machine, args.id)
      if ((args.add?.length || args.remove?.length) && remote.target)
        return errorResult(
          "add and remove work only for a child session on this machine."
        )
      if (remote.error) return remote.error
      if (remote.target?.id) {
        const { connection, id } = remote.target
        const name = remoteName(connection, id)
        const from = sessionIdOf(api.conversationId)
        let sent: RemoteSession
        try {
          sent = (await connection.request(
            "POST",
            "/api/machine/session/prompt",
            {
              body: {
                id,
                message: `[Message from session ${from} on the hub] ${args.message}`,
                mode: args.mode ?? "followUp",
                requestId: callRequestId(api),
              },
            }
          )) as RemoteSession
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
            `Sent to session ${name}. Its answer comes to you as a message.`,
            {
              details: {
                sessionId: id,
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
          return textResult(
            done
              ? `Session ${name} answered:\n${clip(done.answer ?? "(no answer)", 20_000)}`
              : `Session ${name} still runs after ${args.timeout}s.`,
            {
              details: {
                sessionId: id,
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
        target = requireSession(services, args.id)
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      if (target === sessionIdOf(api.conversationId))
        return errorResult("A session cannot send a message to itself.")
      const from = sessionIdOf(api.conversationId)
      const toParent =
        services.sessions.has(from) &&
        services.sessions.meta(from).parent === target
      let granted = ""
      if (args.add?.length || args.remove?.length) {
        if (services.sessions.meta(target).parent !== from)
          return errorResult(
            "add and remove work only for your own child sessions."
          )
        await services.sessions.changeLimits(target, {
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
        await services.sessions.followUp(
          target,
          reportMessage({
            name: from,
            title: services.sessions.meta(from).name ?? from,
            answer: args.message,
            needsInput: false,
            child: true,
          }),
          `send:${api.callId}`
        )
      } else {
        await services.sessions.prompt(target, {
          message: `[Message from session ${from}] ${granted ? `${granted} ` : ""}${args.message}`,
          images: [],
          streamingBehavior: args.mode ?? "followUp",
          requestId: `send:${api.callId}`,
        })
      }
      const title =
        services.sessions.list({}).find((item) => item.id === target)?.title ??
        target
      if (!args.wait) {
        await scheduleReport(
          api,
          {
            parent: Number(api.conversationId),
            child: target,
            childTitle: title,
            key: `send-${api.callId}`,
          },
          context
        )
        return textResult(
          `Sent to session ${target}. Its answer comes to you as a message.`,
          { details: { sessionId: target, title } }
        )
      }
      const finished = await within(
        waitIdle(services, conversationOf(target), context),
        args.timeout ? args.timeout * 1000 : undefined
      )
      const answer = await lastAnswer(
        services.harness,
        conversationOf(target),
        context
      )
      return textResult(
        finished
          ? `Session ${target} answered:\n${clip(answer ?? "(no answer)", 20_000)}`
          : `Session ${target} still runs after ${args.timeout}s.`,
        { details: { sessionId: target, title } }
      )
    },
  })

  const readTool = defineTool({
    name: "read_session",
    description:
      "Read the recent transcript of another session: its last messages (default 6), optionally with tool results.",
    parameters: Type.Object({
      id: Type.String(),
      last: Type.Optional(Type.Number()),
      include_tools: Type.Optional(Type.Boolean()),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, _api, context) {
      const services = await host.ready(context.abortSignal)
      const remote = resolveRemote(services, args.machine, args.id)
      if (remote.error) return remote.error
      if (remote.target?.id) {
        const { connection, id } = remote.target
        try {
          const result = (await connection.request(
            "GET",
            `/api/machine/session/read?id=${encodeURIComponent(id)}&last=${Math.min(50, Math.max(1, args.last ?? 6))}${args.include_tools ? "&includeTools=1" : ""}`
          )) as RemoteSession & { text: string }
          return textResult(
            [
              `Session ${remoteName(connection, id)}: ${result.title} (${result.busy ? "working" : "idle"}${result.needsInput ? ", waiting for the user" : ""})`,
              `Machine: ${connection.profile.label}. Directory: ${result.cwd}${result.worktree ? ` (worktree, branch ${result.worktree.branch})` : ""}`,
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
        target = requireSession(services, args.id)
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const summary = services.sessions
        .list({})
        .find((item) => item.id === target)
      const text = await transcriptText(
        services.harness,
        conversationOf(target),
        {
          last: Math.min(50, Math.max(1, args.last ?? 6)),
          includeTools: Boolean(args.include_tools),
        },
        context
      )
      const meta = services.sessions.meta(target)
      return textResult(
        [
          `Session ${target}: ${summary?.title ?? ""} (${summary?.busy ? "working" : "idle"}${summary?.needsInput ? ", waiting for the user" : ""})`,
          `Directory: ${meta.cwd}${meta.worktree ? ` (worktree, branch ${meta.worktree.branch})` : ""}`,
          "",
          clip(text || "(no messages)", 40_000),
        ].join("\n")
      )
    },
  })

  const listTool = defineTool({
    name: "list_sessions",
    description:
      "List sessions: your children (default), the sessions of your directory, or all sessions.",
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([
          Type.Literal("children"),
          Type.Literal("directory"),
          Type.Literal("all"),
          Type.Literal("archived"),
        ])
      ),
      machine: Type.Optional(
        Type.String({
          description:
            "List the sessions of another machine of this hub (label or ID) instead.",
        })
      ),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const remote = resolveRemote(services, args.machine)
      if (remote.error) return remote.error
      if (remote.target) {
        const { connection } = remote.target
        try {
          if (args.scope === "archived") {
            const archived = (await connection.request(
              "GET",
              "/api/machine/sessions/archived"
            )) as {
              sessions: Array<{ id: string; title: string; cwd: string }>
            }
            if (archived.sessions.length === 0)
              return textResult(
                `No archived sessions on ${connection.profile.label}.`
              )
            return textResult(
              archived.sessions
                .map(
                  (item) =>
                    `${remoteName(connection, item.id)} — ${item.title} [archived]\n  ${item.cwd}`
                )
                .join("\n")
            )
          }
          const result = (await connection.request(
            "GET",
            "/api/machine/sessions"
          )) as {
            sessions: Array<{
              id: string
              title: string
              cwd: string
              busy: boolean
              needsInput: boolean
              unread?: boolean
              lastMessagePreview?: string
              waiting?: string
            }>
          }
          if (result.sessions.length === 0)
            return textResult(`No sessions on ${connection.profile.label}.`)
          return textResult(
            result.sessions
              .map(
                (item) =>
                  `${remoteName(connection, item.id)} — ${item.title} [${status(item)}]\n  ${item.cwd}${item.lastMessagePreview ? `\n  last: ${item.lastMessagePreview}` : ""}`
              )
              .join("\n")
          )
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error)
          )
        }
      }
      const self = sessionIdOf(api.conversationId)
      const scope = args.scope ?? "children"
      if (scope === "archived") {
        const archived = services.sessions.archivedSessions().slice(0, 50)
        if (archived.length === 0) return textResult("No archived sessions.")
        return textResult(
          archived
            .map(
              (item) =>
                `${item.id} — ${item.title} [archived${item.archivedAt ? ` ${item.archivedAt}` : ""}]\n  ${item.cwd}`
            )
            .join("\n")
        )
      }
      const meta = services.sessions.has(self)
        ? services.sessions.meta(self)
        : undefined
      const items = services.sessions
        .list(
          scope === "children"
            ? { parent: self }
            : scope === "directory" && meta
              ? { directory: meta.group ?? meta.cwd }
              : {}
        )
        .slice(0, 50)
      if (items.length === 0) return textResult(`No sessions (${scope}).`)
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
              `${item.id}${item.id === self ? " (you)" : ""} — ${item.title} [${status(item)}]${item.parent ? ` child of ${item.parent}` : ""}${item.worktreeBranch ? ` branch ${item.worktreeBranch}` : ""}\n  ${item.cwd}${item.lastMessagePreview ? `\n  last: ${item.lastMessagePreview}` : ""}`
          )
          .join("\n")
      )
    },
  })

  const waitTool = defineTool({
    name: "wait_for_sessions",
    description:
      "Wait until the given sessions are idle (or the timeout passes), then return the answer of each.",
    parameters: Type.Object({
      ids: Type.Array(
        Type.String({
          description: "Session IDs; workbox:s12 is a session on workbox",
        })
      ),
      timeout: Type.Optional(Type.Number({ description: "Seconds" })),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, _api, context) {
      const services = await host.ready(context.abortSignal)
      let ids: string[]
      const remotes: Array<{ connection: RemoteConnection; id: string }> = []
      try {
        ids = []
        for (const value of args.ids) {
          const remote = remoteTarget(services, args.machine, value)
          if (remote?.id)
            remotes.push({ connection: remote.connection, id: remote.id })
          else ids.push(requireSession(services, value))
        }
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const deadline = args.timeout
        ? Date.now() + args.timeout * 1000
        : undefined
      const remoteResults = new Map<
        string,
        (RemoteSession & { answer?: string }) | Error | undefined
      >()
      const finished = await within(
        Promise.all([
          ...ids.map((id) => waitIdle(services, conversationOf(id), context)),
          ...remotes.map(async ({ connection, id }) => {
            const key = remoteName(connection, id)
            try {
              remoteResults.set(
                key,
                await remoteWait(connection, id, deadline, context.abortSignal)
              )
            } catch (error) {
              remoteResults.set(
                key,
                error instanceof Error ? error : new Error(String(error))
              )
            }
          }),
        ]),
        args.timeout ? args.timeout * 1000 : undefined
      )
      const parts: string[] = []
      for (const { connection, id } of remotes) {
        const key = remoteName(connection, id)
        const result = remoteResults.get(key)
        parts.push(
          result instanceof Error
            ? `## ${key} (unknown: ${result.message})`
            : result
              ? `## ${key} (idle)\n${clip(result.answer ?? "(no answer)", 8000)}`
              : `## ${key} (still working)`
        )
      }
      for (const id of ids) {
        const busy = services.sessions.isBusy(id)
        const waiting = busy
          ? undefined
          : await waitingOn(services.harness, conversationOf(id), context)
        const answer = await lastAnswer(
          services.harness,
          conversationOf(id),
          context
        )
        parts.push(
          `## ${id} (${busy ? "still working" : waiting ? `idle, waiting on ${waiting}` : "idle"})\n${clip(answer ?? "(no answer)", 8000)}`
        )
      }
      return textResult(
        `${finished ? "All sessions are idle." : `Timed out after ${args.timeout}s.`}\n\n${parts.join("\n\n")}`
      )
    },
  })

  const stopTool = defineTool({
    name: "stop_session",
    description: "Stop the current work of another session (like Esc).",
    parameters: Type.Object({ id: Type.String(), machine: MACHINE_PARAMETER }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const remote = resolveRemote(services, args.machine, args.id)
      if (remote.error) return remote.error
      if (remote.target?.id) {
        const { connection, id } = remote.target
        try {
          await connection.request("POST", "/api/machine/session/stop", {
            body: { id },
          })
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error)
          )
        }
        return textResult(`Stopped session ${remoteName(connection, id)}.`)
      }
      let target: string
      try {
        target = requireSession(services, args.id)
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      if (target === sessionIdOf(api.conversationId))
        return errorResult("A session cannot stop itself this way.")
      await services.sessions.abort(target)
      return textResult(`Stopped session ${target}.`)
    },
  })

  /**
   * Run `action` for each ID, on this machine or a remote one. Returns one
   * line for each session, so a bad ID does not stop the others.
   */
  const forEachSession = async (
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
          if (!target.id) throw new Error(`Unknown session: ${value}`)
          lines.push(await remote(target.connection, target.id))
        } else lines.push(await local(requireSession(services, value)))
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

  const readStateTool = defineTool({
    name: "mark_sessions_read",
    description:
      "Mark sessions as read (default) or unread. Read state is the same in every tab and client of the user.",
    parameters: Type.Object({
      ids: Type.Array(
        Type.String({
          description: "Session IDs; workbox:s12 is a session on workbox",
        })
      ),
      unread: Type.Optional(
        Type.Boolean({ description: "Mark them unread instead" })
      ),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, _api, context) {
      const services = await host.ready(context.abortSignal)
      const unread = args.unread === true
      const word = unread ? "unread" : "read"
      if (args.ids.length === 0) return errorResult("ids must not be empty.")
      return forEachSession(
        services,
        args.ids,
        args.machine,
        (id) => {
          services.sessions.setRead(id, !unread)
          return `Marked ${id} ${word}.`
        },
        async (connection, id) => {
          await connection.request("POST", "/api/machine/session/read-state", {
            body: { id, unread },
          })
          return `Marked ${remoteName(connection, id)} ${word}.`
        }
      )
    },
  })

  const archiveTool = defineTool({
    name: "archive_sessions",
    description:
      "Archive sessions: hide them from the sidebar. They stay on disk. Set restore to show archived sessions again; list_sessions with scope archived lists them. A busy session cannot be archived.",
    parameters: Type.Object({
      ids: Type.Array(
        Type.String({
          description: "Session IDs; workbox:s12 is a session on workbox",
        })
      ),
      restore: Type.Optional(
        Type.Boolean({ description: "Restore archived sessions instead" })
      ),
      machine: MACHINE_PARAMETER,
    }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const restore = args.restore === true
      const self = sessionIdOf(api.conversationId)
      if (args.ids.length === 0) return errorResult("ids must not be empty.")
      return forEachSession(
        services,
        args.ids,
        args.machine,
        (id) => {
          if (restore) {
            services.sessions.restore(id)
            return `Restored ${id}.`
          }
          if (id === self) throw new Error("A session cannot archive itself.")
          if (
            services.sessions.has(self) &&
            id === services.sessions.meta(self).parent
          )
            throw new Error("A session cannot archive its parent.")
          services.sessions.archive(id)
          return `Archived ${id}.`
        },
        async (connection, id) => {
          await connection.request("POST", "/api/machine/session/archive", {
            body: { id, restore },
          })
          return `${restore ? "Restored" : "Archived"} ${remoteName(connection, id)}.`
        }
      )
    },
  })

  return defineExtension({
    name: "sessions",
    tools: [
      spawnTool,
      sendTool,
      readTool,
      listTool,
      waitTool,
      stopTool,
      readStateTool,
      archiveTool,
    ],
    tasks: [ReportTask, RemoteReportTask],
  })
}
