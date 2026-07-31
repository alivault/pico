import Foundation

struct PicoMenuHealthStatus: Decodable, Sendable {
  var ok: Bool
  var listenHosts: [String]?
  var port: Int?
}
