import Foundation

public struct DirectorySessionsIndexesResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var directories: [String]
  public var directoryIndexes: [String: DirectorySessionsIndexSnapshot]
}

public struct DeleteOldDirectorySessionsRequest: Encodable, Hashable, Sendable {
  public var directory: String
  public var olderThanMs: Int
  public var dryRun: Bool?

  public init(directory: String, olderThanMs: Int, dryRun: Bool? = nil) {
    self.directory = directory
    self.olderThanMs = olderThanMs
    self.dryRun = dryRun
  }
}

public struct DeleteOldDirectorySessionsResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var directory: String
  public var cutoff: String
  public var dryRun: Bool
  public var deletedSessionIds: [String]
  public var matchingSessions: [SessionListEntry]
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
