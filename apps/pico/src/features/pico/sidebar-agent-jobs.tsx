import * as React from "react"

import { TitleTooltip } from "@/components/ui/tooltip"
import type { AgentJob, AgentListEntry } from "@/lib/pico/api"
import {
  parseSeenJobs,
  seenJobsSnapshot,
  subscribeSeenJobs,
} from "@/lib/pico/storage"
import { cn } from "@/lib/utils"

/**
 * The jobs of an agent as dots at the end of its sidebar row:
 * - green: the process runs (a dev server, a watcher).
 * - sky, pulsing: the process waits for input.
 * - red: the process ended with an error that the agent did not hear of.
 *   The dot stays until this device shows the job in the terminal panel.
 */

/** The most dots that a row shows. More jobs show as "+N". */
const MAX_DOTS = 3

/** The machine of the rows and what a click on a dot does. */
export type SidebarAgentJobsActions = {
  machineId: string
  /** Show the job, or only its agent when the job cannot show here. */
  openJob: (entry: AgentListEntry, job: AgentJob) => void
}

export const SidebarAgentJobsContext =
  React.createContext<SidebarAgentJobsActions | null>(null)

/** The jobs that show a dot: running jobs, and failures not seen yet. */
export function useShownAgentJobs(
  machineId: string | undefined,
  jobs: Array<AgentJob> | undefined
) {
  const snapshot = React.useSyncExternalStore(
    subscribeSeenJobs,
    () => (machineId ? seenJobsSnapshot(machineId) : ""),
    () => ""
  )
  return React.useMemo(() => {
    const seen = parseSeenJobs(snapshot)
    return (jobs ?? []).filter((job) => {
      if (job.state !== "failed") return true
      const seenAt = seen[job.id] ?? 0
      return job.endedAt ? seenAt < job.endedAt : seenAt === 0
    })
  }, [jobs, snapshot])
}

const STATE_LABELS: Record<AgentJob["state"], string> = {
  running: "running",
  input: "waits for input",
  failed: "failed",
}

function jobLabel(job: AgentJob) {
  return `${job.name}: ${STATE_LABELS[job.state]}`
}

function dotClassName(state: AgentJob["state"]) {
  switch (state) {
    case "running":
      return "bg-success"
    case "input":
      return "animate-pulse bg-sky-500"
    case "failed":
      return "bg-destructive"
  }
}

/**
 * The dots of an agent's jobs. With `placeholder`, an invisible copy that
 * keeps space in the row for the real dots, which sit on top of the row.
 */
export function SidebarAgentJobDots({
  entry,
  placeholder = false,
  className,
}: {
  entry: AgentListEntry
  placeholder?: boolean
  className?: string
}) {
  const actions = React.useContext(SidebarAgentJobsContext)
  const jobs = useShownAgentJobs(actions?.machineId, entry.jobs)
  if (jobs.length === 0) return null
  // Problems first: a job that needs input or failed must show.
  const ordered = [
    ...jobs.filter((job) => job.state !== "running"),
    ...jobs.filter((job) => job.state === "running"),
  ]
  const shown = ordered.slice(0, MAX_DOTS)
  const rest = ordered.slice(MAX_DOTS)

  if (placeholder) {
    return (
      <span
        aria-hidden="true"
        className={cn("invisible flex shrink-0 items-center", className)}
      >
        {shown.map((job) => (
          <span key={job.id} className="p-0.5">
            <span className="block size-1.5" />
          </span>
        ))}
        {rest.length > 0 ? (
          <span className="pl-0.5 text-[11px]">+{rest.length}</span>
        ) : null}
      </span>
    )
  }

  return (
    <span className={cn("flex shrink-0 items-center", className)}>
      {shown.map((job) => (
        <TitleTooltip key={job.id} title={jobLabel(job)} side="right">
          <button
            type="button"
            aria-label={`Show job ${jobLabel(job)}`}
            className="rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              actions?.openJob(entry, job)
            }}
          >
            <span
              className={cn(
                "block size-1.5 rounded-full",
                dotClassName(job.state)
              )}
            />
          </button>
        </TitleTooltip>
      ))}
      {rest.length > 0 ? (
        <TitleTooltip
          title={`${rest.length} more jobs`}
          rows={rest.map((job) => ({ title: jobLabel(job) }))}
          side="right"
        >
          <span className="pl-0.5 text-[11px] text-sidebar-foreground/50">
            +{rest.length}
          </span>
        </TitleTooltip>
      ) : null}
    </span>
  )
}
