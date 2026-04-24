import type {
  AssistantBlock,
  AssistantItem,
  ConversationItem,
  PromptImage,
  SessionState,
  StateSyncPayload,
  StreamingBehavior,
  ToolBlock,
} from "@/lib/pi-web"

type MessageContentPart = {
  type?: unknown
  text?: unknown
  thinking?: unknown
  id?: unknown
  name?: unknown
  arguments?: unknown
}

type SyncMessage = NonNullable<StateSyncPayload["messages"]>[number]

type PendingSyncMessage = NonNullable<
  StateSyncPayload["pendingUserMessages"]
>[number]

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
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n")
}

export function extractToolText(
  result: { content?: Array<MessageContentPart> } | undefined
) {
  if (!result || !Array.isArray(result.content)) return ""

  return result.content
    .filter(
      (part): part is MessageContentPart & { text: string } =>
        part?.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
}

export function extractMessageImages(message: { content?: unknown }) {
  if (!Array.isArray(message?.content)) return []

  return message.content
    .filter((part) => part?.type === "image")
    .map((part) => normalizePromptImage(part))
    .filter((part): part is PromptImage => Boolean(part))
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

function sameUserMessageContent(
  left: Extract<ConversationItem, { kind: "user" }>,
  right: Extract<ConversationItem, { kind: "user" }>
) {
  return (
    (left.itemKey || "") === (right.itemKey || "") &&
    left.text === right.text &&
    samePromptImages(left.images, right.images) &&
    Boolean(left.queued) === Boolean(right.queued) &&
    left.streamingBehavior === right.streamingBehavior
  )
}

function sameAssistantBlock(left: AssistantBlock, right: AssistantBlock) {
  if (!left || !right || left.type !== right.type) return false
  if ((left.blockKey || "") !== (right.blockKey || "")) return false

  switch (left.type) {
    case "text":
      return right.type === "text" && left.text === right.text
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

function reconcileAssistantBlocks(
  previousBlocks: Array<AssistantBlock>,
  nextBlocks: Array<AssistantBlock>
) {
  if (previousBlocks.length !== nextBlocks.length) {
    return nextBlocks
  }

  let changed = false
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
    reconciled.push(nextBlock)
  }

  return changed ? reconciled : previousBlocks
}

export function reconcileConversationItems(
  previousItems: Array<ConversationItem>,
  nextItems: Array<ConversationItem>
) {
  if (previousItems.length === 0) return nextItems

  const previousItemsByKey = new Map<string, ConversationItem>()
  for (const item of previousItems) {
    if (!item.itemKey || previousItemsByKey.has(item.itemKey)) continue
    previousItemsByKey.set(item.itemKey, item)
  }

  let changed = previousItems.length !== nextItems.length
  const reconciled: Array<ConversationItem> = []

  for (let index = 0; index < nextItems.length; index += 1) {
    const nextItem = nextItems[index]
    const previousItem =
      (nextItem.itemKey
        ? previousItemsByKey.get(nextItem.itemKey)
        : undefined) || previousItems[index]

    if (!previousItem || previousItem.kind !== nextItem.kind) {
      changed = true
      reconciled.push(nextItem)
      continue
    }

    if (sameStateItem(previousItem, nextItem)) {
      reconciled.push(previousItem)
      continue
    }

    if (previousItem.kind === "assistant" && nextItem.kind === "assistant") {
      const blocks = reconcileAssistantBlocks(
        previousItem.blocks,
        nextItem.blocks
      )

      if (
        (previousItem.itemKey || "") === (nextItem.itemKey || "") &&
        blocks === previousItem.blocks &&
        Boolean(previousItem.streaming) === Boolean(nextItem.streaming)
      ) {
        reconciled.push(previousItem)
        continue
      }

      changed = true
      reconciled.push(
        blocks === nextItem.blocks ? nextItem : { ...nextItem, blocks }
      )
      continue
    }

    changed = true
    reconciled.push(nextItem)
  }

  return changed ? reconciled : previousItems
}

export function assistantBlocksFromMessage(
  message: SyncMessage | undefined,
  keyPrefix = "assistant"
) {
  const blocks: Array<AssistantBlock> = []
  const content = Array.isArray(message?.content) ? message.content : []

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
        })
      }
    }

    if (part?.type === "toolCall") {
      blocks.push({
        type: "tool",
        blockKey:
          typeof part.id === "string" && part.id.trim()
            ? `${keyPrefix}:tool:${part.id}`
            : `${partKey}:tool`,
        callId: part.id,
        name: part.name,
        args: part.arguments,
        output: "",
        details: undefined,
        isError: false,
        running: true,
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

function promptImagesFromPendingMessage(message: PendingSyncMessage) {
  return Array.isArray(message?.images)
    ? message.images
        .map((image: unknown) => normalizePromptImage(image))
        .filter((image: PromptImage | null): image is PromptImage =>
          Boolean(image)
        )
    : []
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

function committedItemsFromPrevious(previousItems: Array<ConversationItem>) {
  return previousItems.filter((item) => {
    if (isPendingConversationItem(item)) {
      return false
    }

    return !(item.kind === "assistant" && item.streaming)
  })
}

function pendingItemsFromPrevious(previousItems: Array<ConversationItem>) {
  return previousItems.filter((item) => isPendingConversationItem(item))
}

function committedItemsFromSync(sync: StateSyncPayload) {
  if (Array.isArray(sync.items)) {
    return sync.items.filter(
      (item): item is ConversationItem =>
        !isPendingConversationItem(item) &&
        !(item.kind === "assistant" && item.streaming)
    )
  }

  return null
}

export function buildItemsFromSync(
  sync: StateSyncPayload,
  previousItems: Array<ConversationItem> = []
) {
  const nextCommittedItems = committedItemsFromSync(sync)
  const hasCommittedItems = Array.isArray(nextCommittedItems)
  const hasMessages = Array.isArray(sync.messages)
  const hasPendingUserMessages = Array.isArray(sync.pendingUserMessages)
  const hasStreamingUpdate =
    typeof sync.streaming === "boolean" ||
    Object.prototype.hasOwnProperty.call(sync, "streamingMessage")

  if (
    !hasCommittedItems &&
    !hasMessages &&
    !hasPendingUserMessages &&
    !hasStreamingUpdate
  ) {
    return {
      items: previousItems,
      currentAssistantItem: findStreamingAssistantItem(previousItems),
    }
  }

  const items: Array<ConversationItem> =
    hasCommittedItems || hasMessages
      ? []
      : committedItemsFromPrevious(previousItems)

  if (nextCommittedItems) {
    items.push(...nextCommittedItems)
  }

  const messages = Array.isArray(sync.messages) ? sync.messages : []
  for (
    let index = 0;
    index < messages.length && !nextCommittedItems;
    index += 1
  ) {
    const message = messages[index]
    const itemKey = `message:${index}`

    if (message.role === "user") {
      items.push({
        kind: "user",
        itemKey,
        text: extractMessageText(message),
        images: extractMessageImages(message),
        queued: Boolean(message.queued ?? message?.metadata?.queued),
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
      mutateToolBlockInItems(
        items,
        typeof message.toolCallId === "string" ? message.toolCallId : undefined,
        (block) => {
          block.output = extractMessageText(message)
          block.details = message.details
          block.isError = Boolean(message.isError)
          block.running = false
        }
      )
    }
  }

  if (hasPendingUserMessages) {
    const pendingItems = sync.pendingUserMessages ?? []

    for (let index = 0; index < pendingItems.length; index += 1) {
      const message = pendingItems[index]
      const pendingId =
        typeof message?.pendingId === "string" ? message.pendingId : undefined

      items.push({
        kind: "user",
        itemKey: pendingId ? `pending:${pendingId}` : `pending:${index}`,
        pendingId,
        text: typeof message?.text === "string" ? message.text : "",
        images: promptImagesFromPendingMessage(message),
        queued: Boolean(message?.queued ?? true),
        streamingBehavior: normalizeStreamingBehavior(
          message?.streamingBehavior
        ),
      })
    }
  } else {
    for (const item of pendingItemsFromPrevious(previousItems)) {
      items.push(item)
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
    if (sync.streamingMessage?.role === "assistant") {
      items.push({
        kind: "assistant",
        itemKey: "streaming",
        blocks: assistantBlocksFromMessage(sync.streamingMessage, "streaming"),
        streaming: true,
      })
    } else if (!hasStreamingUpdate && previousStreamingItem) {
      items.push(previousStreamingItem)
    } else {
      items.push({
        kind: "assistant",
        itemKey: "streaming",
        blocks: [],
        streaming: true,
      })
    }
  }

  const reconciledItems = reconcileConversationItems(previousItems, items)

  return {
    items: reconciledItems,
    currentAssistantItem: findStreamingAssistantItem(reconciledItems),
  }
}

export function meaningfulHiddenThinkingLabel(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function truncateThinkingSummary(text: string, maxLength = 140) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function createInitialSessionState(): SessionState {
  return {
    connected: false,
    replaying: false,
    streaming: false,
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
