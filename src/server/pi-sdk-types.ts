export type UnknownRecord = Record<string, unknown>

export type PromptImageInputLike = {
  type: "image"
  mimeType: string
  data: string
}

export type SessionStartEventLike = {
  type: "session_start"
  reason?: string
  previousSessionFile?: string
}

export type ModelLike = {
  id: string
  provider: string
  name?: string
  reasoning?: boolean
}

export type SkillLike = {
  name: string
  description?: string
  sourceInfo?: {
    scope?: string
    source?: string
  }
}

export type SessionListInfoLike = {
  path?: string
  id?: string
  cwd: string
  name?: string
  modified?: string | Date
  lastUserMessageAt?: string | Date
  lastMessageAt?: string | Date
  lastMessagePreview?: string
  messageCount?: number
  contextUsage?: {
    tokens?: number | null
    contextWindow?: number
    percent?: number | null
    [key: string]: unknown
  }
  firstMessage?: string
}

export type MessageContentPartLike = UnknownRecord & {
  type?: unknown
  text?: unknown
}

export type MessageLike = UnknownRecord & {
  role?: unknown
  content?: unknown
  stopReason?: unknown
  errorMessage?: unknown
  toolCallId?: unknown
  toolName?: unknown
}

export type SessionEventLike = UnknownRecord & {
  type?: unknown
  steering?: unknown
  followUp?: unknown
  message?: MessageLike
}

export type SessionTreeEntryLike = UnknownRecord & {
  id?: unknown
  parentId?: unknown
  timestamp?: unknown
  type?: unknown
  message?: MessageLike
}

export type SessionTreeNodeLike = {
  entry: SessionTreeEntryLike
  children: Array<SessionTreeNodeLike>
  label?: string
  labelTimestamp?: string
}

export type SessionManagerLike = {
  getCwd(): string
  getSessionDir?(): string | undefined
  getSessionName?(): string | undefined
  getTree?(): Array<SessionTreeNodeLike>
  getLeafId?(): string | null
  getEntry?(id: string): SessionTreeEntryLike | undefined
  getLabel?(id: string): string | undefined
  getBranch?(id?: string | null): Array<SessionTreeEntryLike>
  createBranchedSession?(leafId: string): string | undefined
  appendLabelChange?(targetId: string, label?: string): string
  appendSessionInfo?(name: string): string
  newSession?(options?: {
    id?: string
    parentSession?: string
  }): string | undefined
  isPersisted?(): boolean
  getHeader?(): unknown
  fileEntries?: Array<unknown>
  flushed?: boolean
  _buildIndex?(): void
}

export type SettingsManagerLike = {
  getHideThinkingBlock(): boolean
  setHideThinkingBlock(hide: boolean): void
  getGlobalSettings?(): unknown
  getProjectSettings?(): unknown
  getPackages?(): unknown[]
  getExtensionPaths?(): string[]
  getSkillPaths?(): string[]
  getPromptTemplatePaths?(): string[]
  getThemePaths?(): string[]
}

export type ModelRegistryAuthResult =
  | {
      ok: true
      apiKey?: string
      headers?: Record<string, string>
    }
  | {
      ok: false
      error?: string
    }

export type AuthCredentialLike =
  | {
      type: "api_key"
      key: string
    }
  | {
      type: "oauth"
      refresh: string
      access: string
      expires: number
      [key: string]: unknown
    }

export type AuthStorageLike = {
  set(provider: string, credential: AuthCredentialLike): void
  logout(provider: string): void
  list(): Array<string>
  get(provider: string): AuthCredentialLike | undefined
  getAuthStatus?(provider: string): {
    configured: boolean
    source?: string
    label?: string
  }
  getOAuthProviders(): Array<{
    id: string
    name: string
    usesCallbackServer?: boolean
  }>
  login(
    providerId: string,
    callbacks: {
      onAuth?: (info: { url: string; instructions?: string }) => void
      onPrompt?: (prompt: {
        message: string
        placeholder?: string
        allowEmpty?: boolean
      }) => Promise<string>
      onProgress?: (message: string) => void
      onManualCodeInput?: () => Promise<string>
      signal?: AbortSignal
    }
  ): Promise<void>
}

export type ModelRegistryLike = {
  authStorage?: AuthStorageLike
  getAll?(): Array<ModelLike>
  getAvailable(): Array<ModelLike>
  find(provider: string, id: string): ModelLike | undefined
  refresh?(): void
  getApiKeyAndHeaders(model: ModelLike): Promise<ModelRegistryAuthResult>
}

export type ResourceLoaderLike = {
  getSkills(): {
    skills: Array<SkillLike>
  }
}

export type SessionServicesLike = {
  settingsManager: SettingsManagerLike
  modelRegistry: ModelRegistryLike
  resourceLoader: ResourceLoaderLike
  diagnostics: Array<{
    type: string
    message: string
  }>
}

export type AgentSessionLike = {
  agent: {
    waitForIdle(): Promise<void>
  }
  sessionManager: SessionManagerLike
  messages: Array<MessageLike>
  state: {
    streamingMessage?: MessageLike
  }
  model?: ModelLike
  thinkingLevel: string
  sessionFile?: string
  sessionId: string
  sessionName?: string
  isStreaming: boolean
  isRetrying?: boolean
  isCompacting?: boolean
  prompt(
    text: string,
    options?: {
      images?: Array<PromptImageInputLike>
      streamingBehavior?: "steer" | "followUp"
      preflightResult?: (success: boolean) => void
    }
  ): Promise<void>
  abort(): Promise<void>
  abortCompaction?(): void
  abortBranchSummary?(): void
  compact(customInstructions?: string): Promise<unknown>
  setModel(model: ModelLike): Promise<void>
  setThinkingLevel(level: string): void
  getAvailableThinkingLevels(): Array<string>
  getContextUsage(): unknown
  subscribe(listener: (event: SessionEventLike) => void): () => void
  bindExtensions(bindings: Record<string, unknown>): Promise<void>
  dispose(): void
  setSessionName(name: string): void
  navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean
      customInstructions?: string
      replaceInstructions?: boolean
      label?: string
    }
  ): Promise<{
    editorText?: string
    cancelled: boolean
    aborted?: boolean
    summaryEntry?: unknown
  }>
  getUserMessagesForForking?(): Array<{
    entryId: string
    text: string
  }>
  getSteeringMessages?(): readonly string[]
  getFollowUpMessages?(): readonly string[]
  clearQueue(): {
    steering: string[]
    followUp: string[]
  }
  reload?(): Promise<void>
}

export type AgentSessionRuntimeLike = {
  services: SessionServicesLike
  session: AgentSessionLike
  cwd: string
  diagnostics: Array<{
    type: string
    message: string
  }>
  modelFallbackMessage?: string
  switchSession(
    sessionPath: string,
    cwdOverride?: string
  ): Promise<{ cancelled: boolean }>
  newSession(options?: {
    parentSession?: string
    setup?: (sessionManager: SessionManagerLike) => Promise<void>
  }): Promise<{ cancelled: boolean }>
  fork(
    entryId: string,
    options?: {
      position?: "before" | "at"
    }
  ): Promise<{
    cancelled: boolean
    selectedText?: string
  }>
  dispose(): Promise<void>
}

export type PiSdkLike = {
  getAgentDir(): string
  SettingsManager: {
    create(cwd: string, agentDir: string): SettingsManagerLike
  }
  createAgentSessionServices(options: {
    cwd: string
    agentDir: string
    settingsManager: SettingsManagerLike
    resourceLoaderOptions?: {
      noExtensions?: boolean
    }
  }): Promise<SessionServicesLike>
  createAgentSessionFromServices(options: {
    services: SessionServicesLike
    sessionManager: SessionManagerLike
    sessionStartEvent?: SessionStartEventLike
    customTools?: Array<unknown>
  }): Promise<{
    session: AgentSessionLike
  }>
  createAgentSessionRuntime(
    createRuntime: (options: {
      cwd: string
      agentDir: string
      sessionManager: SessionManagerLike
      sessionStartEvent?: SessionStartEventLike
    }) => Promise<{
      session: AgentSessionLike
      services: SessionServicesLike
      diagnostics: Array<{
        type: string
        message: string
      }>
    }>,
    options: {
      cwd: string
      agentDir: string
      sessionManager: SessionManagerLike
      sessionStartEvent?: SessionStartEventLike
    }
  ): Promise<AgentSessionRuntimeLike>
  SessionManager: {
    create(cwd: string, sessionDir?: string): SessionManagerLike
    open(
      path: string,
      sessionDir?: string,
      cwdOverride?: string
    ): SessionManagerLike
    inMemory(cwd?: string): SessionManagerLike
    listAll(): Promise<Array<SessionListInfoLike>>
  }
}

export type PiAiRequestLike = {
  systemPrompt: string
  messages: Array<{
    role: string
    content: Array<{
      type: "text"
      text: string
    }>
    timestamp: number
  }>
}

export type PiAiResponseBlockLike = MessageContentPartLike

export type PiAiResponseLike = UnknownRecord & {
  content?: Array<PiAiResponseBlockLike>
}

export type PiAiModuleLike = {
  complete(
    model: ModelLike,
    request: PiAiRequestLike,
    options: {
      apiKey?: string
      headers?: Record<string, string>
      reasoningEffort?: string
    }
  ): Promise<PiAiResponseLike>
}
