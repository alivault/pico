import Foundation

public struct DirectoryResolveResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var path: String
}
