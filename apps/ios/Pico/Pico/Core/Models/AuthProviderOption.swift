import Foundation

public struct AuthProviderOption: Decodable, Hashable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var authType: AuthProviderKind
  public var configured: Bool
  public var source: String?
  public var label: String?

  public var statusLabel: String {
    if let label, !label.isEmpty {
      return label
    }
    if let source, !source.isEmpty {
      return source
    }
    return configured ? "Configured" : "Not configured"
  }
}
