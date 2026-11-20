/**
 * The `schedule` extension: durable timers.
 *
 * A timer is a background task owned by the conversation. It sleeps until its
 * time on the Harness clock, then sends its message to the agent (a steer when
 * the agent works, else a new turn; see `notifyAgent`). The sleep is a
 * checkpoint, so a timer survives a server restart, and a timer that came due
 * while the server was down fires once at startup. Repeating timers (`every`
 * or `cron`) compute the next time from the current time, so missed runs are
 * not sent many times.
 *
 * The `smith.timers` document (`timers.ts`) lists the timers.
 */
import { Cron } from "croner"
import Type from "typebox"
import {
  defineExtension,
  defineTask,
  defineTool,
} from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"
import {
  cancelTimer,
  listTimers,
  MAX_PENDING,
  pendingCount,
  TimersDoc,
  updateTimer,
  type TimerItem,
  type TimersState,
} from "./timers.ts"
import {
  errorResult,
  formatDuration,
  json,
  notifyAgent,
  parseDuration,
  textResult,
} from "./util.ts"

export type TimerInput = {
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

/** The shortest `every`. */
export const MIN_EVERY_MS = 10_000

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

/** When a timer first fires: `at` (ISO time or epoch ms), `in` (a duration), now plus `every`, or the next cron time. */
export function firstFire(
  args: {
    at?: string | undefined
    in?: string | undefined
    every?: string | undefined
    cron?: string | undefined
    timezone?: string | undefined
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
    let next: number | undefined
    try {
      next = nextFire(
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
    } catch (error) {
      throw new Error(
        `Not a cron expression: ${args.cron} (${error instanceof Error ? error.message : String(error)})`
      )
    }
    if (!next) throw new Error(`The cron expression never fires: ${args.cron}`)
    return next
  }
  throw new Error("Give in, at, every, or cron.")
}

/** The message that a timer sends when it fires. */
export function timerMessage(
  id: string,
  input: Pick<TimerInput, "message" | "label" | "everyMs" | "cron">,
  run: number
) {
  const repeat = Boolean(input.everyMs || input.cron)
  return [
    `[Timer${repeat ? `, run ${run}` : ""}] ${input.message}`,
    `(timer ${id}${input.label !== input.message ? `: ${input.label}` : ""}${repeat ? `; cancel it with schedule action cancel, id ${id}` : ""})`,
  ].join("\n")
}

function createTimerTask(host: HostBridge) {
  return defineTask<TimerInput, TimerCheckpoint, { runs: number }>({
    name: "smith.timer",
    version: 1,
    initial: (input) => ({ phase: "sleep", fireAt: input.at, runs: 0 }),
    phases: {
      // The first wait. Later waits sleep straight into `fire`.
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
        await notifyAgent(
          host,
          (id) => runtime.conversation(id, context),
          task.conversationId,
          timerMessage(String(task.id), input, runs + 1),
          `timer:${task.id}:${runs}`,
          context
        )
        // From now, not from the missed time: one run after a long downtime.
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

export function createScheduleExtension(host: HostBridge) {
  const TimerTask = createTimerTask(host)

  const scheduleTool = defineTool({
    name: "schedule",
    description: [
      "A durable timer that sends you `message` later, also after a server restart. When it fires, the message starts a new turn, or arrives at your next turn boundary when you work.",
      "action create (default): give one of in (a duration such as 20m or 1h30m), at (an ISO time), every (repeat, at least 10s), or cron (5 fields, with optional timezone). A repeating timer runs again from the time it fired, so it does not catch up missed runs. max_runs ends a repeat.",
      "action list: your timers. action cancel: cancel timer `id`.",
      "Use it to come back to something at a time (a reminder, a daily check). To wait for a condition (CI, a deploy, a published version, a file), use the watch tool, not a timer, and never sleep or poll in bash.",
      "Until a timer fires, you show as waiting, not done, so end your turn after you set it.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([
          Type.Literal("create"),
          Type.Literal("list"),
          Type.Literal("cancel"),
        ])
      ),
      message: Type.Optional(
        Type.String({ description: "create: what you get when it fires" })
      ),
      in: Type.Optional(
        Type.String({ description: "A duration from now, for example 10m" })
      ),
      at: Type.Optional(Type.String({ description: "An ISO time" })),
      every: Type.Optional(
        Type.String({ description: "Repeat at this interval, for example 2h" })
      ),
      cron: Type.Optional(
        Type.String({ description: "A 5-field cron expression" })
      ),
      timezone: Type.Optional(
        Type.String({ description: "cron: an IANA time zone" })
      ),
      max_runs: Type.Optional(Type.Number({ minimum: 1 })),
      label: Type.Optional(
        Type.String({ description: "A short name; default the message" })
      ),
      id: Type.Optional(Type.String({ description: "cancel: the timer id" })),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const action = args.action ?? "create"
      if (action === "list")
        return textResult(await listTimers(api, "timer", context))
      if (action === "cancel") {
        if (!args.id) return errorResult("cancel needs id.")
        const services = await host.ready(context.abortSignal)
        return cancelTimer(services.harness, api, "timer", args.id, context)
      }
      const message = args.message?.trim()
      if (!message) return errorResult("create needs message.")
      const now = api.now()
      let at: number
      let everyMs: number | undefined
      try {
        at = firstFire(args, now)
        if (args.every) {
          everyMs = parseDuration(args.every)
          if (!everyMs || everyMs < MIN_EVERY_MS)
            return errorResult("every must be at least 10s.")
        }
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const label = (args.label ?? message).trim().slice(0, 120)
      const input: TimerInput = {
        message,
        label,
        at,
        ...(everyMs ? { everyMs } : {}),
        ...(args.cron && !everyMs ? { cron: args.cron } : {}),
        ...(args.timezone ? { timezone: args.timezone } : {}),
        ...(args.max_runs ? { maxRuns: Math.floor(args.max_runs) } : {}),
      }
      const id = await api.commit(async (tx) => {
        const draft = (await tx.doc(
          TimersDoc,
          api.conversationId
        )) as unknown as TimersState
        const existing = draft.byCall[api.callId]
        if (existing) return existing
        if (pendingCount(draft) >= MAX_PENDING) return undefined
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
          message,
          status: "pending",
          createdAt: now,
          nextAt: at,
          ...(everyMs ? { every: args.every } : {}),
          ...(input.cron ? { cron: input.cron } : {}),
          runs: 0,
        }) as TimerItem
        return taskId
      }, context)
      if (!id)
        return errorResult(
          `You have ${MAX_PENDING} pending timers and watches. Cancel one first.`
        )
      const repeat = everyMs
        ? `, then every ${args.every}`
        : input.cron
          ? `, then on cron "${input.cron}"`
          : ""
      return textResult(
        `Timer ${id} fires ${at - now < 1000 ? "now" : `in ${formatDuration(at - now)} (${new Date(at).toISOString()})`}${repeat}. End your turn; the message starts a new one.`,
        { details: { id, at } }
      )
    },
  })

  return defineExtension({
    name: "schedule",
    tools: [scheduleTool],
    tasks: [TimerTask],
  })
}
