import { formatDistanceToNowStrict } from "date-fns"

export const THEME_STORAGE_KEY = "pi-web-theme"
export const DRAFT_DIRECTORY_STORAGE_KEY = "pi-web-draft-directory"
export const SIDEBAR_DIRECTORIES_STORAGE_KEY = "pi-web-sidebar-directories"
export const COLLAPSED_DIRECTORIES_STORAGE_KEY = "pi-web-collapsed-directories"
export const RECENT_DIRECTORIES_STORAGE_KEY = "pi-web-recent-directories"
export const RECENT_DIRECTORIES_LIMIT = 8
export const SESSION_DONE_SOUND_ENABLED_STORAGE_KEY =
  "pi-web-session-done-sound"
export const SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "pi-web-session-done-desktop-notifications"
export const HIDE_TOOL_BLOCKS_STORAGE_KEY = "pi-web-hide-tools"
export const VIEWER_CONTEXT_STORAGE_KEY = "pi-to-go-context-id"
export const INITIAL_DIRECTORY_SESSION_RENDER_COUNT = 5
export const DIRECTORY_SESSION_LOAD_MORE_COUNT = 5

export type ThemeMode = "system" | "light" | "dark"
export type StreamingBehavior = "followUp" | "steer"

export type PromptImage = {
  type?: "image"
  mimeType: string
  data: string
  previewUrl: string
}

export type SessionSummary = {
  path?: string
  id?: string
  cwd?: string
  name?: string
  title: string
  modified?: string
  streaming?: boolean
  unread?: boolean
}

export type DirectoryState = {
  path: string
  totalCount: number
  revision: string
}

export type ModelOption = {
  id: string
  provider?: string
  name?: string
  reasoning?: boolean
}

export type SkillOption = {
  name: string
  description?: string
  scope?: string
  source?: string
}

export type UiRequest = {
  id: string
  method: "confirm" | "editor" | "input" | "notify" | "select"
  title?: string
  message?: string
  placeholder?: string
  prefill?: string
  notifyType?: "info" | "success" | "warning" | "error"
  options?: Array<{ value: string; label?: string } | string>
  timeout?: number
}

export type TextBlock = {
  type: "text"
  text: string
}

export type ThinkingBlock = {
  type: "thinking"
  text: string
  summaryLabel?: string
}

export type ToolBlock = {
  type: "tool"
  callId?: string
  name?: string
  args?: unknown
  output: string
  details?: unknown
  isError: boolean
  running: boolean
}

export type CompactionBlock = {
  type: "compaction"
  summary: string
  tokensBefore: number
}

export type AssistantBlock =
  | TextBlock
  | ThinkingBlock
  | ToolBlock
  | CompactionBlock

export type UserItem = {
  kind: "user"
  pendingId?: string
  text: string
  images: Array<PromptImage>
  queued?: boolean
  streamingBehavior?: StreamingBehavior
}

export type AssistantItem = {
  kind: "assistant"
  blocks: Array<AssistantBlock>
  streaming?: boolean
}

export type ConversationItem = UserItem | AssistantItem

export type SessionUiState = {
  statuses: Record<string, string>
  title?: string
  editorText?: string
  workingMessage?: string
  hiddenThinkingLabel?: string
}

export type SessionState = {
  connected: boolean
  replaying: boolean
  streaming: boolean
  draft: boolean
  items: Array<ConversationItem>
  sessionId?: string
  sessionKey?: string
  sessionName?: string
  firstMessage: string
  sessionFile?: string
  cwd?: string
  modified?: string
  model?: ModelOption
  thinkingLevel: string
  availableThinkingLevels: Array<string>
  availableModels: Array<ModelOption>
  availableSkills: Array<SkillOption>
  hideThinkingBlock: boolean
  hiddenThinkingPreview?: string
  contextUsage?: {
    tokens?: number
    contextWindow?: number
    percent?: number
  }
  uiState: SessionUiState
  uiRequest?: UiRequest
}

type UnknownRecord = Record<string, unknown>

type MessageContentPart = UnknownRecord & {
  type?: unknown
  text?: unknown
  thinking?: unknown
  id?: unknown
  name?: unknown
  arguments?: unknown
}

type MessagePayload = UnknownRecord & {
  role?: unknown
  content?: unknown
  queued?: unknown
  metadata?: UnknownRecord
  streamingBehavior?: unknown
  deliverAs?: unknown
  summary?: unknown
  tokensBefore?: unknown
  toolCallId?: unknown
  details?: unknown
  isError?: unknown
}

type PendingUserMessagePayload = UnknownRecord & {
  pendingId?: unknown
  text?: unknown
  images?: unknown
  queued?: unknown
  streamingBehavior?: unknown
}

export type StateSyncPayload = {
  type: "state_sync"
  sessionKey?: string
  messages?: Array<MessagePayload>
  pendingUserMessages?: Array<PendingUserMessagePayload>
  draft?: boolean
  streaming?: boolean
  streamingMessage?: MessagePayload
  contextUsage?: SessionState["contextUsage"]
  hideThinkingBlock?: boolean
  model?: ModelOption
  thinkingLevel?: string
  availableThinkingLevels?: Array<string>
  availableModels?: Array<ModelOption>
  availableSkills?: Array<SkillOption>
  sessionId?: string
  sessionFile?: string
  sessionName?: string
  firstMessage?: string
  cwd?: string
  modified?: string
  uiState?: SessionUiState
}

export type SessionMetaPayload = {
  type: "session_meta"
  sessionKey?: string
  sessionId?: string
  sessionFile?: string
  sessionName?: string
  firstMessage?: string
  cwd?: string
  modified?: string
  draft?: boolean
  streaming?: boolean
  pendingUserMessages?: Array<PendingUserMessagePayload>
}

export type SessionsPayload = {
  type: "sessions"
  directories?: Array<string>
  directoryStates?: Array<DirectoryState>
}

export type TreeNode = {
  entry: {
    id: string
    parentId?: string | null
    timestamp?: string
    type: string
    message?: {
      role?: string
      text?: string
      toolCalls?: Array<{ id?: string; name?: string; preview?: string }>
      stopReason?: string
      errorMessage?: string
      toolCallId?: string
      toolName?: string
      command?: string
    }
    customType?: string
    text?: string
    tokensBefore?: number
    summary?: string
    modelId?: string
    thinkingLevel?: string
    name?: string
    label?: string
  }
  label?: string
  labelTimestamp?: string
  children: Array<TreeNode>
}

export type FlatTreeNode = {
  id: string
  parentId?: string | null
  depth: number
  label?: string
  labelTimestamp?: string
  timestamp?: string
  type: string
  text: string
  role?: string
  node: TreeNode
}

export function createContextId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `ctx-${crypto.randomUUID()}`
  }

  return `ctx-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

export function safeLocalStorageGetItem(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalStorageSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeSessionStorageGetItem(key: string) {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionStorageSetItem(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function normalizeStoredDirectoryList(value: unknown) {
  if (!Array.isArray(value)) return []

  const nextDirectories: Array<string> = []
  const seen = new Set<string>()

  for (const entry of value) {
    const normalized = typeof entry === "string" ? entry.trim() : ""
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    nextDirectories.push(normalized)
  }

  return nextDirectories
}

export function readStoredSidebarDirectories() {
  try {
    const raw = safeLocalStorageGetItem(SIDEBAR_DIRECTORIES_STORAGE_KEY)
    if (raw == null) {
      return { directories: [], hasStoredValue: false }
    }

    return {
      directories: normalizeStoredDirectoryList(JSON.parse(raw)),
      hasStoredValue: true,
    }
  } catch {
    return { directories: [], hasStoredValue: false }
  }
}

export function readStoredCollapsedDirectories() {
  try {
    const raw = safeLocalStorageGetItem(COLLAPSED_DIRECTORIES_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key.trim(), Boolean(value)])
        .filter(([key]) => Boolean(key))
    ) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function readStoredDraftDirectory() {
  return (safeLocalStorageGetItem(DRAFT_DIRECTORY_STORAGE_KEY) ?? "").trim()
}

export function readStoredRecentDirectories() {
  try {
    const raw = safeLocalStorageGetItem(RECENT_DIRECTORIES_STORAGE_KEY)
    if (!raw) return []
    return normalizeStoredDirectoryList(JSON.parse(raw))
  } catch {
    return []
  }
}

export function readStoredTheme() {
  const raw = (safeLocalStorageGetItem(THEME_STORAGE_KEY) ?? "system").trim()
  return raw === "light" || raw === "dark" ? raw : "system"
}

export function readStoredHideToolBlocks() {
  return safeLocalStorageGetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY) === "1"
}

export function readStoredSessionDoneSoundEnabled() {
  const value = safeLocalStorageGetItem(SESSION_DONE_SOUND_ENABLED_STORAGE_KEY)
  return value == null ? true : value !== "0"
}

export function readStoredSessionDoneDesktopNotificationsEnabled() {
  const value = safeLocalStorageGetItem(
    SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY
  )
  return value == null ? true : value !== "0"
}

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

export function assistantBlocksFromMessage(
  message: MessagePayload | undefined
) {
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
      images: Array.isArray(message?.images)
        ? message.images
            .map((image: unknown) => normalizePromptImage(image))
            .filter((image: PromptImage | null): image is PromptImage =>
              Boolean(image)
            )
        : [],
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

export function relativeTime(value?: string) {
  if (!value) return ""

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return `${formatDistanceToNowStrict(date, { addSuffix: true })}`
}

export function getSessionTitle(
  summary?: Pick<SessionSummary, "title" | "name">
) {
  if (summary?.title?.trim()) return summary.title.trim()
  if (summary?.name?.trim()) return summary.name.trim()
  return "New session"
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

export function clampSidebarDirectories(
  directories: Array<string>,
  fallbackDirectory?: string
) {
  const normalized = normalizeStoredDirectoryList(directories)
  if (normalized.length > 0) return normalized
  if (fallbackDirectory?.trim()) return [fallbackDirectory.trim()]
  return []
}

export function flattenTree(tree: Array<TreeNode>) {
  const flatNodes: Array<FlatTreeNode> = []

  function visit(node: TreeNode, depth: number) {
    const entry = node.entry
    const role = entry.message?.role
    const label = node.label
    const contentParts = [
      label,
      role ? `${role}:` : "",
      entry.message?.text,
      entry.summary,
      entry.text,
      entry.message?.command,
      entry.modelId,
      entry.thinkingLevel,
      entry.name,
      entry.label,
      ...(entry.message?.toolCalls?.map(
        (toolCall) => toolCall.preview || toolCall.name || ""
      ) ?? []),
    ]

    flatNodes.push({
      id: entry.id,
      parentId: entry.parentId,
      depth,
      label,
      labelTimestamp: node.labelTimestamp,
      timestamp: entry.timestamp,
      type: entry.type,
      role,
      text: contentParts.filter(Boolean).join(" ").trim(),
      node,
    })

    for (const child of node.children || []) {
      visit(child, depth + 1)
    }
  }

  for (const node of tree) {
    visit(node, 0)
  }

  return flatNodes
}

export function filterFlatTree(nodes: Array<FlatTreeNode>, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return nodes

  return nodes.filter((node) =>
    node.text.toLowerCase().includes(normalizedQuery)
  )
}
