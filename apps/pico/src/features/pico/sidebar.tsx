import * as React from "react"
import { createPortal } from "react-dom"

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
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
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  FolderIcon,
  FolderPlusIcon,
  GitForkIcon,
  HourglassIcon,
  MessageCircleQuestionIcon,
  PinIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react"

import type { AgentListEntry } from "@/lib/pico/api"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Kbd } from "@/components/ui/kbd"
import { useShowAgentPreviews } from "@/features/pico/sidebar-display-settings"
import { Spinner } from "@/components/ui/spinner"
import {
  COLLAPSED_PROJECTS_STORAGE_KEY,
  PROJECT_AGENT_LOAD_MORE_COUNT,
  INITIAL_PROJECT_AGENT_RENDER_COUNT,
  PINNED_AGENTS_STORAGE_KEY,
  SIDEBAR_PROJECTS_STORAGE_KEY,
  readStoredCollapsedProjects,
  readStoredPinnedAgentKeys,
  machineLocalStorageSetItem,
  agentListEntryKey,
} from "@/lib/pico"
import { usePicoEvent } from "@/features/pico/agent/events"
import {
  isAltChange,
  isMachineAgentUnread,
  useHasMachineGroups,
} from "@/features/pico/machines"
import {
  viewerContextIdForSummaries,
  type MachineInfo,
  type MachineAgentSummary,
} from "@/features/pico/machine-store"
import {
  OtherMachineArchiveDialog,
  OtherMachineRenameDialog,
} from "@/features/pico/other-machine-agent-dialogs"
import { startSidebarSync } from "@/features/pico/sidebar-sync"
import { useSidebarAgentNumber } from "@/features/pico/sidebar-agent-numbers"
import { openMachine, openAgent as openMachineAgent } from "@/lib/pico/machine"
import {
  formatDisplayPath,
  formatFolderName,
} from "@/features/pico/app-shell-common"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import {
  createPicoStore,
  setStoreState,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"
import { useSidebarSlot } from "@/features/pico/sidebar-slots"
import { sortSidebarAgents } from "@/features/pico/agent-order"
import {
  filterProjectAgentsByStatus,
  agentMatchesStatusFilter,
  toggleStatusFilter,
  type AgentStatusFilter,
  type AgentStatusFilters,
  useAgentStatusFilter,
} from "@/features/pico/agent-status-filter"

const SIDEBAR_LOADING_SPINNER_DELAY_MS = 250
const SIDEBAR_TIME_MIN_DELAY_MS = 1000
const SIDEBAR_TIME_SECOND_MS = 1000
const SIDEBAR_TIME_MINUTE_MS = 60 * SIDEBAR_TIME_SECOND_MS
const SIDEBAR_TIME_HOUR_MS = 60 * SIDEBAR_TIME_MINUTE_MS
const SIDEBAR_TIME_DAY_MS = 24 * SIDEBAR_TIME_HOUR_MS
const SIDEBAR_TIME_WEEK_MS = 7 * SIDEBAR_TIME_DAY_MS
const SIDEBAR_TIME_MONTH_MS = 30 * SIDEBAR_TIME_DAY_MS
const SIDEBAR_TIME_YEAR_MS = 365 * SIDEBAR_TIME_DAY_MS

function useDelayedTrue(value: boolean, delayMs: number) {
  const [delayedValue, setDelayedValue] = React.useState(false)

  React.useEffect(() => {
    if (!value) {
      setDelayedValue(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDelayedValue(true)
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [delayMs, value])

  return delayedValue
}

function ProjectPathLabel({ path }: { path: string }) {
  const folderName = formatFolderName(path) || path

  return (
    <span className="block min-w-0 truncate text-sm font-medium text-sidebar-foreground">
      {folderName}
    </span>
  )
}

type AgentClickModifiers = {
  multiSelectKey: boolean
  shiftKey: boolean
}

const EMPTY_PROJECT_AGENT_KEYS: Array<string> = []

// One shared set of window listeners tracks whether Option (Alt) is held.
let altKeyHeldSnapshot = false
const altKeyHeldListeners = new Set<() => void>()

function setAltKeyHeld(next: boolean) {
  if (altKeyHeldSnapshot === next) return
  altKeyHeldSnapshot = next
  for (const listener of altKeyHeldListeners) listener()
}

function handleAltKeyEvent(event: KeyboardEvent) {
  setAltKeyHeld(event.altKey)
}

function handleAltKeyReset() {
  setAltKeyHeld(false)
}

function subscribeAltKeyHeld(listener: () => void) {
  if (altKeyHeldListeners.size === 0) {
    window.addEventListener("keydown", handleAltKeyEvent)
    window.addEventListener("keyup", handleAltKeyEvent)
    window.addEventListener("blur", handleAltKeyReset)
  }
  altKeyHeldListeners.add(listener)
  return () => {
    altKeyHeldListeners.delete(listener)
    if (altKeyHeldListeners.size === 0) {
      window.removeEventListener("keydown", handleAltKeyEvent)
      window.removeEventListener("keyup", handleAltKeyEvent)
      window.removeEventListener("blur", handleAltKeyReset)
      altKeyHeldSnapshot = false
    }
  }
}

function useAltKeyHeld() {
  return React.useSyncExternalStore(
    subscribeAltKeyHeld,
    () => altKeyHeldSnapshot,
    () => false
  )
}
// Stored name: do not change.
const PINNED_AGENT_GROUP_COLLAPSE_KEY = "__pico_pinned_sessions__"
// Stored name: do not change.
const PROJECTS_AGENT_GROUP_COLLAPSE_KEY = "__pico_directories__"

function isMacPlatform() {
  if (typeof window === "undefined") return false

  const platform = window.navigator.platform || window.navigator.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform)
}

function isSidebarMultiSelectModifier(event: {
  ctrlKey: boolean
  metaKey: boolean
}) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey
}

function formatSidebarAgentTime(value?: string, now = Date.now()) {
  if (!value) return ""

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ""

  const diffMs = now - timestamp
  const past = diffMs >= 0
  const seconds = Math.max(1, Math.floor(Math.abs(diffMs) / 1000))
  const prefix = past ? "" : "in "

  if (seconds < 60) return `${prefix}${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${prefix}${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${prefix}${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${prefix}${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${prefix}${weeks}w`

  const months = Math.floor(days / 30)
  if (months < 12) return `${prefix}${Math.max(1, months)}mo`

  const years = Math.floor(days / 365)
  return `${prefix}${Math.max(1, years)}y`
}

function isValidSidebarTimestamp(value?: string) {
  if (!value) return false
  return !Number.isNaN(new Date(value).getTime())
}

function getSidebarAgentTimeInterval(ageMs: number) {
  const seconds = Math.max(1, Math.floor(ageMs / SIDEBAR_TIME_SECOND_MS))

  if (seconds < 60) return SIDEBAR_TIME_SECOND_MS

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return SIDEBAR_TIME_MINUTE_MS

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return SIDEBAR_TIME_HOUR_MS

  const days = Math.floor(hours / 24)
  if (days < 7) return SIDEBAR_TIME_DAY_MS

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return SIDEBAR_TIME_WEEK_MS

  const months = Math.floor(days / 30)
  if (months < 12) return SIDEBAR_TIME_MONTH_MS

  return SIDEBAR_TIME_YEAR_MS
}

function getSidebarAgentTimeRefreshDelay(timestamp: number, now = Date.now()) {
  const diffMs = now - timestamp
  const ageMs = Math.abs(diffMs)
  const interval = getSidebarAgentTimeInterval(ageMs)
  const remainder = ageMs % interval
  const delay = diffMs >= 0 ? interval - remainder : remainder || interval

  return Math.max(SIDEBAR_TIME_MIN_DELAY_MS, delay)
}

function SidebarAgentTime({
  value,
  className,
  ...props
}: { value?: string } & React.ComponentProps<"span">) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN
  const [label, setLabel] = React.useState(() => formatSidebarAgentTime(value))

  React.useEffect(() => {
    if (Number.isNaN(timestamp)) {
      setLabel("")
      return
    }

    let timeoutId: number | undefined
    let cancelled = false

    const updateAndSchedule = () => {
      if (cancelled) return

      const now = Date.now()
      const nextLabel = formatSidebarAgentTime(value, now)
      setLabel(nextLabel)

      timeoutId = window.setTimeout(
        updateAndSchedule,
        getSidebarAgentTimeRefreshDelay(timestamp, now)
      )
    }

    updateAndSchedule()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [timestamp, value])

  if (!label) return null

  return (
    <span className={cn("tabular-nums", className)} {...props}>
      {label}
    </span>
  )
}

function projectOrderEqual(left: Array<string>, right: Array<string>) {
  return (
    left.length === right.length &&
    left.every((project, index) => project === right[index])
  )
}

type CollapsedProjectState = Record<string, boolean>

type CollapsedProjectStore = PicoStore<CollapsedProjectState> & {
  loadStored: () => void
  toggle: (project: string) => void
  setCollapsed: (project: string, collapsed: boolean) => void
  setAll: (projects: Array<string>, collapsed: boolean) => void
  remove: (project: string) => void
}

function sameCollapsedProjectState(
  left: CollapsedProjectState,
  right: CollapsedProjectState
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!projectOrderEqual(leftKeys, rightKeys)) return false

  return leftKeys.every((key) => Boolean(left[key]) === Boolean(right[key]))
}

function createCollapsedProjectStore(
  machineId: string,
  storageKey = COLLAPSED_PROJECTS_STORAGE_KEY
): CollapsedProjectStore {
  const store = createPicoStore<CollapsedProjectState>(
    {},
    sameCollapsedProjectState
  ) as CollapsedProjectStore

  const persist = () => {
    machineLocalStorageSetItem(
      machineId,
      storageKey,
      JSON.stringify(store.state)
    )
  }

  Object.assign(store, {
    loadStored() {
      setStoreState(store, readStoredCollapsedProjects(machineId, storageKey))
    },
    toggle(project) {
      store.setCollapsed(project, !store.state[project])
    },
    setCollapsed(project, collapsed) {
      setStoreState(store, (current) => {
        const currentlyCollapsed = Boolean(current[project])
        if (currentlyCollapsed === collapsed) return current
        const next = { ...current }
        if (collapsed) {
          next[project] = true
        } else {
          delete next[project]
        }
        return next
      })
      persist()
    },
    setAll(projects, collapsed) {
      setStoreState(store, (current) => {
        let changed = false
        const next = { ...current }

        for (const project of projects) {
          if (collapsed) {
            if (next[project]) continue
            next[project] = true
            changed = true
          } else {
            if (!next[project]) continue
            delete next[project]
            changed = true
          }
        }

        return changed ? next : current
      })
      persist()
    },
    remove(project) {
      setStoreState(store, (current) => {
        if (!current[project]) return current
        const next = { ...current }
        delete next[project]
        return next
      })
      persist()
    },
  } satisfies Omit<
    CollapsedProjectStore,
    keyof PicoStore<CollapsedProjectState>
  >)

  return store
}

function useProjectCollapsed(
  store: CollapsedProjectStore,
  project: string,
  searchActive: boolean
) {
  return useSelector(store, (collapsedProjects) =>
    searchActive ? false : Boolean(collapsedProjects[project])
  )
}

type AppSidebarProps = {
  agentSearch: string
  onOpenAgentsDialog: () => void
  visibleProjects: Array<string>
  projectAgentsStore: ProjectAgentsStore
  matchingAgentCount: number
  selectedAgentKeys: Array<string>
  activeAgentId?: string
  activeAgentKey?: string
  pinnedAgentKeys: Array<string>
  emptyStateText: string
  /** The agents show only one state (a count in the machine heading). */
  statusFilterActive?: boolean
  onOpenAddProjectDialog: () => void
  onAgentClick?: (entry: AgentListEntry, modifiers: AgentClickModifiers) => void
  onRenameAgent?: (entry: AgentListEntry) => void
  onDeleteAgent?: (entry: AgentListEntry) => void
  onSetAgentUnread?: (entry: AgentListEntry, unread: boolean) => void
  onMoveAgent?: (entry: AgentListEntry, project: string) => void
  onMoveAgentAnyProject?: (entry: AgentListEntry) => void
  onTogglePinnedAgent?: (entry: AgentListEntry) => void
  onCreateAgentInProject?: (project: string) => void
  onDeleteOldAgentsInProject?: (project: string) => void
  onMarkAgentsRead?: (entries: Array<AgentListEntry>) => void
  onRemoveProject?: (project: string) => void
  onReorderProjects?: (nextProjects: Array<string>) => void
  onOpenArchivedAgents?: () => void
}

type SortableProjectGroupProps = {
  id: string
  disabled: boolean
  children: (args: {
    attributes: Record<string, unknown>
    listeners: Record<string, unknown>
    isDragging: boolean
  }) => React.ReactNode
}

function SortableProjectGroup({
  id,
  disabled,
  children,
}: SortableProjectGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { type: "project", project: id },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {children({
        attributes: disabled
          ? {}
          : (attributes as unknown as Record<string, unknown>),
        listeners: disabled
          ? {}
          : (listeners as unknown as Record<string, unknown>),
        isDragging: disabled ? false : isDragging,
      })}
    </div>
  )
}

type SelectedAgentKeyStore = PicoStore<ReadonlySet<string>> & {
  setKeys: (keys: Array<string>) => void
}

type ActiveSidebarAgentState = {
  agentId: string
  agentKey: string
}

type ActiveSidebarAgentStore = PicoStore<ActiveSidebarAgentState> & {
  setActive: (active: { agentId?: string; agentKey?: string }) => void
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false

  for (const key of left) {
    if (!right.has(key)) return false
  }

  return true
}

function createSelectedAgentKeyStore(): SelectedAgentKeyStore {
  const store = createPicoStore<ReadonlySet<string>>(
    new Set(),
    sameStringSet
  ) as SelectedAgentKeyStore

  Object.assign(store, {
    setKeys(keys) {
      setStoreState(store, new Set(keys.filter(Boolean)))
    },
  } satisfies Omit<SelectedAgentKeyStore, keyof PicoStore<ReadonlySet<string>>>)

  return store
}

function normalizeActiveSidebarAgentKey(agentKey: string | undefined) {
  const key = agentKey?.trim() || ""
  if (!key) return ""
  if (key.startsWith("path:") || key.startsWith("id:")) return key
  if (key.includes("/") || key.includes("\\")) {
    return agentListEntryKey({ path: key })
  }
  return key
}

function createActiveSidebarAgentStore(): ActiveSidebarAgentStore {
  const store = createPicoStore<ActiveSidebarAgentState>({
    agentId: "",
    agentKey: "",
  }) as ActiveSidebarAgentStore

  Object.assign(store, {
    setActive(active) {
      const agentId = active.agentId || ""
      const agentKey = normalizeActiveSidebarAgentKey(active.agentKey)
      setStoreState(store, (current) => {
        if (current.agentId === agentId && current.agentKey === agentKey) {
          return current
        }

        return { agentId, agentKey }
      })
    },
  } satisfies Omit<
    ActiveSidebarAgentStore,
    keyof PicoStore<ActiveSidebarAgentState>
  >)

  return store
}

function useSidebarAgentSelected(
  store: SelectedAgentKeyStore,
  entryKey: string
) {
  return useSelector(store, (selectedKeys) =>
    Boolean(entryKey && selectedKeys.has(entryKey))
  )
}

function useSidebarAgentActive(
  store: ActiveSidebarAgentStore,
  entryKey: string,
  agentId: string | undefined
) {
  return useSelector(store, (active) => {
    if (active.agentKey && entryKey === active.agentKey) return true
    return Boolean(active.agentId && agentId === active.agentId)
  })
}

type SidebarAgentItemProps = {
  entryKey: string
  /** The row is in a project or the pinned group, under its line. */
  inProject?: boolean
  projectAgentsStore: ProjectAgentsStore
  activeAgentStore: ActiveSidebarAgentStore
  selectedAgentKeyStore: SelectedAgentKeyStore
  isPinned: boolean
  isMobile: boolean
  overlay: boolean
  /** False for an agent of another machine: it cannot move here. */
  agentDraggable?: boolean
  moveTargetProjects: Array<string>
  setOpenMobile: (open: boolean) => void
  onAgentClick?: (entry: AgentListEntry, modifiers: AgentClickModifiers) => void
  onRenameAgent?: (entry: AgentListEntry) => void
  onDeleteAgent?: (entry: AgentListEntry) => void
  onSetAgentUnread?: (entry: AgentListEntry, unread: boolean) => void
  onMoveAgent?: (entry: AgentListEntry, project: string) => void
  onMoveAgentAnyProject?: (entry: AgentListEntry) => void
  onTogglePinnedAgent?: (entry: AgentListEntry) => void
}

function SidebarAgentItem({
  entryKey,
  inProject = false,
  projectAgentsStore,
  activeAgentStore,
  selectedAgentKeyStore,
  isPinned,
  isMobile,
  overlay,
  agentDraggable = true,
  moveTargetProjects,
  setOpenMobile,
  onAgentClick,
  onRenameAgent,
  onDeleteAgent,
  onSetAgentUnread,
  onMoveAgent,
  onMoveAgentAnyProject,
  onTogglePinnedAgent,
}: SidebarAgentItemProps) {
  const entry = useProjectAgentEntry(projectAgentsStore, entryKey)
  const subagentDepth = useSelector(
    projectAgentsStore,
    (state) => state.depthByKey.get(entryKey) ?? 0
  )
  // An agent in a project is one level in, under the project's line.
  const nestingDepth = (inProject ? 1 : 0) + subagentDepth
  const isSelected = useSidebarAgentSelected(selectedAgentKeyStore, entryKey)
  const isActive = useSidebarAgentActive(activeAgentStore, entryKey, entry?.id)
  const showAgentPreviews = useShowAgentPreviews()
  const dragDisabled = !agentDraggable || isMobile || overlay || !entry?.path
  const draggable = useDraggable({
    id: `agent:${entryKey}`,
    disabled: dragDisabled,
    data: {
      type: "agent",
      entry,
      entryKey,
      sourceProject: entry?.cwd || "",
    },
  })
  const rowRef = React.useRef<HTMLDivElement | null>(null)
  const { setNodeRef: setDraggableNodeRef } = draggable
  const setRowRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      rowRef.current = node
      setDraggableNodeRef(node)
    },
    [setDraggableNodeRef]
  )
  // While the app modifier is held, the row shows its Mod+1…9 number in
  // place of its timestamp.
  const agentNumber = useSidebarAgentNumber(rowRef)
  const agentNumberLabel =
    agentNumber > 0 ? formatShortcutLabel(appShortcut(String(agentNumber))) : ""

  if (!entry) return null
  const timestamp =
    entry.lastMessageAt || entry.modified || entry.lastUserMessageAt
  const hasTimestamp = isValidSidebarTimestamp(timestamp)
  const lastMessagePreview = showAgentPreviews
    ? entry.lastMessagePreview?.trim() || ""
    : ""
  const pinnedProjectLabel = isPinned
    ? formatFolderName(entry.cwd?.trim() || entry.path?.trim() || "")
    : ""
  const exactTimestamp =
    hasTimestamp && timestamp ? new Date(timestamp).toLocaleString() : undefined
  const showUnread = Boolean(entry.unread) && !entry.streaming
  const isOptimisticAgent = Boolean(
    entry.optimistic || (entry.id?.startsWith("optimistic:") && !entry.path)
  )
  const availableMoveTargetProjects = moveTargetProjects.filter(
    (project) => project && project !== entry.cwd
  )
  const canMoveAnyProject = Boolean(entry.path && onMoveAgentAnyProject)
  const hasMoveTargets =
    Boolean(entry.path && onMoveAgent) && availableMoveTargetProjects.length > 0
  const hasMoveActions = hasMoveTargets || canMoveAnyProject
  const hasAgentActions =
    Boolean(
      (!isOptimisticAgent && onTogglePinnedAgent) ||
      (entry.path && (onRenameAgent || onDeleteAgent || onSetAgentUnread)) ||
      hasMoveActions
    ) && !overlay

  const agentButton = (
    <SidebarMenuButton
      type="button"
      data-sidebar-agent-item
      data-agent-key={entryKey}
      data-current-agent={isActive ? "" : undefined}
      isActive={isActive || isSelected}
      className={cn(
        "relative h-auto min-w-0 items-start gap-2 py-2 pr-(--sidebar-item-pad) pl-(--agent-text-left)",
        (isActive || isSelected) && "text-sidebar-accent-foreground",
        (isActive || isSelected) && nestingDepth === 0 && "bg-sidebar-accent",
        // The hover state uses the whole row (with the trailing controls),
        // so the highlight stays when the pointer is on the timestamp.
        !(isActive || isSelected) &&
          "group-hover/agent:text-sidebar-accent-foreground",
        !(isActive || isSelected) &&
          nestingDepth === 0 &&
          "group-hover/agent:bg-sidebar-accent/50",
        // A subagent row draws its highlight in an inset layer, so the tree
        // lines stay clear. The click area stays the full row width.
        nestingDepth > 0 &&
          "isolate not-data-active:hover:bg-transparent! active:bg-transparent! not-data-active:data-open:hover:bg-transparent! data-active:bg-transparent!"
      )}
      onClick={(event) => {
        onAgentClick?.(entry, {
          multiSelectKey: isSidebarMultiSelectModifier(event),
          shiftKey: event.shiftKey,
        })
        if (isMobile) {
          setOpenMobile(false)
        }
      }}
    >
      {nestingDepth > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 left-(--agent-highlight-start) -z-10 rounded-md",
            isActive || isSelected
              ? "bg-sidebar-accent"
              : "bg-transparent group-hover/agent:bg-sidebar-accent/50"
          )}
        />
      ) : null}
      {entry.needsInput ? (
        <TitleTooltip title="The agent waits for your answer" side="right">
          <span className={AGENT_STATUS_ICON_CLASS}>
            <MessageCircleQuestionIcon
              className="size-3.5 text-amber-500"
              aria-label="The agent waits for your answer"
            />
          </span>
        </TitleTooltip>
      ) : entry.streaming ? (
        <span className={AGENT_STATUS_ICON_CLASS}>
          <Spinner size="sm" aria-label="Agent working" />
        </span>
      ) : entry.waiting ? (
        <TitleTooltip title={`Waiting on ${entry.waiting}`} side="right">
          <span className={AGENT_STATUS_ICON_CLASS}>
            <HourglassIcon
              className="size-3.5 text-muted-foreground"
              aria-label={`Waiting on ${entry.waiting}`}
            />
          </span>
        </TitleTooltip>
      ) : showUnread ? (
        <span className={AGENT_STATUS_ICON_CLASS}>
          <span
            className="size-2 rounded-full bg-primary"
            aria-label="Agent done"
          />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {entry.title}
            </span>
            {/* An invisible copy of the timestamp (or of the number) keeps
                space for the real one, which sits on top of the row. */}
            {agentNumber > 0 && !overlay ? (
              <Kbd aria-hidden="true" className="invisible shrink-0">
                {agentNumberLabel}
              </Kbd>
            ) : hasTimestamp ? (
              <SidebarAgentTime
                aria-hidden="true"
                value={timestamp}
                className="invisible shrink-0 text-[11px] font-normal"
              />
            ) : null}
          </span>
          {entry.worktreeBranch ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-normal text-sidebar-foreground/50">
              <GitForkIcon className="size-3 shrink-0" aria-label="Worktree" />
              <span className="truncate">{entry.worktreeBranch}</span>
            </span>
          ) : null}
          {lastMessagePreview ? (
            <span className="min-w-0 truncate text-[11px] font-normal text-sidebar-foreground/50">
              {lastMessagePreview}
            </span>
          ) : null}
          {pinnedProjectLabel ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-normal text-sidebar-foreground/50">
              <FolderIcon className="size-3 shrink-0" aria-label="Folder" />
              <span className="truncate">{pinnedProjectLabel}</span>
            </span>
          ) : null}
        </span>
      </span>
    </SidebarMenuButton>
  )

  const agentTrailingControls =
    agentNumber > 0 && !overlay ? (
      <span className="absolute top-(--sidebar-row-icon-top) right-(--sidebar-item-pad) z-10 flex min-w-4 items-center justify-end">
        <Kbd>{agentNumberLabel}</Kbd>
      </span>
    ) : hasTimestamp ? (
      <span className="absolute top-(--sidebar-row-icon-top) right-(--sidebar-item-pad) z-10 flex min-w-4 items-center justify-end">
        <TitleTooltip
          title={isMobile ? undefined : exactTimestamp}
          side="right"
          align="center"
        >
          <SidebarAgentTime
            value={timestamp}
            className="shrink-0 text-[11px] font-normal text-sidebar-foreground/50"
          />
        </TitleTooltip>
      </span>
    ) : null

  const agentRow = (
    <div
      ref={setRowRef}
      className={cn(
        "group/agent relative",
        draggable.isDragging && !overlay && "opacity-40"
      )}
      style={
        {
          ...agentTreeStyle(nestingDepth),
        } as React.CSSProperties
      }
      // A row that cannot move (an agent of another machine) has no drag
      // attributes: they would mark the row as disabled (`aria-disabled`).
      {...(dragDisabled ? {} : draggable.attributes)}
      {...draggable.listeners}
    >
      {agentButton}
      {/* A subagent draws the lines of its parents' levels. Rows of one
          subtree follow each other, so their lines join into one. */}
      {Array.from({ length: subagentDepth }, (_, index) => (
        <SidebarTreeLine
          key={index}
          level={nestingDepth - subagentDepth + index}
        />
      ))}
      {agentTrailingControls}
    </div>
  )

  return (
    <SidebarMenuItem>
      {hasAgentActions ? (
        <ContextMenu>
          <ContextMenuTrigger render={agentRow} />
          <ContextMenuContent className="w-44">
            {onTogglePinnedAgent && !isOptimisticAgent ? (
              <ContextMenuItem onClick={() => onTogglePinnedAgent(entry)}>
                {isPinned ? "Unpin" : "Pin to sidebar"}
              </ContextMenuItem>
            ) : null}
            {onSetAgentUnread && entry.path ? (
              <ContextMenuItem
                onClick={() => onSetAgentUnread(entry, !entry.unread)}
              >
                {entry.unread ? "Mark as read" : "Mark as unread"}
              </ContextMenuItem>
            ) : null}
            {hasMoveActions ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>Move to…</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-72">
                  {availableMoveTargetProjects.map((project) => (
                    <ContextMenuItem
                      key={project}
                      onClick={() => onMoveAgent?.(entry, project)}
                    >
                      <span className="truncate">
                        {formatDisplayPath(project)}
                      </span>
                    </ContextMenuItem>
                  ))}
                  {canMoveAnyProject ? (
                    <ContextMenuItem
                      onClick={() => onMoveAgentAnyProject?.(entry)}
                    >
                      Other project…
                    </ContextMenuItem>
                  ) : null}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : null}
            {onRenameAgent && entry.path ? (
              <ContextMenuItem onClick={() => onRenameAgent(entry)}>
                Rename
              </ContextMenuItem>
            ) : null}
            {onDeleteAgent && entry.path ? (
              <ContextMenuItem
                variant="destructive"
                onClick={() => onDeleteAgent(entry)}
              >
                Archive
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        agentRow
      )}
    </SidebarMenuItem>
  )
}

type ProjectAgentsSnapshot = {
  agentKeys: Array<string>
  isLoadingAgents: boolean
}

type ProjectAgentsState = {
  agentKeysByProject: Record<string, Array<string>>
  entriesByKey: Map<string, AgentListEntry>
  /** Nesting depth per subagent; see `buildAgentDepths`. */
  depthByKey: Map<string, number>
  loadingByProject: Record<string, boolean>
}

export type ProjectAgentsStore = PicoStore<ProjectAgentsState> & {
  setData: (
    agentsByProject: Record<string, Array<AgentListEntry>>,
    loadingByProject: Record<string, boolean>
  ) => void
}

function sameProjectAgentEntry(
  left: AgentListEntry | undefined,
  right: AgentListEntry | undefined
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.path === right.path &&
    left.id === right.id &&
    left.cwd === right.cwd &&
    left.name === right.name &&
    left.title === right.title &&
    left.modified === right.modified &&
    left.lastUserMessageAt === right.lastUserMessageAt &&
    left.lastMessageAt === right.lastMessageAt &&
    left.lastMessagePreview === right.lastMessagePreview &&
    left.messageCount === right.messageCount &&
    JSON.stringify(left.contextUsage ?? null) ===
      JSON.stringify(right.contextUsage ?? null) &&
    Boolean(left.streaming) === Boolean(right.streaming) &&
    Boolean(left.unread) === Boolean(right.unread) &&
    Boolean(left.needsInput) === Boolean(right.needsInput) &&
    left.waiting === right.waiting &&
    left.parent === right.parent &&
    left.worktreeBranch === right.worktreeBranch &&
    Boolean(left.optimistic) === Boolean(right.optimistic)
  )
}

function buildProjectAgentEntryMap(
  agentsByProject: Record<string, Array<AgentListEntry>>
) {
  const entriesByKey = new Map<string, AgentListEntry>()

  for (const agents of Object.values(agentsByProject)) {
    for (const entry of agents) {
      const entryKey = agentListEntryKey(entry)
      if (!entryKey || entriesByKey.has(entryKey)) continue
      entriesByKey.set(entryKey, entry)
    }
  }

  return entriesByKey
}

/** Agents with each subagent after its parent, in list order. */
function nestSubagents(agents: Array<AgentListEntry>) {
  const ids = new Set(agents.flatMap((entry) => (entry.id ? [entry.id] : [])))
  const subagentsOf = new Map<string, Array<AgentListEntry>>()
  const roots: Array<AgentListEntry> = []
  for (const entry of agents) {
    if (entry.parent && entry.parent !== entry.id && ids.has(entry.parent)) {
      const siblings = subagentsOf.get(entry.parent) ?? []
      siblings.push(entry)
      subagentsOf.set(entry.parent, siblings)
    } else {
      roots.push(entry)
    }
  }
  if (subagentsOf.size === 0) return agents
  const ordered: Array<AgentListEntry> = []
  const seen = new Set<AgentListEntry>()
  const visit = (entry: AgentListEntry) => {
    if (seen.has(entry)) return
    seen.add(entry)
    ordered.push(entry)
    for (const subagent of subagentsOf.get(entry.id ?? "") ?? [])
      visit(subagent)
  }
  for (const root of roots) visit(root)
  for (const entry of agents) visit(entry)
  return ordered
}

const MAX_AGENT_NESTING_DEPTH = 4

/**
 * The nesting depth of each subagent, in nested list order: 1 for a
 * subagent of a top-level agent, 2 for its subagent, and so on. Top-level
 * agents have no entry.
 */
function buildAgentDepths(
  agentsByProject: Record<string, Array<AgentListEntry>>
) {
  const depthByKey = new Map<string, number>()

  for (const agents of Object.values(agentsByProject)) {
    const ids = new Set(agents.flatMap((entry) => (entry.id ? [entry.id] : [])))
    const byId = new Map<string, AgentListEntry>()
    for (const entry of agents) {
      if (entry.id && !byId.has(entry.id)) byId.set(entry.id, entry)
    }
    for (const entry of agents) {
      const key = agentListEntryKey(entry)
      if (!key || depthByKey.has(key)) continue
      let depth = 0
      let current: AgentListEntry | undefined = entry
      const seen = new Set<AgentListEntry>()
      while (current && depth < MAX_AGENT_NESTING_DEPTH) {
        if (seen.has(current)) break
        seen.add(current)
        const parent: string | undefined = current.parent
        if (!parent || parent === current.id || !ids.has(parent)) break
        depth += 1
        current = byId.get(parent)
      }
      if (depth > 0) depthByKey.set(key, depth)
    }
  }

  return depthByKey
}

/** Status icon slot of an agent row, on the sidebar icon column. */
const AGENT_STATUS_ICON_CLASS =
  "absolute top-(--sidebar-row-icon-top) left-(--agent-slot-left) flex size-(--sidebar-icon) items-center justify-center"

/**
 * CSS variables for an agent row at a nesting depth (1 for an agent in a
 * project, more for subagents). The row padding, status icon, and
 * indented highlight read them.
 *
 *   --agent-slot-left        x of the status slot: one gap after the
 *                              highlight edge
 *   --agent-text-left        x of the title: one gap after the slot
 *   --agent-highlight-start  x where the highlight starts: just after the
 *                              row's innermost line
 */
function agentTreeStyle(depth: number) {
  return {
    "--agent-slot-left":
      depth === 0
        ? "var(--sidebar-agent-gap)"
        : `calc(var(--sidebar-item-pad) + ${depth} * var(--sidebar-tree-step))`,
    "--agent-text-left":
      "calc(var(--agent-slot-left) + var(--sidebar-icon) + var(--sidebar-agent-gap))",
    "--agent-highlight-start": `calc(${agentTreeLineLeft(Math.max(depth - 1, 0))} + 0.25rem)`,
  }
}

/**
 * x of the line at a level: level 0 is under the project icon, level 1
 * under the status icon of a top-level agent, and so on.
 */
function agentTreeLineLeft(level: number) {
  return `calc(var(--sidebar-item-pad) + var(--sidebar-icon) / 2 + ${level} * var(--sidebar-tree-step))`
}

/** A straight line at a level, over the full height of its box. */
function SidebarTreeLine({ level }: { level: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border"
      style={{ left: agentTreeLineLeft(level) }}
    />
  )
}

function buildProjectAgentKeys(
  agentsByProject: Record<string, Array<AgentListEntry>>
) {
  const agentKeysByProject: Record<string, Array<string>> = {}

  for (const [project, agents] of Object.entries(agentsByProject)) {
    agentKeysByProject[project] = nestSubagents(
      sortSidebarAgents(agents)
    ).flatMap((entry) => {
      const key = agentListEntryKey(entry)
      return key ? [key] : []
    })
  }

  return agentKeysByProject
}

function sameProjectAgentsSnapshot(
  left: ProjectAgentsSnapshot,
  right: ProjectAgentsSnapshot
) {
  return (
    left.isLoadingAgents === right.isLoadingAgents &&
    projectOrderEqual(left.agentKeys, right.agentKeys)
  )
}

function sameProjectAgentsState(
  left: ProjectAgentsState,
  right: ProjectAgentsState
) {
  const projects = new Set([
    ...Object.keys(left.agentKeysByProject),
    ...Object.keys(left.loadingByProject),
    ...Object.keys(right.agentKeysByProject),
    ...Object.keys(right.loadingByProject),
  ])

  for (const project of projects) {
    if (
      !projectOrderEqual(
        left.agentKeysByProject[project] ?? EMPTY_PROJECT_AGENT_KEYS,
        right.agentKeysByProject[project] ?? EMPTY_PROJECT_AGENT_KEYS
      ) ||
      Boolean(left.loadingByProject[project]) !==
        Boolean(right.loadingByProject[project])
    ) {
      return false
    }
  }

  const entryKeys = new Set([
    ...left.entriesByKey.keys(),
    ...right.entriesByKey.keys(),
  ])

  for (const entryKey of entryKeys) {
    if (
      !sameProjectAgentEntry(
        left.entriesByKey.get(entryKey),
        right.entriesByKey.get(entryKey)
      )
    ) {
      return false
    }
  }

  return true
}

export function createProjectAgentsStore(
  agentsByProject: Record<string, Array<AgentListEntry>>,
  loadingByProject: Record<string, boolean>
): ProjectAgentsStore {
  const store = createPicoStore<ProjectAgentsState>(
    {
      agentKeysByProject: buildProjectAgentKeys(agentsByProject),
      entriesByKey: buildProjectAgentEntryMap(agentsByProject),
      depthByKey: buildAgentDepths(agentsByProject),
      loadingByProject,
    },
    sameProjectAgentsState
  ) as ProjectAgentsStore

  Object.assign(store, {
    setData(nextAgentsByProject, nextLoadingByProject) {
      setStoreState(store, {
        agentKeysByProject: buildProjectAgentKeys(nextAgentsByProject),
        entriesByKey: buildProjectAgentEntryMap(nextAgentsByProject),
        depthByKey: buildAgentDepths(nextAgentsByProject),
        loadingByProject: nextLoadingByProject,
      })
    },
  } satisfies Omit<ProjectAgentsStore, keyof PicoStore<ProjectAgentsState>>)

  return store
}

function useProjectAgents(store: ProjectAgentsStore, project: string) {
  return useSelector(
    store,
    (state) => ({
      agentKeys: state.agentKeysByProject[project] ?? EMPTY_PROJECT_AGENT_KEYS,
      isLoadingAgents: Boolean(state.loadingByProject[project]),
    }),
    { compare: sameProjectAgentsSnapshot }
  )
}

function useProjectAgentEntry(store: ProjectAgentsStore, entryKey: string) {
  return useSelector(store, (state) => state.entriesByKey.get(entryKey), {
    compare: sameProjectAgentEntry,
  })
}

type ProjectAgentGroupProps = {
  project: string
  projectAgentsStore: ProjectAgentsStore
  collapsedProjectStore: CollapsedProjectStore
  /** The groups that an Option-click expands or collapses together. */
  collapseAllKeys: Array<string>
  searchActive: boolean
  moveTargetProjects: Array<string>
  activeAgentStore: ActiveSidebarAgentStore
  selectedAgentKeyStore: SelectedAgentKeyStore
  pinnedAgentKeys: Array<string>
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  /** False for the agents of another machine. */
  agentsDraggable?: boolean
  isDragging?: boolean
  isAgentDropTarget?: boolean
  overlay?: boolean
  attributes?: Record<string, unknown>
  listeners?: Record<string, unknown>
  onAgentClick?: (entry: AgentListEntry, modifiers: AgentClickModifiers) => void
  onRenameAgent?: (entry: AgentListEntry) => void
  onDeleteAgent?: (entry: AgentListEntry) => void
  onSetAgentUnread?: (entry: AgentListEntry, unread: boolean) => void
  onMoveAgent?: (entry: AgentListEntry, project: string) => void
  onMoveAgentAnyProject?: (entry: AgentListEntry) => void
  onTogglePinnedAgent?: (entry: AgentListEntry) => void
  onCreateAgentInProject?: (project: string) => void
  onDeleteOldAgentsInProject?: (project: string) => void
  onMarkAgentsRead?: (entries: Array<AgentListEntry>) => void
  onRemoveProject?: (project: string) => void
}

function projectUnreadAgents(state: ProjectAgentsState, project: string) {
  const entries: Array<AgentListEntry> = []
  for (const entryKey of state.agentKeysByProject[project] ?? []) {
    const entry = state.entriesByKey.get(entryKey)
    if (entry?.unread && entry.path) entries.push(entry)
  }
  return entries
}

type ProjectStatusCounts = {
  working: number
  waiting: number
  done: number
}

/** The same counts as the machine heading, for the agents of one project. */
function projectStatusCounts(
  state: ProjectAgentsState,
  project: string
): ProjectStatusCounts {
  const counts = { working: 0, waiting: 0, done: 0 }
  for (const entryKey of state.agentKeysByProject[project] ?? []) {
    const entry = state.entriesByKey.get(entryKey)
    if (!entry) continue
    if (agentMatchesStatusFilter(entry, "working")) counts.working++
    if (agentMatchesStatusFilter(entry, "waiting")) counts.waiting++
    if (agentMatchesStatusFilter(entry, "done")) counts.done++
  }
  return counts
}

function sameProjectStatusCounts(
  left: ProjectStatusCounts,
  right: ProjectStatusCounts
) {
  return (
    left.working === right.working &&
    left.waiting === right.waiting &&
    left.done === right.done
  )
}

/**
 * A count in a project heading. Like the counts in the machine heading, a
 * click turns its state on or off; more than one can be on. The project
 * shows only its agents with a state that is on.
 */
function ProjectCountButton({
  project,
  filter,
  count,
  activeFilter,
  disabled,
  title,
  className,
  onToggle,
  children,
}: {
  project: string
  filter: AgentStatusFilter
  count: number
  activeFilter: AgentStatusFilters | null
  disabled: boolean
  title: string
  className?: string
  onToggle: (filter: AgentStatusFilter) => void
  children: React.ReactNode
}) {
  const active = Boolean(activeFilter?.includes(filter))
  // The active filter keeps its button at 0, so you can remove it.
  if (count === 0 && !active) return null
  return (
    <TitleTooltip
      title={active ? `Show all agents` : `Show only ${title.toLowerCase()}`}
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-pressed={active}
        aria-label={`${count} ${title.toLowerCase()} in ${project}`}
        className={cn(
          "h-6 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-100",
          active &&
            "bg-sidebar-accent text-sidebar-foreground ring-1 ring-sidebar-border",
          className
        )}
        onClick={() => onToggle(filter)}
      >
        {children}
        {count}
      </Button>
    </TitleTooltip>
  )
}

function ProjectCounts({
  project,
  counts,
  activeFilter,
  disabled,
  onToggle,
}: {
  project: string
  counts: ProjectStatusCounts
  activeFilter: AgentStatusFilters | null
  disabled: boolean
  onToggle: (filter: AgentStatusFilter) => void
}) {
  const shared = { project, activeFilter, disabled, onToggle }
  return (
    <span className="flex shrink-0 items-center">
      <ProjectCountButton
        {...shared}
        filter="waiting"
        count={counts.waiting}
        title="Waiting for you"
        className="text-amber-500 hover:text-amber-500"
      >
        <MessageCircleQuestionIcon className="size-3" />
      </ProjectCountButton>
      <ProjectCountButton
        {...shared}
        filter="working"
        count={counts.working}
        title="Working"
      >
        <Spinner size="xs" />
      </ProjectCountButton>
      <ProjectCountButton
        {...shared}
        filter="done"
        count={counts.done}
        title="Done"
      >
        <span className="size-2 rounded-full bg-primary" />
      </ProjectCountButton>
    </span>
  )
}

const ProjectAgentGroup = React.memo(function ProjectAgentGroup({
  project,
  projectAgentsStore,
  collapsedProjectStore,
  collapseAllKeys,
  searchActive,
  moveTargetProjects,
  activeAgentStore,
  selectedAgentKeyStore,
  pinnedAgentKeys,
  isMobile,
  setOpenMobile,
  agentsDraggable,
  isDragging,
  isAgentDropTarget,
  overlay = false,
  attributes,
  listeners,
  onAgentClick,
  onRenameAgent,
  onDeleteAgent,
  onSetAgentUnread,
  onMoveAgent,
  onMoveAgentAnyProject,
  onTogglePinnedAgent,
  onCreateAgentInProject,
  onDeleteOldAgentsInProject,
  onMarkAgentsRead,
  onRemoveProject,
}: ProjectAgentGroupProps) {
  const [renderCount, setRenderCount] = React.useState(
    INITIAL_PROJECT_AGENT_RENDER_COUNT
  )
  const { isLoadingAgents, agentKeys: allAgentKeys } = useProjectAgents(
    projectAgentsStore,
    project
  )
  const [statusFilter, setStatusFilter] =
    React.useState<AgentStatusFilters | null>(null)
  const agentKeys = useSelector(
    projectAgentsStore,
    (state) => {
      const keys = state.agentKeysByProject[project] ?? EMPTY_PROJECT_AGENT_KEYS
      if (!statusFilter) return keys
      return keys.filter((entryKey) => {
        const entry = state.entriesByKey.get(entryKey)
        return entry ? agentMatchesStatusFilter(entry, statusFilter) : false
      })
    },
    { compare: projectOrderEqual }
  )
  const collapsed = useProjectCollapsed(
    collapsedProjectStore,
    project,
    searchActive
  )
  const hasUnreadAgents = useSelector(
    projectAgentsStore,
    (state) => projectUnreadAgents(state, project).length > 0
  )
  const statusCounts = useSelector(
    projectAgentsStore,
    (state) => projectStatusCounts(state, project),
    { compare: sameProjectStatusCounts }
  )
  const markAgentsRead = () => {
    onMarkAgentsRead?.(projectUnreadAgents(projectAgentsStore.state, project))
  }
  const pinnedAgentKeySet = new Set(pinnedAgentKeys)
  const unpinnedAgentKeys = agentKeys.filter(
    (entryKey) => !pinnedAgentKeySet.has(entryKey)
  )
  const visibleCount = searchActive
    ? unpinnedAgentKeys.length
    : Math.min(unpinnedAgentKeys.length, renderCount)
  const visibleAgentKeys = unpinnedAgentKeys.slice(0, visibleCount)
  const hasMoreAgents = visibleCount < unpinnedAgentKeys.length
  const altKeyHeld = useAltKeyHeld()
  // Holding Option turns "Show N more" into "Show less".
  const showLess =
    altKeyHeld &&
    !searchActive &&
    visibleCount > INITIAL_PROJECT_AGENT_RENDER_COUNT
  const showTreeLine = !overlay && visibleAgentKeys.length > 0
  const showLoadingSpinner = useDelayedTrue(
    isLoadingAgents,
    SIDEBAR_LOADING_SPINNER_DELAY_MS
  )
  const showLoadingState = isLoadingAgents && allAgentKeys.length === 0
  const showHeaderLoadingSpinner =
    showLoadingSpinner && unpinnedAgentKeys.length === 0 && collapsed
  const hasProjectActions =
    !overlay &&
    Boolean(
      onCreateAgentInProject ||
      onDeleteOldAgentsInProject ||
      onMarkAgentsRead ||
      onRemoveProject
    )

  const projectHeader = (
    // Left item-pad puts the folder icon on the sidebar icon column. The
    // new-agent button stays flush right: its item-size box already holds
    // the item-pad, so its icon ends on the right content edge.
    <div className="flex items-center gap-2 rounded-lg pl-(--sidebar-item-pad)">
      <CollapsibleTrigger
        type="button"
        className={cn(
          "group/project-label flex min-w-0 flex-1 cursor-default items-center gap-2 text-left text-sm text-sidebar-foreground"
        )}
        disabled={searchActive || overlay}
        {...(attributes ?? {})}
        {...(listeners ?? {})}
      >
        <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
        <span className="max-w-full min-w-0">
          <ProjectPathLabel path={project} />
        </span>
        {!searchActive && !overlay ? (
          collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/project-label:opacity-100 group-focus-visible/project-label:opacity-100" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/project-label:opacity-100 group-focus-visible/project-label:opacity-100" />
          )
        ) : null}
        {showHeaderLoadingSpinner ? (
          <Spinner size="xs" className="shrink-0" />
        ) : null}
      </CollapsibleTrigger>

      <ProjectCounts
        project={project}
        counts={statusCounts}
        activeFilter={statusFilter}
        disabled={overlay}
        onToggle={(filter) => {
          collapsedProjectStore.setCollapsed(project, false)
          setStatusFilter((current) => toggleStatusFilter(current, filter))
        }}
      />

      {onCreateAgentInProject && !overlay && !isMobile ? (
        <TitleTooltip title={`Create an agent in ${project}`}>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            onClick={() => onCreateAgentInProject(project)}
          >
            <SquarePenIcon className="size-4" />
          </Button>
        </TitleTooltip>
      ) : null}

      {hasProjectActions && isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                aria-label={`Project actions for ${project}`}
              />
            }
          >
            <EllipsisVerticalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {onCreateAgentInProject ? (
              <DropdownMenuItem onClick={() => onCreateAgentInProject(project)}>
                New agent
              </DropdownMenuItem>
            ) : null}
            {onDeleteOldAgentsInProject ? (
              <DropdownMenuItem
                onClick={() => onDeleteOldAgentsInProject(project)}
              >
                Archive old agents…
              </DropdownMenuItem>
            ) : null}
            {onMarkAgentsRead ? (
              <DropdownMenuItem
                disabled={!hasUnreadAgents}
                onClick={markAgentsRead}
              >
                Mark all as read
              </DropdownMenuItem>
            ) : null}
            {onRemoveProject ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemoveProject(project)}
              >
                Remove from sidebar
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )

  return (
    <Collapsible
      data-sidebar-agent-group={overlay ? undefined : ""}
      open={!collapsed}
      onOpenChange={(open, details) => {
        if (searchActive || overlay) return
        if (isAltChange(details)) {
          collapsedProjectStore.setAll(collapseAllKeys, !open)
          return
        }
        collapsedProjectStore.setCollapsed(project, !open)
      }}
      className={cn(
        "rounded-lg py-1",
        overlay && "bg-sidebar shadow-lg ring-1 ring-sidebar-border/70",
        isAgentDropTarget &&
          !overlay &&
          "bg-sidebar-accent/40 ring-1 ring-sidebar-ring/50",
        isDragging && !overlay && "opacity-0"
      )}
    >
      <SidebarGroup className="px-0 py-0">
        {hasProjectActions && !isMobile ? (
          <ContextMenu>
            <ContextMenuTrigger render={projectHeader} />
            <ContextMenuContent className="w-48">
              {onCreateAgentInProject ? (
                <ContextMenuItem
                  onClick={() => onCreateAgentInProject(project)}
                >
                  New agent
                </ContextMenuItem>
              ) : null}
              {onDeleteOldAgentsInProject ? (
                <ContextMenuItem
                  onClick={() => onDeleteOldAgentsInProject(project)}
                >
                  Archive old agents…
                </ContextMenuItem>
              ) : null}
              {onMarkAgentsRead ? (
                <ContextMenuItem
                  disabled={!hasUnreadAgents}
                  onClick={markAgentsRead}
                >
                  Mark all as read
                </ContextMenuItem>
              ) : null}
              {onRemoveProject ? (
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => onRemoveProject(project)}
                >
                  Remove from sidebar
                </ContextMenuItem>
              ) : null}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          projectHeader
        )}

        {!overlay ? (
          <CollapsibleContent>
            <SidebarGroupContent>
              {showLoadingState ? (
                <div className="flex items-center gap-2 p-2 text-sm text-sidebar-foreground/70">
                  {showLoadingSpinner ? (
                    <Spinner size="xs" />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  Loading agents…
                </div>
              ) : unpinnedAgentKeys.length > 0 ? (
                // The project's line runs down its agents and "Show more".
                <div className="relative flex flex-col">
                  {showTreeLine ? <SidebarTreeLine level={0} /> : null}
                  <SidebarMenu>
                    {visibleAgentKeys.map((entryKey) => (
                      <SidebarAgentItem
                        key={entryKey}
                        entryKey={entryKey}
                        inProject
                        projectAgentsStore={projectAgentsStore}
                        activeAgentStore={activeAgentStore}
                        selectedAgentKeyStore={selectedAgentKeyStore}
                        isPinned={pinnedAgentKeys.includes(entryKey)}
                        isMobile={isMobile}
                        overlay={overlay}
                        agentDraggable={agentsDraggable}
                        moveTargetProjects={moveTargetProjects}
                        setOpenMobile={setOpenMobile}
                        onAgentClick={onAgentClick}
                        onRenameAgent={onRenameAgent}
                        onDeleteAgent={onDeleteAgent}
                        onSetAgentUnread={onSetAgentUnread}
                        onMoveAgent={onMoveAgent}
                        onMoveAgentAnyProject={onMoveAgentAnyProject}
                        onTogglePinnedAgent={onTogglePinnedAgent}
                      />
                    ))}
                  </SidebarMenu>

                  {hasMoreAgents || showLess ? (
                    <div
                      className="flex flex-col"
                      style={agentTreeStyle(1) as React.CSSProperties}
                    >
                      <Button
                        variant="ghost"
                        className="h-8 justify-start pl-(--agent-text-left) text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                        onClick={() => {
                          if (showLess) {
                            setRenderCount(INITIAL_PROJECT_AGENT_RENDER_COUNT)
                            return
                          }
                          setRenderCount((current) =>
                            Math.min(
                              unpinnedAgentKeys.length,
                              current + PROJECT_AGENT_LOAD_MORE_COUNT
                            )
                          )
                        }}
                      >
                        {showLess
                          ? "Show less"
                          : `Show ${Math.min(
                              PROJECT_AGENT_LOAD_MORE_COUNT,
                              unpinnedAgentKeys.length - visibleCount
                            )} more`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="p-2 text-sm text-sidebar-foreground/70">
                  {/* "Unpinned" only when agents are pinned. */}
                  {pinnedAgentKeys.length === 0
                    ? searchActive || statusFilter
                      ? "No matching agents."
                      : "No agents."
                    : searchActive || statusFilter
                      ? "No matching unpinned agents."
                      : "No unpinned agents."}
                </div>
              )}
            </SidebarGroupContent>
          </CollapsibleContent>
        ) : null}
      </SidebarGroup>
    </Collapsible>
  )
})

type PinnedAgentGroupProps = {
  pinnedAgentKeys: Array<string>
  /** The group is inside another sidebar group that already adds the side gutter. */
  nested?: boolean
  projectAgentsStore: ProjectAgentsStore
  collapsedProjectStore: CollapsedProjectStore
  /** The groups that an Option-click expands or collapses together. */
  collapseAllKeys: Array<string>
  searchActive: boolean
  activeAgentStore: ActiveSidebarAgentStore
  selectedAgentKeyStore: SelectedAgentKeyStore
  isMobile: boolean
  moveTargetProjects: Array<string>
  setOpenMobile: (open: boolean) => void
  /** False for the agents of another machine. */
  agentsDraggable?: boolean
  onAgentClick?: (entry: AgentListEntry, modifiers: AgentClickModifiers) => void
  onRenameAgent?: (entry: AgentListEntry) => void
  onDeleteAgent?: (entry: AgentListEntry) => void
  onSetAgentUnread?: (entry: AgentListEntry, unread: boolean) => void
  onMoveAgent?: (entry: AgentListEntry, project: string) => void
  onMoveAgentAnyProject?: (entry: AgentListEntry) => void
  onTogglePinnedAgent?: (entry: AgentListEntry) => void
}

function PinnedAgentGroup({
  pinnedAgentKeys,
  nested = false,
  projectAgentsStore,
  collapsedProjectStore,
  collapseAllKeys,
  searchActive,
  activeAgentStore,
  selectedAgentKeyStore,
  isMobile,
  moveTargetProjects,
  setOpenMobile,
  agentsDraggable,
  onAgentClick,
  onRenameAgent,
  onDeleteAgent,
  onSetAgentUnread,
  onMoveAgent,
  onMoveAgentAnyProject,
  onTogglePinnedAgent,
}: PinnedAgentGroupProps) {
  const collapsed = useProjectCollapsed(
    collapsedProjectStore,
    PINNED_AGENT_GROUP_COLLAPSE_KEY,
    searchActive
  )

  if (pinnedAgentKeys.length === 0) return null

  return (
    <Collapsible
      data-sidebar-agent-group=""
      open={!collapsed}
      onOpenChange={(open, details) => {
        if (searchActive) return
        if (isAltChange(details)) {
          collapsedProjectStore.setAll(collapseAllKeys, !open)
          return
        }
        collapsedProjectStore.setCollapsed(
          PINNED_AGENT_GROUP_COLLAPSE_KEY,
          !open
        )
      }}
    >
      <SidebarGroup className={cn("py-1", nested && "px-0")}>
        {/* Same header shape as a project, so the icon sits on the
            sidebar icon column and the line starts under it. */}
        <div className="flex h-(--sidebar-item-size) items-center gap-2 rounded-lg pl-(--sidebar-item-pad)">
          <CollapsibleTrigger
            type="button"
            className="group/pinned-label flex min-w-0 flex-1 cursor-default items-center gap-2 text-left text-sm text-sidebar-foreground"
            disabled={searchActive}
          >
            <PinIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
            <span className="min-w-0 truncate">Pinned</span>
            {!searchActive ? (
              collapsed ? (
                <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pinned-label:opacity-100 group-focus-visible/pinned-label:opacity-100" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pinned-label:opacity-100 group-focus-visible/pinned-label:opacity-100" />
              )
            ) : null}
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>
            <div className="relative flex flex-col">
              <SidebarTreeLine level={0} />
              <SidebarMenu>
                {pinnedAgentKeys.map((entryKey) => (
                  <SidebarAgentItem
                    key={entryKey}
                    entryKey={entryKey}
                    inProject
                    projectAgentsStore={projectAgentsStore}
                    activeAgentStore={activeAgentStore}
                    selectedAgentKeyStore={selectedAgentKeyStore}
                    isPinned
                    isMobile={isMobile}
                    overlay={false}
                    agentDraggable={agentsDraggable}
                    moveTargetProjects={moveTargetProjects}
                    setOpenMobile={setOpenMobile}
                    onAgentClick={onAgentClick}
                    onRenameAgent={onRenameAgent}
                    onDeleteAgent={onDeleteAgent}
                    onSetAgentUnread={onSetAgentUnread}
                    onMoveAgent={onMoveAgent}
                    onMoveAgentAnyProject={onMoveAgentAnyProject}
                    onTogglePinnedAgent={onTogglePinnedAgent}
                  />
                ))}
              </SidebarMenu>
            </div>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

type AppSidebarSearchButtonProps = {
  onOpenAgentsDialog: () => void
}

function AppSidebarSearchButton({
  onOpenAgentsDialog,
}: AppSidebarSearchButtonProps) {
  return (
    <SidebarGroup className="pb-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton type="button" onClick={onOpenAgentsDialog}>
            <SearchIcon />
            <span>Search agents…</span>
            <span className="ml-auto hidden items-center md:flex">
              <Kbd>{formatShortcutLabel(appShortcut("S"))}</Kbd>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

type AppSidebarProjectsHeaderProps = {
  agentSearch: string
  matchingAgentCount: number
  collapsed: boolean
  onOpenAddProjectDialog: () => void
}

function AppSidebarProjectsHeader({
  agentSearch,
  matchingAgentCount,
  collapsed,
  onOpenAddProjectDialog,
}: AppSidebarProjectsHeaderProps) {
  const searchActive = agentSearch.trim().length > 0

  return (
    // pr-0: the item-size icon buttons already hold the item-pad, so their
    // icons end on the right content edge, with the search Kbd.
    <SidebarGroupLabel className="justify-between gap-3 pr-0">
      <CollapsibleTrigger
        type="button"
        className="group/projects-label flex min-w-0 flex-1 items-center gap-2 text-left outline-hidden"
      >
        <span className="min-w-0 truncate">
          {searchActive
            ? `${matchingAgentCount} matching agent${matchingAgentCount === 1 ? "" : "s"}`
            : "Projects"}
        </span>
        {!searchActive ? (
          collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
          )
        ) : null}
      </CollapsibleTrigger>
      <ProjectActions onOpenAddProjectDialog={onOpenAddProjectDialog} />
    </SidebarGroupLabel>
  )
}

/**
 * Add project. It is on the "Projects" heading, or on each machine
 * heading when the sidebar has a group for each machine. The shortcut adds
 * a project on the machine that shows, so only its button shows the key.
 */
export function ProjectActions({
  onOpenAddProjectDialog,
  title = "Add project",
  showShortcut = true,
}: {
  onOpenAddProjectDialog: () => void
  title?: string
  showShortcut?: boolean
}) {
  return (
    <span className="flex items-center gap-1">
      <TitleTooltip
        title={title}
        kbd={showShortcut ? formatShortcutLabel(appShortcut("D")) : undefined}
      >
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          onClick={onOpenAddProjectDialog}
          aria-label={title}
        >
          <FolderPlusIcon />
        </Button>
      </TitleTooltip>
    </span>
  )
}

const NO_MOVE_TARGET_PROJECTS: Array<string> = []

/** An agent of another machine, from its summary, as a sidebar entry. */
function machineSummaryEntry(agent: MachineAgentSummary): AgentListEntry {
  return {
    id: agent.id,
    // The agent path of a Pico server. With it, the rename and archive
    // routes find the agent, and the key of the row matches the pinned
    // agent keys of that machine.
    path: `pico:${agent.id}`,
    cwd: agent.project || agent.cwd,
    title: agent.title,
    ...(agent.lastMessageAt
      ? { lastMessageAt: new Date(agent.lastMessageAt).toISOString() }
      : {}),
    ...(agent.lastUserMessageAt
      ? {
          lastUserMessageAt: new Date(agent.lastUserMessageAt).toISOString(),
        }
      : {}),
    streaming: agent.busy,
    needsInput: agent.needsInput,
    ...(agent.waiting ? { waiting: agent.waiting } : {}),
    unread: isMachineAgentUnread(agent),
    ...(agent.parent ? { parent: agent.parent } : {}),
  }
}

/**
 * The sidebar projects of a machine with their agents, as the machine
 * shows them when it is the machine of the page.
 */
function groupMachineAgents(machine: MachineInfo) {
  const summary = machine.summary
  const projects = summary?.projects ?? []
  const agentsByProject: Record<string, Array<AgentListEntry>> = {}
  for (const project of projects) agentsByProject[project] = []
  for (const agent of summary?.agents ?? []) {
    const project = agent.project || agent.cwd
    agentsByProject[project]?.push(machineSummaryEntry(agent))
  }
  return { projects, agentsByProject }
}

/**
 * The pinned agent keys of another machine. They are part of the sidebar
 * state that the machine's server keeps, so this starts the sidebar sync of
 * that machine. The sync keeps the local copy and sends changes to it.
 */
function useOtherMachinePinnedAgentKeys(machineId: string, online: boolean) {
  const [keys, setKeys] = React.useState(() =>
    readStoredPinnedAgentKeys(machineId)
  )

  React.useEffect(() => {
    if (!online) return
    const contextId = viewerContextIdForSummaries()
    if (contextId) startSidebarSync(machineId, contextId)
  }, [machineId, online])

  usePicoEvent(
    "pico:sidebar-state",
    ({ machineId: changedMachine, changed }) => {
      if (changedMachine !== machineId) return
      if (changed.includes("pinnedAgentKeys"))
        setKeys(readStoredPinnedAgentKeys(machineId))
    }
  )

  const toggle = React.useCallback(
    (key: string) => {
      const current = readStoredPinnedAgentKeys(machineId)
      const next = current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [key, ...current]
      machineLocalStorageSetItem(
        machineId,
        PINNED_AGENTS_STORAGE_KEY,
        JSON.stringify(next)
      )
      setKeys(next)
    },
    [machineId]
  )

  return [keys, toggle] as const
}

/**
 * The projects and agents of another machine of the hub, from its
 * summary. They look like the projects of this machine. A click opens the
 * agent on its machine; the new-agent button of a project opens the
 * machine and starts an agent there. Pin, rename, and archive change the
 * agent on its machine.
 */
export function OtherMachineProjects({ machine }: { machine: MachineInfo }) {
  const { isMobile, setOpenMobile } = useSidebar()
  // Projects that this page removed, hidden until the summary of the
  // machine stops showing them.
  const [removedProjects, setRemovedProjects] = React.useState<
    ReadonlySet<string>
  >(() => new Set())
  const summaryProjects = machine.summary?.projects
  React.useEffect(() => {
    setRemovedProjects((current) => {
      const shown = new Set(summaryProjects ?? [])
      const next = new Set([...current].filter((entry) => shown.has(entry)))
      return next.size === current.size ? current : next
    })
  }, [summaryProjects])
  const allGrouped = React.useMemo(() => {
    const grouped = groupMachineAgents(machine)
    if (removedProjects.size === 0) return grouped
    return {
      ...grouped,
      projects: grouped.projects.filter(
        (project) => !removedProjects.has(project)
      ),
    }
  }, [machine, removedProjects])
  const statusFilter = useAgentStatusFilter(machine.id)
  const [storedPinnedKeys, togglePinnedKey] = useOtherMachinePinnedAgentKeys(
    machine.id,
    machine.state === "online"
  )
  // A click on a count in the machine heading shows only the agents with
  // that state.
  const grouped = React.useMemo(() => {
    if (!statusFilter) return allGrouped
    const pinned = new Set(storedPinnedKeys)
    const filtered = filterProjectAgentsByStatus(
      allGrouped.projects,
      allGrouped.agentsByProject,
      statusFilter,
      (entry) => pinned.has(agentListEntryKey(entry))
    )
    return {
      projects: filtered.visibleProjects,
      agentsByProject: filtered.filteredAgents,
    }
  }, [allGrouped, statusFilter, storedPinnedKeys])
  const [stores] = React.useState(() => {
    const collapsed = createCollapsedProjectStore(
      machine.id,
      // Stored name: do not change.
      `pico-machine-collapsed-directories:${machine.id}`
    )
    collapsed.loadStored()
    return {
      agents: createProjectAgentsStore(grouped.agentsByProject, {}),
      collapsed,
      active: createActiveSidebarAgentStore(),
      selected: createSelectedAgentKeyStore(),
    }
  })

  React.useEffect(() => {
    stores.agents.setData(grouped.agentsByProject, {})
  }, [grouped, stores])

  const online = machine.state === "online"
  // Only the pins of agents in the summary: the summary does not have
  // archived agents, and it stops at 200 agents.
  const pinnedAgentKeys = React.useMemo(() => {
    const known = new Set(
      Object.values(grouped.agentsByProject)
        .flat()
        .map((entry) => agentListEntryKey(entry))
    )
    return storedPinnedKeys.filter((key) => known.has(key))
  }, [grouped, storedPinnedKeys])
  const collapseAllKeys = React.useMemo(
    () => [PINNED_AGENT_GROUP_COLLAPSE_KEY, ...grouped.projects],
    [grouped.projects]
  )
  const [renameEntry, setRenameEntry] = React.useState<AgentListEntry>()
  const [archiveEntry, setArchiveEntry] = React.useState<AgentListEntry>()
  const agentActions = online
    ? {
        onRenameAgent: setRenameEntry,
        onDeleteAgent: setArchiveEntry,
        onTogglePinnedAgent: (entry: AgentListEntry) =>
          togglePinnedKey(agentListEntryKey(entry)),
      }
    : {}
  const openAgent = React.useCallback(
    (entry: AgentListEntry) => {
      if (entry.id)
        openMachineAgent({ machineId: machine.id, agentId: entry.id })
    },
    [machine.id]
  )
  const createAgent = React.useCallback(
    (project: string) => {
      if (isMobile) setOpenMobile(false)
      openMachine(machine.id, {
        action: { type: "new-agent", project },
      })
    },
    [isMobile, machine.id, setOpenMobile]
  )
  // The summary has the project list of the machine's server, so the new
  // list starts from it. The sidebar sync sends it to the machine.
  const removeProject = (project: string) => {
    const next = (summaryProjects ?? []).filter(
      (entry) => entry !== project && !removedProjects.has(entry)
    )
    stores.collapsed.remove(project)
    machineLocalStorageSetItem(
      machine.id,
      SIDEBAR_PROJECTS_STORAGE_KEY,
      JSON.stringify(next)
    )
    setRemovedProjects((current) => new Set([...current, project]))
  }

  // A machine without projects: add the first one there. The heading
  // shows the state of a machine that is not online.
  if (
    statusFilter &&
    grouped.projects.length === 0 &&
    pinnedAgentKeys.length === 0
  )
    return (
      <p className="px-(--sidebar-item-pad) py-1 text-xs text-sidebar-foreground/50">
        No agents with these states.
      </p>
    )
  if (!statusFilter && grouped.projects.length === 0) {
    if (!online) return null
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            className="text-sidebar-foreground/60"
            onClick={() => {
              if (isMobile) setOpenMobile(false)
              openMachine(machine.id, { action: { type: "add-project" } })
            }}
          >
            <FolderPlusIcon className="text-sidebar-foreground/50" />
            <span>Add project…</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <>
      <PinnedAgentGroup
        nested
        pinnedAgentKeys={pinnedAgentKeys}
        projectAgentsStore={stores.agents}
        collapsedProjectStore={stores.collapsed}
        collapseAllKeys={collapseAllKeys}
        searchActive={Boolean(statusFilter)}
        activeAgentStore={stores.active}
        selectedAgentKeyStore={stores.selected}
        isMobile={isMobile}
        moveTargetProjects={NO_MOVE_TARGET_PROJECTS}
        setOpenMobile={setOpenMobile}
        agentsDraggable={false}
        onAgentClick={openAgent}
        {...agentActions}
      />
      {grouped.projects.map((project) => (
        <ProjectAgentGroup
          key={project}
          project={project}
          projectAgentsStore={stores.agents}
          collapsedProjectStore={stores.collapsed}
          collapseAllKeys={collapseAllKeys}
          searchActive={Boolean(statusFilter)}
          moveTargetProjects={NO_MOVE_TARGET_PROJECTS}
          activeAgentStore={stores.active}
          selectedAgentKeyStore={stores.selected}
          pinnedAgentKeys={pinnedAgentKeys}
          isMobile={isMobile}
          setOpenMobile={setOpenMobile}
          agentsDraggable={false}
          onAgentClick={openAgent}
          onCreateAgentInProject={online ? createAgent : undefined}
          onRemoveProject={online ? removeProject : undefined}
          {...agentActions}
        />
      ))}
      <OtherMachineRenameDialog
        machineId={machine.id}
        machineLabel={machine.label}
        entry={renameEntry}
        onOpenChange={(open) => {
          if (!open) setRenameEntry(undefined)
        }}
      />
      <OtherMachineArchiveDialog
        machineId={machine.id}
        machineLabel={machine.label}
        entry={archiveEntry}
        onOpenChange={(open) => {
          if (!open) setArchiveEntry(undefined)
        }}
      />
    </>
  )
}

export function AppSidebar(props: AppSidebarProps) {
  return useAppSidebarView(props)
}

function useAppSidebarView({
  agentSearch,
  onOpenAgentsDialog,
  visibleProjects,
  projectAgentsStore,
  matchingAgentCount,
  selectedAgentKeys,
  activeAgentId,
  activeAgentKey,
  pinnedAgentKeys,
  emptyStateText,
  statusFilterActive = false,
  onOpenAddProjectDialog,
  onAgentClick,
  onRenameAgent,
  onDeleteAgent,
  onSetAgentUnread,
  onMoveAgent,
  onMoveAgentAnyProject,
  onTogglePinnedAgent,
  onCreateAgentInProject,
  onDeleteOldAgentsInProject,
  onMarkAgentsRead,
  onRemoveProject,
  onReorderProjects,
  onOpenArchivedAgents,
}: AppSidebarProps) {
  const machineId = useMachineId()
  const { isMobile, setOpenMobile } = useSidebar()
  const searchActive = agentSearch.trim().length > 0
  // A search or a state filter shows all matching agents, with their
  // groups open, and stops the drag to reorder.
  const listFiltered = searchActive || statusFilterActive
  const projectOrderingEnabled = !listFiltered && visibleProjects.length > 1
  const [activeProject, setActiveProject] = React.useState<string | null>(null)
  const [activeAgentDrag, setActiveAgentDrag] = React.useState<{
    entryKey: string
    entry: AgentListEntry
    sourceProject: string
  } | null>(null)
  const [agentDropProject, setAgentDropProject] = React.useState<string | null>(
    null
  )
  const [previewProjectOrder, setPreviewProjectOrder] =
    React.useState<Array<string> | null>(null)
  const [collapsedProjectStore] = React.useState(() =>
    createCollapsedProjectStore(machineId)
  )
  const [selectedAgentKeyStore] = React.useState(createSelectedAgentKeyStore)
  const [activeAgentStore] = React.useState(createActiveSidebarAgentStore)
  // With a group for each machine, the machine heading replaces the
  // "Projects" heading and takes its buttons, so all machine groups have
  // the same levels: machine, project, agent. A search still shows the
  // heading, with its count of matches.
  const hasMachineGroups = useHasMachineGroups()
  const showProjectsHeader = !hasMachineGroups || searchActive
  const projectsCollapsed = useProjectCollapsed(
    collapsedProjectStore,
    PROJECTS_AGENT_GROUP_COLLAPSE_KEY,
    searchActive
  )
  // An Option-click on the pinned group or a project expands or collapses
  // all of them.
  const collapseAllKeys = React.useMemo(
    () => [PINNED_AGENT_GROUP_COLLAPSE_KEY, ...visibleProjects],
    [visibleProjects]
  )

  React.useLayoutEffect(() => {
    selectedAgentKeyStore.setKeys(selectedAgentKeys)
  }, [selectedAgentKeyStore, selectedAgentKeys])

  React.useLayoutEffect(() => {
    activeAgentStore.setActive({
      agentId: activeAgentId,
      agentKey: activeAgentKey,
    })
  }, [activeAgentId, activeAgentKey, activeAgentStore])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  )

  React.useEffect(() => {
    collapsedProjectStore.loadStored()
  }, [collapsedProjectStore])

  usePicoEvent(
    "pico:sidebar-state",
    ({ machineId: changedMachine, changed }) => {
      if (changedMachine !== machineId) return
      if (changed.includes("collapsedProjects"))
        collapsedProjectStore.loadStored()
    }
  )

  React.useEffect(() => {
    if (projectOrderingEnabled) return
    setActiveProject(null)
    setPreviewProjectOrder(null)
  }, [projectOrderingEnabled])

  const orderedVisibleProjects = (() => {
    if (!previewProjectOrder || previewProjectOrder.length === 0) {
      return visibleProjects
    }

    const visibleProjectSet = new Set(visibleProjects)
    const orderedProjects = previewProjectOrder.filter((project) =>
      visibleProjectSet.has(project)
    )
    const missingProjects = visibleProjects.filter(
      (project) => !orderedProjects.includes(project)
    )

    return [...orderedProjects, ...missingProjects]
  })()

  React.useEffect(() => {
    if (!previewProjectOrder) return
    if (!projectOrderEqual(orderedVisibleProjects, visibleProjects)) {
      return
    }

    setPreviewProjectOrder(null)
  }, [orderedVisibleProjects, previewProjectOrder, visibleProjects])

  const removeProject = (project: string) => {
    collapsedProjectStore.remove(project)
    onRemoveProject?.(project)
  }

  const movePreviewProject = (activeId: string, overId: string) => {
    setPreviewProjectOrder((current) => {
      const baseOrder =
        current && current.length > 0 ? current : visibleProjects
      const oldIndex = baseOrder.indexOf(activeId)
      const newIndex = baseOrder.indexOf(overId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return current
      }
      return arrayMove(baseOrder, oldIndex, newIndex)
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    const activeData = event.active.data.current as
      | {
          type?: string
          entry?: AgentListEntry
          entryKey?: string
          sourceProject?: string
        }
      | undefined

    if (activeData?.type === "agent" && activeData.entry) {
      if (isMobile) return
      setActiveAgentDrag({
        entryKey: activeData.entryKey || String(event.active.id),
        entry: activeData.entry,
        sourceProject: activeData.sourceProject || activeData.entry.cwd || "",
      })
      setAgentDropProject(null)
      return
    }

    if (activeData?.type !== "project" || !projectOrderingEnabled) return
    setActiveProject(String(event.active.id))
    setPreviewProjectOrder(visibleProjects)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const activeData = event.active.data.current as
      | { type?: string; sourceProject?: string }
      | undefined
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""

    if (activeData?.type === "agent") {
      if (isMobile) return
      const overProject = visibleProjects.includes(overId) ? overId : ""
      setAgentDropProject(
        overProject && overProject !== activeData.sourceProject
          ? overProject
          : null
      )
      return
    }

    if (!projectOrderingEnabled) return
    if (!activeId || !overId || activeId === overId) return
    movePreviewProject(activeId, overId)
  }

  const handleDragCancel = () => {
    setActiveProject(null)
    setActiveAgentDrag(null)
    setAgentDropProject(null)
    setPreviewProjectOrder(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const activeData = event.active.data.current as
      | { type?: string; entry?: AgentListEntry; sourceProject?: string }
      | undefined
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""

    if (activeData?.type === "agent") {
      if (isMobile) {
        setActiveAgentDrag(null)
        setAgentDropProject(null)
        return
      }
      const targetProject = visibleProjects.includes(overId) ? overId : ""
      if (
        activeData.entry &&
        targetProject &&
        targetProject !== activeData.sourceProject
      ) {
        onMoveAgent?.(activeData.entry, targetProject)
      }
      setActiveAgentDrag(null)
      setAgentDropProject(null)
      return
    }

    let nextOrder = previewProjectOrder
    if (
      projectOrderingEnabled &&
      (!nextOrder || nextOrder.length === 0) &&
      activeId &&
      overId &&
      activeId !== overId
    ) {
      const oldIndex = visibleProjects.indexOf(activeId)
      const newIndex = visibleProjects.indexOf(overId)
      if (oldIndex !== -1 && newIndex !== -1) {
        nextOrder = arrayMove(visibleProjects, oldIndex, newIndex)
      }
    }

    if (
      nextOrder &&
      nextOrder.length > 0 &&
      !projectOrderEqual(nextOrder, visibleProjects)
    ) {
      onReorderProjects?.(nextOrder)
    }

    setActiveProject(null)
    setPreviewProjectOrder(null)
  }

  // The window draws the sidebar and its machine headings
  // (`window-sidebar.tsx`). This shell fills the slots of its machine when
  // its machine shows.
  const topSlot = useSidebarSlot("top", machineId)
  const contentSlot = useSidebarSlot("content", machineId)
  const bottomSlot = useSidebarSlot("bottom", machineId)

  return (
    <>
      {topSlot
        ? createPortal(
            <AppSidebarSearchButton onOpenAgentsDialog={onOpenAgentsDialog} />,
            topSlot
          )
        : null}
      {contentSlot
        ? createPortal(
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <PinnedAgentGroup
                pinnedAgentKeys={pinnedAgentKeys}
                projectAgentsStore={projectAgentsStore}
                collapsedProjectStore={collapsedProjectStore}
                collapseAllKeys={collapseAllKeys}
                searchActive={listFiltered}
                activeAgentStore={activeAgentStore}
                selectedAgentKeyStore={selectedAgentKeyStore}
                isMobile={isMobile}
                moveTargetProjects={visibleProjects}
                setOpenMobile={setOpenMobile}
                onAgentClick={onAgentClick}
                onRenameAgent={onRenameAgent}
                onDeleteAgent={onDeleteAgent}
                onSetAgentUnread={onSetAgentUnread}
                onMoveAgent={onMoveAgent}
                onTogglePinnedAgent={onTogglePinnedAgent}
              />
              <Collapsible
                open={showProjectsHeader ? !projectsCollapsed : true}
                onOpenChange={(open, details) => {
                  if (searchActive) return
                  // An Option-click also expands or collapses all projects.
                  if (isAltChange(details)) {
                    collapsedProjectStore.setAll(
                      [PROJECTS_AGENT_GROUP_COLLAPSE_KEY, ...visibleProjects],
                      !open
                    )
                    return
                  }
                  collapsedProjectStore.setCollapsed(
                    PROJECTS_AGENT_GROUP_COLLAPSE_KEY,
                    !open
                  )
                }}
              >
                <SidebarGroup
                  className={showProjectsHeader ? "py-1" : "pt-0 pb-1"}
                >
                  {showProjectsHeader ? (
                    <AppSidebarProjectsHeader
                      agentSearch={agentSearch}
                      matchingAgentCount={matchingAgentCount}
                      collapsed={projectsCollapsed}
                      onOpenAddProjectDialog={onOpenAddProjectDialog}
                    />
                  ) : null}
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      {visibleProjects.length === 0 ? (
                        <div className="p-2">
                          <Empty className="rounded-xl border border-dashed bg-sidebar-accent/10 py-10">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <FolderIcon />
                              </EmptyMedia>
                              <EmptyTitle>{emptyStateText}</EmptyTitle>
                            </EmptyHeader>
                          </Empty>
                        </div>
                      ) : (
                        <SortableContext
                          items={orderedVisibleProjects}
                          strategy={verticalListSortingStrategy}
                        >
                          {orderedVisibleProjects.map((project) => {
                            return (
                              <SortableProjectGroup
                                key={project}
                                id={project}
                                disabled={!projectOrderingEnabled}
                              >
                                {({ attributes, listeners, isDragging }) => (
                                  <ProjectAgentGroup
                                    project={project}
                                    projectAgentsStore={projectAgentsStore}
                                    collapsedProjectStore={
                                      collapsedProjectStore
                                    }
                                    collapseAllKeys={collapseAllKeys}
                                    searchActive={listFiltered}
                                    moveTargetProjects={visibleProjects}
                                    activeAgentStore={activeAgentStore}
                                    selectedAgentKeyStore={
                                      selectedAgentKeyStore
                                    }
                                    pinnedAgentKeys={pinnedAgentKeys}
                                    isMobile={isMobile}
                                    setOpenMobile={setOpenMobile}
                                    isDragging={isDragging}
                                    isAgentDropTarget={
                                      agentDropProject === project
                                    }
                                    attributes={attributes}
                                    listeners={listeners}
                                    onAgentClick={onAgentClick}
                                    onRenameAgent={onRenameAgent}
                                    onDeleteAgent={onDeleteAgent}
                                    onSetAgentUnread={onSetAgentUnread}
                                    onMoveAgent={onMoveAgent}
                                    onMoveAgentAnyProject={
                                      onMoveAgentAnyProject
                                    }
                                    onTogglePinnedAgent={onTogglePinnedAgent}
                                    onCreateAgentInProject={
                                      onCreateAgentInProject
                                    }
                                    onDeleteOldAgentsInProject={
                                      onDeleteOldAgentsInProject
                                    }
                                    onMarkAgentsRead={onMarkAgentsRead}
                                    onRemoveProject={
                                      onRemoveProject
                                        ? removeProject
                                        : undefined
                                    }
                                  />
                                )}
                              </SortableProjectGroup>
                            )
                          })}
                        </SortableContext>
                      )}
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>

              <DragOverlay>
                {activeProject ? (
                  <ProjectAgentGroup
                    project={activeProject}
                    projectAgentsStore={projectAgentsStore}
                    collapsedProjectStore={collapsedProjectStore}
                    collapseAllKeys={collapseAllKeys}
                    searchActive={listFiltered}
                    moveTargetProjects={visibleProjects}
                    activeAgentStore={activeAgentStore}
                    selectedAgentKeyStore={selectedAgentKeyStore}
                    pinnedAgentKeys={pinnedAgentKeys}
                    isMobile={isMobile}
                    setOpenMobile={setOpenMobile}
                    overlay
                    onAgentClick={onAgentClick}
                    onRenameAgent={onRenameAgent}
                    onDeleteAgent={onDeleteAgent}
                    onSetAgentUnread={onSetAgentUnread}
                    onMoveAgent={onMoveAgent}
                    onMoveAgentAnyProject={onMoveAgentAnyProject}
                    onTogglePinnedAgent={onTogglePinnedAgent}
                    onCreateAgentInProject={onCreateAgentInProject}
                    onDeleteOldAgentsInProject={onDeleteOldAgentsInProject}
                    onMarkAgentsRead={onMarkAgentsRead}
                    onRemoveProject={
                      onRemoveProject ? removeProject : undefined
                    }
                  />
                ) : activeAgentDrag ? (
                  <SidebarMenu className="w-full rounded-md bg-sidebar shadow-lg ring-1 ring-sidebar-border/70">
                    <SidebarAgentItem
                      entryKey={activeAgentDrag.entryKey}
                      projectAgentsStore={projectAgentsStore}
                      activeAgentStore={activeAgentStore}
                      selectedAgentKeyStore={selectedAgentKeyStore}
                      isPinned={pinnedAgentKeys.includes(
                        activeAgentDrag.entryKey
                      )}
                      isMobile={isMobile}
                      overlay
                      moveTargetProjects={visibleProjects}
                      setOpenMobile={setOpenMobile}
                      onAgentClick={onAgentClick}
                      onRenameAgent={onRenameAgent}
                      onDeleteAgent={onDeleteAgent}
                      onSetAgentUnread={onSetAgentUnread}
                      onMoveAgent={onMoveAgent}
                      onMoveAgentAnyProject={onMoveAgentAnyProject}
                      onTogglePinnedAgent={onTogglePinnedAgent}
                    />
                  </SidebarMenu>
                ) : null}
              </DragOverlay>
            </DndContext>,
            contentSlot
          )
        : null}
      {bottomSlot && onOpenArchivedAgents
        ? createPortal(
            <SidebarGroup className="pt-0">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    className="text-muted-foreground"
                    onClick={() => {
                      if (isMobile) setOpenMobile(false)
                      onOpenArchivedAgents()
                    }}
                  >
                    <ArchiveIcon />
                    <span>Archived agents</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>,
            bottomSlot
          )
        : null}
    </>
  )
}
