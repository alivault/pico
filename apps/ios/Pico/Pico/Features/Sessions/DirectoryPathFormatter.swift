import Foundation

/// Mirrors Pico web's compact project path labels for remote desktop paths.
enum DirectoryPathFormatter {
  static let homePrefix = "~/"

  static func displayPath(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedValue.isEmpty else { return value }

    let displayPath = trimmedValue
      .replacingOccurrences(
        of: #"^/Users/[^/]+(?=/|$)"#,
        with: "~",
        options: .regularExpression
      )
      .replacingOccurrences(
        of: #"^/home/[^/]+(?=/|$)"#,
        with: "~",
        options: .regularExpression
      )

    return displayPath == "~" ? "~/" : displayPath
  }

  static func folderName(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedValue.isEmpty else { return value }

    let path = trimmedValue.trimmingCharacters(
      in: CharacterSet(charactersIn: "/\\")
    )
    guard !path.isEmpty else { return trimmedValue }
    if path == "~" { return "Home" }

    return path
      .components(separatedBy: CharacterSet(charactersIn: "/\\"))
      .filter { !$0.isEmpty }
      .last ?? path
  }

  static func matches(_ directory: String, query: String) -> Bool {
    let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedQuery.isEmpty else { return true }

    let lowercasedQuery = trimmedQuery.lowercased()
    let displayPath = displayPath(directory)
    return directory.lowercased().contains(lowercasedQuery) ||
      displayPath.lowercased().contains(lowercasedQuery) ||
      normalizedSearchText(directory).contains(normalizedSearchText(trimmedQuery)) ||
      normalizedSearchText(displayPath).contains(normalizedSearchText(trimmedQuery))
  }

  static func looksLikePath(_ value: String) -> Bool {
    let input = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return input.hasPrefix("~") ||
      input.hasPrefix(".") ||
      input.hasPrefix("/") ||
      input.contains("/") ||
      input.contains("\\")
  }

  static func normalizedDirectoryPrefix(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedValue.isEmpty else { return homePrefix }
    return trimmedValue.hasSuffix("/") ? trimmedValue : "\(trimmedValue)/"
  }

  static func parentDirectoryPrefix(_ value: String) -> String? {
    let normalizedValue = normalizedDirectoryPrefix(value)
    let directoryWithoutTrailingSlash = String(normalizedValue.dropLast())
    guard !directoryWithoutTrailingSlash.isEmpty,
          directoryWithoutTrailingSlash != "~" else {
      return nil
    }

    let parent = (directoryWithoutTrailingSlash as NSString).deletingLastPathComponent
    if parent == "~" { return homePrefix }
    if parent.isEmpty { return nil }
    return normalizedDirectoryPrefix(parent)
  }

  static func isHidden(_ value: String) -> Bool {
    let path = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty else { return false }

    let pathWithoutTrailingSlash = path.trimmingCharacters(
      in: CharacterSet(charactersIn: "/")
    )
    let name = (pathWithoutTrailingSlash as NSString).lastPathComponent
    return name.hasPrefix(".")
  }

  private static func normalizedSearchText(_ value: String) -> String {
    value
      .lowercased()
      .components(separatedBy: CharacterSet.alphanumerics.inverted)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
  }
}
