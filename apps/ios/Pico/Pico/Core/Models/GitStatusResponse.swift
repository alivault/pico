import Foundation

public struct GitStatusResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var gitStatus: GitStatusSummary?
}

public struct GitStatusSummary: Decodable, Hashable, Sendable {
  public var branch: String?
  public var detached: Bool
  public var revision: String?
  public var dirty: Bool
  public var changedFileCount: Int
  public var ahead: Int
  public var behind: Int
  public var inline: String
  public var label: String
  public var title: String
}

public struct GitChangesResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var localBranches: [GitLocalBranch]?
  public var remoteBranches: [GitRemoteBranch]?
}

public struct GitLocalBranch: Decodable, Identifiable, Hashable, Sendable {
  public var name: String
  public var current: Bool
  public var upstream: String?
  public var ahead: Int
  public var behind: Int
  public var upstreamGone: Bool
  public var hash: String?
  public var subject: String?
  public var relativeDate: String?
  public var committerDate: String?

  public var id: String { name }
}

public struct GitRemoteBranch: Decodable, Identifiable, Hashable, Sendable {
  public var name: String
  public var hash: String?
  public var subject: String?
  public var relativeDate: String?
  public var committerDate: String?

  public var id: String { name }
}

public struct GitActionResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var stdout: String
  public var stderr: String
}
