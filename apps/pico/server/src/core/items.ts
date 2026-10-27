/**
 * Turns a durable transcript into the web client's conversation items.
 *
 * One item per user input, per assistant message, and per compaction summary.
 * Tool results attach to the tool block of the assistant message that called
 * them. While a run works, `pi.live` adds the in-flight answer as a streaming
 * item and the running output of the current tool round.
 */
import type { EntryRecord, LiveState } from "@earendil-works/pi-durable"

export type PromptImage = {
  type: "image"
  mimeType: string
  data: string
}

/**
 * An image of a saved message. `url` is a server path that answers with the
 * image bytes (see `imagePath`), so the items carry no base64 data.
 */
export type ConversationImage = { mimeType: string; url: string }

/**
 * The server path of image `index` of history entry `entryId`. Index
 * `details` is the image of an image tool's details (see `detailsImage`).
 */
export function imagePath(
  sessionId: string,
  entryId: string,
  index: number | "details"
) {
  return `/api/session-image/${encodeURIComponent(sessionId)}/${encodeURIComponent(entryId)}/${index}`
}

export type TextBlock = {
  type: "text"
  blockKey: string
  text: string
  isError?: boolean
}

export type ThinkingBlock = {
  type: "thinking"
  blockKey: string
  text: string
  summaryLabel?: string
}

export type ToolBlock = {
  type: "tool"
  blockKey: string
  callId?: string
  name?: string
  args?: unknown
  output: string
  details?: unknown
  /** Images in the tool result, for example from reading an image file. */
  images?: ConversationImage[]
  isError: boolean
  running: boolean
}

export type CompactionBlock = {
  type: "compaction"
  blockKey: string
  summary: string
  tokensBefore: number
  estimatedTokensAfter?: number
}

export type AssistantBlock =
  | TextBlock
  | ThinkingBlock
  | ToolBlock
  | CompactionBlock

export type ModelOption = {
  id: string
  provider?: string
  name?: string
  reasoning?: boolean
}

export type UserItem = {
  kind: "user"
  itemKey: string
  forkEntryId?: string
  text: string
  images: ConversationImage[]
}

export type AssistantItem = {
  kind: "assistant"
  itemKey: string
  renderKey?: string
  branchEntryId?: string
  blocks: AssistantBlock[]
  streaming: boolean
  done: boolean
  model?: ModelOption
  /** Wall-clock milliseconds when the response request started. */
  startedAt?: number
  /**
   * Wall-clock milliseconds when the response ended, or when the last result
   * of its tool calls arrived, if that is later.
   */
  endedAt?: number
}

export type ConversationItem = UserItem | AssistantItem

type ContentPart = {
  type?: string
  text?: string
  thinking?: string
  summaryLabel?: string
  id?: string
  name?: string
  arguments?: unknown
  mimeType?: string
  data?: string
}

type MessageLike = {
  role?: string
  content?: unknown
  stopReason?: string
  errorMessage?: string
  provider?: string
  model?: string
  toolCallId?: string
  details?: unknown
  isError?: boolean
  usage?: UsageLike
  timestamp?: number
  durationMs?: number
}

export type UsageLike = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
}

const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n"
const SUMMARY_SUFFIX = "\n</summary>"

function parts(content: unknown): ContentPart[] {
  return Array.isArray(content) ? (content as ContentPart[]) : []
}

export function messageText(message: MessageLike | undefined): string {
  const content = message?.content
  if (typeof content === "string") return content
  return parts(content)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
}

export function messageImages(message: MessageLike | undefined): PromptImage[] {
  return parts(message?.content).flatMap((part) => {
    if (part?.type !== "image" || !part.data || !part.mimeType) return []
    return [
      {
        type: "image" as const,
        mimeType: part.mimeType,
        data: part.data,
      },
    ]
  })
}

type ImageDetails = { kind: "image"; data: string; title?: string }

/**
 * The image in the details of an image tool result (`show`, browser and
 * preview screenshots): `{ kind: "image", data: "data:image/...;base64,..." }`.
 */
export function detailsImage(
  details: unknown
): { mimeType: string; data: string } | undefined {
  const value = details as Partial<ImageDetails> | null | undefined
  if (value?.kind !== "image" || typeof value.data !== "string")
    return undefined
  const match = /^data:(image\/[^;,]+);base64,/i.exec(value.data)
  if (!match) return undefined
  return { mimeType: match[1]!, data: value.data.slice(match[0].length) }
}

/** Tokens a response's request occupied in the context window. */
export function contextTokens(
  usage: UsageLike | undefined
): number | undefined {
  if (!usage) return undefined
  const total =
    usage.totalTokens ||
    (usage.input ?? 0) +
      (usage.output ?? 0) +
      (usage.cacheRead ?? 0) +
      (usage.cacheWrite ?? 0)
  return total > 0 ? total : undefined
}

function assistantModel(message: MessageLike): ModelOption | undefined {
  const id = typeof message.model === "string" ? message.model.trim() : ""
  if (!id) return undefined
  return {
    id,
    ...(typeof message.provider === "string" && message.provider
      ? { provider: message.provider }
      : {}),
  }
}

function validTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function assistantTimes(message: MessageLike) {
  const startedAt = validTime(message.timestamp)
  if (startedAt === undefined) return {}
  const duration = validTime(message.durationMs)
  return {
    startedAt,
    ...(duration !== undefined ? { endedAt: startedAt + duration } : {}),
  }
}

function stopMessage(message: MessageLike): string {
  const error =
    typeof message.errorMessage === "string" ? message.errorMessage.trim() : ""
  if (message.stopReason === "aborted") {
    return error && error !== "Request was aborted"
      ? error
      : "Operation aborted"
  }
  if (message.stopReason === "error")
    return `Error: ${error || "Unknown error"}`
  return ""
}

export function assistantBlocks(
  message: MessageLike,
  keyPrefix: string
): AssistantBlock[] {
  const blocks: AssistantBlock[] = []
  parts(message.content).forEach((part, index) => {
    const partKey = `${keyPrefix}:part:${index}`
    if (part?.type === "text") {
      blocks.push({
        type: "text",
        blockKey: `${partKey}:text`,
        text: part.text ?? "",
      })
    } else if (part?.type === "thinking") {
      const text = part.thinking ?? ""
      if (!text.trim()) return
      blocks.push({
        type: "thinking",
        blockKey: `${partKey}:thinking`,
        text,
        ...(typeof part.summaryLabel === "string"
          ? { summaryLabel: part.summaryLabel }
          : {}),
      })
    } else if (part?.type === "toolCall") {
      const callId =
        typeof part.id === "string" && part.id ? part.id : undefined
      blocks.push({
        type: "tool",
        blockKey: callId ? `${keyPrefix}:tool:${callId}` : `${partKey}:tool`,
        ...(callId ? { callId } : {}),
        ...(typeof part.name === "string" ? { name: part.name } : {}),
        args: part.arguments,
        output: "",
        isError: false,
        running: true,
      })
    }
  })
  const stop = stopMessage(message)
  if (stop) {
    const pendingTools = blocks.filter(
      (block): block is ToolBlock =>
        block.type === "tool" && !block.output.trim()
    )
    if (pendingTools.length > 0) {
      for (const block of pendingTools) {
        block.output = stop
        block.isError = true
        block.running = false
      }
    } else {
      blocks.push({
        type: "text",
        blockKey: `${keyPrefix}:stop`,
        text: stop,
        ...(message.stopReason === "error" || message.stopReason === "aborted"
          ? { isError: true }
          : {}),
      })
    }
  }
  return blocks
}

function compactionSummary(entry: EntryRecord): string {
  const text = messageText(entry.model?.[0] as MessageLike | undefined)
  if (text.startsWith(SUMMARY_PREFIX)) {
    const body = text.slice(SUMMARY_PREFIX.length)
    return body.endsWith(SUMMARY_SUFFIX)
      ? body.slice(0, -SUMMARY_SUFFIX.length)
      : body
  }
  return text
}

/** Whether an entry starts an item; history pages are counted in items. */
export function entryStartsItem(entry: EntryRecord) {
  return (
    isUserEntry(entry) ||
    entry.kind === "pi.assistant" ||
    entry.kind === "pi.compaction"
  )
}

/**
 * An input placed as a user message: `pi.user`, or an application kind whose
 * model is one user message.
 */
function isUserEntry(entry: EntryRecord) {
  if (entry.kind === "pi.user") return true
  if (entry.kind.startsWith("pi.")) return false
  const message = entry.model?.[0] as MessageLike | undefined
  return entry.model?.length === 1 && message?.role === "user"
}

type ToolLocation = { item: AssistantItem; block: ToolBlock }

/** The images of a message as URLs: `imageUrl(index)` names image `index`. */
function messageImageUrls(
  message: MessageLike | undefined,
  imageUrl: (index: number) => string
): ConversationImage[] {
  return messageImages(message).map(({ mimeType }, index) => ({
    mimeType,
    url: imageUrl(index),
  }))
}

/**
 * Build items from history entries, oldest first. Images become URLs of the
 * session `sessionId` (see `imagePath`).
 */
export function itemsFromEntries(
  entries: readonly EntryRecord[],
  sessionId: string
): ConversationItem[] {
  const items: ConversationItem[] = []
  const tools = new Map<string, ToolLocation>()
  let lastContextTokens = 0

  for (const entry of entries) {
    const entryId = String(entry.id)
    const key = `entry:${entryId}`
    const imageUrl = (index: number | "details") =>
      imagePath(sessionId, entryId, index)
    if (isUserEntry(entry)) {
      const message = entry.model?.[0] as MessageLike | undefined
      items.push({
        kind: "user",
        itemKey: key,
        forkEntryId: entryId,
        text: messageText(message),
        images: messageImageUrls(message, imageUrl),
      })
      continue
    }
    if (entry.kind === "pi.assistant") {
      const message = (entry.model?.[0] ?? {}) as MessageLike
      const blocks = assistantBlocks(message, key)
      const tokens = contextTokens(message.usage)
      if (tokens) lastContextTokens = tokens
      const item: AssistantItem = {
        kind: "assistant",
        itemKey: key,
        branchEntryId: entryId,
        blocks,
        streaming: false,
        done: true,
        ...(assistantModel(message) ? { model: assistantModel(message) } : {}),
        ...assistantTimes(message),
      }
      for (const block of blocks) {
        if (block.type === "tool" && block.callId)
          tools.set(block.callId, { item, block })
      }
      items.push(item)
      continue
    }
    if (entry.kind === "pi.tool-result") {
      const message = (entry.model?.[0] ?? {}) as MessageLike
      const location = message.toolCallId
        ? tools.get(message.toolCallId)
        : undefined
      if (!location) continue
      location.block.output = messageText(message)
      // The details image goes as a URL too, not as a second base64 copy.
      location.block.details = detailsImage(message.details)
        ? { ...(message.details as ImageDetails), data: imageUrl("details") }
        : message.details
      const images = messageImageUrls(message, imageUrl)
      if (images.length > 0) location.block.images = images
      location.block.isError = Boolean(message.isError)
      location.block.running = false
      const resultAt = validTime(message.timestamp)
      if (
        resultAt !== undefined &&
        resultAt > (location.item.endedAt ?? location.item.startedAt ?? 0)
      ) {
        location.item.endedAt = resultAt
      }
      continue
    }
    if (entry.kind === "pi.compaction") {
      items.push({
        kind: "assistant",
        itemKey: key,
        branchEntryId: entryId,
        blocks: [
          {
            type: "compaction",
            blockKey: `${key}:compaction`,
            summary: compactionSummary(entry),
            tokensBefore: lastContextTokens,
          },
        ],
        streaming: false,
        done: true,
      })
    }
  }
  return items
}

/**
 * Apply the current tool round's running output from `pi.live` to the items,
 * and finish tool blocks that can no longer run: no live slot and no result.
 */
export function applyLiveTools(
  items: ConversationItem[],
  live: LiveState | undefined,
  busy: boolean
): ConversationItem[] {
  const slots = new Map((live?.tools ?? []).map((slot) => [slot.callId, slot]))
  let changed = false
  const next = items.map((item) => {
    if (item.kind !== "assistant") return item
    let blocksChanged = false
    const blocks = item.blocks.map((block) => {
      if (block.type !== "tool" || !block.running) return block
      const slot = block.callId ? slots.get(block.callId) : undefined
      if (slot) {
        const output = slot.output ?? ""
        if (output === block.output && slot.details === undefined) return block
        blocksChanged = true
        return {
          ...block,
          output,
          ...(slot.details !== undefined ? { details: slot.details } : {}),
        }
      }
      if (busy) return block
      // The run ended without a result for this call.
      blocksChanged = true
      return {
        ...block,
        running: false,
        isError: true,
        output: block.output || "Interrupted",
      }
    })
    if (!blocksChanged) return item
    changed = true
    return { ...item, blocks }
  })
  return changed ? next : items
}

/** The streaming assistant item for the in-flight answer, if a generation is producing one. */
export function streamingItem(
  live: LiveState | undefined
): AssistantItem | undefined {
  const message = live?.generation?.message as MessageLike | undefined
  if (!message) return undefined
  const model = assistantModel(message)
  return {
    kind: "assistant",
    itemKey: "streaming",
    renderKey: "streaming",
    blocks: assistantBlocks({ ...message, stopReason: undefined }, "streaming"),
    streaming: true,
    done: false,
    ...(model ? { model } : {}),
  }
}

export type DeltaOperation =
  | { op: "replaceItem"; item: AssistantItem }
  | {
      op: "appendBlock"
      contentIndex: number
      blockKey: string
      blockType: "text" | "thinking"
      delta: string
    }
  | { op: "replaceBlock"; contentIndex: number; block: AssistantBlock }

/**
 * Operations that turn the client's streaming item `previous` into `next`:
 * text appends where possible, block replacements otherwise.
 */
export function streamingDelta(
  previous: AssistantItem | undefined,
  next: AssistantItem
): DeltaOperation[] {
  if (!previous || previous.blocks.length > next.blocks.length) {
    return [{ op: "replaceItem", item: next }]
  }
  const operations: DeltaOperation[] = []
  next.blocks.forEach((block, index) => {
    const before = previous.blocks[index]
    if (before && JSON.stringify(before) === JSON.stringify(block)) return
    if (
      (block.type === "text" || block.type === "thinking") &&
      (!before ||
        (before.type === block.type && before.blockKey === block.blockKey)) &&
      block.text.startsWith(before && "text" in before ? before.text : "") &&
      !(
        block.type === "thinking" &&
        before?.type === "thinking" &&
        before.summaryLabel !== block.summaryLabel
      ) &&
      !(block.type === "text" && block.isError)
    ) {
      const previousText = before && "text" in before ? before.text : ""
      operations.push({
        op: "appendBlock",
        contentIndex: index,
        blockKey: block.blockKey,
        blockType: block.type,
        delta: block.text.slice(previousText.length),
      })
      return
    }
    operations.push({ op: "replaceBlock", contentIndex: index, block })
  })
  if (JSON.stringify(previous.model) !== JSON.stringify(next.model)) {
    return [{ op: "replaceItem", item: next }]
  }
  return operations
}

/** First non-empty user text, for titles and previews. */
export function firstUserText(entries: readonly EntryRecord[]): string {
  for (const entry of entries) {
    if (!isUserEntry(entry)) continue
    const text = messageText(entry.model?.[0] as MessageLike | undefined).trim()
    if (text) return text
    if (messageImages(entry.model?.[0] as MessageLike | undefined).length > 0)
      return "Image"
  }
  return ""
}

export function isUserInputEntry(entry: EntryRecord) {
  return isUserEntry(entry)
}
