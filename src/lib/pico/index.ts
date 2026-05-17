export {
  AUTO_SCROLL_ENABLED_STORAGE_KEY,
  CENTER_MESSAGES_STORAGE_KEY,
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  PINNED_SESSIONS_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY,
  RIGHT_SIDEBAR_FILE_TREE_WIDTH_STORAGE_KEY,
  RIGHT_SIDEBAR_HISTORY_HEIGHT_STORAGE_KEY,
  RIGHT_SIDEBAR_HISTORY_TAB_STORAGE_KEY,
  RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  APPLIED_THEME_STORAGE_KEY,
  THEME_COLOR_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  createContextId,
  normalizeSessionSelectionKeys,
  normalizeStoredDirectoryList,
  promptDraftKey,
  promptDraftKeyMatchesOwner,
  readStoredAutoScrollEnabled,
  readStoredCenterMessages,
  readStoredCollapsedDirectories,
  readStoredDraftDirectory,
  readStoredHideToolBlocks,
  readStoredPinnedSessionKeys,
  readStoredPromptDraft,
  readStoredRecentDirectories,
  readStoredRightSidebarOpen,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  readStoredTheme,
  readStoredThemeColorMode,
  rememberStoredPromptDraft,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/pico/storage"
export {
  APPLIED_THEME_CLASSES,
  PICO_CODE_SHIKI_THEME,
  PICO_DIFF_SHIKI_THEMES,
  PICO_SHIKI_VARIABLE_DEFAULTS,
  THEME_COLOR_MODES,
  THEME_DEFINITIONS,
  THEME_FAMILIES,
  appliedThemeClass,
  appliedThemeClassColorMode,
  normalizeThemeColorMode,
  normalizeThemeFamily,
  themeColorModeLabel,
  themeFamilyDescription,
  themeFamilyKeywords,
  themeFamilyLabel,
} from "@/lib/pico/themes"
export type {
  AppliedThemeClass,
  ResolvedThemeMode,
  ThemeColorMode,
  ThemeFamily,
} from "@/lib/pico/themes"
export {
  buildItemsFromSync,
  createCompactionSummaryItem,
  createInitialSessionState,
  normalizePromptImage,
  previewUrlForImage,
  sameContextUsage,
  thinkingSummaryText,
} from "@/lib/pico/sync"
export { flattenTree } from "@/lib/pico/tree"

export const INITIAL_DIRECTORY_SESSION_RENDER_COUNT = 5
export const DIRECTORY_SESSION_LOAD_MORE_COUNT = 5

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
  method:
    | "auth"
    | "auth_input"
    | "auth_select"
    | "confirm"
    | "editor"
    | "input"
    | "notify"
    | "select"
  title?: string
  message?: string
  placeholder?: string
  prefill?: string
  authUrl?: string
  authManualAllowed?: boolean
  allowEmpty?: boolean
  notifyType?: "info" | "success" | "warning" | "error"
  options?: Array<{ value: string; label?: string } | string>
  timeout?: number
}

type TextBlock = {
  type: "text"
  blockKey?: string
  renderKey?: string
  text: string
  isError?: boolean
}

type ThinkingBlock = {
  type: "thinking"
  blockKey?: string
  renderKey?: string
  text: string
  summaryLabel?: string
}

export type ToolBlock = {
  type: "tool"
  blockKey?: string
  renderKey?: string
  callId?: string
  name?: string
  args?: unknown
  category?: "explore"
  output: string
  details?: unknown
  isError: boolean
  running: boolean
}

type CompactionBlock = {
  type: "compaction"
  blockKey?: string
  renderKey?: string
  summary: string
  tokensBefore: number
}

export type AssistantBlock =
  | TextBlock
  | ThinkingBlock
  | ToolBlock
  | CompactionBlock

type UserItem = {
  kind: "user"
  itemKey?: string
  renderKey?: string
  pendingId?: string
  text: string
  images: Array<PromptImage>
  queued?: boolean
  streamingBehavior?: StreamingBehavior
}

export type AssistantItem = {
  kind: "assistant"
  itemKey?: string
  renderKey?: string
  blocks: Array<AssistantBlock>
  streaming?: boolean
  done?: boolean
  model?: ModelOption
}

export type ConversationItem = UserItem | AssistantItem

export type ConversationItemsPatch = {
  previousLength: number
  start: number
  deleteCount: number
  items: Array<ConversationItem>
}

export type SessionUiState = {
  statuses: Record<string, string>
  title?: string
  editorText?: string
  workingMessage?: string
}

export type SessionState = {
  connected: boolean
  replaying: boolean
  streaming: boolean
  compacting: boolean
  draft: boolean
  messages: Array<MessagePayload>
  items: Array<ConversationItem>
  historyOffset: number
  historyTotalCount: number
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
    tokens?: number | null
    contextWindow?: number
    percent?: number | null
    [key: string]: unknown
  }
  uiState: SessionUiState
  uiRequest?: UiRequest
}

type UnknownRecord = Record<string, unknown>

export type MessagePayload = UnknownRecord & {
  role?: unknown
  content?: unknown
  stopReason?: unknown
  errorMessage?: unknown
  queued?: unknown
  metadata?: UnknownRecord
  provider?: unknown
  model?: unknown
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
  activationRevision?: number
  sessionKey?: string
  items?: Array<ConversationItem>
  itemsPatch?: ConversationItemsPatch
  messages?: Array<MessagePayload>
  pendingUserMessages?: Array<PendingUserMessagePayload>
  draft?: boolean
  streaming?: boolean
  compacting?: boolean
  streamingMessage?: MessagePayload
  historyOffset?: number
  historyTotalCount?: number
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

export type SessionsPayload = {
  type: "sessions"
  directories?: Array<string>
  directoryStates?: Array<DirectoryState>
}

export type TreeNode = {
  streaming?: boolean
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
  streaming?: boolean
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

export function getSessionTitle(
  summary?: Pick<SessionSummary, "title" | "name">
) {
  if (summary?.title?.trim()) return summary.title.trim()
  if (summary?.name?.trim()) return summary.name.trim()
  return "New session"
}
