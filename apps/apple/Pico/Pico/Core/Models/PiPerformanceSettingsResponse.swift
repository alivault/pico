import Foundation

public enum PiTransport: String, Codable, CaseIterable, Sendable {
  case auto
  case sse
  case websocket
  case websocketCached = "websocket-cached"

  public var label: String {
    switch self {
    case .auto: "Auto"
    case .sse: "SSE"
    case .websocket: "WebSocket"
    case .websocketCached: "Cached WebSocket"
    }
  }
}

public enum PiCacheRetention: String, Codable, Sendable {
  case standard
  case long
}

public struct PiPerformanceSettingsResponse: Decodable, Sendable {
  public var ok: Bool
  public var transport: PiTransport
  public var cacheRetention: PiCacheRetention
  public var appliesToActiveSessionAfterRestart: Bool?
}
