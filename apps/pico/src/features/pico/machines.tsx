import * as React from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MessageCircleQuestionIcon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "@/lib/pico/toast"

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
import { useMachineId } from "@/lib/pico/machine-context"
import { hubUrl, LOCAL_MACHINE_ID, openMachine } from "@/lib/pico/machine"
import { cn } from "@/lib/utils"
import {
  setSessionStatusFilter,
  toggleSessionStatusFilter,
  useSessionStatusFilter,
  type SessionStatusFilter,
} from "@/features/pico/session-status-filter"
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
      hubUrl(`/api/machines/${encodeURIComponent(id)}/${action}`),
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

export function MachineStateDot({
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

/** A finished run that nobody has read yet. */
export function isMachineSessionUnread(session: MachineSessionSummary) {
  return (
    !session.busy &&
    !session.needsInput &&
    (session.unread ??
      Boolean(session.unreadBy?.includes(viewerContextIdForSummaries())))
  )
}

/** Count only the sessions that the sidebar shows: those in its directories. */
function sessionCounts(machine: MachineInfo) {
  const directories = new Set(machine.summary?.directories ?? [])
  const sessions = (machine.summary?.sessions ?? []).filter((session) =>
    directories.has(session.directory || session.cwd)
  )
  return {
    // A session that waits on a timer, a watch, or a job is not done yet.
    working: sessions.filter(
      (session) => (session.busy || session.waiting) && !session.needsInput
    ).length,
    waiting: sessions.filter((session) => session.needsInput).length,
    done: sessions.filter(
      (session) => !session.waiting && isMachineSessionUnread(session)
    ).length,
  }
}

/**
 * A count in a machine heading. A click shows only the sessions with that
 * state; a second click shows all sessions again.
 */
function MachineCountButton({
  machine,
  filter,
  count,
  title,
  className,
  children,
}: {
  machine: MachineInfo
  filter: SessionStatusFilter
  count: number
  title: string
  className?: string
  children: React.ReactNode
}) {
  const active = Boolean(useSessionStatusFilter(machine.id)?.includes(filter))
  // The active filter keeps its button at 0, so you can remove it.
  if (count === 0 && !active) return null
  return (
    <TitleTooltip
      title={active ? `Show all sessions` : `Show only ${title.toLowerCase()}`}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={active}
        aria-label={`${count} ${title.toLowerCase()} on ${machine.label}`}
        className={cn(
          "h-6 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          active &&
            "bg-sidebar-accent text-sidebar-foreground ring-1 ring-sidebar-border",
          className
        )}
        onClick={() => {
          setMachinesCollapsed([machine.id], false)
          toggleSessionStatusFilter(machine.id, filter)
        }}
      >
        {children}
        {count}
      </Button>
    </TitleTooltip>
  )
}

function MachineCounts({ machine }: { machine: MachineInfo }) {
  const { working, waiting, done } = sessionCounts(machine)
  const online = machine.state === "online"
  // A machine that goes offline shows all its sessions again.
  React.useEffect(() => {
    if (!online) setSessionStatusFilter(machine.id, null)
  }, [machine.id, online])
  if (!online) {
    return (
      <span className="truncate text-[11px] font-normal text-sidebar-foreground/50">
        {machineStateLabel(machine)}
      </span>
    )
  }
  return (
    <span className="flex items-center">
      <MachineCountButton
        machine={machine}
        filter="waiting"
        count={waiting}
        title="Waiting for you"
        className="text-amber-500 hover:text-amber-500"
      >
        <MessageCircleQuestionIcon className="size-3" />
      </MachineCountButton>
      <MachineCountButton
        machine={machine}
        filter="working"
        count={working}
        title="Working"
      >
        <Spinner size="xs" />
      </MachineCountButton>
      <MachineCountButton
        machine={machine}
        filter="done"
        count={done}
        title="Done"
      >
        <span className="size-2 rounded-full bg-primary" />
      </MachineCountButton>
    </span>
  )
}

const PROBLEM_BADGES: Record<string, string> = {
  auth: "! auth",
  update: "! update",
  stopped: "! stopped",
  setup: "! setup",
}

/**
 * A machine that needs an action shows a badge in its heading, like Herdr's
 * `! auth`. A click opens the machines settings with the error and the
 * command that fixes it. The rest of the heading still opens and closes the
 * group.
 */
function MachineProblemBadge({ machine }: { machine: MachineInfo }) {
  const label = PROBLEM_BADGES[machine.problem?.kind ?? ""] ?? "! error"
  return (
    <TitleTooltip
      title={machine.problem?.message ?? machineStateLabel(machine)}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-1.5 font-mono text-[11px] font-normal text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => emitOpenMachines()}
        aria-label={`${machine.label}: ${machineStateLabel(machine)}. Show details`}
      >
        {label}
      </Button>
    </TitleTooltip>
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
  actions,
}: {
  machine: MachineInfo
  collapsed: boolean
  active?: boolean
  /** Icon buttons of the group, after the counts. */
  actions?: React.ReactNode
}) {
  const attention = machine.state === "attention"
  return (
    // pr-0 when there is an icon button: it already holds the item-pad.
    <SidebarGroupLabel
      className={cn("justify-between gap-1", (actions || attention) && "pr-0")}
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
      </CollapsibleTrigger>
      {/* The counts are buttons, so they are not in the trigger. In a
          narrow sidebar, the machine of this page has no room for its
          counts next to its icon buttons. The session rows still show
          their state. */}
      {attention ? null : (
        <span
          className={cn("contents", actions && "@max-[18rem]/sidebar:hidden")}
        >
          <MachineCounts machine={machine} />
        </span>
      )}
      {attention ? <MachineProblemBadge machine={machine} /> : null}
      {actions}
    </SidebarGroupLabel>
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

// One store for all machine groups, so an Option-click can expand or
// collapse all of them.
let collapsedSnapshot: Record<string, boolean> | undefined
const collapsedListeners = new Set<() => void>()

function getCollapsedSnapshot() {
  collapsedSnapshot ??= readCollapsed()
  return collapsedSnapshot
}

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener)
  return () => {
    collapsedListeners.delete(listener)
  }
}

function setMachinesCollapsed(ids: Array<string>, collapsed: boolean) {
  const next = { ...getCollapsedSnapshot() }
  for (const id of ids) {
    if (collapsed) next[id] = true
    else delete next[id]
  }
  collapsedSnapshot = next
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore storage failures.
  }
  for (const listener of collapsedListeners) listener()
}

function useMachineCollapsed(id: string) {
  return React.useSyncExternalStore(
    subscribeCollapsed,
    () => getCollapsedSnapshot()[id] === true,
    () => false
  )
}

/** True when the user held Option (Alt) for the click or key press. */
export function isAltChange(details: { event?: Event }) {
  const event = details.event
  return Boolean(event && "altKey" in event && event.altKey)
}

/**
 * Expands or collapses one machine group. An Option-click expands or
 * collapses all of them.
 */
function useMachineOpenChange(id: string) {
  const { machines } = useMachines()
  return (open: boolean, details: { event?: Event }) => {
    const ids = isAltChange(details)
      ? machines.map((machine) => machine.id)
      : [id]
    setMachinesCollapsed(ids, !open)
  }
}

type RenderMachine = (machine: MachineInfo) => React.ReactNode

/**
 * The group of one machine. All machines use it: the heading has the same
 * buttons for each machine. The shown machine's content is the live
 * sidebar of its app shell (`shownContent`, a slot that the shell fills);
 * another machine's content comes from its hub summary.
 */
function MachineGroup({
  machine,
  shown,
  shownContent,
  renderContent,
  renderActions,
}: {
  machine: MachineInfo
  shown: boolean
  shownContent: React.ReactNode
  renderContent: RenderMachine
  renderActions?: (machine: MachineInfo, shown: boolean) => React.ReactNode
}) {
  const collapsed = useMachineCollapsed(machine.id)
  const onOpenChange = useMachineOpenChange(machine.id)
  const dimmed = machine.state !== "online"
  const label = (
    <MachineGroupLabel
      machine={machine}
      collapsed={collapsed}
      active={shown}
      actions={renderActions?.(machine, shown)}
    />
  )
  if (shown)
    return (
      <Collapsible open={!collapsed} onOpenChange={onOpenChange}>
        <SidebarGroup className="pt-1 pb-0">{label}</SidebarGroup>
        <CollapsibleContent>{shownContent}</CollapsibleContent>
      </Collapsible>
    )
  return (
    <Collapsible open={!collapsed} onOpenChange={onOpenChange}>
      <SidebarGroup className="py-1">
        {label}
        <CollapsibleContent>
          <SidebarGroupContent className={cn(dimmed && "opacity-60")}>
            {renderContent(machine)}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/** Whether the hub has more than one machine, so the sidebar has groups. */
export function useHasMachineGroups() {
  const machineId = useMachineId()
  return useHasMachineGroupsFor(machineId)
}

export function useHasMachineGroupsFor(machineId: string) {
  const { machines } = useMachines()
  return (
    machines.length > 1 && machines.some((machine) => machine.id === machineId)
  )
}

/**
 * One group for each machine of the hub, in the order of the hub's list.
 * The order does not change when the page shows another machine: only the
 * content of the groups changes. With one machine, `shownContent` shows
 * without a heading.
 */
export function SidebarMachineGroups({
  shownMachineId,
  shownContent,
  renderContent,
  renderActions,
}: {
  shownMachineId: string
  /** The live sidebar of the machine that shows. */
  shownContent: React.ReactNode
  /** The directories of another machine, from its summary. */
  renderContent: RenderMachine
  /** Icon buttons for the heading of a machine. */
  renderActions?: (machine: MachineInfo, shown: boolean) => React.ReactNode
}) {
  const { machines } = useMachines()
  if (!useHasMachineGroupsFor(shownMachineId)) return <>{shownContent}</>
  return (
    <>
      {machines.map((machine) => (
        <MachineGroup
          key={machine.id}
          machine={machine}
          shown={machine.id === shownMachineId}
          shownContent={shownContent}
          renderContent={renderContent}
          renderActions={renderActions}
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
  const activeId = useMachineId()
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
