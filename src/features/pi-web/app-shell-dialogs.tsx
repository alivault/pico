import * as React from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderTreeIcon,
  KeyboardIcon,
} from "lucide-react"

import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type {
  ForkMessage,
  TreeNavigateOptions,
} from "@/features/pi-web/app-shell-dialog-types"
import type { FlatTreeNode, ThemeMode } from "@/lib/pi-web"
import type { ExtensionUiEvent } from "@/lib/pi-web-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { AppShellAddDirectoryDialog } from "@/features/pi-web/app-shell-add-directory-dialog"
import { AppShellSettingsDialog } from "@/features/pi-web/app-shell-settings-dialog"
import {
  DeleteSessionsDialog,
  ForkSessionDialog,
  RenameSessionDialog,
} from "@/features/pi-web/app-shell-session-dialogs"
import { AppShellUiRequestDialog } from "@/features/pi-web/app-shell-ui-request-dialog"
import { cn } from "@/lib/utils"

type TreeFilterMode =
  | "default"
  | "no-tools"
  | "user-only"
  | "labeled-only"
  | "all"

type TreeVisibleNode = FlatTreeNode & {
  parentVisibleId: string | null
  visibleDepth: number
  hasVisibleChildren: boolean
  isFolded: boolean
  isCurrentLeaf: boolean
  isActivePath: boolean
}

type TreeDialogViewModel = {
  nodeById: Map<string, FlatTreeNode>
  visibleParentById: Map<string, string | null>
  visibleChildrenById: Map<string | null, Array<string>>
  orderedVisibleNodes: Array<TreeVisibleNode>
}

type TreeShortcutItem = {
  label: string
  description?: string
  keys: string
}

const TREE_FILTER_OPTIONS: Array<{
  mode: TreeFilterMode
  label: string
  shortcut: string
}> = [
  { mode: "default", label: "Default", shortcut: "Ctrl+Shift+D" },
  { mode: "no-tools", label: "No tools", shortcut: "Ctrl+Shift+T" },
  { mode: "user-only", label: "User only", shortcut: "Ctrl+Shift+U" },
  { mode: "labeled-only", label: "Labeled", shortcut: "Ctrl+Shift+L" },
  { mode: "all", label: "All", shortcut: "Ctrl+Shift+A" },
]

const TREE_SHORTCUT_ITEMS: Array<TreeShortcutItem> = [
  { label: "Show tree shortcuts", keys: "Ctrl+/" },
  { label: "Move", keys: "↑ / ↓ or Ctrl+J / Ctrl+K" },
  {
    label: "Expand or collapse a branch",
    keys: "← / → or Ctrl+H / Ctrl+L",
  },
  { label: "Jump to first or last result", keys: "Home / End" },
  {
    label: "Cycle filters",
    keys: "Ctrl+O / Ctrl+Shift+O",
  },
  {
    label: "Jump to a filter preset",
    keys: "Ctrl+Shift+D / T / U / L / A",
  },
  {
    label: "Toggle label timestamps",
    keys: "Shift+T",
  },
  {
    label: "Focus the label editor",
    keys: "Shift+L",
  },
  {
    label: "Continue without summary",
    keys: "Enter",
  },
  {
    label: "Submit custom summary instructions",
    keys: "Ctrl+Enter",
  },
  {
    label: "Clear custom summary or close help/tree",
    keys: "Esc",
  },
]

function treeDialogNormalizeLine(value: string | undefined) {
  return typeof value === "string" ? value.replace(/[\n\t]/g, " ").trim() : ""
}

function treeDialogFormatTimestamp(timestamp: string | undefined) {
  if (!timestamp) return ""

  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ""

  const now = new Date()
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)

  if (date.toDateString() === now.toDateString()) {
    return time
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`
  }

  return `${date.getFullYear().toString().slice(-2)}/${date.getMonth() + 1}/${date.getDate()} ${time}`
}

function treeDialogKindLabel(node: FlatTreeNode) {
  const entry = node.node.entry

  if (entry.type === "message") {
    switch (entry.message?.role) {
      case "user":
        return "User"
      case "assistant":
        return "Assistant"
      case "toolResult":
        return "Tool"
      case "bashExecution":
        return "Shell"
      default:
        return entry.message?.role || "Message"
    }
  }

  switch (entry.type) {
    case "compaction":
      return "Compaction"
    case "branch_summary":
      return "Summary"
    case "custom_message":
      return "Custom"
    case "model_change":
      return "Model"
    case "thinking_level_change":
      return "Thinking"
    case "session_info":
      return "Title"
    case "label":
      return "Label"
    case "custom":
      return "Custom"
    default:
      return entry.type || "Entry"
  }
}

function treeDialogEntryText(node: FlatTreeNode) {
  const entry = node.node.entry
  const message = entry.message || {}

  if (entry.type === "message") {
    switch (message.role) {
      case "user":
        return treeDialogNormalizeLine(message.text) || "(no content)"
      case "assistant": {
        const text = treeDialogNormalizeLine(message.text)
        if (text) return text
        if (message.stopReason === "aborted") return "(aborted)"
        if (message.errorMessage) {
          return treeDialogNormalizeLine(message.errorMessage)
        }
        return "(no content)"
      }
      case "toolResult":
        return (
          treeDialogNormalizeLine(message.text) ||
          message.toolName ||
          "Tool result"
        )
      case "bashExecution":
        return treeDialogNormalizeLine(message.command) || "Shell command"
      default:
        return treeDialogNormalizeLine(message.text) || "Message"
    }
  }

  switch (entry.type) {
    case "branch_summary":
      return treeDialogNormalizeLine(entry.summary) || "Branch summary"
    case "compaction":
      return "Compaction event"
    case "session_info":
      return treeDialogNormalizeLine(entry.name) || "Session title"
    case "model_change":
      return treeDialogNormalizeLine(entry.modelId) || "Model changed"
    case "thinking_level_change":
      return (
        treeDialogNormalizeLine(entry.thinkingLevel) || "Thinking level changed"
      )
    case "label":
      return treeDialogNormalizeLine(entry.label) || "Label updated"
    case "custom_message":
    case "custom":
      return (
        treeDialogNormalizeLine(entry.text) ||
        treeDialogNormalizeLine(entry.customType) ||
        "Custom entry"
      )
    default:
      return treeDialogNormalizeLine(node.text) || treeDialogKindLabel(node)
  }
}

function treeDialogSearchableText(node: FlatTreeNode) {
  const entry = node.node.entry
  const parts: Array<string> = [node.label || "", treeDialogEntryText(node)]

  if (entry.type === "message") {
    parts.push(entry.message?.role || "")
    parts.push(entry.message?.command || "")
    parts.push(entry.message?.errorMessage || "")
    for (const toolCall of entry.message?.toolCalls || []) {
      parts.push(toolCall.preview || toolCall.name || "")
    }
  }

  parts.push(entry.type || "")
  parts.push(entry.customType || "")
  parts.push(entry.summary || "")
  parts.push(entry.modelId || "")
  parts.push(entry.thinkingLevel || "")
  parts.push(entry.name || "")
  parts.push(entry.label || "")

  return parts.join(" ").toLowerCase()
}

function treeDialogIsSettingsEntry(node: FlatTreeNode) {
  const entryType = node.node.entry.type
  return (
    entryType === "label" ||
    entryType === "custom" ||
    entryType === "model_change" ||
    entryType === "thinking_level_change" ||
    entryType === "session_info"
  )
}

function treeDialogPassesFilter(
  node: FlatTreeNode,
  filterMode: TreeFilterMode,
  currentLeafId: string | null,
  searchTokens: Array<string>
) {
  const entry = node.node.entry
  const message = entry.message || {}
  const isCurrentLeaf = node.id === currentLeafId

  if (
    !isCurrentLeaf &&
    entry.type === "message" &&
    message.role === "assistant"
  ) {
    const hasText = Boolean(treeDialogNormalizeLine(message.text))
    const stopReason =
      typeof message.stopReason === "string" ? message.stopReason : ""
    const isErrorOrAborted =
      Boolean(stopReason) && stopReason !== "stop" && stopReason !== "toolUse"
    if (!hasText && !isErrorOrAborted) {
      return false
    }
  }

  switch (filterMode) {
    case "user-only":
      if (!(entry.type === "message" && message.role === "user")) return false
      break
    case "no-tools":
      if (treeDialogIsSettingsEntry(node)) return false
      if (entry.type === "message" && message.role === "toolResult")
        return false
      break
    case "labeled-only":
      if (!node.label) return false
      break
    case "all":
      break
    default:
      if (treeDialogIsSettingsEntry(node)) return false
      break
  }

  if (searchTokens.length > 0) {
    const searchableText = treeDialogSearchableText(node)
    if (!searchTokens.every((token) => searchableText.includes(token))) {
      return false
    }
  }

  return true
}

function buildTreeDialogViewModel({
  flatTree,
  currentLeafId,
  query,
  filterMode,
  foldedTreeNodeIds,
}: {
  flatTree: Array<FlatTreeNode>
  currentLeafId: string | null
  query: string
  filterMode: TreeFilterMode
  foldedTreeNodeIds: Array<string>
}): TreeDialogViewModel {
  const nodeById = new Map<string, FlatTreeNode>()

  for (const node of flatTree) {
    nodeById.set(node.id, node)
  }

  const activePathIds = new Set<string>()
  let cursor = currentLeafId
  while (cursor) {
    activePathIds.add(cursor)
    cursor = nodeById.get(cursor)?.parentId ?? null
  }

  const searchTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  const filteredNodes = flatTree.filter((node) =>
    treeDialogPassesFilter(node, filterMode, currentLeafId, searchTokens)
  )
  const filteredIds = new Set(filteredNodes.map((node) => node.id))
  const visibleParentById = new Map<string, string | null>()
  const visibleChildrenById = new Map<string | null, Array<string>>([
    [null, []],
  ])

  for (const node of filteredNodes) {
    let parentId = node.parentId ?? null
    while (parentId !== null && !filteredIds.has(parentId)) {
      parentId = nodeById.get(parentId)?.parentId ?? null
    }
    visibleParentById.set(node.id, parentId)
    const siblings = visibleChildrenById.get(parentId) ?? []
    siblings.push(node.id)
    visibleChildrenById.set(parentId, siblings)
  }

  const foldedSet = new Set(foldedTreeNodeIds)
  const orderedVisibleNodes: Array<TreeVisibleNode> = []

  const visit = (parentId: string | null, visibleDepth: number) => {
    const childIds = visibleChildrenById.get(parentId) ?? []

    for (const childId of childIds) {
      const node = nodeById.get(childId)
      if (!node) continue

      const hasVisibleChildren =
        (visibleChildrenById.get(childId)?.length ?? 0) > 0
      const isFolded = hasVisibleChildren && foldedSet.has(childId)

      orderedVisibleNodes.push({
        ...node,
        parentVisibleId: parentId,
        visibleDepth,
        hasVisibleChildren,
        isFolded,
        isCurrentLeaf: childId === currentLeafId,
        isActivePath: activePathIds.has(childId),
      })

      if (!isFolded) {
        visit(childId, visibleDepth + 1)
      }
    }
  }

  visit(null, 0)

  return {
    nodeById,
    visibleParentById,
    visibleChildrenById,
    orderedVisibleNodes,
  }
}

function findNearestVisibleTreeNodeId(
  preferredId: string | null,
  orderedVisibleNodes: Array<TreeVisibleNode>,
  nodeById: Map<string, FlatTreeNode>
) {
  if (orderedVisibleNodes.length === 0) return null
  if (!preferredId) return orderedVisibleNodes[0]?.id ?? null

  const visibleIds = new Set(orderedVisibleNodes.map((node) => node.id))
  let currentId: string | null = preferredId
  while (currentId) {
    if (visibleIds.has(currentId)) return currentId
    currentId = nodeById.get(currentId)?.parentId ?? null
  }

  return orderedVisibleNodes[0]?.id ?? null
}

function cycleTreeFilterMode(mode: TreeFilterMode, direction: 1 | -1) {
  const modes = TREE_FILTER_OPTIONS.map((option) => option.mode)
  const currentIndex = Math.max(0, modes.indexOf(mode))
  const nextIndex = (currentIndex + direction + modes.length) % modes.length
  return modes[nextIndex] ?? mode
}

function treeFilterModeLabel(mode: TreeFilterMode) {
  return (
    TREE_FILTER_OPTIONS.find((option) => option.mode === mode)?.label ||
    "Default"
  )
}

type AppShellDialogsProps = {
  addDirectoryOpen: boolean
  onAddDirectoryOpenChange: (open: boolean) => void
  directoryInput: string
  onDirectoryInputChange: (value: string) => void
  openedDirectories: Array<string>
  currentDirectory?: string
  recentDirectories: Array<string>
  knownDirectories: Array<string>
  onAddDirectory: () => void
  onAddDirectoryPath: (path: string) => void
  renameOpen: boolean
  onRenameOpenChange: (open: boolean) => void
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRenameSession: () => void
  deleteOpen: boolean
  onDeleteOpenChange: (open: boolean) => void
  deleteTitle: string
  deleteDescription: string
  onDeleteSession: () => void
  forkOpen: boolean
  onForkOpenChange: (open: boolean) => void
  forkLoading: boolean
  forkMessages: Array<ForkMessage> | null
  onForkFromMessage: (entryId: string) => void
  treeOpen: boolean
  onTreeOpenChange: (open: boolean) => void
  treeLoading: boolean
  treeSubmitting: boolean
  treeLeafId: string | null
  treeSummaryAvailable: boolean
  treeQuery: string
  onTreeQueryChange: (value: string) => void
  flatTree: Array<FlatTreeNode>
  selectedTreeNodeId: string | null
  onSelectedTreeNodeIdChange: (value: string | null) => void
  selectedTreeNodeLabel: string
  onSelectedTreeNodeLabelChange: (value: string) => void
  onNavigateTreeNode: (
    targetId: string,
    options?: TreeNavigateOptions
  ) => Promise<void> | void
  onSaveTreeLabel: () => Promise<void> | void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  currentTheme: ThemeMode
  onThemeChange: (value: ThemeMode) => void
  hideThinkingBlocks: boolean
  onHideThinkingBlocksChange: (hidden: boolean) => void
  hideToolBlocks: boolean
  onHideToolBlocksChange: (hidden: boolean) => void
  centerMessages: boolean
  onCenterMessagesChange: (centered: boolean) => void
  sessionDoneSoundEnabled: boolean
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  sessionDoneDesktopNotificationsEnabled: boolean
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  desktopNotificationPermission: DesktopNotificationPermission
  pendingUiRequest: ExtensionUiEvent | null
  pendingUiValue: string
  onPendingUiValueChange: (value: string) => void
  onResolveUiRequest: (body: Record<string, unknown>) => void
}

export function AppShellDialogs({
  addDirectoryOpen,
  onAddDirectoryOpenChange,
  directoryInput,
  onDirectoryInputChange,
  openedDirectories,
  currentDirectory,
  recentDirectories,
  knownDirectories,
  onAddDirectory,
  onAddDirectoryPath,
  renameOpen,
  onRenameOpenChange,
  renameValue,
  onRenameValueChange,
  onRenameSession,
  deleteOpen,
  onDeleteOpenChange,
  deleteTitle,
  deleteDescription,
  onDeleteSession,
  forkOpen,
  onForkOpenChange,
  forkLoading,
  forkMessages,
  onForkFromMessage,
  treeOpen,
  onTreeOpenChange,
  treeLoading,
  treeSubmitting,
  treeLeafId,
  treeSummaryAvailable,
  treeQuery,
  onTreeQueryChange,
  flatTree,
  selectedTreeNodeId,
  onSelectedTreeNodeIdChange,
  selectedTreeNodeLabel,
  onSelectedTreeNodeLabelChange,
  onNavigateTreeNode,
  onSaveTreeLabel,
  settingsOpen,
  onSettingsOpenChange,
  currentTheme,
  onThemeChange,
  hideThinkingBlocks,
  onHideThinkingBlocksChange,
  hideToolBlocks,
  onHideToolBlocksChange,
  centerMessages,
  onCenterMessagesChange,
  sessionDoneSoundEnabled,
  onSessionDoneSoundEnabledChange,
  sessionDoneDesktopNotificationsEnabled,
  onSessionDoneDesktopNotificationsEnabledChange,
  desktopNotificationPermission,
  pendingUiRequest,
  pendingUiValue,
  onPendingUiValueChange,
  onResolveUiRequest,
}: AppShellDialogsProps) {
  const [treeFilterMode, setTreeFilterMode] =
    React.useState<TreeFilterMode>("no-tools")
  const [showTreeLabelTimestamps, setShowTreeLabelTimestamps] =
    React.useState(false)
  const [foldedTreeNodeIds, setFoldedTreeNodeIds] = React.useState<
    Array<string>
  >([])
  const [showTreeShortcutsHelp, setShowTreeShortcutsHelp] =
    React.useState(false)
  const [showCustomTreeSummary, setShowCustomTreeSummary] =
    React.useState(false)
  const [customTreeSummaryInstructions, setCustomTreeSummaryInstructions] =
    React.useState("")
  const treeSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const treeLabelInputRef = React.useRef<HTMLInputElement | null>(null)
  const treeCustomSummaryRef = React.useRef<HTMLTextAreaElement | null>(null)

  const treeViewModel = (() =>
    buildTreeDialogViewModel({
      flatTree,
      currentLeafId: treeLeafId,
      query: treeQuery,
      filterMode: treeFilterMode,
      foldedTreeNodeIds,
    }))()
  const selectedVisibleTreeNode =
    selectedTreeNodeId != null
      ? (treeViewModel.orderedVisibleNodes.find(
          (node) => node.id === selectedTreeNodeId
        ) ?? null)
      : null
  const selectedTreeNode =
    selectedTreeNodeId != null
      ? (treeViewModel.nodeById.get(selectedTreeNodeId) ?? null)
      : null
  const selectedTreeIndex = selectedVisibleTreeNode
    ? treeViewModel.orderedVisibleNodes.findIndex(
        (node) => node.id === selectedVisibleTreeNode.id
      )
    : -1

  React.useEffect(() => {
    if (!treeOpen) return

    setTreeFilterMode("no-tools")
    setShowTreeLabelTimestamps(false)
    setFoldedTreeNodeIds([])
    setShowTreeShortcutsHelp(false)
    setShowCustomTreeSummary(false)
    setCustomTreeSummaryInstructions("")
  }, [treeOpen])

  React.useEffect(() => {
    if (!treeOpen) return

    const nextSelectedId = findNearestVisibleTreeNodeId(
      selectedTreeNodeId,
      treeViewModel.orderedVisibleNodes,
      treeViewModel.nodeById
    )

    if (nextSelectedId !== selectedTreeNodeId) {
      onSelectedTreeNodeIdChange(nextSelectedId)
      const nextSelectedNode =
        nextSelectedId != null
          ? treeViewModel.nodeById.get(nextSelectedId)
          : null
      onSelectedTreeNodeLabelChange(nextSelectedNode?.label || "")
    }
  }, [
    onSelectedTreeNodeIdChange,
    onSelectedTreeNodeLabelChange,
    selectedTreeNodeId,
    treeOpen,
    treeViewModel.nodeById,
    treeViewModel.orderedVisibleNodes,
  ])

  React.useEffect(() => {
    if (!treeOpen || treeLoading || showTreeShortcutsHelp) return

    const frame = window.requestAnimationFrame(() => {
      const selectedButton = selectedTreeNodeId
        ? document.querySelector<HTMLElement>(
            `[data-tree-node-button][data-tree-node-id="${CSS.escape(selectedTreeNodeId)}"]`
          )
        : null

      if (selectedButton) {
        selectedButton.focus()
        selectedButton.scrollIntoView({ block: "nearest" })
        return
      }

      treeSearchInputRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [selectedTreeNodeId, showTreeShortcutsHelp, treeLoading, treeOpen])

  const selectTreeNode = (
    nodeId: string | null,
    options?: { focus?: boolean }
  ) => {
    const nextId = nodeId?.trim() || null
    onSelectedTreeNodeIdChange(nextId)
    const nextNode = nextId
      ? (treeViewModel.nodeById.get(nextId) ?? null)
      : null
    onSelectedTreeNodeLabelChange(nextNode?.label || "")
    setShowCustomTreeSummary(false)

    if (options?.focus && nextId) {
      window.requestAnimationFrame(() => {
        const button = document.querySelector<HTMLElement>(
          `[data-tree-node-button][data-tree-node-id="${CSS.escape(nextId)}"]`
        )
        button?.focus()
        button?.scrollIntoView({ block: "nearest" })
      })
    }
  }

  const setTreeFilter = (nextMode: TreeFilterMode) => {
    setTreeFilterMode(nextMode)
    setFoldedTreeNodeIds([])
  }

  const focusTreeLabelInput = () => {
    window.requestAnimationFrame(() => {
      treeLabelInputRef.current?.focus()
      treeLabelInputRef.current?.select()
    })
  }

  React.useEffect(() => {
    if (!treeOpen) return

    const handleTreeKeyDown = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.ctrlKey && !event.metaKey) {
        const key = event.key.toLowerCase()

        if (key === "/" || key === "?") {
          event.preventDefault()
          setShowTreeShortcutsHelp((current) => !current)
          return
        }

        if (showTreeShortcutsHelp) return

        if (key === "enter") {
          if (document.activeElement === treeCustomSummaryRef.current) {
            event.preventDefault()
            if (selectedTreeNodeId) {
              void onNavigateTreeNode(selectedTreeNodeId, {
                summarize: true,
                customInstructions: customTreeSummaryInstructions,
              })
            }
          }
          return
        }

        if (key === "o") {
          event.preventDefault()
          setTreeFilter(
            cycleTreeFilterMode(treeFilterMode, event.shiftKey ? -1 : 1)
          )
          return
        }

        if (event.shiftKey) {
          const presetMap: Partial<Record<string, TreeFilterMode>> = {
            d: "default",
            t: "no-tools",
            u: "user-only",
            l: "labeled-only",
            a: "all",
          }
          const nextMode = presetMap[key]
          if (nextMode) {
            event.preventDefault()
            setTreeFilter(nextMode)
            return
          }
        }

        if (key === "h" || key === "l") {
          event.preventDefault()
          const selectedNode = selectedVisibleTreeNode
          if (!selectedNode) return

          if (key === "h") {
            if (selectedNode.hasVisibleChildren && !selectedNode.isFolded) {
              setFoldedTreeNodeIds((current) => [...current, selectedNode.id])
              return
            }

            if (selectedNode.parentVisibleId) {
              selectTreeNode(selectedNode.parentVisibleId, { focus: true })
            }
            return
          }

          if (selectedNode.hasVisibleChildren && selectedNode.isFolded) {
            setFoldedTreeNodeIds((current) =>
              current.filter((entryId) => entryId !== selectedNode.id)
            )
            return
          }

          const firstChildId =
            treeViewModel.visibleChildrenById.get(selectedNode.id)?.[0] ?? null
          if (firstChildId) {
            selectTreeNode(firstChildId, { focus: true })
          }
        }
      }

      if (showTreeShortcutsHelp) {
        if (event.key === "Escape") {
          event.preventDefault()
          setShowTreeShortcutsHelp(false)
        }
        return
      }

      const key = event.key.toLowerCase()
      const targetIsTextField =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement

      if (!targetIsTextField || event.target === treeSearchInputRef.current) {
        if (
          key === "arrowdown" ||
          key === "arrowup" ||
          (event.ctrlKey && !event.metaKey && (key === "j" || key === "k"))
        ) {
          if (treeViewModel.orderedVisibleNodes.length === 0) return
          event.preventDefault()
          const delta = key === "arrowup" || key === "k" ? -1 : 1
          const currentIndex = Math.max(selectedTreeIndex, 0)
          const nextIndex = Math.max(
            0,
            Math.min(
              treeViewModel.orderedVisibleNodes.length - 1,
              currentIndex + delta
            )
          )
          selectTreeNode(
            treeViewModel.orderedVisibleNodes[nextIndex]?.id ?? null,
            {
              focus: true,
            }
          )
          return
        }

        if (key === "home" || key === "end") {
          if (treeViewModel.orderedVisibleNodes.length === 0) return
          event.preventDefault()
          selectTreeNode(
            treeViewModel.orderedVisibleNodes[
              key === "home" ? 0 : treeViewModel.orderedVisibleNodes.length - 1
            ]?.id ?? null,
            { focus: true }
          )
          return
        }

        if (key === "arrowleft" || key === "arrowright") {
          const selectedNode = selectedVisibleTreeNode
          if (!selectedNode) return
          event.preventDefault()

          if (key === "arrowleft") {
            if (selectedNode.hasVisibleChildren && !selectedNode.isFolded) {
              setFoldedTreeNodeIds((current) => [...current, selectedNode.id])
              return
            }

            if (selectedNode.parentVisibleId) {
              selectTreeNode(selectedNode.parentVisibleId, { focus: true })
            }
            return
          }

          if (selectedNode.hasVisibleChildren && selectedNode.isFolded) {
            setFoldedTreeNodeIds((current) =>
              current.filter((entryId) => entryId !== selectedNode.id)
            )
            return
          }

          const firstChildId =
            treeViewModel.visibleChildrenById.get(selectedNode.id)?.[0] ?? null
          if (firstChildId) {
            selectTreeNode(firstChildId, { focus: true })
          }
          return
        }
      }

      if (!targetIsTextField) {
        if (event.shiftKey && key === "t") {
          event.preventDefault()
          setShowTreeLabelTimestamps((current) => !current)
          return
        }

        if (event.shiftKey && key === "l") {
          event.preventDefault()
          focusTreeLabelInput()
          return
        }

        if (key === "enter") {
          if (!selectedTreeNodeId || selectedTreeNodeId === treeLeafId) return
          event.preventDefault()
          void onNavigateTreeNode(selectedTreeNodeId)
          return
        }
      }

      if (event.key === "Escape") {
        if (showCustomTreeSummary) {
          event.preventDefault()
          setShowCustomTreeSummary(false)
          return
        }
      }
    }

    window.addEventListener("keydown", handleTreeKeyDown)
    return () => {
      window.removeEventListener("keydown", handleTreeKeyDown)
    }
  }, [
    customTreeSummaryInstructions,
    focusTreeLabelInput,
    onNavigateTreeNode,
    selectTreeNode,
    selectedTreeIndex,
    selectedTreeNodeId,
    selectedVisibleTreeNode,
    setTreeFilter,
    showCustomTreeSummary,
    showTreeShortcutsHelp,
    treeFilterMode,
    treeLeafId,
    treeOpen,
    treeViewModel.orderedVisibleNodes,
    treeViewModel.visibleChildrenById,
  ])

  return (
    <>
      <AppShellAddDirectoryDialog
        open={addDirectoryOpen}
        onOpenChange={onAddDirectoryOpenChange}
        directoryInput={directoryInput}
        onDirectoryInputChange={onDirectoryInputChange}
        openedDirectories={openedDirectories}
        currentDirectory={currentDirectory}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        onAddDirectory={onAddDirectory}
        onAddDirectoryPath={onAddDirectoryPath}
      />

      <RenameSessionDialog
        open={renameOpen}
        onOpenChange={onRenameOpenChange}
        renameValue={renameValue}
        onRenameValueChange={onRenameValueChange}
        onRenameSession={onRenameSession}
      />

      <DeleteSessionsDialog
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
        title={deleteTitle}
        description={deleteDescription}
        onDeleteSession={onDeleteSession}
      />

      <ForkSessionDialog
        open={forkOpen}
        onOpenChange={onForkOpenChange}
        forkLoading={forkLoading}
        forkMessages={forkMessages}
        onForkFromMessage={onForkFromMessage}
      />

      <Dialog open={treeOpen} onOpenChange={onTreeOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Session tree</DialogTitle>
            <DialogDescription>
              Browse branches, filter the tree, continue from an older point,
              and manage labels without leaving the native shell.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.9fr)]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={treeSearchInputRef}
                  value={treeQuery}
                  onChange={(event) => onTreeQueryChange(event.target.value)}
                  placeholder="Filter tree"
                  className="min-w-[220px] flex-1"
                />
                <Button
                  size="sm"
                  variant={showTreeShortcutsHelp ? "default" : "outline"}
                  onClick={() =>
                    setShowTreeShortcutsHelp((current) => !current)
                  }
                >
                  <KeyboardIcon data-icon="inline-start" />
                  Help
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {TREE_FILTER_OPTIONS.map((option) => (
                  <Button
                    key={option.mode}
                    size="sm"
                    variant={
                      treeFilterMode === option.mode ? "default" : "outline"
                    }
                    onClick={() => setTreeFilter(option.mode)}
                  >
                    {option.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={showTreeLabelTimestamps ? "default" : "outline"}
                  onClick={() =>
                    setShowTreeLabelTimestamps((current) => !current)
                  }
                >
                  Label time
                </Button>
              </div>
              <div className="rounded-lg border bg-background/80">
                {showTreeShortcutsHelp ? (
                  <div className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">
                          Tree shortcuts
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Tree-specific keys match the old browser and stay
                          scoped to this dialog.
                        </p>
                      </div>
                      <Badge variant="secondary">Ctrl+/</Badge>
                    </div>
                    <div className="space-y-2">
                      {TREE_SHORTCUT_ITEMS.map((item) => (
                        <div
                          key={item.label}
                          className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="space-y-1">
                            <div className="text-sm font-medium">
                              {item.label}
                            </div>
                            {item.description ? (
                              <div className="text-sm text-muted-foreground">
                                {item.description}
                              </div>
                            ) : null}
                          </div>
                          <code className="rounded bg-muted px-2 py-1 text-xs font-medium">
                            {item.keys}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ScrollArea className="h-[55vh]">
                    <div className="space-y-1 p-3">
                      {treeLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Spinner /> Loading tree…
                        </div>
                      ) : treeViewModel.orderedVisibleNodes.length > 0 ? (
                        treeViewModel.orderedVisibleNodes.map((node) => {
                          const entryText = treeDialogEntryText(node)
                          const timestamp = treeDialogFormatTimestamp(
                            node.timestamp
                          )
                          const labelTimestamp = showTreeLabelTimestamps
                            ? treeDialogFormatTimestamp(node.labelTimestamp)
                            : ""

                          return (
                            <button
                              key={node.id}
                              type="button"
                              data-tree-node-button
                              data-tree-node-id={node.id}
                              onClick={() => selectTreeNode(node.id)}
                              className={cn(
                                "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                selectedTreeNodeId === node.id &&
                                  "bg-muted ring-1 ring-border"
                              )}
                            >
                              <span
                                className="flex items-start gap-2 pt-0.5"
                                style={{
                                  paddingLeft: `${node.visibleDepth * 16}px`,
                                }}
                              >
                                <span className="flex size-4 items-center justify-center text-muted-foreground">
                                  {node.hasVisibleChildren ? (
                                    node.isFolded ? (
                                      <ChevronRightIcon className="size-4" />
                                    ) : (
                                      <ChevronDownIcon className="size-4" />
                                    )
                                  ) : (
                                    <span className="block size-1.5 rounded-full bg-current/60" />
                                  )}
                                </span>
                                <FolderTreeIcon className="size-4 shrink-0 text-muted-foreground" />
                              </span>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant={
                                      node.isCurrentLeaf
                                        ? "default"
                                        : "secondary"
                                    }
                                  >
                                    {treeDialogKindLabel(node)}
                                  </Badge>
                                  {node.label ? (
                                    <span className="text-sm font-medium text-foreground">
                                      [{node.label}]
                                    </span>
                                  ) : null}
                                  {labelTimestamp ? (
                                    <span className="text-xs text-muted-foreground">
                                      {labelTimestamp}
                                    </span>
                                  ) : null}
                                  {!node.isCurrentLeaf && node.isActivePath ? (
                                    <Badge variant="outline">Active path</Badge>
                                  ) : null}
                                </div>
                                <div className="line-clamp-2 text-sm text-foreground">
                                  {entryText}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  {timestamp ? <span>{timestamp}</span> : null}
                                  <span className="font-mono">
                                    {node.id.slice(
                                      Math.max(0, node.id.length - 8)
                                    )}
                                  </span>
                                </div>
                              </div>
                            </button>
                          )
                        })
                      ) : (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          No tree entries match the current filter.
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {treeLoading
                    ? "Loading tree…"
                    : treeViewModel.orderedVisibleNodes.length > 0
                      ? `(${selectedTreeIndex >= 0 ? selectedTreeIndex + 1 : 0}/${treeViewModel.orderedVisibleNodes.length}) [${treeFilterModeLabel(treeFilterMode).toLowerCase()}]${showTreeLabelTimestamps ? " [+label time]" : ""}`
                      : "No tree entries found."}
                </span>
                <span>
                  {treeSubmitting
                    ? "Navigating…"
                    : treeLeafId
                      ? `Current leaf ${treeLeafId.slice(Math.max(0, treeLeafId.length - 8))}`
                      : "No active leaf"}
                </span>
              </div>
            </div>
            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {selectedTreeNode
                      ? treeDialogKindLabel(selectedTreeNode)
                      : "No selection"}
                  </Badge>
                  {selectedTreeNodeId && selectedTreeNodeId === treeLeafId ? (
                    <Badge>Current</Badge>
                  ) : null}
                  {selectedVisibleTreeNode?.isActivePath ? (
                    <Badge variant="outline">Active path</Badge>
                  ) : null}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {selectedTreeNode?.label ||
                    (selectedTreeNode
                      ? treeDialogEntryText(selectedTreeNode)
                      : "Nothing selected")}
                </div>
                {selectedTreeNode ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div>{treeDialogEntryText(selectedTreeNode)}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {selectedTreeNode.timestamp ? (
                        <span>
                          {treeDialogFormatTimestamp(
                            selectedTreeNode.timestamp
                          )}
                        </span>
                      ) : null}
                      {showTreeLabelTimestamps &&
                      selectedTreeNode.label &&
                      selectedTreeNode.labelTimestamp ? (
                        <span>
                          Labeled{" "}
                          {treeDialogFormatTimestamp(
                            selectedTreeNode.labelTimestamp
                          )}
                        </span>
                      ) : null}
                      <span className="font-mono text-[11px]">
                        {selectedTreeNode.id}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Pick a tree entry to continue from that point or edit its
                    label.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Continue from here</div>
                <div className="flex flex-col gap-2">
                  <Button
                    disabled={
                      !selectedTreeNodeId ||
                      selectedTreeNodeId === treeLeafId ||
                      treeLoading ||
                      treeSubmitting
                    }
                    onClick={() =>
                      selectedTreeNodeId &&
                      onNavigateTreeNode(selectedTreeNodeId)
                    }
                  >
                    Continue
                  </Button>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      disabled={
                        !selectedTreeNodeId ||
                        selectedTreeNodeId === treeLeafId ||
                        !treeSummaryAvailable ||
                        treeLoading ||
                        treeSubmitting
                      }
                      onClick={() =>
                        selectedTreeNodeId &&
                        onNavigateTreeNode(selectedTreeNodeId, {
                          summarize: true,
                        })
                      }
                    >
                      Summarize
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        !selectedTreeNodeId ||
                        selectedTreeNodeId === treeLeafId ||
                        !treeSummaryAvailable ||
                        treeLoading ||
                        treeSubmitting
                      }
                      onClick={() => {
                        setShowCustomTreeSummary((current) => !current)
                        window.requestAnimationFrame(() => {
                          treeCustomSummaryRef.current?.focus()
                        })
                      }}
                    >
                      Custom prompt
                    </Button>
                  </div>
                </div>
                {!treeSummaryAvailable ? (
                  <p className="text-xs text-muted-foreground">
                    Summary actions are only available when a model is selected.
                  </p>
                ) : null}
                {showCustomTreeSummary ? (
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    <Textarea
                      ref={treeCustomSummaryRef}
                      value={customTreeSummaryInstructions}
                      onChange={(event) =>
                        setCustomTreeSummaryInstructions(event.target.value)
                      }
                      placeholder="Add summary instructions before navigating"
                      className="min-h-28"
                    />
                    <Button
                      size="sm"
                      disabled={
                        !selectedTreeNodeId ||
                        selectedTreeNodeId === treeLeafId ||
                        treeLoading ||
                        treeSubmitting
                      }
                      onClick={() =>
                        selectedTreeNodeId &&
                        onNavigateTreeNode(selectedTreeNodeId, {
                          summarize: true,
                          customInstructions: customTreeSummaryInstructions,
                        })
                      }
                    >
                      Summarize & continue
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Label</div>
                  <code className="rounded bg-muted px-2 py-1 text-[11px] font-medium">
                    Shift+L
                  </code>
                </div>
                <Input
                  ref={treeLabelInputRef}
                  value={selectedTreeNodeLabel}
                  onChange={(event) =>
                    onSelectedTreeNodeLabelChange(event.target.value)
                  }
                  placeholder="Optional label"
                  disabled={
                    !selectedTreeNodeId || treeLoading || treeSubmitting
                  }
                />
                <Button
                  variant="outline"
                  disabled={
                    !selectedTreeNodeId || treeLoading || treeSubmitting
                  }
                  onClick={onSaveTreeLabel}
                >
                  Save label
                </Button>
              </div>

              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Enter continues without summary. Ctrl+Enter submits the custom
                summary prompt. Esc closes help, custom summary mode, or the
                tree dialog.
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AppShellSettingsDialog
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        currentTheme={currentTheme}
        onThemeChange={onThemeChange}
        hideThinkingBlocks={hideThinkingBlocks}
        onHideThinkingBlocksChange={onHideThinkingBlocksChange}
        hideToolBlocks={hideToolBlocks}
        onHideToolBlocksChange={onHideToolBlocksChange}
        centerMessages={centerMessages}
        onCenterMessagesChange={onCenterMessagesChange}
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        onSessionDoneDesktopNotificationsEnabledChange={
          onSessionDoneDesktopNotificationsEnabledChange
        }
        desktopNotificationPermission={desktopNotificationPermission}
      />

      <AppShellUiRequestDialog
        pendingUiRequest={pendingUiRequest}
        pendingUiValue={pendingUiValue}
        onPendingUiValueChange={onPendingUiValueChange}
        onResolveUiRequest={onResolveUiRequest}
      />
    </>
  )
}
