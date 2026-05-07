import type {
  DirectoryState,
  MessagePayload,
  PromptImage,
  SessionState,
  SessionsPayload,
  StateSyncPayload,
  TreeNode,
  UiRequest,
} from "@/lib/pico"

export type ApiErrorResponse = {
  ok: false
  error: string
  routePath?: string
}

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
      unpushedCommitShortHashes: Array<string> | null
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

export type DirectorySessionsResponse =
  | {
      ok: true
      directory: string
      totalCount: number
      offset: number
      limit: number
      sessions: Array<SessionListEntry>
    }
  | ApiErrorResponse

export type DirectorySessionsIndexSnapshot = {
  directory: string
  totalCount: number
  revision: string
  sessions: Array<SessionListEntry>
}

export type DirectorySessionsIndexResponse =
  | ({
      ok: true
    } & DirectorySessionsIndexSnapshot)
  | ApiErrorResponse

export type DirectorySessionsIndexesResponse =
  | {
      ok: true
      directories: Array<string>
      directoryIndexes: Record<string, DirectorySessionsIndexSnapshot>
    }
  | ApiErrorResponse

export type DeleteOldDirectorySessionsRequest = {
  directory: string
  olderThanMs: number
  dryRun?: boolean
  includeActiveSession?: boolean
}

export type DeleteOldDirectorySessionsResponse =
  | {
      ok: true
      directory: string
      cutoff: string
      dryRun: boolean
      deletedSessionIds: Array<string>
      matchingSessions: Array<SessionListEntry & { activityAt?: string }>
    }
  | ApiErrorResponse

export type SessionListEntry = {
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
  contextUsage?: SessionState["contextUsage"]
  streaming?: boolean
  unread?: boolean
}

export type SessionsEvent = SessionsPayload & {
  activeSessionPath?: string
  activeSessionId?: string
  activeSessionKey?: string
  directories?: Array<string>
  directoryStates?: Array<DirectoryState>
  directoryIndexes?: Record<string, DirectorySessionsIndexSnapshot>
}

export type SessionStatusEvent = {
  type: "session_status"
  sessionKey?: string
  sessionId?: string
  sessionPath?: string
  streaming?: boolean
  unread?: boolean
}

export type SessionDoneEvent = {
  type: "session_done"
  id: string
  sessionKey?: string
  sessionId?: string
  sessionPath?: string
  cwd?: string
  title?: string
  reason: "agent" | "manual_compaction"
  outcome?: "success" | "error"
  completedAt: string
}

export type PromptResponse =
  | {
      ok: true
      queued: boolean
      pendingId?: string
      canceled?: boolean
    }
  | ApiErrorResponse

export type SimpleOkResponse =
  | {
      ok: true
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

export type ModelResponse =
  | {
      ok: true
      model?: {
        id: string
        provider?: string
        name?: string
        reasoning?: boolean
      }
      thinkingLevel: string
    }
  | ApiErrorResponse

export type ThinkingResponse =
  | {
      ok: true
      thinkingLevel: string
      availableThinkingLevels: Array<string>
    }
  | ApiErrorResponse

export type HideThinkingResponse =
  | {
      ok: true
      hideThinkingBlock: boolean
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

export type SessionHistoryResponse =
  | {
      ok: true
      offset: number
      limit: number
      totalCount: number
      hasMoreBefore: boolean
      messages: Array<MessagePayload>
    }
  | ApiErrorResponse

export type SessionTreeResponse =
  | {
      ok: true
      leafId: string | null
      streamingEntryId?: string | null
      tree: Array<TreeNode>
    }
  | ApiErrorResponse

export type NavigateSessionTreeResponse =
  | {
      ok: true
      cancelled: boolean
      aborted: boolean
      editorText?: string
    }
  | ApiErrorResponse

export type ForkableMessage = {
  entryId: string
  text: string
}

export type ForkableMessagesResponse =
  | {
      ok: true
      messages: Array<ForkableMessage>
    }
  | ApiErrorResponse

export type ForkSessionResponse =
  | {
      ok: true
      cancelled?: boolean
      draft?: boolean
      sessionId?: string
      sessionFile?: string
    }
  | ApiErrorResponse

export type CloneSessionResponse =
  | {
      ok: true
      cancelled?: boolean
      draft?: boolean
      previousSessionFile?: string
      sessionId?: string
      sessionFile?: string
    }
  | ApiErrorResponse

export type RenameSessionResponse =
  | {
      ok: true
      name: string
    }
  | ApiErrorResponse

export type DeleteSessionResponse =
  | {
      ok: true
      sessionId?: string
      sessionFile?: string
    }
  | ApiErrorResponse

export type DeleteSessionsRequest = {
  paths: Array<string>
}

export type DeleteSessionsResponse =
  | {
      ok: true
      deletedPaths: Array<string>
      sessionId?: string
      sessionFile?: string
    }
  | ApiErrorResponse

export type AuthProviderKind = "oauth" | "api_key"

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

export type RequestErrorEvent = {
  type: "request_error"
  scope?: string
  message?: string
  error?: string
}

export type ExtensionErrorEvent = {
  type: "extension_error"
  error?: string
}

export type ExtensionUiEvent = UiRequest & {
  type: "extension_ui_request"
}

export type UserMessageEvent = {
  type: "user_message"
  message?: string
  images?: Array<unknown>
  queued?: boolean
}

export type AutoSessionNamingErrorEvent = {
  type: "auto_session_naming_error"
  sessionId?: string
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

export type PicoServerEvent =
  | StateSyncPayload
  | SessionsEvent
  | SessionStatusEvent
  | SessionDoneEvent
  | RequestErrorEvent
  | ExtensionErrorEvent
  | ExtensionUiEvent
  | UserMessageEvent
  | AutoSessionNamingErrorEvent
  | GitChangedEvent

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

export function isSessionsEvent(value: unknown): value is SessionsEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "sessions"
  )
}

export function isSessionStatusEvent(
  value: unknown
): value is SessionStatusEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "session_status"
  )
}

export function isSessionDoneEvent(value: unknown): value is SessionDoneEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "session_done" &&
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
