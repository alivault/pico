import Foundation

public enum AuthProviderKind: String, Codable, Hashable, Sendable {
  case oauth
  case apiKey = "api_key"
}
