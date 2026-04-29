import type {
  AssistantBlock,
  AssistantItem,
  ConversationItem,
  MessagePayload,
  ToolBlock,
} from "@/lib/phi"
import {
  assistantBlocksFromMessage,
  buildItemsFromSync,
  extractMessageImages,
  extractMessageText,
  extractToolText,
} from "@/lib/phi/sync"

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

  if (
    blocks.some(
      (block) => block.type === "text" && block.text.trim() === stopMessage
    )
  ) {
    return blocks
  }

  return [
    ...blocks,
    {
      type: "text",
      blockKey: `${renderKey}:aborted`,
      text: stopMessage,
    } satisfies AssistantBlock,
  ]
}

function blockRenderKey(block: AssistantBlock | undefined) {
  return block?.renderKey || block?.blockKey
}

function mergeRetainedBlocks(
  previousBlocks: Array<AssistantBlock>,
  nextBlocks: Array<AssistantBlock>
) {
  const previousToolByCallId = new Map<string, ToolBlock>()
  previousBlocks.forEach((block) => {
    if (block.type === "tool" && block.callId) {
      previousToolByCallId.set(block.callId, block)
    }
  })

  return nextBlocks.map((block, index) => {
    if (block.type === "tool" && block.callId) {
      const previousTool = previousToolByCallId.get(block.callId)
      if (previousTool) {
        return {
          ...block,
          renderKey: blockRenderKey(previousTool),
          output: previousTool.output || block.output,
          details: previousTool.details ?? block.details,
          isError: previousTool.isError || block.isError,
          running: previousTool.running === false ? false : block.running,
        } satisfies ToolBlock
      }
    }

    const previousBlock = previousBlocks[index]
    if (previousBlock?.type === block.type) {
      return {
        ...block,
        renderKey: blockRenderKey(previousBlock),
      } satisfies AssistantBlock
    }

    return block
  })
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
  const blocks = mergeRetainedBlocks(
    item.blocks,
    assistantBlocksFromMessage(message, renderKey)
  )
  const nextItem = {
    ...item,
    renderKey,
    blocks,
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
      return {
        ...previous,
        name: block.name || previous.name,
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
  return {
    type: "tool",
    blockKey: `${renderKey}:tool:${callId}`,
    renderKey: `${renderKey}:tool:${callId}`,
    callId,
    ...(typeof event.toolName === "string" ? { name: event.toolName } : {}),
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
  const blocks = mergeRetainedBlocks(
    streamingItem?.blocks ?? [],
    assistantBlocksFromMessage(message, renderKey)
  )
  const finalizedItem = {
    kind: "assistant",
    itemKey,
    renderKey,
    blocks,
    streaming: false,
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
    if (!item) return

    const abortedMessage = abortedAssistantMessage(event)
    if (abortedMessage) {
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
        },
      ]
      return
    }

    if (item.blocks.length === 0) {
      state.items = removeStreamingAssistantItem(state.items)
    }
  }
}
