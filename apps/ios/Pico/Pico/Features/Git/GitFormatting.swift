import Foundation
import SwiftUI

struct GitCommitGraphEntry: Identifiable, Hashable, Sendable {
  var graph: String
  var hash: String
  var fullHash: String
  var parents: [String]
  var author: String
  var relativeDate: String
  var fullDate: String
  var stats: String
  var subject: String

  var id: String { fullHash.isEmpty ? hash : fullHash }
  var displayHash: String { hash.isEmpty ? String(fullHash.prefix(8)) : hash }
}

enum GitFormatting {
  static let commitPageSize = 50
  private static let commitFieldSeparator = "\u{1f}"

  static func folderName(_ path: String) -> String {
    let parts = path.split(separator: "/").map(String.init)
    return parts.last ?? path
  }

  static func baseName(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? path
  }

  static func parentPath(_ path: String) -> String {
    var parts = path.split(separator: "/").map(String.init)
    guard parts.count > 1 else { return "" }
    parts.removeLast()
    return parts.joined(separator: "/")
  }

  static func abbreviatedParentPath(_ path: String) -> String {
    let parts = path.split(separator: "/").map(String.init)
    guard parts.count > 1 else { return path }

    let parentInitials = parts.dropLast().map { folder in
      folder.first.map(String.init) ?? ""
    }
    return (parentInitials + [parts.last ?? path]).joined(separator: "/")
  }

  static func statusCharacters(_ status: String?) -> (index: Character, worktree: Character) {
    let padded = String((status ?? "").prefix(2)).padding(toLength: 2, withPad: " ", startingAt: 0)
    let characters = Array(padded)
    return (characters.indices.contains(0) ? characters[0] : " ", characters.indices.contains(1) ? characters[1] : " ")
  }

  static func canStage(_ file: GitChangeFile) -> Bool {
    let characters = statusCharacters(file.status)
    return characters.worktree != " " || characters.index == "?"
  }

  static func canUnstage(_ file: GitChangeFile) -> Bool {
    let characters = statusCharacters(file.status)
    return characters.index != " " && characters.index != "?"
  }

  static func statusColor(_ character: Character, column: GitStatusColumn) -> Color {
    if character == " " { return .secondary }
    if character == "?" { return Color(uiColor: .systemBlue) }
    if character == "U" || character == "!" { return Color(uiColor: .systemRed) }
    return column == .index ? Color(uiColor: .systemGreen) : Color(uiColor: .systemOrange)
  }

  static func statusLabel(_ status: String?) -> String {
    let characters = statusCharacters(status)
    return "\(characters.index)\(characters.worktree)"
  }

  static func statusDescription(_ status: String?) -> String {
    let label = statusLabel(status).trimmingCharacters(in: .whitespaces)
    if label.isEmpty { return "Unchanged" }

    switch label {
    case "M":
      return "Modified"
    case "A":
      return "Added"
    case "D":
      return "Deleted"
    case "R":
      return "Renamed"
    case "C":
      return "Copied"
    case "??":
      return "Untracked"
    case "UU", "AA", "DD", "AU", "UA", "DU", "UD":
      return "Conflict"
    default:
      return label
    }
  }

  static func lineSummary(added: Int?, deleted: Int?) -> String {
    let additions = max(0, added ?? 0)
    let deletions = max(0, deleted ?? 0)
    guard additions > 0 || deletions > 0 else { return "" }
    return "+\(additions) -\(deletions)"
  }

  static func filesLineSummary(_ files: [GitChangeFile]) -> String {
    let additions = files.reduce(0) { $0 + max(0, $1.linesAdded ?? 0) }
    let deletions = files.reduce(0) { $0 + max(0, $1.linesDeleted ?? 0) }
    guard additions > 0 || deletions > 0 else { return "" }
    return "+\(additions) -\(deletions)"
  }

  static func branchText(_ status: GitStatusSummary?) -> String {
    guard let status else { return "" }
    if status.detached {
      return status.revision.map { "detached \($0)" } ?? "detached"
    }
    return status.branch ?? status.label
  }

  static func workingTreeSummary(_ status: GitStatusSummary?) -> String {
    guard let status else { return "No git repository detected" }
    let count = status.changedFileCount > 0 ? status.changedFileCount : status.dirty ? 1 : 0
    if count == 0 { return "Working tree clean" }
    return "\(count) file\(count == 1 ? "" : "s") changed"
  }

  static func diverged(_ status: GitStatusSummary?) -> Bool {
    guard let status else { return false }
    return !status.detached && status.ahead > 0 && status.behind > 0
  }

  static func localBranchTrackText(_ branch: GitLocalBranch) -> String {
    guard branch.upstream?.isEmpty == false else { return "" }
    if branch.upstreamGone { return "gone" }
    if branch.ahead > 0 && branch.behind > 0 { return "↓\(branch.behind) ↑\(branch.ahead)" }
    if branch.behind > 0 { return "↓\(branch.behind)" }
    if branch.ahead > 0 { return "↑\(branch.ahead)" }
    return "synced"
  }

  static func localBranchMenuTitle(_ branch: GitLocalBranch) -> String {
    let detail = localBranchMenuDetail(branch)
    return detail.isEmpty ? branch.name : "\(branch.name) · \(detail)"
  }

  static func localBranchMenuDetail(_ branch: GitLocalBranch) -> String {
    if let tracking = localBranchTrackingDescription(branch), !tracking.isEmpty {
      return tracking
    }

    return branch.subject?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  static func localBranchTrackingDescription(_ branch: GitLocalBranch) -> String? {
    guard let upstream = branch.upstream?.trimmingCharacters(in: .whitespacesAndNewlines), !upstream.isEmpty else {
      return nil
    }

    if branch.upstreamGone { return "gone" }
    if branch.ahead > 0, branch.behind > 0 {
      return "ahead \(branch.ahead), behind \(branch.behind)"
    }
    if branch.ahead > 0 { return "ahead \(branch.ahead)" }
    if branch.behind > 0 { return "behind \(branch.behind)" }
    return "synced"
  }

  static func remoteBranchParts(_ name: String) -> (remote: String, branch: String) {
    let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let slashIndex = value.firstIndex(of: "/"), slashIndex > value.startIndex else {
      return ("", value)
    }
    return (
      String(value[..<slashIndex]),
      String(value[value.index(after: slashIndex)...])
    )
  }

  static func compactRelativeDate(_ value: String?) -> String {
    let text = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !text.isEmpty else { return "" }
    if text == "now" { return "now" }

    let units: [(String, String)] = [
      ("second", "s"),
      ("minute", "m"),
      ("hour", "h"),
      ("day", "d"),
      ("week", "w"),
      ("month", "mo"),
      ("year", "y"),
    ]
    let pieces = text.split(separator: " ").map(String.init)
    guard let amount = pieces.first(where: { Int($0) != nil }) else {
      return text.replacingOccurrences(of: " ago", with: "")
    }
    guard let unit = pieces.first(where: { piece in
      units.contains { unit, _ in piece.hasPrefix(unit) }
    }) else {
      return text.replacingOccurrences(of: " ago", with: "")
    }
    let suffix = units.first { unit.hasPrefix($0.0) }?.1 ?? ""
    return "\(amount)\(suffix)"
  }

  static func commitDetailTime(_ value: String) -> String {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return "" }
    let compact = compactRelativeDate(text)
    if compact.isEmpty || compact == "now" || !text.localizedCaseInsensitiveContains("ago") {
      return compact
    }
    return "\(compact) ago"
  }

  static func fullDate(_ value: String) -> String {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return "" }

    let formatter = ISO8601DateFormatter()
    if let date = formatter.date(from: text) {
      return date.formatted(date: .abbreviated, time: .shortened)
    }
    return text
  }

  static func commitStatCount(_ stats: String, kind: GitCommitStatKind) -> Int {
    let pattern = kind == .insertions ? #"(\d+) insertions?\(\+\)"# : #"(\d+) deletions?\(-\)"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return 0 }
    let range = NSRange(stats.startIndex..<stats.endIndex, in: stats)
    guard let match = regex.firstMatch(in: stats, range: range),
          let valueRange = Range(match.range(at: 1), in: stats) else {
      return 0
    }
    return Int(stats[valueRange]) ?? 0
  }

  static func parseCommitGraphLine(_ line: String) -> GitCommitGraphEntry {
    guard let tabIndex = line.firstIndex(of: "\t") else {
      return GitCommitGraphEntry(
        graph: line,
        hash: "",
        fullHash: "",
        parents: [],
        author: "",
        relativeDate: "",
        fullDate: "",
        stats: "",
        subject: ""
      )
    }

    let lead = String(line[..<tabIndex])
    let metadata = String(line[line.index(after: tabIndex)...])
    let hashMatch = splitGraphAndHash(lead)
    let fields = metadata.components(separatedBy: commitFieldSeparator)

    if fields.count >= 5 {
      let fullHash = fields[safe: 0] ?? ""
      let parentsText = fields[safe: 1] ?? ""
      let author = fields[safe: 2] ?? ""
      let relativeDate = fields[safe: 3] ?? ""
      let maybeFullDate = fields[safe: 4] ?? ""
      let hasFullDate = maybeFullDate.range(of: #"^\d{4}-\d{2}-\d{2}T"#, options: .regularExpression) != nil
      let fullDate = hasFullDate ? maybeFullDate : ""
      let rest = Array(fields.dropFirst(hasFullDate ? 5 : 4))
      let subjectAndStats = hasFullDate ? rest : [maybeFullDate] + rest
      let stats = subjectAndStats.count > 1 ? subjectAndStats.last ?? "" : ""
      let subjectParts = stats.isEmpty ? subjectAndStats : Array(subjectAndStats.dropLast())
      return GitCommitGraphEntry(
        graph: hashMatch.graph,
        hash: hashMatch.hash,
        fullHash: fullHash,
        parents: parentsText.split(whereSeparator: { $0.isWhitespace }).map(String.init),
        author: author,
        relativeDate: relativeDate,
        fullDate: fullDate,
        stats: stats,
        subject: subjectParts.joined(separator: commitFieldSeparator).trimmingCharacters(in: .whitespacesAndNewlines)
      )
    }

    let subjectParts = metadata.components(separatedBy: "\t")
    let maybeFullHash = subjectParts.first ?? ""
    let hasFullHash = !hashMatch.hash.isEmpty && subjectParts.count > 1 && maybeFullHash.range(of: #"^[0-9a-f]{40}$"#, options: .regularExpression) != nil
    let renderedSubjectParts = hasFullHash ? Array(subjectParts.dropFirst()) : subjectParts
    return GitCommitGraphEntry(
      graph: hashMatch.graph,
      hash: hashMatch.hash,
      fullHash: hasFullHash ? maybeFullHash : hashMatch.hash,
      parents: [],
      author: "",
      relativeDate: "",
      fullDate: "",
      stats: "",
      subject: renderedSubjectParts.joined(separator: "\t").trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  private static func splitGraphAndHash(_ lead: String) -> (graph: String, hash: String) {
    guard let regex = try? NSRegularExpression(pattern: #"^(.*?)([0-9a-f]{5,40})$"#, options: [.caseInsensitive]) else {
      return (lead, "")
    }
    let range = NSRange(lead.startIndex..<lead.endIndex, in: lead)
    guard let match = regex.firstMatch(in: lead, range: range),
          let graphRange = Range(match.range(at: 1), in: lead),
          let hashRange = Range(match.range(at: 2), in: lead) else {
      return (lead, "")
    }
    return (String(lead[graphRange]), String(lead[hashRange]))
  }
}

enum GitStatusColumn {
  case index
  case worktree
}

enum GitCommitStatKind {
  case insertions
  case deletions
}

private extension Array {
  subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
