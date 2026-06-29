import Foundation

public struct ApiErrorEnvelope: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var error: String
  public var routePath: String?
}
