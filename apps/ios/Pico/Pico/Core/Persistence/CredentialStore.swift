import Foundation

public actor CredentialStore {
  public init() {}

  public func bearerToken(for serverURL: URL) async -> String? {
    nil
  }

  public func saveBearerToken(_ token: String, for serverURL: URL) async throws {
    _ = token
    _ = serverURL
  }

  public func deleteBearerToken(for serverURL: URL) async throws {
    _ = serverURL
  }
}
