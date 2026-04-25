import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { TreeNavigateOptions } from "@/features/pi-web/app-shell-dialog-types"
import type { FlatTreeNode, TreeNode } from "@/lib/pi-web"
import type {
  NavigateSessionTreeResponse,
  SessionTreeResponse,
} from "@/lib/pi-web-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { piWebQueryKeys } from "@/features/pi-web/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"
import { flattenTree } from "@/lib/pi-web"
import { cn } from "@/lib/utils"

type SessionTreeData = Extract<SessionTreeResponse, { ok: true }>
type NavigateSessionTreeData = Extract<
  NavigateSessionTreeResponse,
  { ok: true }
>

type TreeFilterMode =
  | "default"
  | "no-tools"
  | "user-only"
  | "labeled-only"
  | "all"

type TreeStage = "browse" | "actions" | "custom"

type TreeGutter = {
  position: number
  show: boolean
}

type TreeLinearNode = FlatTreeNode & {
  indent: number
  showConnector: boolean
  isLast: boolean
  gutters: Array<TreeGutter>
  isVirtualRootChild: boolean
  multipleRoots: boolean
}

type TreeVisibleNode = TreeLinearNode & {
  hasVisibleChildren: boolean
  isCurrentLeaf: boolean
  isActivePath: boolean
}

type TreeDialogViewModel = {
  nodeById: Map<string, FlatTreeNode>
  visibleParentById: Map<string, string | null>
  visibleChildrenById: Map<string | null, Array<string>>
  orderedVisibleNodes: Array<TreeVisibleNode>
}

const TREE_FILTER_OPTIONS: Array<{
  mode: TreeFilterMode
  label: string
  shortcut: Array<string>
}> = [
  { mode: "default", label: "Default", shortcut: ["Ctrl", "D"] },
  { mode: "no-tools", label: "No tools", shortcut: ["Ctrl", "T"] },
  { mode: "user-only", label: "User only", shortcut: ["Ctrl", "U"] },
  { mode: "labeled-only", label: "Labeled", shortcut: ["Ctrl", "L"] },
  { mode: "all", label: "All", shortcut: ["Ctrl", "A"] },
]

const TREE_FILTER_CYCLE_SHORTCUTS = {
  next: ["Ctrl", "O"],
  previous: ["Ctrl", "Shift", "O"],
} as const

function cycleTreeFilterMode(
  mode: TreeFilterMode,
  direction: 1 | -1
): TreeFilterMode {
  const modes = TREE_FILTER_OPTIONS.map((option) => option.mode)
  const currentIndex = Math.max(0, modes.indexOf(mode))
  return modes[(currentIndex + direction + modes.length) % modes.length] ?? mode
}

function toggleTreeFilterMode(
  currentMode: TreeFilterMode,
  requestedMode: TreeFilterMode
): TreeFilterMode {
  if (requestedMode === "default") return "default"
  return currentMode === requestedMode ? "default" : requestedMode
}

function TreeShortcutKeys({ keys }: { keys: Array<string> }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={`${keys.join("-")}-${key}`}
          className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

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
      if (entry.type === "message" && message.role === "toolResult") {
        return false
      }
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

function treeDialogRootNodes(flatTree: Array<FlatTreeNode>) {
  const nodeById = new Map(flatTree.map((node) => [node.id, node]))

  return flatTree
    .filter((node) => {
      const parentId = node.parentId ?? null
      return parentId === null || !nodeById.has(parentId)
    })
    .map((node) => node.node)
}

function treeDialogActivePathIds(
  nodeById: Map<string, FlatTreeNode>,
  currentLeafId: string | null
) {
  const activeIds = new Set<string>()
  let currentId = currentLeafId

  while (currentId) {
    activeIds.add(currentId)
    currentId = nodeById.get(currentId)?.parentId ?? null
  }

  return activeIds
}

function treeDialogFlattenTree({
  flatTree,
  currentLeafId,
}: {
  flatTree: Array<FlatTreeNode>
  currentLeafId: string | null
}) {
  const originalById = new Map(flatTree.map((node) => [node.id, node]))
  const roots = treeDialogRootNodes(flatTree)
  const flattened: Array<TreeLinearNode> = []
  const multipleRoots = roots.length > 1
  const containsActive = new Map<TreeNode, boolean>()
  const allNodes: Array<TreeNode> = []
  const preOrderStack = [...roots]

  while (preOrderStack.length > 0) {
    const node = preOrderStack.pop()
    if (!node?.entry?.id) continue

    allNodes.push(node)
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      preOrderStack.push(node.children[index])
    }
  }

  for (let index = allNodes.length - 1; index >= 0; index -= 1) {
    const node = allNodes[index]
    let hasActive = currentLeafId !== null && node.entry.id === currentLeafId

    for (const child of node.children) {
      if (containsActive.get(child)) {
        hasActive = true
        break
      }
    }

    containsActive.set(node, hasActive)
  }

  const orderedRoots = [...roots].sort(
    (a, b) =>
      Number(Boolean(containsActive.get(b))) -
      Number(Boolean(containsActive.get(a)))
  )
  const stack: Array<
    [TreeNode, number, boolean, boolean, boolean, Array<TreeGutter>, boolean]
  > = []

  for (let index = orderedRoots.length - 1; index >= 0; index -= 1) {
    const isLast = index === orderedRoots.length - 1
    stack.push([
      orderedRoots[index],
      multipleRoots ? 1 : 0,
      multipleRoots,
      multipleRoots,
      isLast,
      [],
      multipleRoots,
    ])
  }

  while (stack.length > 0) {
    const [
      node,
      indent,
      justBranched,
      showConnector,
      isLast,
      gutters,
      isVirtualRootChild,
    ] = stack.pop()!
    const original = originalById.get(node.entry.id)
    if (!original) continue

    flattened.push({
      ...original,
      indent,
      showConnector,
      isLast,
      gutters,
      isVirtualRootChild,
      multipleRoots,
    })

    const children = node.children
    const multipleChildren = children.length > 1
    const prioritized: Array<TreeNode> = []
    const rest: Array<TreeNode> = []

    for (const child of children) {
      if (containsActive.get(child)) {
        prioritized.push(child)
      } else {
        rest.push(child)
      }
    }

    const orderedChildren = [...prioritized, ...rest]

    let childIndent: number
    if (multipleChildren) {
      childIndent = indent + 1
    } else if (justBranched && indent > 0) {
      childIndent = indent + 1
    } else {
      childIndent = indent
    }

    const connectorDisplayed = showConnector && !isVirtualRootChild
    const currentDisplayIndent = multipleRoots
      ? Math.max(0, indent - 1)
      : indent
    const connectorPosition = Math.max(0, currentDisplayIndent - 1)
    const childGutters = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters

    for (let index = orderedChildren.length - 1; index >= 0; index -= 1) {
      const childIsLast = index === orderedChildren.length - 1
      stack.push([
        orderedChildren[index],
        childIndent,
        multipleChildren,
        multipleChildren,
        childIsLast,
        childGutters,
        false,
      ])
    }
  }

  return flattened
}

function treeDialogRecalculateVisualStructure(
  visibleNodes: Array<TreeLinearNode>,
  allNodes: Array<TreeLinearNode>
) {
  const visibleParentById = new Map<string, string | null>()
  const visibleChildrenById = new Map<string | null, Array<string>>([
    [null, []],
  ])

  if (visibleNodes.length === 0) {
    return { visibleParentById, visibleChildrenById }
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id))
  const allNodeById = new Map(allNodes.map((node) => [node.id, node]))

  const findVisibleAncestor = (nodeId: string) => {
    let currentId = allNodeById.get(nodeId)?.parentId ?? null

    while (currentId !== null) {
      if (visibleIds.has(currentId)) {
        return currentId
      }
      currentId = allNodeById.get(currentId)?.parentId ?? null
    }

    return null
  }

  for (const node of visibleNodes) {
    const parentId = findVisibleAncestor(node.id)
    visibleParentById.set(node.id, parentId)
    const siblings = visibleChildrenById.get(parentId) ?? []
    siblings.push(node.id)
    visibleChildrenById.set(parentId, siblings)
  }

  const visibleRootIds = visibleChildrenById.get(null) ?? []
  const multipleRoots = visibleRootIds.length > 1
  const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]))
  const stack: Array<
    [string, number, boolean, boolean, boolean, Array<TreeGutter>, boolean]
  > = []

  for (let index = visibleRootIds.length - 1; index >= 0; index -= 1) {
    const isLast = index === visibleRootIds.length - 1
    stack.push([
      visibleRootIds[index],
      multipleRoots ? 1 : 0,
      multipleRoots,
      multipleRoots,
      isLast,
      [],
      multipleRoots,
    ])
  }

  while (stack.length > 0) {
    const [
      nodeId,
      indent,
      justBranched,
      showConnector,
      isLast,
      gutters,
      isVirtualRootChild,
    ] = stack.pop()!
    const node = visibleNodeById.get(nodeId)
    if (!node) continue

    node.indent = indent
    node.showConnector = showConnector
    node.isLast = isLast
    node.gutters = gutters
    node.isVirtualRootChild = isVirtualRootChild
    node.multipleRoots = multipleRoots

    const children = visibleChildrenById.get(nodeId) ?? []
    const multipleChildren = children.length > 1

    let childIndent: number
    if (multipleChildren) {
      childIndent = indent + 1
    } else if (justBranched && indent > 0) {
      childIndent = indent + 1
    } else {
      childIndent = indent
    }

    const connectorDisplayed = showConnector && !isVirtualRootChild
    const currentDisplayIndent = multipleRoots
      ? Math.max(0, indent - 1)
      : indent
    const connectorPosition = Math.max(0, currentDisplayIndent - 1)
    const childGutters = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childIsLast = index === children.length - 1
      stack.push([
        children[index],
        childIndent,
        multipleChildren,
        multipleChildren,
        childIsLast,
        childGutters,
        false,
      ])
    }
  }

  return { visibleParentById, visibleChildrenById }
}

function buildTreeDialogViewModel({
  flatTree,
  currentLeafId,
  query,
  filterMode,
}: {
  flatTree: Array<FlatTreeNode>
  currentLeafId: string | null
  query: string
  filterMode: TreeFilterMode
}): TreeDialogViewModel {
  const nodeById = new Map(flatTree.map((node) => [node.id, node]))
  const activePathIds = treeDialogActivePathIds(nodeById, currentLeafId)
  const flattenedNodes = treeDialogFlattenTree({ flatTree, currentLeafId })
  const searchTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visibleNodes = flattenedNodes.filter((node) =>
    treeDialogPassesFilter(node, filterMode, currentLeafId, searchTokens)
  )
  const { visibleParentById, visibleChildrenById } =
    treeDialogRecalculateVisualStructure(visibleNodes, flattenedNodes)

  return {
    nodeById,
    visibleParentById,
    visibleChildrenById,
    orderedVisibleNodes: visibleNodes.map((node) => ({
      ...node,
      hasVisibleChildren: (visibleChildrenById.get(node.id)?.length ?? 0) > 0,
      isCurrentLeaf: node.id === currentLeafId,
      isActivePath: activePathIds.has(node.id),
    })),
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

function treeDialogIsBranchStart(
  viewModel: TreeDialogViewModel,
  entryId: string
) {
  const children = viewModel.visibleChildrenById.get(entryId)
  if (!children || children.length === 0) return false

  const parentId = viewModel.visibleParentById.get(entryId)
  if (parentId == null) return true

  const siblings = viewModel.visibleChildrenById.get(parentId)
  return Array.isArray(siblings) && siblings.length > 1
}

function treeDialogLegacyIconSvg(
  name:
    | "gutter"
    | "connector-tee"
    | "connector-elbow"
    | "leaf-line"
    | "fold-open"
    | "active-path"
) {
  const wrap = (body: string, viewBox = "0 0 10 24") =>
    `<svg class="size-full block" viewBox="${viewBox}" fill="none" aria-hidden="true">${body}</svg>`

  switch (name) {
    case "gutter":
      return wrap('<path d="M5 0V24" stroke="currentColor" stroke-width="1"/>')
    case "connector-tee":
      return wrap(
        '<path d="M5 0V24M5 12H10" stroke="currentColor" stroke-width="1"/>'
      )
    case "connector-elbow":
      return wrap(
        '<path d="M5 0V12M5 12H10" stroke="currentColor" stroke-width="1"/>'
      )
    case "leaf-line":
      return wrap('<path d="M0 12H10" stroke="currentColor" stroke-width="1"/>')
    case "fold-open":
      return wrap(
        '<rect x="0.5" y="7.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1"/><path d="M2.5 12H7.5" stroke="currentColor" stroke-width="1"/>'
      )
    case "active-path":
      return wrap('<circle cx="5" cy="12" r="2.25" fill="currentColor"/>')
  }
}

function TreeHierarchyIcon({
  name,
  className,
}: {
  name:
    | "gutter"
    | "connector-tee"
    | "connector-elbow"
    | "leaf-line"
    | "fold-open"
    | "active-path"
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-6 w-2.5 [&_svg]:block [&_svg]:h-full [&_svg]:w-full",
        className
      )}
      dangerouslySetInnerHTML={{ __html: treeDialogLegacyIconSvg(name) }}
    />
  )
}

function TreeCommandPrefix({
  node,
  viewModel,
}: {
  node: TreeVisibleNode
  viewModel: TreeDialogViewModel
}) {
  const displayIndent = node.multipleRoots
    ? Math.max(0, node.indent - 1)
    : node.indent
  const connector = node.showConnector && !node.isVirtualRootChild
  const connectorPosition = connector ? displayIndent - 1 : -1
  const branchStart = treeDialogIsBranchStart(viewModel, node.id)
  const totalCells = displayIndent * 3

  if (totalCells <= 0) {
    return <span className="block h-6 w-0 shrink-0" aria-hidden="true" />
  }

  return (
    <span className="inline-flex h-6 shrink-0 items-stretch text-muted-foreground">
      {Array.from({ length: totalCells }, (_, index) => {
        const level = Math.floor(index / 3)
        const positionInLevel = index % 3
        const gutter = node.gutters.find(
          (candidate) => candidate.position === level
        )

        if (gutter) {
          return (
            <span
              key={`${node.id}-gutter-${index}`}
              className="flex h-6 w-2.5 items-center justify-center"
            >
              {positionInLevel === 0 && gutter.show ? (
                <TreeHierarchyIcon name="gutter" />
              ) : null}
            </span>
          )
        }

        if (connector && level === connectorPosition) {
          if (positionInLevel === 0) {
            return (
              <span
                key={`${node.id}-connector-${index}`}
                className="flex h-6 w-2.5 items-center justify-center"
              >
                <TreeHierarchyIcon
                  name={node.isLast ? "connector-elbow" : "connector-tee"}
                />
              </span>
            )
          }

          if (positionInLevel === 1) {
            return (
              <span
                key={`${node.id}-marker-${index}`}
                className="flex h-6 w-2.5 items-center justify-center"
              >
                <TreeHierarchyIcon
                  name={branchStart ? "fold-open" : "leaf-line"}
                />
              </span>
            )
          }
        }

        return (
          <span
            key={`${node.id}-empty-${index}`}
            className="block h-6 w-2.5 shrink-0"
          />
        )
      })}
    </span>
  )
}

function treeDialogPlainText(node: FlatTreeNode) {
  const entry = node.node.entry
  const message = entry.message || {}

  if (entry.type === "message") {
    switch (message.role) {
      case "user":
        return `user: ${treeDialogNormalizeLine(message.text) || "(no content)"}`
      case "assistant": {
        const text = treeDialogNormalizeLine(message.text)
        if (text) return `assistant: ${text}`
        if (message.stopReason === "aborted") return "assistant: (aborted)"
        if (message.errorMessage) {
          return `assistant: ${treeDialogNormalizeLine(message.errorMessage)}`
        }
        return "assistant: (no content)"
      }
      case "toolResult":
        return treeDialogEntryText(node)
      case "bashExecution":
        return `[bash]: ${treeDialogNormalizeLine(message.command)}`
      default:
        return treeDialogEntryText(node)
    }
  }

  switch (entry.type) {
    case "compaction": {
      const tokens = Math.round((Number(entry.tokensBefore) || 0) / 1000)
      return `[compaction: ${tokens}k tokens]`
    }
    case "branch_summary":
      return `[branch summary]: ${treeDialogNormalizeLine(entry.summary) || "Branch summary"}`
    case "custom_message":
      return `[${entry.customType || "custom"}]: ${treeDialogNormalizeLine(entry.text) || "Custom message"}`
    case "model_change":
      return `[model: ${entry.modelId || ""}]`
    case "thinking_level_change":
      return `[thinking: ${entry.thinkingLevel || ""}]`
    case "session_info":
      return entry.name ? `[title: ${entry.name}]` : "[title: empty]"
    case "label":
      return `[label: ${entry.label ?? "(cleared)"}]`
    case "custom":
      return `[custom: ${entry.customType || "custom"}]`
    default:
      return `[${entry.type || "entry"}]`
  }
}

function TreeEntryLine({ node }: { node: FlatTreeNode }) {
  const entry = node.node.entry
  const message = entry.message || {}

  if (entry.type === "message") {
    switch (message.role) {
      case "user":
        return (
          <div className="min-w-0 truncate text-sm leading-6 text-foreground">
            <span className="font-semibold text-primary">user:</span>{" "}
            {treeDialogNormalizeLine(message.text) || "(no content)"}
          </div>
        )
      case "assistant": {
        const text = treeDialogNormalizeLine(message.text)
        return (
          <div className="min-w-0 truncate text-sm leading-6 text-foreground">
            <span className="font-semibold text-[var(--success)]">
              assistant:
            </span>{" "}
            {text ? (
              text
            ) : message.stopReason === "aborted" ? (
              <span className="text-muted-foreground">(aborted)</span>
            ) : message.errorMessage ? (
              <span className="text-[var(--danger)]">
                {treeDialogNormalizeLine(message.errorMessage)}
              </span>
            ) : (
              <span className="text-muted-foreground">(no content)</span>
            )}
          </div>
        )
      }
      case "toolResult":
        return (
          <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
            {treeDialogEntryText(node)}
          </div>
        )
      case "bashExecution":
        return (
          <div className="min-w-0 truncate text-sm leading-6 text-foreground">
            <span className="text-muted-foreground">[bash]:</span>{" "}
            {treeDialogNormalizeLine(message.command) || "Shell command"}
          </div>
        )
      default:
        return (
          <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
            {treeDialogEntryText(node)}
          </div>
        )
    }
  }

  switch (entry.type) {
    case "compaction": {
      const tokens = Math.round((Number(entry.tokensBefore) || 0) / 1000)
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-[var(--warning)]">
          [compaction: {tokens}k tokens]
        </div>
      )
    }
    case "branch_summary":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-[var(--warning)]">
          <span className="font-semibold">[branch summary]:</span>{" "}
          {treeDialogNormalizeLine(entry.summary) || "Branch summary"}
        </div>
      )
    case "custom_message":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-[var(--warning)]">
          [{entry.customType || "custom"}]:{" "}
          {treeDialogNormalizeLine(entry.text) || "Custom message"}
        </div>
      )
    case "model_change":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
          [model: {entry.modelId || ""}]
        </div>
      )
    case "thinking_level_change":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
          [thinking: {entry.thinkingLevel || ""}]
        </div>
      )
    case "session_info":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
          {entry.name ? `[title: ${entry.name}]` : "[title: empty]"}
        </div>
      )
    case "label":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
          [label: {entry.label ?? "(cleared)"}]
        </div>
      )
    case "custom":
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
          [custom: {entry.customType || "custom"}]
        </div>
      )
    default:
      return (
        <div className="min-w-0 truncate text-sm leading-6 text-muted-foreground">
          [{entry.type || "entry"}]
        </div>
      )
  }
}

function TreeSelectedNodeCard({
  node,
  visibleNode,
}: {
  node: FlatTreeNode
  visibleNode: TreeVisibleNode | null
}) {
  const timestamp = treeDialogFormatTimestamp(node.timestamp)
  const labelTimestamp =
    node.label && node.labelTimestamp
      ? treeDialogFormatTimestamp(node.labelTimestamp)
      : ""

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{treeDialogKindLabel(node)}</Badge>
        {visibleNode?.isCurrentLeaf ? <Badge>Current</Badge> : null}
        {visibleNode?.isActivePath ? (
          <Badge variant="outline">Active path</Badge>
        ) : null}
        {node.label ? (
          <span className="text-sm font-medium text-foreground">
            [{node.label}]
          </span>
        ) : null}
      </div>
      <div className="text-sm font-medium text-foreground">
        {treeDialogEntryText(node)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {timestamp ? <span>{timestamp}</span> : null}
        {labelTimestamp ? <span>Labeled {labelTimestamp}</span> : null}
        <span className="font-mono">
          {node.id.slice(Math.max(0, node.id.length - 8))}
        </span>
      </div>
    </div>
  )
}

type TreeBrowsePanelProps = {
  isMobile: boolean
  treeFilterMode: TreeFilterMode
  onTreeFilterModeChange: (value: TreeFilterMode) => void
  treeLoading: boolean
  treeSubmitting: boolean
  treeLeafId: string | null
  treeQuery: string
  onTreeQueryChange: (value: string) => void
  treeViewModel: TreeDialogViewModel
  selectedTreeNodeId: string | null
  onSelectTreeNode: (nodeId: string) => void
}

function TreeBrowsePanel({
  isMobile,
  treeFilterMode,
  onTreeFilterModeChange,
  treeLoading,
  treeSubmitting,
  treeLeafId,
  treeQuery,
  onTreeQueryChange,
  treeViewModel,
  selectedTreeNodeId,
  onSelectTreeNode,
}: TreeBrowsePanelProps) {
  const [treeCursorNodeId, setTreeCursorNodeId] = React.useState<string | null>(
    selectedTreeNodeId || treeLeafId || null
  )

  const cursorVisibleTreeNode =
    treeCursorNodeId != null
      ? (treeViewModel.orderedVisibleNodes.find(
          (node) => node.id === treeCursorNodeId
        ) ?? null)
      : null
  const cursorTreeIndex = treeCursorNodeId
    ? treeViewModel.orderedVisibleNodes.findIndex(
        (node) => node.id === treeCursorNodeId
      )
    : -1

  React.useEffect(() => {
    const fallbackId = findNearestVisibleTreeNodeId(
      treeCursorNodeId || selectedTreeNodeId || treeLeafId,
      treeViewModel.orderedVisibleNodes,
      treeViewModel.nodeById
    )

    if (fallbackId !== treeCursorNodeId) {
      setTreeCursorNodeId(fallbackId)
    }
  }, [
    selectedTreeNodeId,
    treeCursorNodeId,
    treeLeafId,
    treeViewModel.nodeById,
    treeViewModel.orderedVisibleNodes,
  ])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        {TREE_FILTER_OPTIONS.map((option) => (
          <Button
            key={option.mode}
            size="sm"
            variant={treeFilterMode === option.mode ? "default" : "outline"}
            onClick={() => onTreeFilterModeChange(option.mode)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <Command
        shouldFilter={false}
        loop
        value={cursorVisibleTreeNode?.id ?? undefined}
        onValueChange={(value) => {
          if (!value || value === treeCursorNodeId) return
          if (!treeViewModel.nodeById.has(value)) return
          setTreeCursorNodeId(value)
        }}
        className="min-h-0 w-full max-w-full min-w-0 flex-1 rounded-lg border"
      >
        <CommandInput
          autoFocus={!isMobile}
          value={treeQuery}
          onValueChange={onTreeQueryChange}
          placeholder="Search tree"
          className="text-base md:text-sm"
        />
        <CommandList className="max-h-none min-h-0 flex-1">
          {treeLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Spinner /> Loading tree…
            </div>
          ) : treeViewModel.orderedVisibleNodes.length > 0 ? (
            treeViewModel.orderedVisibleNodes.map((node) => (
              <CommandItem
                key={node.id}
                value={node.id}
                disabled={treeSubmitting || node.id === treeLeafId}
                onMouseEnter={() => {
                  if (treeCursorNodeId !== node.id) {
                    setTreeCursorNodeId(node.id)
                  }
                }}
                onClick={() => onSelectTreeNode(node.id)}
                onSelect={() => onSelectTreeNode(node.id)}
                title={treeDialogPlainText(node)}
                className="h-6 min-w-0 items-stretch gap-2 overflow-hidden px-2 py-0"
              >
                <div className="flex shrink-0 items-stretch gap-1 text-muted-foreground">
                  <TreeCommandPrefix node={node} viewModel={treeViewModel} />
                  <span className="flex h-6 w-2.5 items-center justify-center">
                    {node.isActivePath ? (
                      <TreeHierarchyIcon
                        name="active-path"
                        className={cn(
                          node.isActivePath
                            ? "text-[var(--success)]"
                            : "text-muted-foreground"
                        )}
                      />
                    ) : null}
                  </span>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {node.label ? (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border/90 bg-background/20 px-2 text-[11px] font-semibold text-muted-foreground">
                      [{node.label}]
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <TreeEntryLine node={node} />
                  </div>
                </div>
              </CommandItem>
            ))
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {treeQuery.trim()
                ? "No tree entries match the current search."
                : "No tree entries match the current filter."}
            </div>
          )}
        </CommandList>
      </Command>

      <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        {treeLoading
          ? "Loading tree…"
          : `${Math.max(0, cursorTreeIndex + 1)}/${treeViewModel.orderedVisibleNodes.length}`}
      </div>
    </div>
  )
}

type AppShellTreeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
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
}

export function AppShellTreeDialog({
  open,
  onOpenChange,
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
}: AppShellTreeDialogProps) {
  const [treeFilterMode, setTreeFilterMode] =
    React.useState<TreeFilterMode>("no-tools")
  const [treeStage, setTreeStage] = React.useState<TreeStage>("browse")
  const [customTreeSummaryInstructions, setCustomTreeSummaryInstructions] =
    React.useState("")
  const treeCustomSummaryRef = React.useRef<HTMLTextAreaElement | null>(null)
  const treeWasOpenRef = React.useRef(false)
  const isMobile = useIsMobile()

  const treeViewModel = React.useMemo(
    () =>
      buildTreeDialogViewModel({
        flatTree,
        currentLeafId: treeLeafId,
        query: treeQuery,
        filterMode: treeFilterMode,
      }),
    [flatTree, treeFilterMode, treeLeafId, treeQuery]
  )

  const selectedTreeNode =
    selectedTreeNodeId != null
      ? (treeViewModel.nodeById.get(selectedTreeNodeId) ?? null)
      : null
  const selectedVisibleTreeNode =
    selectedTreeNodeId != null
      ? (treeViewModel.orderedVisibleNodes.find(
          (node) => node.id === selectedTreeNodeId
        ) ?? null)
      : null

  React.useEffect(() => {
    const wasOpen = treeWasOpenRef.current
    treeWasOpenRef.current = open

    if (!open || wasOpen) return

    setTreeFilterMode("no-tools")
    setTreeStage("browse")
    setCustomTreeSummaryInstructions("")
  }, [open, selectedTreeNodeId, treeLeafId])

  React.useEffect(() => {
    if (!open) return

    if (treeStage !== "browse" && !selectedTreeNode) {
      setTreeStage("browse")
    }
  }, [open, selectedTreeNode, treeStage])

  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if (
        treeStage === "browse" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (key === "o") {
          event.preventDefault()
          event.stopPropagation()
          setTreeFilterMode(
            cycleTreeFilterMode(treeFilterMode, event.shiftKey ? -1 : 1)
          )
          return
        }

        if (!event.shiftKey) {
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
            event.stopPropagation()
            setTreeFilterMode((currentMode) =>
              toggleTreeFilterMode(currentMode, nextMode)
            )
            return
          }
        }
      }

      if (event.key !== "Escape") {
        if (
          treeStage === "custom" &&
          (event.ctrlKey || event.metaKey) &&
          event.key === "Enter" &&
          selectedTreeNodeId &&
          selectedTreeNodeId !== treeLeafId &&
          !treeSubmitting
        ) {
          event.preventDefault()
          event.stopPropagation()
          void onNavigateTreeNode(selectedTreeNodeId, {
            summarize: true,
            customInstructions: customTreeSummaryInstructions,
          })
        }
        return
      }

      if (treeStage === "custom") {
        event.preventDefault()
        event.stopPropagation()
        setTreeStage("actions")
        return
      }

      if (treeStage === "actions") {
        event.preventDefault()
        event.stopPropagation()
        setTreeStage("browse")
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [
    customTreeSummaryInstructions,
    onNavigateTreeNode,
    open,
    selectedTreeNodeId,
    treeFilterMode,
    treeLeafId,
    treeStage,
    treeSubmitting,
  ])

  React.useEffect(() => {
    if (!open || treeStage !== "custom" || isMobile) return

    const frame = window.requestAnimationFrame(() => {
      treeCustomSummaryRef.current?.focus()
      treeCustomSummaryRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [isMobile, open, treeStage])

  const selectTreeNode = (nodeId: string) => {
    const node = treeViewModel.nodeById.get(nodeId)
    if (!node) return

    onSelectedTreeNodeIdChange(nodeId)
    onSelectedTreeNodeLabelChange(node.label || "")
    setTreeStage("actions")
  }

  const canNavigateSelectedNode = Boolean(
    selectedTreeNodeId && selectedTreeNodeId !== treeLeafId && selectedTreeNode
  )

  const treeDialogBody =
    treeStage === "browse" ? (
      <TreeBrowsePanel
        isMobile={isMobile}
        treeFilterMode={treeFilterMode}
        onTreeFilterModeChange={setTreeFilterMode}
        treeLoading={treeLoading}
        treeSubmitting={treeSubmitting}
        treeLeafId={treeLeafId}
        treeQuery={treeQuery}
        onTreeQueryChange={onTreeQueryChange}
        treeViewModel={treeViewModel}
        selectedTreeNodeId={selectedTreeNodeId}
        onSelectTreeNode={selectTreeNode}
      />
    ) : selectedTreeNode ? (
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-muted-foreground">
            {treeStage === "custom"
              ? "Summarize with custom prompt"
              : "Continue from selected node"}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setTreeStage(treeStage === "custom" ? "actions" : "browse")
            }
            disabled={treeSubmitting}
          >
            Back to tree
          </Button>
        </div>

        <TreeSelectedNodeCard
          node={selectedTreeNode}
          visibleNode={selectedVisibleTreeNode}
        />

        {treeStage === "actions" ? (
          <>
            <Command loop className="rounded-lg border">
              <CommandInput
                autoFocus={!isMobile}
                placeholder="Choose action"
                className="text-base md:text-sm"
              />
              <CommandList>
                <CommandGroup heading="Continue">
                  <CommandItem
                    value="No summary"
                    disabled={!canNavigateSelectedNode || treeSubmitting}
                    onSelect={() => {
                      if (!selectedTreeNodeId) return
                      void onNavigateTreeNode(selectedTreeNodeId)
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium">No summary</span>
                      <span className="text-xs text-muted-foreground">
                        Continue from this point immediately.
                      </span>
                    </div>
                  </CommandItem>
                  <CommandItem
                    value="Summarize"
                    disabled={
                      !canNavigateSelectedNode ||
                      !treeSummaryAvailable ||
                      treeSubmitting
                    }
                    onSelect={() => {
                      if (!selectedTreeNodeId) return
                      void onNavigateTreeNode(selectedTreeNodeId, {
                        summarize: true,
                      })
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium">Summarize</span>
                      <span className="text-xs text-muted-foreground">
                        Summarize the branch you are leaving first.
                      </span>
                    </div>
                  </CommandItem>
                  <CommandItem
                    value="Summarize with custom prompt"
                    disabled={
                      !canNavigateSelectedNode ||
                      !treeSummaryAvailable ||
                      treeSubmitting
                    }
                    onSelect={() => {
                      setTreeStage("custom")
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium">
                        Summarize with custom prompt
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Add extra instructions before continuing.
                      </span>
                    </div>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>

            {!treeSummaryAvailable ? (
              <p className="text-xs text-muted-foreground">
                Summary actions are only available when a model is selected.
              </p>
            ) : null}

            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <div className="text-sm font-medium">Label</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={selectedTreeNodeLabel}
                  onChange={(event) =>
                    onSelectedTreeNodeLabelChange(event.target.value)
                  }
                  placeholder="Optional label"
                  disabled={!selectedTreeNodeId || treeSubmitting}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  disabled={!selectedTreeNodeId || treeSubmitting}
                  onClick={onSaveTreeLabel}
                >
                  Save label
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Custom prompt</div>
              <Textarea
                ref={treeCustomSummaryRef}
                value={customTreeSummaryInstructions}
                onChange={(event) =>
                  setCustomTreeSummaryInstructions(event.target.value)
                }
                placeholder="Add summary instructions before continuing"
                className="min-h-32"
                disabled={!canNavigateSelectedNode || treeSubmitting}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setTreeStage("actions")}
                disabled={treeSubmitting}
              >
                Back
              </Button>
              <Button
                disabled={!canNavigateSelectedNode || treeSubmitting}
                onClick={() => {
                  if (!selectedTreeNodeId) return
                  void onNavigateTreeNode(selectedTreeNodeId, {
                    summarize: true,
                    customInstructions: customTreeSummaryInstructions,
                  })
                }}
              >
                Summarize & continue
              </Button>
            </div>
          </div>
        )}
      </div>
    ) : (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Select a tree node first.
      </div>
    )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Session tree</DrawerTitle>
            <DrawerDescription>
              Browse branches, search the tree, and continue from an older
              point.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {treeDialogBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex min-h-0 flex-col overflow-hidden sm:max-h-[90vh] sm:max-w-5xl",
          treeStage === "browse" && "sm:h-[90vh]"
        )}
      >
        <DialogHeader>
          <DialogTitle>Session tree</DialogTitle>
          <DialogDescription>
            Browse branches, search the tree, and continue from an older point.
          </DialogDescription>
          <div className="hidden flex-wrap items-center gap-2 text-xs text-muted-foreground sm:flex">
            {TREE_FILTER_OPTIONS.map((option) => (
              <span
                key={option.mode}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 px-2 py-1"
              >
                <span>{option.label}</span>
                <TreeShortcutKeys keys={option.shortcut} />
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 px-2 py-1">
              <span>Cycle</span>
              <TreeShortcutKeys keys={[...TREE_FILTER_CYCLE_SHORTCUTS.next]} />
              <span className="text-muted-foreground/70">/</span>
              <TreeShortcutKeys
                keys={[...TREE_FILTER_CYCLE_SHORTCUTS.previous]}
              />
            </span>
          </div>
        </DialogHeader>
        {treeDialogBody}
      </DialogContent>
    </Dialog>
  )
}
export type AppShellTreeDialogHandle = {
  open: () => Promise<void> | void
  close: () => void
  isOpen: () => boolean
}

type AppShellTreeDialogControllerProps = {
  ref?: React.Ref<AppShellTreeDialogHandle>
  openStateRef?: React.MutableRefObject<boolean>
  viewerContextId: string
  sessionScopeKey: string
  sessionId?: string
  treeSummaryAvailable: boolean
}

export function AppShellTreeDialogController({
  ref,
  openStateRef,
  viewerContextId,
  sessionScopeKey,
  sessionId,
  treeSummaryAvailable,
}: AppShellTreeDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const [treeQuery, setTreeQuery] = React.useState("")
  const [selectedTreeNodeId, setSelectedTreeNodeId] = React.useState<
    string | null
  >(null)
  const [selectedTreeNodeLabel, setSelectedTreeNodeLabel] = React.useState("")
  const openRef = React.useRef(open)
  const queryClient = useQueryClient()
  const queryKey = piWebQueryKeys.sessionTree(viewerContextId, sessionScopeKey)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  const treeQueryResult = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<SessionTreeData>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId,
        })
      ),
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
    enabled: Boolean(viewerContextId && open && sessionScopeKey),
  })

  const saveTreeLabelMutation = useMutation({
    mutationFn: async ({
      entryId,
      label,
    }: {
      entryId: string
      label: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SessionTreeData>(
        buildRequestUrl("/api/session/tree/label", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId, label }),
        }
      )
    },
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response)
    },
  })

  const navigateTreeNodeMutation = useMutation({
    mutationFn: async ({
      targetId,
      summarize,
      customInstructions,
    }: {
      targetId: string
      summarize?: boolean
      customInstructions?: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<NavigateSessionTreeData>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetId,
            summarize: Boolean(summarize),
            customInstructions,
          }),
        }
      )
    },
  })

  const openDialog = async () => {
    if (!viewerContextId) return

    setTreeQuery("")
    setOpenState(true)
    await queryClient.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "active",
    })
  }

  const saveTreeLabel = async () => {
    if (!viewerContextId || !selectedTreeNodeId) return

    try {
      await saveTreeLabelMutation.mutateAsync({
        entryId: selectedTreeNodeId,
        label: selectedTreeNodeLabel,
      })
      toast.success("Saved tree label")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save label"
      )
    }
  }

  const navigateTreeNode = async (
    targetId: string,
    options?: TreeNavigateOptions
  ) => {
    if (!viewerContextId) return

    try {
      const response = await navigateTreeNodeMutation.mutateAsync({
        targetId,
        summarize: options?.summarize,
        customInstructions: options?.customInstructions,
      })
      if (response.aborted) {
        toast.info("Branch summarization cancelled")
        return
      }
      if (response.cancelled) {
        toast.info("Tree navigation cancelled")
        return
      }
      setOpenState(false)
      toast.success(
        options?.summarize
          ? "Continued from summarized branch"
          : "Moved session tree cursor"
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to navigate tree"
      )
    }
  }

  React.useEffect(() => {
    if (!open || !treeQueryResult.error) return

    toast.error(
      treeQueryResult.error instanceof Error
        ? treeQueryResult.error.message
        : "Failed to load tree"
    )
  }, [open, treeQueryResult.error, treeQueryResult.errorUpdatedAt])

  const treeData = treeQueryResult.data ?? null
  const flatTree = treeData ? flattenTree(treeData.tree) : []
  const treeLeafId = treeData?.leafId ?? null

  React.useEffect(() => {
    if (!open || !treeData) return

    const flat = flattenTree(treeData.tree)
    setSelectedTreeNodeId((current) => {
      if (current && flat.some((entry) => entry.id === current)) {
        return current
      }
      return treeData.leafId
    })
  }, [treeData, open])

  React.useEffect(() => {
    if (!treeData) return

    const flat = flattenTree(treeData.tree)
    const fallbackId = selectedTreeNodeId || treeData.leafId
    const selected = flat.find((entry) => entry.id === fallbackId)
    setSelectedTreeNodeLabel(selected?.label || "")
  }, [selectedTreeNodeId, treeData])

  React.useImperativeHandle(
    ref,
    () => ({
      open: openDialog,
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [queryKey, viewerContextId]
  )

  const treeLoading = Boolean(
    treeQueryResult.isPending && !treeQueryResult.data
  )
  const treeSubmitting =
    saveTreeLabelMutation.isPending || navigateTreeNodeMutation.isPending

  return (
    <AppShellTreeDialog
      open={open}
      onOpenChange={setOpenState}
      treeLoading={treeLoading}
      treeSubmitting={treeSubmitting}
      treeLeafId={treeLeafId}
      treeSummaryAvailable={treeSummaryAvailable}
      treeQuery={treeQuery}
      onTreeQueryChange={setTreeQuery}
      flatTree={flatTree}
      selectedTreeNodeId={selectedTreeNodeId}
      onSelectedTreeNodeIdChange={setSelectedTreeNodeId}
      selectedTreeNodeLabel={selectedTreeNodeLabel}
      onSelectedTreeNodeLabelChange={setSelectedTreeNodeLabel}
      onNavigateTreeNode={(targetId, options) => {
        void navigateTreeNode(targetId, options)
      }}
      onSaveTreeLabel={() => {
        void saveTreeLabel()
      }}
    />
  )
}
