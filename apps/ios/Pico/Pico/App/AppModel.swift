import Foundation
import Observation
import UserNotifications

@MainActor
@Observable
public final class AppModel {
  @ObservationIgnored private let apiClient: PicoAPIClient
  @ObservationIgnored private let eventStream: PicoEventStream
  @ObservationIgnored private let connectionStore: ConnectionStore
  @ObservationIgnored private let draftStore: DraftStore
  @ObservationIgnored private let sessionDoneNotifications = SessionDoneNotificationClient()
  @ObservationIgnored private var eventTask: Task<Void, Never>?
  @ObservationIgnored private var directoryIndexRefreshSignature = ""
  @ObservationIgnored private var pendingSessionDeepLink: PicoSessionDeepLink?
  @ObservationIgnored private var isSceneActive = true
  @ObservationIgnored private var notifiedSessionDoneIds = Set<String>()
  @ObservationIgnored private var compactAbortRequested = false
  @ObservationIgnored private var gitStatusTask: Task<Void, Never>?
  @ObservationIgnored private var gitStatusCwd: String?
  @ObservationIgnored private var gitBranchesTask: Task<Void, Never>?
  @ObservationIgnored private var gitBranchesCwd: String?

  private static let preferredModelProvider = "openai-codex"
  private static let preferredModelId = "gpt-5.5"
  private static let preferredThinkingLevel = "xhigh"

  private static let fallbackThinkingLevels = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]

  private struct PromptOptimisticRollback {
    var isComposingNewSession: Bool
    var composerSelectedDirectory: String?
    var composerImages: [PromptImage]
    var sessionState: SessionState
  }

  public var serverURLText: String
  public private(set) var baseURL: URL?
  public private(set) var manifest: ClientManifest?
  public private(set) var connectionStatus: ConnectionStatus = .disconnected
  public private(set) var authProviders: AuthProvidersResponse?
  public private(set) var isLoadingAuthProviders = false
  public var authMutationProviderId: String?
  public var activeUiRequest: UiRequest?
  public var sessionState = SessionState()
  public var sessionsEvent: SessionsEvent?
  public var supplementalDirectoryIndexes: [String: DirectorySessionsIndexSnapshot] = [:]
  public var loadingDirectorySessionIndexes = Set<String>()
  public var sidebarDirectories: [String]
  public var selectedSessionId: String?
  public private(set) var loadingSessionTitle: String?
  public private(set) var loadingSessionCwd: String?
  public var isComposingNewSession = true
  public var composerText = ""
  public var composerImages: [PromptImage] = []
  public var composerSelectedModel: ModelOption?
  public var composerSelectedDirectory: String?
  public var selectedStreamingBehavior: StreamingBehavior = .steer
  public var alert: AppAlert?
  public var isSubmitting = false
  public var lastSessionDoneEvent: SessionDoneEvent?
  public var conversationPresentationRequest = 0
  public var hideToolBlocks: Bool
  public private(set) var currentGitStatus: GitStatusSummary?
  public private(set) var currentGitLocalBranches: [GitLocalBranch] = []
  public private(set) var isLoadingGitBranches = false
  public private(set) var isCheckingOutGitBranch = false

  public init(
    apiClient: PicoAPIClient = PicoAPIClient(),
    eventStream: PicoEventStream = PicoEventStream(),
    connectionStore: ConnectionStore = ConnectionStore(),
    draftStore: DraftStore = DraftStore()
  ) {
    self.apiClient = apiClient
    self.eventStream = eventStream
    self.connectionStore = connectionStore
    self.draftStore = draftStore
    serverURLText = connectionStore.serverURLText
    sidebarDirectories = connectionStore.sidebarDirectories
    hideToolBlocks = connectionStore.hideToolBlocks
    sessionDoneNotifications.deepLinkHandler = { [weak self] url in
      self?.handleDeepLink(url)
    }
  }

  public var isConnected: Bool {
    baseURL != nil && manifest != nil
  }

  public var connectionDetail: String {
    switch connectionStatus {
    case .failed(let message):
      message
    default:
      manifest.map { "\($0.displayName) \($0.version)" } ?? "Enter a Pico server URL."
    }
  }

  public var sessionSnapshots: [DirectorySessionsIndexSnapshot] {
    let directories = Self.uniqueDirectories(sidebarDirectories)
    guard !directories.isEmpty else { return [] }

    let sidebarDirectorySet = Set(directories)
    var indexes = supplementalDirectoryIndexes.filter {
      sidebarDirectorySet.contains($0.key)
    }
    for (directory, snapshot) in sessionsEvent?.directoryIndexes ?? [:]
      where sidebarDirectorySet.contains(directory) {
      indexes[directory] = snapshot
    }

    let activeEntry = activeSessionListEntry
    let activeDirectory = activeEntry?.cwd?
      .trimmingCharacters(in: .whitespacesAndNewlines)

    return directories.map { directory in
      var snapshot = indexes[directory] ?? DirectorySessionsIndexSnapshot(
        directory: directory,
        totalCount: 0,
        revision: "local",
        sessions: []
      )

      if let activeEntry,
         activeDirectory == directory,
         !snapshot.sessions.contains(
           where: { Self.sessionListEntry($0, matches: activeEntry) }
         ) {
        snapshot.sessions.insert(activeEntry, at: 0)
        snapshot.totalCount = max(snapshot.totalCount, snapshot.sessions.count)
        snapshot.revision = "\(snapshot.revision):active:\(activeEntry.id)"
      }

      return snapshot
    }
  }

  public var knownDirectories: [String] {
    Self.uniqueDirectories(
      sidebarDirectories +
        (sessionsEvent?.directories ?? []) +
        sessionSnapshots.map(\.directory) +
        [sessionState.cwd].compactMap { $0 }
    )
  }

  public var composerModel: ModelOption? {
    composerSelectedModel ??
      sessionState.model ??
      Self.preferredModel(in: sessionState.availableModels)
  }

  public var composerDirectory: String {
    composerSelectedDirectory ??
      sessionState.cwd ??
      knownDirectories.first ??
      DirectoryPathFormatter.homePrefix
  }

  public var composerGitStatus: GitStatusSummary? {
    guard canEditComposerSessionOptions,
          let directory = Self.normalizedText(composerDirectory),
          directory == gitStatusCwd else {
      return nil
    }

    return currentGitStatus
  }

  public var composerGitBranchLabel: String? {
    guard let composerGitStatus else { return nil }
    return Self.branchGitStatusText(composerGitStatus)
  }

  public var composerGitLocalBranches: [GitLocalBranch] {
    guard canEditComposerSessionOptions,
          let directory = Self.normalizedText(composerDirectory),
          directory == gitBranchesCwd else {
      return []
    }

    return currentGitLocalBranches
  }

  public var composerThinkingLevels: [String] {
    Self.thinkingLevels(
      for: composerModel,
      available: sessionState.availableThinkingLevels
    )
  }

  public var canEditComposerSessionOptions: Bool {
    isComposingNewSession ||
      sessionState.draft ||
      (!sessionState.streaming &&
        sessionState.sessionId == nil &&
        sessionState.items.isEmpty)
  }

  public var remainingComposerImageSlots: Int {
    max(0, 8 - composerImages.count)
  }

  public var conversationItems: [ConversationItem] {
    isComposingNewSession ? [] : sessionState.items
  }

  public var conversationTitle: String {
    if isLoadingSelectedSession {
      return loadingSessionTitle ?? "Loading session"
    }

    return conversationItems.isEmpty ? "New session" : sessionState.displayTitle
  }

  public var conversationHeaderSubtitle: String? {
    var parts: [String] = []

    if let directory = Self.normalizedText(conversationHeaderDirectory) {
      parts.append(DirectoryPathFormatter.folderName(directory))
    }

    if let gitStatus = visibleGitStatus,
       let gitStatusText = Self.headerGitStatusText(gitStatus) {
      parts.append(gitStatusText)
    }

    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  public var conversationWorkingLabel: String {
    if sessionState.streaming,
       sessionState.hideThinkingBlock,
       let hiddenThinkingPreview = normalizedLabel(sessionState.hiddenThinkingPreview) {
      return hiddenThinkingPreview
    }

    return normalizedLabel(sessionState.uiState.workingMessage) ?? "Working…"
  }

  public var isLoadingSelectedSession: Bool {
    !isComposingNewSession && selectedSessionId != nil && sessionState.replaying
  }

  public var canRenameCurrentSession: Bool {
    !isComposingNewSession && !isLoadingSelectedSession && currentSessionPath != nil
  }

  public var canDeleteCurrentSession: Bool {
    canRenameCurrentSession && !sessionState.streaming && !isSubmitting
  }

  public var currentSessionRenameTitle: String {
    if let name = sessionState.sessionName?.trimmingCharacters(in: .whitespacesAndNewlines),
       !name.isEmpty {
      return name
    }

    return sessionState.displayTitle
  }

  private var conversationHeaderDirectory: String? {
    if isLoadingSelectedSession {
      return loadingSessionCwd
    }

    if isComposingNewSession || sessionState.draft {
      return composerSelectedDirectory ?? sessionState.cwd
    }

    return sessionState.cwd
  }

  private var visibleGitStatus: GitStatusSummary? {
    guard let directory = Self.normalizedText(conversationHeaderDirectory),
          directory == gitStatusCwd else {
      return nil
    }

    return currentGitStatus
  }

  private var activeSessionListEntry: SessionListEntry? {
    guard !isComposingNewSession,
          let cwd = sessionState.cwd?.trimmingCharacters(in: .whitespacesAndNewlines),
          !cwd.isEmpty,
          sessionState.streaming ||
          !sessionState.items.isEmpty ||
          !sessionState.firstMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return nil
    }

    let preview = lastUserMessagePreview ?? sessionState.firstMessage
    return SessionListEntry(
      path: sessionState.sessionFile,
      sessionId: sessionState.sessionId,
      cwd: cwd,
      name: sessionState.sessionName,
      title: sessionState.displayTitle,
      modified: sessionState.modified,
      lastMessagePreview: preview.isEmpty ? nil : preview,
      messageCount: max(sessionState.historyTotalCount, sessionState.items.count),
      contextUsage: sessionState.contextUsage,
      streaming: sessionState.streaming,
      optimistic: sessionState.sessionId == nil && sessionState.sessionFile == nil
    )
  }

  private var lastUserMessagePreview: String? {
    for item in sessionState.items.reversed() {
      guard case .user(let user) = item else { continue }
      let text = user.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty { return text }
    }

    return nil
  }

  public func restoreConnection() async {
    guard baseURL == nil, connectionStore.hasSavedServerURL else { return }
    await connect()
  }

  public func connect() async {
    guard let url = Self.normalizedServerURL(from: serverURLText) else {
      alert = AppAlert(
        title: "Invalid URL",
        message: "Enter a Pico server URL such as http://localhost:3141."
      )
      return
    }

    connectionStatus = .connecting
    setDirectorySessionIndexesLoading(
      missingDirectorySessionIndexDirectories(sidebarDirectories),
      loading: true
    )

    do {
      let manifest = try await apiClient.manifest(baseURL: url)
      self.manifest = manifest
      baseURL = url
      serverURLText = url.absoluteString
      connectionStore.saveServerURL(url)
      connectionStatus = .connected
      beginNewChat()
      await refreshAuthProviders()
      await prepareSessionDoneNotifications()
      await openPendingSessionDeepLinkIfNeeded()
    } catch {
      let message = Self.message(for: error)
      connectionStatus = .failed(message)
      loadingDirectorySessionIndexes = []
      alert = AppAlert(title: "Connection failed", message: message)
    }
  }

  public func setSceneActive(_ active: Bool) {
    isSceneActive = active
  }

  public func prepareSessionDoneNotifications() async {
    await sessionDoneNotifications.requestAuthorizationIfNeeded()
  }

  public func handleDeepLink(_ url: URL) {
    guard let deepLink = PicoSessionDeepLink(url: url) else { return }

    Task {
      await openSession(from: deepLink)
    }
  }

  public func disconnect() {
    eventTask?.cancel()
    eventTask = nil
    clearGitStatus()
    baseURL = nil
    manifest = nil
    connectionStatus = .disconnected
    authProviders = nil
    activeUiRequest = nil
    composerSelectedDirectory = nil
    composerSelectedModel = nil
    composerImages = []
    isComposingNewSession = true
    loadingSessionTitle = nil
    loadingSessionCwd = nil
    supplementalDirectoryIndexes = [:]
    loadingDirectorySessionIndexes = []
    directoryIndexRefreshSignature = ""
    pendingSessionDeepLink = nil
    sessionState = SessionState()
    sessionsEvent = nil
  }

  @discardableResult
  public func selectSession(_ entry: SessionListEntry) async -> Bool {
    let selectionSessionId = Self.normalizedText(entry.sessionId)
    let selectionSessionPath = Self.normalizedText(entry.path)
    guard selectionSessionId != nil || selectionSessionPath != nil else {
      return false
    }
    guard let baseURL else { return false }

    let selectionId = selectionSessionId ?? selectionSessionPath
    let previousSelectedSessionId = selectedSessionId
    let previousLoadingSessionTitle = loadingSessionTitle
    let previousLoadingSessionCwd = loadingSessionCwd
    let previousIsComposingNewSession = isComposingNewSession
    let previousComposerText = composerText
    let previousComposerSelectedDirectory = composerSelectedDirectory
    let previousComposerSelectedModel = composerSelectedModel
    let previousSessionState = sessionState
    let previousEventSessionId = previousIsComposingNewSession || previousSessionState.draft
      ? nil
      : previousSessionState.sessionId ?? previousSelectedSessionId
    let previousEventSessionKey = previousEventSessionId == nil
      ? previousSessionState.sessionKey
      : nil

    eventTask?.cancel()
    eventTask = nil
    selectedSessionId = selectionId
    loadingSessionTitle = entry.title
    loadingSessionCwd = entry.cwd
    isComposingNewSession = false
    composerText = ""
    composerImages = []
    composerSelectedDirectory = nil
    composerSelectedModel = nil
    sessionState = SessionState(connected: sessionState.connected)
    refreshConversationGitStatusIfNeeded()

    do {
      _ = try await apiClient.selectSession(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: selectionSessionId,
        sessionPath: selectionSessionPath
      )
      startEvents(
        sessionId: selectionSessionId,
        sessionKey: selectionSessionId == nil ? selectionSessionPath : nil
      )
      return true
    } catch {
      selectedSessionId = previousSelectedSessionId
      loadingSessionTitle = previousLoadingSessionTitle
      loadingSessionCwd = previousLoadingSessionCwd
      isComposingNewSession = previousIsComposingNewSession
      composerText = previousComposerText
      composerSelectedDirectory = previousComposerSelectedDirectory
      composerSelectedModel = previousComposerSelectedModel
      sessionState = previousSessionState
      refreshConversationGitStatusIfNeeded()
      startEvents(sessionId: previousEventSessionId, sessionKey: previousEventSessionKey)
      alert = AppAlert(
        title: "Could not select session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  @discardableResult
  public func renameCurrentSession(to name: String) async -> Bool {
    guard let baseURL else { return false }
    guard let path = currentSessionPath else { return false }

    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedName.isEmpty else {
      alert = AppAlert(
        title: "Name required",
        message: "Enter a name for this session."
      )
      return false
    }

    do {
      _ = try await apiClient.renameSession(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        path: path,
        name: trimmedName
      )
      sessionState.sessionName = trimmedName
      return true
    } catch {
      alert = AppAlert(
        title: "Could not rename session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  @discardableResult
  public func deleteCurrentSession() async -> Bool {
    guard let baseURL else { return false }
    guard let path = currentSessionPath else { return false }

    let fallbackCwd = sessionState.cwd
    do {
      _ = try await apiClient.deleteSession(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        path: path
      )
      beginNewChat(cwd: fallbackCwd)
      return true
    } catch {
      alert = AppAlert(
        title: "Could not delete session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  @discardableResult
  public func renameSession(_ entry: SessionListEntry, to name: String) async -> Bool {
    guard let baseURL else { return false }
    guard let path = Self.sessionPath(for: entry) else { return false }

    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedName.isEmpty else {
      alert = AppAlert(
        title: "Name required",
        message: "Enter a name for this session."
      )
      return false
    }

    let renamesFocusedSession = isFocusedSession(entry)
    do {
      _ = try await apiClient.renameSession(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        path: path,
        name: trimmedName
      )
      if renamesFocusedSession {
        sessionState.sessionName = trimmedName
      }
      await refreshSidebarSessionsAfterSessionMutation()
      return true
    } catch {
      alert = AppAlert(
        title: "Could not rename session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  @discardableResult
  public func deleteSession(_ entry: SessionListEntry) async -> Bool {
    guard let baseURL else { return false }
    guard let path = Self.sessionPath(for: entry) else { return false }

    let deletesFocusedSession = isFocusedSession(entry)
    let fallbackCwd = entry.cwd ?? sessionState.cwd
    do {
      _ = try await apiClient.deleteSession(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        path: path
      )
      if deletesFocusedSession {
        beginNewChat(cwd: fallbackCwd)
      }
      await refreshSidebarSessionsAfterSessionMutation()
      return true
    } catch {
      alert = AppAlert(
        title: "Could not delete session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  @discardableResult
  public func createSession(cwd: String? = nil) async -> Bool {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before creating a session."
      )
      return false
    }

    let requestedCwd = cwd?.trimmingCharacters(in: .whitespacesAndNewlines)
    let targetCwd = requestedCwd?.isEmpty == false ? requestedCwd : sessionState.cwd
    let wasComposingNewSession = isComposingNewSession || sessionState.draft

    do {
      let response = try await apiClient.createSession(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        cwd: targetCwd
      )
      let responseCwd = response.cwd ?? targetCwd

      let previousState = sessionState
      let targetModel = composerSelectedModel ??
        (wasComposingNewSession ? previousState.model : nil) ??
        Self.preferredModel(in: previousState.availableModels) ??
        previousState.model
      let targetThinkingLevel = Self.clampedThinkingLevel(
        wasComposingNewSession ? previousState.thinkingLevel : Self.preferredThinkingLevel,
        model: targetModel,
        available: previousState.availableThinkingLevels
      )
      sessionState = SessionState(
        connected: previousState.connected,
        draft: response.draft,
        sessionKey: response.sessionKey,
        cwd: responseCwd,
        model: targetModel,
        thinkingLevel: targetThinkingLevel,
        availableThinkingLevels: previousState.availableThinkingLevels,
        availableModels: previousState.availableModels,
        availableSkills: previousState.availableSkills,
        hideThinkingBlock: previousState.hideThinkingBlock
      )
      selectedSessionId = nil
      loadingSessionTitle = nil
      loadingSessionCwd = nil
      isComposingNewSession = false
      composerSelectedDirectory = responseCwd
      refreshConversationGitStatusIfNeeded()
      startEvents(sessionId: nil, sessionKey: response.sessionKey)
      return true
    } catch {
      alert = AppAlert(
        title: "Could not create session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func createSession(directoryInput: String) async -> Bool {
    do {
      let directory = try await resolveDirectoryPath(directoryInput)
      return await createSession(cwd: directory)
    } catch {
      alert = AppAlert(
        title: "Could not create session",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func beginNewChat(cwd: String? = nil, restartEvents: Bool = true) {
    let previousState = sessionState
    let targetCwd = cwd ??
      composerSelectedDirectory ??
      previousState.cwd ??
      knownDirectories.first ??
      DirectoryPathFormatter.homePrefix
    let targetModel = composerSelectedModel ??
      Self.preferredModel(in: previousState.availableModels) ??
      previousState.model
    let targetThinkingLevel = Self.clampedThinkingLevel(
      Self.preferredThinkingLevel,
      model: targetModel,
      available: previousState.availableThinkingLevels
    )

    selectedSessionId = nil
    loadingSessionTitle = nil
    loadingSessionCwd = nil
    isComposingNewSession = true
    composerText = ""
    composerImages = []
    composerSelectedDirectory = targetCwd
    composerSelectedModel = targetModel
    sessionState = SessionState(
      connected: previousState.connected || isConnected,
      replaying: false,
      cwd: targetCwd,
      model: targetModel,
      thinkingLevel: targetThinkingLevel,
      availableThinkingLevels: previousState.availableThinkingLevels,
      availableModels: previousState.availableModels,
      availableSkills: previousState.availableSkills,
      hideThinkingBlock: previousState.hideThinkingBlock
    )

    refreshConversationGitStatusIfNeeded()

    if restartEvents, baseURL != nil {
      startEvents(sessionId: nil)
    }
  }

  @discardableResult
  public func startBlankSession(cwd: String? = nil) async -> Bool {
    beginNewChat(cwd: cwd, restartEvents: false)
    return true
  }

  public func selectComposerDirectory(_ directory: String) async {
    let normalizedDirectory = DirectoryPathFormatter.normalizedDirectoryPrefix(directory)
    composerSelectedDirectory = normalizedDirectory

    if canEditComposerSessionOptions {
      refreshConversationGitStatusIfNeeded()
    } else {
      _ = await createSession(directoryInput: normalizedDirectory)
    }
  }

  public func refreshComposerGitBranches(force: Bool = false) {
    guard canEditComposerSessionOptions,
          let cwd = Self.normalizedText(composerDirectory),
          baseURL != nil else {
      clearGitBranches()
      return
    }
    guard force || cwd != gitBranchesCwd else { return }

    gitBranchesTask?.cancel()
    gitBranchesCwd = cwd
    currentGitLocalBranches = []
    isLoadingGitBranches = true

    gitBranchesTask = Task { [weak self] in
      guard let self else { return }
      await self.loadGitBranches(cwd: cwd)
    }
  }

  @discardableResult
  public func checkoutComposerGitBranch(_ branch: GitLocalBranch) async -> Bool {
    if branch.current { return true }
    return await checkoutComposerGitBranch(named: branch.name, create: false)
  }

  @discardableResult
  public func createComposerGitBranch(named branchName: String) async -> Bool {
    await checkoutComposerGitBranch(named: branchName, create: true)
  }

  private func checkoutComposerGitBranch(
    named rawBranchName: String,
    create: Bool
  ) async -> Bool {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before switching branches."
      )
      return false
    }
    guard let cwd = Self.normalizedText(composerDirectory) else {
      alert = AppAlert(
        title: "No directory selected",
        message: "Choose a session directory before switching branches."
      )
      return false
    }

    let branchName = rawBranchName.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !branchName.isEmpty, !isCheckingOutGitBranch else { return false }

    isCheckingOutGitBranch = true
    defer { isCheckingOutGitBranch = false }

    do {
      _ = try await apiClient.checkoutGitBranch(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        cwd: cwd,
        branch: branchName,
        create: create
      )
      refreshConversationGitStatusIfNeeded(force: true)
      refreshComposerGitBranches(force: true)
      return true
    } catch {
      alert = AppAlert(
        title: create ? "Could not create branch" : "Could not switch branch",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func selectComposerModel(_ model: ModelOption) async {
    composerSelectedModel = model
    sessionState.thinkingLevel = Self.clampedThinkingLevel(
      sessionState.thinkingLevel,
      model: model,
      available: sessionState.availableThinkingLevels
    )

    if !canEditComposerSessionOptions {
      _ = await setModel(model)
    }
  }

  public func addComposerImage(data: Data, mimeType: String) {
    guard remainingComposerImageSlots > 0 else {
      alert = AppAlert(
        title: "Attachment limit reached",
        message: "You can attach up to 8 images to a prompt."
      )
      return
    }

    let normalizedMimeType = mimeType.trimmingCharacters(in: .whitespacesAndNewlines)
    guard normalizedMimeType.lowercased().hasPrefix("image/") else {
      alert = AppAlert(
        title: "Unsupported file",
        message: "Pico currently supports image attachments from iPhone."
      )
      return
    }

    composerImages.append(
      PromptImage(
        mimeType: normalizedMimeType,
        data: data.base64EncodedString()
      )
    )
  }

  public func removeComposerImage(_ image: PromptImage) {
    composerImages.removeAll { $0.id == image.id }
  }

  @discardableResult
  public func submitComposerPrompt(
    streamingBehavior: StreamingBehavior? = nil
  ) async -> Bool {
    let trimmedPrompt = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    let images = composerImages
    guard !trimmedPrompt.isEmpty || !images.isEmpty else {
      alert = AppAlert(
        title: "Message required",
        message: "Enter a message or attach an image before sending."
      )
      return false
    }

    let targetModel = composerModel
    if canEditComposerSessionOptions {
      guard let targetModel else {
        alert = AppAlert(
          title: "No model available",
          message: "Authenticate a provider in Settings, then choose a model."
        )
        return false
      }

      let normalizedComposerDirectory = DirectoryPathFormatter.normalizedDirectoryPrefix(
        composerDirectory
      )
      let normalizedSessionDirectory = DirectoryPathFormatter.normalizedDirectoryPrefix(
        sessionState.cwd ?? ""
      )
      let needsNewSession = isComposingNewSession ||
        requestSessionId == nil && requestSessionKey == nil ||
        normalizedComposerDirectory != normalizedSessionDirectory

      if needsNewSession {
        let created = await createSession(directoryInput: composerDirectory)
        guard created else { return false }
      }

      if targetModel != sessionState.model {
        let updatedModel = await setModel(targetModel)
        guard updatedModel else { return false }
      }
    }

    if sessionState.streaming {
      return await submitPrompt(
        message: trimmedPrompt,
        images: images,
        streamingBehavior: streamingBehavior
      )
    }

    let rollback = applyOptimisticSubmittedPrompt(
      trimmedPrompt,
      images: images,
      clearComposerDirectory: true
    )
    let submitted = await submitPrompt(
      message: trimmedPrompt,
      images: images,
      streamingBehavior: streamingBehavior
    )
    if !submitted {
      restoreOptimisticSubmittedPrompt(rollback)
    }
    return submitted
  }

  public func startNewSession(
    prompt: String,
    directoryInput: String,
    model selectedModel: ModelOption?
  ) async -> Bool {
    let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPrompt.isEmpty else {
      alert = AppAlert(
        title: "Prompt required",
        message: "Enter a message to start the session."
      )
      return false
    }

    let requestedModel = selectedModel ??
      Self.preferredModel(in: sessionState.availableModels) ??
      sessionState.model
    guard let requestedModel else {
      alert = AppAlert(
        title: "No model available",
        message: "Authenticate a provider in Settings, then choose a model for the new session."
      )
      return false
    }

    let created = await createSession(directoryInput: directoryInput)
    guard created else { return false }

    if requestedModel != sessionState.model {
      let updatedModel = await setModel(requestedModel)
      guard updatedModel else { return false }
    }

    composerText = trimmedPrompt
    let rollback = applyOptimisticSubmittedPrompt(
      trimmedPrompt,
      images: [],
      clearComposerDirectory: true
    )
    let submitted = await submitPrompt(message: trimmedPrompt, images: [])
    if !submitted {
      restoreOptimisticSubmittedPrompt(rollback)
    }
    return submitted
  }

  public func addDirectory(_ directoryInput: String) async -> Bool {
    guard baseURL != nil else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before adding a directory."
      )
      return false
    }

    let requestedDirectory = directoryInput.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !requestedDirectory.isEmpty else {
      alert = AppAlert(
        title: "Could not add directory",
        message: "Enter a directory path."
      )
      return false
    }

    let wasAlreadyAdded = sidebarDirectories.contains(requestedDirectory)
    rememberSidebarDirectory(requestedDirectory)
    setDirectorySessionIndexesLoading([requestedDirectory], loading: true)

    Task {
      await finishAddingDirectory(
        requestedDirectory,
        wasAlreadyAdded: wasAlreadyAdded
      )
    }

    return true
  }

  public func removeSidebarDirectory(_ directory: String) {
    removeSidebarDirectories([directory])
  }

  public func removeSidebarDirectories(_ directories: [String]) {
    let normalizedDirectories = Set(
      directories.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    )
    guard !normalizedDirectories.isEmpty else { return }

    connectionStore.removeSidebarDirectories(Array(normalizedDirectories))
    sidebarDirectories = connectionStore.sidebarDirectories
    for directory in normalizedDirectories {
      supplementalDirectoryIndexes.removeValue(forKey: directory)
    }
    setDirectorySessionIndexesLoading(
      Array(normalizedDirectories),
      loading: false
    )
    directoryIndexRefreshSignature = ""
    startEvents(sessionId: requestSessionId, sessionKey: requestSessionKey)
  }

  public func moveSidebarDirectories(
    fromOffsets source: IndexSet,
    toOffset destination: Int
  ) {
    connectionStore.moveSidebarDirectories(
      fromOffsets: source,
      toOffset: destination
    )
    sidebarDirectories = connectionStore.sidebarDirectories
  }

  public func replaceSidebarDirectories(_ directories: [String]) async {
    connectionStore.setSidebarDirectories(directories)
    sidebarDirectories = connectionStore.sidebarDirectories
    let sidebarDirectorySet = Set(sidebarDirectories)
    supplementalDirectoryIndexes = supplementalDirectoryIndexes.filter {
      sidebarDirectorySet.contains($0.key)
    }
    loadingDirectorySessionIndexes = Set(
      loadingDirectorySessionIndexes.filter { sidebarDirectorySet.contains($0) }
    )
    directoryIndexRefreshSignature = ""
    await refreshDirectorySessionIndexes(for: sidebarDirectories)
    startEvents(sessionId: requestSessionId, sessionKey: requestSessionKey)
  }

  public func removeAllSidebarDirectories() {
    connectionStore.removeAllSidebarDirectories()
    sidebarDirectories = connectionStore.sidebarDirectories
    supplementalDirectoryIndexes = [:]
    loadingDirectorySessionIndexes = []
    directoryIndexRefreshSignature = ""
    startEvents(sessionId: requestSessionId, sessionKey: requestSessionKey)
  }

  public func searchDirectories(query: String) async -> [CompletionItem] {
    guard let baseURL else { return [] }
    let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedQuery.isEmpty else { return [] }

    do {
      let response = try await apiClient.searchDirectories(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        query: trimmedQuery
      )
      return response.items.filter(\.isDirectory)
    } catch {
      return []
    }
  }

  public func listDirectoryEntries(prefix: String) async -> [CompletionItem] {
    guard let baseURL else { return [] }

    do {
      let response = try await apiClient.pathCompletions(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        prefix: prefix
      )
      return response.items.filter(\.isDirectory)
    } catch {
      return []
    }
  }

  public func refreshDirectorySessionIndexes(for directories: [String]) async {
    guard let baseURL else { return }

    let normalizedDirectories = Self.uniqueDirectories(directories)
    guard !normalizedDirectories.isEmpty else { return }

    let signature = normalizedDirectories.sorted().joined(separator: "\n")
    guard signature != directoryIndexRefreshSignature else { return }
    directoryIndexRefreshSignature = signature
    setDirectorySessionIndexesLoading(normalizedDirectories, loading: true)

    do {
      let response = try await apiClient.directorySessionIndexes(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        directories: normalizedDirectories
      )
      supplementalDirectoryIndexes.merge(response.directoryIndexes) { _, new in
        new
      }
      setDirectorySessionIndexesLoading(normalizedDirectories, loading: false)
    } catch {
      if directoryIndexRefreshSignature == signature {
        directoryIndexRefreshSignature = ""
      }
      setDirectorySessionIndexesLoading(normalizedDirectories, loading: false)
      // Directory indexes are sidebar affordances. Keep the live chat usable if
      // a refresh fails; the event stream will continue to provide active data.
    }
  }

  @discardableResult
  public func submitPrompt(
    message: String,
    images: [PromptImage],
    streamingBehavior: StreamingBehavior? = nil
  ) async -> Bool {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before sending a prompt."
      )
      return false
    }

    guard !message.isEmpty || !images.isEmpty else {
      alert = AppAlert(
        title: "Message required",
        message: "Enter a message or attach an image before sending."
      )
      return false
    }

    let previousDraft = composerText
    let previousImages = composerImages
    composerText = ""
    composerImages = []
    draftStore.saveDraft(
      "",
      contextId: connectionStore.contextId,
      sessionKey: sessionState.sessionKey
    )
    isSubmitting = true

    do {
      _ = try await apiClient.submitPrompt(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        body: PromptRequestBody(
          message: message,
          images: images,
          streamingBehavior: sessionState.streaming
            ? streamingBehavior ?? selectedStreamingBehavior
            : nil,
          pendingId: nil,
          clientRequestId: "prompt:ios-" + UUID().uuidString.lowercased(),
          thinkingLevel: sessionState.thinkingLevel,
          draftOwnerKey: currentPromptDraftOwnerKey,
          draftCwd: currentPromptDraftCwd
        )
      )
    } catch {
      composerText = previousDraft
      composerImages = previousImages
      draftStore.saveDraft(
        previousDraft,
        contextId: connectionStore.contextId,
        sessionKey: sessionState.sessionKey
      )
      alert = AppAlert(
        title: "Could not send prompt",
        message: Self.message(for: error)
      )
      isSubmitting = false
      return false
    }

    isSubmitting = false
    return true
  }

  @discardableResult
  public func reorderPendingMessages(_ pendingMessages: [PendingUserMessage]) async -> Bool {
    guard let baseURL else { return false }

    let previousPendingMessages = sessionState.pendingMessages
    sessionState.pendingMessages = pendingMessages

    do {
      let response = try await apiClient.reorderPendingMessages(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        pendingMessages: pendingMessages
      )
      sessionState.pendingMessages = response.pendingMessages
      return true
    } catch {
      sessionState.pendingMessages = previousPendingMessages
      alert = AppAlert(
        title: "Could not update queue",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func abort() async {
    guard let baseURL else { return }

    do {
      _ = try await apiClient.abort(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey
      )
    } catch {
      alert = AppAlert(
        title: "Could not abort session",
        message: Self.message(for: error)
      )
    }
  }

  public func compactSession() async {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before compacting the session."
      )
      return
    }

    guard !sessionState.compacting else { return }

    compactAbortRequested = false
    sessionState.compacting = true
    defer {
      sessionState.compacting = false
      compactAbortRequested = false
    }

    do {
      _ = try await apiClient.runSlashCommand(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        name: "compact"
      )
    } catch {
      guard !compactAbortRequested else { return }
      alert = AppAlert(
        title: "Could not compact session",
        message: Self.message(for: error)
      )
    }
  }

  public func cancelCompaction() async {
    guard sessionState.compacting else { return }

    compactAbortRequested = true
    guard let baseURL else {
      compactAbortRequested = false
      return
    }

    do {
      _ = try await apiClient.abort(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey
      )
    } catch {
      compactAbortRequested = false
      alert = AppAlert(
        title: "Could not cancel compaction",
        message: Self.message(for: error)
      )
    }
  }

  @discardableResult
  public func setModel(_ model: ModelOption) async -> Bool {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before changing models."
      )
      return false
    }

    do {
      let response = try await apiClient.setModel(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        model: model
      )
      let updatedModel = response.model ?? model
      sessionState.model = updatedModel
      composerSelectedModel = updatedModel
      if let thinkingLevel = response.thinkingLevel {
        sessionState.thinkingLevel = thinkingLevel
      } else {
        sessionState.thinkingLevel = Self.clampedThinkingLevel(
          sessionState.thinkingLevel,
          model: updatedModel,
          available: sessionState.availableThinkingLevels
        )
      }
      if let availableThinkingLevels = response.availableThinkingLevels {
        sessionState.availableThinkingLevels = availableThinkingLevels
      }
      return true
    } catch {
      alert = AppAlert(
        title: "Could not update model",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func setThinkingLevel(_ level: String) async {
    let clampedLevel = Self.clampedThinkingLevel(
      level,
      model: composerModel,
      available: sessionState.availableThinkingLevels
    )

    guard !isComposingNewSession, requestSessionId != nil || requestSessionKey != nil else {
      sessionState.thinkingLevel = clampedLevel
      return
    }

    guard let baseURL else { return }

    do {
      let response = try await apiClient.setThinking(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        level: clampedLevel
      )
      sessionState.thinkingLevel = response.thinkingLevel
      sessionState.availableThinkingLevels = response.availableThinkingLevels
    } catch {
      alert = AppAlert(
        title: "Could not update thinking level",
        message: Self.message(for: error)
      )
    }
  }

  public func setThinkingHidden(_ hidden: Bool) async {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before changing thinking visibility."
      )
      return
    }

    let previousHidden = sessionState.hideThinkingBlock
    let previousPreview = sessionState.hiddenThinkingPreview
    sessionState.setHideThinkingBlock(hidden)

    do {
      let response = try await apiClient.setHideThinking(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        hide: hidden
      )
      sessionState.setHideThinkingBlock(response.hideThinkingBlock)
    } catch {
      sessionState.hideThinkingBlock = previousHidden
      sessionState.hiddenThinkingPreview = previousPreview
      alert = AppAlert(
        title: "Could not update thinking visibility",
        message: Self.message(for: error)
      )
    }
  }

  public func setToolBlocksHidden(_ hidden: Bool) {
    hideToolBlocks = hidden
    connectionStore.setHideToolBlocks(hidden)
  }

  public func refreshAuthProviders() async {
    guard let baseURL else { return }

    isLoadingAuthProviders = true
    defer { isLoadingAuthProviders = false }

    do {
      let response = try await apiClient.authProviders(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey
      )
      authProviders = response
      sessionState.availableModels = response.availableModels
      sessionState.thinkingLevel = Self.clampedThinkingLevel(
        sessionState.thinkingLevel,
        model: composerModel,
        available: sessionState.availableThinkingLevels
      )
    } catch {
      alert = AppAlert(
        title: "Could not load providers",
        message: Self.message(for: error)
      )
    }
  }

  @discardableResult
  public func saveProviderApiKey(
    provider: AuthProviderOption,
    key: String
  ) async -> Bool {
    guard let baseURL else { return false }
    let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedKey.isEmpty else {
      alert = AppAlert(
        title: "API key required",
        message: "Enter an API key for \(provider.name)."
      )
      return false
    }

    authMutationProviderId = provider.id
    defer { authMutationProviderId = nil }

    do {
      let response = try await apiClient.saveProviderApiKey(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        provider: provider.id,
        key: trimmedKey
      )
      applyAuthMutation(response)
      await refreshAuthProviders()
      return true
    } catch {
      alert = AppAlert(
        title: "Could not save API key",
        message: Self.message(for: error)
      )
      return false
    }
  }

  @discardableResult
  public func loginProviderOAuth(provider: AuthProviderOption) async -> Bool {
    guard let baseURL else { return false }

    authMutationProviderId = provider.id
    defer { authMutationProviderId = nil }

    do {
      let response = try await apiClient.loginProviderOAuth(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        provider: provider.id
      )
      applyAuthMutation(response)
      activeUiRequest = nil
      await refreshAuthProviders()
      return true
    } catch {
      let message = Self.message(for: error)
      if !message.localizedCaseInsensitiveContains("cancelled") {
        alert = AppAlert(
          title: "Could not log in",
          message: message
        )
      }
      activeUiRequest = nil
      return false
    }
  }

  @discardableResult
  public func logoutProvider(_ provider: AuthProviderOption) async -> Bool {
    guard let baseURL else { return false }

    authMutationProviderId = provider.id
    defer { authMutationProviderId = nil }

    do {
      let response = try await apiClient.logoutProvider(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        sessionId: requestSessionId,
        sessionKey: requestSessionKey,
        provider: provider.id
      )
      applyAuthMutation(response)
      await refreshAuthProviders()
      return true
    } catch {
      alert = AppAlert(
        title: "Could not log out",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func clearActiveUiRequest() {
    activeUiRequest = nil
  }

  @discardableResult
  public func resolveUiRequest(
    _ request: UiRequest,
    value: String? = nil,
    confirmed: Bool? = nil,
    cancelled: Bool = false
  ) async -> Bool {
    guard let baseURL else { return false }

    var body: [String: JSONValue] = ["cancelled": .bool(cancelled)]
    if let value {
      body["value"] = .string(value)
    }
    if let confirmed {
      body["confirmed"] = .bool(confirmed)
    }

    do {
      _ = try await apiClient.resolveUiRequest(
        baseURL: baseURL,
        id: request.id,
        body: body
      )
      if activeUiRequest?.id == request.id {
        activeUiRequest = nil
      }
      return true
    } catch {
      alert = AppAlert(
        title: "Could not answer login prompt",
        message: Self.message(for: error)
      )
      return false
    }
  }

  public func saveDraft() {
    draftStore.saveDraft(
      composerText,
      contextId: connectionStore.contextId,
      sessionKey: sessionState.sessionKey
    )
  }

  private func resolveDirectoryPath(_ directoryInput: String) async throws -> String {
    guard let baseURL else { throw PicoAPIError.invalidURL }

    let trimmedInput = directoryInput.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedInput.isEmpty else {
      throw PicoAPIError.apiError("Enter a directory path.")
    }

    let response = try await apiClient.resolveDirectory(
      baseURL: baseURL,
      contextId: connectionStore.contextId,
      path: trimmedInput
    )
    return response.path
  }

  private func finishAddingDirectory(
    _ requestedDirectory: String,
    wasAlreadyAdded: Bool
  ) async {
    do {
      let resolvedDirectory = try await resolveDirectoryPath(requestedDirectory)
      replaceSidebarDirectory(requestedDirectory, with: resolvedDirectory)
      setDirectorySessionIndexesLoading([requestedDirectory], loading: false)
      setDirectorySessionIndexesLoading([resolvedDirectory], loading: true)
      await refreshDirectorySessionIndexes(for: [resolvedDirectory])
      startEvents(sessionId: requestSessionId, sessionKey: requestSessionKey)
    } catch {
      setDirectorySessionIndexesLoading([requestedDirectory], loading: false)
      if !wasAlreadyAdded {
        removeOptimisticSidebarDirectory(requestedDirectory)
      }
      alert = AppAlert(
        title: "Could not add directory",
        message: Self.message(for: error)
      )
    }
  }

  private func rememberSidebarDirectory(_ directory: String) {
    connectionStore.rememberSidebarDirectory(directory)
    sidebarDirectories = connectionStore.sidebarDirectories
    directoryIndexRefreshSignature = ""
  }

  private func replaceSidebarDirectory(
    _ optimisticDirectory: String,
    with resolvedDirectory: String
  ) {
    let optimisticDirectory = optimisticDirectory.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    let resolvedDirectory = resolvedDirectory.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !resolvedDirectory.isEmpty else { return }

    var directories = sidebarDirectories
    if let index = directories.firstIndex(of: optimisticDirectory) {
      directories[index] = resolvedDirectory
    } else if !directories.contains(resolvedDirectory) {
      directories.insert(resolvedDirectory, at: 0)
    }

    connectionStore.setSidebarDirectories(Self.uniqueDirectories(directories))
    sidebarDirectories = connectionStore.sidebarDirectories
    directoryIndexRefreshSignature = ""
  }

  private func removeOptimisticSidebarDirectory(_ directory: String) {
    let directory = directory.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !directory.isEmpty else { return }

    connectionStore.removeSidebarDirectory(directory)
    sidebarDirectories = connectionStore.sidebarDirectories
    supplementalDirectoryIndexes.removeValue(forKey: directory)
    directoryIndexRefreshSignature = ""
  }

  private func setDirectorySessionIndexesLoading(
    _ directories: [String],
    loading: Bool
  ) {
    let normalizedDirectories = Self.uniqueDirectories(directories)
    guard !normalizedDirectories.isEmpty else { return }

    var nextLoadingDirectories = loadingDirectorySessionIndexes
    for directory in normalizedDirectories {
      if loading {
        nextLoadingDirectories.insert(directory)
      } else {
        nextLoadingDirectories.remove(directory)
      }
    }

    guard nextLoadingDirectories != loadingDirectorySessionIndexes else {
      return
    }
    loadingDirectorySessionIndexes = nextLoadingDirectories
  }

  private func missingDirectorySessionIndexDirectories(
    _ directories: [String]
  ) -> [String] {
    Self.uniqueDirectories(directories).filter { directory in
      supplementalDirectoryIndexes[directory] == nil &&
        sessionsEvent?.directoryIndexes?[directory] == nil
    }
  }

  private func applyAuthMutation(_ response: AuthMutationResponse) {
    sessionState.availableModels = response.availableModels
    sessionState.thinkingLevel = Self.clampedThinkingLevel(
      sessionState.thinkingLevel,
      model: composerModel,
      available: sessionState.availableThinkingLevels
    )
  }

  private func applyOptimisticSubmittedPrompt(
    _ message: String,
    images: [PromptImage],
    clearComposerDirectory: Bool
  ) -> PromptOptimisticRollback {
    let rollback = PromptOptimisticRollback(
      isComposingNewSession: isComposingNewSession,
      composerSelectedDirectory: composerSelectedDirectory,
      composerImages: composerImages,
      sessionState: sessionState
    )

    isComposingNewSession = false
    if clearComposerDirectory {
      composerSelectedDirectory = nil
    }
    applyLocalSubmittedPrompt(message, images: images)
    return rollback
  }

  private func restoreOptimisticSubmittedPrompt(_ rollback: PromptOptimisticRollback) {
    isComposingNewSession = rollback.isComposingNewSession
    composerSelectedDirectory = rollback.composerSelectedDirectory
    composerImages = rollback.composerImages
    sessionState = rollback.sessionState
  }

  private func applyLocalSubmittedPrompt(_ message: String, images: [PromptImage]) {
    let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedMessage.isEmpty || !images.isEmpty else { return }

    sessionState.draft = false
    sessionState.streaming = true
    if sessionState.firstMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      sessionState.firstMessage = trimmedMessage.isEmpty ? "Image prompt" : trimmedMessage
    }
    appendLocalUserMessage(trimmedMessage, images: images, queued: false)
  }

  private func applyUserMessage(_ event: UserMessageEvent) {
    guard !isComposingNewSession,
          event.queued != true else {
      return
    }

    let message = event.message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let images = event.images ?? []
    guard !message.isEmpty || !images.isEmpty else { return }

    sessionState.streaming = true
    if sessionState.firstMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      sessionState.firstMessage = message.isEmpty ? "Image prompt" : message
    }
    appendLocalUserMessage(message, images: images, queued: event.queued)
  }

  private func appendLocalUserMessage(
    _ message: String,
    images: [PromptImage],
    queued: Bool?
  ) {
    let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedMessage.isEmpty || !images.isEmpty else { return }

    for item in sessionState.items.suffix(5) {
      guard case .user(let user) = item else { continue }
      if user.text.trimmingCharacters(in: .whitespacesAndNewlines) == trimmedMessage &&
        user.images == images {
        return
      }
    }

    let itemKey = "local:user:\(UUID().uuidString.lowercased())"
    sessionState.items.append(
      .user(
        UserConversationItem(
          itemKey: itemKey,
          renderKey: itemKey,
          text: trimmedMessage,
          images: images,
          queued: queued
        )
      )
    )
  }

  static func preferredModel(in models: [ModelOption]) -> ModelOption? {
    models.first { model in
      model.provider == preferredModelProvider && model.id == preferredModelId
    } ?? models.first { model in
      model.id == preferredModelId
    } ?? models.first
  }

  private static func thinkingLevels(
    for model: ModelOption?,
    available: [String]
  ) -> [String] {
    if model?.reasoning == false { return ["off"] }
    if !available.isEmpty { return available }
    return fallbackThinkingLevels
  }

  private static func clampedThinkingLevel(
    _ level: String,
    model: ModelOption?,
    available: [String]
  ) -> String {
    let levels = thinkingLevels(for: model, available: available)
    if levels.contains(level) { return level }
    if levels.contains(preferredThinkingLevel) { return preferredThinkingLevel }
    if levels.contains("medium") { return "medium" }
    if levels.contains("off") { return "off" }
    return levels.first ?? "off"
  }

  private static func uniqueDirectories(_ directories: [String]) -> [String] {
    var seen = Set<String>()
    return directories.compactMap { directory in
      let normalizedDirectory = directory.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalizedDirectory.isEmpty, !seen.contains(normalizedDirectory) else {
        return nil
      }

      seen.insert(normalizedDirectory)
      return normalizedDirectory
    }
  }

  private static func sessionListEntry(
    _ left: SessionListEntry,
    matches right: SessionListEntry
  ) -> Bool {
    if let leftSessionId = left.sessionId,
       let rightSessionId = right.sessionId,
       leftSessionId == rightSessionId {
      return true
    }

    if let leftPath = left.path,
       let rightPath = right.path,
       leftPath == rightPath {
      return true
    }

    return (left.optimistic == true || right.optimistic == true) &&
      left.cwd == right.cwd &&
      left.title == right.title
  }

  private static func sessionPath(for entry: SessionListEntry) -> String? {
    let path = entry.path?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return path.isEmpty ? nil : path
  }

  private var currentSessionPath: String? {
    let path = sessionState.sessionFile?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return path.isEmpty ? nil : path
  }

  private func isFocusedSession(_ entry: SessionListEntry) -> Bool {
    if let path = Self.sessionPath(for: entry), path == currentSessionPath {
      return true
    }

    if let selectionId = entry.selectionId, selectionId == selectedSessionId {
      return true
    }

    if let sessionId = entry.sessionId, sessionId == sessionState.sessionId {
      return true
    }

    return false
  }

  private func refreshSidebarSessionsAfterSessionMutation() async {
    directoryIndexRefreshSignature = ""
    sessionsEvent?.directoryIndexes = nil
    supplementalDirectoryIndexes = [:]
    await refreshDirectorySessionIndexes(for: sidebarDirectories)
  }

  private var requestSessionId: String? {
    if isComposingNewSession || sessionState.draft { return nil }
    return sessionState.sessionId ?? selectedSessionId
  }

  private var requestSessionKey: String? {
    requestSessionId == nil ? sessionState.sessionKey : nil
  }

  private var currentPromptDraftCwd: String? {
    guard requestSessionKey != nil || sessionState.draft else { return nil }
    return sessionState.cwd
  }

  private var currentPromptDraftOwnerKey: String? {
    guard let cwd = currentPromptDraftCwd?.trimmingCharacters(in: .whitespacesAndNewlines),
          !cwd.isEmpty else {
      return requestSessionKey != nil || sessionState.draft ? "draft:default" : nil
    }

    return "draft:\(cwd)"
  }

  private func startEvents(sessionId: String?, sessionKey: String? = nil) {
    setDirectorySessionIndexesLoading(
      missingDirectorySessionIndexDirectories(sidebarDirectories),
      loading: true
    )
    eventTask?.cancel()
    eventTask = Task { [weak self] in
      guard let self else { return }
      await runEventLoop(sessionId: sessionId, sessionKey: sessionKey)
    }
  }

  private func runEventLoop(sessionId: String?, sessionKey: String?) async {
    var reconnectDelay = 1

    while !Task.isCancelled {
      guard let baseURL else { return }

      do {
        let stream = await eventStream.events(
          baseURL: baseURL,
          contextId: connectionStore.contextId,
          sessionId: sessionId,
          sessionKey: sessionKey,
          sidebarDirectories: sidebarDirectories,
          lastEventId: connectionStore.lastEventId
        )
        connectionStatus = .connected

        for try await streamEvent in stream {
          if let id = streamEvent.id {
            connectionStore.saveLastEventId(id)
          }
          apply(streamEvent.event)
        }

        if !Task.isCancelled {
          connectionStatus = .reconnecting
          try await Task.sleep(for: .seconds(1))
        }
      } catch is CancellationError {
        return
      } catch {
        connectionStatus = .reconnecting
        try? await Task.sleep(for: .seconds(reconnectDelay))
        reconnectDelay = min(reconnectDelay * 2, 15)
      }
    }
  }

  private func preserveNewChatState() {
    let syncedState = sessionState
    let targetCwd = composerSelectedDirectory ??
      syncedState.cwd ??
      knownDirectories.first ??
      DirectoryPathFormatter.homePrefix
    let targetModel = composerSelectedModel ??
      Self.preferredModel(in: syncedState.availableModels) ??
      syncedState.model
    let targetThinkingLevel = Self.clampedThinkingLevel(
      syncedState.thinkingLevel,
      model: targetModel,
      available: syncedState.availableThinkingLevels
    )

    selectedSessionId = nil
    loadingSessionTitle = nil
    loadingSessionCwd = nil
    composerSelectedDirectory = targetCwd
    composerSelectedModel = targetModel
    sessionState = SessionState(
      connected: syncedState.connected,
      replaying: false,
      cwd: targetCwd,
      model: targetModel,
      thinkingLevel: targetThinkingLevel,
      availableThinkingLevels: syncedState.availableThinkingLevels,
      availableModels: syncedState.availableModels,
      availableSkills: syncedState.availableSkills,
      hideThinkingBlock: syncedState.hideThinkingBlock
    )
  }

  private func apply(_ event: PicoServerEvent) {
    switch event {
    case .stateSync(let sync):
      let wasComposingNewSession = isComposingNewSession
      sessionState.apply(sync)

      if wasComposingNewSession {
        preserveNewChatState()
      } else {
        selectedSessionId = sessionState.sessionId ?? selectedSessionId
        loadingSessionTitle = nil
        loadingSessionCwd = nil
        if composerText.isEmpty {
          composerText = draftStore.readDraft(
            contextId: connectionStore.contextId,
            sessionKey: sessionState.sessionKey
          )
          if composerText.isEmpty, let editorText = sessionState.uiState.editorText {
            composerText = editorText
          }
        }
      }
      refreshConversationGitStatusIfNeeded()
    case .sessions(let sessions):
      sessionsEvent = sessions
      let loadedDirectoryIndexKeys = sessions.directoryIndexes.map {
        Array($0.keys)
      } ?? []
      setDirectorySessionIndexesLoading(
        loadedDirectoryIndexKeys,
        loading: false
      )
      Task {
        await refreshDirectorySessionIndexes(for: sidebarDirectories)
      }
    case .sessionStatus(let status):
      apply(status)
    case .sessionDone(let done):
      apply(done)
    case .requestError(let event):
      alert = AppAlert(
        title: "Pico request failed",
        message: event.error ?? event.message ?? "Unknown request error"
      )
    case .extensionError(let event):
      alert = AppAlert(
        title: "Extension error",
        message: event.error ?? "Unknown extension error"
      )
    case .extensionUiRequest(let request):
      if request.method == "notify" {
        alert = AppAlert(
          title: request.title ?? "Pico",
          message: request.message ?? "Notification"
        )
      } else {
        activeUiRequest = request
      }
    case .userMessage(let event):
      applyUserMessage(event)
    case .gitChanged(let event):
      apply(event)
    case .autoSessionNamingError, .unknown:
      break
    }
  }

  private func apply(_ event: GitChangedEvent) {
    let scopes = Set(event.scopes ?? [])
    guard scopes.isEmpty || scopes.contains("status") || scopes.contains("refs") else {
      return
    }

    refreshConversationGitStatusIfNeeded(force: true)
    if scopes.isEmpty || scopes.contains("refs") {
      refreshComposerGitBranches(force: true)
    }
  }

  private func clearGitStatus() {
    gitStatusTask?.cancel()
    gitStatusTask = nil
    gitStatusCwd = nil
    currentGitStatus = nil
    clearGitBranches()
  }

  private func clearGitBranches() {
    gitBranchesTask?.cancel()
    gitBranchesTask = nil
    gitBranchesCwd = nil
    currentGitLocalBranches = []
    isLoadingGitBranches = false
  }

  private func refreshConversationGitStatusIfNeeded(force: Bool = false) {
    guard let cwd = Self.normalizedText(conversationHeaderDirectory) else {
      clearGitStatus()
      return
    }
    guard baseURL != nil else {
      clearGitStatus()
      return
    }
    guard force || cwd != gitStatusCwd else { return }

    gitStatusTask?.cancel()
    if cwd != gitBranchesCwd {
      clearGitBranches()
    }
    gitStatusCwd = cwd
    currentGitStatus = nil

    gitStatusTask = Task { [weak self] in
      guard let self else { return }
      await self.loadGitStatus(cwd: cwd)
    }
  }

  private func loadGitStatus(cwd: String) async {
    guard let baseURL else { return }
    do {
      let response = try await apiClient.gitStatus(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        cwd: cwd
      )
      guard !Task.isCancelled, gitStatusCwd == cwd else { return }
      currentGitStatus = response.gitStatus
      if response.gitStatus == nil {
        clearGitBranches()
      }
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled, gitStatusCwd == cwd else { return }
      currentGitStatus = nil
      clearGitBranches()
    }
  }

  private func loadGitBranches(cwd: String) async {
    guard let baseURL else {
      guard gitBranchesCwd == cwd else { return }
      currentGitLocalBranches = []
      isLoadingGitBranches = false
      return
    }

    do {
      let response = try await apiClient.gitChanges(
        baseURL: baseURL,
        contextId: connectionStore.contextId,
        cwd: cwd,
        scope: "branches"
      )
      guard !Task.isCancelled, gitBranchesCwd == cwd else { return }
      currentGitLocalBranches = response.localBranches ?? []
      isLoadingGitBranches = false
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled, gitBranchesCwd == cwd else { return }
      currentGitLocalBranches = []
      isLoadingGitBranches = false
    }
  }

  private func openPendingSessionDeepLinkIfNeeded() async {
    guard let deepLink = pendingSessionDeepLink else { return }

    pendingSessionDeepLink = nil
    await openSession(from: deepLink)
  }

  private func openSession(from deepLink: PicoSessionDeepLink) async {
    guard baseURL != nil else {
      pendingSessionDeepLink = deepLink
      await restoreConnection()
      return
    }

    guard let entry = sessionListEntry(matching: deepLink) ??
      deepLink.fallbackEntry else {
      alert = AppAlert(
        title: "Could not open session",
        message: "The deep link does not include a session identifier."
      )
      return
    }

    let selected = await selectSession(entry)
    if selected {
      conversationPresentationRequest &+= 1
    }
  }

  private func sessionListEntry(
    matching deepLink: PicoSessionDeepLink
  ) -> SessionListEntry? {
    for snapshot in sessionSnapshots {
      if let entry = snapshot.sessions.first(where: { deepLink.matches($0) }) {
        return entry
      }
    }

    return nil
  }

  private func apply(_ done: SessionDoneEvent) {
    lastSessionDoneEvent = done

    guard shouldNotifySessionDone(done),
          notifiedSessionDoneIds.insert(done.id).inserted else {
      return
    }

    Task { [sessionDoneNotifications] in
      await sessionDoneNotifications.postSessionDoneNotification(done)
    }
  }

  private func shouldNotifySessionDone(_ done: SessionDoneEvent) -> Bool {
    !isFocusedSession(done)
  }

  private func isFocusedSession(_ done: SessionDoneEvent) -> Bool {
    guard isSceneActive, !isComposingNewSession else { return false }

    if let doneSessionId = normalizedIdentifier(done.sessionId) {
      return doneSessionId == normalizedIdentifier(sessionState.sessionId) ||
        doneSessionId == normalizedIdentifier(selectedSessionId)
    }

    if let doneSessionKey = normalizedIdentifier(done.sessionKey) {
      return doneSessionKey == normalizedIdentifier(sessionState.sessionKey)
    }

    if let doneSessionPath = normalizedIdentifier(done.sessionPath) {
      return doneSessionPath == normalizedIdentifier(sessionState.sessionFile)
    }

    return false
  }

  private func normalizedIdentifier(_ value: String?) -> String? {
    Self.normalizedText(value)
  }

  private static func normalizedText(_ value: String?) -> String? {
    let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedValue.isEmpty ? nil : trimmedValue
  }

  private static func headerGitStatusText(_ gitStatus: GitStatusSummary) -> String? {
    if let inline = normalizedText(gitStatus.inline) {
      return inline
    }

    return branchGitStatusText(gitStatus)
  }

  private static func branchGitStatusText(_ gitStatus: GitStatusSummary) -> String? {
    if gitStatus.detached {
      if let revision = normalizedText(gitStatus.revision) {
        return "detached \(revision)"
      }

      return "detached"
    }

    return normalizedText(gitStatus.branch)
  }

  private func apply(_ status: SessionStatusEvent) {
    guard !isComposingNewSession,
          status.sessionId == sessionState.sessionId || status.sessionKey == sessionState.sessionKey else {
      return
    }

    if let streaming = status.streaming {
      sessionState.streaming = streaming
      sessionState.refreshHiddenThinkingPreview()
    }
  }

  private func normalizedLabel(_ value: String?) -> String? {
    let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedValue.isEmpty ? nil : trimmedValue
  }

  private static func normalizedServerURL(from value: String) -> URL? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let text = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
    guard let url = URL(string: text), let scheme = url.scheme?.lowercased() else {
      return nil
    }
    guard scheme == "http" || scheme == "https" else {
      return nil
    }
    return url
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }

    return error.localizedDescription
  }
}

private struct PicoSessionDeepLink: Equatable, Sendable {
  static let scheme = "pico"
  private static let sessionRoute = "session"

  var sessionId: String?
  var sessionKey: String?
  var sessionPath: String?
  var cwd: String?
  var title: String?

  init?(url: URL) {
    guard url.scheme?.lowercased() == Self.scheme,
          Self.routeName(for: url) == Self.sessionRoute,
          let components = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
          ) else {
      return nil
    }

    sessionId = Self.queryValue(
      in: components,
      names: ["sessionId", "session"]
    )
    sessionKey = Self.queryValue(in: components, names: ["sessionKey"])
    sessionPath = Self.queryValue(
      in: components,
      names: ["sessionPath", "path"]
    )
    cwd = Self.queryValue(in: components, names: ["cwd"])
    title = Self.queryValue(in: components, names: ["title"])

    guard sessionId != nil || sessionKey != nil || sessionPath != nil else {
      return nil
    }
  }

  var fallbackEntry: SessionListEntry? {
    let path = sessionPath ?? sessionKey
    guard sessionId != nil || path != nil else { return nil }

    return SessionListEntry(
      path: path,
      sessionId: sessionId,
      cwd: cwd,
      title: title ?? "Session"
    )
  }

  func matches(_ entry: SessionListEntry) -> Bool {
    if let sessionId, entry.sessionId == sessionId {
      return true
    }

    if let sessionPath, entry.path == sessionPath {
      return true
    }

    if let sessionKey,
       entry.path == sessionKey || entry.sessionId == sessionKey {
      return true
    }

    return false
  }

  static func url(for event: SessionDoneEvent) -> URL? {
    var queryItems: [URLQueryItem] = []
    appendQueryItem("sessionId", value: event.sessionId, to: &queryItems)
    appendQueryItem("sessionKey", value: event.sessionKey, to: &queryItems)
    appendQueryItem("sessionPath", value: event.sessionPath, to: &queryItems)
    appendQueryItem("cwd", value: event.cwd, to: &queryItems)
    appendQueryItem("title", value: event.title, to: &queryItems)

    guard queryItems.contains(where: {
      $0.name == "sessionId" ||
        $0.name == "sessionKey" ||
        $0.name == "sessionPath"
    }) else {
      return nil
    }

    var components = URLComponents()
    components.scheme = scheme
    components.host = sessionRoute
    components.queryItems = queryItems
    return components.url
  }

  private static func routeName(for url: URL) -> String? {
    if let host = url.host(percentEncoded: false), !host.isEmpty {
      return host.lowercased()
    }

    return url.pathComponents.dropFirst().first?.lowercased()
  }

  private static func queryValue(
    in components: URLComponents,
    names: [String]
  ) -> String? {
    for name in names {
      guard let value = components.queryItems?.first(where: { $0.name == name })?.value?
        .trimmingCharacters(in: .whitespacesAndNewlines),
        !value.isEmpty else {
        continue
      }

      return value
    }

    return nil
  }

  private static func appendQueryItem(
    _ name: String,
    value: String?,
    to queryItems: inout [URLQueryItem]
  ) {
    let value = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !value.isEmpty else { return }

    queryItems.append(URLQueryItem(name: name, value: value))
  }
}

private final class SessionDoneNotificationClient: NSObject,
  UNUserNotificationCenterDelegate,
  @unchecked Sendable {
  private let center = UNUserNotificationCenter.current()

  var deepLinkHandler: (@MainActor (URL) -> Void)?

  override init() {
    super.init()
    center.delegate = self
  }

  func requestAuthorizationIfNeeded() async {
    _ = await canPostNotifications()
  }

  func postSessionDoneNotification(_ event: SessionDoneEvent) async {
    guard await canPostNotifications() else { return }

    let content = UNMutableNotificationContent()
    content.title = "Agent is done"
    content.body = notificationBody(for: event)
    content.sound = .default
    content.threadIdentifier = notificationThreadIdentifier(for: event)
    let deepLinkURL = PicoSessionDeepLink.url(for: event)
    content.targetContentIdentifier = deepLinkURL?.absoluteString
    content.userInfo = notificationUserInfo(
      for: event,
      deepLinkURL: deepLinkURL
    )

    let request = UNNotificationRequest(
      identifier: "pico-session-done-\(event.id)",
      content: content,
      trigger: nil
    )

    try? await center.add(request)
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .list, .sound]
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    guard let url = deepLinkURL(for: response.notification.request.content) else {
      return
    }

    await deepLinkHandler?(url)
  }

  private func canPostNotifications() async -> Bool {
    let settings = await center.notificationSettings()

    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral:
      return true
    case .notDetermined:
      return await requestAuthorization()
    case .denied:
      return false
    @unknown default:
      return false
    }
  }

  private func requestAuthorization() async -> Bool {
    do {
      return try await center.requestAuthorization(options: [.alert, .sound])
    } catch {
      return false
    }
  }

  private func notificationBody(for event: SessionDoneEvent) -> String {
    if let title = normalized(event.title) {
      return title
    }

    if let cwd = normalized(event.cwd) {
      return cwd
    }

    return "Your Pico session finished."
  }

  private func notificationThreadIdentifier(for event: SessionDoneEvent) -> String {
    if let sessionId = normalized(event.sessionId) {
      return "pico-session-\(sessionId)"
    }

    if let sessionKey = normalized(event.sessionKey) {
      return "pico-session-\(sessionKey)"
    }

    if let sessionPath = normalized(event.sessionPath) {
      return "pico-session-\(sessionPath)"
    }

    return "pico-session-done"
  }

  private func notificationUserInfo(
    for event: SessionDoneEvent,
    deepLinkURL: URL?
  ) -> [String: String] {
    var userInfo = ["sessionDoneId": event.id]

    if let deepLinkURL {
      userInfo["deepLink"] = deepLinkURL.absoluteString
    }

    if let sessionId = normalized(event.sessionId) {
      userInfo["sessionId"] = sessionId
    }
    if let sessionKey = normalized(event.sessionKey) {
      userInfo["sessionKey"] = sessionKey
    }
    if let sessionPath = normalized(event.sessionPath) {
      userInfo["sessionPath"] = sessionPath
    }

    return userInfo
  }

  private func deepLinkURL(for content: UNNotificationContent) -> URL? {
    if let deepLink = content.userInfo["deepLink"] as? String,
       let url = URL(string: deepLink) {
      return url
    }

    if let targetContentIdentifier = content.targetContentIdentifier,
       let url = URL(string: targetContentIdentifier) {
      return url
    }

    return nil
  }

  private func normalized(_ value: String?) -> String? {
    let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedValue.isEmpty ? nil : trimmedValue
  }
}
