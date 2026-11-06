import * as React from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MessageCircleQuestionIcon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "@/lib/pico/toast"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { emitPicoEvent, usePicoEvent } from "@/features/pico/agent/events"
import { errorText, relativeTime } from "@/features/pico/agent/shared"
import { fetchJson } from "@/features/pico/app-shell-utils"
import { useMachineId } from "@/lib/pico/machine-context"
import {
  hubUrl,
  LOCAL_MACHINE_ID,
  machinePageUrl,
  openMachine,
  queueMachineAction,
  type MachineAction,
} from "@/lib/pico/machine"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import {
  setSidebarGroupBy,
  useSidebarGroupBy,
  type SidebarGroupBy,
} from "@/features/pico/sidebar-display-settings"
import { cn } from "@/lib/utils"
import {
  hasLiveJob,
  setAgentStatusFilter,
  toggleAgentStatusFilter,
  useAgentStatusFilter,
  type AgentStatusFilter,
} from "@/features/pico/agent-status-filter"
import {
  useMachines,
  viewerContextIdForSummaries,
  type MachineInfo,
  type MachineAgentSummary,
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

/** A finished turn that nobody has read yet. */
export function isMachineAgentUnread(agent: MachineAgentSummary) {
  return (
    !agent.busy &&
    !agent.needsInput &&
    (agent.unread ??
      Boolean(agent.unreadBy?.includes(viewerContextIdForSummaries())))
  )
}

/** Count only the agents that the sidebar shows: those in its projects. */
function agentCounts(machine: MachineInfo) {
  const projects = new Set(machine.summary?.projects ?? [])
  const agents = (machine.summary?.agents ?? []).filter((agent) =>
    projects.has(agent.project || agent.cwd)
  )
  return {
    // An agent that waits on a timer, a watch, or a job is not done yet.
    working: agents.filter(
      (agent) => (agent.busy || agent.waiting) && !agent.needsInput
    ).length,
    waiting: agents.filter((agent) => agent.needsInput).length,
    done: agents.filter(
      (agent) => !agent.waiting && isMachineAgentUnread(agent)
    ).length,
    live: agents.filter((agent) => hasLiveJob(agent.jobs)).length,
  }
}

/** The machine has a done agent that nobody has read yet. */
export function machineHasUnreadAgents(machine: MachineInfo) {
  return agentCounts(machine).done > 0
}

/**
 * A count in a machine heading. A click shows only the agents with that
 * state; a second click shows all agents again.
 */
function MachineCountButton({
  machine,
  filter,
  count,
  title,
  className,
  activeOnly,
  children,
}: {
  machine: MachineInfo
  filter: AgentStatusFilter
  count: number
  title: string
  className?: string
  /** Show the button only when its filter is on. */
  activeOnly: boolean
  children: React.ReactNode
}) {
  const active = Boolean(useAgentStatusFilter(machine.id)?.includes(filter))
  // The active filter keeps its button at 0, so you can remove it.
  if (!active && (count === 0 || activeOnly)) return null
  return (
    <TitleTooltip
      title={active ? `Show all agents` : `Show only ${title.toLowerCase()}`}
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
          toggleAgentStatusFilter(machine.id, filter)
        }}
      >
        {children}
        {count}
      </Button>
    </TitleTooltip>
  )
}

function MachineCounts({
  machine,
  collapsed,
}: {
  machine: MachineInfo
  collapsed: boolean
}) {
  const { working, waiting, done, live } = agentCounts(machine)
  const online = machine.state === "online"
  // Grouped by state, the state groups replace the filters.
  const groupByStatus = useSidebarGroupBy(machine.id) === "status"
  // A machine that goes offline, or that groups its agents by state,
  // shows all its agents again.
  React.useEffect(() => {
    if (!online || groupByStatus) setAgentStatusFilter(machine.id, null)
  }, [machine.id, online, groupByStatus])
  if (!online) {
    return (
      <span className="truncate text-[11px] font-normal text-sidebar-foreground/50">
        {machineStateLabel(machine)}
      </span>
    )
  }
  if (groupByStatus) return null
  // An open machine shows its agents by project, so only a collapsed
  // machine shows its counts. An open machine keeps the button of the
  // filter that is on, so you can remove it.
  const activeOnly = !collapsed
  return (
    <span className="flex items-center">
      <MachineCountButton
        machine={machine}
        activeOnly={activeOnly}
        filter="waiting"
        count={waiting}
        title="Waiting for you"
        className="text-amber-500 hover:text-amber-500"
      >
        <MessageCircleQuestionIcon className="size-3" />
      </MachineCountButton>
      <MachineCountButton
        machine={machine}
        activeOnly={activeOnly}
        filter="working"
        count={working}
        title="Working"
      >
        <Spinner size="xs" />
      </MachineCountButton>
      <MachineCountButton
        machine={machine}
        activeOnly={activeOnly}
        filter="done"
        count={done}
        title="Done"
      >
        <span className="size-2 rounded-full bg-primary" />
      </MachineCountButton>
      <MachineCountButton
        machine={machine}
        activeOnly={activeOnly}
        filter="live"
        count={live}
        title="Agents with running jobs"
      >
        <span className="size-1.5 rounded-full bg-success" />
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
  renaming = false,
  onRenameDone,
}: {
  machine: MachineInfo
  collapsed: boolean
  active?: boolean
  /** Icon buttons of the group, after the counts. */
  actions?: React.ReactNode
  /** Show a text field for the label in place of the label. */
  renaming?: boolean
  onRenameDone?: () => void
}) {
  const attention = machine.state === "attention"
  if (renaming)
    return (
      <SidebarGroupLabel className="gap-2">
        <MachineStateDot state={machine.state} />
        <MachineLabelField machine={machine} onDone={() => onRenameDone?.()} />
      </SidebarGroupLabel>
    )
  return (
    // pr-0 when there is an icon button: it already holds the item-pad.
    <SidebarGroupLabel
      className={cn(
        "group/heading justify-between gap-1",
        (actions || attention) && "pr-0"
      )}
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
          counts next to its icon buttons. The agent rows still show
          their state. */}
      {attention ? null : (
        <span
          className={cn("contents", actions && "@max-[18rem]/sidebar:hidden")}
        >
          <MachineCounts machine={machine} collapsed={collapsed} />
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
  shownMachineId,
  shownContent,
  renderContent,
  renderActions,
  reordering,
}: {
  machine: MachineInfo
  shown: boolean
  shownMachineId: string
  shownContent: React.ReactNode
  renderContent: RenderMachine
  renderActions?: (machine: MachineInfo, shown: boolean) => React.ReactNode
  /** A machine group is in a drag: all groups show only their heading. */
  reordering: boolean
}) {
  const collapsed = useMachineCollapsed(machine.id)
  const onOpenChange = useMachineOpenChange(machine.id)
  const [renaming, setRenaming] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  const dimmed = machine.state !== "online"
  // A drag on the heading moves the group.
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: machine.id, disabled: renaming })
  const sortable = {
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    className: cn(isDragging && "opacity-0"),
  }
  // The content stays in the page (the shown machine's content is a slot
  // that its shell fills), but it does not show during a drag.
  const contentClass = cn(reordering && "hidden")
  const label = (
    <MachineContextMenu
      machine={machine}
      shown={shown}
      shownMachineId={shownMachineId}
      onRename={() => setRenaming(true)}
      onRemove={() => setRemoving(true)}
    >
      <div {...listeners}>
        <MachineGroupLabel
          machine={machine}
          collapsed={collapsed}
          active={shown}
          actions={renderActions?.(machine, shown)}
          renaming={renaming}
          onRenameDone={() => setRenaming(false)}
        />
      </div>
    </MachineContextMenu>
  )
  const removeDialog = (
    <RemoveMachineDialog
      machine={machine}
      open={removing}
      onOpenChange={setRemoving}
    />
  )
  if (shown)
    return (
      <Collapsible open={!collapsed} onOpenChange={onOpenChange} {...sortable}>
        <SidebarGroup className="pt-1 pb-0">{label}</SidebarGroup>
        <CollapsibleContent className={contentClass}>
          {shownContent}
        </CollapsibleContent>
        {removeDialog}
      </Collapsible>
    )
  return (
    <Collapsible open={!collapsed} onOpenChange={onOpenChange} {...sortable}>
      <SidebarGroup className="py-1">
        {label}
        <CollapsibleContent className={contentClass}>
          <SidebarGroupContent className={cn(dimmed && "opacity-60")}>
            {renderContent(machine)}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
      {removeDialog}
    </Collapsible>
  )
}

/** A text field that renames a machine. Return saves; Escape cancels. */
function MachineLabelField({
  machine,
  onDone,
}: {
  machine: MachineInfo
  onDone: () => void
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  const doneRef = React.useRef(false)
  React.useEffect(() => {
    // The context menu gives the focus back to its trigger when it closes.
    // Take it after that.
    const frame = window.requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])
  const finish = (save: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    const next = ref.current?.value.trim() ?? ""
    if (save && next && next !== machine.label)
      void machineAction(machine.id, "rename", { label: next })
    onDone()
  }
  return (
    <Input
      ref={ref}
      defaultValue={machine.label}
      aria-label={`Name of ${machine.label}`}
      className="h-6 min-w-0 flex-1 px-1.5 text-xs md:text-xs"
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          finish(true)
        } else if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}

function RemoveMachineDialog({
  machine,
  open,
  onOpenChange,
}: {
  machine: MachineInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = React.useState(false)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {machine.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This hub stops showing {machine.label}. Pico and its agents keep
            running on {machine.label}. To add it again, run{" "}
            <code>pico-app machine add {machine.target}</code> on the hub.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void machineAction(machine.id, "remove").finally(() => {
                setBusy(false)
                onOpenChange(false)
              })
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The state, version, and connection time of a machine, in one line. */
function machineStatusText(machine: MachineInfo) {
  const parts = [machineStateLabel(machine)]
  const version = machine.version ?? machine.summary?.version
  if (version) parts.push(`Pico ${version}`)
  if (machine.id === LOCAL_MACHINE_ID) parts.push("this hub")
  else if (machine.state === "online" && machine.since)
    parts.push(`connected ${relativeTime(machine.since)}`)
  return parts.join(" · ")
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${what}`)
  } catch {
    toast.error(`Could not copy ${what}`)
  }
}

/**
 * The context menu of a machine heading: new agents and projects, the
 * view of the group, the activity of the machine, its connection, and its
 * settings. Each action names its machine; it works for the shown machine
 * and for the others.
 */
function MachineContextMenu({
  machine,
  shown,
  shownMachineId,
  onRename,
  onRemove,
  children,
}: {
  machine: MachineInfo
  shown: boolean
  shownMachineId: string
  onRename: () => void
  onRemove: () => void
  children: React.ReactNode
}) {
  const { machines } = useMachines()
  const prefs = useMachineSidebarPrefs()
  const { isMobile, setOpenMobile } = useSidebar()
  const groupBy = useSidebarGroupBy(machine.id)
  const local = machine.id === LOCAL_MACHINE_ID
  const online = machine.state === "online"
  const hidden = orderMachines(machines, prefs.order).filter(
    (entry) => entry.id !== shownMachineId && prefs.hidden.includes(entry.id)
  )
  const run = (action: MachineAction) => {
    if (isMobile) setOpenMobile(false)
    if (shown) queueMachineAction(machine.id, action)
    else openMachine(machine.id, { action })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-72">
        <ContextMenuGroup>
          <ContextMenuLabel className="flex items-center gap-2 text-foreground">
            <MachineStateDot state={machine.state} />
            <span className="truncate">{machine.label}</span>
          </ContextMenuLabel>
          <div className="truncate px-1.5 pb-1 text-xs text-muted-foreground">
            {machineStatusText(machine)}
          </div>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={!online}
            onClick={() => run({ type: "new-agent" })}
          >
            New agent on {machine.label}
            {shown ? (
              <ContextMenuShortcut>
                {formatShortcutLabel(appShortcut("N"))}
              </ContextMenuShortcut>
            ) : null}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!online}
            onClick={() => run({ type: "add-project" })}
          >
            Add project…
            {shown ? (
              <ContextMenuShortcut>
                {formatShortcutLabel(appShortcut("D"))}
              </ContextMenuShortcut>
            ) : null}
          </ContextMenuItem>
          {shown ? null : (
            <ContextMenuItem
              onClick={() => {
                if (isMobile) setOpenMobile(false)
                openMachine(machine.id)
              }}
            >
              Switch to {machine.label}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Group by</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-40">
              <ContextMenuRadioGroup
                value={groupBy}
                onValueChange={(value: SidebarGroupBy) =>
                  setSidebarGroupBy(machine.id, value)
                }
              >
                <ContextMenuRadioItem value="project">
                  Project
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="status">
                  State
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {shown ? null : (
            <ContextMenuItem onClick={() => setMachineHidden(machine.id, true)}>
              Hide in sidebar
            </ContextMenuItem>
          )}
          {hidden.length > 0 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Show hidden machine</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                {hidden.map((entry) => (
                  <ContextMenuItem
                    key={entry.id}
                    onClick={() => setMachineHidden(entry.id, false)}
                  >
                    <MachineStateDot state={entry.state} />
                    <span className="truncate">{entry.label}</span>
                  </ContextMenuItem>
                ))}
                {hidden.length > 1 ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() =>
                        setMachineSidebarPrefs({ ...prefs, hidden: [] })
                      }
                    >
                      Show all
                    </ContextMenuItem>
                  </>
                ) : null}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
        </ContextMenuGroup>
        {local ? null : (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>Connection</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-64">
                <div className="px-1.5 py-1 text-xs text-muted-foreground">
                  <div className="truncate">{machineStatusText(machine)}</div>
                  {machine.problem ? (
                    <div className="line-clamp-3 text-destructive">
                      {machine.problem.message}
                    </div>
                  ) : null}
                </div>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={!machine.enabled || machine.state === "connecting"}
                  onClick={() => void machineAction(machine.id, "retry")}
                >
                  Reconnect
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    void copyText(machine.target, "the SSH target")
                  }
                >
                  Copy SSH target
                  <ContextMenuShortcut className="max-w-28 truncate">
                    {machine.target}
                  </ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    void copyText(
                      new URL(
                        machinePageUrl(machine.id),
                        window.location.origin
                      ).toString(),
                      "the link"
                    )
                  }
                >
                  Copy link to {machine.label}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={!online}
            onClick={() => run({ type: "open-settings" })}
          >
            Settings for {machine.label}…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => emitOpenMachines()}>
            Manage machines…
          </ContextMenuItem>
          {local ? null : (
            <>
              <ContextMenuItem onClick={onRename}>Rename…</ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  void machineAction(
                    machine.id,
                    machine.enabled ? "disable" : "enable"
                  )
                }
              >
                {machine.enabled ? "Disable" : "Enable"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={onRemove}>
                Remove {machine.label}…
              </ContextMenuItem>
            </>
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The order of the machine groups and the hidden machines. It is window
 * state: one copy for the browser, in local storage.
 */
type MachineSidebarPrefs = { order: Array<string>; hidden: Array<string> }

// Stored name: do not change.
const MACHINE_SIDEBAR_STORAGE_KEY = "pico-sidebar-machines"

let prefsSnapshot: MachineSidebarPrefs | undefined
const prefsListeners = new Set<() => void>()

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function getMachineSidebarPrefs(): MachineSidebarPrefs {
  if (prefsSnapshot) return prefsSnapshot
  try {
    const value = JSON.parse(
      window.localStorage.getItem(MACHINE_SIDEBAR_STORAGE_KEY) ?? "{}"
    ) as Partial<Record<keyof MachineSidebarPrefs, unknown>> | null
    prefsSnapshot = {
      order: stringList(value?.order),
      hidden: stringList(value?.hidden),
    }
  } catch {
    prefsSnapshot = { order: [], hidden: [] }
  }
  return prefsSnapshot
}

function setMachineSidebarPrefs(next: MachineSidebarPrefs) {
  prefsSnapshot = next
  try {
    window.localStorage.setItem(
      MACHINE_SIDEBAR_STORAGE_KEY,
      JSON.stringify(next)
    )
  } catch {
    // Ignore storage failures.
  }
  for (const listener of prefsListeners) listener()
}

function useMachineSidebarPrefs() {
  return React.useSyncExternalStore(
    (listener) => {
      prefsListeners.add(listener)
      return () => {
        prefsListeners.delete(listener)
      }
    },
    getMachineSidebarPrefs,
    getMachineSidebarPrefs
  )
}

/** The machines in the order of the user; new machines in hub order last. */
function orderMachines(machines: Array<MachineInfo>, order: Array<string>) {
  const rank = (machine: MachineInfo, index: number) => {
    const position = order.indexOf(machine.id)
    return position < 0 ? order.length + index : position
  }
  return machines
    .map((machine, index) => ({ machine, rank: rank(machine, index) }))
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.machine)
}

/** The machines that the sidebar shows. The shown machine never hides. */
function visibleMachines(
  machines: Array<MachineInfo>,
  prefs: MachineSidebarPrefs,
  shownMachineId: string
) {
  return orderMachines(machines, prefs.order).filter(
    (machine) =>
      machine.id === shownMachineId || !prefs.hidden.includes(machine.id)
  )
}

function setMachineHidden(id: string, hidden: boolean) {
  const prefs = getMachineSidebarPrefs()
  const rest = prefs.hidden.filter((entry) => entry !== id)
  setMachineSidebarPrefs({ ...prefs, hidden: hidden ? [...rest, id] : rest })
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
 * One group for each machine of the hub, in the order that the user chose
 * (the hub's order by default), without the machines that the user hid.
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
  /** The projects of another machine, from its summary. */
  renderContent: RenderMachine
  /** Icon buttons for the heading of a machine. */
  renderActions?: (machine: MachineInfo, shown: boolean) => React.ReactNode
}) {
  const { machines } = useMachines()
  const prefs = useMachineSidebarPrefs()
  const [dragged, setDragged] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const hasGroups = useHasMachineGroupsFor(shownMachineId)
  if (!hasGroups) return <>{shownContent}</>
  const visible = visibleMachines(machines, prefs, shownMachineId)
  const ids = visible.map((machine) => machine.id)
  const draggedMachine = visible.find((machine) => machine.id === dragged)
  const onDragStart = ({ active }: DragStartEvent) => {
    setDragged(String(active.id))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    if (!over || active.id === over.id) return
    moveMachine(
      machines,
      shownMachineId,
      String(active.id),
      ids.indexOf(String(over.id))
    )
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // The groups lose their content when the drag starts, so measure
      // them again.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragged(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {visible.map((machine) => (
          <MachineGroup
            key={machine.id}
            machine={machine}
            shown={machine.id === shownMachineId}
            shownMachineId={shownMachineId}
            shownContent={shownContent}
            renderContent={renderContent}
            renderActions={renderActions}
            reordering={dragged !== null}
          />
        ))}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {draggedMachine ? (
          <div className="flex h-(--sidebar-item-size) items-center gap-2 rounded-md bg-sidebar px-(--sidebar-item-pad) text-xs font-medium text-sidebar-foreground shadow-lg ring-1 ring-sidebar-border/70">
            <MachineStateDot state={draggedMachine.state} />
            <span className="min-w-0 truncate">{draggedMachine.label}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * Move a machine group to `index` in the shown groups. The hidden machines
 * keep their places in the order.
 */
function moveMachine(
  machines: Array<MachineInfo>,
  shownMachineId: string,
  id: string,
  index: number
) {
  const prefs = getMachineSidebarPrefs()
  const all = orderMachines(machines, prefs.order).map((machine) => machine.id)
  const visible = visibleMachines(machines, prefs, shownMachineId).map(
    (machine) => machine.id
  )
  const from = visible.indexOf(id)
  if (from < 0 || index < 0) return
  const moved = arrayMove(visible, from, index)
  const slots = new Set(visible)
  let next = 0
  const order = all.map((entry) => (slots.has(entry) ? moved[next++] : entry))
  setMachineSidebarPrefs({ ...prefs, order })
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
 * A notice above the agent when the machine of this page is not online.
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
                    `Remove ${machine.label} from this hub? Pico and its agents keep running on ${machine.label}.`
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
            Agents of other computers, over SSH. Each machine runs its own Pico;
            its agents continue when this hub is offline.
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

function SettingsSection({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <section className="space-y-1">
      <h3 className="pt-3 text-sm font-semibold">{title}</h3>
      <div className="divide-y rounded-lg border px-3">{children}</div>
    </section>
  )
}
