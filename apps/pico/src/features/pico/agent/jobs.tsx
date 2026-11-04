import * as React from "react"
import {
  CornerDownLeftIcon,
  FileTextIcon,
  KeyRoundIcon,
  SquareIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { toast } from "@/lib/pico/toast"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TitleTooltip } from "@/components/ui/tooltip"
import { FADE_UNDER_ACTIONS, REVEAL_ON_HOVER } from "@/features/pico/agent/todo"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { openJobTerminal } from "@/features/pico/agent/events"
import {
  jobPrompt,
  useAgentJobs,
  type AgentJob,
} from "@/features/pico/agent/job-state"
import { postAgentJson } from "@/features/pico/agent/agent-extensions"
import {
  useTrackWaitingCard,
  waitingCardKey,
} from "@/features/pico/agent/waiting-cards"
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
  useToolRenderContext,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import {
  formatBytes,
  useMachineResources,
} from "@/features/pico/resources-dialog"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type Job = AgentJob

function statusClass(job: Job) {
  const prompt = jobPrompt(job)
  if (prompt && !prompt.quiet) return "animate-pulse bg-sky-500"
  // The same colors as the job dots in the sidebar and the terminal tabs:
  // green runs, gray ended, red failed. Only a wait for input pulses.
  if (job.status === "running") return "bg-success"
  if (job.status === "exited" && job.exitCode === 0)
    return "bg-muted-foreground/50"
  if (job.status === "stopped") return "bg-muted-foreground"
  return "bg-destructive"
}

function statusText(job: Job, now: number) {
  switch (job.status) {
    case "running": {
      const prompt = jobPrompt(job)
      return prompt
        ? prompt.text
        : `Running, started ${relativeTime(job.startedAt, now)}`
    }
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
  agentId,
  state,
  viewerContextId,
}: {
  agentId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const machineId = useMachineId()
  const jobs = (state.jobs as Array<Job> | undefined) ?? []
  const now = useNow()
  // The memory of each running job, with every process it started.
  const resources = useMachineResources(
    viewerContextId,
    jobs.some((job) => job.status === "running")
  )
  const memoryOf = (jobId: string) =>
    resources.data?.jobs.find((item) => item.id === jobId)?.memory
  const [logJob, setLogJob] = React.useState<Job | null>(null)
  const stop = (jobId: string) => {
    void postAgentJson(
      machineId,
      viewerContextId,
      agentId,
      "/api/agent/job/stop",
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
        size="sm"
        className="group/row relative gap-2 px-1.5 py-1.5 hover:bg-muted/50"
      >
        <ItemMedia>
          <span
            className={cn("size-2 rounded-full", statusClass(job))}
            aria-hidden="true"
          />
        </ItemMedia>
        <ItemContent
          className={cn("min-w-0", FADE_UNDER_ACTIONS)}
          style={
            {
              // Each action is 1.75rem wide, with a 0.125rem gap between.
              "--actions-width": running ? "5.5rem" : "1.75rem",
            } as React.CSSProperties
          }
        >
          <TitleTooltip title={job.command}>
            <ItemTitle className="block truncate">{job.name}</ItemTitle>
          </TitleTooltip>
          <ItemDescription>
            {statusText(job, now)}
            {running && memoryOf(job.id) !== undefined
              ? ` · ${formatBytes(memoryOf(job.id))}`
              : ""}
          </ItemDescription>
        </ItemContent>
        <ItemActions
          className={cn(
            "absolute top-1/2 right-1.5 -translate-y-1/2 gap-0.5 group-focus-within/row:opacity-100",
            REVEAL_ON_HOVER
          )}
        >
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
          <ItemGroup className="gap-0.5">{active.map(row)}</ItemGroup>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">No job runs now.</p>
        )}
        <FinishedGroup count={finished.length}>
          <ItemGroup className="gap-0.5">{finished.map(row)}</ItemGroup>
        </FinishedGroup>
      </div>
      {logJob ? (
        <TextDialog
          open
          onOpenChange={(open) => {
            if (!open) setLogJob(null)
          }}
          title={`Output of ${logJob.name}`}
          path="/api/agent/job/log"
          searchParams={{ jobId: logJob.id, tail: 2000 }}
          refreshMs={logJob.status === "running" ? 2000 : undefined}
          agentId={agentId}
          viewerContextId={viewerContextId}
        />
      ) : null}
    </>
  )
}

registerAgentSection({
  key: "jobs",
  title: "Background jobs",
  order: 20,
  visible: (state) => Array.isArray(state.jobs) && state.jobs.length > 0,
  busy: (state) =>
    ((state.jobs as Array<Job> | undefined) ?? []).some(
      (job) => job.status === "running"
    ),
  summary(state) {
    const jobs = (state.jobs as Array<Job> | undefined) ?? []
    const waiting = jobs.filter((job) => {
      const prompt = jobPrompt(job)
      return prompt && !prompt.quiet
    }).length
    if (waiting) return `${waiting} waiting for input`
    const running = jobs.filter((job) => job.status === "running").length
    return running ? `${running} running` : undefined
  },
  Component: JobsSection,
})

const InlineJobTerminal = React.lazy(
  () => import("@/features/pico/agent/inline-job-terminal")
)

type TerminalInput = (data: string) => boolean

/**
 * A password field for a job that asks for a secret (echo off). What the
 * user types goes to the job's terminal, with Enter. It does not go to the
 * conversation or to the agent.
 */
function JobSecretInput({
  prompt,
  inputRef,
  showTerminal,
  onShowTerminalChange,
}: {
  prompt: string
  inputRef: React.RefObject<TerminalInput | null>
  showTerminal: boolean
  onShowTerminalChange: (show: boolean) => void
}) {
  const [value, setValue] = React.useState("")
  const submit = () => {
    if (!inputRef.current?.(`${value}\r`)) {
      toast.error("The terminal is not connected. Try again in a moment.")
      return
    }
    setValue("")
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRoundIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="password"
            // Not a site login: do not offer to save it.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            autoFocus
            aria-label={prompt || "Password"}
            placeholder={prompt || "Password"}
            className="pl-8"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={submit}>
          <CornerDownLeftIcon aria-hidden="true" />
          Enter
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          Goes only to the terminal. The agent does not see it.
        </span>
        <button
          type="button"
          className="shrink-0 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => onShowTerminalChange(!showTerminal)}
        >
          {showTerminal ? "Hide terminal" : "Show terminal"}
        </button>
      </div>
    </div>
  )
}

/** An interactive job_start call: its job's live terminal, while it runs. */
function JobStartCard({ block, fallback }: ToolRendererProps) {
  const { viewerContextId, agentId } = useToolRenderContext()
  const interactive = toolArgs(block).interactive === true && block.running
  const { jobs } = useAgentJobs(
    viewerContextId,
    interactive ? agentId : undefined
  )
  const job = interactive
    ? jobs.find((item) => item.callId === block.callId)
    : undefined
  const trackRef = useTrackWaitingCard(
    job?.status === "running"
      ? waitingCardKey(viewerContextId, agentId, `job:${job.id}`)
      : undefined,
    "terminal"
  )
  const terminalInputRef = React.useRef<TerminalInput | null>(null)
  const [showTerminal, setShowTerminal] = React.useState(false)
  if (!interactive) return <>{fallback}</>
  const running = job?.status === "running"
  const secret = running && job.waiting?.secret === true
  const args = toolArgs(block)
  const prompt = job?.focus?.prompt ?? args.prompt
  const name = job?.name ?? (typeof args.name === "string" ? args.name : "")
  return (
    <div
      ref={trackRef}
      className="space-y-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SquareTerminalIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="truncate font-medium">{name || "Terminal"}</span>
        {typeof prompt === "string" && prompt ? (
          <span className="truncate text-muted-foreground">· {prompt}</span>
        ) : null}
      </div>
      {secret ? (
        <JobSecretInput
          prompt={job.waiting?.prompt.trim() ?? ""}
          inputRef={terminalInputRef}
          showTerminal={showTerminal}
          onShowTerminalChange={setShowTerminal}
        />
      ) : null}
      {running ? (
        <React.Suspense
          fallback={
            secret && !showTerminal ? null : (
              <div className="h-56 rounded-md border bg-background" />
            )
          }
        >
          {/* The terminal stays connected while the password field shows. */}
          <InlineJobTerminal
            jobId={job.id}
            hidden={secret && !showTerminal}
            inputRef={terminalInputRef}
          />
        </React.Suspense>
      ) : (
        <div className="text-xs text-muted-foreground">Starting…</div>
      )}
    </div>
  )
}

registerToolRenderer("job_start", {
  Card: JobStartCard,
  summary(block) {
    const args = toolArgs(block)
    const id = toolDetails<{ id: string }>(block).id
    const command = typeof args.command === "string" ? args.command : ""
    return [id, command].filter(Boolean).join(" · ")
  },
})

registerToolRenderer("terminal", {
  summary(block) {
    const args = toolArgs(block)
    return [args.action, args.id ?? args.label ?? args.command]
      .filter((part) => typeof part === "string" && part)
      .join(" · ")
  },
})

// The old job tools, in earlier transcripts.
for (const name of ["job_status", "job_output", "job_stop"]) {
  registerToolRenderer(name, {
    summary(block) {
      const id = toolArgs(block).id
      return typeof id === "string" ? id : "all jobs"
    },
  })
}
