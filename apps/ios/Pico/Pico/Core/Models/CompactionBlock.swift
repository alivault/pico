import Foundation

public struct CompactionBlock: Decodable, Hashable, Identifiable, Sendable {
  public var id: String {
    if let key = blockKey ?? renderKey {
      return key
    }

    let estimatedTokensAfterValue = estimatedTokensAfter ?? 0
    return "compaction:\(tokensBefore):\(estimatedTokensAfterValue):\(summary.hashValue)"
  }

  public var type: String?
  public var blockKey: String?
  public var renderKey: String?
  public var summary: String
  public var tokensBefore: Int
  public var estimatedTokensAfter: Int?

  private enum CodingKeys: String, CodingKey {
    case type
    case blockKey
    case renderKey
    case summary
    case tokensBefore
    case estimatedTokensAfter
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decodeIfPresent(String.self, forKey: .type)
    blockKey = try container.decodeIfPresent(String.self, forKey: .blockKey)
    renderKey = try container.decodeIfPresent(String.self, forKey: .renderKey)
    summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
    tokensBefore = try container.decodeIfPresent(Int.self, forKey: .tokensBefore) ?? 0
    estimatedTokensAfter = try container.decodeIfPresent(
      Int.self,
      forKey: .estimatedTokensAfter
    )
  }

  public init(
    type: String? = "compaction",
    blockKey: String? = nil,
    renderKey: String? = nil,
    summary: String,
    tokensBefore: Int,
    estimatedTokensAfter: Int? = nil
  ) {
    self.type = type
    self.blockKey = blockKey
    self.renderKey = renderKey
    self.summary = summary
    self.tokensBefore = tokensBefore
    self.estimatedTokensAfter = estimatedTokensAfter
  }
}
