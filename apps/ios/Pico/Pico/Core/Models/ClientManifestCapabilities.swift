import Foundation

public struct ClientManifestCapabilities: Decodable, Hashable, Sendable {
  public var events: [String]
  public var endpoints: [String]
  public var features: [String]
}
