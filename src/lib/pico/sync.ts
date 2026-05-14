import type {
  AssistantBlock,
  AssistantItem,
  ConversationItem,
  PromptImage,
  SessionState,
  StateSyncPayload,
  StreamingBehavior,
  ToolBlock,
} from "@/lib/pico"
import { toolCategoryFromTool } from "@/lib/pico/tool-classification"

type MessageContentPart = {
  type?: unknown
  text?: unknown
  thinking?: unknown
  summaryLabel?: unknown
  id?: unknown
  name?: unknown
  arguments?: unknown
}

type SyncMessage = NonNullable<StateSyncPayload["messages"]>[number]

export function previewUrlForImage(
  image: Pick<PromptImage, "mimeType" | "data">
) {
  return `data:${image.mimeType};base64,${image.data}`
}

export function normalizePromptImage(image: unknown): PromptImage | null {
  if (!image || typeof image !== "object") return null

  let mimeType =
    typeof (image as { mimeType?: unknown }).mimeType === "string"
      ? (image as { mimeType: string }).mimeType.trim()
      : ""
  let data =
    typeof (image as { data?: unknown }).data === "string"
      ? (image as { data: string }).data.trim()
      : ""

  if (!data) return null

  const dataUrlMatch = data.match(/^data:([^;,]+);base64,(.+)$/i)
  if (dataUrlMatch) {
    if (!mimeType) {
      mimeType = dataUrlMatch[1] ?? mimeType
    }
    data = dataUrlMatch[2] ?? ""
  }

  if (!mimeType || !/^image\//i.test(mimeType) || !data) {
    return null
  }

  return {
    type: "image",
    mimeType,
    data,
    previewUrl: previewUrlForImage({ mimeType, data }),
  }
}

export function extractMessageText(message: { content?: unknown }) {
  if (typeof message?.content === "string") {
    return message.content
  }

  if (!Array.isArray(message?.content)) return ""

  return message.content
    .flatMap((part) => (part?.type === "text" ? [part.text || ""] : []))
    .join("\n")
}

export function extractToolText(
  result: { content?: Array<MessageContentPart> } | undefined
) {
  if (!result || !Array.isArray(result.content)) return ""

  return result.content
    .flatMap((part) =>
      part?.type === "text" && typeof part.text === "string" ? [part.text] : []
    )
    .join("\n")
}

export function extractMessageImages(message: { content?: unknown }) {
  if (!Array.isArray(message?.content)) return []

  return message.content.flatMap((part) => {
    if (part?.type !== "image") return []
    const image = normalizePromptImage(part)
    return image ? [image] : []
  })
}

function normalizeStreamingBehavior(
  value: unknown
): StreamingBehavior | undefined {
  return value === "steer" || value === "followUp" ? value : undefined
}

function stableJsonValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value !== "object") return JSON.stringify(value)

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonValue(entry)).join(",")}]`
  }

  const keys = Object.keys(value).sort()
  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJsonValue(
          (value as Record<string, unknown>)[key]
        )}`
    )
    .join(",")}}`
}

export function sameContextUsage(
  left: SessionState["contextUsage"],
  right: SessionState["contextUsage"]
) {
  return stableJsonValue(left) === stableJsonValue(right)
}

function samePromptImages(
  leftImages: Array<PromptImage> = [],
  rightImages: Array<PromptImage> = []
) {
  if (leftImages.length !== rightImages.length) return false

  for (let index = 0; index < leftImages.length; index += 1) {
    const left = leftImages[index]
    const right = rightImages[index]
    if (!left || !right) return false
    if (left.mimeType !== right.mimeType) return false
    if (left.data !== right.data) return false
    if (left.previewUrl !== right.previewUrl) return false
  }

  return true
}

function sameUserMessageBody(
  left: Extract<ConversationItem, { kind: "user" }>,
  right: Extract<ConversationItem, { kind: "user" }>
) {
  return (
    left.text === right.text &&
    samePromptImages(left.images, right.images) &&
    Boolean(left.queued) === Boolean(right.queued) &&
    left.streamingBehavior === right.streamingBehavior
  )
}

function sameUserMessageContent(
  left: Extract<ConversationItem, { kind: "user" }>,
  right: Extract<ConversationItem, { kind: "user" }>
) {
  return (
    (left.itemKey || "") === (right.itemKey || "") &&
    sameUserMessageBody(left, right)
  )
}

function sameAssistantBlockPayload(
  left: AssistantBlock,
  right: AssistantBlock
) {
  if (!left || !right || left.type !== right.type) return false

  switch (left.type) {
    case "text":
      return (
        right.type === "text" &&
        left.text === right.text &&
        Boolean(left.isError) === Boolean(right.isError)
      )
    case "thinking":
      return (
        right.type === "thinking" &&
        left.text === right.text &&
        (left.summaryLabel || "") === (right.summaryLabel || "")
      )
    case "tool":
      return (
        right.type === "tool" &&
        (left.callId || "") === (right.callId || "") &&
        (left.name || "") === (right.name || "") &&
        stableJsonValue(left.args) === stableJsonValue(right.args) &&
        left.output === right.output &&
        stableJsonValue(left.details) === stableJsonValue(right.details) &&
        Boolean(left.isError) === Boolean(right.isError) &&
        Boolean(left.running) === Boolean(right.running)
      )
    case "compaction":
      return (
        right.type === "compaction" &&
        left.summary === right.summary &&
        left.tokensBefore === right.tokensBefore
      )
    default:
      return false
  }
}

function sameAssistantBlock(left: AssistantBlock, right: AssistantBlock) {
  return (
    (left.blockKey || "") === (right.blockKey || "") &&
    sameAssistantBlockPayload(left, right)
  )
}

function sameAssistantModel(
  left: AssistantItem["model"],
  right: AssistantItem["model"]
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.id === right.id &&
    (left.provider || "") === (right.provider || "") &&
    (left.name || "") === (right.name || "") &&
    Boolean(left.reasoning) === Boolean(right.reasoning)
  )
}

function sameAssistantMessageMeta(left: AssistantItem, right: AssistantItem) {
  return (
    sameAssistantModel(left.model, right.model) &&
    (left.done === false) === (right.done === false)
  )
}

function sameStateItem(left: ConversationItem, right: ConversationItem) {
  if (!left || !right || left.kind !== right.kind) return false
  if ((left.itemKey || "") !== (right.itemKey || "")) return false

  if (left.kind === "user" && right.kind === "user") {
    return (
      (left.pendingId || "") === (right.pendingId || "") &&
      sameUserMessageContent(left, right)
    )
  }

  if (left.kind !== "assistant" || right.kind !== "assistant") {
    return false
  }

  if (Boolean(left.streaming) !== Boolean(right.streaming)) return false
  if (!sameAssistantMessageMeta(left, right)) return false
  if (left.blocks.length !== right.blocks.length) return false

  for (let index = 0; index < left.blocks.length; index += 1) {
    if (!sameAssistantBlock(left.blocks[index], right.blocks[index])) {
      return false
    }
  }

  return true
}

function previousAssistantBlockByKey(
  blocks: Array<AssistantBlock>,
  blockKey: string | undefined
) {
  if (!blockKey) return undefined

  return blocks.find((block) => block.blockKey === blockKey)
}

function assistantBlockRenderKey(block: AssistantBlock | undefined) {
  return block?.renderKey || block?.blockKey || ""
}

function withAssistantBlockRenderKey(
  block: AssistantBlock,
  previousBlock: AssistantBlock | undefined
) {
  const renderKey = assistantBlockRenderKey(previousBlock)
  if (!renderKey || block.renderKey === renderKey) return block

  return { ...block, renderKey } satisfies AssistantBlock
}

function sameAssistantBlockListPayload(
  leftBlocks: Array<AssistantBlock>,
  rightBlocks: Array<AssistantBlock>
) {
  if (leftBlocks.length !== rightBlocks.length) return false

  for (let index = 0; index < leftBlocks.length; index += 1) {
    if (!sameAssistantBlockPayload(leftBlocks[index], rightBlocks[index])) {
      return false
    }
  }

  return true
}

function reconcileAssistantBlocks(
  previousBlocks: Array<AssistantBlock>,
  nextBlocks: Array<AssistantBlock>
) {
  let changed = previousBlocks.length !== nextBlocks.length
  const reconciled: Array<AssistantBlock> = []

  for (let index = 0; index < nextBlocks.length; index += 1) {
    const nextBlock = nextBlocks[index]
    const previousBlock =
      previousAssistantBlockByKey(previousBlocks, nextBlock.blockKey) ||
      previousBlocks[index]

    if (previousBlock && sameAssistantBlock(previousBlock, nextBlock)) {
      reconciled.push(previousBlock)
      continue
    }

    changed = true
    if (
      previousBlock?.type === nextBlock.type &&
      ((previousBlock.blockKey || "") === (nextBlock.blockKey || "") ||
        sameAssistantBlockPayload(previousBlock, nextBlock))
    ) {
      reconciled.push(withAssistantBlockRenderKey(nextBlock, previousBlock))
      continue
    }

    reconciled.push(nextBlock)
  }

  return changed ? reconciled : previousBlocks
}

function conversationItemRenderKey(item: ConversationItem | undefined) {
  return item?.renderKey || item?.itemKey || ""
}

function withConversationItemRenderKey<T extends ConversationItem>(
  item: T,
  previousItem: ConversationItem | undefined
): T {
  const renderKey = conversationItemRenderKey(previousItem)
  if (!renderKey || item.renderKey === renderKey) return item

  return { ...item, renderKey } as T
}

function reconcileConversationItems(
  previousItems: Array<ConversationItem>,
  nextItems: Array<ConversationItem>
) {
  if (previousItems.length === 0) return nextItems

  const previousItemsByKey = new Map<string, ConversationItem>()
  const previousItemsByRenderKey = new Map<string, ConversationItem>()
  for (const item of previousItems) {
    if (item.itemKey && !previousItemsByKey.has(item.itemKey)) {
      previousItemsByKey.set(item.itemKey, item)
    }

    const renderKey = conversationItemRenderKey(item)
    if (renderKey && !previousItemsByRenderKey.has(renderKey)) {
      previousItemsByRenderKey.set(renderKey, item)
    }
  }

  let changed = previousItems.length !== nextItems.length
  const reconciled: Array<ConversationItem> = []

  for (let index = 0; index < nextItems.length; index += 1) {
    const nextItem = nextItems[index]
    const nextRenderKey = conversationItemRenderKey(nextItem)
    const previousItem =
      (nextItem.itemKey
        ? previousItemsByKey.get(nextItem.itemKey)
        : undefined) ||
      (nextRenderKey
        ? previousItemsByRenderKey.get(nextRenderKey)
        : undefined) ||
      previousItems[index]

    if (!previousItem || previousItem.kind !== nextItem.kind) {
      changed = true
      reconciled.push(nextItem)
      continue
    }

    if (sameStateItem(previousItem, nextItem)) {
      reconciled.push(previousItem)
      continue
    }

    if (previousItem.kind === "user" && nextItem.kind === "user") {
      if (sameUserMessageBody(previousItem, nextItem)) {
        changed = true
        reconciled.push(withConversationItemRenderKey(nextItem, previousItem))
        continue
      }
    }

    if (previousItem.kind === "assistant" && nextItem.kind === "assistant") {
      const blocks = reconcileAssistantBlocks(
        previousItem.blocks,
        nextItem.blocks
      )
      const sameLogicalItem =
        (previousItem.itemKey || "") === (nextItem.itemKey || "")
      const sameRenderItem =
        conversationItemRenderKey(previousItem) ===
        conversationItemRenderKey(nextItem)
      const finalizingStreamingItem =
        Boolean(previousItem.streaming) &&
        !nextItem.streaming &&
        sameAssistantBlockListPayload(previousItem.blocks, nextItem.blocks)
      const itemWithStableRenderKey =
        sameLogicalItem || sameRenderItem || finalizingStreamingItem
          ? withConversationItemRenderKey(nextItem, previousItem)
          : nextItem

      if (
        sameLogicalItem &&
        blocks === previousItem.blocks &&
        Boolean(previousItem.streaming) === Boolean(nextItem.streaming) &&
        sameAssistantMessageMeta(previousItem, nextItem)
      ) {
        reconciled.push(previousItem)
        continue
      }

      changed = true
      reconciled.push(
        blocks === itemWithStableRenderKey.blocks
          ? itemWithStableRenderKey
          : { ...itemWithStableRenderKey, blocks }
      )
      continue
    }

    changed = true
    reconciled.push(nextItem)
  }

  return changed ? reconciled : previousItems
}

function assistantStopMessage(message: SyncMessage | undefined) {
  const stopReason =
    typeof message?.stopReason === "string" ? message.stopReason : ""
  const errorMessage =
    typeof message?.errorMessage === "string" ? message.errorMessage.trim() : ""

  if (stopReason === "aborted") {
    return errorMessage && errorMessage !== "Request was aborted"
      ? errorMessage
      : "Operation aborted"
  }

  if (stopReason === "error") {
    return `Error: ${errorMessage || "Unknown error"}`
  }

  return ""
}

function assistantStopIsError(message: SyncMessage | undefined) {
  const stopReason =
    typeof message?.stopReason === "string" ? message.stopReason : ""
  return stopReason === "aborted" || stopReason === "error"
}

function assistantModelFromMessage(message: SyncMessage | undefined) {
  const id = typeof message?.model === "string" ? message.model.trim() : ""
  if (!id) return undefined

  const provider =
    typeof message?.provider === "string" ? message.provider.trim() : ""

  return {
    id,
    ...(provider ? { provider } : {}),
  } satisfies AssistantItem["model"]
}

function assistantItemMetadataFromMessage(message: SyncMessage | undefined) {
  const model = assistantModelFromMessage(message)

  return (model ? { model } : {}) satisfies Partial<AssistantItem>
}

function applyAssistantStopToToolBlocks(
  blocks: Array<AssistantBlock>,
  stopMessage: string
) {
  let changed = false
  const nextBlocks = blocks.map((block) => {
    if (block.type !== "tool" || block.output.trim()) return block
    changed = true
    return {
      ...block,
      output: stopMessage,
      isError: true,
      running: false,
    } satisfies ToolBlock
  })

  return changed ? nextBlocks : blocks
}

export function assistantBlocksFromMessage(
  message: SyncMessage | undefined,
  keyPrefix = "assistant"
) {
  let blocks: Array<AssistantBlock> = []
  const toolBlockIndexByCallId = new Map<string, number>()
  const content = Array.isArray(message?.content) ? message.content : []
  const stopMessage = assistantStopMessage(message)
  const stopIsError = assistantStopIsError(message)

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index]
    const partKey = `${keyPrefix}:part:${index}`

    if (part?.type === "text") {
      blocks.push({
        type: "text",
        blockKey: `${partKey}:text`,
        text: part.text || "",
      })
    }

    if (part?.type === "thinking") {
      const thinkingText = part.thinking || ""
      if (thinkingText.trim()) {
        blocks.push({
          type: "thinking",
          blockKey: `${partKey}:thinking`,
          text: thinkingText,
          ...(typeof part.summaryLabel === "string"
            ? { summaryLabel: part.summaryLabel }
            : {}),
        })
      }
    }

    if (part?.type === "toolCall") {
      const callId = typeof part.id === "string" ? part.id.trim() : ""
      const toolName = typeof part.name === "string" ? part.name : undefined
      const category = toolCategoryFromTool(toolName, part.arguments)
      const toolBlock = {
        type: "tool",
        blockKey: callId ? `${keyPrefix}:tool:${callId}` : `${partKey}:tool`,
        ...(callId ? { callId } : {}),
        ...(toolName ? { name: toolName } : {}),
        ...(category ? { category } : {}),
        args: part.arguments,
        output: "",
        details: undefined,
        isError: false,
        running: true,
      } satisfies ToolBlock

      const existingIndex = callId
        ? toolBlockIndexByCallId.get(callId)
        : undefined
      const existingBlock =
        existingIndex !== undefined ? blocks[existingIndex] : undefined
      if (existingIndex !== undefined && existingBlock?.type === "tool") {
        blocks[existingIndex] = {
          ...existingBlock,
          ...(toolBlock.name ? { name: toolBlock.name } : {}),
          ...(toolBlock.category || existingBlock.category
            ? { category: toolBlock.category || existingBlock.category }
            : {}),
          args: toolBlock.args,
          running: true,
        }
        continue
      }

      if (callId) {
        toolBlockIndexByCallId.set(callId, blocks.length)
      }
      blocks.push(toolBlock)
    }
  }

  if (stopMessage) {
    if (blocks.some((block) => block.type === "tool")) {
      blocks = applyAssistantStopToToolBlocks(blocks, stopMessage)
    } else {
      blocks.push({
        type: "text",
        blockKey: `${keyPrefix}:stop`,
        text: stopMessage,
        ...(stopIsError ? { isError: true } : {}),
      })
    }
  }

  return blocks
}

export function createCompactionSummaryItem(
  summary: unknown,
  tokensBefore: unknown,
  itemKey = "compaction"
) {
  return {
    kind: "assistant",
    itemKey,
    blocks: [
      {
        type: "compaction",
        blockKey: `${itemKey}:compaction`,
        summary: typeof summary === "string" ? summary : "",
        tokensBefore: Number.isFinite(Number(tokensBefore))
          ? Number(tokensBefore)
          : 0,
      },
    ],
    streaming: false,
  } satisfies AssistantItem
}

function mutateToolBlockInItems(
  items: Array<ConversationItem>,
  callId: string | undefined,
  mutate: (block: ToolBlock) => void
) {
  if (!callId) return

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind !== "assistant") continue

    const block = item.blocks.find(
      (entry): entry is ToolBlock =>
        entry.type === "tool" && entry.callId === callId
    )

    if (!block) continue
    mutate(block)
    return
  }
}

export type ToolResultUpdate = Pick<ToolBlock, "output" | "details" | "isError">

function applyToolResultToBlock(
  block: ToolBlock,
  update: ToolResultUpdate | undefined
): ToolBlock {
  if (!update) return block

  if (
    block.output === update.output &&
    block.details === update.details &&
    block.isError === update.isError &&
    !block.running
  ) {
    return block
  }

  return {
    ...block,
    output: update.output,
    details: update.details,
    isError: update.isError,
    running: false,
  }
}

function applyToolResultsToBlocks(
  blocks: Array<AssistantBlock>,
  toolResultsByCallId: Map<string, ToolResultUpdate>
) {
  if (toolResultsByCallId.size === 0) return blocks

  let changed = false
  const nextBlocks = blocks.map((block) => {
    if (block.type !== "tool" || !block.callId) return block

    const nextBlock = applyToolResultToBlock(
      block,
      toolResultsByCallId.get(block.callId)
    )
    if (nextBlock !== block) changed = true
    return nextBlock
  })

  return changed ? nextBlocks : blocks
}

export function mergeAssistantBlocksForStreaming(options: {
  previousBlocks?: Array<AssistantBlock>
  nextBlocks: Array<AssistantBlock>
  toolResultsByCallId?: Map<string, ToolResultUpdate>
  preserveMissingTools?: boolean
  preserveBlockRenderKeysByIndex?: boolean
}) {
  const previousBlocks = options.previousBlocks ?? []
  const withToolResults = (blocks: Array<AssistantBlock>) =>
    options.toolResultsByCallId
      ? applyToolResultsToBlocks(blocks, options.toolResultsByCallId)
      : blocks

  if (previousBlocks.length === 0) return withToolResults(options.nextBlocks)

  const previousToolByCallId = new Map<string, ToolBlock>()
  previousBlocks.forEach((block) => {
    if (block.type === "tool" && block.callId) {
      previousToolByCallId.set(block.callId, block)
    }
  })

  const nextToolCallIds = new Set<string>()
  const mergedNextBlocks = options.nextBlocks.map((block, index) => {
    if (block.type === "tool" && block.callId) {
      nextToolCallIds.add(block.callId)
      const previousTool = previousToolByCallId.get(block.callId)
      if (previousTool) {
        return {
          ...block,
          renderKey: assistantBlockRenderKey(previousTool),
          category: block.category || previousTool.category,
          output: previousTool.output || block.output,
          details: previousTool.details ?? block.details,
          isError: previousTool.isError || block.isError,
          running: previousTool.running === false ? false : block.running,
        } satisfies ToolBlock
      }
    }

    const previousBlock = options.preserveBlockRenderKeysByIndex
      ? previousBlocks[index]
      : undefined
    if (previousBlock?.type === block.type) {
      return withAssistantBlockRenderKey(block, previousBlock)
    }

    return block
  })

  if (!options.preserveMissingTools) return withToolResults(mergedNextBlocks)

  const missingPreviousTools = previousBlocks
    .map((block, index) => ({ block, index }))
    .filter(
      (entry): entry is { block: ToolBlock; index: number } =>
        entry.block.type === "tool" &&
        Boolean(entry.block.callId) &&
        !nextToolCallIds.has(entry.block.callId || "")
    )

  if (missingPreviousTools.length === 0) {
    return withToolResults(mergedNextBlocks)
  }

  const blocks: Array<AssistantBlock> = []
  let missingIndex = 0
  for (let index = 0; index < mergedNextBlocks.length; index += 1) {
    while (
      missingIndex < missingPreviousTools.length &&
      missingPreviousTools[missingIndex].index <= index
    ) {
      blocks.push(missingPreviousTools[missingIndex].block)
      missingIndex += 1
    }
    blocks.push(mergedNextBlocks[index])
  }
  while (missingIndex < missingPreviousTools.length) {
    blocks.push(missingPreviousTools[missingIndex].block)
    missingIndex += 1
  }

  return withToolResults(blocks)
}

function mergeStreamingAssistantBlocks(options: {
  previousStreamingItem: AssistantItem | null
  nextBlocks: Array<AssistantBlock>
  toolResultsByCallId: Map<string, ToolResultUpdate>
}) {
  return mergeAssistantBlocksForStreaming({
    previousBlocks: options.previousStreamingItem?.blocks,
    nextBlocks: options.nextBlocks,
    toolResultsByCallId: options.toolResultsByCallId,
    preserveMissingTools: true,
  })
}

function appendAssistantItem(
  items: Array<ConversationItem>,
  item: AssistantItem
): AssistantItem {
  items.push(item)
  return item
}

function findStreamingAssistantItem(items: Array<ConversationItem>) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "assistant" && item.streaming) {
      return item
    }
  }

  return null
}

function isPendingConversationItem(item: ConversationItem) {
  return (
    item.kind === "user" &&
    (Boolean(item.pendingId) || item.itemKey?.startsWith("pending:"))
  )
}

function isOptimisticPendingConversationItem(item: ConversationItem) {
  return (
    item.kind === "user" && Boolean(item.pendingId?.startsWith("optimistic:"))
  )
}

function sameUserPromptBody(
  left: Extract<ConversationItem, { kind: "user" }>,
  right: Extract<ConversationItem, { kind: "user" }>
) {
  return left.text === right.text && samePromptImages(left.images, right.images)
}

function hasMatchingCommittedUserItem(
  candidate: Extract<ConversationItem, { kind: "user" }>,
  committedItems: Array<ConversationItem>,
  previousIndex: number
) {
  const startIndex = Math.max(0, previousIndex)

  for (let index = startIndex; index < committedItems.length; index += 1) {
    const item = committedItems[index]
    if (item?.kind !== "user") continue
    if (sameUserPromptBody(candidate, item)) return true
  }

  return false
}

function mergePendingItemsForSync(options: {
  previousItems: Array<ConversationItem>
  committedItems: Array<ConversationItem>
  preserveOptimisticItems: boolean
}) {
  if (!options.preserveOptimisticItems) return []

  const mergedPendingItems: Array<Extract<ConversationItem, { kind: "user" }>> =
    []

  for (const previousItem of pendingItemsFromPrevious(options.previousItems)) {
    const previousIndex = options.previousItems.indexOf(previousItem)

    if (
      hasMatchingCommittedUserItem(
        previousItem,
        options.committedItems,
        previousIndex
      )
    ) {
      continue
    }

    mergedPendingItems.push(previousItem)
  }

  return mergedPendingItems
}

function committedItemsFromPrevious(previousItems: Array<ConversationItem>) {
  return previousItems.filter((item) => {
    if (isPendingConversationItem(item) || isQueuedConversationItem(item)) {
      return false
    }

    return !(item.kind === "assistant" && item.streaming)
  })
}

function pendingItemsFromPrevious(previousItems: Array<ConversationItem>) {
  return previousItems.filter(
    (item): item is Extract<ConversationItem, { kind: "user" }> =>
      item.kind === "user" &&
      isOptimisticPendingConversationItem(item) &&
      !item.queued
  )
}

function isQueuedConversationItem(item: ConversationItem) {
  return item.kind === "user" && Boolean(item.queued)
}

function messageItemIndex(item: ConversationItem) {
  const match = item.itemKey?.match(/^message:(\d+)$/)
  if (!match) return -1
  return Number(match[1])
}

function nextMessageItemIndex(items: Array<ConversationItem>) {
  let maxIndex = -1
  for (const item of items) {
    maxIndex = Math.max(maxIndex, messageItemIndex(item))
  }
  return maxIndex + 1
}

function uniqueRenderKey(preferredKey: string, items: Array<ConversationItem>) {
  const existingRenderKeys = new Set(
    items.map((item) => conversationItemRenderKey(item)).filter(Boolean)
  )
  if (!existingRenderKeys.has(preferredKey)) return preferredKey

  let suffix = 1
  while (existingRenderKeys.has(`${preferredKey}:streaming:${suffix}`)) {
    suffix += 1
  }
  return `${preferredKey}:streaming:${suffix}`
}

function streamingAssistantRenderKey(options: {
  hasMessages: boolean
  messages: Array<SyncMessage>
  items: Array<ConversationItem>
  previousStreamingItem: ConversationItem | null
}) {
  const previousRenderKey = conversationItemRenderKey(
    options.previousStreamingItem || undefined
  )
  if (
    previousRenderKey &&
    !options.items.some(
      (item) => conversationItemRenderKey(item) === previousRenderKey
    )
  ) {
    return previousRenderKey
  }

  const optimisticUserCount = options.items.filter(
    (item) => item.kind === "user" && isOptimisticPendingConversationItem(item)
  ).length
  const baseMessageIndex = options.hasMessages
    ? options.messages.length
    : nextMessageItemIndex(options.items)
  const predictedAssistantIndex = baseMessageIndex + optimisticUserCount

  return uniqueRenderKey(
    `message:${Math.max(0, predictedAssistantIndex)}`,
    options.items
  )
}

function messageIsQueued(message: SyncMessage) {
  const metadata =
    message?.metadata && typeof message.metadata === "object"
      ? message.metadata
      : undefined

  return Boolean(message.queued || metadata?.queued)
}

function authoritativeItemsFromSync(sync: StateSyncPayload) {
  if (!Array.isArray(sync.items)) return null

  return sync.items.filter(
    (item): item is ConversationItem =>
      !isPendingConversationItem(item) && !isQueuedConversationItem(item)
  )
}

export function buildItemsFromSync(
  sync: StateSyncPayload,
  previousItems: Array<ConversationItem> = []
) {
  const authoritativeItems = authoritativeItemsFromSync(sync)
  const hasAuthoritativeItems = Array.isArray(authoritativeItems)
  const hasMessages = Array.isArray(sync.messages)
  const hasPendingUserMessages = Array.isArray(sync.pendingUserMessages)
  const hasStreamingMessageUpdate = Object.prototype.hasOwnProperty.call(
    sync,
    "streamingMessage"
  )
  const hasStreamingUpdate =
    typeof sync.streaming === "boolean" || hasStreamingMessageUpdate

  if (
    !hasAuthoritativeItems &&
    !hasMessages &&
    !hasPendingUserMessages &&
    !hasStreamingUpdate
  ) {
    return {
      items: previousItems,
      currentAssistantItem: findStreamingAssistantItem(previousItems),
    }
  }

  if (authoritativeItems) {
    const streamingItems = authoritativeItems.filter(
      (item) => item.kind === "assistant" && item.streaming
    )
    const items = authoritativeItems.filter(
      (item) => !(item.kind === "assistant" && item.streaming)
    )
    const preserveOptimisticItems =
      Boolean(sync.draft) ||
      streamingItems.length > 0 ||
      Boolean(sync.streaming)
    items.push(
      ...mergePendingItemsForSync({
        previousItems,
        committedItems: items,
        preserveOptimisticItems,
      })
    )
    items.push(...streamingItems)

    const reconciledItems = reconcileConversationItems(previousItems, items)
    return {
      items: reconciledItems,
      currentAssistantItem: findStreamingAssistantItem(reconciledItems),
    }
  }

  const items: Array<ConversationItem> = hasMessages
    ? []
    : committedItemsFromPrevious(previousItems)

  const toolResultsByCallId = new Map<string, ToolResultUpdate>()
  const messages = Array.isArray(sync.messages) ? sync.messages : []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const itemKey = `message:${index}`

    if (message.role === "user") {
      if (messageIsQueued(message)) continue

      items.push({
        kind: "user",
        itemKey,
        text: extractMessageText(message),
        images: extractMessageImages(message),
        streamingBehavior: normalizeStreamingBehavior(
          message.streamingBehavior ??
            message.deliverAs ??
            message?.metadata?.streamingBehavior ??
            message?.metadata?.deliverAs
        ),
      })
      continue
    }

    if (message.role === "assistant") {
      appendAssistantItem(items, {
        kind: "assistant",
        itemKey,
        blocks: assistantBlocksFromMessage(message, itemKey),
        streaming: false,
        ...assistantItemMetadataFromMessage(message),
      })
      continue
    }

    if (message.role === "compactionSummary") {
      items.push(
        createCompactionSummaryItem(
          message.summary,
          message.tokensBefore,
          itemKey
        )
      )
      continue
    }

    if (message.role === "toolResult") {
      const callId =
        typeof message.toolCallId === "string" ? message.toolCallId.trim() : ""
      const update = {
        output: extractMessageText(message),
        details: message.details,
        isError: Boolean(message.isError),
      } satisfies ToolResultUpdate

      if (callId) {
        toolResultsByCallId.set(callId, update)
      }
      mutateToolBlockInItems(items, callId, (block) => {
        block.output = update.output
        block.details = update.details
        block.isError = update.isError
        block.running = false
      })
    }
  }

  const previousStreamingItem = findStreamingAssistantItem(previousItems)
  const shouldRenderStreaming =
    typeof sync.streaming === "boolean"
      ? sync.streaming
      : sync.streamingMessage != null
        ? true
        : Boolean(previousStreamingItem)

  if (shouldRenderStreaming) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item?.kind !== "assistant") continue
      items[index] = { ...item, done: false }
      break
    }
  }

  const pendingItems = mergePendingItemsForSync({
    previousItems,
    committedItems: items,
    preserveOptimisticItems: Boolean(sync.draft) || shouldRenderStreaming,
  })
  items.push(...pendingItems)

  if (shouldRenderStreaming) {
    if (sync.streamingMessage?.role === "assistant") {
      const renderKey = streamingAssistantRenderKey({
        hasMessages,
        messages,
        items,
        previousStreamingItem,
      })
      items.push({
        kind: "assistant",
        itemKey: "streaming",
        renderKey,
        blocks: mergeStreamingAssistantBlocks({
          previousStreamingItem,
          nextBlocks: assistantBlocksFromMessage(
            sync.streamingMessage,
            renderKey
          ),
          toolResultsByCallId,
        }),
        streaming: true,
        done: false,
        ...assistantItemMetadataFromMessage(sync.streamingMessage),
      })
    } else if (previousStreamingItem && !hasStreamingMessageUpdate) {
      const blocks = applyToolResultsToBlocks(
        previousStreamingItem.blocks,
        toolResultsByCallId
      )
      items.push(
        blocks === previousStreamingItem.blocks
          ? previousStreamingItem
          : { ...previousStreamingItem, blocks }
      )
    } else {
      const renderKey = streamingAssistantRenderKey({
        hasMessages,
        messages,
        items,
        previousStreamingItem,
      })
      items.push({
        kind: "assistant",
        itemKey: "streaming",
        renderKey,
        blocks: mergeStreamingAssistantBlocks({
          previousStreamingItem,
          nextBlocks: [],
          toolResultsByCallId,
        }),
        streaming: true,
        done: false,
      })
    }
  }

  const reconciledItems = reconcileConversationItems(previousItems, items)

  return {
    items: reconciledItems,
    currentAssistantItem: findStreamingAssistantItem(reconciledItems),
  }
}

function sanitizeThinkingSummaryText(value: unknown) {
  if (typeof value !== "string") return ""

  let text = value.replace(/\r\n?/g, "\n")

  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, altText: string) => altText || "image"
  )
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1")
  text = text.replace(/```([\s\S]*?)```/g, "$1")
  text = text.replace(/`([^`]+)`/g, "$1")
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1")
  text = text.replace(/__([^_]+)__/g, "$1")
  text = text.replace(/\*([^*\n]+)\*/g, "$1")
  text = text.replace(/_([^_\n]+)_/g, "$1")
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "")
  text = text.replace(/^\s*>\s?/gm, "")
  text = text.replace(/^\s*[-*+]\s+/gm, "")
  text = text.replace(/^\s*\d+\.\s+/gm, "")
  text = text.replace(
    /\/var\/folders\/[^\s)]*\/pi-clipboard-[A-Za-z0-9-]+\.(?:png|jpe?g|gif|webp)\b/gi,
    "pasted image"
  )
  text = text.replace(/\s+/g, " ").trim()

  return text
}

function primaryThinkingSummaryText(value: unknown) {
  if (typeof value !== "string") return ""

  const normalized = value.replace(/\r\n?/g, "\n")
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((part) => sanitizeThinkingSummaryText(part))
    .filter(Boolean)

  if (paragraphs.length) {
    return paragraphs[0] || ""
  }

  return sanitizeThinkingSummaryText(normalized)
}

function meaningfulHiddenThinkingLabel(value: unknown) {
  const label = sanitizeThinkingSummaryText(value)
  return label && label !== "Thinking..." && label !== "Thinking"
    ? label
    : undefined
}

function truncateThinkingSummary(text: string, maxLength = 140) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function thinkingSummaryText(
  block:
    | Pick<
        Extract<AssistantBlock, { type: "thinking" }>,
        "text" | "summaryLabel"
      >
    | undefined,
  options: { allowPlaceholder?: boolean } = {}
) {
  const blockLabel = meaningfulHiddenThinkingLabel(block?.summaryLabel)
  if (blockLabel) return truncateThinkingSummary(blockLabel)

  const text = primaryThinkingSummaryText(block?.text)
  if (!text) return options.allowPlaceholder ? "Thinking…" : ""
  return truncateThinkingSummary(text)
}

export function createInitialSessionState(): SessionState {
  return {
    connected: false,
    replaying: false,
    streaming: false,
    compacting: false,
    draft: true,
    messages: [],
    items: [],
    historyOffset: 0,
    historyTotalCount: 0,
    firstMessage: "",
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    availableModels: [],
    availableSkills: [],
    hideThinkingBlock: false,
    contextUsage: undefined,
    uiState: {
      statuses: {},
      editorText: "",
    },
  }
}
