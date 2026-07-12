import Foundation

public enum ConnectionStatus: Equatable, Sendable {
  case disconnected
  case connecting
  case connected
  case reconnecting
  case failed(String)

  public var label: String {
    switch self {
    case .disconnected:
      "Disconnected"
    case .connecting:
      "Connecting…"
    case .connected:
      "Connected"
    case .reconnecting:
      "Reconnecting…"
    case .failed:
      "Connection failed"
    }
  }
}
