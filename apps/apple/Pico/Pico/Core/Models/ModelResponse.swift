import Foundation

public struct ModelResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var model: ModelOption?
  public var thinkingLevel: String?
  public var availableThinkingLevels: [String]?
  public var availableModels: [ModelOption]?
}
