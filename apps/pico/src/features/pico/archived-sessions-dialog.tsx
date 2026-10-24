import * as React from "react"
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type {
  ArchivedSessionEntry,
  ArchivedSessionsResponse,
  RestoreSessionResponse,
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

type ArchivedSessionsData = Extract<ArchivedSessionsResponse, { ok: true }>
type RestoreSessionData = Extract<RestoreSessionResponse, { ok: true }>

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

type ArchivedSessionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewerContextId: string
  /** Called after a restore, so the sidebar can show the directory. */
  onRestored?: (result: RestoreSessionData) => void
}

export function ArchivedSessionsDialog({
  open,
  onOpenChange,
  viewerContextId,
  onRestored,
}: ArchivedSessionsDialogProps) {
  const machineId = useMachineId()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState("")

  React.useEffect(() => {
    if (!open) setFilter("")
  }, [open])

  const archivedQuery = useQuery({
    queryKey: picoQueryKeys.archivedSessions(viewerContextId),
    queryFn: () =>
      fetchJson<ArchivedSessionsData>(
        buildRequestUrl("/api/sessions/archived", {
          machineId,
          contextId: viewerContextId,
        })
      ),
    enabled: open && Boolean(viewerContextId),
    staleTime: 0,
  })

  const restoreMutation = useMutation({
    mutationFn: (path: string) =>
      fetchJson<RestoreSessionData>(
        buildRequestUrl("/api/session/restore", {
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
          queryKey: picoQueryKeys.archivedSessions(viewerContextId),
        }),
        queryClient.invalidateQueries({
          queryKey: picoQueryKeys.directorySessionsIndex(
            viewerContextId,
            result.directory
          ),
        }),
      ])
    },
  })

  const restore = async (session: ArchivedSessionEntry) => {
    if (!session.path) return
    try {
      await restoreMutation.mutateAsync(session.path)
      toast.success(`Restored "${session.title || "New session"}"`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to restore session"
      )
    }
  }

  const sessions = archivedQuery.data?.sessions ?? []
  const query = filter.trim().toLowerCase()
  const visibleSessions = query
    ? sessions.filter((session) =>
        `${session.title}\n${session.directory}`.toLowerCase().includes(query)
      )
    : sessions
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
          : "Failed to load archived sessions"}
      </p>
    )
  } else if (visibleSessions.length === 0) {
    list = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArchiveIcon />
          </EmptyMedia>
          <EmptyTitle>
            {query ? "No matching sessions" : "No archived sessions"}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  } else {
    list = (
      <ul className="divide-y divide-border/70">
        {visibleSessions.map((session) => {
          const archivedAt = formatArchivedAt(session.archivedAt)
          return (
            <li
              key={session.path || session.id}
              className="flex items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {session.title || "New session"}
                </div>
                <div
                  className="truncate text-xs text-muted-foreground"
                  title={session.directory}
                >
                  {shortDirectory(session.directory)}
                  {archivedAt ? ` · Archived ${archivedAt}` : ""}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreMutation.isPending || !session.path}
                onClick={() => void restore(session)}
              >
                {restoringPath === session.path ? (
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {sessions.length > 0 ? (
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter archived sessions…"
          aria-label="Filter archived sessions"
        />
      ) : null}
      <div className="max-h-[60svh] min-h-0 overflow-y-auto">{list}</div>
    </div>
  )
  const description = "Restore a session to show it in the sidebar again."

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Archived sessions</DrawerTitle>
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
          <DialogTitle>Archived sessions</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
