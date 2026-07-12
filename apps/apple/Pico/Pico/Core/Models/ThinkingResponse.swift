import Foundation

public struct ThinkingResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var thinkingLevel: String
  public var availableThinkingLevels: [String]
}

public struct HideThinkingResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var hideThinkingBlock: Bool
}
