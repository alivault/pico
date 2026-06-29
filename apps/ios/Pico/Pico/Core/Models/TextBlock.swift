import Foundation

public struct TextBlock: Decodable, Hashable, Identifiable, Sendable {
  public var id: String { blockKey ?? renderKey ?? "text:\(text.hashValue)" }

  public var type: String?
  public var blockKey: String?
  public var renderKey: String?
  public var text: String
  public var isError: Bool?

  private enum CodingKeys: String, CodingKey {
    case type
    case blockKey
    case renderKey
    case text
    case isError
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decodeIfPresent(String.self, forKey: .type)
    blockKey = try container.decodeIfPresent(String.self, forKey: .blockKey)
    renderKey = try container.decodeIfPresent(String.self, forKey: .renderKey)
    text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
    isError = try container.decodeIfPresent(Bool.self, forKey: .isError)
  }

  public init(
    type: String? = "text",
    blockKey: String? = nil,
    renderKey: String? = nil,
    text: String,
    isError: Bool? = nil
  ) {
    self.type = type
    self.blockKey = blockKey
    self.renderKey = renderKey
    self.text = text
    self.isError = isError
  }
}
