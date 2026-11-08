import * as React from "react"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type {
  AgentJob,
  ArchivedAgentEntry,
  ArchivedAgentsResponse,
  RestoreAgentResponse,
} from "@/lib/pico/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { postAgentJson } from "@/features/pico/agent/agent-extensions"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMachineId } from "@/lib/pico/machine-context"
import { cn } from "@/lib/utils"
import { settle } from "@/lib/settle"

type ArchivedAgentsData = Extract<ArchivedAgentsResponse, { ok: true }>
type RestoreAgentData = Extract<RestoreAgentResponse, { ok: true }>

const archivedDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatArchivedAt(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : archivedDateFormat.format(date)
}

function shortProject(project: string) {
  const parts = project.split("/").filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : project
}

/** The jobs of an archived agent that still run (or wait for input). */
function runningJobs(agent: ArchivedAgentEntry): Array<AgentJob> {
  return (agent.jobs ?? []).filter((job) => job.state !== "failed")
}

/** What the dialog shows first, for example from the sidebar. */
export type ArchivedAgentsView = { project?: string; jobs?: boolean }

type ArchivedAgentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewerContextId: string
  /** Show only the agents with running jobs, or of one project. */
  initialView?: ArchivedAgentsView
  /** Called after a restore, so the sidebar can show the project. */
  onRestored?: (result: RestoreAgentData) => void
}

export function ArchivedAgentsDialog({
  open,
  onOpenChange,
  viewerContextId,
  initialView,
  onRestored,
}: ArchivedAgentsDialogProps) {
  const machineId = useMachineId()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState("")
  const [jobsOnly, setJobsOnly] = React.useState(false)
  const [project, setProject] = React.useState<string | undefined>()
  const [stopping, setStopping] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )

  React.useEffect(() => {
    if (!open) {
      setFilter("")
      setStopping(new Set())
      return
    }
    setJobsOnly(Boolean(initialView?.jobs))
    setProject(initialView?.project)
  }, [open, initialView])

  const archivedQuery = useQuery({
    queryKey: picoQueryKeys.archivedAgents(viewerContextId),
    queryFn: () =>
      fetchJson<ArchivedAgentsData>(
        buildRequestUrl("/api/agents/archived", {
          machineId,
          contextId: viewerContextId,
        })
      ),
    enabled: open && Boolean(viewerContextId),
    staleTime: 0,
    // Jobs end while the dialog is open: read their state again.
    refetchInterval: (query) =>
      query.state.data?.agents.some((agent) => runningJobs(agent).length > 0)
        ? 3000
        : false,
  })

  const stopJob = async (agent: ArchivedAgentEntry, job: AgentJob) => {
    setStopping((current) => new Set(current).add(job.id))
    const settled = await settle(
      postAgentJson(
        machineId,
        viewerContextId,
        agent.id,
        "/api/agent/job/stop",
        { jobId: job.id }
      )
    )
    if (!settled.ok) {
      const error = settled.error
      toast.error(errorText(error))
      setStopping((current) => {
        const next = new Set(current)
        next.delete(job.id)
        return next
      })
      return
    }
    await queryClient.invalidateQueries({
      queryKey: picoQueryKeys.archivedAgents(viewerContextId),
    })
  }

  const restoreMutation = useMutation({
    mutationFn: (path: string) =>
      fetchJson<RestoreAgentData>(
        buildRequestUrl("/api/agent/restore", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        }
      ),
    onSuccess: async (result) => {
      onRestored?.(result)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: picoQueryKeys.archivedAgents(viewerContextId),
        }),
        queryClient.invalidateQueries({
          queryKey: picoQueryKeys.projectAgentsIndex(
            viewerContextId,
            result.project
          ),
        }),
      ])
    },
  })

  const restore = async (agent: ArchivedAgentEntry) => {
    if (!agent.path) return
    const settled = await settle(restoreMutation.mutateAsync(agent.path))
    if (!settled.ok) {
      const error = settled.error
      toast.error(
        error instanceof Error ? error.message : "Failed to restore agent"
      )
      return
    }
    toast.success(`Restored "${agent.title || "New agent"}"`)
  }

  const agents = archivedQuery.data?.agents ?? []
  const jobAgentCount = agents.filter(
    (agent) => runningJobs(agent).length > 0
  ).length
  const query = filter.trim().toLowerCase()
  // Agents with running jobs first: they still use the machine.
  const visibleAgents = agents
    .filter(
      (agent) =>
        (!query ||
          `${agent.title}\n${agent.project}`.toLowerCase().includes(query)) &&
        (!project || agent.project === project) &&
        (!jobsOnly || runningJobs(agent).length > 0)
    )
    .sort(
      (left, right) =>
        Number(runningJobs(right).length > 0) -
        Number(runningJobs(left).length > 0)
    )
  const filtered = Boolean(query || project || jobsOnly)
  const restoringPath = restoreMutation.isPending
    ? restoreMutation.variables
    : undefined

  let list: React.ReactNode
  if (archivedQuery.isPending) {
    list = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  } else if (archivedQuery.isError) {
    list = (
      <p className="py-10 text-center text-sm text-destructive">
        {archivedQuery.error instanceof Error
          ? archivedQuery.error.message
          : "Failed to load archived agents"}
      </p>
    )
  } else if (visibleAgents.length === 0) {
    list = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArchiveIcon />
          </EmptyMedia>
          <EmptyTitle>
            {filtered ? "No matching agents" : "No archived agents"}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  } else {
    list = (
      <ul className="divide-y divide-border/70">
        {visibleAgents.map((agent) => {
          const archivedAt = formatArchivedAt(agent.archivedAt)
          const jobs = runningJobs(agent)
          return (
            <li
              key={agent.path || agent.id}
              className="flex items-start gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {agent.title || "New agent"}
                </div>
                <div
                  className="truncate text-xs text-muted-foreground"
                  title={agent.project}
                >
                  {shortProject(agent.project)}
                  {archivedAt ? ` · Archived ${archivedAt}` : ""}
                </div>
                {jobs.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {jobs.map((job) => (
                      <li
                        key={job.id}
                        className="flex min-w-0 items-center gap-2 text-xs"
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            job.state === "input"
                              ? "animate-pulse bg-sky-500"
                              : "bg-success"
                          )}
                        />
                        <span className="min-w-0 truncate">
                          {job.name}
                          {job.state === "input" ? " · waits for input" : ""}
                        </span>
                        <TitleTooltip title={`Stop ${job.name}`}>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Stop ${job.name}`}
                            disabled={stopping.has(job.id)}
                            onClick={() => void stopJob(agent, job)}
                          >
                            {stopping.has(job.id) ? (
                              <Spinner size="xs" />
                            ) : (
                              <SquareIcon />
                            )}
                          </Button>
                        </TitleTooltip>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreMutation.isPending || !agent.path}
                onClick={() => void restore(agent)}
              >
                {restoringPath === agent.path ? (
                  <Spinner />
                ) : (
                  <ArchiveRestoreIcon />
                )}
                Restore
              </Button>
            </li>
          )
        })}
      </ul>
    )
  }

  const body = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {agents.length > 0 ? (
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter archived agents…"
            aria-label="Filter archived agents"
            type="search"
            autoComplete="off"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            data-lpignore="true"
          />
          {jobAgentCount > 0 || jobsOnly ? (
            <Button
              variant="outline"
              aria-pressed={jobsOnly}
              className={cn(
                "shrink-0 gap-1.5",
                jobsOnly && "bg-accent text-accent-foreground"
              )}
              onClick={() => setJobsOnly((current) => !current)}
            >
              <span className="size-1.5 rounded-full bg-success" />
              Running jobs {jobAgentCount}
            </Button>
          ) : null}
        </div>
      ) : null}
      {project ? (
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="min-w-0 truncate" title={project}>
            Only {shortProject(project)}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Show all projects"
            onClick={() => setProject(undefined)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <div className="max-h-[60svh] min-h-0 overflow-y-auto">{list}</div>
    </div>
  )
  const description = "Restore an agent to show it in the sidebar again."

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Archived agents</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col px-4 pb-4">{body}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Archived agents</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
