/**
 * Timers (the `schedule` tool) and watches (the `watch` tool): the Agent
 * panel section, the chip above the composer, and the tool renderers. Old
 * transcripts have `schedule` calls with a `watch` action and a `check`
 * object; the renderers read both forms.
 */
import { AlarmClockIcon, EyeIcon, XIcon } from "lucide-react"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { TitleTooltip } from "@/components/ui/tooltip"
import { REVEAL_ON_HOVER } from "@/features/smith/agent/todo"
import { registerAgentSection } from "@/features/smith/agent/agent-panel"
import {
  postAgentJson,
  useAgentExtensions,
} from "@/features/smith/agent/agent-extensions"
import {
  errorText,
  FinishedGroup,
  IconAction,
  relativeTime,
  useNow,
} from "@/features/smith/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  type ToolRendererProps,
} from "@/features/smith/tool-renderers/registry"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"

type TimerItem = {
  id: string
  kind: "timer" | "watch"
  label: string
  message: string
  status: "pending" | "done" | "cancelled" | "failed"
  nextAt?: number
  every?: string
  cron?: string
  timeoutAt?: number
  runs: number
  lastAt?: number
  lastOutput?: string
  endedAt?: number
}

const STATUS_TEXT: Record<TimerItem["status"], string> = {
  pending: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
  failed: "Timed out",
}

function timersOf(state: Record<string, unknown> | undefined) {
  return Array.isArray(state?.timers) ? (state.timers as Array<TimerItem>) : []
}

/** "fires in 5m", "next check in 20s", or "due now". */
function timeLeft(item: TimerItem, now: number) {
  if (!item.nextAt || item.nextAt <= now)
    return item.kind === "watch" ? "checks now" : "due now"
  return `${item.kind === "watch" ? "next check" : "fires"} ${relativeTime(item.nextAt, now)}`
}

function describe(item: TimerItem, now: number) {
  const parts: Array<string> = []
  if (item.status === "pending") parts.push(timeLeft(item, now))
  else parts.push(STATUS_TEXT[item.status])
  if (item.every) parts.push(`every ${item.every}`)
  if (item.cron) parts.push(`cron ${item.cron}`)
  if (item.status === "pending" && item.timeoutAt)
    parts.push(`gives up ${relativeTime(item.timeoutAt, now)}`)
  if (item.runs)
    parts.push(
      `${item.runs} ${item.kind === "watch" ? "check" : "run"}${item.runs === 1 ? "" : "s"}`
    )
  return parts.join(" · ")
}

function useCancelTimer(viewerContextId: string, agentId: string | undefined) {
  const machineId = useMachineId()
  return (id: string) => {
    void postAgentJson(
      machineId,
      viewerContextId,
      agentId,
      "/api/agent/timer/cancel",
      { id }
    ).catch((error: unknown) => toast.error(errorText(error)))
  }
}

function cancelLabel(item: TimerItem) {
  return item.kind === "watch" ? "Stop watching" : "Cancel the timer"
}

function TimersSection({
  agentId,
  state,
  viewerContextId,
}: {
  agentId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const items = timersOf(state)
  const now = useNow(5_000)
  const cancel = useCancelTimer(viewerContextId, agentId)
  const row = (item: TimerItem) => {
    const Icon = item.kind === "watch" ? EyeIcon : AlarmClockIcon
    const pending = item.status === "pending"
    return (
      <Item
        key={item.id}
        size="sm"
        className="group/row gap-2 px-1.5 py-1.5 hover:bg-muted/50"
      >
        <ItemMedia variant="icon">
          <Icon aria-label={item.kind === "watch" ? "Watch" : "Timer"} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <TitleTooltip title={`Message: ${item.message}`}>
            <ItemTitle className="block truncate">{item.label}</ItemTitle>
          </TitleTooltip>
          <ItemDescription>{describe(item, now)}</ItemDescription>
          {item.lastOutput && item.kind === "watch" && pending ? (
            <pre className="mt-1 line-clamp-3 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {item.lastOutput}
            </pre>
          ) : null}
        </ItemContent>
        {pending ? (
          <ItemActions className={REVEAL_ON_HOVER}>
            <IconAction
              label={cancelLabel(item)}
              icon={<XIcon />}
              tone="destructive"
              onClick={() => cancel(item.id)}
            />
          </ItemActions>
        ) : null}
      </Item>
    )
  }
  const active = items.filter((item) => item.status === "pending")
  const finished = items.filter((item) => item.status !== "pending")
  return (
    <div className="space-y-1.5">
      {active.length ? (
        <ItemGroup className="gap-0.5">{active.map(row)}</ItemGroup>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">Nothing waits now.</p>
      )}
      <FinishedGroup count={finished.length}>
        <ItemGroup className="gap-0.5">{finished.map(row)}</ItemGroup>
      </FinishedGroup>
    </div>
  )
}

registerAgentSection({
  key: "timers",
  title: "Timers and watches",
  order: 25,
  visible: (state) => timersOf(state).length > 0,
  summary(state) {
    const waiting = timersOf(state).filter(
      (item) => item.status === "pending"
    ).length
    return waiting ? `${waiting} waiting` : undefined
  },
  Component: TimersSection,
})

/**
 * A chip above the composer while the agent waits on a timer or a watch: the
 * next one, with its time left and a Cancel button.
 */
export function TimersChip({
  agentId,
  viewerContextId,
}: {
  agentId: string
  viewerContextId: string
}) {
  const query = useAgentExtensions(viewerContextId, agentId)
  const now = useNow(5_000)
  const cancel = useCancelTimer(viewerContextId, agentId)
  const pending = timersOf(query.data)
    .filter((item) => item.status === "pending")
    .sort((left, right) => (left.nextAt ?? 0) - (right.nextAt ?? 0))
  const next = pending[0]
  if (!next) return null
  const Icon = next.kind === "watch" ? EyeIcon : AlarmClockIcon
  const more = pending.length - 1
  return (
    <div className="mb-1.5 flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-background/90 pr-0.5 pl-3 text-xs text-muted-foreground shadow-sm backdrop-blur">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <TitleTooltip title={`Message: ${next.message}`}>
        <span className="min-w-0 truncate">
          <span className="text-foreground">{next.label}</span>
          {` · ${timeLeft(next, now)}`}
          {more > 0 ? ` · ${more} more` : ""}
        </span>
      </TitleTooltip>
      <IconAction
        size="icon-xs"
        className="rounded-full"
        label={cancelLabel(next)}
        icon={<XIcon />}
        tone="destructive"
        onClick={() => cancel(next.id)}
      />
    </div>
  )
}

function watchSummary(block: ToolRendererProps["block"]) {
  const args = toolArgs(block)
  // Old calls: schedule { action: "watch", check: { type, ... } }.
  const check =
    args.check && typeof args.check === "object"
      ? (args.check as Record<string, unknown>)
      : args
  const kind = check.kind ?? check.type
  const target = [check.command, check.url, check.path, check.pr].find(
    (value) => typeof value === "string"
  ) as string | undefined
  return [
    typeof kind === "string" ? kind : "",
    target,
    typeof check.until === "string" ? `until ${check.until}` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

function actionSummary(args: Record<string, unknown>) {
  if (args.action === "list") return "list"
  if (args.action === "cancel")
    return `cancel ${typeof args.id === "string" ? args.id : ""}`.trim()
  return undefined
}

registerToolRenderer("schedule", {
  summary(block) {
    const args = toolArgs(block)
    const action = actionSummary(args)
    if (action) return action
    if (args.action === "watch" || args.check) return watchSummary(block)
    const when =
      typeof args.in === "string"
        ? `in ${args.in}`
        : typeof args.at === "string"
          ? `at ${args.at}`
          : typeof args.every === "string"
            ? `every ${args.every}`
            : typeof args.cron === "string"
              ? `cron ${args.cron}`
              : ""
    const label =
      typeof args.label === "string"
        ? args.label
        : typeof args.message === "string"
          ? args.message
          : ""
    return [when, label].filter(Boolean).join(" · ")
  },
})

registerToolRenderer("watch", {
  summary(block) {
    return actionSummary(toolArgs(block)) ?? watchSummary(block)
  },
})
