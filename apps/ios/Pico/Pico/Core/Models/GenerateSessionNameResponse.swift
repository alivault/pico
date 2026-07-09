import Foundation

public struct GenerateSessionNameResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var name: String
  public var source: GenerateSessionNameSource
  public var reason: String?
}

public enum GenerateSessionNameSource: String, Decodable, Hashable, Sendable {
  case llm
  case heuristic
}
