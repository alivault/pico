import Foundation

public struct UserConversationItem: Decodable, Hashable, Identifiable, Sendable {
  public var id: String {
    itemKey ?? renderKey ?? pendingId ?? "user:\(text.hashValue):\(images.count)"
  }

  public var itemKey: String?
  public var renderKey: String?
  public var pendingId: String?
  public var forkEntryId: String?
  public var text: String
  public var images: [PromptImage]
  public var queued: Bool?
  public var streamingBehavior: StreamingBehavior?

  private enum CodingKeys: String, CodingKey {
    case itemKey
    case renderKey
    case pendingId
    case forkEntryId
    case text
    case images
    case queued
    case streamingBehavior
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    itemKey = try container.decodeIfPresent(String.self, forKey: .itemKey)
    renderKey = try container.decodeIfPresent(String.self, forKey: .renderKey)
    pendingId = try container.decodeIfPresent(String.self, forKey: .pendingId)
    forkEntryId = try container.decodeIfPresent(String.self, forKey: .forkEntryId)
    text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
    images = try container.decodeIfPresent([PromptImage].self, forKey: .images) ?? []
    queued = try container.decodeIfPresent(Bool.self, forKey: .queued)
    streamingBehavior = try container.decodeIfPresent(
      StreamingBehavior.self,
      forKey: .streamingBehavior
    )
  }

  public init(
    itemKey: String? = nil,
    renderKey: String? = nil,
    pendingId: String? = nil,
    forkEntryId: String? = nil,
    text: String,
    images: [PromptImage],
    queued: Bool? = nil,
    streamingBehavior: StreamingBehavior? = nil
  ) {
    self.itemKey = itemKey
    self.renderKey = renderKey
    self.pendingId = pendingId
    self.forkEntryId = forkEntryId
    self.text = text
    self.images = images
    self.queued = queued
    self.streamingBehavior = streamingBehavior
  }
}
