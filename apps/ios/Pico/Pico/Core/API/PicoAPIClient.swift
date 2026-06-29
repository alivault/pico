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
    scope: String
  ) async throws -> GitChangesResponse {
    let url = try PicoEndpoint.gitChanges.url(
      baseURL: baseURL,
      contextId: contextId,
      extraQueryItems: [
        URLQueryItem(name: "cwd", value: cwd),
        URLQueryItem(name: "gitScope", value: scope),
      ]
    )
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    return try await perform(request)
  }

  public func checkoutGitBranch(
    baseURL: URL,
    contextId: String,
    cwd: String,
    branch: String,
    create: Bool = false
  ) async throws -> GitActionResponse {
    try await send(
      endpoint: .gitCheckout,
      baseURL: baseURL,
      method: "POST",
      contextId: contextId,
      body: GitCheckoutBranchRequestBody(
        cwd: cwd,
        branch: branch,
        create: create ? true : nil
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

private struct GitCheckoutBranchRequestBody: Encodable, Sendable {
  var cwd: String
  var branch: String
  var create: Bool?
}
