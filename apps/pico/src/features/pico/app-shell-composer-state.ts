import {
  createInitialAgentState,
  type ConversationItem,
  type PromptImage,
  type AgentState,
  type StreamingBehavior,
} from "@/lib/pico"
import type { GitCommitDiffMode } from "@/lib/pico/api"
import type { PendingQueueSaveRow } from "@/features/pico/pending-queue"

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

/** A comment on a line of a diff in the Git tab. */
export type ComposerDiffLineComment = {
  kind?: "diff"
  id: string
  cwd: string
  path: string
  lineNumber: number
  side: "additions" | "deletions"
  text: string
  tabKey: string
  tabTitle: string
  commit: string
  shortHash: string
  mode: GitCommitDiffMode
}

/** A comment on lines of a project file in the file viewer. */
export type ComposerFileLineComment = {
  kind: "file"
  id: string
  cwd: string
  path: string
  startLine: number
  endLine: number
  /** The commented lines, so the agent sees what the user saw. */
  snippet: string
  text: string
}

/** A comment that the next prompt sends with its text. */
export type ComposerLineComment =
  | ComposerDiffLineComment
  | ComposerFileLineComment

export function isComposerFileLineComment(
  comment: ComposerLineComment
): comment is ComposerFileLineComment {
  return comment.kind === "file"
}

export function isComposerDiffLineComment(
  comment: ComposerLineComment
): comment is ComposerDiffLineComment {
  return comment.kind !== "file"
}

export type AppShellComposerSnapshot = {
  activeAgentId?: string
  awaitingFirstTurn: boolean
  canStartPendingQueue: boolean
  centerMessages: boolean
  composerLineComments: Array<ComposerLineComment>
  composerImages: Array<PromptImage>
  composerSkill?: string
  composerSyncNonce: number
  composerText: string
  currentPendingMessages: Array<PendingComposerMessage>
  disabled: boolean
  isCompacting: boolean
  isStreaming: boolean
  isSubmitting: boolean
  viewerContextId: string
}

export const EMPTY_COMPOSER_LINE_COMMENTS: Array<ComposerLineComment> = []
export const EMPTY_COMPOSER_IMAGES: Array<PromptImage> = []
export const EMPTY_COMPOSER_PENDING_MESSAGES: Array<PendingComposerMessage> = []

function sameComposerLineComments(
  left: Array<ComposerLineComment>,
  right: Array<ComposerLineComment>
) {
  if (left === right) return true
  if (left.length !== right.length) return false

  // Comments are plain objects of strings and numbers, so compare their fields.
  return left.every((leftComment, index) => {
    const rightComment = right[index] as Record<string, unknown> | undefined
    if (!rightComment) return false
    const leftFields = Object.entries(leftComment)
    return (
      leftFields.length === Object.keys(rightComment).length &&
      leftFields.every(([key, value]) => rightComment[key] === value)
    )
  })
}

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
    left.activeAgentId === right.activeAgentId &&
    left.awaitingFirstTurn === right.awaitingFirstTurn &&
    left.canStartPendingQueue === right.canStartPendingQueue &&
    left.centerMessages === right.centerMessages &&
    sameComposerLineComments(
      left.composerLineComments,
      right.composerLineComments
    ) &&
    left.composerSkill === right.composerSkill &&
    left.composerSyncNonce === right.composerSyncNonce &&
    left.composerText === right.composerText &&
    left.disabled === right.disabled &&
    left.isCompacting === right.isCompacting &&
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
  abortAgent: () => void | Promise<unknown>
  onPickImages: (files: FileList | Array<File> | null) => void | Promise<void>
  onRemoveComposerImage: (index: number) => void
  removeLineComment: (id: string) => void
  /** Save the draft follow-up rows and return the rows for the server. */
  savePendingDraftFollowUps: (
    rows: Array<PendingQueueSaveRow>
  ) => Array<PendingQueueSaveRow>
  savePendingQueue: (
    rows: Array<PendingQueueSaveRow>,
    removedPendingIds: Array<string>,
    resume: boolean
  ) => void | Promise<unknown>
  /**
   * Hold the queue for an edit. Resolves a function that resumes the held
   * agent, or null when the queue must stay paused.
   */
  holdPendingQueue: () => Promise<(() => void) | null>
  startPendingQueue: () => void | Promise<unknown>
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
  /**
   * Start a new agent in a directory of another machine. The prompt draft
   * and images move to that machine's composer.
   */
  moveDraftToMachine: (machineId: string, directory: string) => void
}

export function createInitialAppShellComposerSnapshot(
  viewerContextId: string
): AppShellComposerSnapshot {
  return {
    activeAgentId: undefined,
    awaitingFirstTurn: false,
    canStartPendingQueue: false,
    centerMessages: true,
    composerLineComments: EMPTY_COMPOSER_LINE_COMMENTS,
    composerImages: EMPTY_COMPOSER_IMAGES,
    composerSkill: undefined,
    composerSyncNonce: 0,
    composerText: "",
    currentPendingMessages: EMPTY_COMPOSER_PENDING_MESSAGES,
    disabled: false,
    isCompacting: false,
    isStreaming: false,
    isSubmitting: false,
    viewerContextId,
  }
}

export function createOptimisticDraftAgentState(options: {
  previous: AgentState
  cwd?: string
  ownerKey: string
}): AgentState {
  const nextCwd = options.cwd?.trim() || options.previous.cwd?.trim() || ""
  const base = createInitialAgentState()

  return {
    ...base,
    connected: options.previous.connected,
    draft: true,
    agentKey: `optimistic:${options.ownerKey}`,
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
