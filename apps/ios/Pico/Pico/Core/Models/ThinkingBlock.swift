import Foundation

public struct ThinkingBlock: Decodable, Hashable, Identifiable, Sendable {
  public var id: String { blockKey ?? renderKey ?? "thinking:\(text.hashValue)" }

  public var type: String?
  public var blockKey: String?
  public var renderKey: String?
  public var text: String
  public var summaryLabel: String?

  private enum CodingKeys: String, CodingKey {
    case type
    case blockKey
    case renderKey
    case text
    case thinking
    case summaryLabel
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decodeIfPresent(String.self, forKey: .type)
    blockKey = try container.decodeIfPresent(String.self, forKey: .blockKey)
    renderKey = try container.decodeIfPresent(String.self, forKey: .renderKey)
    let renderedText = try container.decodeIfPresent(String.self, forKey: .text)
    let rawThinking = try container.decodeIfPresent(String.self, forKey: .thinking)
    text = renderedText ?? rawThinking ?? ""
    summaryLabel = try container.decodeIfPresent(String.self, forKey: .summaryLabel)
  }

  public init(
    type: String? = "thinking",
    blockKey: String? = nil,
    renderKey: String? = nil,
    text: String,
    summaryLabel: String? = nil
  ) {
    self.type = type
    self.blockKey = blockKey
    self.renderKey = renderKey
    self.text = text
    self.summaryLabel = summaryLabel
  }
}
