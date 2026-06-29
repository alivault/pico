import Foundation

public struct ModelOption: Codable, Hashable, Identifiable, Sendable {
  public var id: String
  public var provider: String?
  public var name: String?
  public var reasoning: Bool?

  public var stableIdentifier: String {
    guard let provider,
          !provider.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return id
    }

    return "\(provider)/\(id)"
  }

  public var displayName: String {
    if let name, !name.isEmpty {
      name
    } else {
      id
    }
  }

  public var providerDisplayName: String {
    guard let provider,
          !provider.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return "Models"
    }

    return provider
  }

  public var pickerTitle: String {
    guard providerDisplayName != "Models" else {
      return displayName
    }

    return "\(displayName) · \(providerDisplayName)"
  }

  public var subtitle: String? {
    provider
  }
}
