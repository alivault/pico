import Foundation

public enum PicoEndpoint: Sendable {
  case manifest
  case events
  case prompt
  case abort
  case sessionNew
  case sessionSelect
  case sessionRename
  case sessionDelete
  case directoryResolve
  case directorySearch
  case directorySessionsIndexes
  case gitStatus
  case gitChanges
  case gitCheckout
  case pathCompletions
  case pendingMessagesReorder
  case slashCommand
  case model
  case thinking
  case settingsHideThinking
  case authProviders
  case authApiKey
  case authOAuth
  case authLogout
  case uiRequest(String)

  public var path: String {
    switch self {
    case .manifest:
      "/api/client/manifest"
    case .events:
      "/events"
    case .prompt:
      "/api/prompt"
    case .abort:
      "/api/abort"
    case .sessionNew:
      "/api/session/new"
    case .sessionSelect:
      "/api/session/select"
    case .sessionRename:
      "/api/session/rename"
    case .sessionDelete:
      "/api/session/delete"
    case .directoryResolve:
      "/api/directory/resolve"
    case .directorySearch:
      "/api/directory-search"
    case .directorySessionsIndexes:
      "/api/directory-sessions-indexes"
    case .gitStatus:
      "/api/git-status"
    case .gitChanges:
      "/api/git-changes"
    case .gitCheckout:
      "/api/git-checkout"
    case .pathCompletions:
      "/api/path-completions"
    case .pendingMessagesReorder:
      "/api/pending-messages/reorder"
    case .slashCommand:
      "/api/slash-command"
    case .model:
      "/api/model"
    case .thinking:
      "/api/thinking"
    case .settingsHideThinking:
      "/api/settings/hide-thinking"
    case .authProviders:
      "/api/auth/providers"
    case .authApiKey:
      "/api/auth/api-key"
    case .authOAuth:
      "/api/auth/oauth"
    case .authLogout:
      "/api/auth/logout"
    case .uiRequest(let id):
      "/api/ui/\(id)"
    }
  }

  public func url(
    baseURL: URL,
    contextId: String? = nil,
    sessionId: String? = nil,
    sessionKey: String? = nil,
    extraQueryItems: [URLQueryItem] = []
  ) throws -> URL {
    let relativePath = path.hasPrefix("/") ? String(path.dropFirst()) : path
    guard var components = URLComponents(
      url: baseURL.appending(path: relativePath),
      resolvingAgainstBaseURL: false
    ) else {
      throw PicoAPIError.invalidURL
    }

    var queryItems = components.queryItems ?? []
    if let contextId, !contextId.isEmpty {
      queryItems.append(URLQueryItem(name: "context", value: contextId))
    }
    if let sessionId, !sessionId.isEmpty {
      queryItems.append(URLQueryItem(name: "session", value: sessionId))
    }
    if let sessionKey, !sessionKey.isEmpty {
      queryItems.append(URLQueryItem(name: "sessionKey", value: sessionKey))
    }
    queryItems.append(contentsOf: extraQueryItems)
    components.queryItems = queryItems.isEmpty ? nil : queryItems

    guard let url = components.url else {
      throw PicoAPIError.invalidURL
    }
    return url
  }
}
