export {
  AUTO_SCROLL_ENABLED_STORAGE_KEY,
  CENTER_MESSAGES_STORAGE_KEY,
  COLLAPSED_PROJECTS_STORAGE_KEY,
  DRAFT_PROJECT_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  PINNED_AGENTS_STORAGE_KEY,
  RECENT_PROJECTS_LIMIT,
  RECENT_PROJECTS_STORAGE_KEY,
  RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY,
  RIGHT_SIDEBAR_FILE_TREE_WIDTH_STORAGE_KEY,
  RIGHT_SIDEBAR_HISTORY_HEIGHT_STORAGE_KEY,
  RIGHT_SIDEBAR_HISTORY_TAB_STORAGE_KEY,
  RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY,
  TERMINAL_PANEL_HEIGHT_STORAGE_KEY,
  TERMINAL_PANEL_OPEN_STORAGE_KEY,
  TERMINAL_TABS_STORAGE_KEY,
  AGENT_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  AGENT_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_PROJECTS_STORAGE_KEY,
  APPLIED_THEME_STORAGE_KEY,
  THEME_COLOR_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  createContextId,
  normalizeAgentSelectionKeys,
  normalizeStoredProjectList,
  promptDraftKey,
  promptDraftKeyMatchesOwner,
  readStoredAutoScrollEnabled,
  readStoredCenterMessages,
  readStoredCollapsedProjects,
  readStoredDraftProject,
  readStoredHideToolBlocks,
  readStoredPinnedAgentKeys,
  readStoredPromptDraft,
  readStoredRecentProjects,
  readStoredRightSidebarOpen,
  readStoredTerminalPanelOpen,
  readStoredTerminalTabs,
  readStoredAgentDoneDesktopNotificationsEnabled,
  readStoredAgentDoneSoundEnabled,
  readStoredSidebarProjects,
  readStoredTheme,
  readStoredThemeColorMode,
  rememberStoredPromptDraft,
  rememberStoredTerminalTabs,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  machineLocalStorageGetItem,
  machineLocalStorageSetItem,
  agentListEntryKey,
} from "@/lib/pico/storage"
export type { StoredTerminalTabsState } from "@/lib/pico/storage"
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
  themeFamilyFixedMode,
  themeFamilyKeywords,
  themeFamilyLabel,
  themeFamilySupportsColorMode,
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
  createInitialAgentState,
  normalizePromptImage,
  previewUrlForImage,
  sameContextUsage,
} from "@/lib/pico/sync"
export { flattenTree } from "@/lib/pico/tree"

export const INITIAL_PROJECT_AGENT_RENDER_COUNT = 5
export const PROJECT_AGENT_LOAD_MORE_COUNT = 5

export type StreamingBehavior = "followUp" | "steer"

export type PromptImage = {
  type?: "image"
  mimeType: string
  data: string
  previewUrl: string
}

export type AgentSummary = {
  path?: string
  id?: string
  cwd?: string
  name?: string
  title: string
  modified?: string
  streaming?: boolean
  unread?: boolean
}

export type ProjectState = {
  path: string
  totalCount: number
  revision: string
}

export type PromptDraftTarget = {
  agentId?: string
  agentFile?: string
  cwd?: string
}

export type AgentEntryIdentity = {
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
  /** Notify toasts with the same ID replace each other. */
  toastId?: string
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
  /** Images in the tool result, for example from reading an image file. */
  images?: ConversationImage[]
  isError: boolean
  running: boolean
}

/**
 * An image in the conversation. `url` is a server path on the machine of the
 * agent (give it to `machineApiUrl`), or a `data:` URL for a prompt that the
 * server has not saved yet.
 */
export type ConversationImage = { mimeType: string; url: string }

type CompactionBlock = {
  type: "compaction"
  blockKey?: string
  renderKey?: string
  summary: string
  tokensBefore: number
  estimatedTokensAfter?: number
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
  forkEntryId?: string
  text: string
  images: Array<ConversationImage>
  queued?: boolean
  streamingBehavior?: StreamingBehavior
}

export type AssistantItem = {
  kind: "assistant"
  itemKey?: string
  renderKey?: string
  branchEntryId?: string
  blocks: Array<AssistantBlock>
  streaming?: boolean
  done?: boolean
  model?: ModelOption
  /** Wall-clock milliseconds when the response request started. */
  startedAt?: number
  /** Wall-clock milliseconds when the response and its tool calls ended. */
  endedAt?: number
}

export type ConversationItem = UserItem | AssistantItem

export type ConversationItemsPatch = {
  previousLength: number
  start: number
  deleteCount: number
  items: Array<ConversationItem>
}

export type ConversationDeltaOperation =
  | {
      op: "replaceItem"
      item: AssistantItem
    }
  | {
      op: "appendBlock"
      contentIndex: number
      blockKey: string
      blockType: "text" | "thinking"
      delta: string
    }
  | {
      op: "replaceBlock"
      contentIndex: number
      block: AssistantBlock
    }
  | {
      op: "updateTool"
      callId: string
      output?: string
      details?: unknown
      isError?: boolean
      running: boolean
    }

export type ConversationDeltaEvent = {
  type: "conversation_delta"
  agentId: string
  operations: Array<ConversationDeltaOperation>
}

export type AgentUiState = {
  statuses: Record<string, string>
  title?: string
  editorText?: string
  workingMessage?: string
}

export type AgentState = {
  connected: boolean
  replaying: boolean
  streaming: boolean
  compacting: boolean
  draft: boolean
  messages: Array<MessagePayload>
  items: Array<ConversationItem>
  historyOffset: number
  historyTotalCount: number
  agentId?: string
  agentKey?: string
  agentName?: string
  firstMessage: string
  agentFile?: string
  cwd?: string
  /** The sidebar project, when it is not `cwd` (worktree agents). */
  project?: string
  modified?: string
  model?: ModelOption
  thinkingLevel: string
  availableThinkingLevels: Array<string>
  availableModels: Array<ModelOption>
  availableSkills: Array<SkillOption>
  hideThinkingBlock: boolean
  contextUsage?: {
    tokens?: number | null
    contextWindow?: number
    percent?: number | null
    /** Tokens where a compaction starts that the turn waits for. */
    compactAt?: number
    /** Tokens where a compaction starts in the background. */
    backgroundAt?: number
    [key: string]: unknown
  }
  uiState: AgentUiState
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
  estimatedTokensAfter?: unknown
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
  agentKey?: string
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
  contextUsage?: AgentState["contextUsage"]
  hideThinkingBlock?: boolean
  model?: ModelOption
  thinkingLevel?: string
  availableThinkingLevels?: Array<string>
  availableModels?: Array<ModelOption>
  availableSkills?: Array<SkillOption>
  agentId?: string
  agentFile?: string
  agentName?: string
  firstMessage?: string
  cwd?: string
  project?: string
  modified?: string
  uiState?: AgentUiState & {
    /** Images to put in the composer, sent one time, for example after a fork. */
    editorImages?: Array<{ mimeType: string; data: string }>
  }
}

export type AgentsPayload = {
  type: "agents"
  projects?: Array<string>
  projectStates?: Array<ProjectState>
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

export function getAgentTitle(summary?: Pick<AgentSummary, "title" | "name">) {
  if (summary?.title?.trim()) return summary.title.trim()
  if (summary?.name?.trim()) return summary.name.trim()
  return "New agent"
}
