import * as React from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MessageCircleQuestionIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { SettingsSection } from "@/features/pico/agent/agent-settings-dialog"
import { emitPicoEvent, usePicoEvent } from "@/features/pico/agent/events"
import { errorText } from "@/features/pico/agent/shared"
import { fetchJson } from "@/features/pico/app-shell-utils"
import {
  activeMachineId,
  apiUrl,
  LOCAL_MACHINE_ID,
  openMachine,
} from "@/lib/pico/machine"
import { cn } from "@/lib/utils"
import {
  useMachines,
  viewerContextIdForSummaries,
  type MachineInfo,
  type MachineSessionSummary,
  type MachineState,
} from "@/features/pico/machine-store"

async function machineAction(
  id: string,
  action: "retry" | "rename" | "enable" | "disable" | "remove",
  body: Record<string, unknown> = {}
) {
  try {
    await fetchJson(
      apiUrl(`/api/machines/${encodeURIComponent(id)}/${action}`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    )
  } catch (error) {
    toast.error(errorText(error))
  }
}

const STATE_LABELS: Record<MachineState, string> = {
  connecting: "Connecting",
  online: "Online",
  offline: "Offline",
  attention: "Needs attention",
  disabled: "Disabled",
}

export function machineStateLabel(machine: MachineInfo) {
  if (machine.state === "attention" && machine.problem?.kind === "update")
    return "Update needed"
  if (machine.state === "attention" && machine.problem?.kind === "auth")
    return "Sign-in needed"
  if (machine.state === "attention" && machine.problem?.kind === "stopped")
    return "Pico stopped"
  return STATE_LABELS[machine.state]
}

function MachineStateDot({
  state,
  className,
}: {
  state: MachineState
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        state === "online" && "bg-emerald-500",
        state === "connecting" && "animate-pulse bg-amber-500",
        state === "offline" && "bg-muted-foreground/50",
        state === "attention" && "bg-destructive",
        state === "disabled" && "border border-muted-foreground/50",
        className
      )}
    />
  )
}

/** A finished run that this browser did not see yet. */
export function isMachineSessionUnread(session: MachineSessionSummary) {
  return (
    !session.busy &&
    !session.needsInput &&
    Boolean(session.unreadBy?.includes(viewerContextIdForSummaries()))
  )
}

function sessionCounts(machine: MachineInfo) {
  const sessions = machine.summary?.sessions ?? []
  return {
    working: sessions.filter((session) => session.busy && !session.needsInput)
      .length,
    waiting: sessions.filter((session) => session.needsInput).length,
    done: sessions.filter(isMachineSessionUnread).length,
  }
}

function MachineCounts({ machine }: { machine: MachineInfo }) {
  const { working, waiting, done } = sessionCounts(machine)
  if (machine.state !== "online")
    return (
      <span className="truncate text-[11px] font-normal text-sidebar-foreground/50">
        {machineStateLabel(machine)}
      </span>
    )
  return (
    <span className="flex items-center gap-2 text-[11px] font-normal text-sidebar-foreground/50">
      {waiting > 0 ? (
        <TitleTooltip title={`${waiting} waiting for you`}>
          <span className="flex items-center gap-0.5 text-amber-500">
            <MessageCircleQuestionIcon className="size-3" />
            {waiting}
          </span>
        </TitleTooltip>
      ) : null}
      {working > 0 ? (
        <TitleTooltip title={`${working} working`}>
          <span className="flex items-center gap-1">
            <Spinner size="xs" />
            {working}
          </span>
        </TitleTooltip>
      ) : null}
      {done > 0 ? (
        <TitleTooltip title={`${done} done`}>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-primary" />
            {done}
          </span>
        </TitleTooltip>
      ) : null}
    </span>
  )
}

/**
 * The heading of a machine group in the sidebar. All machines use it, so the
 * machine of this page looks the same as the others.
 */
function MachineGroupLabel({
  machine,
  collapsed,
  active = false,
}: {
  machine: MachineInfo
  collapsed: boolean
  active?: boolean
}) {
  return (
    // pr-0 when there is an icon button: it already holds the item-pad.
    <SidebarGroupLabel
      className={cn("justify-between gap-1", active && "pr-0")}
    >
      <CollapsibleTrigger
        type="button"
        className="group/machine-label flex min-w-0 flex-1 items-center justify-between gap-3 text-left outline-hidden"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <MachineStateDot state={machine.state} />
          <span
            className={cn(
              "min-w-0 truncate",
              active && "text-sidebar-foreground"
            )}
          >
            {machine.label}
          </span>
          {collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/machine-label:opacity-100" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/machine-label:opacity-100" />
          )}
        </span>
        <MachineCounts machine={machine} />
      </CollapsibleTrigger>
      {active ? (
        <TitleTooltip title="Manage machines">
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            onClick={() => emitOpenMachines()}
            aria-label="Manage machines"
          >
            <Settings2Icon />
          </Button>
        </TitleTooltip>
      ) : null}
    </SidebarGroupLabel>
  )
}

/**
 * The group of the machine of this page, when the hub has more machines. Its
 * content is the full sidebar of this machine (search, pinned sessions,
 * directories). With one machine, the content shows without a heading.
 */
export function SidebarActiveMachine({
  children,
}: {
  children: React.ReactNode
}) {
  const { machines } = useMachines()
  const activeId = activeMachineId()
  const [collapsed, setCollapsed] = useMachineCollapsed(activeId)
  const machine = machines.find((entry) => entry.id === activeId)
  if (machines.length < 2 || !machine) return <>{children}</>
  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <SidebarGroup className="pb-0">
        <MachineGroupLabel machine={machine} collapsed={collapsed} active />
      </SidebarGroup>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

const COLLAPSED_STORAGE_KEY = "pico-machine-groups-collapsed"

function readCollapsed(): Record<string, boolean> {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "{}"
    ) as unknown
    return value && typeof value === "object"
      ? (value as Record<string, boolean>)
      : {}
  } catch {
    return {}
  }
}

function useMachineCollapsed(id: string) {
  const [collapsed, setCollapsed] = React.useState(
    () => readCollapsed()[id] === true
  )
  const update = (next: boolean) => {
    setCollapsed(next)
    try {
      const all = readCollapsed()
      if (next) all[id] = true
      else delete all[id]
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(all))
    } catch {
      // Ignore storage failures.
    }
  }
  return [collapsed, update] as const
}

type RenderMachineContent = (machine: MachineInfo) => React.ReactNode

function OtherMachineGroup({
  machine,
  renderContent,
}: {
  machine: MachineInfo
  renderContent: RenderMachineContent
}) {
  const [collapsed, setCollapsed] = useMachineCollapsed(machine.id)
  const dimmed = machine.state !== "online"
  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <SidebarGroup className="py-1">
        <MachineGroupLabel machine={machine} collapsed={collapsed} />
        <CollapsibleContent>
          <SidebarGroupContent className={cn(dimmed && "opacity-60")}>
            {renderContent(machine)}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/**
 * One group for each other machine, under the directories of this one.
 * `renderContent` draws the directories of a machine (see `sidebar.tsx`).
 */
export function SidebarOtherMachines({
  renderContent,
}: {
  renderContent: RenderMachineContent
}) {
  const { machines } = useMachines()
  if (machines.length < 2) return null
  const activeId = activeMachineId()
  return (
    <>
      {machines
        .filter((machine) => machine.id !== activeId)
        .map((machine) => (
          <OtherMachineGroup
            key={machine.id}
            machine={machine}
            renderContent={renderContent}
          />
        ))}
    </>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/**
 * A notice above the session when the machine of this page is not online.
 * The page keeps the last state that it has; requests fail at once.
 */
export function MachineConnectionBanner() {
  const { loaded, machines } = useMachines()
  const activeId = activeMachineId()
  const machine = machines.find((entry) => entry.id === activeId)
  const now = useNow(Boolean(machine?.retryAt))
  if (activeId === LOCAL_MACHINE_ID || !loaded) return null
  if (!machine)
    return (
      <div className="flex items-center gap-3 border-b bg-muted/60 px-4 py-2 text-sm">
        <span className="min-w-0 flex-1">
          This machine is not on this hub any more.
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openMachine(LOCAL_MACHINE_ID)}
        >
          Open this computer
        </Button>
      </div>
    )
  if (machine.state === "online") return null
  const seconds = machine.retryAt
    ? Math.max(0, Math.ceil((machine.retryAt - now) / 1000))
    : undefined
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/60 px-4 py-2 text-sm"
    >
      <MachineStateDot state={machine.state} />
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {machine.label}: {machineStateLabel(machine)}.
        </span>{" "}
        <span className="text-muted-foreground">
          {machine.state === "connecting"
            ? "Pico connects to it now."
            : `You see the last state. ${machine.problem?.message ?? ""}${seconds !== undefined ? ` Next try in ${seconds} s.` : ""}`}
        </span>
        {machine.problem?.url ? (
          <>
            {" "}
            <a
              className="underline"
              href={machine.problem.url}
              target="_blank"
              rel="noreferrer"
            >
              Approve the connection
            </a>
          </>
        ) : null}
      </span>
      {machine.state !== "connecting" && machine.state !== "disabled" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void machineAction(machine.id, "retry")}
        >
          <RefreshCwIcon /> Try now
        </Button>
      ) : null}
    </div>
  )
}

export function emitOpenMachines() {
  emitPicoEvent("pico:open-machines", {})
}

function MachineRow({ machine }: { machine: MachineInfo }) {
  const [label, setLabel] = React.useState(machine.label)
  React.useEffect(() => setLabel(machine.label), [machine.label])
  const local = machine.id === LOCAL_MACHINE_ID
  const saveLabel = () => {
    const next = label.trim()
    if (!next || next === machine.label) {
      setLabel(machine.label)
      return
    }
    void machineAction(machine.id, "rename", { label: next })
  }
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-center gap-2">
        <MachineStateDot state={machine.state} />
        {local ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {machine.label}{" "}
            <span className="font-normal text-muted-foreground">
              (this hub)
            </span>
          </span>
        ) : (
          <Input
            value={label}
            aria-label={`Label of ${machine.label}`}
            className="h-7 min-w-0 flex-1"
            onChange={(event) => setLabel(event.target.value)}
            onBlur={saveLabel}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
          />
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {machineStateLabel(machine)}
        </span>
      </div>
      {!local ? (
        <div className="space-y-2 pl-4">
          <div className="truncate font-mono text-xs text-muted-foreground">
            ssh {machine.target}
            {machine.dataDir ? ` · ${machine.dataDir}` : ""}
            {machine.version ? ` · Pico ${machine.version}` : ""}
          </div>
          {machine.problem ? (
            <div className="space-y-1 text-xs">
              <p>{machine.problem.message}</p>
              {machine.problem.detail ? (
                <pre className="max-h-32 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">
                  {machine.problem.detail}
                </pre>
              ) : null}
              {machine.problem.kind === "auth" ||
              machine.problem.kind === "stopped" ? (
                <p className="text-muted-foreground">
                  Run in a terminal on the hub:{" "}
                  <code className="rounded bg-muted px-1">
                    pico-app machine reconnect {machine.label}
                  </code>
                </p>
              ) : null}
              {machine.problem.kind === "update" ? (
                <p className="text-muted-foreground">
                  Update Pico on {machine.label}, then run in a terminal on the
                  hub:{" "}
                  <code className="rounded bg-muted px-1">
                    pico-app machine reconnect {machine.label}
                  </code>
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {machine.state !== "online" && machine.enabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void machineAction(machine.id, "retry")}
              >
                Try now
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void machineAction(
                  machine.id,
                  machine.enabled ? "disable" : "enable"
                )
              }
            >
              {machine.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${machine.label} from this hub? Pico and its sessions keep running on ${machine.label}.`
                  )
                )
                  void machineAction(machine.id, "remove")
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MachinesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { loaded, machines, fileError } = useMachines()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Machines</DialogTitle>
          <DialogDescription>
            Sessions of other computers, over SSH. Each machine runs its own
            Pico; its sessions continue when this hub is offline.
          </DialogDescription>
        </DialogHeader>
        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="xs" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            {fileError ? (
              <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                {fileError}
              </p>
            ) : null}
            <SettingsSection title="Machines">
              {machines.map((machine) => (
                <MachineRow key={machine.id} machine={machine} />
              ))}
            </SettingsSection>
            <SettingsSection title="Add a machine">
              <div className="space-y-2 py-3 text-sm">
                <p>
                  Run this command in a terminal on the hub. SSH can then ask
                  for a password or a host key. Pico does not store passwords or
                  keys.
                </p>
                <code className="block rounded bg-muted p-2 text-xs">
                  pico-app machine add user@host
                </code>
                <p className="text-muted-foreground">
                  A Tailscale MagicDNS name works as the host. Anyone who can
                  open this hub can run commands on all its machines.
                </p>
              </div>
            </SettingsSection>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Mounted once in the app shell; opens on the `pico:open-machines` event. */
export function MachinesDialogController() {
  const [open, setOpen] = React.useState(false)
  usePicoEvent("pico:open-machines", () => setOpen(true))
  if (!open) return null
  return <MachinesDialog open={open} onOpenChange={setOpen} />
}
