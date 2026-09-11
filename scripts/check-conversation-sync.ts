import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  createInitialSessionState,
  type ConversationDeltaEvent,
} from "@/lib/pico"
import { applyConversationDelta } from "@/lib/pico/sync"
import { updateStateFromSync } from "@/features/pico/app-shell-utils"
import { createConversationItemsStore } from "@/features/pico/app-shell-conversation-store"

const delta = JSON.parse(
  readFileSync(
    new URL(
      "../apps/apple/Fixtures/conversation_delta_operations.json",
      import.meta.url
    ),
    "utf8"
  )
) as ConversationDeltaEvent
let state = createInitialSessionState()
const store = createConversationItemsStore([])
const checkStore = () => {
  store.setItems(state.items)
  assert.equal(
    store.getSnapshot().itemByKey.size,
    state.items.length,
    "render keys must be unique across turns"
  )
  for (const item of state.items) {
    const key = item.renderKey || item.itemKey || ""
    assert.equal(
      store.getItem(key),
      item,
      "old rows must not read the current reply"
    )
  }
}
for (let turn = 0; turn < 3; turn++) {
  state = updateStateFromSync(state, {
    type: "state_sync",
    items: [
      ...state.items,
      {
        kind: "user",
        itemKey: `user:${turn}`,
        text: `prompt ${turn}`,
        images: [],
      },
    ],
    streaming: true,
  })
  const oldItems = state.items.slice()
  let liveKey: string | undefined
  for (const operation of delta.operations) {
    state = {
      ...state,
      items: applyConversationDelta(state.items, {
        ...delta,
        operations: [operation],
      }),
    }
    checkStore()
    const current = state.items.at(-1)!
    liveKey ??= current.renderKey
    assert.equal(
      current.renderKey,
      liveKey,
      "replaceItem must preserve the current turn's key"
    )
    assert.equal(current.kind, "assistant")
    if (current.kind === "assistant") {
      assert(
        current.blocks.every((block) => block.type === "text"),
        "text deltas must never render as thinking"
      )
      if (operation.op === "appendBlock")
        assert.equal(
          current.blocks[0]?.type === "text" && current.blocks[0].text,
          "Hello"
        )
    }
    for (let i = 0; i < oldItems.length; i++)
      assert.equal(state.items[i], oldItems[i])
  }
  // Snapshots can also contain the server's reusable streaming render key.
  const current = state.items.at(-1)!
  state = updateStateFromSync(state, {
    type: "state_sync",
    items: [...oldItems, { ...current, renderKey: "streaming" }],
    streaming: true,
  })
  checkStore()
  assert.equal(state.items.at(-1)?.renderKey, liveKey)
  state = updateStateFromSync(state, {
    type: "state_sync",
    items: [
      ...oldItems,
      {
        kind: "assistant",
        itemKey: `saved:${turn}`,
        blocks: [
          { type: "text", blockKey: `saved-text:${turn}`, text: "Hello!" },
        ],
        streaming: false,
      },
    ],
    streaming: false,
  })
  checkStore()
  assert.equal(
    state.items.at(-1)?.renderKey,
    liveKey,
    "finalization must retain the live row"
  )
}
console.log(
  "Conversation sync: three turns have unique rows, stable keys, and text-only streaming"
)

for (const streaming of [true, false]) {
  state = updateStateFromSync(createInitialSessionState(), {
    type: "state_sync",
    sessionKey: "session:thinking-toggle",
    streaming,
    items: [
      { kind: "user", itemKey: "prompt", text: "hello", images: [] },
      {
        kind: "assistant",
        itemKey: "reply",
        streaming,
        done: !streaming,
        blocks: [
          {
            type: "thinking",
            blockKey: "thought",
            text: "Checking the toggle",
          },
          { type: "text", blockKey: "answer", text: "Hello" },
        ],
      },
    ],
  })
  for (const hideThinkingBlock of [true, false]) {
    const previous = state
    state = updateStateFromSync(state, {
      type: "state_sync",
      hideThinkingBlock,
    })
    assert.equal(state.hideThinkingBlock, hideThinkingBlock)
    assert.equal(state.streaming, streaming)
    assert.equal(state.items, previous.items)
    assert.equal(state.sessionKey, previous.sessionKey)
    assert.equal(
      state.hiddenThinkingPreview,
      streaming && hideThinkingBlock ? "Checking the toggle" : undefined
    )
  }
}
console.log(
  "Thinking visibility patches preserve conversation and streaming state"
)
