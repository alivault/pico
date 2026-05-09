import * as React from "react"

import type { ConversationItem } from "@/lib/pico"
import {
  assistantMessageHasFooterMeta,
  assistantMessageHasVisibleBlocks,
  type AssistantMessagesSnapshot,
  type AssistantMessagesStore,
} from "@/features/pico/conversation-view"
import { sameStringArray } from "@/features/pico/app-shell-common"

type AssistantConversationItem = Extract<
  ConversationItem,
  { kind: "assistant" }
>

export type RenderConversationGroupDescriptor =
  | {
      kind: "user"
      key: string
      itemKey: string
    }
  | {
      kind: "assistant"
      key: string
      itemKeys: Array<string>
    }

function conversationItemKey(item: ConversationItem, index: number) {
  return item.renderKey || item.itemKey || `message-row:${index}`
}

function groupConversationItemsForRender(options: {
  items: Array<ConversationItem>
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const groups: Array<RenderConversationGroupDescriptor> = []
  let pendingAssistantGroup: Extract<
    RenderConversationGroupDescriptor,
    { kind: "assistant" }
  > | null = null
  let pendingAssistantVisible = false

  const flushAssistantGroup = () => {
    if (!pendingAssistantGroup) {
      pendingAssistantVisible = false
      return
    }

    if (pendingAssistantVisible) {
      groups.push(pendingAssistantGroup)
    }

    pendingAssistantGroup = null
    pendingAssistantVisible = false
  }

  options.items.forEach((item, index) => {
    const key = conversationItemKey(item, index)

    if (item.kind === "assistant") {
      if (!pendingAssistantGroup) {
        pendingAssistantGroup = {
          kind: "assistant",
          key,
          itemKeys: [],
        }
      }

      pendingAssistantGroup.itemKeys.push(key)
      pendingAssistantVisible ||=
        (!options.hideFooter && assistantMessageHasFooterMeta(item)) ||
        assistantMessageHasVisibleBlocks({
          item,
          hideThinking: options.hideThinking,
          hideToolBlocks: options.hideToolBlocks,
        })
      return
    }

    flushAssistantGroup()
    groups.push({
      kind: "user",
      key,
      itemKey: key,
    })
  })

  flushAssistantGroup()
  return groups
}

function sameRenderConversationGroupDescriptor(
  left: RenderConversationGroupDescriptor,
  right: RenderConversationGroupDescriptor
) {
  if (left.kind !== right.kind || left.key !== right.key) return false

  if (left.kind === "user" && right.kind === "user") {
    return left.itemKey === right.itemKey
  }

  if (left.kind !== "assistant" || right.kind !== "assistant") {
    return false
  }

  return true
}

function reconcileRenderConversationGroupDescriptors(
  previousGroups: Array<RenderConversationGroupDescriptor>,
  nextGroups: Array<RenderConversationGroupDescriptor>
) {
  if (previousGroups.length === 0) return nextGroups

  let changed = previousGroups.length !== nextGroups.length
  const groups: Array<RenderConversationGroupDescriptor> = []

  for (let index = 0; index < nextGroups.length; index += 1) {
    const nextGroup = nextGroups[index]
    const previousGroup = previousGroups[index]

    if (
      previousGroup &&
      sameRenderConversationGroupDescriptor(previousGroup, nextGroup)
    ) {
      groups.push(previousGroup)
      continue
    }

    changed = true
    groups.push(nextGroup)
  }

  return changed ? groups : previousGroups
}

type ConversationItemsSnapshot = {
  items: Array<ConversationItem>
  itemByKey: Map<string, ConversationItem>
  revision: number
}

type ConversationGroupSubscription = {
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  groups: Array<RenderConversationGroupDescriptor>
  listener: () => void
}

type ConversationAssistantGroupItemsSubscription = {
  groupKey: string
  itemKeys: Array<string>
  listener: () => void
}

export type ConversationItemsStore = {
  getSnapshot: () => ConversationItemsSnapshot
  getAssistantGroupItemKeys: (groupKey: string) => Array<string>
  getItem: (key: string) => ConversationItem | undefined
  setItems: (items: Array<ConversationItem>) => void
  subscribe: (listener: () => void) => () => void
  subscribeGroups: (options: {
    hideFooter: boolean
    hideThinking: boolean
    hideToolBlocks: boolean
    groups: Array<RenderConversationGroupDescriptor>
    listener: () => void
  }) => () => void
  subscribeAssistantGroupItems: (
    groupKey: string,
    listener: () => void
  ) => () => void
  subscribeItems: (keys: Array<string>, listener: () => void) => () => void
}

function buildConversationItemMap(items: Array<ConversationItem>) {
  const itemByKey = new Map<string, ConversationItem>()
  items.forEach((item, index) => {
    itemByKey.set(conversationItemKey(item, index), item)
  })
  return itemByKey
}

export function createConversationItemsStore(
  initialItems: Array<ConversationItem>
): ConversationItemsStore {
  let snapshot: ConversationItemsSnapshot = {
    items: initialItems,
    itemByKey: buildConversationItemMap(initialItems),
    revision: 0,
  }
  const listeners = new Set<() => void>()
  const itemListeners = new Map<string, Set<() => void>>()
  const groupSubscriptions = new Set<ConversationGroupSubscription>()
  const assistantGroupItemsSubscriptions =
    new Set<ConversationAssistantGroupItemsSubscription>()
  const assistantGroupItemKeysByGroup = new Map<string, Array<string>>()

  const notifyItemListeners = (key: string) => {
    const listenersForItem = itemListeners.get(key)
    if (!listenersForItem) return

    for (const listener of listenersForItem) listener()
  }

  const computeAssistantGroupItemKeys = (groupKey: string) => {
    const itemKeys: Array<string> = []
    const startIndex = snapshot.items.findIndex(
      (item, index) => conversationItemKey(item, index) === groupKey
    )
    if (startIndex < 0) return itemKeys

    for (let index = startIndex; index < snapshot.items.length; index += 1) {
      const item = snapshot.items[index]
      if (!item || item.kind !== "assistant") break
      itemKeys.push(conversationItemKey(item, index))
    }

    return itemKeys
  }

  const getAssistantGroupItemKeys = (groupKey: string) => {
    const cached = assistantGroupItemKeysByGroup.get(groupKey)
    const nextItemKeys = computeAssistantGroupItemKeys(groupKey)
    if (cached && sameStringArray(cached, nextItemKeys)) return cached

    assistantGroupItemKeysByGroup.set(groupKey, nextItemKeys)
    return nextItemKeys
  }

  return {
    getSnapshot: () => snapshot,
    getAssistantGroupItemKeys,
    getItem: (key) => snapshot.itemByKey.get(key),
    setItems: (items) => {
      if (snapshot.items === items) return

      const previousItemByKey = snapshot.itemByKey
      const nextItemByKey = buildConversationItemMap(items)
      snapshot = {
        items,
        itemByKey: nextItemByKey,
        revision: snapshot.revision + 1,
      }

      const changedItemKeys = new Set<string>()
      for (const key of previousItemByKey.keys()) {
        if (previousItemByKey.get(key) !== nextItemByKey.get(key)) {
          changedItemKeys.add(key)
        }
      }
      for (const key of nextItemByKey.keys()) {
        if (previousItemByKey.get(key) !== nextItemByKey.get(key)) {
          changedItemKeys.add(key)
        }
      }

      for (const subscription of groupSubscriptions) {
        const nextGroups = groupConversationItemsForRender({
          items,
          hideFooter: subscription.hideFooter,
          hideThinking: subscription.hideThinking,
          hideToolBlocks: subscription.hideToolBlocks,
        })
        const groups = reconcileRenderConversationGroupDescriptors(
          subscription.groups,
          nextGroups
        )

        if (groups !== subscription.groups) {
          subscription.groups = groups
          subscription.listener()
        }
      }

      for (const subscription of assistantGroupItemsSubscriptions) {
        const nextItemKeys = getAssistantGroupItemKeys(subscription.groupKey)
        if (sameStringArray(subscription.itemKeys, nextItemKeys)) continue

        subscription.itemKeys = nextItemKeys
        subscription.listener()
      }

      for (const listener of listeners) listener()
      for (const key of changedItemKeys) notifyItemListeners(key)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeGroups: ({
      hideFooter,
      hideThinking,
      hideToolBlocks,
      groups,
      listener,
    }) => {
      const subscription: ConversationGroupSubscription = {
        hideFooter,
        hideThinking,
        hideToolBlocks,
        groups,
        listener,
      }
      groupSubscriptions.add(subscription)
      return () => {
        groupSubscriptions.delete(subscription)
      }
    },
    subscribeAssistantGroupItems: (groupKey, listener) => {
      const subscription: ConversationAssistantGroupItemsSubscription = {
        groupKey,
        itemKeys: getAssistantGroupItemKeys(groupKey),
        listener,
      }
      assistantGroupItemsSubscriptions.add(subscription)
      return () => {
        assistantGroupItemsSubscriptions.delete(subscription)
      }
    },
    subscribeItems: (keys, listener) => {
      const uniqueKeys = [...new Set(keys)]
      for (const key of uniqueKeys) {
        const listenersForItem = itemListeners.get(key) ?? new Set<() => void>()
        listenersForItem.add(listener)
        itemListeners.set(key, listenersForItem)
      }

      return () => {
        for (const key of uniqueKeys) {
          const listenersForItem = itemListeners.get(key)
          if (!listenersForItem) continue
          listenersForItem.delete(listener)
          if (listenersForItem.size === 0) {
            itemListeners.delete(key)
          }
        }
      }
    },
  }
}

export function useConversationRevision(store: ConversationItemsStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().revision,
    () => store.getSnapshot().revision
  )
}

function conversationHasAssistantOutput(items: Array<ConversationItem>) {
  return items.some(
    (item) =>
      item.kind === "assistant" &&
      item.blocks.some(
        (block) =>
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim().length > 0
      )
  )
}

export function useConversationHasMessages(store: ConversationItemsStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().items.length > 0,
    () => store.getSnapshot().items.length > 0
  )
}

export function useConversationHasAssistantOutput(
  store: ConversationItemsStore
) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => conversationHasAssistantOutput(store.getSnapshot().items),
    () => conversationHasAssistantOutput(store.getSnapshot().items)
  )
}

export function useConversationGroupDescriptors({
  hideFooter,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  const cacheRef = React.useRef<{
    hideFooter: boolean
    hideThinking: boolean
    hideToolBlocks: boolean
    revision: number
    groups: Array<RenderConversationGroupDescriptor>
  }>({
    hideFooter,
    hideThinking,
    hideToolBlocks,
    revision: -1,
    groups: [],
  })

  const getSnapshot = () => {
    const snapshot = store.getSnapshot()
    const cache = cacheRef.current
    if (
      cache.revision === snapshot.revision &&
      cache.hideFooter === hideFooter &&
      cache.hideThinking === hideThinking &&
      cache.hideToolBlocks === hideToolBlocks
    ) {
      return cache.groups
    }

    const nextGroups = groupConversationItemsForRender({
      items: snapshot.items,
      hideFooter,
      hideThinking,
      hideToolBlocks,
    })
    const groups =
      cache.hideFooter === hideFooter &&
      cache.hideThinking === hideThinking &&
      cache.hideToolBlocks === hideToolBlocks
        ? reconcileRenderConversationGroupDescriptors(cache.groups, nextGroups)
        : nextGroups

    cacheRef.current = {
      hideFooter,
      hideThinking,
      hideToolBlocks,
      revision: snapshot.revision,
      groups,
    }

    return groups
  }

  const subscribe = (listener: () => void) =>
    store.subscribeGroups({
      hideFooter,
      hideThinking,
      hideToolBlocks,
      groups: getSnapshot(),
      listener,
    })

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useConversationItem(
  store: ConversationItemsStore,
  key: string
): ConversationItem | undefined {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeItems([key], listener),
      [key, store]
    ),
    () => store.getItem(key),
    () => store.getItem(key)
  )
}

export function assistantMessagesSnapshotFromStore(options: {
  hideThinking: boolean
  hideToolBlocks: boolean
  itemKeys: Array<string>
  store: ConversationItemsStore
}): AssistantMessagesSnapshot {
  return {
    hideThinking: options.hideThinking,
    hideToolBlocks: options.hideToolBlocks,
    items: options.itemKeys
      .map((key) => options.store.getItem(key))
      .filter(
        (item): item is AssistantConversationItem => item?.kind === "assistant"
      ),
  }
}

function sameAssistantMessagesSnapshot(
  left: AssistantMessagesSnapshot,
  right: AssistantMessagesSnapshot
) {
  if (left.hideThinking !== right.hideThinking) return false
  if (left.hideToolBlocks !== right.hideToolBlocks) return false
  if (left.items.length !== right.items.length) return false

  for (let index = 0; index < left.items.length; index += 1) {
    if (left.items[index] !== right.items[index]) return false
  }

  return true
}

export type MutableAssistantMessagesStore = AssistantMessagesStore & {
  setSnapshot: (snapshot: AssistantMessagesSnapshot) => void
}

export function createMutableAssistantMessagesStore(
  initialSnapshot: AssistantMessagesSnapshot
): MutableAssistantMessagesStore {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      if (sameAssistantMessagesSnapshot(snapshot, nextSnapshot)) return

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
