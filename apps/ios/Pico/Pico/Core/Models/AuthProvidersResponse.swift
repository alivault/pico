import Foundation

public struct AuthProvidersResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var oauthProviders: [AuthProviderOption]
  public var apiKeyProviders: [AuthProviderOption]
  public var loggedInProviders: [AuthProviderOption]
  public var availableModels: [ModelOption]
}
