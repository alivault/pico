import Foundation

public struct DirectorySessionsIndexesResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var directories: [String]
  public var directoryIndexes: [String: DirectorySessionsIndexSnapshot]
}

public struct DirectorySessionsIndexSnapshot: Codable, Hashable, Identifiable, Sendable {
  public var id: String { directory }

  public var directory: String
  public var totalCount: Int
  public var revision: String
  public var sessions: [SessionListEntry]

  public init(
    directory: String,
    totalCount: Int,
    revision: String,
    sessions: [SessionListEntry]
  ) {
    self.directory = directory
    self.totalCount = totalCount
    self.revision = revision
    self.sessions = sessions
  }
}
