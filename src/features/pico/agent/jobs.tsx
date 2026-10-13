import * as React from "react"
import { FileTextIcon, SquareIcon, SquareTerminalIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { openJobTerminal } from "@/features/pico/agent/events"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import {
  errorText,
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
  return "bg-destructive"
}

function statusText(job: Job, now: number) {
  switch (job.status) {
    case "running":
      return `running, started ${relativeTime(job.startedAt, now)}`
    case "exited":
      return `exit ${job.exitCode} · ${relativeTime(job.endedAt, now)}`
    default:
      return `${job.status} · ${relativeTime(job.endedAt, now)}`
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
  const jobs = (state.jobs as Array<Job> | undefined) ?? []
  const now = useNow()
  const [logJob, setLogJob] = React.useState<Job | null>(null)
  const stop = (jobId: string) => {
    void postSessionJson(viewerContextId, sessionId, "/api/session/job/stop", {
      jobId,
    }).catch((error: unknown) => toast.error(errorText(error)))
  }
  return (
    <>
      <ul className="space-y-1.5">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm"
          >
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                statusClass(job)
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={job.command}>
                {job.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {statusText(job, now)}
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5">
              {job.status === "running" ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Open in the terminal panel"
                  onClick={() => openJobTerminal(job.id)}
                >
                  <SquareTerminalIcon />
                </Button>
              ) : null}
              <Button
                size="icon-xs"
                variant="ghost"
                title="Show the log"
                onClick={() => setLogJob(job)}
              >
                <FileTextIcon />
              </Button>
              {job.status === "running" ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Stop"
                  onClick={() => stop(job.id)}
                >
                  <SquareIcon />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {logJob ? (
        <TextDialog
          open
          onOpenChange={(open) => {
            if (!open) setLogJob(null)
          }}
          title={`${logJob.name} (${logJob.id})`}
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
  title: "Jobs",
  order: 40,
  visible: (state) => Array.isArray(state.jobs) && state.jobs.length > 0,
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
