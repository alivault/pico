import { AlarmClockIcon, EyeIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

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
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import {
  errorText,
  FinishedGroup,
  IconAction,
  relativeTime,
  useNow,
} from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
} from "@/features/pico/tool-renderers/registry"
import { useMachineId } from "@/lib/pico/machine-context"

type TimerItem = {
  id: string
  kind: "timer" | "watch"
  label: string
  message: string
  status: "pending" | "done" | "cancelled" | "failed"
  nextAt?: number
  every?: string
  cron?: string
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

function describe(item: TimerItem, now: number) {
  const parts: Array<string> = []
  if (item.status === "pending") {
    parts.push(
      item.nextAt && item.nextAt > now
        ? `${item.kind === "watch" ? "Next check" : "Fires"} ${relativeTime(item.nextAt, now)}`
        : "Due now"
    )
  } else {
    parts.push(STATUS_TEXT[item.status])
  }
  if (item.every) parts.push(`every ${item.every}`)
  if (item.cron) parts.push(`cron ${item.cron}`)
  if (item.runs)
    parts.push(
      `${item.runs} ${item.kind === "watch" ? "check" : "run"}${item.runs === 1 ? "" : "s"}`
    )
  return parts.join(" · ")
}

function TimersSection({
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const machineId = useMachineId()
  const items = (state.timers as Array<TimerItem> | undefined) ?? []
  const now = useNow()
  const cancel = (id: string) => {
    void postSessionJson(
      machineId,
      viewerContextId,
      sessionId,
      "/api/session/timer/cancel",
      { id }
    ).catch((error: unknown) => toast.error(errorText(error)))
  }
  const row = (item: TimerItem) => {
    const Icon = item.kind === "watch" ? EyeIcon : AlarmClockIcon
    const pending = item.status === "pending"
    return (
      <Item
        key={item.id}
        variant={pending ? "outline" : "muted"}
        size="sm"
        className="py-2"
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
          <ItemActions>
            <IconAction
              label={item.kind === "watch" ? "Stop watching" : "Cancel timer"}
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
        <ItemGroup className="gap-1.5">{active.map(row)}</ItemGroup>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">Nothing waits now.</p>
      )}
      <FinishedGroup count={finished.length}>
        <ItemGroup className="gap-1.5">{finished.map(row)}</ItemGroup>
      </FinishedGroup>
    </div>
  )
}

registerAgentSection({
  key: "timers",
  title: "Timers and watches",
  order: 30,
  visible: (state) => Array.isArray(state.timers) && state.timers.length > 0,
  summary(state) {
    const items = (state.timers as Array<TimerItem> | undefined) ?? []
    const waiting = items.filter((item) => item.status === "pending").length
    return waiting ? `${waiting} waiting` : undefined
  },
  Component: TimersSection,
})

registerToolRenderer("schedule", {
  summary(block) {
    const args = toolArgs(block)
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
    const args = toolArgs(block)
    const check = (args.check ?? {}) as Record<string, unknown>
    const target = [check.command, check.url, check.path, check.pr].find(
      (value) => typeof value === "string"
    ) as string | undefined
    return [
      typeof check.type === "string" ? check.type : "",
      target,
      typeof check.until === "string" ? `until ${check.until}` : "",
    ]
      .filter(Boolean)
      .join(" ")
  },
})
