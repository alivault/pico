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

export function assistantBlocksFromMessage(message: SyncMessage | undefined) {
  const blocks: Array<AssistantBlock> = []
  const content = Array.isArray(message?.content) ? message.content : []

  for (const part of content) {
    if (part?.type === "text") {
      blocks.push({ type: "text", text: part.text || "" })
    }

    if (part?.type === "thinking") {
      const thinkingText = part.thinking || ""
      if (thinkingText.trim()) {
        blocks.push({ type: "thinking", text: thinkingText })
      }
    }

    if (part?.type === "toolCall") {
      blocks.push({
        type: "tool",
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
  tokensBefore: unknown
) {
  return {
    kind: "assistant",
    blocks: [
      {
        type: "compaction",
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

export function buildItemsFromSync(sync: StateSyncPayload) {
  const items: Array<ConversationItem> = []
  let streamingAssistantItem: AssistantItem | null = null

  const messages = Array.isArray(sync.messages) ? sync.messages : []
  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        kind: "user",
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
      items.push({
        kind: "assistant",
        blocks: assistantBlocksFromMessage(message),
        streaming: false,
      })
      continue
    }

    if (message.role === "compactionSummary") {
      items.push(
        createCompactionSummaryItem(message.summary, message.tokensBefore)
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

  const pendingUserMessages = Array.isArray(sync.pendingUserMessages)
    ? sync.pendingUserMessages
    : []
  for (const message of pendingUserMessages) {
    items.push({
      kind: "user",
      pendingId:
        typeof message?.pendingId === "string" ? message.pendingId : undefined,
      text: typeof message?.text === "string" ? message.text : "",
      images: promptImagesFromPendingMessage(message),
      queued: Boolean(message?.queued ?? true),
      streamingBehavior: normalizeStreamingBehavior(message?.streamingBehavior),
    })
  }

  if (sync.streaming && sync.streamingMessage?.role === "assistant") {
    streamingAssistantItem = {
      kind: "assistant",
      blocks: assistantBlocksFromMessage(sync.streamingMessage),
      streaming: true,
    }
    items.push(streamingAssistantItem)
  } else if (sync.streaming) {
    streamingAssistantItem = {
      kind: "assistant",
      blocks: [],
      streaming: true,
    }
    items.push(streamingAssistantItem)
  }

  return { items, currentAssistantItem: streamingAssistantItem }
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
    items: [],
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
