import Foundation

public struct AssistantConversationItem: Decodable, Hashable, Identifiable, Sendable {
  public var id: String {
    itemKey ?? renderKey ?? "assistant:\(blocks.hashValue):\(streaming == true ? "streaming" : "done")"
  }

  public var itemKey: String?
  public var renderKey: String?
  public var branchEntryId: String?
  public var blocks: [AssistantBlock]
  public var streaming: Bool?
  public var done: Bool?
  public var model: ModelOption?

  private enum CodingKeys: String, CodingKey {
    case itemKey
    case renderKey
    case branchEntryId
    case blocks
    case streaming
    case done
    case model
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    itemKey = try container.decodeIfPresent(String.self, forKey: .itemKey)
    renderKey = try container.decodeIfPresent(String.self, forKey: .renderKey)
    branchEntryId = try container.decodeIfPresent(String.self, forKey: .branchEntryId)
    blocks = try container.decodeIfPresent([AssistantBlock].self, forKey: .blocks) ?? []
    streaming = try container.decodeIfPresent(Bool.self, forKey: .streaming)
    done = try container.decodeIfPresent(Bool.self, forKey: .done)
    model = try container.decodeIfPresent(ModelOption.self, forKey: .model)
  }

  public init(
    itemKey: String? = nil,
    renderKey: String? = nil,
    branchEntryId: String? = nil,
    blocks: [AssistantBlock],
    streaming: Bool? = nil,
    done: Bool? = nil,
    model: ModelOption? = nil
  ) {
    self.itemKey = itemKey
    self.renderKey = renderKey
    self.branchEntryId = branchEntryId
    self.blocks = blocks
    self.streaming = streaming
    self.done = done
    self.model = model
  }
}
