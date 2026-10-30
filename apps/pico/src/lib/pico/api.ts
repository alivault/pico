import type {
  ConversationItem,
  ConversationDeltaEvent,
  ProjectState,
  ModelOption,
  PromptImage,
  AgentState,
  AgentsPayload,
  StateSyncPayload,
  TreeNode,
  UiRequest,
} from "@/lib/pico"

export type ApiErrorResponse = {
  ok: false
  error: string
  routePath?: string
}

export type AgentHistoryResponse =
  | {
      ok: true
      offset: number
      limit: number
      totalCount: number
      hasMoreBefore: boolean
      items: Array<ConversationItem>
    }
  | ApiErrorResponse

export type PiTransport = "auto" | "sse" | "websocket" | "websocket-cached"

export type PiCacheRetention = "standard" | "long"

export type PiPerformanceSettingsResponse =
  | {
      ok: true
      transport: PiTransport
      cacheRetention: PiCacheRetention
      appliesToActiveAgentAfterRestart?: boolean
    }
  | ApiErrorResponse

export type ClientManifestResponse =
  | {
      ok: true
      name: string
      version: string
      displayName: string
      serverProtocolVersion: number
      apiContractVersion: number
      pairingRequired: boolean
      authentication: {
        type: "none" | "bearer"
      }
      transport: {
        sse: boolean
        httpsRequired: boolean
        localHttpAllowed: boolean
      }
      capabilities: {
        events: Array<string>
        endpoints: Array<string>
        features: Array<string>
      }
    }
  | ApiErrorResponse

export type CompletionItem = {
  value: string
  label: string
  description?: string
  isDirectory: boolean
}

export type DirectoryResolveResponse =
  | {
      ok: true
      path: string
    }
  | ApiErrorResponse

export type DirectorySearchResponse =
  | {
      ok: true
      query: string
      totalCount: number
      items: Array<CompletionItem>
    }
  | ApiErrorResponse

export type PathCompletionsResponse =
  | {
      ok: true
      prefix: string
      totalCount: number
      items: Array<CompletionItem>
    }
  | ApiErrorResponse

export type FileCompletionsResponse =
  | {
      ok: true
      query: string
      totalCount: number
      items: Array<CompletionItem>
    }
  | ApiErrorResponse

export type ProjectFileTreeResponse =
  | {
      ok: true
      cwd: string
      totalCount: number
      paths: Array<string>
    }
  | ApiErrorResponse

export type ProjectFileReadResponse =
  | {
      ok: true
      cwd: string
      path: string
      content: string
      /** A hash of the content. A save sends it back to see changes. */
      version: string
    }
  | ApiErrorResponse

export type ProjectFileWriteResponse =
  | {
      ok: true
      cwd: string
      path: string
      version: string
    }
  | ApiErrorResponse

export type GitStatusSummary = {
  branch?: string
  detached: boolean
  revision?: string
  dirty: boolean
  changedFileCount: number
  ahead: number
  behind: number
  inline: string
  label: string
  title: string
}

export type GitStatusResponse =
  | {
      ok: true
      cwd: string
      gitStatus: GitStatusSummary | null
    }
  | ApiErrorResponse

export type GitChangeFile = {
  status: string
  path: string
  previousPath?: string
  linesAdded?: number
  linesDeleted?: number
  sizeBytes?: number
}

export type GitLocalBranch = {
  name: string
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  upstreamGone: boolean
  hash?: string
  subject?: string
  relativeDate?: string
  committerDate?: string
}

export type GitRemoteBranch = {
  name: string
  hash?: string
  subject?: string
  relativeDate?: string
  committerDate?: string
}

export type GitChangesResponse =
  | {
      ok: true
      cwd: string
      files: Array<GitChangeFile> | null
      localBranches: Array<GitLocalBranch> | null
      remoteBranches: Array<GitRemoteBranch> | null
      commits: Array<string> | null
      commitsHasMore: boolean
      commitsLimit: number
      unpushedCommitHashes: Array<string> | null
    }
  | ApiErrorResponse

export type GitCommitDiffMode = "commit" | "head" | "previous"

export type GitCommitDiffResponse =
  | {
      ok: true
      cwd: string
      commit: string
      mode: GitCommitDiffMode
      title: string
      path?: string
      previousPath?: string
      patch: string
    }
  | ApiErrorResponse

export type GitCommitFile = {
  status: string
  path: string
  previousPath?: string
  linesAdded?: number
  linesDeleted?: number
}

export type GitCommitFilesResponse =
  | {
      ok: true
      cwd: string
      commit: string
      files: Array<GitCommitFile>
    }
  | ApiErrorResponse

export type GitCommitRemoteUrlResponse =
  | {
      ok: true
      cwd: string
      commit: string
      remoteUrl: string
    }
  | ApiErrorResponse

export type GitFileDiffResponse =
  | {
      ok: true
      cwd: string
      path: string
      patch: string
    }
  | ApiErrorResponse

export type GitFileReviewResponse =
  | {
      ok: true
      cwd: string
      path: string
      previousPath?: string
      oldContent: string
      newContent: string
      binary?: boolean
    }
  | ApiErrorResponse

export type GitActionResponse =
  | {
      ok: true
      cwd: string
      stdout: string
      stderr: string
      pushedCommitMessages?: Array<string>
    }
  | ApiErrorResponse

export type GitCommitResponse = GitActionResponse

export type GitCommitMessageResponse =
  | {
      ok: true
      cwd: string
      message: string
      source: "ai" | "heuristic"
      reason?: string
    }
  | ApiErrorResponse

export type ProjectAgentsIndexSnapshot = {
  project: string
  totalCount: number
  revision: string
  agents: Array<AgentListEntry>
}

export type ProjectAgentsIndexesResponse =
  | {
      ok: true
      projects: Array<string>
      projectIndexes: Record<string, ProjectAgentsIndexSnapshot>
    }
  | ApiErrorResponse

export type DeleteOldProjectAgentsRequest = {
  project: string
  olderThanMs: number
  dryRun?: boolean
  includeActiveAgent?: boolean
}

export type DeleteOldProjectAgentsResponse =
  | {
      ok: true
      project: string
      cutoff: string
      dryRun: boolean
      deletedAgentIds: Array<string>
      matchingAgents: Array<AgentListEntry & { activityAt?: string }>
    }
  | ApiErrorResponse

export type AgentListEntry = {
  path?: string
  id?: string
  cwd?: string
  name?: string
  title: string
  modified?: string
  lastUserMessageAt?: string
  lastMessageAt?: string
  lastMessagePreview?: string
  messageCount?: number
  contextUsage?: AgentState["contextUsage"]
  streaming?: boolean
  unread?: boolean
  optimistic?: boolean
  /** The agent waits for an answer from the user. */
  needsInput?: boolean
  /** What an idle agent waits on: timers, watches, or jobs. */
  waiting?: string
  /** The agent that spawned this one. */
  parent?: string
  /** The git branch of the agent's own worktree. */
  worktreeBranch?: string
}

export type AgentsEvent = AgentsPayload & {
  activeAgentPath?: string
  activeAgentId?: string
  activeAgentKey?: string
  projects?: Array<string>
  projectStates?: Array<ProjectState>
  projectIndexes?: Record<string, ProjectAgentsIndexSnapshot>
}

export type AgentStatusEvent = {
  type: "agent_status"
  agentKey?: string
  agentId?: string
  agentPath?: string
  streaming?: boolean
  unread?: boolean
  needsInput?: boolean
  /** What the agent waits on; an empty string when it waits on nothing. */
  waiting?: string
}

export type AgentReadStateResponse =
  | {
      ok: true
      path: string
      unread: boolean
    }
  | ApiErrorResponse

export type AgentDoneEvent = {
  type: "agent_done"
  id: string
  agentKey?: string
  agentId?: string
  agentPath?: string
  cwd?: string
  title?: string
  reason: "agent" | "manual_compaction"
  outcome?: "success" | "error"
  completedAt: string
  /** The turn ended, but the agent waits on a timer, a watch, or a job. */
  waiting?: string
}

export type PromptResponse =
  | {
      ok: true
      queued: boolean
      pendingId?: string
      canceled?: boolean
      /** The agent that got the prompt. Older servers do not send it. */
      agentId?: string
      agentPath?: string
    }
  | ApiErrorResponse

export type SimpleOkResponse =
  | {
      ok: true
    }
  | ApiErrorResponse

export type ModelResponse =
  | {
      ok: true
      model?: ModelOption
      thinkingLevel?: string
      availableThinkingLevels?: Array<string>
      availableModels?: Array<ModelOption>
    }
  | ApiErrorResponse

export type AgentNewResponse =
  | {
      ok: true
      draft: true
      agentKey: string
      cwd?: string
    }
  | ApiErrorResponse

export type PendingMessagesResponse =
  | {
      ok: true
      pendingMessages: Array<{
        pendingId: string
        text: string
        images: Array<Pick<PromptImage, "type" | "mimeType" | "data">>
        streamingBehavior: "steer" | "followUp"
      }>
    }
  | ApiErrorResponse

export type PendingMessageRemoveResponse =
  | {
      ok: true
      pendingId: string
    }
  | ApiErrorResponse

export type ThinkingResponse =
  | {
      ok: true
      thinkingLevel: string
      availableThinkingLevels: Array<string>
    }
  | ApiErrorResponse

export type HighlightResponse =
  | ({
      ok: true
      language?: string
    } & (
      | {
          html: string
        }
      | {
          skipped: true
        }
      | {
          unsupported: true
        }
      | {
          unavailable: true
        }
    ))
  | ApiErrorResponse

export type TerminalBackend = "shell"

export type TerminalCreateResponse =
  | {
      ok: true
      backend: TerminalBackend
      id: string
      cwd: string
      shell: string
      reused: boolean
      /** The job's name, for a tab that shows a background job. */
      label?: string
      jobId?: string
    }
  | ApiErrorResponse

export type TerminalEvent =
  | {
      type: "ready"
      backend: TerminalBackend
      id: string
      cwd: string
      shell: string
      nextInputSeq?: number
      /** Output up to this seq is replay: its queries are old. */
      replayUntilSeq?: number
      label?: string
      jobId?: string
    }
  | {
      type: "output"
      data: string
      seq?: number
    }
  | {
      type: "input_ack"
      inputSeq: number
    }
  | {
      type: "pong"
    }
  | {
      type: "reset"
      reason: "backlog_gap"
      firstSeq: number
      nextSeq: number
    }
  | {
      type: "exit"
      exitCode: number
      signal?: number
    }
  | {
      type: "error"
      error: string
    }

export type AgentTreeResponse =
  | {
      ok: true
      leafId: string | null
      streamingEntryId?: string | null
      tree: Array<TreeNode>
    }
  | ApiErrorResponse

export type NavigateAgentTreeResponse =
  | {
      ok: true
      cancelled: boolean
      aborted: boolean
      editorText?: string
    }
  | ApiErrorResponse

type ForkableMessage = {
  entryId: string
  text: string
}

export type ForkableMessagesResponse =
  | {
      ok: true
      messages: Array<ForkableMessage>
    }
  | ApiErrorResponse

export type ForkAgentResponse =
  | {
      ok: true
      cancelled?: boolean
      draft?: boolean
      agentKey?: string
      agentId?: string
      agentFile?: string
    }
  | ApiErrorResponse

export type CloneAgentResponse =
  | {
      ok: true
      cancelled?: boolean
      draft?: boolean
      previousAgentFile?: string
      agentId?: string
      agentFile?: string
    }
  | ApiErrorResponse

export type RenameAgentResponse =
  | {
      ok: true
      name: string
    }
  | ApiErrorResponse

export type GenerateAgentNameResponse =
  | {
      ok: true
      name: string
      source: "llm" | "heuristic"
      reason?: string
    }
  | ApiErrorResponse

export type MoveAgentResponse =
  | {
      ok: true
      previousPath: string
      previousCwd?: string
      path: string
      cwd: string
      agentId?: string
    }
  | ApiErrorResponse

export type DeleteAgentsRequest = {
  paths: Array<string>
}

export type DeleteAgentsResponse =
  | {
      ok: true
      deletedPaths: Array<string>
      agentId?: string
      agentFile?: string
    }
  | ApiErrorResponse

export type ArchivedAgentEntry = AgentListEntry & {
  /** The sidebar project the agent returns to on restore. */
  project: string
  archivedAt?: string
}

export type ArchivedAgentsResponse =
  | {
      ok: true
      agents: Array<ArchivedAgentEntry>
    }
  | ApiErrorResponse

export type RestoreAgentResponse =
  | {
      ok: true
      path: string
      project: string
    }
  | ApiErrorResponse

type AuthProviderKind = "oauth" | "api_key"

export type AuthProviderOption = {
  id: string
  name: string
  authType: AuthProviderKind
  configured: boolean
  source?: string
  label?: string
}

export type AuthProvidersResponse =
  | {
      ok: true
      oauthProviders: Array<AuthProviderOption>
      apiKeyProviders: Array<AuthProviderOption>
      loggedInProviders: Array<AuthProviderOption>
      availableModels: Array<{
        id: string
        provider?: string
        name?: string
        reasoning?: boolean
      }>
    }
  | ApiErrorResponse

export type AuthMutationResponse =
  | {
      ok: true
      provider: string
      availableModels: Array<{
        id: string
        provider?: string
        name?: string
        reasoning?: boolean
      }>
    }
  | ApiErrorResponse

export type UiRequestResponse =
  | {
      ok: true
    }
  | ApiErrorResponse

type RequestErrorEvent = {
  type: "request_error"
  scope?: string
  message?: string
  error?: string
}

type ExtensionErrorEvent = {
  type: "extension_error"
  error?: string
}

export type ExtensionUiEvent = UiRequest & {
  type: "extension_ui_request"
}

/** The server no longer waits for the request: close its dialog. */
export type ExtensionUiDismissEvent = {
  type: "extension_ui_dismiss"
  id: string
}

export function uiRequestExpectsResponse(method: unknown): boolean {
  switch (method) {
    case "auth":
    case "auth_input":
    case "auth_select":
    case "confirm":
    case "editor":
    case "input":
    case "select":
      return true
    default:
      return false
  }
}

type UserMessageEvent = {
  type: "user_message"
  message?: string
  images?: Array<unknown>
  queued?: boolean
}

type AutoAgentNamingErrorEvent = {
  type: "auto_agent_naming_error"
  agentId?: string
  cwd?: string
  promptPreview?: string
  imageCount?: number
  heuristicReason?: string
  refinementReason?: string
}

export type GitChangedScope = "status" | "files" | "refs"

export type GitChangedEvent = {
  type: "git_changed"
  cwd: string
  repositoryRoot?: string
  changedAt: number
  scopes?: Array<GitChangedScope>
}

export type AgentExtensionsEvent = {
  type: "agent_extensions"
  agentId: string
  kind?: string
}

/** The sidebar layout that all devices share. */
export type SidebarStateSnapshot = {
  projects: Array<string>
  pinnedAgentKeys: Array<string>
  collapsedProjects: Record<string, boolean>
  revision: number
  initialized: boolean
}

export type SidebarStateEvent = SidebarStateSnapshot & {
  type: "sidebar_state"
  /** The page that made the change. */
  clientId: string
}

export type PicoServerEvent =
  | StateSyncPayload
  | ConversationDeltaEvent
  | AgentsEvent
  | AgentStatusEvent
  | AgentDoneEvent
  | RequestErrorEvent
  | ExtensionErrorEvent
  | ExtensionUiEvent
  | ExtensionUiDismissEvent
  | UserMessageEvent
  | AutoAgentNamingErrorEvent
  | GitChangedEvent
  | AgentExtensionsEvent
  | SidebarStateEvent

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  )
}

export function isStateSyncEvent(value: unknown): value is StateSyncPayload {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "state_sync"
  )
}

export function isConversationDeltaEvent(
  value: unknown
): value is ConversationDeltaEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "conversation_delta" &&
    Array.isArray((value as { operations?: unknown }).operations)
  )
}

export function isAgentsEvent(value: unknown): value is AgentsEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "agents"
  )
}

export function isAgentStatusEvent(value: unknown): value is AgentStatusEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "agent_status"
  )
}

export function isAgentDoneEvent(value: unknown): value is AgentDoneEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "agent_done" &&
    typeof (value as { id?: unknown }).id === "string"
  )
}

export function isGitChangedEvent(value: unknown): value is GitChangedEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "git_changed" &&
    typeof (value as { cwd?: unknown }).cwd === "string"
  )
}
