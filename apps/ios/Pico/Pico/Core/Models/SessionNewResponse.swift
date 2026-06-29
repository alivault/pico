import Foundation

public struct SessionNewResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var draft: Bool
  public var sessionKey: String
  public var cwd: String?
}
