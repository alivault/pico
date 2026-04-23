import { formatDistanceToNowStrict } from "date-fns"

import { normalizeStoredDirectoryList } from "@/lib/pi-web-storage"

export {
  CENTER_MESSAGES_STORAGE_KEY,
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  PROMPT_DRAFTS_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  createContextId,
  loadStoredPromptDrafts,
  normalizeSessionSelectionKeys,
  normalizeStoredDirectoryList,
  normalizeThemeMode,
  promptDraftKey,
  readStoredCenterMessages,
  readStoredCollapsedDirectories,
  readStoredDraftDirectory,
  readStoredHideToolBlocks,
  readStoredPromptDraft,
  readStoredRecentDirectories,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  readStoredTheme,
  rememberStoredPromptDraft,
  resolvedThemeMode,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  safeSessionStorageGetItem,
  safeSessionStorageSetItem,
  sessionListEntryKey,
  themeModeLabel,
} from "@/lib/pi-web-storage"
export {
  assistantBlocksFromMessage,
  buildItemsFromSync,
  createCompactionSummaryItem,
  createInitialSessionState,
  extractMessageImages,
  extractMessageText,
  extractToolText,
  meaningfulHiddenThinkingLabel,
  normalizePromptImage,
  previewUrlForImage,
  sameContextUsage,
  truncateThinkingSummary,
} from "@/lib/pi-web-sync"
export { filterFlatTree, flattenTree } from "@/lib/pi-web-tree"

export const INITIAL_DIRECTORY_SESSION_RENDER_COUNT = 5
export const DIRECTORY_SESSION_LOAD_MORE_COUNT = 5

export type ThemeMode = "system" | "light" | "dark"
export type ResolvedThemeMode = Exclude<ThemeMode, "system">
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

export type PromptDraftTarget = {
  sessionId?: string
  sessionFile?: string
  cwd?: string
}

export type SessionEntryIdentity = {
  path?: string
  id?: string
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
  blockKey?: string
  text: string
}

export type ThinkingBlock = {
  type: "thinking"
  blockKey?: string
  text: string
  summaryLabel?: string
}

export type ToolBlock = {
  type: "tool"
  blockKey?: string
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
  blockKey?: string
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
  itemKey?: string
  pendingId?: string
  text: string
  images: Array<PromptImage>
  queued?: boolean
  streamingBehavior?: StreamingBehavior
}

export type AssistantItem = {
  kind: "assistant"
  itemKey?: string
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

export function clampSidebarDirectories(
  directories: Array<string>,
  fallbackDirectory?: string
) {
  const normalized = normalizeStoredDirectoryList(directories)
  if (normalized.length > 0) return normalized
  if (fallbackDirectory?.trim()) return [fallbackDirectory.trim()]
  return []
}
