import * as React from "react"
import {
  ArrowLeftIcon,
  MessageCircleQuestionIcon,
  WandSparklesIcon,
} from "lucide-react"
import { toast } from "@/lib/pico/toast"

import type {
  ProjectAgentsIndexesResponse,
  ProjectAgentsIndexSnapshot,
  GenerateAgentNameResponse,
  AgentListEntry,
  AgentStatusEvent,
} from "@/lib/pico/api"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { ShortcutButton, ShortcutFooter } from "@/components/ui/shortcut-footer"
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  appShortcut,
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import {
  useMachines,
  type MachineInfo,
  type MachineAgentSummary,
} from "@/features/pico/machine-store"
import { isMachineAgentUnread, MachineStateDot } from "@/features/pico/machines"
import { useIsMobile } from "@/hooks/use-mobile"
import { agentListEntryKey } from "@/lib/pico"
import { openAgent } from "@/lib/pico/machine"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type AgentsDialogScope = "current" | "all"
type AgentsDialogStage = "browse" | "rename" | "delete"

type GenerateAgentNameData = Extract<GenerateAgentNameResponse, { ok: true }>

type AgentStatusByKey = Record<string, Omit<AgentStatusEvent, "type">>

type SelectAgentOptions = {
  replace?: boolean
  agentPath?: string
}

type AppShellAgentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewerContextId: string
  currentProject: string
  knownProjects: Array<string>
  projectAgentsByPath: Record<string, Array<AgentListEntry>>
  agentStatusByKey: AgentStatusByKey
  activeAgentId?: string
  activeAgentPath?: string
  onSelectAgent: (agentId?: string, options?: SelectAgentOptions) => void
  onRenameAgent: (
    path: string,
    name: string
  ) => Promise<boolean> | boolean | void
  onDeleteAgent: (
    targets: Array<AgentListEntry>
  ) => Promise<boolean> | boolean | void
  onError?: (error: unknown) => void
}

export type AppShellAgentsDialogHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

function tildePath(value: string) {
  return value
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

type OtherMachineAgentItem = {
  key: string
  machine: MachineInfo
  agent: MachineAgentSummary
}

/**
 * The agents of the other machines of the hub, from their summaries, newest
 * first. The summaries hold the agents of each machine (up to 200), so the
 * search covers all machines without a request to each one.
 */
function otherMachineAgentGroups(
  machines: Array<MachineInfo>,
  activeId: string
) {
  return machines
    .filter((machine) => machine.id !== activeId)
    .map((machine) => ({
      machine,
      items: (machine.summary?.agents ?? [])
        .toSorted(
          (left, right) =>
            (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0)
        )
        .map(
          (agent): OtherMachineAgentItem => ({
            key: `machine:${machine.id}:${agent.id}`,
            machine,
            agent,
          })
        ),
    }))
}

function MachineGroupHeading({
  machine,
  suffix,
}: {
  machine: MachineInfo
  suffix?: string
}) {
  return (
    <span className="flex items-center gap-2">
      <MachineStateDot state={machine.state} />
      {machine.label}
      {suffix}
    </span>
  )
}

function normalizeProjects(projects: Array<string>) {
  const seen = new Set<string>()
  const normalized: Array<string> = []

  for (const project of projects) {
    const value = project.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function formatAgentTime(value?: string, now = Date.now()) {
  if (!value) return ""

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ""

  const diffMs = now - timestamp
  const past = diffMs >= 0
  const seconds = Math.max(1, Math.floor(Math.abs(diffMs) / 1000))
  const suffix = past ? "ago" : "from now"

  if (seconds < 60) return `${seconds}s ${suffix}`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${suffix}`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${suffix}`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ${suffix}`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ${suffix}`

  const months = Math.floor(days / 30)
  if (months < 12) return `${Math.max(1, months)}mo ${suffix}`

  const years = Math.floor(days / 365)
  return `${Math.max(1, years)}y ${suffix}`
}

function agentActivityTime(entry: AgentListEntry) {
  const timestamp = entry.lastUserMessageAt || entry.modified
  if (!timestamp) return 0

  const time = new Date(timestamp).getTime()
  return Number.isNaN(time) ? 0 : time
}

function agentStatusForEntry(
  entry: AgentListEntry,
  statuses: AgentStatusByKey
) {
  const pathKey = entry.path ? `path:${entry.path}` : ""
  const idKey = entry.id ? `id:${entry.id}` : ""

  return (
    (pathKey ? statuses[pathKey] : undefined) ||
    (idKey ? statuses[idKey] : undefined)
  )
}

function applyLocalAgentName(
  entry: AgentListEntry,
  localAgentNames: Record<string, string>
) {
  const localName = entry.path ? localAgentNames[entry.path] : undefined
  if (!localName || entry.title === localName) return entry

  return {
    ...entry,
    name: localName,
    title: localName,
  }
}

function applyAgentStatus(
  entry: AgentListEntry,
  status: Omit<AgentStatusEvent, "type"> | undefined
) {
  if (!status) return entry

  const nextStreaming =
    typeof status.streaming === "boolean" ? status.streaming : entry.streaming
  const nextUnread =
    typeof status.unread === "boolean" ? status.unread : entry.unread

  if (
    Boolean(entry.streaming) === Boolean(nextStreaming) &&
    Boolean(entry.unread) === Boolean(nextUnread)
  ) {
    return entry
  }

  return {
    ...entry,
    streaming: nextStreaming,
    unread: nextUnread,
  }
}

/** The words of a search query, in lower case. */
function searchWords(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/** Whether `word` starts a word in `text` (after a non-letter, or at 0). */
function startsWord(text: string, word: string) {
  let index = text.indexOf(word)
  while (index !== -1) {
    if (index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1] ?? "")) return true
    index = text.indexOf(word, index + 1)
  }
  return false
}

/**
 * How well an agent matches the search words: 0 for no match. Each word must
 * be in the title, a folder, or the machine name. A word in the title counts
 * more than in a folder, and the start of a word counts more than its middle.
 * The whole query in the title counts extra. The agent file path is not
 * searched: it holds the home folder and random IDs, which match almost any
 * query.
 */
function agentMatchScore(
  words: Array<string>,
  fields: { title: string; folders: Array<string>; machine?: string }
) {
  if (words.length === 0) return 1
  const title = fields.title.toLowerCase()
  const folders = fields.folders.join("\n").toLowerCase()
  const machine = fields.machine?.toLowerCase() ?? ""
  let score = 0
  for (const word of words) {
    if (title.includes(word)) score += startsWord(title, word) ? 4 : 2
    else if (folders.includes(word))
      score += startsWord(folders, word) ? 1.5 : 1
    else if (machine.includes(word)) score += 1
    else return 0
  }
  if (words.length > 1 && title.includes(words.join(" "))) score += 2
  return score
}

/** Matches first by score, then the newest. Drops the items with no match. */
function rankMatches<T>(
  items: Array<T>,
  score: (item: T) => number,
  time: (item: T) => number
) {
  return items
    .map((item) => ({ item, score: score(item), time: time(item) }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (left, right) => right.score - left.score || right.time - left.time
    )
    .map((entry) => entry.item)
}

function isActiveAgent(
  entry: AgentListEntry,
  activeAgentId?: string,
  activeAgentPath?: string
) {
  return Boolean(
    (entry.id && activeAgentId && entry.id === activeAgentId) ||
    (entry.path && activeAgentPath && entry.path === activeAgentPath)
  )
}

function fetchProjectAgentsIndexes(
  machineId: string,
  viewerContextId: string,
  projects: Array<string>
) {
  return fetchJson<ProjectAgentsIndexesResponse>(
    buildRequestUrl("/api/project-agents-indexes", {
      machineId,
      contextId: viewerContextId,
      searchParams: {
        project: projects,
      },
    })
  )
}

function FooterKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

type AgentsDialogState = {
  query: string
  scope: AgentsDialogScope
  stage: AgentsDialogStage
  selectedAgentKey: string
  renameValue: string
  localAgentNames: Record<string, string>
  loadedAgentsByPath: Record<string, Array<AgentListEntry>>
  loadingByPath: Record<string, boolean>
}

type AgentsDialogAction =
  | { type: "closed" }
  | { type: "queryChanged"; query: string }
  | { type: "scopeToggled" }
  | { type: "selectedAgentChanged"; key: string }
  | { type: "browseRequested" }
  | { type: "renameRequested"; value: string }
  | { type: "renameValueChanged"; value: string }
  | { type: "renameSaved"; path: string; name: string }
  | { type: "deleteRequested" }
  | { type: "deleteSaved"; path: string }
  | { type: "projectsLoadingStarted"; projects: Array<string> }
  | {
      type: "projectsLoadingFinished"
      projects: Array<string>
      projectIndexes?: Record<string, ProjectAgentsIndexSnapshot>
    }
  | { type: "visibleSelectionChanged"; key: string }

const initialAgentsDialogState: AgentsDialogState = {
  query: "",
  scope: "current",
  stage: "browse",
  selectedAgentKey: "",
  renameValue: "",
  localAgentNames: {},
  loadedAgentsByPath: {},
  loadingByPath: {},
}

function agentsDialogReducer(
  state: AgentsDialogState,
  action: AgentsDialogAction
): AgentsDialogState {
  switch (action.type) {
    case "closed":
      if (
        state.query === "" &&
        state.scope === "current" &&
        state.stage === "browse" &&
        state.renameValue === ""
      ) {
        return state
      }

      return {
        ...state,
        query: "",
        scope: "current",
        stage: "browse",
        renameValue: "",
      }
    case "queryChanged":
      // A new query selects its best match (see the selection effect).
      return state.query === action.query
        ? state
        : { ...state, query: action.query, selectedAgentKey: "" }
    case "scopeToggled":
      return {
        ...state,
        scope: state.scope === "current" ? "all" : "current",
      }
    case "selectedAgentChanged":
      return state.selectedAgentKey === action.key
        ? state
        : { ...state, selectedAgentKey: action.key }
    case "browseRequested":
      return state.stage === "browse" ? state : { ...state, stage: "browse" }
    case "renameRequested":
      return {
        ...state,
        renameValue: action.value,
        stage: "rename",
      }
    case "renameValueChanged":
      return state.renameValue === action.value
        ? state
        : { ...state, renameValue: action.value }
    case "renameSaved":
      return {
        ...state,
        localAgentNames: {
          ...state.localAgentNames,
          [action.path]: action.name,
        },
        stage: "browse",
      }
    case "deleteRequested":
      return state.stage === "delete" ? state : { ...state, stage: "delete" }
    case "deleteSaved": {
      const loadedAgentsByPath: Record<string, Array<AgentListEntry>> = {}
      let agentsChanged = false

      for (const [project, agents] of Object.entries(
        state.loadedAgentsByPath
      )) {
        const filteredAgents = agents.filter(
          (entry) => entry.path !== action.path
        )
        loadedAgentsByPath[project] = filteredAgents
        if (filteredAgents.length !== agents.length) agentsChanged = true
      }

      let localAgentNames = state.localAgentNames
      if (
        Object.prototype.hasOwnProperty.call(state.localAgentNames, action.path)
      ) {
        localAgentNames = { ...state.localAgentNames }
        delete localAgentNames[action.path]
      }

      return {
        ...state,
        loadedAgentsByPath: agentsChanged
          ? loadedAgentsByPath
          : state.loadedAgentsByPath,
        localAgentNames,
        selectedAgentKey: "",
        stage: "browse",
      }
    }
    case "projectsLoadingStarted": {
      let changed = false
      const loadingByPath = { ...state.loadingByPath }
      for (const project of action.projects) {
        if (loadingByPath[project]) continue
        loadingByPath[project] = true
        changed = true
      }

      return changed ? { ...state, loadingByPath } : state
    }
    case "projectsLoadingFinished": {
      let loadingChanged = false
      const loadingByPath = { ...state.loadingByPath }
      for (const project of action.projects) {
        if (!Object.prototype.hasOwnProperty.call(loadingByPath, project)) {
          continue
        }
        delete loadingByPath[project]
        loadingChanged = true
      }

      let loadedAgentsByPath = state.loadedAgentsByPath
      if (action.projectIndexes) {
        loadedAgentsByPath = { ...state.loadedAgentsByPath }
        for (const project of action.projects) {
          loadedAgentsByPath[project] =
            action.projectIndexes[project]?.agents || []
        }
      }

      if (!loadingChanged && loadedAgentsByPath === state.loadedAgentsByPath) {
        return state
      }

      return {
        ...state,
        loadingByPath: loadingChanged ? loadingByPath : state.loadingByPath,
        loadedAgentsByPath,
      }
    }
    case "visibleSelectionChanged": {
      const renameValue = state.stage === "browse" ? state.renameValue : ""
      if (
        state.selectedAgentKey === action.key &&
        state.stage === "browse" &&
        state.renameValue === renameValue
      ) {
        return state
      }

      return {
        ...state,
        selectedAgentKey: action.key,
        stage: "browse",
        renameValue,
      }
    }
    default:
      return state
  }
}

function AppShellAgentsDialog(props: AppShellAgentsDialogProps) {
  return useAppShellAgentsDialogView(props)
}

function useAppShellAgentsDialogView({
  open,
  onOpenChange,
  viewerContextId,
  currentProject,
  knownProjects,
  projectAgentsByPath,
  agentStatusByKey,
  activeAgentId,
  activeAgentPath,
  onSelectAgent,
  onRenameAgent,
  onDeleteAgent,
  onError,
}: AppShellAgentsDialogProps) {
  const machineId = useMachineId()
  const isMobile = useIsMobile()
  const [isGeneratingName, setIsGeneratingName] = React.useState(false)
  const [generatedNamePath, setGeneratedNamePath] = React.useState("")
  const [state, dispatch] = React.useReducer(
    agentsDialogReducer,
    initialAgentsDialogState
  )
  const {
    query,
    scope,
    stage,
    selectedAgentKey,
    renameValue,
    localAgentNames,
    loadedAgentsByPath,
    loadingByPath,
  } = state
  const normalizedCurrentProject = currentProject.trim()
  const allProjects = normalizeProjects([
    normalizedCurrentProject,
    ...knownProjects,
    ...Object.keys(projectAgentsByPath),
  ])
  const currentProjects = normalizedCurrentProject
    ? [normalizedCurrentProject]
    : allProjects.slice(0, 1)
  const scopedProjects = scope === "all" ? allProjects : currentProjects
  const mergedAgentsByPath: Record<string, Array<AgentListEntry>> = {
    ...loadedAgentsByPath,
    ...projectAgentsByPath,
  }
  const visibleGroups = scopedProjects.map((project) => {
    const agents = (mergedAgentsByPath[project] || []).map((entry) =>
      applyLocalAgentName(
        applyAgentStatus(entry, agentStatusForEntry(entry, agentStatusByKey)),
        localAgentNames
      )
    )

    return {
      project,
      agents,
      loading: Boolean(loadingByPath[project]),
    }
  })
  const flatAgents = visibleGroups.flatMap((group) =>
    group.agents.map((entry) => ({
      project: group.project,
      entry,
      key: agentListEntryKey(entry),
    }))
  )
  const words = searchWords(query)
  const sortedAgentItems = rankMatches(
    flatAgents,
    ({ entry, project }) =>
      agentMatchScore(words, {
        title: entry.title,
        folders: [tildePath(entry.cwd || ""), tildePath(project)],
      }),
    ({ entry }) => agentActivityTime(entry)
  )
  // With more machines, "All agents" also shows the other machines.
  const { machines } = useMachines()
  const activeId = machineId
  const activeMachine = machines.find((machine) => machine.id === activeId)
  const showMachines = scope === "all" && machines.length > 1 && activeMachine
  const otherMachineGroups = (
    showMachines ? otherMachineAgentGroups(machines, activeId) : []
  ).map((group) => ({
    ...group,
    items: rankMatches(
      group.items,
      ({ agent, machine }) =>
        agentMatchScore(words, {
          title: agent.title,
          folders: [tildePath(agent.cwd), tildePath(agent.project)],
          machine: machine.label,
        }),
      ({ agent }) => agent.lastMessageAt ?? 0
    ),
  }))
  // The order of the list: the machines in sidebar order, each one ranked.
  const visibleAgentKeys = (
    showMachines ? machines : [{ id: activeId }]
  ).flatMap((machine) =>
    machine.id === activeId
      ? sortedAgentItems.map((agent) => agent.key)
      : (otherMachineGroups
          .find((group) => group.machine.id === machine.id)
          ?.items.map((item) => item.key) ?? [])
  )
  const selectedAgent = selectedAgentKey
    ? flatAgents.find((agent) => agent.key === selectedAgentKey)?.entry
    : undefined
  const canGenerateSelectedAgentName = Boolean(
    selectedAgent?.path &&
    !selectedAgent.name?.trim() &&
    generatedNamePath !== selectedAgent.path
  )
  const loading = visibleGroups.some((group) => group.loading)
  const browseInputRef = React.useRef<HTMLInputElement | null>(null)
  const deletePanelRef = React.useRef<HTMLDivElement | null>(null)
  const previousStageRef = React.useRef(stage)

  // Projects whose load failed while the dialog is open. The load effect
  // skips them, else each failure starts the next request at once, in a loop.
  const failedProjectsRef = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (open) return
    failedProjectsRef.current.clear()
    dispatch({ type: "closed" })
  }, [open])

  React.useEffect(() => {
    if (!open || !viewerContextId || scopedProjects.length === 0) return

    const missingProjects = scopedProjects.filter(
      (project) =>
        !Object.prototype.hasOwnProperty.call(mergedAgentsByPath, project) &&
        !loadingByPath[project] &&
        !failedProjectsRef.current.has(project)
    )

    if (missingProjects.length === 0) return

    dispatch({
      type: "projectsLoadingStarted",
      projects: missingProjects,
    })

    void fetchProjectAgentsIndexes(machineId, viewerContextId, missingProjects)
      .then((response) => {
        dispatch({
          type: "projectsLoadingFinished",
          projects: missingProjects,
          projectIndexes: response.ok ? response.projectIndexes : undefined,
        })
      })
      .catch((error: unknown) => {
        for (const project of missingProjects) {
          failedProjectsRef.current.add(project)
        }
        onError?.(error)
        dispatch({
          type: "projectsLoadingFinished",
          projects: missingProjects,
        })
      })
  }, [
    loadingByPath,
    mergedAgentsByPath,
    onError,
    open,
    scopedProjects,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (!open) return

    const selectedStillVisible = visibleAgentKeys.includes(selectedAgentKey)
    if (selectedStillVisible) return

    // Without a query, select the agent of the page; with one, the best
    // match.
    const activeAgent = words.length
      ? undefined
      : flatAgents.find((agent) =>
          isActiveAgent(agent.entry, activeAgentId, activeAgentPath)
        )
    dispatch({
      type: "visibleSelectionChanged",
      key: activeAgent?.key || visibleAgentKeys[0] || "",
    })
  }, [
    activeAgentId,
    activeAgentPath,
    flatAgents,
    open,
    selectedAgentKey,
    visibleAgentKeys,
    words.length,
  ])

  React.useEffect(() => {
    const previousStage = previousStageRef.current
    previousStageRef.current = stage
    if (!open || stage !== "browse" || previousStage === "browse") return

    const frame = window.requestAnimationFrame(() => {
      browseInputRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open, stage])

  React.useEffect(() => {
    if (!open || stage !== "delete") return

    const frame = window.requestAnimationFrame(() => {
      deletePanelRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open, stage])

  const toggleScope = () => {
    dispatch({ type: "scopeToggled" })
  }

  const selectAgent = (entry: AgentListEntry) => {
    if (!entry.id) return
    onOpenChange(false)
    onSelectAgent(entry.id, { agentPath: entry.path })
  }

  /** Open an agent of another machine: the page switches machines. */
  const selectOtherMachineAgent = (item: OtherMachineAgentItem) => {
    onOpenChange(false)
    openAgent({ machineId: item.machine.id, agentId: item.agent.id })
  }

  const renameSelectedAgent = () => {
    if (!selectedAgent?.path) return
    setGeneratedNamePath("")
    dispatch({ type: "renameRequested", value: selectedAgent.title })
  }

  const saveSelectedAgentRename = async () => {
    const targetPath = selectedAgent?.path
    const nextName = renameValue.trim()
    if (!targetPath) return

    const success = await Promise.resolve(onRenameAgent(targetPath, nextName))
    if (success === false) return

    dispatch({ type: "renameSaved", path: targetPath, name: nextName })
  }

  const generateSelectedAgentName = async () => {
    const targetPath = selectedAgent?.path
    if (!targetPath || isGeneratingName || !canGenerateSelectedAgentName) {
      return
    }

    setIsGeneratingName(true)
    try {
      const response = await fetchJson<GenerateAgentNameData>(
        buildRequestUrl("/api/agent/name", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: targetPath }),
        }
      )
      dispatch({ type: "renameValueChanged", value: response.name })
      setGeneratedNamePath(targetPath)
      if (response.source === "heuristic" && response.reason) {
        toast.info("Using heuristic agent name", {
          description: response.reason,
        })
      }
    } catch (error) {
      onError?.(error)
    } finally {
      setIsGeneratingName(false)
    }
  }

  const deleteSelectedAgent = () => {
    if (!selectedAgent?.path) return
    dispatch({ type: "deleteRequested" })
  }

  const confirmDeleteSelectedAgent = async () => {
    const targetPath = selectedAgent?.path
    if (!selectedAgent || !targetPath) return

    const target: AgentListEntry = { ...selectedAgent, path: targetPath }
    const success = await Promise.resolve(onDeleteAgent([target]))
    if (success === false) return

    dispatch({ type: "deleteSaved", path: targetPath })
  }

  React.useEffect(() => {
    if (!open || stage !== "delete") return

    const handleDeleteKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        dispatch({ type: "browseRequested" })
        return
      }

      if (event.key !== "Enter" || event.isComposing) return
      if (event.target instanceof HTMLButtonElement) return
      event.preventDefault()
      event.stopPropagation()
      void confirmDeleteSelectedAgent()
    }

    window.addEventListener("keydown", handleDeleteKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleDeleteKeyDown, true)
    }
  }, [confirmDeleteSelectedAgent, open, stage])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const key = event.key.toLowerCase()

    if (key === "tab") {
      event.preventDefault()
      toggleScope()
      return
    }

    if (matchesShortcutEvent(event.nativeEvent, appShortcut("R"))) {
      event.preventDefault()
      renameSelectedAgent()
      return
    }

    if (matchesShortcutEvent(event.nativeEvent, appShortcut("D"))) {
      event.preventDefault()
      deleteSelectedAgent()
    }
  }

  // A group without matches is hidden, like the groups of other machines.
  const activeAgentsGroup =
    sortedAgentItems.length === 0 && !loading ? null : (
      <CommandGroup
        key={activeId}
        heading={
          showMachines ? (
            <MachineGroupHeading
              machine={activeMachine}
              suffix={loading ? " · loading" : undefined}
            />
          ) : (
            `${scope === "all" ? "All agents" : `Current project: ${tildePath(currentProjects[0] || "")}`}${loading ? " · loading" : ""}`
          )
        }
      >
        {loading && sortedAgentItems.length === 0 ? (
          <CommandItem value="loading:agents" disabled>
            <Spinner className="text-primary" />
            <span className="text-muted-foreground">Loading agents…</span>
          </CommandItem>
        ) : null}
        {sortedAgentItems.map(({ project, entry }) => {
          const entryKey = agentListEntryKey(entry)
          const timestamp = entry.lastUserMessageAt || entry.modified
          const agentTime = formatAgentTime(timestamp)
          const active = isActiveAgent(entry, activeAgentId, activeAgentPath)
          const showUnread = Boolean(entry.unread) && !entry.streaming

          return (
            <CommandItem
              key={entryKey}
              value={entryKey}
              onSelect={() => selectAgent(entry)}
              className="items-start py-2"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {entry.streaming ? (
                  <Spinner
                    className="text-primary"
                    aria-label="Agent working"
                  />
                ) : showUnread ? (
                  <span
                    className="size-2 rounded-full bg-primary"
                    aria-label="Agent done"
                  />
                ) : null}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{entry.title}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  {tildePath(entry.cwd || project)}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {agentTime ? (
                  <span className="truncate text-[11px] text-muted-foreground/70">
                    {agentTime}
                  </span>
                ) : null}
                <CommandShortcut
                  className={cn(
                    "ml-0 shrink-0 tracking-normal normal-case",
                    !active && "opacity-0"
                  )}
                >
                  Current
                </CommandShortcut>
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    )

  const otherMachineGroupElement = (machine: MachineInfo) => {
    const group = otherMachineGroups.find(
      (entry) => entry.machine.id === machine.id
    )
    if (!group || group.items.length === 0) return null
    return (
      <CommandGroup
        key={machine.id}
        heading={<MachineGroupHeading machine={machine} />}
        className={cn(machine.state !== "online" && "opacity-60")}
      >
        {group.items.map((item) => {
          const { agent } = item
          const agentTime = agent.lastMessageAt
            ? formatAgentTime(new Date(agent.lastMessageAt).toISOString())
            : ""
          const project = agent.project || agent.cwd
          return (
            <CommandItem
              key={item.key}
              value={item.key}
              onSelect={() => selectOtherMachineAgent(item)}
              className="items-start py-2"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {agent.needsInput ? (
                  <MessageCircleQuestionIcon
                    className="size-3.5 text-amber-500"
                    aria-label="The agent waits for your answer"
                  />
                ) : agent.busy ? (
                  <Spinner
                    className="text-primary"
                    aria-label="Agent working"
                  />
                ) : isMachineAgentUnread(agent) ? (
                  <span
                    className="size-2 rounded-full bg-primary"
                    aria-label="Agent done"
                  />
                ) : null}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{agent.title}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  {tildePath(agent.cwd || project)}
                </span>
              </div>
              {agentTime ? (
                <span className="shrink-0 truncate text-[11px] text-muted-foreground/70">
                  {agentTime}
                </span>
              ) : null}
            </CommandItem>
          )
        })}
      </CommandGroup>
    )
  }

  const agentsBrowseBody = (
    <Command
      // `agentMatchScore` filters and ranks the agents. The fuzzy filter
      // of cmdk matched letters spread over long paths.
      shouldFilter={false}
      loop
      value={selectedAgentKey}
      onValueChange={(key) => {
        dispatch({ type: "selectedAgentChanged", key })
      }}
      onKeyDown={handleKeyDown}
      className="min-h-0 flex-1"
    >
      <CommandInput
        ref={browseInputRef}
        value={query}
        onValueChange={(nextQuery) => {
          dispatch({ type: "queryChanged", query: nextQuery })
        }}
        placeholder={scope === "all" ? "Search all agents" : "Search agents"}
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>
          {loading ? "Loading agents…" : "No agents found."}
        </CommandEmpty>
        {showMachines
          ? machines.map((machine) =>
              machine.id === activeId
                ? activeAgentsGroup
                : otherMachineGroupElement(machine)
            )
          : activeAgentsGroup}
      </CommandList>
      {!isMobile ? (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Tab</FooterKbd>
            {scope === "all"
              ? "Current project"
              : machines.length > 1
                ? "All machines"
                : "All agents"}
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Enter</FooterKbd> Switch
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>{formatShortcutLabel(appShortcut("R"))}</FooterKbd>{" "}
            Rename
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>{formatShortcutLabel(appShortcut("D"))}</FooterKbd>{" "}
            Archive
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Esc</FooterKbd> Close
          </span>
        </div>
      ) : null}
    </Command>
  )

  const agentsRenameBody = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            dispatch({ type: "browseRequested" })
          }}
          aria-label="Back to agents"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Rename agent</div>
          <div className="truncate text-xs text-muted-foreground">
            {selectedAgent?.title || "Selected agent"}
          </div>
        </div>
        {isMobile ? (
          <Button
            type="button"
            variant="ghost"
            disabled={isGeneratingName || !canGenerateSelectedAgentName}
            onClick={() => {
              void generateSelectedAgentName()
            }}
          >
            {isGeneratingName ? <Spinner /> : <WandSparklesIcon />}
            Generate
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 items-center p-3">
        <Input
          value={renameValue}
          onChange={(event) => {
            dispatch({
              type: "renameValueChanged",
              value: event.target.value,
            })
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              dispatch({ type: "browseRequested" })
              return
            }
            if (matchesShortcutEvent(event.nativeEvent, appShortcut("G"))) {
              event.preventDefault()
              event.stopPropagation()
              void generateSelectedAgentName()
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            void saveSelectedAgentRename()
          }}
          placeholder="Agent name"
          className="min-w-0 flex-1"
        />
      </div>
      {isMobile ? null : (
        <ShortcutFooter>
          <ShortcutButton
            kbd={formatShortcutLabel(appShortcut("G"))}
            disabled={isGeneratingName || !canGenerateSelectedAgentName}
            onClick={() => {
              void generateSelectedAgentName()
            }}
          >
            {isGeneratingName ? <Spinner /> : <WandSparklesIcon />}
            Generate
          </ShortcutButton>
          <ShortcutButton
            kbd="Enter"
            onClick={() => {
              void saveSelectedAgentRename()
            }}
          >
            Save
          </ShortcutButton>
          <ShortcutButton
            kbd="Esc"
            onClick={() => {
              dispatch({ type: "browseRequested" })
            }}
          >
            Back
          </ShortcutButton>
        </ShortcutFooter>
      )}
    </div>
  )

  const agentsDeleteBody = (
    <div
      ref={deletePanelRef}
      role="presentation"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          dispatch({ type: "browseRequested" })
          return
        }
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return
        if (event.target instanceof HTMLButtonElement) return
        event.preventDefault()
        event.stopPropagation()
        void confirmDeleteSelectedAgent()
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            dispatch({ type: "browseRequested" })
          }}
          aria-label="Back to agents"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Archive agent</div>
          <div className="truncate text-xs text-muted-foreground">
            {selectedAgent?.title || "Selected agent"}
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center p-3">
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Archive "{selectedAgent?.title || "New agent"}"? (History is kept.)
        </p>
      </div>
      {isMobile ? null : (
        <ShortcutFooter>
          <ShortcutButton
            kbd="Enter"
            onClick={() => {
              void confirmDeleteSelectedAgent()
            }}
          >
            Archive
          </ShortcutButton>
          <ShortcutButton
            kbd="Esc"
            onClick={() => {
              dispatch({ type: "browseRequested" })
            }}
          >
            Back
          </ShortcutButton>
        </ShortcutFooter>
      )}
    </div>
  )

  const agentsCommandBody =
    stage === "rename"
      ? agentsRenameBody
      : stage === "delete"
        ? agentsDeleteBody
        : agentsBrowseBody

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Agents</DrawerTitle>
            <DrawerDescription>Search and switch agents.</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {agentsCommandBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Agents"
      description="Search and switch agents. Press Tab to toggle current project and all agents."
      className="sm:max-w-2xl"
      initialFocus
    >
      {agentsCommandBody}
    </CommandDialog>
  )
}

type AppShellAgentsDialogControllerProps = Omit<
  AppShellAgentsDialogProps,
  "open" | "onOpenChange"
> & {
  ref?: React.Ref<AppShellAgentsDialogHandle>
  openStateRef?: React.RefObject<boolean>
}

export function AppShellAgentsDialogController({
  ref,
  openStateRef,
  ...props
}: AppShellAgentsDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpenState(true)
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    []
  )

  return (
    <AppShellAgentsDialog open={open} onOpenChange={setOpenState} {...props} />
  )
}
