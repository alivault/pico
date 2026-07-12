import Foundation

public struct HighlightResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var language: String?
  public var html: String?
  public var skipped: Bool?
  public var unsupported: Bool?
  public var unavailable: Bool?
}
