import { AlarmClockIcon, EyeIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import { errorText, relativeTime, useNow } from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"

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

function TimersSection({
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const items = (state.timers as Array<TimerItem> | undefined) ?? []
  const now = useNow()
  const cancel = (id: string) => {
    void postSessionJson(
      viewerContextId,
      sessionId,
      "/api/session/timer/cancel",
      {
        id,
      }
    ).catch((error: unknown) => toast.error(errorText(error)))
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const Icon = item.kind === "watch" ? EyeIcon : AlarmClockIcon
        const pending = item.status === "pending"
        return (
          <li
            key={item.id}
            className={cn(
              "group/timer flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm",
              !pending && "opacity-60"
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate" title={item.message}>
                {item.label}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {pending ? (
                  <span>
                    {item.nextAt && item.nextAt > now
                      ? `${item.kind === "watch" ? "checks" : "fires"} ${relativeTime(item.nextAt, now)}`
                      : "due now"}
                  </span>
                ) : (
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    {item.status}
                  </Badge>
                )}
                {item.every ? <span>· every {item.every}</span> : null}
                {item.cron ? <span>· cron {item.cron}</span> : null}
                {item.runs ? (
                  <span>
                    · {item.runs} {item.kind === "watch" ? "check" : "run"}
                    {item.runs === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              {item.lastOutput && item.kind === "watch" ? (
                <pre className="mt-1 max-h-16 overflow-hidden text-[11px] whitespace-pre-wrap text-muted-foreground">
                  {item.lastOutput}
                </pre>
              ) : null}
            </div>
            {pending ? (
              <Button
                size="icon-xs"
                variant="ghost"
                title="Cancel"
                onClick={() => cancel(item.id)}
              >
                <XIcon />
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

registerAgentSection({
  key: "timers",
  title: "Timers and watches",
  order: 30,
  visible: (state) => Array.isArray(state.timers) && state.timers.length > 0,
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
