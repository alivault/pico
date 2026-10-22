/**
 * The `schedule` extension: durable timers.
 *
 * A timer is a background task owned by the conversation. It sleeps until its
 * time with the Harness clock, then sends a steer input to the session.
 * The sleep is a checkpoint, so a timer survives a server restart; a timer
 * that was due while the server was down fires once at startup. Repeating
 * timers (`every` or `cron`) compute the next time from the current time, so
 * missed runs are not sent many times.
 *
 * The `pico.timers` document lists timers and watches (see `watch.ts`) for the
 * Agent panel.
 */
import { Cron } from "croner"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type ConversationId,
  type TaskId,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"
import {
  errorResult,
  formatDuration,
  json,
  notifyAgent,
  parseDuration,
  registerState,
  textResult,
} from "./util.ts"

export type TimerItem = {
  id: string
  kind: "timer" | "watch"
  label: string
  message: string
  status: "pending" | "done" | "cancelled" | "failed"
  createdAt: number
  /** Next time the timer fires, or the watch checks. */
  nextAt?: number
  every?: string
  cron?: string
  runs: number
  lastAt?: number
  /** The newest check result of a watch. */
  lastOutput?: string
  endedAt?: number
}

export type TimersState = {
  items: Record<string, TimerItem>
  /** Tool call ID to task ID, so a rerun does not create a second timer. */
  byCall: Record<string, string>
}

export const TimersDoc = defineDoc<TimersState>({
  kind: "pico.timers",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {}, byCall: {} }),
})

const KEEP_FINISHED = 20

/** Drop the oldest finished items. */
export function pruneTimers(state: TimersState) {
  const finished = Object.values(state.items)
    .filter((item) => item.status !== "pending")
    .sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0))
  for (const item of finished.slice(
    0,
    Math.max(0, finished.length - KEEP_FINISHED)
  )) {
    delete state.items[item.id]
    for (const [call, id] of Object.entries(state.byCall))
      if (id === item.id) delete state.byCall[call]
  }
}

export async function updateTimer(
  tx: Tx,
  conversationId: ConversationId,
  id: string,
  change: Partial<TimerItem>
) {
  const draft = (await tx.doc(
    TimersDoc,
    conversationId
  )) as unknown as TimersState
  const item = draft.items[id]
  if (!item) return
  Object.assign(item, json(change))
  for (const [key, value] of Object.entries(change))
    if (value === undefined) delete (item as Record<string, unknown>)[key]
  if (change.status && change.status !== "pending") pruneTimers(draft)
}

type TimerInput = {
  message: string
  label: string
  at: number
  everyMs?: number
  cron?: string
  timezone?: string
  maxRuns?: number
}

type TimerCheckpoint =
  | { phase: "sleep"; fireAt: number; runs: number }
  | { phase: "fire"; fireAt: number; runs: number }

/** The next time a repeating timer fires after `now`, or undefined. */
export function nextFire(input: TimerInput, runs: number, now: number) {
  if (input.maxRuns !== undefined && runs >= input.maxRuns) return undefined
  if (input.everyMs) return now + input.everyMs
  if (input.cron) {
    const next = new Cron(input.cron, {
      paused: true,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    }).nextRun(new Date(now))
    return next ? next.getTime() : undefined
  }
  return undefined
}

function createTimerTask(host: HostBridge) {
  return defineTask<TimerInput, TimerCheckpoint, { runs: number }>({
    name: "pico.timer",
    version: 1,
    initial: (input) => ({ phase: "sleep", fireAt: input.at, runs: 0 }),
    phases: {
      // The first wait. Later waits sleep straight from `fire`.
      sleep: (task, runtime, context) => {
        const checkpoint = task.state.checkpoint
        return runtime.sleepUntil(
          checkpoint.fireAt,
          { ...checkpoint, phase: "fire" },
          context
        )
      },
      fire: async (task, runtime, context) => {
        const { runs } = task.state.checkpoint
        const input = task.input
        const repeat = input.everyMs || input.cron
        const text = [
          `[Scheduled${repeat ? `, run ${runs + 1}` : ""}] ${input.message}`,
          `(timer ${task.id}${input.label !== input.message ? `: ${input.label}` : ""})`,
        ].join("\n")
        await notifyAgent(
          host,
          (id) => runtime.conversation(id, context),
          task.conversationId,
          text,
          `timer:${task.id}:${runs}`,
          context
        )
        const now = runtime.now()
        const next = nextFire(input, runs + 1, now)
        await runtime.commit(async (tx) => {
          await updateTimer(tx, task.conversationId, String(task.id), {
            runs: runs + 1,
            lastAt: now,
            ...(next
              ? { nextAt: next }
              : { status: "done", endedAt: now, nextAt: undefined }),
          })
          return next
            ? {
                status: "sleeping",
                until: next,
                checkpoint: { phase: "fire", fireAt: next, runs: runs + 1 },
              }
            : {
                status: "terminal",
                outcome: { status: "completed", result: { runs: runs + 1 } },
              }
        }, context)
      },
    },
    abort: async (task, runtime, context) => {
      await runtime.commit(async (tx) => {
        await updateTimer(tx, task.conversationId, String(task.id), {
          status: "cancelled",
          endedAt: runtime.now(),
          nextAt: undefined,
        })
        return {
          status: "terminal",
          outcome: { status: "aborted", reason: "cancelled" },
        }
      }, context)
    },
  })
}

/** When a timer first fires: `at` (ISO time or epoch ms), `in` (a duration), or now plus `every`. */
export function firstFire(
  args: {
    at?: string
    in?: string
    every?: string
    cron?: string
    timezone?: string
  },
  now: number
) {
  if (args.at) {
    const at = /^\d+$/.test(args.at.trim())
      ? Number(args.at)
      : Date.parse(args.at)
    if (!Number.isFinite(at)) throw new Error(`Not a time: ${args.at}`)
    return Math.max(now, at)
  }
  if (args.in) {
    const ms = parseDuration(args.in)
    if (ms === undefined) throw new Error(`Not a duration: ${args.in}`)
    return now + ms
  }
  if (args.every) {
    const ms = parseDuration(args.every)
    if (ms === undefined) throw new Error(`Not a duration: ${args.every}`)
    return now + ms
  }
  if (args.cron) {
    const next = nextFire(
      {
        message: "",
        label: "",
        at: now,
        cron: args.cron,
        ...(args.timezone ? { timezone: args.timezone } : {}),
      },
      0,
      now
    )
    if (!next) throw new Error(`The cron expression never fires: ${args.cron}`)
    return next
  }
  throw new Error("Give at, in, every, or cron")
}

export function describeTimer(item: TimerItem, now = Date.now()) {
  const when =
    item.status === "pending" && item.nextAt
      ? item.nextAt <= now
        ? "due now"
        : `in ${formatDuration(item.nextAt - now)}`
      : item.status
  const repeat = item.every
    ? `, every ${item.every}`
    : item.cron
      ? `, cron "${item.cron}"`
      : ""
  return `${item.id} [${item.kind}] ${item.label} — ${when}${repeat}${item.runs ? `, ${item.runs} run(s)` : ""}`
}

export async function listTimers(
  api: Pick<ToolExecutionApi, "snapshot" | "conversationId">,
  kind: TimerItem["kind"] | undefined,
  context: Context
) {
  const state = await api.snapshot(TimersDoc, api.conversationId, context)
  const items = Object.values(state?.items ?? {})
    .filter((item) => !kind || item.kind === kind)
    .sort((left, right) => left.createdAt - right.createdAt)
  const open = items.filter((item) => item.status === "pending")
  if (items.length === 0) return `No ${kind ?? "timer"}s.`
  return [
    ...(open.length ? open : []).map((item) => describeTimer(item)),
    ...(items.length > open.length
      ? [
          `(${items.length - open.length} finished: ${items
            .filter((item) => item.status !== "pending")
            .slice(-5)
            .map((item) => `${item.id} ${item.status}`)
            .join(", ")})`,
        ]
      : []),
  ].join("\n")
}

/** Cancel a timer or watch of the calling conversation. */
export async function cancelTimer(
  host: HostBridge,
  api: Pick<ToolExecutionApi, "snapshot" | "conversationId">,
  id: string,
  context: Context
) {
  const state = await api.snapshot(TimersDoc, api.conversationId, context)
  const item = state?.items[id.trim()]
  if (!item) return errorResult(`No timer or watch with id ${id}`)
  if (item.status !== "pending")
    return textResult(`${item.kind} ${id} is already ${item.status}.`)
  const services = await host.ready(context.abortSignal)
  await services.harness.abortTask(Number(id) as unknown as TaskId, context)
  return textResult(`Cancelled ${item.kind} ${id}.`)
}

registerState({
  key: "timers",
  kinds: ["pico.timers"],
  async read(reader, conversationId, context) {
    const state = await reader.snapshot(TimersDoc, conversationId, context)
    const items = Object.values(state?.items ?? {})
    if (items.length === 0) return undefined
    const open = items.filter((item) => item.status === "pending")
    const recent = items
      .filter((item) => item.status !== "pending")
      .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
      .slice(0, 5)
    return json([...open, ...recent])
  },
})

export function createScheduleExtension(host: HostBridge) {
  const TimerTask = createTimerTask(host)

  const scheduleTool = defineTool({
    name: "schedule",
    description: [
      "Schedule a durable timer that sends you `message` later. It survives server restarts. If you are busy then, the message arrives at your next turn boundary (after the current tool calls), so you can keep working.",
      "Give one of: in (a duration such as 20m or 1h30m), at (an ISO time), every (repeat at a fixed interval), or cron (a 5-field cron expression, with optional timezone).",
      "Use it to check on something later, for example CI, a deploy, or a long job, instead of waiting in a loop.",
    ].join(" "),
    parameters: Type.Object({
      message: Type.String({
        description: "What you will receive when the timer fires",
      }),
      in: Type.Optional(Type.String()),
      at: Type.Optional(Type.String()),
      every: Type.Optional(Type.String()),
      cron: Type.Optional(Type.String()),
      timezone: Type.Optional(Type.String()),
      max_runs: Type.Optional(Type.Number({ minimum: 1 })),
      label: Type.Optional(Type.String()),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const now = Date.now()
      let at: number
      let everyMs: number | undefined
      try {
        at = firstFire(args, now)
        if (args.every) {
          everyMs = parseDuration(args.every)
          if (!everyMs || everyMs < 10_000)
            return errorResult("every must be at least 10s")
        }
        if (args.cron) new Cron(args.cron, { paused: true })
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const label = (args.label ?? args.message).trim().slice(0, 120)
      const input: TimerInput = {
        message: args.message,
        label,
        at,
        ...(everyMs ? { everyMs } : {}),
        ...(args.cron ? { cron: args.cron } : {}),
        ...(args.timezone ? { timezone: args.timezone } : {}),
        ...(args.max_runs ? { maxRuns: args.max_runs } : {}),
      }
      const id = await api.commit(async (tx) => {
        const draft = (await tx.doc(
          TimersDoc,
          api.conversationId
        )) as unknown as TimersState
        const existing = draft.byCall[api.callId]
        if (existing) return existing
        const taskId = String(
          await tx.createTask(TimerTask, input, {
            ownership: { kind: "conversation" },
            conversationId: api.conversationId,
            background: true,
          })
        )
        draft.byCall[api.callId] = taskId
        draft.items[taskId] = json({
          id: taskId,
          kind: "timer",
          label,
          message: args.message,
          status: "pending",
          createdAt: now,
          nextAt: at,
          ...(args.every ? { every: args.every } : {}),
          ...(args.cron ? { cron: args.cron } : {}),
          runs: 0,
        }) as TimerItem
        return taskId
      }, context)
      return textResult(
        `Timer ${id} fires ${at - now < 1000 ? "now" : `in ${formatDuration(at - now)} (${new Date(at).toISOString()})`}${args.every ? `, then every ${args.every}` : args.cron ? `, then on cron "${args.cron}"` : ""}.`,
        { details: { id, at } }
      )
    },
  })

  const listTool = defineTool({
    name: "schedule_list",
    description: "List the timers of this session.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api, context) =>
      textResult(await listTimers(api, "timer", context)),
  })

  const cancelTool = defineTool({
    name: "schedule_cancel",
    description: "Cancel a timer or a watch by id.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: (args, api, context) => cancelTimer(host, api, args.id, context),
  })

  return defineExtension({
    name: "schedule",
    tools: [scheduleTool, listTool, cancelTool],
    tasks: [TimerTask],
  })
}
