import * as React from "react"
import { FileTextIcon, SquareIcon, SquareTerminalIcon } from "lucide-react"
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
import { openJobTerminal } from "@/features/pico/agent/events"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import {
  errorText,
  FinishedGroup,
  IconAction,
  relativeTime,
  TextDialog,
  useNow,
} from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type Job = {
  id: string
  name: string
  command: string
  status: "running" | "exited" | "stopped" | "lost" | "failed"
  exitCode?: number
  startedAt: number
  endedAt?: number
}

function statusClass(job: Job) {
  if (job.status === "running") return "bg-amber-500 animate-pulse"
  if (job.status === "exited" && job.exitCode === 0) return "bg-emerald-500"
  if (job.status === "stopped") return "bg-muted-foreground"
  return "bg-destructive"
}

function statusText(job: Job, now: number) {
  switch (job.status) {
    case "running":
      return `Running, started ${relativeTime(job.startedAt, now)}`
    case "exited":
      return `${job.exitCode === 0 ? "Finished" : `Failed with code ${job.exitCode}`} ${relativeTime(job.endedAt, now)}`
    case "stopped":
      return `Stopped ${relativeTime(job.endedAt, now)}`
    case "lost":
      return `Lost in a server restart ${relativeTime(job.endedAt, now)}`
    default:
      return `Could not start ${relativeTime(job.endedAt, now)}`
  }
}

function JobsSection({
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const machineId = useMachineId()
  const jobs = (state.jobs as Array<Job> | undefined) ?? []
  const now = useNow()
  const [logJob, setLogJob] = React.useState<Job | null>(null)
  const stop = (jobId: string) => {
    void postSessionJson(
      machineId,
      viewerContextId,
      sessionId,
      "/api/session/job/stop",
      {
        jobId,
      }
    ).catch((error: unknown) => toast.error(errorText(error)))
  }
  const row = (job: Job) => {
    const running = job.status === "running"
    return (
      <Item
        key={job.id}
        variant={running ? "outline" : "muted"}
        size="sm"
        className="py-2"
      >
        <ItemMedia>
          <span
            className={cn("size-2 rounded-full", statusClass(job))}
            aria-hidden="true"
          />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <TitleTooltip title={job.command}>
            <ItemTitle className="block truncate">{job.name}</ItemTitle>
          </TitleTooltip>
          <ItemDescription>{statusText(job, now)}</ItemDescription>
        </ItemContent>
        <ItemActions className="gap-0.5">
          {running ? (
            <IconAction
              label="Show in the terminal panel"
              icon={<SquareTerminalIcon />}
              onClick={() => openJobTerminal(job.id)}
            />
          ) : null}
          <IconAction
            label="Show the output"
            icon={<FileTextIcon />}
            onClick={() => setLogJob(job)}
          />
          {running ? (
            <IconAction
              label="Stop the job"
              icon={<SquareIcon />}
              tone="destructive"
              onClick={() => stop(job.id)}
            />
          ) : null}
        </ItemActions>
      </Item>
    )
  }
  const active = jobs.filter((job) => job.status === "running")
  const finished = jobs.filter((job) => job.status !== "running")
  return (
    <>
      <div className="space-y-1.5">
        {active.length ? (
          <ItemGroup className="gap-1.5">{active.map(row)}</ItemGroup>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">No job runs now.</p>
        )}
        <FinishedGroup count={finished.length}>
          <ItemGroup className="gap-1.5">{finished.map(row)}</ItemGroup>
        </FinishedGroup>
      </div>
      {logJob ? (
        <TextDialog
          open
          onOpenChange={(open) => {
            if (!open) setLogJob(null)
          }}
          title={`Output of ${logJob.name}`}
          path="/api/session/job/log"
          searchParams={{ jobId: logJob.id, tail: 2000 }}
          refreshMs={logJob.status === "running" ? 2000 : undefined}
          sessionId={sessionId}
          viewerContextId={viewerContextId}
        />
      ) : null}
    </>
  )
}

registerAgentSection({
  key: "jobs",
  title: "Background jobs",
  order: 40,
  visible: (state) => Array.isArray(state.jobs) && state.jobs.length > 0,
  summary(state) {
    const jobs = (state.jobs as Array<Job> | undefined) ?? []
    const running = jobs.filter((job) => job.status === "running").length
    return running ? `${running} running` : undefined
  },
  Component: JobsSection,
})

registerToolRenderer("job_start", {
  summary(block) {
    const args = toolArgs(block)
    const id = toolDetails<{ id: string }>(block).id
    const command = typeof args.command === "string" ? args.command : ""
    return [id, command].filter(Boolean).join(" · ")
  },
})

for (const name of ["job_status", "job_output", "job_stop"]) {
  registerToolRenderer(name, {
    summary(block) {
      const id = toolArgs(block).id
      return typeof id === "string" ? id : "all jobs"
    },
  })
}
