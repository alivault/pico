import Foundation

struct PicoMenuNetworkStatus: Decodable, Sendable {
  var ok: Bool
  var remoteAccessEnabled: Bool
  var remoteBindAddress: String?
}
