import Foundation

public struct AuthMutationResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var provider: String
  public var availableModels: [ModelOption]
}
