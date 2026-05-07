import type {
  AssistantBlock,
  AssistantItem,
  ConversationItem,
  MessagePayload,
  ToolBlock,
} from "@/lib/pico"
import {
  assistantBlocksFromMessage,
  buildItemsFromSync,
  extractMessageImages,
  extractMessageText,
  extractToolText,
  mergeAssistantBlocksForStreaming,
} from "@/lib/pico/sync"
import { toolCategoryFromTool } from "@/lib/pico/tool-classification"

type RetainedConversationState = {
  items: Array<ConversationItem>
}

type RetainedSessionEvent = {
  type?: unknown
  message?: MessagePayload
  messages?: Array<MessagePayload>
  toolCallId?: unknown
  toolName?: unknown
  args?: unknown
  partialResult?: unknown
  result?: unknown
  isError?: unknown
}

function messageItemIndex(item: ConversationItem) {
  const match = item.itemKey?.match(/^message:(\d+)$/)
  if (!match) return -1
  return Number(match[1])
}

function nextMessageItemKey(items: Array<ConversationItem>) {
  let maxIndex = -1
  for (const item of items) {
    if (item.kind === "assistant" && item.streaming) continue
    maxIndex = Math.max(maxIndex, messageItemIndex(item))
  }

  return `message:${maxIndex + 1}`
}

function removeStreamingAssistantItem(items: Array<ConversationItem>) {
  return items.filter(
    (item) => !(item.kind === "assistant" && Boolean(item.streaming))
  )
}

function streamingAssistantItem(items: Array<ConversationItem>) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "assistant" && item.streaming) return item
  }

  return undefined
}

function abortedAssistantMessage(event: RetainedSessionEvent) {
  const messages = Array.isArray(event.messages) ? event.messages : []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "assistant") continue
    return message.stopReason === "aborted" ? message : undefined
  }

  return event.message?.role === "assistant" &&
    event.message.stopReason === "aborted"
    ? event.message
    : undefined
}

function abortedAssistantStopMessage(message: MessagePayload | undefined) {
  const errorMessage =
    typeof message?.errorMessage === "string" ? message.errorMessage.trim() : ""
  return errorMessage && errorMessage !== "Request was aborted"
    ? errorMessage
    : "Operation aborted"
}

function assistantModelFromMessage(message: MessagePayload | undefined) {
  const id = typeof message?.model === "string" ? message.model.trim() : ""
  if (!id) return undefined

  const provider =
    typeof message?.provider === "string" ? message.provider.trim() : ""

  return {
    id,
    ...(provider ? { provider } : {}),
  } satisfies AssistantItem["model"]
}

function assistantMetadataFromMessage(message: MessagePayload | undefined) {
  const model = assistantModelFromMessage(message)

  return (model ? { model } : {}) satisfies Partial<AssistantItem>
}

function applyAbortedStopToBlocks(
  blocks: Array<AssistantBlock>,
  renderKey: string,
  stopMessage: string
) {
  if (blocks.some((block) => block.type === "tool")) {
    return blocks.map((block) => {
      if (block.type !== "tool" || block.output.trim()) return block
      return {
        ...block,
        output: stopMessage,
        isError: true,
        running: false,
      } satisfies ToolBlock
    })
  }

  let changed = false
  let matched = false
  const nextBlocks = blocks.map((block) => {
    if (block.type !== "text" || block.text.trim() !== stopMessage) {
      return block
    }

    matched = true
    if (block.isError) return block

    changed = true
    return { ...block, isError: true } satisfies AssistantBlock
  })

  if (matched) {
    return changed ? nextBlocks : blocks
  }

  return [
    ...blocks,
    {
      type: "text",
      blockKey: `${renderKey}:aborted`,
      text: stopMessage,
      isError: true,
    } satisfies AssistantBlock,
  ]
}

function ensureStreamingAssistant(state: RetainedConversationState) {
  const existing = streamingAssistantItem(state.items)
  if (existing) return existing

  const renderKey = nextMessageItemKey(state.items)
  const item = {
    kind: "assistant",
    itemKey: "streaming",
    renderKey,
    blocks: [],
    streaming: true,
    done: false,
  } satisfies AssistantItem
  state.items = [...state.items, item]
  return item
}

function updateStreamingAssistantFromMessage(
  state: RetainedConversationState,
  message: MessagePayload | undefined
) {
  if (message?.role !== "assistant") return

  const item = ensureStreamingAssistant(state)
  const renderKey = item.renderKey || nextMessageItemKey(state.items)
  const blocks = mergeAssistantBlocksForStreaming({
    previousBlocks: item.blocks,
    nextBlocks: assistantBlocksFromMessage(message, renderKey),
    preserveMissingTools: true,
    preserveBlockRenderKeysByIndex: true,
  })
  const nextItem = {
    ...item,
    renderKey,
    blocks,
    ...assistantMetadataFromMessage(message),
  } satisfies AssistantItem

  state.items = state.items.map((entry) => (entry === item ? nextItem : entry))
}

function updateToolBlock(
  state: RetainedConversationState,
  callId: string,
  update: (block: ToolBlock) => ToolBlock
) {
  for (let itemIndex = state.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = state.items[itemIndex]
    if (item?.kind !== "assistant") continue

    const blockIndex = item.blocks.findIndex(
      (block) => block.type === "tool" && block.callId === callId
    )
    if (blockIndex < 0) continue

    const block = item.blocks[blockIndex]
    if (block?.type !== "tool") return

    const nextBlocks = [...item.blocks]
    nextBlocks[blockIndex] = update(block)
    const nextItem = { ...item, blocks: nextBlocks } satisfies AssistantItem
    const nextItems = [...state.items]
    nextItems[itemIndex] = nextItem
    state.items = nextItems
    return
  }
}

function appendToolBlockToStreamingAssistant(
  state: RetainedConversationState,
  block: ToolBlock
) {
  const item = ensureStreamingAssistant(state)
  const nextItem = {
    ...item,
    blocks: [...item.blocks, block],
  } satisfies AssistantItem
  state.items = state.items.map((entry) => (entry === item ? nextItem : entry))
}

function upsertToolBlock(state: RetainedConversationState, block: ToolBlock) {
  if (block.callId) {
    let updated = false
    updateToolBlock(state, block.callId, (previous) => {
      updated = true
      const name = block.name || previous.name
      const category =
        block.category ||
        previous.category ||
        toolCategoryFromTool(name, block.args)
      return {
        ...previous,
        name,
        ...(category ? { category } : {}),
        args: block.args,
        running: true,
      }
    })
    if (updated) return
  }

  appendToolBlockToStreamingAssistant(state, block)
}

function retainedToolBlockFromEvent(
  state: RetainedConversationState,
  event: RetainedSessionEvent
) {
  const callId = typeof event.toolCallId === "string" ? event.toolCallId : ""
  if (!callId) return undefined

  const renderKey =
    streamingAssistantItem(state.items)?.renderKey || "streaming"
  const toolName =
    typeof event.toolName === "string" ? event.toolName : undefined
  const category = toolCategoryFromTool(toolName, event.args)

  return {
    type: "tool",
    blockKey: `${renderKey}:tool:${callId}`,
    renderKey: `${renderKey}:tool:${callId}`,
    callId,
    ...(toolName ? { name: toolName } : {}),
    ...(category ? { category } : {}),
    args: event.args,
    output: "",
    details: undefined,
    isError: false,
    running: true,
  } satisfies ToolBlock
}

function textFromToolResultPayload(value: unknown) {
  if (!value || typeof value !== "object") return ""
  return extractToolText(
    value as { content?: Array<{ type?: unknown; text?: unknown }> }
  )
}

function detailsFromToolResultPayload(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  if (!Object.prototype.hasOwnProperty.call(value, "details")) return undefined
  return (value as { details?: unknown }).details
}

function applyToolResult(
  state: RetainedConversationState,
  callId: string,
  result: unknown,
  isError: boolean
) {
  updateToolBlock(state, callId, (block) => ({
    ...block,
    output: textFromToolResultPayload(result),
    details: detailsFromToolResultPayload(result),
    isError,
    running: false,
  }))
}

function appendCommittedMessage(
  state: RetainedConversationState,
  message: MessagePayload
) {
  const itemKey = nextMessageItemKey(state.items)

  if (message.role === "user") {
    state.items = [
      ...state.items,
      {
        kind: "user",
        itemKey,
        text: extractMessageText(message),
        images: extractMessageImages(message),
      },
    ]
    return
  }

  if (message.role === "toolResult") {
    const callId =
      typeof message.toolCallId === "string" ? message.toolCallId : ""
    if (callId) {
      applyToolResult(state, callId, message, Boolean(message.isError))
    }
    return
  }

  if (message.role !== "assistant") return

  const streamingItem = streamingAssistantItem(state.items)
  const renderKey = streamingItem?.renderKey || itemKey
  const blocks = mergeAssistantBlocksForStreaming({
    previousBlocks: streamingItem?.blocks,
    nextBlocks: assistantBlocksFromMessage(message, renderKey),
    preserveBlockRenderKeysByIndex: true,
  })
  const finalizedItem = {
    kind: "assistant",
    itemKey,
    renderKey,
    blocks,
    streaming: false,
    done: false,
    ...(streamingItem?.model ? { model: streamingItem.model } : {}),
    ...assistantMetadataFromMessage(message),
  } satisfies AssistantItem

  state.items = [...removeStreamingAssistantItem(state.items), finalizedItem]
}

export function createRetainedConversationState(
  messages: Array<MessagePayload>
): RetainedConversationState {
  return buildItemsFromSync({
    type: "state_sync",
    messages,
    streaming: false,
  })
}

export function applyRetainedConversationEvent(
  state: RetainedConversationState,
  event: RetainedSessionEvent
) {
  const type = typeof event.type === "string" ? event.type : ""
  const message = event.message

  if (type === "message_start" && message?.role === "assistant") {
    updateStreamingAssistantFromMessage(state, message)
    return
  }

  if (type === "message_update" && message?.role === "assistant") {
    updateStreamingAssistantFromMessage(state, message)
    return
  }

  if (type === "message_end" && message) {
    appendCommittedMessage(state, message)
    return
  }

  if (type === "tool_execution_start") {
    const block = retainedToolBlockFromEvent(state, event)
    if (block) upsertToolBlock(state, block)
    return
  }

  if (type === "tool_execution_update") {
    const callId = typeof event.toolCallId === "string" ? event.toolCallId : ""
    if (!callId) return
    updateToolBlock(state, callId, (block) => ({
      ...block,
      output: textFromToolResultPayload(event.partialResult),
      details: detailsFromToolResultPayload(event.partialResult),
      isError: false,
      running: true,
    }))
    return
  }

  if (type === "tool_execution_end") {
    const callId = typeof event.toolCallId === "string" ? event.toolCallId : ""
    if (!callId) return
    applyToolResult(state, callId, event.result, Boolean(event.isError))
    return
  }

  if (type === "agent_end") {
    const item = streamingAssistantItem(state.items)
    const abortedMessage = abortedAssistantMessage(event)

    if (abortedMessage && item) {
      const itemKey = nextMessageItemKey(state.items)
      const renderKey = item.renderKey || itemKey
      state.items = [
        ...removeStreamingAssistantItem(state.items),
        {
          kind: "assistant",
          itemKey,
          renderKey,
          blocks: applyAbortedStopToBlocks(
            item.blocks,
            renderKey,
            abortedAssistantStopMessage(abortedMessage)
          ),
          streaming: false,
          done: true,
          ...(item.model ? { model: item.model } : {}),
          ...assistantMetadataFromMessage(abortedMessage),
        },
      ]
      return
    }

    state.items = state.items
      .filter(
        (entry) =>
          !(
            entry.kind === "assistant" &&
            entry.streaming &&
            entry.blocks.length === 0
          )
      )
      .map((entry) => {
        if (entry.kind !== "assistant") return entry
        if (!entry.streaming && entry.done !== false) return entry

        return {
          ...entry,
          streaming: false,
          done: true,
          blocks: entry.blocks.map((block) =>
            block.type === "tool" && block.running
              ? { ...block, running: false }
              : block
          ),
        } satisfies AssistantItem
      })
  }
}
