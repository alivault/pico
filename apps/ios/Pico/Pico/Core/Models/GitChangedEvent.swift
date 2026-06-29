import Foundation

public struct GitChangedEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var cwd: String
  public var repositoryRoot: String?
  public var changedAt: Double
  public var scopes: [String]?
}
