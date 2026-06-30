import Foundation

public struct ComposerGitCommentAttachment: Identifiable, Hashable, Sendable {
  public var id: String
  public var title: String
  public var subtitle: String?
  public var systemImage: String
  public var comment: String
  public var context: String

  public init(
    id: String = UUID().uuidString,
    title: String,
    subtitle: String? = nil,
    systemImage: String = "text.bubble",
    comment: String,
    context: String
  ) {
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.systemImage = systemImage
    self.comment = comment
    self.context = context
  }
}

extension AppModel {
  public var filesWorkspaceDirectory: String? {
    let candidates = [
      sessionState.cwd,
      composerSelectedDirectory,
      loadingSessionCwd,
      knownDirectories.first,
    ]

    return candidates.compactMap(Self.trimmedNonEmpty).first
  }

  @discardableResult
  public func refreshFilesGitStateAfterMutation(force: Bool = true) -> Int {
    gitRefreshRevision &+= 1
    refreshConversationGitStatusIfNeeded(force: force)
    refreshComposerGitBranches(force: force)
    return gitRefreshRevision
  }

  public func fetchGitStatus(cwd: String) async throws -> GitStatusResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitStatus(baseURL: baseURL, contextId: contextId, cwd: cwd)
    }
  }

  public func fetchGitChanges(
    cwd: String,
    scope: String,
    commitsLimit: Int? = nil
  ) async throws -> GitChangesResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitChanges(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        scope: scope,
        commitsLimit: commitsLimit
      )
    }
  }

  public func fetchGitFileDiff(
    cwd: String,
    path: String
  ) async throws -> GitFileDiffResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitFileDiff(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        path: path
      )
    }
  }

  public func fetchGitFileReview(
    cwd: String,
    path: String,
    previousPath: String? = nil
  ) async throws -> GitFileReviewResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitFileReview(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        path: path,
        previousPath: previousPath
      )
    }
  }

  public func fetchProjectFileTree(cwd: String) async throws -> ProjectFileTreeResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.projectFileTree(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd
      )
    }
  }

  public func fetchProjectFile(
    cwd: String,
    path: String
  ) async throws -> ProjectFileReadResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.projectFileRead(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        path: path
      )
    }
  }

  @discardableResult
  public func stageGitFile(
    cwd: String,
    file: GitChangeFile,
    unstage: Bool = false
  ) async -> Bool {
    await performGitMutation(
      successMessage: unstage ? "Unstaged \(file.displayName)" : "Staged \(file.displayName)",
      errorTitle: unstage ? "Could not unstage file" : "Could not stage file"
    ) { baseURL, contextId in
      try await apiClient.stageGitFile(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        path: file.path,
        previousPath: file.previousPath,
        unstage: unstage
      )
    }
  }

  @discardableResult
  public func stageGitAll(cwd: String, unstage: Bool = false) async -> Bool {
    await performGitMutation(
      successMessage: unstage ? "Unstaged all changes" : "Staged all changes",
      errorTitle: unstage ? "Could not unstage changes" : "Could not stage changes"
    ) { baseURL, contextId in
      try await apiClient.stageGitAll(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        unstage: unstage
      )
    }
  }

  @discardableResult
  public func discardGitFile(cwd: String, file: GitChangeFile) async -> Bool {
    await performGitMutation(
      successMessage: "Discarded \(file.displayName)",
      errorTitle: "Could not discard file"
    ) { baseURL, contextId in
      try await apiClient.discardGitFile(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        path: file.path,
        previousPath: file.previousPath,
        status: file.status
      )
    }
  }

  @discardableResult
  public func discardGitAll(
    cwd: String,
    nukeWorkingTree: Bool = false
  ) async -> Bool {
    await performGitMutation(
      successMessage: nukeWorkingTree ? "Nuked working tree" : "Discarded all changes",
      errorTitle: nukeWorkingTree ? "Could not nuke working tree" : "Could not discard changes"
    ) { baseURL, contextId in
      try await apiClient.discardGitAll(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        nukeWorkingTree: nukeWorkingTree
      )
    }
  }

  @discardableResult
  public func commitGitChanges(
    cwd: String,
    message: String,
    push: Bool = false,
    forcePush: Bool = false,
    includeUnstaged: Bool = true
  ) async -> Bool {
    await performGitMutation(
      successMessage: push ? "Committed and pushed changes" : "Committed changes",
      errorTitle: "Could not commit changes"
    ) { baseURL, contextId in
      try await apiClient.commitGitChanges(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        message: message,
        push: push,
        forcePush: forcePush,
        includeUnstaged: includeUnstaged
      )
    }
  }

  public func generateGitCommitMessage(
    cwd: String
  ) async throws -> GitCommitMessageResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.generateGitCommitMessage(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd
      )
    }
  }

  @discardableResult
  public func pushGitChanges(cwd: String, force: Bool = false) async -> Bool {
    await performGitMutation(
      successMessage: force ? "Force pushed changes" : "Pushed changes",
      errorTitle: force ? "Could not force push" : "Could not push"
    ) { baseURL, contextId in
      try await apiClient.pushGitChanges(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        force: force
      )
    }
  }

  @discardableResult
  public func pullGitChanges(cwd: String) async -> Bool {
    await performGitMutation(
      successMessage: "Pulled changes",
      errorTitle: "Could not pull"
    ) { baseURL, contextId in
      try await apiClient.pullGitChanges(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd
      )
    }
  }

  public func fetchGitCommitFiles(
    cwd: String,
    commit: String
  ) async throws -> GitCommitFilesResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitCommitFiles(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        commit: commit
      )
    }
  }

  public func fetchGitCommitDiff(
    cwd: String,
    commit: String,
    mode: GitCommitDiffMode,
    path: String? = nil,
    previousPath: String? = nil
  ) async throws -> GitCommitDiffResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitCommitDiff(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        commit: commit,
        mode: mode,
        path: path,
        previousPath: previousPath
      )
    }
  }

  public func fetchGitCommitRemoteUrl(
    cwd: String,
    commit: String
  ) async throws -> GitCommitRemoteUrlResponse {
    try await gitRequest { baseURL, contextId in
      try await apiClient.gitCommitRemoteUrl(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        commit: commit
      )
    }
  }

  @discardableResult
  public func runGitCommitAction(
    cwd: String,
    action: GitCommitActionKind,
    commit: String,
    tagName: String? = nil,
    resetMode: GitResetMode? = nil,
    message: String? = nil
  ) async -> Bool {
    await performGitMutation(
      successMessage: action.successMessage,
      errorTitle: action.errorTitle
    ) { baseURL, contextId in
      try await apiClient.runGitCommitAction(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        action: action.rawValue,
        commit: commit,
        tagName: tagName,
        resetMode: resetMode?.rawValue,
        message: message
      )
    }
  }

  @discardableResult
  public func checkoutGitBranch(
    cwd: String,
    branchName: String,
    create: Bool = false,
    startPoint: String? = nil,
    track: Bool = false
  ) async -> Bool {
    await performGitMutation(
      successMessage: create ? "Created branch \(branchName)" : "Switched to \(branchName)",
      errorTitle: create ? "Could not create branch" : "Could not switch branch"
    ) { baseURL, contextId in
      try await apiClient.checkoutGitBranch(
        baseURL: baseURL,
        contextId: contextId,
        cwd: cwd,
        branch: branchName,
        create: create,
        startPoint: startPoint,
        track: track
      )
    }
  }

  public func addComposerGitComment(
    title: String,
    subtitle: String? = nil,
    systemImage: String = "text.bubble",
    comment: String,
    context: String
  ) {
    let trimmedComment = comment.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedComment.isEmpty else { return }

    let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedSubtitle = subtitle?.trimmingCharacters(in: .whitespacesAndNewlines)
    composerGitComments.append(
      ComposerGitCommentAttachment(
        title: trimmedTitle.isEmpty ? "Git context" : trimmedTitle,
        subtitle: trimmedSubtitle?.isEmpty == true ? nil : trimmedSubtitle,
        systemImage: systemImage,
        comment: trimmedComment,
        context: context.trimmingCharacters(in: .whitespacesAndNewlines)
      )
    )
  }

  public func updateComposerGitComment(_ id: String, comment: String) {
    let trimmedComment = comment.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedComment.isEmpty,
          let index = composerGitComments.firstIndex(where: { $0.id == id }) else {
      return
    }

    composerGitComments[index].comment = trimmedComment
  }

  public func removeComposerGitComment(_ id: String) {
    composerGitComments.removeAll { $0.id == id }
  }

  public func appendGitContextToComposer(_ text: String) {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedText.isEmpty else { return }

    let prefix = composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      ? ""
      : "\n\n"
    composerText += prefix + trimmedText
    saveDraft()
  }

  func promptMessageWithGitComments(
    text: String,
    gitComments: [ComposerGitCommentAttachment]
  ) -> String {
    let baseMessage = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let commentBlock = Self.gitCommentPromptBlock(gitComments)
    guard !commentBlock.isEmpty else { return baseMessage }

    return baseMessage.isEmpty ? commentBlock : baseMessage + "\n\n" + commentBlock
  }

  private static func gitCommentPromptBlock(
    _ comments: [ComposerGitCommentAttachment]
  ) -> String {
    let entries = comments.compactMap { attachment -> String? in
      let comment = attachment.comment.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !comment.isEmpty else { return nil }

      let title = attachment.title.trimmingCharacters(in: .whitespacesAndNewlines)
      let subtitle = attachment.subtitle?.trimmingCharacters(in: .whitespacesAndNewlines)
      let reference = subtitle?.isEmpty == false
        ? "\(subtitle ?? "Git context") `\(title.isEmpty ? "Git context" : title)`"
        : "`\(title.isEmpty ? "Git context" : title)`"
      let context = attachment.context.trimmingCharacters(in: .whitespacesAndNewlines)
      if context.isEmpty {
        return "- \(reference): \(comment)"
      }

      return "- \(reference): \(comment)\n\n\(context)"
    }

    guard !entries.isEmpty else { return "" }
    return "Git comments:\n" + entries.joined(separator: "\n\n")
  }

  private func gitRequest<Response>(
    _ operation: (URL, String) async throws -> Response
  ) async throws -> Response {
    guard let baseURL else { throw PicoAPIError.apiError("Not connected") }
    return try await operation(baseURL, connectionStore.contextId)
  }

  private func performGitMutation(
    successMessage: String,
    errorTitle: String,
    operation: (URL, String) async throws -> GitActionResponse
  ) async -> Bool {
    guard let baseURL else {
      alert = AppAlert(
        title: "Not connected",
        message: "Connect to a Pico server before using Git tools."
      )
      return false
    }

    do {
      _ = try await operation(baseURL, connectionStore.contextId)
      refreshFilesGitStateAfterMutation(force: true)
      return true
    } catch {
      alert = AppAlert(title: errorTitle, message: Self.gitMessage(for: error))
      return false
    }
  }

  private static func trimmedNonEmpty(_ value: String?) -> String? {
    let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedValue.isEmpty ? nil : trimmedValue
  }

  private static func gitMessage(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }

    return error.localizedDescription
  }
}

public enum GitCommitActionKind: String, CaseIterable, Identifiable, Sendable {
  case checkout
  case cherryPick = "cherry-pick"
  case revert
  case tag
  case reset
  case rebase
  case drop
  case squash

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .checkout:
      "Checkout commit"
    case .cherryPick:
      "Cherry-pick"
    case .revert:
      "Revert"
    case .tag:
      "Tag"
    case .reset:
      "Reset branch"
    case .rebase:
      "Rebase onto commit"
    case .drop:
      "Drop commit"
    case .squash:
      "Squash commit"
    }
  }

  var successMessage: String {
    switch self {
    case .checkout:
      "Checked out commit"
    case .cherryPick:
      "Cherry-picked commit"
    case .revert:
      "Reverted commit"
    case .tag:
      "Created tag"
    case .reset:
      "Reset branch"
    case .rebase:
      "Rebased branch"
    case .drop:
      "Dropped commit"
    case .squash:
      "Squashed commit"
    }
  }

  var errorTitle: String {
    switch self {
    case .checkout:
      "Could not checkout commit"
    case .cherryPick:
      "Could not cherry-pick"
    case .revert:
      "Could not revert commit"
    case .tag:
      "Could not create tag"
    case .reset:
      "Could not reset branch"
    case .rebase:
      "Could not rebase branch"
    case .drop:
      "Could not drop commit"
    case .squash:
      "Could not squash commit"
    }
  }
}

public enum GitResetMode: String, CaseIterable, Identifiable, Sendable {
  case soft
  case mixed
  case hard

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .soft:
      "Soft"
    case .mixed:
      "Mixed"
    case .hard:
      "Hard"
    }
  }
}

private extension GitChangeFile {
  var displayName: String {
    path.split(separator: "/").last.map(String.init) ?? path
  }
}
