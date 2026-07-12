import Foundation

public struct SessionsEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var activeSessionPath: String?
  public var activeSessionId: String?
  public var activeSessionKey: String?
  public var directories: [String]?
  public var directoryStates: [DirectoryState]?
  public var directoryIndexes: [String: DirectorySessionsIndexSnapshot]?

  public var snapshots: [DirectorySessionsIndexSnapshot] {
    guard let directoryIndexes else { return [] }

    return Array(directoryIndexes.values).sorted { left, right in
      left.directory.localizedStandardCompare(right.directory) == .orderedAscending
    }
  }
}
