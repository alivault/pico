import Foundation

public actor PicoAPIClient {
  private let session: URLSession
  private let decoder: JSONDecoder
  private let encoder: JSONEncoder

  public init(session: URLSession = .shared) {
    self.session = session
    decoder = JSONDecoder()
    encoder = JSONEncoder()
  }

  public func manifest(baseURL: URL) async throws -> ClientManifest {
    let manifest: ClientManifest = try await send(
      endpoint: .manifest,
      baseURL: baseURL,
      method: "GET"
    )

    guard manifest.ok else {
      throw PicoAPIError.apiError("Pico manifest request failed.")
    }
    guard manifest.apiContractVersion == 1 else {
      throw PicoAPIError.unsupportedManifest(
        "This Pico server uses API contract \(manifest.apiContractVersion), but this app supports contract 1."
      )
    }
    guard manifest.transport.sse else {
      throw PicoAPIError.unsupportedManifest(
        "This Pico server does not advertise SSE support."
      )
    }

    return manifest
  }

  public func createSession(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    cwd: String?
  ) async throws -> SessionNewResponse {
    try await send(
      endpoint: .sessionNew,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: SessionNewRequestBody(cwd: cwd)
    )
  }

  public func selectSession(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionPath: String? = nil
  ) async throws -> SimpleOkResponse {
    let sessionPath = sessionPath?.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    let extraQueryItems = sessionPath?.isEmpty == false
      ? [URLQueryItem(name: "sessionPath", value: sessionPath)]
      : []
    let url = try PicoEndpoint.sessionSelect.url(
      baseURL: baseURL,
      contextId: contextId,
      sessionId: sessionId,
      extraQueryItems: extraQueryItems
    )
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    return try await perform(request)
  }

  public func forkableMessages(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?
  ) async throws -> ForkableMessagesResponse {
    try await send(
      endpoint: .sessionFork,
      baseURL: baseURL,
      method: "GET",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey
    )
  }

  public func forkSession(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    entryId: String
  ) async throws -> ForkSessionResponse {
    try await send(
      endpoint: .sessionFork,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: ForkSessionRequestBody(entryId: entryId)
    )
  }

  public func branchSessionAtMessage(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    entryId: String
  ) async throws -> ForkSessionResponse {
    try await send(
      endpoint: .sessionFork,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: ForkSessionRequestBody(entryId: entryId, position: "at")
    )
  }

  public func renameSession(
    baseURL: URL,
    contextId: String,
    path: String,
    name: String
  ) async throws -> SimpleOkResponse {
    try await send(
      endpoint: .sessionRename,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: [
        "path": path,
        "name": name,
      ]
    )
  }

  public func deleteSession(
    baseURL: URL,
    contextId: String,
    path: String
  ) async throws -> SimpleOkResponse {
    try await send(
      endpoint: .sessionDelete,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: ["path": path]
    )
  }

  public func resolveDirectory(
    baseURL: URL,
    contextId: String,
    path: String
  ) async throws -> DirectoryResolveResponse {
    try await send(
      endpoint: .directoryResolve,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: ["path": path]
    )
  }

  public func searchDirectories(
    baseURL: URL,
    contextId: String,
    query: String
  ) async throws -> DirectorySearchResponse {
    try await send(
      endpoint: .directorySearch,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: ["query": query]
    )
  }

  public func cleanupDirectorySessions(
    baseURL: URL,
    contextId: String,
    directory: String,
    olderThanMs: Int,
    dryRun: Bool
  ) async throws -> DeleteOldDirectorySessionsResponse {
    try await send(
      endpoint: .directorySessionsCleanup,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: DeleteOldDirectorySessionsRequest(
        directory: directory,
        olderThanMs: olderThanMs,
        dryRun: dryRun
      )
    )
  }

  public func directorySessionIndexes(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    directories: [String]
  ) async throws -> DirectorySessionsIndexesResponse {
    let queryItems = directories.map {
      URLQueryItem(name: "directory", value: $0)
    }
    let url = try PicoEndpoint.directorySessionsIndexes.url(
      baseURL: baseURL,
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      extraQueryItems: queryItems
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func gitStatus(
    baseURL: URL,
    contextId: String,
    cwd: String
  ) async throws -> GitStatusResponse {
    let url = try PicoEndpoint.gitStatus.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [URLQueryItem(name: "cwd", value: cwd)]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func gitChanges(
    baseURL: URL,
    contextId: String,
    cwd: String,
    scope: String,
    commitsLimit: Int? = nil
  ) async throws -> GitChangesResponse {
    var queryItems = [
      URLQueryItem(name: "cwd", value: cwd),
      URLQueryItem(name: "gitScope", value: scope),
    ]
    if let commitsLimit {
      queryItems.append(
        URLQueryItem(name: "commitsLimit", value: String(commitsLimit))
      )
    }
    let url = try PicoEndpoint.gitChanges.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: queryItems
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func gitFileDiff(
    baseURL: URL,
    contextId: String,
    cwd: String,
    path: String
  ) async throws -> GitFileDiffResponse {
    let url = try PicoEndpoint.gitDiff.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [
        URLQueryItem(name: "cwd", value: cwd),
        URLQueryItem(name: "path", value: path),
      ]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func gitFileReview(
    baseURL: URL,
    contextId: String,
    cwd: String,
    path: String,
    previousPath: String? = nil
  ) async throws -> GitFileReviewResponse {
    var queryItems = [
      URLQueryItem(name: "cwd", value: cwd),
      URLQueryItem(name: "path", value: path),
    ]
    if let previousPath, !previousPath.isEmpty {
      queryItems.append(URLQueryItem(name: "previousPath", value: previousPath))
    }
    let url = try PicoEndpoint.gitReview.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: queryItems
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func stageGitFile(
    baseURL: URL,
    contextId: String,
    cwd: String,
    path: String,
    previousPath: String? = nil,
    unstage: Bool = false
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitStage,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitStageRequestBody(
        action: unstage ? "unstage" : nil,
        cwd: cwd,
        path: path,
        previousPath: previousPath
      )
    )
  }

  public func stageGitAll(
    baseURL: URL,
    contextId: String,
    cwd: String,
    unstage: Bool = false
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitStage,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitStageRequestBody(
        action: unstage ? "unstage-all" : "stage-all",
        all: true,
        cwd: cwd
      )
    )
  }

  public func discardGitFile(
    baseURL: URL,
    contextId: String,
    cwd: String,
    path: String,
    previousPath: String? = nil,
    status: String? = nil
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitDiscard,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitDiscardRequestBody(
        cwd: cwd,
        path: path,
        previousPath: previousPath,
        status: status
      )
    )
  }

  public func discardGitAll(
    baseURL: URL,
    contextId: String,
    cwd: String,
    nukeWorkingTree: Bool = false
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitDiscard,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitDiscardRequestBody(
        action: nukeWorkingTree ? "nuke-working-tree" : "discard-all",
        all: true,
        cwd: cwd
      )
    )
  }

  public func commitGitChanges(
    baseURL: URL,
    contextId: String,
    cwd: String,
    message: String,
    push: Bool = false,
    forcePush: Bool = false,
    includeUnstaged: Bool = true
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitCommit,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitCommitRequestBody(
        cwd: cwd,
        message: message,
        push: push,
        forcePush: forcePush,
        includeUnstaged: includeUnstaged
      )
    )
  }

  public func generateGitCommitMessage(
    baseURL: URL,
    contextId: String,
    cwd: String
  ) async throws -> GitCommitMessageResponse {
    try await send(
      endpoint: .gitCommitMessage,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: ["cwd": cwd]
    )
  }

  public func pushGitChanges(
    baseURL: URL,
    contextId: String,
    cwd: String,
    force: Bool = false
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitPush,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitPushRequestBody(cwd: cwd, force: force)
    )
  }

  public func pullGitChanges(
    baseURL: URL,
    contextId: String,
    cwd: String
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitPull,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: ["cwd": cwd]
    )
  }

  public func gitCommitFiles(
    baseURL: URL,
    contextId: String,
    cwd: String,
    commit: String
  ) async throws -> GitCommitFilesResponse {
    let url = try PicoEndpoint.gitCommitFiles.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [
        URLQueryItem(name: "cwd", value: cwd),
        URLQueryItem(name: "commit", value: commit),
      ]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func gitCommitDiff(
    baseURL: URL,
    contextId: String,
    cwd: String,
    commit: String,
    mode: GitCommitDiffMode,
    path: String? = nil,
    previousPath: String? = nil
  ) async throws -> GitCommitDiffResponse {
    var queryItems = [
      URLQueryItem(name: "cwd", value: cwd),
      URLQueryItem(name: "commit", value: commit),
      URLQueryItem(name: "mode", value: mode.rawValue),
    ]
    if let path, !path.isEmpty {
      queryItems.append(URLQueryItem(name: "path", value: path))
    }
    if let previousPath, !previousPath.isEmpty {
      queryItems.append(URLQueryItem(name: "previousPath", value: previousPath))
    }
    let url = try PicoEndpoint.gitCommitDiff.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: queryItems
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func gitCommitRemoteUrl(
    baseURL: URL,
    contextId: String,
    cwd: String,
    commit: String
  ) async throws -> GitCommitRemoteUrlResponse {
    let url = try PicoEndpoint.gitCommitRemoteUrl.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [
        URLQueryItem(name: "cwd", value: cwd),
        URLQueryItem(name: "commit", value: commit),
      ]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func runGitCommitAction(
    baseURL: URL,
    contextId: String,
    cwd: String,
    action: String,
    commit: String,
    tagName: String? = nil,
    resetMode: String? = nil,
    message: String? = nil
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitCommitAction,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitCommitActionRequestBody(
        cwd: cwd,
        action: action,
        commit: commit,
        tagName: tagName,
        resetMode: resetMode,
        message: message
      )
    )
  }

  public func projectFileTree(
    baseURL: URL,
    contextId: String,
    cwd: String
  ) async throws -> ProjectFileTreeResponse {
    let url = try PicoEndpoint.filesTree.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [URLQueryItem(name: "cwd", value: cwd)]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func projectFileRead(
    baseURL: URL,
    contextId: String,
    cwd: String,
    path: String
  ) async throws -> ProjectFileReadResponse {
    let url = try PicoEndpoint.filesRead.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [
        URLQueryItem(name: "cwd", value: cwd),
        URLQueryItem(name: "path", value: path),
      ]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func highlightCode(
    baseURL: URL,
    contextId: String,
    code: String,
    language: String
  ) async throws -> HighlightResponse {
    try await send(
      endpoint: .highlight,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: HighlightRequestBody(code: code, language: language)
    )
  }

  public func checkoutGitBranch(
    baseURL: URL,
    contextId: String,
    cwd: String,
    branch: String,
    create: Bool = false,
    startPoint: String? = nil,
    track: Bool = false
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitCheckout,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitCheckoutBranchRequestBody(
        cwd: cwd,
        branch: branch,
        create: create ? true : nil,
        startPoint: startPoint,
        track: track ? true : nil
      )
    )
  }

  public func pathCompletions(
    baseURL: URL,
    contextId: String,
    prefix: String
  ) async throws -> PathCompletionsResponse {
    try await send(
      endpoint: .pathCompletions,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: ["prefix": prefix]
    )
  }

  public func submitPrompt(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    body: PromptRequestBody
  ) async throws -> PromptResponse {
    try await send(
      endpoint: .prompt,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: body
    )
  }

  public func reorderPendingMessages(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    pendingMessages: [PendingUserMessage]
  ) async throws -> PendingMessagesResponse {
    try await send(
      endpoint: .pendingMessagesReorder,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: PendingMessagesReorderRequest(pendingMessages: pendingMessages)
    )
  }

  public func removePendingMessage(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    pendingId: String
  ) async throws -> PendingMessageRemoveResponse {
    try await send(
      endpoint: .pendingMessageRemove,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: PendingMessageRemoveRequest(pendingId: pendingId)
    )
  }

  public func abort(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?
  ) async throws -> SimpleOkResponse {
    try await send(
      endpoint: .abort,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey
    )
  }

  public func runSlashCommand(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    name: String,
    args: String = ""
  ) async throws -> SimpleOkResponse {
    try await send(
      endpoint: .slashCommand,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: [
        "name": name,
        "args": args,
      ]
    )
  }

  public func setModel(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    model: ModelOption
  ) async throws -> ModelResponse {
    try await send(
      endpoint: .model,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: [
        "provider": model.provider ?? "",
        "modelId": model.id,
      ]
    )
  }

  public func setThinking(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    level: String
  ) async throws -> ThinkingResponse {
    try await send(
      endpoint: .thinking,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: ["level": level]
    )
  }

  public func setHideThinking(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    hide: Bool
  ) async throws -> HideThinkingResponse {
    try await send(
      endpoint: .settingsHideThinking,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: ["hide": hide]
    )
  }

  public func authProviders(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?
  ) async throws -> AuthProvidersResponse {
    try await send(
      endpoint: .authProviders,
      baseURL: baseURL,
      method: "GET",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey
    )
  }

  public func saveProviderApiKey(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    provider: String,
    key: String
  ) async throws -> AuthMutationResponse {
    try await send(
      endpoint: .authApiKey,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: [
        "provider": provider,
        "key": key,
      ]
    )
  }

  public func loginProviderOAuth(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    provider: String
  ) async throws -> AuthMutationResponse {
    try await send(
      endpoint: .authOAuth,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: ["provider": provider]
    )
  }

  public func logoutProvider(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    provider: String
  ) async throws -> AuthMutationResponse {
    try await send(
      endpoint: .authLogout,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey,
      body: ["provider": provider]
    )
  }

  public func resolveUiRequest(
    baseURL: URL,
    id: String,
    body: [String: JSONValue]
  ) async throws -> SimpleOkResponse {
    try await send(
      endpoint: .uiRequest(id),
      baseURL: baseURL,
      method: "POST",
      body: body
    )
  }

  private func send<Response: Decodable>(
    endpoint: PicoEndpoint,
    baseURL: URL,
    method: String,
    contextId: String? = nil,
    sessionId: String? = nil,
    sessionKey: String? = nil
  ) async throws -> Response {
    let url = try endpoint.url(
      baseURL: baseURL,
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey
    )
    var request = URLRequest(url: url)
    request.httpMethod = method
    return try await perform(request)
  }

  private func send<Body: Encodable, Response: Decodable>(
    endpoint: PicoEndpoint,
    baseURL: URL,
    method: String,
    contextId: String? = nil,
    sessionId: String? = nil,
    sessionKey: String? = nil,
    body: Body
  ) async throws -> Response {
    let url = try endpoint.url(
      baseURL: baseURL,
      contextId: contextId,
      sessionId: sessionId,
      sessionKey: sessionKey
    )
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try encoder.encode(body)
    return try await perform(request)
  }

  private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
    let (data, response) = try await session.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw PicoAPIError.invalidResponse
    }

    if let apiError = try? decoder.decode(ApiErrorEnvelope.self, from: data), apiError.ok == false {
      throw PicoAPIError.apiError(apiError.error)
    }

    guard (200..<300).contains(httpResponse.statusCode) else {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw PicoAPIError.httpStatus(httpResponse.statusCode, body)
    }

    return try decoder.decode(Response.self, from: data)
  }
}

private struct GitStageRequestBody: Encodable, Sendable {
  var action: String?
  var all: Bool?
  var cwd: String
  var path: String?
  var previousPath: String?
}

private struct GitDiscardRequestBody: Encodable, Sendable {
  var action: String?
  var all: Bool?
  var cwd: String
  var path: String?
  var previousPath: String?
  var status: String?
}

private struct GitCommitRequestBody: Encodable, Sendable {
  var cwd: String
  var message: String
  var push: Bool
  var forcePush: Bool
  var includeUnstaged: Bool
}

private struct GitPushRequestBody: Encodable, Sendable {
  var cwd: String
  var force: Bool
}

private struct GitCommitActionRequestBody: Encodable, Sendable {
  var cwd: String
  var action: String
  var commit: String
  var tagName: String?
  var resetMode: String?
  var message: String?
}

private struct GitCheckoutBranchRequestBody: Encodable, Sendable {
  var cwd: String
  var branch: String
  var create: Bool?
  var startPoint: String?
  var track: Bool?
}

private struct HighlightRequestBody: Encodable, Sendable {
  var code: String
  var language: String
}

private struct ForkSessionRequestBody: Encodable, Sendable {
  var entryId: String
  var position: String? = nil
}
