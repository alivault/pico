import * as React from "react"
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type {
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
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMachineId } from "@/lib/pico/machine-context"

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

function shortDirectory(directory: string) {
  const parts = directory.split("/").filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : directory
}

type ArchivedAgentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewerContextId: string
  /** Called after a restore, so the sidebar can show the directory. */
  onRestored?: (result: RestoreAgentData) => void
}

export function ArchivedAgentsDialog({
  open,
  onOpenChange,
  viewerContextId,
  onRestored,
}: ArchivedAgentsDialogProps) {
  const machineId = useMachineId()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState("")

  React.useEffect(() => {
    if (!open) setFilter("")
  }, [open])

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
  })

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
          queryKey: picoQueryKeys.directoryAgentsIndex(
            viewerContextId,
            result.directory
          ),
        }),
      ])
    },
  })

  const restore = async (agent: ArchivedAgentEntry) => {
    if (!agent.path) return
    try {
      await restoreMutation.mutateAsync(agent.path)
      toast.success(`Restored "${agent.title || "New agent"}"`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to restore agent"
      )
    }
  }

  const agents = archivedQuery.data?.agents ?? []
  const query = filter.trim().toLowerCase()
  const visibleAgents = query
    ? agents.filter((agent) =>
        `${agent.title}\n${agent.directory}`.toLowerCase().includes(query)
      )
    : agents
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
            {query ? "No matching agents" : "No archived agents"}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  } else {
    list = (
      <ul className="divide-y divide-border/70">
        {visibleAgents.map((agent) => {
          const archivedAt = formatArchivedAt(agent.archivedAt)
          return (
            <li
              key={agent.path || agent.id}
              className="flex items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {agent.title || "New agent"}
                </div>
                <div
                  className="truncate text-xs text-muted-foreground"
                  title={agent.directory}
                >
                  {shortDirectory(agent.directory)}
                  {archivedAt ? ` · Archived ${archivedAt}` : ""}
                </div>
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
