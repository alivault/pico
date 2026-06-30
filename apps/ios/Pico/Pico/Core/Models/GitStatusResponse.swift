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
  public var files: [GitChangeFile]?
  public var localBranches: [GitLocalBranch]?
  public var remoteBranches: [GitRemoteBranch]?
  public var commits: [String]?
  public var commitsHasMore: Bool?
  public var commitsLimit: Int?
  public var unpushedCommitHashes: [String]?
}

public struct GitChangeFile: Decodable, Identifiable, Hashable, Sendable {
  public var status: String
  public var path: String
  public var previousPath: String?
  public var linesAdded: Int?
  public var linesDeleted: Int?
  public var sizeBytes: Int?

  public var id: String {
    [status, previousPath ?? "", path].joined(separator: "\u{0}")
  }
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
  public var pushedCommitMessages: [String]?
}

public struct GitFileDiffResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var path: String
  public var patch: String
}

public struct GitFileReviewResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var path: String
  public var previousPath: String?
  public var oldContent: String
  public var newContent: String
}

public enum GitCommitDiffMode: String, Codable, CaseIterable, Hashable, Sendable {
  case commit
  case head
  case previous
}

public struct GitCommitDiffResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var commit: String
  public var mode: GitCommitDiffMode
  public var title: String
  public var path: String?
  public var previousPath: String?
  public var patch: String
}

public struct GitCommitFile: Decodable, Identifiable, Hashable, Sendable {
  public var status: String
  public var path: String
  public var previousPath: String?
  public var linesAdded: Int?
  public var linesDeleted: Int?

  public var id: String {
    [status, previousPath ?? "", path].joined(separator: "\u{0}")
  }
}

public struct GitCommitFilesResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var commit: String
  public var files: [GitCommitFile]
}

public struct GitCommitRemoteUrlResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var commit: String
  public var remoteUrl: String
}

public struct GitCommitMessageResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var message: String
  public var source: GitCommitMessageSource
  public var reason: String?
}

public enum GitCommitMessageSource: String, Decodable, Hashable, Sendable {
  case ai
  case heuristic
}

public struct ProjectFileTreeResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var totalCount: Int
  public var paths: [String]
}

public struct ProjectFileReadResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cwd: String
  public var path: String
  public var content: String
}
