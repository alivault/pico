import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { usePicoEvent } from "@/features/pico/agent/events"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { useMachineId } from "@/lib/pico/machine-context"

/** The answer of `/api/resources` (see server/src/services/resources.ts). */
export type MachineResources = {
  ok: true
  machine: {
    total: number
    free: number
    pressure?: { some: number; full: number }
  }
  server: { pid: number; rss: number; heapUsed: number; uptime: number }
  ptyHost?: { pid: number; rss: number }
  terminals: {
    backend: "host" | "local"
    /** Why terminals run in the server although a pty-host was asked for. */
    fallback?: string
    shells: number
    jobs: number
    exited: number
    screens: number
    backlogBytes: number
  }
  jobs: Array<{
    id: string
    name: string
    agentId: string
    pid?: number
    memory?: number
    scoped: boolean
    processes: number
  }>
  browser?: { contexts: number; running: boolean; rss: number }
}

export function formatBytes(bytes: number | undefined) {
  if (bytes === undefined) return "?"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** The resources of the machine that the shell shows, read again while open. */
export function useMachineResources(
  viewerContextId: string,
  enabled: boolean,
  refetchMs = 5000
) {
  const machineId = useMachineId()
  return useQuery({
    queryKey: ["pico", "resources", machineId],
    queryFn: () =>
      fetchJson<MachineResources>(
        buildRequestUrl("/api/resources", {
          machineId,
          contextId: viewerContextId,
        })
      ),
    enabled,
    refetchInterval: enabled ? refetchMs : false,
    staleTime: 2000,
  })
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-0.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y divide-border/50">{children}</div>
    </section>
  )
}

function ResourcesView({ data }: { data: MachineResources }) {
  const pressure = data.machine.pressure
  return (
    <div className="space-y-4">
      <Section title="Machine">
        <Row
          label="Memory free"
          value={`${formatBytes(data.machine.free)} of ${formatBytes(data.machine.total)}`}
        />
        {pressure ? (
          <Row
            label="Memory pressure (10 s)"
            value={`${pressure.some.toFixed(1)}% some, ${pressure.full.toFixed(1)}% full`}
          />
        ) : null}
      </Section>
      <Section title="Pico">
        <Row
          label={`Server (pid ${data.server.pid})`}
          value={`${formatBytes(data.server.rss)}, heap ${formatBytes(data.server.heapUsed)}`}
        />
        <Row
          label={
            data.ptyHost ? `pty-host (pid ${data.ptyHost.pid})` : "pty-host"
          }
          value={
            data.ptyHost
              ? formatBytes(data.ptyHost.rss)
              : data.terminals.fallback
                ? "could not start: terminals run in the server"
                : data.terminals.backend === "local"
                  ? "off: terminals run in the server"
                  : "not running"
          }
        />
        <Row
          label="Terminals"
          value={`${data.terminals.shells} shells, ${data.terminals.jobs} jobs, ${data.terminals.exited} ended`}
        />
        <Row
          label="Terminal output in memory"
          value={`${formatBytes(data.terminals.backlogBytes)}${data.terminals.screens ? `, ${data.terminals.screens} agent screens` : ""}`}
        />
        <Row
          label="Agent browser"
          value={
            data.browser?.running
              ? `${data.browser.contexts} contexts, ${formatBytes(data.browser.rss)}`
              : "not running"
          }
        />
      </Section>
      <Section title="Running jobs">
        {data.jobs.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No job runs.</p>
        ) : (
          data.jobs.map((job) => (
            <Row
              key={job.id}
              label={`${job.name} · ${job.agentId}`}
              value={`${formatBytes(job.memory)} · ${job.processes} proc${job.scoped ? " · scope" : ""}`}
            />
          ))
        )}
      </Section>
    </div>
  )
}

function ResourcesDialog({
  onOpenChange,
  viewerContextId,
}: {
  onOpenChange: (open: boolean) => void
  viewerContextId: string
}) {
  const query = useMachineResources(viewerContextId, true)
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resources</DialogTitle>
          <DialogDescription>
            What uses memory on this machine for Pico. Jobs include every
            process they started.
          </DialogDescription>
        </DialogHeader>
        {query.data ? (
          <ResourcesView data={query.data} />
        ) : query.error ? (
          <p className="text-sm text-destructive">{errorText(query.error)}</p>
        ) : (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Mounted once in the app shell; opens on the `pico:open-resources` event. */
export function ResourcesDialogController({
  viewerContextId,
}: {
  viewerContextId: string
}) {
  const [open, setOpen] = React.useState(false)
  usePicoEvent("pico:open-resources", () => setOpen(true))
  return open ? (
    <ResourcesDialog onOpenChange={setOpen} viewerContextId={viewerContextId} />
  ) : null
}
