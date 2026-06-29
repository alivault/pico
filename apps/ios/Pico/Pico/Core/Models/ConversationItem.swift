import Foundation

public enum ConversationItem: Decodable, Hashable, Identifiable, Sendable {
  case user(UserConversationItem)
  case assistant(AssistantConversationItem)
  case unknown(String)

  public var id: String {
    switch self {
    case .user(let item):
      item.id
    case .assistant(let item):
      item.id
    case .unknown(let kind):
      "unknown:\(kind)"
    }
  }

  private enum CodingKeys: String, CodingKey {
    case kind
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decodeIfPresent(String.self, forKey: .kind)

    switch kind {
    case "user":
      self = (try? .user(UserConversationItem(from: decoder))) ?? .unknown("user")
    case "assistant":
      self = (try? .assistant(AssistantConversationItem(from: decoder))) ?? .unknown("assistant")
    default:
      self = .unknown(kind ?? "missing")
    }
  }
}
