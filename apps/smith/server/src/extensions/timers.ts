/**
 * The `smith.timers` document: the timers (`schedule.ts`) and watches
 * (`watch.ts`) of a conversation, for the tools' list action, the Agent
 * panel, and the agent's waiting label (`waiting.ts`).
 *
 * Each item is a background task owned by the conversation. Its ID is the
 * task ID, so cancel aborts that task, and the task's abort handler marks the
 * item cancelled.
 */
import type { Context } from "@earendil-works/chord/context"
import {
  defineDoc,
  type ConversationId,
  type DocumentReader,
  type Harness,
  type TaskId,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable"

import {
  errorResult,
  formatDuration,
  json,
  registerState,
  textResult,
} from "./util.ts"

export type TimerItem = {
  id: string
  kind: "timer" | "watch"
  label: string
  message: string
  /** `failed`: a watch that timed out. */
  status: "pending" | "done" | "cancelled" | "failed"
  createdAt: number
  /** Next time the timer fires, or the watch checks. */
  nextAt?: number
  every?: string
  cron?: string
  /** When a watch gives up. */
  timeoutAt?: number
  runs: number
  lastAt?: number
  /** The newest check result of a watch. */
  lastOutput?: string
  endedAt?: number
}

export type TimersState = {
  items: Record<string, TimerItem>
  /** Tool call ID to task ID, so a rerun does not create a second item. */
  byCall: Record<string, string>
}

export const TimersDoc = defineDoc<TimersState>({
  kind: "smith.timers",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {}, byCall: {} }),
})

const KEEP_FINISHED = 20

/** The most pending timers and watches of one agent. */
export const MAX_PENDING = 20

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

/** The number of pending items of a kind in a draft or snapshot. */
export function pendingCount(
  state: TimersState | undefined,
  kind?: TimerItem["kind"]
) {
  return Object.values(state?.items ?? {}).filter(
    (item) => item.status === "pending" && (!kind || item.kind === kind)
  ).length
}

export function describeTimer(item: TimerItem, now = Date.now()) {
  const when =
    item.status === "pending" && item.nextAt
      ? item.nextAt <= now
        ? item.kind === "watch"
          ? "checks now"
          : "due now"
        : `${item.kind === "watch" ? "next check" : "fires"} in ${formatDuration(item.nextAt - now)}`
      : item.status === "failed" && item.kind === "watch"
        ? "timed out"
        : item.status
  const repeat =
    item.kind === "watch"
      ? item.every
        ? `, every ${item.every}`
        : ""
      : item.every
        ? `, every ${item.every}`
        : item.cron
          ? `, cron "${item.cron}"`
          : ""
  const timeout =
    item.status === "pending" && item.timeoutAt
      ? `, gives up in ${formatDuration(Math.max(0, item.timeoutAt - now))}`
      : ""
  const runs = item.runs
    ? `, ${item.runs} ${item.kind === "watch" ? "check(s)" : "run(s)"}`
    : ""
  return `${item.id} [${item.kind}] ${item.label} — ${when}${repeat}${timeout}${runs}`
}

/** The list action of the schedule and watch tools. */
export async function listTimers(
  api: Pick<ToolExecutionApi, "snapshot" | "conversationId" | "now">,
  kind: TimerItem["kind"],
  context: Context
) {
  const state = await api.snapshot(TimersDoc, api.conversationId, context)
  const items = Object.values(state?.items ?? {})
    .filter((item) => item.kind === kind)
    .sort((left, right) => left.createdAt - right.createdAt)
  if (items.length === 0) return kind === "timer" ? "No timers." : "No watches."
  const now = api.now()
  const open = items.filter((item) => item.status === "pending")
  const finished = items.filter((item) => item.status !== "pending")
  const lines = open.map((item) => {
    const line = describeTimer(item, now)
    return item.kind === "watch" && item.lastOutput
      ? `${line}\n  last check:\n${item.lastOutput.replace(/^/gm, "    ")}`
      : line
  })
  if (finished.length)
    lines.push(
      `(${finished.length} finished: ${finished
        .slice(-5)
        .map((item) => `${item.id} ${item.status}`)
        .join(", ")})`
    )
  return lines.join("\n")
}

function taskIdOf(id: string) {
  return Number(id) as unknown as TaskId
}

/** Cancel a timer or watch of the calling conversation. */
export async function cancelTimer(
  harness: Pick<Harness, "abortTask">,
  api: Pick<ToolExecutionApi, "snapshot" | "conversationId">,
  kind: TimerItem["kind"],
  id: string,
  context: Context
) {
  const state = await api.snapshot(TimersDoc, api.conversationId, context)
  const item = state?.items[id.trim()]
  if (!item || item.kind !== kind)
    return errorResult(`No ${kind} with id ${id}.`)
  if (item.status !== "pending")
    return textResult(`${item.kind} ${item.id} is already ${item.status}.`)
  await harness.abortTask(taskIdOf(item.id), context)
  return textResult(`Cancelled ${item.kind} ${item.id}.`)
}

/**
 * Cancel one pending item (`id`) or all pending items of a conversation, for
 * the Cancel action in the web client and for an archived agent. Returns the
 * IDs it cancelled.
 */
export async function cancelConversationTimers(
  harness: Pick<Harness, "abortTask" | "snapshot">,
  conversationId: ConversationId,
  context: Context,
  id?: string
) {
  const state = await harness.snapshot(TimersDoc, conversationId, context)
  const pending = Object.values(state?.items ?? {}).filter(
    (item) => item.status === "pending" && (id === undefined || item.id === id)
  )
  for (const item of pending)
    await harness.abortTask(taskIdOf(item.id), context)
  return pending.map((item) => item.id)
}

/** Read the pending items and the newest finished ones, for the web client. */
export async function readTimers(
  reader: Pick<DocumentReader, "snapshot">,
  conversationId: ConversationId,
  context: Context
) {
  const state = await reader.snapshot(TimersDoc, conversationId, context)
  const items = Object.values(state?.items ?? {})
  if (items.length === 0) return undefined
  const open = items
    .filter((item) => item.status === "pending")
    .sort((left, right) => (left.nextAt ?? 0) - (right.nextAt ?? 0))
  const recent = items
    .filter((item) => item.status !== "pending")
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
    .slice(0, 5)
  return json([...open, ...recent])
}

registerState({
  key: "timers",
  kinds: ["smith.timers"],
  read: readTimers,
})
