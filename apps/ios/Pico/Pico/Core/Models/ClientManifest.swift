import Foundation

public struct ClientManifest: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var name: String
  public var version: String
  public var displayName: String
  public var apiContractVersion: Int
  public var pairingRequired: Bool
  public var authentication: ClientManifestAuthentication
  public var transport: ClientManifestTransport
  public var capabilities: ClientManifestCapabilities
}
