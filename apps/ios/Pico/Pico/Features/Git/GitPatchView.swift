import SwiftUI

struct GitPatchView: View {
  var patch: String
  var fallbackFileName: String?
  var maxHeight: CGFloat? = nil
  var scrollsVertically = true

  private var files: [GitPatchFile] {
    GitPatchFile.files(from: patch, fallbackFileName: fallbackFileName)
  }

  var body: some View {
    if files.isEmpty {
      GitInlineNote(title: "No diff available for this selection.")
    } else {
      VStack(alignment: .leading, spacing: 12) {
        ForEach(files) { file in
          VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
              GitFileIcon(path: file.fileName)
              Text(file.fileName)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
              Spacer(minLength: 0)
            }
            PierrePatchDiffView(
              patch: file.patch,
              fileName: file.fileName,
              maxHeight: maxHeight,
              scrollsVertically: scrollsVertically
            )
          }
        }
      }
    }
  }
}

struct GitPatchFile: Identifiable, Hashable, Sendable {
  var fileName: String
  var patch: String

  var id: String { fileName + "\u{0}" + String(patch.hashValue) }

  static func files(from patch: String, fallbackFileName: String?) -> [GitPatchFile] {
    let normalizedPatch = patch
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedPatch.isEmpty else { return [] }

    let lines = normalizedPatch.components(separatedBy: "\n")
    var groups: [[String]] = []
    var current: [String] = []

    for line in lines {
      if line.hasPrefix("diff --git "), !current.isEmpty {
        groups.append(current)
        current = [line]
      } else {
        current.append(line)
      }
    }
    if !current.isEmpty {
      groups.append(current)
    }

    if groups.count == 1, !groups[0].contains(where: { $0.hasPrefix("diff --git ") }) {
      return [
        GitPatchFile(
          fileName: fallbackFileName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? fallbackFileName! : "changes.diff",
          patch: groups[0].joined(separator: "\n")
        ),
      ]
    }

    return groups.map { group in
      let fileName = fileName(from: group) ?? fallbackFileName ?? "changes.diff"
      return GitPatchFile(fileName: fileName, patch: group.joined(separator: "\n"))
    }
  }

  private static func fileName(from lines: [String]) -> String? {
    for line in lines {
      if line.hasPrefix("+++ ") {
        let path = normalizedPatchPath(String(line.dropFirst(4)))
        if !path.isEmpty { return path }
      }
      if line.hasPrefix("diff --git ") {
        let parts = line.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if parts.count >= 4 {
          let path = normalizedPatchPath(parts[3])
          if !path.isEmpty { return path }
        }
      }
    }
    return nil
  }

  private static func normalizedPatchPath(_ value: String) -> String {
    let path = value
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .split(whereSeparator: { $0.isWhitespace })
      .first
      .map(String.init) ?? ""

    guard path != "/dev/null" else { return "" }
    if path.hasPrefix("a/") || path.hasPrefix("b/") {
      return String(path.dropFirst(2))
    }
    return path
  }
}
