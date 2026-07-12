import Foundation

public enum StreamingBehavior: String, Codable, Hashable, Sendable, CaseIterable {
  case steer
  case followUp

  var label: String {
    switch self {
    case .steer:
      "Steer"
    case .followUp:
      "Follow-up"
    }
  }
}
