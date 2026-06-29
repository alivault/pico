import Foundation

public enum StreamingBehavior: String, Codable, Hashable, Sendable, CaseIterable {
  case followUp
  case steer

  var label: String {
    switch self {
    case .followUp:
      "Follow-up"
    case .steer:
      "Steer"
    }
  }
}
