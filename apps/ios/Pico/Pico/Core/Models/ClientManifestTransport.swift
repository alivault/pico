import Foundation

public struct ClientManifestTransport: Decodable, Hashable, Sendable {
  public var sse: Bool
  public var httpsRequired: Bool
  public var localHttpAllowed: Bool
}
