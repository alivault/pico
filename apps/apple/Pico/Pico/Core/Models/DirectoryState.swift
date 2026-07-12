import Foundation

public struct DirectoryState: Codable, Hashable, Identifiable, Sendable {
  public var id: String { path }

  public var path: String
  public var totalCount: Int
  public var revision: String
}
