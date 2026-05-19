"use client"

import * as React from "react"
import { PatchDiff } from "@pierre/diffs/react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
} from "lucide-react"

import type { ConversationItem, PromptImage } from "@/lib/pico"
import {
  CodeBlock,
  copyTextToClipboard,
  MarkdownBlock,
} from "@/features/pico/markdown-renderer"
import { ImageLightbox } from "@/features/pico/image-lightbox"
import { usePicoDiffThemeOptions } from "@/features/pico/pico-diff-theme"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  exploreShellCommandNameFromTool,
  rawShellCommandTextFromTool,
  toolArgsAreIncompleteJsonObject,
  toolCategoryFromTool,
} from "@/lib/pico/tool-classification"
import { cn } from "@/lib/utils"

export function promptImageKey(
  image: Pick<PromptImage, "previewUrl" | "data">
) {
  return `${image.previewUrl}:${image.data.slice(0, 24)}`
}

function toolArgsKey(args: unknown) {
  if (typeof args === "string") return args
  if (args == null) return ""

  try {
    return JSON.stringify(args)
  } catch {
    return ""
  }
}

function assistantBlockKey(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  switch (block.type) {
    case "text":
      return `text:${block.text}`
    case "thinking":
      return `thinking:${block.text}`
    case "tool":
      return `tool:${block.callId || block.name || "tool"}:${toolArgsKey(block.args)}`
    case "compaction":
      return `compaction:${block.tokensBefore}:${block.summary}`
    default:
      return "block"
  }
}

function userMessageLabel(item: Extract<ConversationItem, { kind: "user" }>) {
  if (item.streamingBehavior === "steer") return "Steer"
  if (item.queued || item.streamingBehavior === "followUp") return "Queue"
  return ""
}

function toolDisplayName(name?: string) {
  switch (name) {
    case "bash":
      return "Bash"
    case "read":
      return "Read"
    case "write":
      return "Write"
    case "edit":
      return "Edit"
    case "grep":
      return "Grep"
    case "glob":
      return "Glob"
    case "find":
      return "Find"
    case "rg":
      return "Ripgrep"
    case "ls":
    case "list":
      return "List"
    default:
      return name || "Tool"
  }
}

function normalizeToolArgs(args: unknown) {
  if (!args) return undefined
  if (typeof args === "object") {
    return args as Record<string, unknown>
  }
  if (typeof args !== "string") return undefined

  try {
    const parsed = JSON.parse(args)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function getToolArgText(
  args: Record<string, unknown> | undefined,
  key: string
) {
  const value = args?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function toolCommandPreview(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool") return ""

  if (typeof block.args === "string" && block.args.trim()) {
    return block.args.trim()
  }

  const args = normalizeToolArgs(block.args)
  return (
    getToolArgText(args, "description") ||
    getToolArgText(args, "command") ||
    getToolArgText(args, "path") ||
    getToolArgText(args, "filePath") ||
    getToolArgText(args, "file_path")
  )
}

function toolReadLocation(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool") return ""

  const args = normalizeToolArgs(block.args)
  const filePath =
    getToolArgText(args, "path") ||
    getToolArgText(args, "filePath") ||
    getToolArgText(args, "file_path")
  const offset = args?.offset
  const limit = args?.limit

  if (typeof offset === "number" && typeof limit === "number" && limit > 0) {
    return `${filePath}:${offset}-${offset + limit - 1}`
  }
  if (typeof offset === "number") {
    return `${filePath}:${offset}`
  }
  if (typeof limit === "number" && limit > 0) {
    return `${filePath} limit=${limit}`.trim()
  }
  return filePath
}

function collapseToolPreview(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function countTextDisplayLines(text: string) {
  if (!text) return 0
  return text.split("\n").length
}

function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`
) {
  return `${count} ${count === 1 ? singular : plural}`
}

function getWriteToolPayload(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool" || block.name !== "write") return undefined

  const args = normalizeToolArgs(block.args)
  if (!args) return undefined

  const path =
    getToolArgText(args, "path") ||
    getToolArgText(args, "filePath") ||
    getToolArgText(args, "file_path")
  const content = args.content

  return {
    content: typeof content === "string" ? content : undefined,
    path,
  }
}

function writeToolSummary(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  const payload = getWriteToolPayload(block)
  if (!payload?.path) return ""
  if (payload.content === undefined) return payload.path

  return `${payload.path} · ${formatCountLabel(
    countTextDisplayLines(payload.content),
    "line"
  )}`
}

function toolSummary(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool") return ""
  const preview =
    block.name === "read"
      ? toolReadLocation(block)
      : block.name === "write"
        ? writeToolSummary(block)
        : toolCommandPreview(block)
  if (preview) return collapseToolPreview(preview)
  if (block.running) return "Running"
  if (block.isError) return "Failed"
  return "Done"
}

function formatToolArgString(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object") {
      return JSON.stringify(parsed, null, 2)
    }
  } catch {
    // fall through to the raw string below
  }

  return trimmed
}

function rawShellCommandText(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  return block.type === "tool"
    ? rawShellCommandTextFromTool(block.name, block.args)
    : ""
}

function toolCallText(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool") return ""

  if (block.name === "bash") {
    const command = rawShellCommandText(block)
    return command ? `$ ${command}` : ""
  }

  if (typeof block.args === "string") {
    return formatToolArgString(block.args)
  }

  if (block.args == null) return ""

  try {
    return JSON.stringify(block.args, null, 2) || ""
  } catch {
    return ""
  }
}

function toolPatchText(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool" || block.name !== "edit") return ""
  if (!block.details || typeof block.details !== "object") return ""

  const details = block.details as Partial<Record<"patch", unknown>>
  return typeof details.patch === "string" ? details.patch.trimEnd() : ""
}

function toolOutputText(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "tool") return ""

  const parts: Array<string> = []
  const diff = toolPatchText(block)
  const output = block.output.trimEnd()

  if (diff) {
    parts.push(diff)
  }

  if (output && (!diff || output !== diff)) {
    parts.push(output)
  }

  if (parts.length > 0) {
    return parts.join("\n\n")
  }

  if (block.running) return "Running…"
  if (block.isError) return "Tool failed with no output."
  return "No output available."
}

type AssistantConversationBlock = Extract<
  ConversationItem,
  { kind: "assistant" }
>["blocks"][number]

type AssistantToolBlock = AssistantConversationBlock & { type: "tool" }

type AssistantBlockGroup =
  | {
      type: "block"
      key: string
      block: AssistantConversationBlock
    }
  | {
      type: "explore"
      key: string
      blocks: Array<AssistantToolBlock>
    }

type AssistantBlockGroupDescriptor =
  | {
      type: "block"
      key: string
      blockKey: string
      blockType: AssistantConversationBlock["type"]
    }
  | {
      type: "explore"
      key: string
      blockKeys: Array<string>
    }

type AssistantBlockStoreSnapshot = {
  blockByKey: Map<string, AssistantConversationBlock>
  groups: Array<AssistantBlockGroupDescriptor>
  revision: number
}

export type AssistantMessagesSnapshot = {
  items: Array<Extract<ConversationItem, { kind: "assistant" }>>
  hideThinking: boolean
  hideToolBlocks: boolean
}

export type AssistantMessagesStore = {
  getSnapshot: () => AssistantMessagesSnapshot
  subscribe: (listener: () => void) => () => void
}

type AssistantMessagesShellSnapshot = {
  anchorBlockKey?: string
  hasBlocks: boolean
  hasFooter: boolean
  streaming: boolean
  working: boolean
  copyText: string
  modelLabel: string
}

type AssistantMessagesShellStore = {
  getSnapshot: () => AssistantMessagesShellSnapshot
  setSnapshot: (snapshot: AssistantMessagesShellSnapshot) => void
  subscribe: (listener: () => void) => () => void
}

type AssistantBlockStore = {
  getBlock: (key: string) => AssistantConversationBlock | undefined
  getBlocks: (keys: Array<string>) => Array<AssistantConversationBlock>
  getGroups: () => Array<AssistantBlockGroupDescriptor>
  setBlocks: (blocks: Array<AssistantConversationBlock>) => void
  subscribe: (listener: () => void) => () => void
  subscribeBlocks: (keys: Array<string>, listener: () => void) => () => void
}

function exploreShellCommandName(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  return block.type === "tool"
    ? exploreShellCommandNameFromTool(block.name, block.args)
    : ""
}

function matchesExploreToolBlock(block: AssistantConversationBlock) {
  if (block.type !== "tool") return false
  return (
    block.category === "explore" ||
    toolCategoryFromTool(block.name, block.args) === "explore"
  )
}

function isExploreToolBlock(
  block: AssistantConversationBlock
): block is AssistantToolBlock {
  return matchesExploreToolBlock(block)
}

function isPendingUnclassifiedToolBlock(block: AssistantConversationBlock) {
  if (
    block.type !== "tool" ||
    !block.running ||
    matchesExploreToolBlock(block)
  ) {
    return false
  }

  if (!block.name) {
    return true
  }

  if (block.name === "bash") {
    const category = toolCategoryFromTool(block.name, block.args)
    return (
      !rawShellCommandText(block) ||
      (category !== "explore" && toolArgsAreIncompleteJsonObject(block.args))
    )
  }

  return false
}

function getToolArgNumber(
  args: Record<string, unknown> | undefined,
  key: string
) {
  const value = args?.[key]
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN

  return Number.isFinite(numberValue) ? numberValue : undefined
}

function pathBaseName(path: string) {
  const normalized = path.replace(/\\/g, "/").trim()
  if (!normalized) return ""

  const parts = normalized.split("/")
  return parts[parts.length - 1] || normalized
}

function formatExploreArg(
  key: string,
  value: string | number | undefined
): string {
  if (value == null) return ""

  const text =
    typeof value === "number" ? String(value) : collapseToolPreview(value)

  return text ? `${key}=${text}` : ""
}

function formatExploreCount(
  count: number,
  singular: string,
  plural = `${singular}s`
) {
  return `${count} ${count === 1 ? singular : plural}`
}

function exploreGroupSummary(
  blocks: Array<
    Extract<ConversationItem, { kind: "assistant" }>["blocks"][number] & {
      type: "tool"
    }
  >
) {
  let readCount = 0
  let searchCount = 0
  let listCount = 0

  for (const block of blocks) {
    if (block.name === "read") {
      readCount += 1
      continue
    }
    const shellCommandName = exploreShellCommandName(block)
    if (
      block.name === "ls" ||
      block.name === "list" ||
      shellCommandName === "ls"
    ) {
      listCount += 1
      continue
    }
    searchCount += 1
  }

  return [
    readCount > 0 ? formatExploreCount(readCount, "read") : "",
    searchCount > 0
      ? formatExploreCount(searchCount, "search", "searches")
      : "",
    listCount > 0 ? formatExploreCount(listCount, "list") : "",
  ]
    .filter(Boolean)
    .join(", ")
}

function exploreGroupStatusLabel() {
  return "Explore"
}

function exploreToolLine(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number] & {
    type: "tool"
  }
) {
  const args = normalizeToolArgs(block.args)
  const path =
    getToolArgText(args, "path") || getToolArgText(args, "filePath") || "/"
  const status = block.running ? "Running" : block.isError ? "Failed" : ""

  switch (block.name) {
    case "read":
      return {
        label: "Read",
        details: [
          pathBaseName(path) || path,
          formatExploreArg("offset", getToolArgNumber(args, "offset")),
          formatExploreArg("limit", getToolArgNumber(args, "limit")),
          status,
        ]
          .filter(Boolean)
          .join("  "),
      }
    case "grep":
    case "rg":
      return {
        label: block.name === "rg" ? "Ripgrep" : "Grep",
        details: [
          path,
          formatExploreArg(
            "pattern",
            getToolArgText(args, "pattern") || getToolArgText(args, "query")
          ),
          formatExploreArg("include", getToolArgText(args, "include")),
          status,
        ]
          .filter(Boolean)
          .join("  "),
      }
    case "glob":
      return {
        label: "Glob",
        details: [
          path,
          formatExploreArg("pattern", getToolArgText(args, "pattern")),
          status,
        ]
          .filter(Boolean)
          .join("  "),
      }
    case "find":
      return {
        label: "Find",
        details: [
          path,
          formatExploreArg(
            "pattern",
            getToolArgText(args, "pattern") ||
              getToolArgText(args, "query") ||
              getToolArgText(args, "name")
          ),
          formatExploreArg("limit", getToolArgNumber(args, "limit")),
          status,
        ]
          .filter(Boolean)
          .join("  "),
      }
    case "ls":
    case "list":
      return {
        label: "List",
        details: [
          path,
          formatExploreArg("limit", getToolArgNumber(args, "limit")),
          status,
        ]
          .filter(Boolean)
          .join("  "),
      }
    case "bash": {
      const shellCommandName = exploreShellCommandName(block)
      const label =
        shellCommandName === "rg"
          ? "Ripgrep"
          : shellCommandName === "ls"
            ? "List"
            : shellCommandName
              ? `${shellCommandName[0]?.toUpperCase()}${shellCommandName.slice(1)}`
              : "Bash"

      return {
        label,
        details: [collapseToolPreview(rawShellCommandText(block)), status]
          .filter(Boolean)
          .join("  "),
      }
    }
    default:
      return {
        label: toolDisplayName(block.name),
        details: toolSummary(block),
      }
  }
}

function assistantBlockRenderKey(
  block: AssistantConversationBlock,
  index: number
) {
  const baseKey = block.renderKey || block.blockKey || assistantBlockKey(block)
  return `${baseKey}:${index}`
}

function sameUnknownValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right) return false
  if (!left || !right || typeof left !== "object") return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false

    for (let index = 0; index < left.length; index += 1) {
      if (!sameUnknownValue(left[index], right[index])) return false
    }

    return true
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key)) return false
    if (!sameUnknownValue(leftRecord[key], rightRecord[key])) return false
  }

  return true
}

function sameAssistantBlock(
  left: AssistantConversationBlock,
  right: AssistantConversationBlock
) {
  if (left === right) return true
  if (left.type !== right.type) return false
  if (left.blockKey !== right.blockKey) return false
  if (left.renderKey !== right.renderKey) return false

  switch (left.type) {
    case "text":
      if (right.type !== "text") return false
      return (
        left.text === right.text &&
        Boolean(left.isError) === Boolean(right.isError)
      )
    case "thinking":
      if (right.type !== "thinking") return false
      return (
        left.text === right.text && left.summaryLabel === right.summaryLabel
      )
    case "tool":
      if (right.type !== "tool") return false
      return (
        left.callId === right.callId &&
        left.name === right.name &&
        left.category === right.category &&
        left.output === right.output &&
        left.isError === right.isError &&
        left.running === right.running &&
        sameUnknownValue(left.args, right.args) &&
        sameUnknownValue(left.details, right.details)
      )
    case "compaction":
      if (right.type !== "compaction") return false
      return (
        left.summary === right.summary &&
        left.tokensBefore === right.tokensBefore
      )
    default:
      return false
  }
}

function groupAssistantBlocks(blocks: Array<AssistantConversationBlock>) {
  const result: Array<AssistantBlockGroup> = []
  let start = -1

  const flushExploreGroup = (end: number) => {
    if (start < 0 || end < start) return

    const groupedBlocks = blocks
      .slice(start, end + 1)
      .filter(isExploreToolBlock)
    const first = groupedBlocks[0]

    if (!first) {
      start = -1
      return
    }

    result.push({
      type: "explore",
      key: `explore:${assistantBlockRenderKey(first, start)}`,
      blocks: groupedBlocks,
    })

    start = -1
  }

  blocks.forEach((block, index) => {
    if (isExploreToolBlock(block)) {
      if (start < 0) {
        start = index
      }
      return
    }

    flushExploreGroup(index - 1)
    result.push({
      type: "block",
      key: assistantBlockRenderKey(block, index),
      block,
    })
  })

  flushExploreGroup(blocks.length - 1)
  return result
}

function sameAssistantBlockGroupDescriptor(
  left: AssistantBlockGroupDescriptor,
  right: AssistantBlockGroupDescriptor
) {
  if (left.type !== right.type || left.key !== right.key) return false

  if (left.type === "block" && right.type === "block") {
    return (
      left.blockKey === right.blockKey && left.blockType === right.blockType
    )
  }

  if (left.type !== "explore" || right.type !== "explore") return false
  if (left.blockKeys.length !== right.blockKeys.length) return false

  for (let index = 0; index < left.blockKeys.length; index += 1) {
    if (left.blockKeys[index] !== right.blockKeys[index]) return false
  }

  return true
}

function reconcileAssistantBlockGroupDescriptors(
  previousGroups: Array<AssistantBlockGroupDescriptor>,
  nextGroups: Array<AssistantBlockGroupDescriptor>
) {
  if (previousGroups.length === 0) return nextGroups

  let changed = previousGroups.length !== nextGroups.length
  const groups: Array<AssistantBlockGroupDescriptor> = []

  for (let index = 0; index < nextGroups.length; index += 1) {
    const previousGroup = previousGroups[index]
    const nextGroup = nextGroups[index]

    if (
      previousGroup &&
      nextGroup &&
      sameAssistantBlockGroupDescriptor(previousGroup, nextGroup)
    ) {
      groups.push(previousGroup)
      continue
    }

    changed = true
    groups.push(nextGroup)
  }

  return changed ? groups : previousGroups
}

function buildAssistantBlockSnapshot(
  blocks: Array<AssistantConversationBlock>,
  previousSnapshot?: AssistantBlockStoreSnapshot
): AssistantBlockStoreSnapshot {
  const blockByKey = new Map<string, AssistantConversationBlock>()
  const fullGroups = groupAssistantBlocks(blocks)

  blocks.forEach((block, index) => {
    const key = assistantBlockRenderKey(block, index)
    const previousBlock = previousSnapshot?.blockByKey.get(key)
    blockByKey.set(
      key,
      previousBlock && sameAssistantBlock(previousBlock, block)
        ? previousBlock
        : block
    )
  })

  const groups = fullGroups.map((group): AssistantBlockGroupDescriptor => {
    if (group.type === "block") {
      return {
        type: "block",
        key: group.key,
        blockKey: group.key,
        blockType: group.block.type,
      }
    }

    return {
      type: "explore",
      key: group.key,
      blockKeys: group.blocks.map((block) =>
        assistantBlockRenderKey(block, blocks.indexOf(block))
      ),
    }
  })

  return {
    blockByKey,
    groups: previousSnapshot
      ? reconcileAssistantBlockGroupDescriptors(previousSnapshot.groups, groups)
      : groups,
    revision: (previousSnapshot?.revision ?? 0) + 1,
  }
}

function sameAssistantMessagesShellSnapshot(
  left: AssistantMessagesShellSnapshot,
  right: AssistantMessagesShellSnapshot
) {
  return (
    left.anchorBlockKey === right.anchorBlockKey &&
    left.hasBlocks === right.hasBlocks &&
    left.hasFooter === right.hasFooter &&
    left.streaming === right.streaming &&
    left.working === right.working &&
    left.copyText === right.copyText &&
    left.modelLabel === right.modelLabel
  )
}

function createAssistantMessagesShellStore(
  initialSnapshot: AssistantMessagesShellSnapshot
): AssistantMessagesShellStore {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      if (sameAssistantMessagesShellSnapshot(snapshot, nextSnapshot)) return

      snapshot = nextSnapshot
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function visibleAssistantBlocksFromSnapshot(
  snapshot: AssistantMessagesSnapshot
) {
  return snapshot.items.flatMap((item) =>
    item.blocks.filter((block) =>
      assistantBlockIsVisible({
        block,
        hideThinking: snapshot.hideThinking,
        hideToolBlocks: snapshot.hideToolBlocks,
      })
    )
  )
}

function assistantBlockIsMessageJumpAnchor(block: AssistantConversationBlock) {
  return block.type === "text" || block.type === "compaction"
}

function assistantCopyTextFromItems(
  items: Array<Extract<ConversationItem, { kind: "assistant" }>>
) {
  return items
    .flatMap((item) =>
      item.blocks.flatMap((block) => {
        const text =
          block.type === "text"
            ? block.text
            : block.type === "compaction"
              ? block.summary
              : ""
        return text.trim() ? [text] : []
      })
    )
    .join("\n\n")
    .trim()
}

function formatAssistantModelId(id: string) {
  return id.replace(/^gpt/i, "GPT")
}

function assistantModelLabel(
  item: Extract<ConversationItem, { kind: "assistant" }> | undefined
) {
  const model = item?.model
  if (!model) return ""

  return (model.name || formatAssistantModelId(model.id)).trim()
}

function assistantMessagesModelLabel(
  items: Array<Extract<ConversationItem, { kind: "assistant" }>>
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const label = assistantModelLabel(items[index])
    if (label) return label
  }

  return ""
}

function assistantItemIsWorking(
  item: Extract<ConversationItem, { kind: "assistant" }>
) {
  return (
    Boolean(item.streaming) ||
    item.done === false ||
    item.blocks.some((block) => block.type === "tool" && block.running)
  )
}

function assistantItemIsStreaming(
  item: Extract<ConversationItem, { kind: "assistant" }>
) {
  return Boolean(item.streaming)
}

function assistantMessagesShellSnapshotFromBlocks(
  snapshot: AssistantMessagesSnapshot,
  blocks: Array<AssistantConversationBlock>
): AssistantMessagesShellSnapshot {
  const anchorBlockIndex = blocks.findIndex(assistantBlockIsMessageJumpAnchor)
  const anchorBlock =
    anchorBlockIndex >= 0 ? blocks[anchorBlockIndex] : undefined

  const copyText = assistantCopyTextFromItems(snapshot.items)
  const modelLabel = assistantMessagesModelLabel(snapshot.items)
  const streaming = snapshot.items.some(assistantItemIsStreaming)
  const working = snapshot.items.some(assistantItemIsWorking)
  const hasFooter = Boolean(copyText.trim() || modelLabel)

  return {
    ...(anchorBlock
      ? {
          anchorBlockKey: assistantBlockRenderKey(
            anchorBlock,
            anchorBlockIndex
          ),
        }
      : {}),
    hasBlocks: blocks.length > 0,
    hasFooter,
    streaming,
    working,
    copyText,
    modelLabel,
  }
}

function createAssistantBlockStore(
  blocks: Array<AssistantConversationBlock>
): AssistantBlockStore {
  let snapshot = buildAssistantBlockSnapshot(blocks)
  const listeners = new Set<() => void>()
  const blockListeners = new Map<string, Set<() => void>>()

  const notifyBlock = (key: string) => {
    const listenersForBlock = blockListeners.get(key)
    if (!listenersForBlock) return
    for (const listener of listenersForBlock) listener()
  }

  return {
    getBlock: (key) => snapshot.blockByKey.get(key),
    getBlocks: (keys) =>
      keys.flatMap((key) => {
        const block = snapshot.blockByKey.get(key)
        return block ? [block] : []
      }),
    getGroups: () => snapshot.groups,
    setBlocks: (blocks) => {
      const previousSnapshot = snapshot
      const nextSnapshot = buildAssistantBlockSnapshot(blocks, previousSnapshot)
      let blockChanged =
        previousSnapshot.blockByKey.size !== nextSnapshot.blockByKey.size
      const changedKeys = new Set<string>()

      for (const key of previousSnapshot.blockByKey.keys()) {
        if (
          previousSnapshot.blockByKey.get(key) !==
          nextSnapshot.blockByKey.get(key)
        ) {
          changedKeys.add(key)
          blockChanged = true
        }
      }
      for (const key of nextSnapshot.blockByKey.keys()) {
        if (
          previousSnapshot.blockByKey.get(key) !==
          nextSnapshot.blockByKey.get(key)
        ) {
          changedKeys.add(key)
          blockChanged = true
        }
      }

      if (!blockChanged && previousSnapshot.groups === nextSnapshot.groups) {
        return
      }

      snapshot = nextSnapshot
      if (previousSnapshot.groups !== nextSnapshot.groups) {
        for (const listener of listeners) listener()
      }
      for (const key of changedKeys) notifyBlock(key)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeBlocks: (keys, listener) => {
      const uniqueKeys = [...new Set(keys)]
      for (const key of uniqueKeys) {
        const listenersForBlock =
          blockListeners.get(key) ?? new Set<() => void>()
        listenersForBlock.add(listener)
        blockListeners.set(key, listenersForBlock)
      }

      return () => {
        for (const key of uniqueKeys) {
          const listenersForBlock = blockListeners.get(key)
          if (!listenersForBlock) continue
          listenersForBlock.delete(listener)
          if (listenersForBlock.size === 0) {
            blockListeners.delete(key)
          }
        }
      }
    },
  }
}

function useAssistantBlockGroups(store: AssistantBlockStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    store.getGroups,
    store.getGroups
  )
}

function useAssistantBlock(store: AssistantBlockStore, key: string) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeBlocks([key], listener),
      [key, store]
    ),
    () => store.getBlock(key),
    () => store.getBlock(key)
  )
}

const EMPTY_TOOL_BLOCKS: Array<AssistantToolBlock> = []

type ToolBlockHeaderSnapshot = {
  name: string | undefined
  running: boolean
  isError: boolean
  summary: string
  editStats: EditDiffStatCounts | null
  openStateKey: string
}

type ExploreToolGroupHeaderSnapshot = {
  count: number
  summary: string
  hasRunning: boolean
  hasError: boolean
  openStateKey: string
}

function sameEditDiffStatCounts(
  left: EditDiffStatCounts | null,
  right: EditDiffStatCounts | null
) {
  if (left === right) return true
  if (!left || !right) return false
  return left.additions === right.additions && left.removals === right.removals
}

function rememberedToolCollapsibleStateKey(
  block: AssistantConversationBlock | undefined,
  prefix = "tool"
) {
  if (!block) return `${prefix}:missing`

  if (block.type === "tool" && block.callId) {
    return `${prefix}:call:${block.callId}`
  }

  return `${prefix}:block:${
    block.renderKey || block.blockKey || assistantBlockKey(block)
  }`
}

function buildToolBlockHeaderSnapshot(
  block: AssistantConversationBlock | undefined
): ToolBlockHeaderSnapshot | null {
  if (!block || block.type !== "tool") return null

  return {
    name: block.name,
    running: block.running,
    isError: block.isError,
    summary: toolSummary(block),
    editStats:
      block.name === "edit" && !block.running
        ? getEditDiffStats(toolPatchText(block))
        : null,
    openStateKey: rememberedToolCollapsibleStateKey(block),
  }
}

function sameToolBlockHeaderSnapshot(
  left: ToolBlockHeaderSnapshot | null,
  right: ToolBlockHeaderSnapshot | null
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.name === right.name &&
    left.running === right.running &&
    left.isError === right.isError &&
    left.summary === right.summary &&
    sameEditDiffStatCounts(left.editStats, right.editStats) &&
    left.openStateKey === right.openStateKey
  )
}

function useAssistantToolBlockHeader(store: AssistantBlockStore, key: string) {
  const cacheRef = React.useRef<ToolBlockHeaderSnapshot | null>(null)

  const getSnapshot = () => {
    const next = buildToolBlockHeaderSnapshot(store.getBlock(key))
    const cache = cacheRef.current
    if (sameToolBlockHeaderSnapshot(cache, next)) return cache

    cacheRef.current = next
    return next
  }

  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeBlocks([key], listener),
      [key, store]
    ),
    getSnapshot,
    getSnapshot
  )
}

function useAssistantToolBlockBody(
  store: AssistantBlockStore,
  key: string,
  enabled: boolean
) {
  const getSnapshot = () => {
    if (!enabled) return undefined

    const block = store.getBlock(key)
    return block?.type === "tool" ? block : undefined
  }

  return React.useSyncExternalStore(
    React.useCallback(
      (listener) =>
        enabled ? store.subscribeBlocks([key], listener) : () => {},
      [enabled, key, store]
    ),
    getSnapshot,
    getSnapshot
  )
}

function assistantToolBlocksFromStore(
  store: AssistantBlockStore,
  keys: Array<string>
) {
  return store.getBlocks(keys).filter(isExploreToolBlock)
}

function buildExploreToolGroupHeaderSnapshot(
  blocks: Array<AssistantToolBlock>
): ExploreToolGroupHeaderSnapshot {
  return {
    count: blocks.length,
    summary: blocks.length > 0 ? exploreGroupSummary(blocks) : "",
    hasRunning: blocks.some((block) => block.running),
    hasError: blocks.some((block) => block.isError),
    openStateKey: rememberedToolCollapsibleStateKey(blocks[0], "explore"),
  }
}

function sameExploreToolGroupHeaderSnapshot(
  left: ExploreToolGroupHeaderSnapshot,
  right: ExploreToolGroupHeaderSnapshot
) {
  return (
    left.count === right.count &&
    left.summary === right.summary &&
    left.hasRunning === right.hasRunning &&
    left.hasError === right.hasError &&
    left.openStateKey === right.openStateKey
  )
}

function useAssistantToolGroupHeader(
  store: AssistantBlockStore,
  keys: Array<string>
) {
  const cacheRef = React.useRef<ExploreToolGroupHeaderSnapshot>({
    count: 0,
    summary: "",
    hasRunning: false,
    hasError: false,
    openStateKey: "explore:missing",
  })

  const getSnapshot = () => {
    const next = buildExploreToolGroupHeaderSnapshot(
      assistantToolBlocksFromStore(store, keys)
    )
    const cache = cacheRef.current
    if (sameExploreToolGroupHeaderSnapshot(cache, next)) return cache

    cacheRef.current = next
    return next
  }

  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeBlocks(keys, listener),
      [keys, store]
    ),
    getSnapshot,
    getSnapshot
  )
}

function sameReferenceSequence<T>(left: Array<T>, right: Array<T>) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  )
}

function useAssistantToolGroupBodyBlocks(
  store: AssistantBlockStore,
  keys: Array<string>,
  enabled: boolean
) {
  const cacheRef = React.useRef<{
    keys: Array<string>
    blocks: Array<AssistantToolBlock>
  }>({ keys: [], blocks: EMPTY_TOOL_BLOCKS })

  const getSnapshot = () => {
    if (!enabled) return EMPTY_TOOL_BLOCKS

    const blocks = assistantToolBlocksFromStore(store, keys)
    const cache = cacheRef.current
    if (
      sameReferenceSequence(cache.keys, keys) &&
      sameReferenceSequence(cache.blocks, blocks)
    ) {
      return cache.blocks
    }

    cacheRef.current = { keys, blocks }
    return blocks
  }

  return React.useSyncExternalStore(
    React.useCallback(
      (listener) =>
        enabled ? store.subscribeBlocks(keys, listener) : () => {},
      [enabled, keys, store]
    ),
    getSnapshot,
    getSnapshot
  )
}

function compactionTriggerText(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  if (block.type !== "compaction") return "Compaction"
  return block.tokensBefore > 0
    ? `Compaction: Compacted from ${block.tokensBefore.toLocaleString()} tokens`
    : "Compaction"
}

type AnsiStyleState = {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  foreground?: string
  background?: string
}

type AnsiTextSegment = {
  text: string
  style?: AnsiStyleState
}

type ParsedAnsiSequence = {
  kind: "sgr" | "control"
  end: number
  params?: string
}

const ANSI_16_COLORS = [
  "#3f3f46",
  "#ef4444",
  "#22c55e",
  "#eab308",
  "#3b82f6",
  "#d946ef",
  "#06b6d4",
  "#e4e4e7",
  "#71717a",
  "#f87171",
  "#4ade80",
  "#facc15",
  "#60a5fa",
  "#e879f9",
  "#22d3ee",
  "#fafafa",
] as const

function defaultAnsiStyle(): AnsiStyleState {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  }
}

function cloneAnsiStyle(style: AnsiStyleState): AnsiStyleState | undefined {
  if (
    !style.bold &&
    !style.dim &&
    !style.italic &&
    !style.underline &&
    !style.foreground &&
    !style.background
  ) {
    return undefined
  }

  return { ...style }
}

function ansiStyleKey(style?: AnsiStyleState) {
  if (!style) return ""
  return [
    style.bold ? "1" : "0",
    style.dim ? "1" : "0",
    style.italic ? "1" : "0",
    style.underline ? "1" : "0",
    style.foreground || "",
    style.background || "",
  ].join(";")
}

function pushAnsiTextSegment(
  segments: Array<AnsiTextSegment>,
  text: string,
  style: AnsiStyleState
) {
  if (!text) return

  const nextStyle = cloneAnsiStyle(style)
  const previous = segments[segments.length - 1]

  if (previous && ansiStyleKey(previous.style) === ansiStyleKey(nextStyle)) {
    previous.text += text
    return
  }

  segments.push({ text, style: nextStyle })
}

function parseAnsiSequence(
  text: string,
  index: number
): ParsedAnsiSequence | null {
  const charCode = text.charCodeAt(index)
  const isEsc = charCode === 0x1b
  const isCsi = charCode === 0x9b

  if (!isEsc && !isCsi) return null

  if (isCsi) {
    return parseAnsiCsiSequence(text, index, index + 1)
  }

  const introducer = text[index + 1]

  if (introducer === "[") {
    return parseAnsiCsiSequence(text, index, index + 2)
  }

  if (introducer === "]") {
    const bellEnd = text.indexOf("\u0007", index + 2)
    const stEnd = text.indexOf("\u001b\\", index + 2)
    const candidates = [bellEnd, stEnd].filter((value) => value >= 0)
    const end = candidates.length > 0 ? Math.min(...candidates) : -1

    if (end < 0) {
      return { kind: "control", end: index + 2 }
    }

    return {
      kind: "control",
      end: end === stEnd ? end + 2 : end + 1,
    }
  }

  return { kind: "control", end: Math.min(text.length, index + 2) }
}

function parseAnsiCsiSequence(
  text: string,
  start: number,
  paramsStart: number
): ParsedAnsiSequence | null {
  for (let index = paramsStart; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code >= 0x40 && code <= 0x7e) {
      const final = text[index]
      return {
        kind: final === "m" ? "sgr" : "control",
        end: index + 1,
        params: text.slice(paramsStart, index),
      }
    }
  }

  return { kind: "control", end: start + 1 }
}

function parseAnsiSgrParams(params = "") {
  if (!params) return [0]

  return params
    .replace(/:/g, ";")
    .split(";")
    .map((param) => {
      if (!param || param.startsWith("?")) return 0
      const value = Number(param)
      return Number.isFinite(value) ? value : 0
    })
}

function ansi256ToCss(value: number | undefined) {
  if (typeof value !== "number") return undefined
  if (value >= 0 && value < 16) return ANSI_16_COLORS[value]

  if (value >= 16 && value <= 231) {
    const offset = value - 16
    const red = Math.floor(offset / 36)
    const green = Math.floor((offset % 36) / 6)
    const blue = offset % 6
    const toChannel = (channel: number) =>
      channel === 0 ? 0 : 55 + channel * 40

    return `rgb(${toChannel(red)} ${toChannel(green)} ${toChannel(blue)})`
  }

  if (value >= 232 && value <= 255) {
    const channel = 8 + (value - 232) * 10
    return `rgb(${channel} ${channel} ${channel})`
  }
}

function readAnsiExtendedColor(codes: Array<number>, index: number) {
  const mode = codes[index + 1]

  if (mode === 5) {
    return {
      color: ansi256ToCss(codes[index + 2]),
      nextIndex: index + 2,
    }
  }

  if (mode === 2) {
    const red = codes[index + 2]
    const green = codes[index + 3]
    const blue = codes[index + 4]

    if ([red, green, blue].every((value) => value >= 0 && value <= 255)) {
      return {
        color: `rgb(${red} ${green} ${blue})`,
        nextIndex: index + 4,
      }
    }
  }

  return { color: undefined, nextIndex: index }
}

function applyAnsiSgrCodes(style: AnsiStyleState, codes: Array<number>) {
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]

    if (code === 0) {
      Object.assign(style, defaultAnsiStyle())
      continue
    }

    if (code === 1) {
      style.bold = true
      continue
    }

    if (code === 2) {
      style.dim = true
      continue
    }

    if (code === 3) {
      style.italic = true
      continue
    }

    if (code === 4) {
      style.underline = true
      continue
    }

    if (code === 22) {
      style.bold = false
      style.dim = false
      continue
    }

    if (code === 23) {
      style.italic = false
      continue
    }

    if (code === 24) {
      style.underline = false
      continue
    }

    if (code === 39) {
      style.foreground = undefined
      continue
    }

    if (code === 49) {
      style.background = undefined
      continue
    }

    if (code >= 30 && code <= 37) {
      style.foreground = ANSI_16_COLORS[code - 30]
      continue
    }

    if (code >= 40 && code <= 47) {
      style.background = ANSI_16_COLORS[code - 40]
      continue
    }

    if (code >= 90 && code <= 97) {
      style.foreground = ANSI_16_COLORS[8 + code - 90]
      continue
    }

    if (code >= 100 && code <= 107) {
      style.background = ANSI_16_COLORS[8 + code - 100]
      continue
    }

    if (code === 38 || code === 48) {
      const extended = readAnsiExtendedColor(codes, index)

      if (extended.color) {
        if (code === 38) {
          style.foreground = extended.color
        } else {
          style.background = extended.color
        }
      }

      index = extended.nextIndex
    }
  }
}

function findNextAnsiSequenceIndex(text: string, start: number) {
  for (let index = start; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code === 0x1b || code === 0x9b) {
      return index
    }
  }

  return -1
}

function parseAnsiText(text: string): Array<AnsiTextSegment> {
  const segments: Array<AnsiTextSegment> = []
  const style = defaultAnsiStyle()
  let index = 0

  while (index < text.length) {
    const escIndex = findNextAnsiSequenceIndex(text, index)

    if (escIndex < 0) {
      pushAnsiTextSegment(segments, text.slice(index), style)
      break
    }

    pushAnsiTextSegment(segments, text.slice(index, escIndex), style)

    const sequence = parseAnsiSequence(text, escIndex)

    if (!sequence) {
      index = escIndex + 1
      continue
    }

    if (sequence.kind === "sgr") {
      applyAnsiSgrCodes(style, parseAnsiSgrParams(sequence.params))
    }

    index = sequence.end
  }

  return segments
}

function ansiSegmentStyle(
  style?: AnsiStyleState
): React.CSSProperties | undefined {
  if (!style) return undefined

  return {
    color: style.foreground,
    backgroundColor: style.background,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    opacity: style.dim ? 0.72 : undefined,
    textDecorationLine: style.underline ? "underline" : undefined,
  }
}

function AnsiText({ text }: { text: string }) {
  const segments = parseAnsiText(text)

  return (
    <>
      {segments.map((segment) => (
        <span
          key={`${segment.text}-${JSON.stringify(segment.style ?? {})}`}
          style={ansiSegmentStyle(segment.style)}
        >
          {segment.text}
        </span>
      ))}
    </>
  )
}

function getEditDiffStats(patch: string) {
  const stats = { additions: 0, removals: 0 }

  if (!patch) return stats

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) stats.additions += 1
    if (line.startsWith("-")) stats.removals += 1
  }

  return stats
}

type EditDiffStatCounts = {
  additions: number
  removals: number
}

function EditDiffStatCountsView({ stats }: { stats: EditDiffStatCounts }) {
  if (!stats.additions && !stats.removals) return null

  return (
    <span
      className="flex shrink-0 items-center gap-2 font-mono text-sm"
      aria-label={`${stats.additions} lines added, ${stats.removals} lines removed`}
    >
      <span className="text-success">+{stats.additions}</span>
      <span className="text-destructive">−{stats.removals}</span>
    </span>
  )
}

function EditDiffBlock({
  isBorderless = false,
  patch,
}: {
  isBorderless?: boolean
  patch: string
}) {
  const themeOptions = usePicoDiffThemeOptions()

  return (
    <div
      className={cn(
        "overflow-hidden text-xs",
        !isBorderless && "rounded-md border bg-background"
      )}
      style={
        {
          "--diffs-font-family":
            'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
        } as React.CSSProperties
      }
    >
      <PatchDiff
        patch={patch}
        disableWorkerPool
        options={{
          ...themeOptions,
          diffStyle: "unified",
          disableFileHeader: true,
          lineDiffType: "word-alt",
          maxLineDiffLength: 1000,
          overflow: "wrap",
        }}
      />
    </div>
  )
}

function PlainToolOutput({
  isError = false,
  text,
}: {
  isError?: boolean
  text: string
}) {
  return (
    <pre
      className={cn(
        "overflow-x-auto font-mono text-xs leading-5 break-words whitespace-pre-wrap",
        isError && "text-destructive"
      )}
    >
      {text}
    </pre>
  )
}

function scrollDistanceFromBottom(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight - element.scrollTop
}

function scrollElementToBottom(element: HTMLElement) {
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
}

function useRunningToolAutoScroll<
  TElement extends HTMLElement = HTMLDivElement,
>({ contentKey, enabled }: { contentKey: string; enabled: boolean }) {
  const scrollRef = React.useRef<TElement>(null)
  const autoScrollRef = React.useRef(true)
  const wasEnabledRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const element = scrollRef.current

    if (!enabled) {
      wasEnabledRef.current = false
      return
    }

    if (!wasEnabledRef.current) {
      autoScrollRef.current = true
      wasEnabledRef.current = true
    }

    if (element && autoScrollRef.current) {
      scrollElementToBottom(element)
    }
  }, [contentKey, enabled])

  const handleScroll = (event: React.UIEvent<TElement>) => {
    if (!enabled) return

    const distance = scrollDistanceFromBottom(event.currentTarget)
    autoScrollRef.current = distance < 1
  }

  return { onScroll: handleScroll, ref: scrollRef }
}

const ToolBlockSection = React.memo(function ToolBlockSection({
  isError = false,
  label,
  text,
}: {
  isError?: boolean
  label: string
  text: string
}) {
  return (
    <section className="space-y-1.5">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <PlainToolOutput isError={isError} text={text} />
    </section>
  )
})

function editToolOutputWithoutSuccessMessage(output: string) {
  return output
    .split("\n")
    .filter(
      (line) => !/^Successfully replaced \d+ block\(s\) in .+\.$/.test(line)
    )
    .join("\n")
    .trimEnd()
}

function writeToolOutputWithoutSuccessMessage(output: string) {
  return output
    .split("\n")
    .filter((line) => !/^Successfully wrote \d+ bytes to .+$/.test(line))
    .join("\n")
    .trimEnd()
}

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "c",
  cjs: "javascript",
  cpp: "c",
  css: "css",
  cxx: "c",
  go: "go",
  h: "c",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  mjs: "javascript",
  md: "markdown",
  mdx: "mdx",
  py: "python",
  rs: "rust",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  txt: "plaintext",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
} satisfies Record<string, string>

const CODE_LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
} satisfies Record<string, string>

function codeLanguageFromPath(filePath: string) {
  const fileName = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase()
  if (!fileName) return undefined

  const filenameLanguage = CODE_LANGUAGE_BY_FILENAME[fileName]
  if (filenameLanguage) return filenameLanguage

  if (fileName.endsWith(".d.ts")) return "typescript"

  const extension = fileName.includes(".") ? fileName.split(".").pop() : ""
  return extension ? CODE_LANGUAGE_BY_EXTENSION[extension] : undefined
}

function WriteToolOutput({ block }: { block: AssistantToolBlock }) {
  const payload = getWriteToolPayload(block)
  const content = payload?.content
  const extraOutput = writeToolOutputWithoutSuccessMessage(
    block.output.trimEnd()
  )
  const autoScroll = useRunningToolAutoScroll<HTMLPreElement>({
    contentKey: content || "",
    enabled: block.running && content !== undefined,
  })

  if (block.isError) {
    return (
      <PlainToolOutput
        isError
        text={extraOutput || block.output.trimEnd() || "Write failed."}
      />
    )
  }

  if (!payload || content === undefined) {
    return (
      <PlainToolOutput
        text={toolOutputText(block) || "No content available."}
      />
    )
  }

  const language = payload.path ? codeLanguageFromPath(payload.path) : undefined

  return (
    <div className="space-y-3">
      <CodeBlock
        className="flex max-h-96 flex-col rounded-lg"
        code={content}
        language={language}
        onPreScroll={autoScroll.onScroll}
        preClassName="min-h-0 overflow-auto"
        preRef={autoScroll.ref}
        streaming={block.running}
      />
      {extraOutput ? (
        <PlainToolOutput isError={block.isError} text={extraOutput} />
      ) : null}
    </div>
  )
}

function EditToolOutput({
  block,
}: {
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number] & {
    type: "tool"
  }
}) {
  const patch = toolPatchText(block)
  const output = editToolOutputWithoutSuccessMessage(block.output.trimEnd())
  const extraOutput = output && output !== patch ? output : ""
  const fallbackOutput = editToolOutputWithoutSuccessMessage(
    toolOutputText(block)
  )
  const didSucceed = !block.running && !block.isError

  if (!patch) {
    return (
      <PlainToolOutput
        isError={block.isError}
        text={fallbackOutput || "No output available."}
      />
    )
  }

  return (
    <div className="space-y-3">
      <EditDiffBlock isBorderless={didSucceed} patch={patch} />
      {extraOutput ? (
        <PlainToolOutput isError={block.isError} text={extraOutput} />
      ) : null}
    </div>
  )
}

function ToolBlockCardBody({ block }: { block: AssistantToolBlock }) {
  const callText = toolCallText(block)
  const outputText = toolOutputText(block)
  const shellBodyText =
    block.name === "bash"
      ? [callText, block.output.trimEnd()].filter(Boolean).join("\n\n") ||
        callText ||
        outputText
      : ""
  const autoScroll = useRunningToolAutoScroll({
    contentKey: shellBodyText,
    enabled: block.name === "bash" && block.running,
  })
  const isSuccessfulEditTool =
    block.name === "edit" && !block.running && !block.isError
  const isSelfContainedWriteTool =
    block.name === "write" &&
    !block.isError &&
    getWriteToolPayload(block)?.content !== undefined
  const hasSelfContainedToolOutput =
    isSuccessfulEditTool || isSelfContainedWriteTool

  return (
    <div className={cn("border-t", !isSuccessfulEditTool && "pt-3")}>
      <div
        ref={block.name === "bash" ? autoScroll.ref : undefined}
        onScroll={block.name === "bash" ? autoScroll.onScroll : undefined}
        className={cn(
          isSelfContainedWriteTool
            ? "overflow-hidden rounded-lg"
            : "max-h-96 overflow-auto",
          isSuccessfulEditTool
            ? "rounded-t-none rounded-b-xl"
            : hasSelfContainedToolOutput
              ? "rounded-lg"
              : "rounded-lg border bg-background/80 p-3"
        )}
      >
        {block.name === "bash" ? (
          <pre
            className={cn(
              "overflow-x-auto font-mono text-xs leading-5 break-words whitespace-pre-wrap",
              block.isError && "text-destructive"
            )}
          >
            <AnsiText text={shellBodyText} />
          </pre>
        ) : block.name === "write" ? (
          <WriteToolOutput block={block} />
        ) : block.name === "edit" ? (
          <EditToolOutput block={block} />
        ) : (
          <div className="space-y-4">
            {callText ? (
              <ToolBlockSection label="Call" text={callText} />
            ) : null}
            <ToolBlockSection
              isError={block.isError}
              label={block.running ? "Output (streaming)" : "Output"}
              text={outputText}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const REMEMBERED_TOOL_COLLAPSIBLE_STATE_LIMIT = 500
const rememberedToolCollapsibleOpenKeys = new Map<string, true>()

function rememberToolCollapsibleOpenKey(key: string, open: boolean) {
  if (!key) return

  rememberedToolCollapsibleOpenKeys.delete(key)
  if (!open) return

  rememberedToolCollapsibleOpenKeys.set(key, true)
  while (
    rememberedToolCollapsibleOpenKeys.size >
    REMEMBERED_TOOL_COLLAPSIBLE_STATE_LIMIT
  ) {
    const oldestKey = rememberedToolCollapsibleOpenKeys.keys().next().value
    if (!oldestKey) break
    rememberedToolCollapsibleOpenKeys.delete(oldestKey)
  }
}

function useRememberedToolCollapsibleOpen(openStateKey: string) {
  const [open, setOpenState] = React.useState(() =>
    rememberedToolCollapsibleOpenKeys.has(openStateKey)
  )

  React.useEffect(() => {
    setOpenState(rememberedToolCollapsibleOpenKeys.has(openStateKey))
  }, [openStateKey])

  const setOpen = (nextOpen: boolean) => {
    rememberToolCollapsibleOpenKey(openStateKey, nextOpen)
    setOpenState(nextOpen)
  }

  return [open, setOpen] as const
}

const ToolBlockCard = React.memo(function ToolBlockCard({
  blockKey,
  store,
}: {
  blockKey: string
  store: AssistantBlockStore
}) {
  const header = useAssistantToolBlockHeader(store, blockKey)

  if (!header) return null

  return (
    <ToolBlockCardContent blockKey={blockKey} header={header} store={store} />
  )
})

function ToolBlockCardContent({
  blockKey,
  header,
  store,
}: {
  blockKey: string
  header: ToolBlockHeaderSnapshot
  store: AssistantBlockStore
}) {
  const [isOpen, setIsOpen] = useRememberedToolCollapsibleOpen(
    header.openStateKey
  )
  const bodyBlock = useAssistantToolBlockBody(store, blockKey, isOpen)
  const isSuccessfulEditTool =
    header.name === "edit" && !header.running && !header.isError

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "rounded-xl border text-sm",
        header.running && "border-amber-500/30 bg-amber-500/5",
        header.isError && "border-destructive/30 bg-destructive/5",
        !header.running && !header.isError && "bg-muted/20"
      )}
    >
      <CollapsibleTrigger
        data-conversation-tool-collapsible-trigger="true"
        className="group/tool-collapsible-trigger relative flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2.5 text-left text-sm font-medium transition-all outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <span className="grid max-w-full min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 overflow-hidden">
          <span className="truncate font-medium whitespace-nowrap text-foreground">
            {toolDisplayName(header.name)}
          </span>
          <span
            className={cn(
              "truncate text-muted-foreground",
              header.name === "write" && "tabular-nums"
            )}
          >
            {header.summary}
          </span>
        </span>
        {header.editStats ? (
          <EditDiffStatCountsView stats={header.editStats} />
        ) : null}
        <ChevronRightIcon className="pointer-events-none ml-auto size-4 shrink-0 text-muted-foreground group-aria-expanded/tool-collapsible-trigger:hidden" />
        <ChevronDownIcon className="pointer-events-none ml-auto hidden size-4 shrink-0 text-muted-foreground group-aria-expanded/tool-collapsible-trigger:inline" />
      </CollapsibleTrigger>

      {isOpen && bodyBlock ? (
        <CollapsibleContent className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up">
          <div
            className={cn(
              "h-(--collapsible-panel-height) data-ending-style:h-0 data-starting-style:h-0",
              !isSuccessfulEditTool && "px-3 pt-0 pb-3"
            )}
          >
            <ToolBlockCardBody block={bodyBlock} />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

function ExploreToolGroupCardBody({
  blocks,
}: {
  blocks: Array<AssistantToolBlock>
}) {
  return (
    <div className="border-t pt-3">
      <div className="max-h-96 overflow-auto rounded-lg border bg-background/80 p-3">
        <div className="space-y-3">
          {blocks.map((block, index) => {
            const line = exploreToolLine(block)
            const lineText = line.details || toolSummary(block)

            return (
              <div
                key={
                  block.blockKey ||
                  block.callId ||
                  `${block.name || "tool"}:${index}`
                }
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 text-sm"
              >
                <span className="truncate font-medium whitespace-nowrap text-foreground">
                  {line.label}
                </span>
                <TitleTooltip title={lineText}>
                  <span
                    className={cn(
                      "truncate text-muted-foreground",
                      block.isError && "text-destructive"
                    )}
                  >
                    {lineText}
                  </span>
                </TitleTooltip>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const ExploreToolGroupCard = React.memo(function ExploreToolGroupCard({
  blockKeys,
  store,
}: {
  blockKeys: Array<string>
  store: AssistantBlockStore
}) {
  const header = useAssistantToolGroupHeader(store, blockKeys)
  const [isOpen, setIsOpen] = useRememberedToolCollapsibleOpen(
    header.openStateKey
  )
  const blocks = useAssistantToolGroupBodyBlocks(store, blockKeys, isOpen)
  const statusLabel = exploreGroupStatusLabel()

  if (header.count === 0) return null

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "rounded-xl border text-sm",
        header.hasRunning && "border-amber-500/30 bg-amber-500/5",
        !header.hasRunning &&
          header.hasError &&
          "border-destructive/30 bg-destructive/5",
        !header.hasRunning && !header.hasError && "bg-muted/20"
      )}
    >
      <CollapsibleTrigger
        data-conversation-tool-collapsible-trigger="true"
        className="group/tool-collapsible-trigger relative flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2.5 text-left text-sm font-medium transition-all outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <span className="grid max-w-full min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 overflow-hidden">
          <span className="truncate font-medium whitespace-nowrap text-foreground">
            {statusLabel}
          </span>
          <span className="truncate text-muted-foreground">
            {header.summary}
          </span>
        </span>
        <ChevronRightIcon className="pointer-events-none ml-auto size-4 shrink-0 text-muted-foreground group-aria-expanded/tool-collapsible-trigger:hidden" />
        <ChevronDownIcon className="pointer-events-none ml-auto hidden size-4 shrink-0 text-muted-foreground group-aria-expanded/tool-collapsible-trigger:inline" />
      </CollapsibleTrigger>

      {isOpen ? (
        <CollapsibleContent className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up">
          <div className="h-(--collapsible-panel-height) px-3 pt-0 pb-3 data-ending-style:h-0 data-starting-style:h-0">
            <ExploreToolGroupCardBody blocks={blocks} />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
})

const CompactionBlockCard = React.memo(function CompactionBlockCard({
  block,
}: {
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number] & {
    type: "compaction"
  }
}) {
  return (
    <details className="rounded-xl border bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
        <ChevronRightIcon className="size-4 text-muted-foreground" />
        <span>{compactionTriggerText(block)}</span>
      </summary>
      <div className="mt-3 border-t pt-3">
        {block.summary.trim() ? (
          <MarkdownBlock text={block.summary} />
        ) : (
          <div className="text-sm text-muted-foreground">
            No compaction summary available.
          </div>
        )}
      </div>
    </details>
  )
})

export const UserMessageCard = React.memo(function UserMessageCard({
  item,
}: {
  item: Extract<ConversationItem, { kind: "user" }>
}) {
  const labelText = userMessageLabel(item)
  const [selectedImageIndex, setSelectedImageIndex] = React.useState<
    number | null
  >(null)
  const selectedImage =
    selectedImageIndex === null
      ? null
      : (item.images[selectedImageIndex] ?? null)

  return (
    <div className="mr-2 ml-auto w-fit max-w-[80%]">
      <div className="relative rounded-3xl bg-primary px-5 py-2.5 text-primary-foreground before:absolute before:-right-1.75 before:bottom-0 before:h-5.5 before:w-4 before:rounded-bl-[16px_14px] before:bg-primary before:content-[''] after:absolute after:-right-6.5 after:bottom-0 after:h-6.25 after:w-6.5 after:rounded-bl-[10px] after:bg-background after:content-['']">
        {labelText ? (
          <div className="mb-2 flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-primary-foreground/35 bg-primary-foreground/10 text-primary-foreground"
            >
              {labelText}
            </Badge>
          </div>
        ) : null}
        {item.text ? (
          <div className="text-sm break-words whitespace-pre-wrap text-primary-foreground">
            {item.text}
          </div>
        ) : (
          <div className="text-sm text-primary-foreground/80">Image prompt</div>
        )}
        {item.images.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-3">
            {item.images.map((image, index) => (
              <button
                key={`${promptImageKey(image)}:${index}`}
                type="button"
                className="max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-0 transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-foreground/70 focus-visible:ring-offset-2 focus-visible:ring-offset-primary focus-visible:outline-none"
                onClick={() => setSelectedImageIndex(index)}
              >
                <img
                  src={image.previewUrl}
                  alt="Prompt upload"
                  className="block h-28 max-w-full object-cover"
                />
                <span className="sr-only">Open prompt upload</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <UserMessageFooter copyText={item.text} />
      {selectedImage ? (
        <ImageLightbox
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedImageIndex(null)
          }}
          imageSrc={selectedImage.previewUrl}
          imageAlt="Prompt upload"
          title="Prompt upload preview"
          description="Expanded preview of an image attached to a user message."
        />
      ) : null}
    </div>
  )
})

function UserMessageFooter({ copyText }: { copyText: string }) {
  if (!copyText.trim()) return null

  return (
    <div className="mt-1 flex justify-end gap-1.5 text-xs font-medium text-muted-foreground">
      <MessageFooterCopyButton idleLabel="Copy user message" text={copyText} />
    </div>
  )
}

function assistantBlockIsVisible({
  block,
  hideThinking,
  hideToolBlocks,
}: {
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  switch (block.type) {
    case "text":
      return Boolean(block.text.trim())
    case "compaction":
      return true
    case "thinking":
      return !hideThinking
    case "tool":
      return !hideToolBlocks && !isPendingUnclassifiedToolBlock(block)
    default:
      return false
  }
}

export function assistantMessageHasVisibleBlocks({
  item,
  hideThinking,
  hideToolBlocks,
}: {
  item: Extract<ConversationItem, { kind: "assistant" }>
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  return item.blocks.some((block) =>
    assistantBlockIsVisible({ block, hideThinking, hideToolBlocks })
  )
}

export function assistantMessageHasFooterMeta(
  item: Extract<ConversationItem, { kind: "assistant" }>
) {
  return Boolean(item.model || assistantCopyTextFromItems([item]))
}

const AssistantBlockGroupView = React.memo(function AssistantBlockGroupView({
  anchorBlockKey,
  descriptor,
  store,
  streaming,
}: {
  anchorBlockKey?: string
  descriptor: AssistantBlockGroupDescriptor
  store: AssistantBlockStore
  streaming: boolean
}) {
  if (descriptor.type === "explore") {
    return (
      <AssistantExploreBlockGroupView
        blockKeys={descriptor.blockKeys}
        store={store}
      />
    )
  }

  const blockView = (
    <AssistantSingleBlockGroupView
      blockKey={descriptor.blockKey}
      blockType={descriptor.blockType}
      store={store}
      streaming={streaming}
    />
  )

  const blockProps = {
    "data-conversation-assistant-block": "true",
    "data-conversation-assistant-block-key": descriptor.blockKey,
    "data-conversation-assistant-block-type": descriptor.blockType,
  }

  if (descriptor.blockKey !== anchorBlockKey) {
    return <div {...blockProps}>{blockView}</div>
  }

  return (
    <div data-message-anchor="true" {...blockProps}>
      {blockView}
    </div>
  )
})

function AssistantExploreBlockGroupView({
  blockKeys,
  store,
}: {
  blockKeys: Array<string>
  store: AssistantBlockStore
}) {
  return (
    <div
      data-conversation-assistant-block="true"
      data-conversation-assistant-block-key={`explore:${blockKeys.join("|")}`}
      data-conversation-assistant-block-type="tool"
    >
      <ExploreToolGroupCard blockKeys={blockKeys} store={store} />
    </div>
  )
}

function AssistantSingleBlockGroupView({
  blockKey,
  blockType,
  store,
  streaming,
}: {
  blockKey: string
  blockType: AssistantConversationBlock["type"]
  store: AssistantBlockStore
  streaming: boolean
}) {
  if (blockType === "tool") {
    return <ToolBlockCard blockKey={blockKey} store={store} />
  }

  return (
    <AssistantSubscribedBlockView
      blockKey={blockKey}
      blockType={blockType}
      store={store}
      streaming={streaming}
    />
  )
}

function AssistantSubscribedBlockView({
  blockKey,
  blockType,
  store,
  streaming,
}: {
  blockKey: string
  blockType: AssistantConversationBlock["type"]
  store: AssistantBlockStore
  streaming: boolean
}) {
  const block = useAssistantBlock(store, blockKey)
  if (!block || block.type !== blockType) return null

  switch (block.type) {
    case "text":
      return block.isError ? (
        <div className="text-sm leading-6 wrap-break-word whitespace-pre-wrap text-destructive">
          {block.text}
        </div>
      ) : (
        <MarkdownBlock text={block.text} streaming={streaming} />
      )
    case "thinking":
      return (
        <section className="border-l-2 border-amber-500/45 pl-4 text-sm text-muted-foreground">
          <MarkdownBlock text={block.text} streaming={streaming} />
        </section>
      )
    case "compaction":
      return <CompactionBlockCard block={block} />
    default:
      return null
  }
}

function AssistantBlockGroupsView({
  anchorBlockKey,
  store,
  streaming,
}: {
  anchorBlockKey?: string
  store: AssistantBlockStore
  streaming: boolean
}) {
  const renderedBlocks = useAssistantBlockGroups(store)

  return (
    <>
      {renderedBlocks.map((descriptor) => (
        <AssistantBlockGroupView
          key={descriptor.key}
          anchorBlockKey={anchorBlockKey}
          descriptor={descriptor}
          store={store}
          streaming={streaming}
        />
      ))}
    </>
  )
}

function MessageFooterCopyButton({
  className,
  idleLabel,
  text,
}: {
  className?: string
  idleLabel: string
  text: string
}) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">(
    "idle"
  )
  const canCopy = Boolean(text.trim())

  const copyMessage = async () => {
    if (!canCopy) return

    try {
      await copyTextToClipboard(text)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1400)
    } catch {
      setCopyState("error")
      window.setTimeout(() => setCopyState("idle"), 1400)
    }
  }

  const label =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Retry copy"
        : idleLabel

  return (
    <TitleTooltip title={label}>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn("text-muted-foreground", className)}
        disabled={!canCopy}
        aria-label={label}
        onClick={copyMessage}
      >
        {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </TitleTooltip>
  )
}

function AssistantMessageFooter({
  copyText,
  modelLabel,
  streaming,
}: {
  copyText: string
  modelLabel: string
  streaming: boolean
}) {
  if (streaming) return null

  const showCopyButton = Boolean(copyText.trim())

  if (!showCopyButton && !modelLabel) return null

  return (
    <div className="-mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {showCopyButton ? (
        <MessageFooterCopyButton
          className="-ml-2"
          idleLabel="Copy assistant message"
          text={copyText}
        />
      ) : null}
      {modelLabel ? <span className="truncate">{modelLabel}</span> : null}
    </div>
  )
}

export function AssistantMessagesStoreCard({
  className,
  hideFooter = false,
  store,
}: {
  className?: string
  hideFooter?: boolean
  store: AssistantMessagesStore
}) {
  const initialSnapshot = store.getSnapshot()
  const initialBlocks = visibleAssistantBlocksFromSnapshot(initialSnapshot)
  const assistantBlockStoreRef = React.useRef<AssistantBlockStore | null>(null)
  if (!assistantBlockStoreRef.current) {
    assistantBlockStoreRef.current = createAssistantBlockStore(initialBlocks)
  }
  const assistantBlockStore = assistantBlockStoreRef.current

  const shellStoreRef = React.useRef<AssistantMessagesShellStore | null>(null)
  if (!shellStoreRef.current) {
    shellStoreRef.current = createAssistantMessagesShellStore(
      assistantMessagesShellSnapshotFromBlocks(initialSnapshot, initialBlocks)
    )
  }
  const shellStore = shellStoreRef.current

  React.useLayoutEffect(() => {
    const applySnapshot = () => {
      const snapshot = store.getSnapshot()
      const blocks = visibleAssistantBlocksFromSnapshot(snapshot)
      assistantBlockStore.setBlocks(blocks)
      shellStore.setSnapshot(
        assistantMessagesShellSnapshotFromBlocks(snapshot, blocks)
      )
    }

    applySnapshot()
    return store.subscribe(applySnapshot)
  }, [assistantBlockStore, shellStore, store])

  const shellSnapshot = React.useSyncExternalStore(
    shellStore.subscribe,
    shellStore.getSnapshot,
    shellStore.getSnapshot
  )

  const showFooter = Boolean(
    !hideFooter && !shellSnapshot.streaming && shellSnapshot.hasFooter
  )

  if (!shellSnapshot.hasBlocks && !showFooter) {
    return null
  }

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-conversation-assistant-group="true"
      data-conversation-streaming={shellSnapshot.streaming ? "true" : undefined}
    >
      {shellSnapshot.hasBlocks ? (
        <AssistantBlockGroupsView
          anchorBlockKey={shellSnapshot.anchorBlockKey}
          store={assistantBlockStore}
          streaming={shellSnapshot.streaming}
        />
      ) : null}
      {showFooter ? (
        <AssistantMessageFooter
          copyText={shellSnapshot.copyText}
          modelLabel={shellSnapshot.modelLabel}
          streaming={shellSnapshot.streaming}
        />
      ) : null}
    </div>
  )
}
