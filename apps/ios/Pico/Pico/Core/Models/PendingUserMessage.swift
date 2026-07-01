import Foundation

public struct PendingUserMessage: Codable, Hashable, Identifiable, Sendable {
  public var id: String { pendingId }

  public var pendingId: String
  public var text: String
  public var images: [PromptImage]
  public var streamingBehavior: StreamingBehavior

  private enum CodingKeys: String, CodingKey {
    case pendingId
    case text
    case images
    case streamingBehavior
  }

  public init(
    pendingId: String,
    text: String,
    images: [PromptImage],
    streamingBehavior: StreamingBehavior
  ) {
    self.pendingId = pendingId
    self.text = text
    self.images = images
    self.streamingBehavior = streamingBehavior
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    pendingId = try container.decodeIfPresent(String.self, forKey: .pendingId) ?? ""
    text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
    images = try container.decodeIfPresent([PromptImage].self, forKey: .images) ?? []
    streamingBehavior = try container.decodeIfPresent(
      StreamingBehavior.self,
      forKey: .streamingBehavior
    ) ?? .followUp
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(pendingId, forKey: .pendingId)
    try container.encode(text, forKey: .text)
    try container.encode(images, forKey: .images)
    try container.encode(streamingBehavior, forKey: .streamingBehavior)
  }
}

public struct PendingMessagesReorderRequest: Encodable, Sendable {
  public var pendingMessages: [PendingUserMessage]
}

public struct PendingMessageRemoveRequest: Encodable, Sendable {
  public var pendingId: String
}

public struct PendingMessagesResponse: Decodable, Sendable {
  public var ok: Bool
  public var pendingMessages: [PendingUserMessage]
}

public struct PendingMessageRemoveResponse: Decodable, Sendable {
  public var ok: Bool
  public var pendingId: String
}
