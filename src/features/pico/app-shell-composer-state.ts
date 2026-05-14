import {
  createInitialSessionState,
  type ConversationItem,
  type PromptImage,
  type SessionState,
  type StreamingBehavior,
} from "@/lib/pico"

export type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

export type PendingDraftFollowUp = {
  message: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
  optimisticId?: string
}

export function pendingDraftFollowUpId(
  message: { optimisticId?: string },
  index: number
) {
  return message.optimisticId || `pending-draft:${index}`
}

export function movePendingDraftFollowUpMessage(
  messages: Array<PendingDraftFollowUp>,
  pendingId: string,
  direction: -1 | 1
) {
  const index = messages.findIndex(
    (message, messageIndex) =>
      pendingDraftFollowUpId(message, messageIndex) === pendingId
  )
  if (index === -1) return null

  const item = messages[index]
  if (!item) return null

  const next = [...messages]
  const targetIndex = index + direction
  const target = next[targetIndex]

  if (direction === -1) {
    if (item.streamingBehavior === "followUp" && !target) {
      next[index] = { ...item, streamingBehavior: "steer" }
      return next
    }

    if (
      item.streamingBehavior === "followUp" &&
      target.streamingBehavior === "steer"
    ) {
      next[index] = { ...item, streamingBehavior: "steer" }
      return next
    }
  }

  if (direction === 1) {
    if (item.streamingBehavior === "steer" && !target) {
      next[index] = { ...item, streamingBehavior: "followUp" }
      return next
    }

    if (
      item.streamingBehavior === "steer" &&
      target.streamingBehavior === "followUp"
    ) {
      next[index] = { ...item, streamingBehavior: "followUp" }
      return next
    }
  }

  if (!target) return null

  const [movedItem] = next.splice(index, 1)
  if (!movedItem) return null
  next.splice(targetIndex, 0, movedItem)
  return next
}

export type AppShellComposerSnapshot = {
  activeSessionId?: string
  awaitingFirstTurn: boolean
  centerMessages: boolean
  composerImages: Array<PromptImage>
  composerSkill?: string
  composerSyncNonce: number
  composerText: string
  currentPendingMessages: Array<PendingComposerMessage>
  disabled: boolean
  isStreaming: boolean
  isSubmitting: boolean
  viewerContextId: string
}

export const EMPTY_COMPOSER_IMAGES: Array<PromptImage> = []
export const EMPTY_COMPOSER_PENDING_MESSAGES: Array<PendingComposerMessage> = []

function sameComposerPromptImages(
  left: Array<PromptImage>,
  right: Array<PromptImage>
) {
  if (left === right) return true
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftImage = left[index]
    const rightImage = right[index]
    if (!leftImage || !rightImage) return false
    if (leftImage.mimeType !== rightImage.mimeType) return false
    if (leftImage.data !== rightImage.data) return false
    if (leftImage.previewUrl !== rightImage.previewUrl) return false
  }

  return true
}

function sameComposerPendingMessages(
  left: Array<PendingComposerMessage>,
  right: Array<PendingComposerMessage>
) {
  if (left === right) return true
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftMessage = left[index]
    const rightMessage = right[index]
    if (!leftMessage || !rightMessage) return false
    if (leftMessage.pendingId !== rightMessage.pendingId) return false
    if (leftMessage.text !== rightMessage.text) return false
    if (leftMessage.streamingBehavior !== rightMessage.streamingBehavior) {
      return false
    }
    if (!sameComposerPromptImages(leftMessage.images, rightMessage.images)) {
      return false
    }
  }

  return true
}

export function sameAppShellComposerSnapshot(
  left: AppShellComposerSnapshot,
  right: AppShellComposerSnapshot
) {
  return (
    left.activeSessionId === right.activeSessionId &&
    left.awaitingFirstTurn === right.awaitingFirstTurn &&
    left.centerMessages === right.centerMessages &&
    left.composerSkill === right.composerSkill &&
    left.composerSyncNonce === right.composerSyncNonce &&
    left.composerText === right.composerText &&
    left.disabled === right.disabled &&
    left.isStreaming === right.isStreaming &&
    left.isSubmitting === right.isSubmitting &&
    left.viewerContextId === right.viewerContextId &&
    sameComposerPromptImages(left.composerImages, right.composerImages) &&
    sameComposerPendingMessages(
      left.currentPendingMessages,
      right.currentPendingMessages
    )
  )
}

export type AppShellComposerActions = {
  abortSession: () => void | Promise<unknown>
  onPickImages: (files: FileList | Array<File> | null) => void | Promise<void>
  onRemoveComposerImage: (index: number) => void
  editPendingDraftFollowUp: (pendingId: string, text: string) => boolean
  editPendingMessage: (
    pendingId: string,
    text: string
  ) => void | Promise<unknown>
  removePendingDraftFollowUp: (pendingId: string) => boolean
  removePendingMessage: (pendingId: string) => void | Promise<unknown>
  reorderPending: (
    pendingId: string,
    direction: -1 | 1
  ) => void | Promise<unknown>
  reorderPendingDraftFollowUp: (pendingId: string, direction: -1 | 1) => boolean
  runBuiltinSlashCommand: (
    name: string,
    args: string
  ) => void | Promise<unknown>
  setModel: (value: string) => void | Promise<unknown>
  setThinkingLevel: (level: string) => void | Promise<unknown>
  submitPrompt: (
    streamingBehavior?: StreamingBehavior
  ) => void | Promise<unknown>
  syncComposerDraft: (value: string) => void
}

export function createInitialAppShellComposerSnapshot(
  viewerContextId: string
): AppShellComposerSnapshot {
  return {
    activeSessionId: undefined,
    awaitingFirstTurn: false,
    centerMessages: false,
    composerImages: EMPTY_COMPOSER_IMAGES,
    composerSkill: undefined,
    composerSyncNonce: 0,
    composerText: "",
    currentPendingMessages: EMPTY_COMPOSER_PENDING_MESSAGES,
    disabled: false,
    isStreaming: false,
    isSubmitting: false,
    viewerContextId,
  }
}

export function createOptimisticDraftSessionState(options: {
  previous: SessionState
  cwd?: string
  ownerKey: string
}): SessionState {
  const nextCwd = options.cwd?.trim() || options.previous.cwd?.trim() || ""
  const base = createInitialSessionState()

  return {
    ...base,
    connected: options.previous.connected,
    draft: true,
    sessionKey: `optimistic:${options.ownerKey}`,
    cwd: nextCwd || undefined,
    model: options.previous.model,
    thinkingLevel: options.previous.thinkingLevel,
    availableThinkingLevels: options.previous.availableThinkingLevels,
    availableModels: options.previous.availableModels,
    availableSkills: options.previous.availableSkills,
    hideThinkingBlock: options.previous.hideThinkingBlock,
  }
}

export type UserConversationItem = Extract<ConversationItem, { kind: "user" }>

export function createOptimisticPendingId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `optimistic:${crypto.randomUUID()}`
  }

  return `optimistic:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

export function insertOptimisticUserItem(
  items: Array<ConversationItem>,
  item: UserConversationItem
) {
  if (
    item.pendingId &&
    items.some(
      (entry) => entry.kind === "user" && entry.pendingId === item.pendingId
    )
  ) {
    return items
  }

  const nextItems = [...items]
  const lastItem = nextItems[nextItems.length - 1]
  const insertIndex =
    lastItem?.kind === "assistant" && lastItem.streaming
      ? nextItems.length - 1
      : nextItems.length
  nextItems.splice(insertIndex, 0, item)
  return nextItems
}

export function removeOptimisticUserItem(
  items: Array<ConversationItem>,
  pendingId: string
) {
  let changed = false
  const nextItems = items.filter((item) => {
    const remove = item.kind === "user" && item.pendingId === pendingId
    if (remove) changed = true
    return !remove
  })

  return changed ? nextItems : items
}
