import Foundation

public enum PicoServerEvent: Decodable, Sendable {
  case stateSync(StateSyncPayload)
  case sessions(SessionsEvent)
  case sessionStatus(SessionStatusEvent)
  case sessionDone(SessionDoneEvent)
  case requestError(RequestErrorEvent)
  case extensionError(ExtensionErrorEvent)
  case extensionUiRequest(UiRequest)
  case userMessage(UserMessageEvent)
  case autoSessionNamingError(AutoSessionNamingErrorEvent)
  case gitChanged(GitChangedEvent)
  case unknown(String)

  private enum CodingKeys: String, CodingKey {
    case type
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decodeIfPresent(String.self, forKey: .type)

    switch type {
    case "state_sync":
      self = .stateSync(try StateSyncPayload(from: decoder))
    case "sessions":
      self = .sessions(try SessionsEvent(from: decoder))
    case "session_status":
      self = .sessionStatus(try SessionStatusEvent(from: decoder))
    case "session_done":
      self = .sessionDone(try SessionDoneEvent(from: decoder))
    case "request_error":
      self = .requestError(try RequestErrorEvent(from: decoder))
    case "extension_error":
      self = .extensionError(try ExtensionErrorEvent(from: decoder))
    case "extension_ui_request":
      self = .extensionUiRequest(try UiRequest(from: decoder))
    case "user_message":
      self = .userMessage(try UserMessageEvent(from: decoder))
    case "auto_session_naming_error":
      self = .autoSessionNamingError(try AutoSessionNamingErrorEvent(from: decoder))
    case "git_changed":
      self = .gitChanged(try GitChangedEvent(from: decoder))
    default:
      self = .unknown(type ?? "missing")
    }
  }
}
