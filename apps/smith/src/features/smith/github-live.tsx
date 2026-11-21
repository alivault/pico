/**
 * Live GitHub data and the agent wake (server `github-watch.ts`).
 *
 * - `useGitHubLive`: while the page shows GitHub data of a folder, tell the
 *   server about every minute. The server polls the repository and sends
 *   `github_changed` when its pull requests change. A hidden page does not
 *   tell it, so the server stops after a few minutes.
 * - `WakeMenu`: a bell that turns on the wake of an agent for the pull
 *   request of its branch.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellIcon, BellRingIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useMachineFeature } from "@/features/smith/machine-store"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import type { GhWakeEvents, GhWakeResponse } from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"
import { cn } from "@/lib/utils"

const VIEW_INTERVAL_MS = 60_000

type GhWakeData = Extract<GhWakeResponse, { ok: true }>

function pageVisible() {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  )
}

/** Keep the server polling GitHub for `cwd` while this shows. */
export function useGitHubLive({
  viewerContextId,
  cwd,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  enabled: boolean
}) {
  const machineId = useMachineId()
  const available = useMachineFeature("github-live")
  const active = Boolean(enabled && available && viewerContextId && cwd)
  React.useEffect(() => {
    if (!active) return
    let last = 0
    const view = () => {
      if (!pageVisible() || Date.now() - last < VIEW_INTERVAL_MS / 2) return
      last = Date.now()
      void fetchJson(
        buildRequestUrl("/api/gh-watch/view", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ).catch(() => undefined)
    }
    view()
    const timer = window.setInterval(view, VIEW_INTERVAL_MS)
    document.addEventListener("visibilitychange", view)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", view)
    }
  }, [active, machineId, viewerContextId, cwd])
}

export function wakeQueryKey(viewerContextId: string, agentId: string) {
  return ["smith", "gh-wake", viewerContextId, agentId] as const
}

export function useWake({
  viewerContextId,
  agentId,
  enabled,
}: {
  viewerContextId: string
  agentId: string | undefined
  enabled: boolean
}) {
  const machineId = useMachineId()
  const available = useMachineFeature("github-live")
  return useQuery({
    queryKey: wakeQueryKey(viewerContextId, agentId ?? ""),
    queryFn: async () =>
      (
        await fetchJson<GhWakeData>(
          buildRequestUrl(
            `/api/gh-wake?${new URLSearchParams({ agentId: agentId ?? "" }).toString()}`,
            { machineId, contextId: viewerContextId }
          )
        )
      ).wake,
    enabled: Boolean(enabled && available && viewerContextId && agentId),
    staleTime: 60_000,
    retry: false,
  })
}

const EVENT_LABELS: Array<[keyof GhWakeEvents, string]> = [
  ["ci", "CI fails"],
  ["comments", "A new review comment arrives"],
  ["state", "The PR is merged or closed"],
]

export function wakeTitle(events: GhWakeEvents | undefined) {
  const on = EVENT_LABELS.filter(([key]) => events?.[key]).map(([, label]) =>
    label.toLowerCase()
  )
  return on.length > 0
    ? `Wakes the agent when ${on.join(", or ")}.`
    : "Wake the agent on events of this pull request."
}

/** A bell with the wake events of an agent for pull request `number`. */
export function WakeMenu({
  viewerContextId,
  agentId,
  number,
  className,
  label,
}: {
  viewerContextId: string
  agentId: string
  number: number
  className?: string
  /** Text after the bell, for example in the GitHub tab. */
  label?: boolean
}) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const available = useMachineFeature("github-live")
  const wake = useWake({ viewerContextId, agentId, enabled: true })
  const current = wake.data?.number === number ? wake.data.events : undefined
  const on = Boolean(
    current && (current.ci || current.comments || current.state)
  )
  const change = useMutation({
    mutationFn: async (events: GhWakeEvents) =>
      (
        await fetchJson<GhWakeData>(
          buildRequestUrl("/api/gh-wake", {
            machineId,
            contextId: viewerContextId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentId, number, events }),
          }
        )
      ).wake,
    onSuccess: (data) =>
      queryClient.setQueryData(wakeQueryKey(viewerContextId, agentId), data),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not change the wake")),
  })
  if (!available) return null
  const events: GhWakeEvents = current ?? {
    ci: false,
    comments: false,
    state: false,
  }
  const Icon = on ? BellRingIcon : BellIcon
  return (
    <DropdownMenu>
      <TitleTooltip title={wakeTitle(current)}>
        <DropdownMenuTrigger
          aria-label="Wake this agent"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-sm text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            on ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            className
          )}
        >
          <Icon className="size-3" />
          {label ? <span>{on ? "Wake on" : "Wake"}</span> : null}
        </DropdownMenuTrigger>
      </TitleTooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Wake this agent when</DropdownMenuLabel>
          {EVENT_LABELS.map(([key, text]) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={events[key]}
              disabled={change.isPending}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                change.mutate({ ...events, [key]: checked })
              }
            >
              {text}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
