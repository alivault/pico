import Foundation

struct ToolEditDiffStatCounts: Equatable, Sendable {
  var additions: Int
  var removals: Int
}

struct ToolWritePayload: Equatable, Sendable {
  var path: String
  var content: String?
}

enum ToolFormatting {
  private static let exploreToolNames: Set<String> = [
    "read",
    "grep",
    "glob",
    "find",
    "ls",
    "list",
    "rg",
  ]

  private static let exploreShellCommandNames: Set<String> = [
    "find",
    "grep",
    "ls",
    "rg",
  ]

  private static let skippableShellCommandNames: Set<String> = [
    "cd",
    "export",
    "pwd",
    "set",
  ]

  private static let shellCommandWrapperNames: Set<String> = [
    "command",
    "env",
    "noglob",
    "sudo",
    "time",
  ]

  private static let codeLanguageByExtension: [String: String] = [
    "bash": "bash",
    "c": "c",
    "cc": "c",
    "cjs": "javascript",
    "cpp": "c",
    "css": "css",
    "cxx": "c",
    "go": "go",
    "h": "c",
    "htm": "html",
    "html": "html",
    "java": "java",
    "js": "javascript",
    "json": "json",
    "jsonc": "jsonc",
    "jsx": "jsx",
    "mjs": "javascript",
    "md": "markdown",
    "mdx": "mdx",
    "py": "python",
    "rs": "rust",
    "sh": "bash",
    "swift": "swift",
    "ts": "typescript",
    "tsx": "tsx",
    "txt": "plaintext",
    "xml": "xml",
    "yaml": "yaml",
    "yml": "yaml",
    "zsh": "bash",
  ]

  private static let codeLanguageByFilename: [String: String] = [
    "dockerfile": "dockerfile",
    "makefile": "makefile",
  ]

  static func displayName(for name: String?) -> String {
    switch name {
    case "bash":
      "Bash"
    case "read":
      "Read"
    case "write":
      "Write"
    case "edit":
      "Edit"
    case "grep":
      "Grep"
    case "glob":
      "Glob"
    case "find":
      "Find"
    case "rg":
      "Ripgrep"
    case "ls", "list":
      "List"
    case .some(let value) where !value.isEmpty:
      value
    default:
      "Tool"
    }
  }

  static func summary(for block: ToolBlock) -> String {
    let preview: String

    switch block.name {
    case "read":
      preview = readLocation(for: block)
    case "write":
      preview = writeSummary(for: block)
    case "bash":
      preview = rawShellCommandText(name: block.name, args: block.args)
    default:
      preview = commandPreview(for: block)
    }

    if let collapsedPreview = collapsed(preview) {
      return collapsedPreview
    }

    if block.running {
      return "Running"
    }

    if block.isError {
      return "Failed"
    }

    return "Done"
  }

  static func callText(for block: ToolBlock) -> String {
    if block.name == "bash" {
      let command = rawShellCommandText(name: block.name, args: block.args)
      return command.isEmpty ? "" : "$ \(command)"
    }

    guard let args = block.args else { return "" }

    if case .string(let value) = args {
      return formattedArgumentString(value)
    }

    return args.prettyJSONDescription ?? args.description
  }

  static func outputText(for block: ToolBlock) -> String {
    var parts: [String] = []
    let diff = patchText(for: block)
    let output = block.output.trimmingTrailingNewlines()

    if !diff.isEmpty {
      parts.append(diff)
    }

    if !output.isEmpty, output != diff {
      parts.append(output)
    }

    if !parts.isEmpty {
      return parts.joined(separator: "\n\n")
    }

    if block.running {
      return "Running…"
    }

    if block.isError {
      return "Tool failed with no output."
    }

    return "No output available."
  }

  static func patchText(for block: ToolBlock) -> String {
    guard block.name == "edit" else { return "" }
    guard let details = normalizedObject(from: block.details) else { return "" }

    for key in ["patch", "diff"] {
      if let value = text(details[key])?.trimmingTrailingNewlines(), !value.isEmpty {
        return value
      }
    }

    return ""
  }

  static func writePayload(for block: ToolBlock) -> ToolWritePayload? {
    guard block.name == "write" else { return nil }
    guard let args = normalizedObject(from: block.args) else { return nil }

    let path = firstText(in: args, keys: ["path", "filePath", "file_path"])
    let content = text(args["content"])

    return ToolWritePayload(path: path, content: content)
  }

  static func editOutputWithoutSuccessMessage(_ output: String) -> String {
    output
      .components(separatedBy: "\n")
      .filter { line in
        !matches(
          line,
          pattern: #"^Successfully replaced \d+ block\(s\) in .+\.$"#
        )
      }
      .joined(separator: "\n")
      .trimmingTrailingNewlines()
  }

  static func writeOutputWithoutSuccessMessage(_ output: String) -> String {
    output
      .components(separatedBy: "\n")
      .filter { line in
        !matches(line, pattern: #"^Successfully wrote \d+ bytes to .+$"#)
      }
      .joined(separator: "\n")
      .trimmingTrailingNewlines()
  }

  static func editDiffStats(for patch: String) -> ToolEditDiffStatCounts {
    var stats = ToolEditDiffStatCounts(additions: 0, removals: 0)

    guard !patch.isEmpty else { return stats }

    for line in patch.components(separatedBy: "\n") {
      if line.hasPrefix("+++") || line.hasPrefix("---") {
        continue
      }

      if line.hasPrefix("+") {
        stats.additions += 1
      }

      if line.hasPrefix("-") {
        stats.removals += 1
      }
    }

    return stats
  }

  static func codeLanguage(fromPath filePath: String) -> String? {
    let fileName = filePath
      .replacingOccurrences(of: "\\", with: "/")
      .components(separatedBy: "/")
      .last?
      .lowercased()
      .trimmingCharacters(in: .whitespacesAndNewlines)

    guard let fileName, !fileName.isEmpty else { return nil }

    if let language = codeLanguageByFilename[fileName] {
      return language
    }

    if fileName.hasSuffix(".d.ts") {
      return "typescript"
    }

    guard let extensionName = fileName.components(separatedBy: ".").last,
          extensionName != fileName else {
      return nil
    }

    return codeLanguageByExtension[extensionName]
  }

  static func isPendingUnclassifiedToolBlock(_ block: ToolBlock) -> Bool {
    guard block.running else { return false }
    guard !matchesExploreToolBlock(block) else { return false }

    guard let name = block.name, !name.isEmpty else {
      return true
    }

    guard name == "bash" else { return false }

    let category = toolCategoryFromTool(name: name, args: block.args)
    return rawShellCommandText(name: name, args: block.args).isEmpty ||
      (category != "explore" &&
        (toolArgsAreIncompleteJSONObject(block.args) ||
          toolCouldBecomeExploreFromTool(name: name, args: block.args)))
  }

  static func toolArgsAreIncompleteJSONObject(_ args: JSONValue?) -> Bool {
    guard case .string(let value) = args else { return false }

    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard looksLikeJSONObjectPrefix(trimmedValue) else { return false }

    return parseJSONValue(trimmedValue) == nil
  }

  static func rawShellCommandText(name: String?, args: JSONValue?) -> String {
    guard name == "bash" else { return "" }

    if case .string(let value) = args {
      let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedValue.isEmpty else { return "" }

      if let parsed = parseJSONValue(trimmedValue) {
        if let object = parsed.objectValue, let command = text(object["command"]) {
          return command
        }

        return trimmedValue
      }

      if toolArgsAreIncompleteJSONObject(args) {
        return partialJSONStringProperty(trimmedValue, property: "command")
      }

      return trimmedValue
    }

    return text(normalizedObject(from: args)?["command"]) ?? ""
  }

  static func toolCouldBecomeExploreFromTool(name: String?, args: JSONValue?) -> Bool {
    if let name, exploreToolNames.contains(name) {
      return true
    }

    guard name == "bash" else { return false }

    let command = rawShellCommandText(name: name, args: args)
    for segment in shellCommandSegments(command) {
      let commandName = shellCommandName(from: segment)
      if commandName.isEmpty || skippableShellCommandNames.contains(commandName) {
        continue
      }

      return pendingExploreShellCommandPrefixes.contains { prefix in
        prefix.hasPrefix(commandName)
      }
    }

    return false
  }

  static func exploreShellCommandNameFromTool(name: String?, args: JSONValue?) -> String {
    guard name == "bash" else { return "" }

    let command = rawShellCommandText(name: name, args: args)
    for segment in shellCommandSegments(command) {
      let commandName = shellCommandName(from: segment)
      if commandName.isEmpty ||
        skippableShellCommandNames.contains(commandName) ||
        shellCommandWrapperNames.contains(commandName) {
        continue
      }

      return exploreShellCommandNames.contains(commandName) ? commandName : ""
    }

    return ""
  }

  static func toolCategoryFromTool(name: String?, args: JSONValue?) -> String? {
    if let name, exploreToolNames.contains(name) {
      return "explore"
    }

    return exploreShellCommandNameFromTool(name: name, args: args).isEmpty
      ? nil
      : "explore"
  }

  static func scrollSignature(for block: ToolBlock) -> String {
    [
      "tool",
      block.id,
      block.name ?? "",
      block.category ?? "",
      block.running ? "running" : "done",
      block.isError ? "error" : "ok",
      "out:\(block.output.count):\(stableHash(block.output))",
      "args:\(jsonSignature(block.args))",
      "details:\(jsonSignature(block.details))",
    ].joined(separator: ":")
  }

  static func collapsibleStateKey(for block: ToolBlock) -> String {
    if let callId = block.callId, !callId.isEmpty {
      return "tool:call:\(callId)"
    }

    if let renderKey = block.renderKey, !renderKey.isEmpty {
      return "tool:render:\(renderKey)"
    }

    if let blockKey = block.blockKey, !blockKey.isEmpty {
      return "tool:block:\(blockKey)"
    }

    return "tool:fallback:\(block.id)"
  }

  private static var pendingExploreShellCommandPrefixes: [String] {
    Array(exploreShellCommandNames).sorted() + Array(shellCommandWrapperNames).sorted()
  }

  private static func matchesExploreToolBlock(_ block: ToolBlock) -> Bool {
    block.category == "explore" ||
      toolCategoryFromTool(name: block.name, args: block.args) == "explore"
  }

  private static func commandPreview(for block: ToolBlock) -> String {
    if case .string(let value) = block.args {
      return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    let args = normalizedObject(from: block.args)
    return firstText(
      in: args,
      keys: ["description", "command", "path", "filePath", "file_path"]
    )
  }

  private static func readLocation(for block: ToolBlock) -> String {
    let args = normalizedObject(from: block.args)
    let filePath = firstText(in: args, keys: ["path", "filePath", "file_path"])
    let offset = number(args?["offset"])
    let limit = number(args?["limit"])

    if let offset, let limit, limit > 0 {
      let location = "\(offset)-\(offset + limit - 1)"
      return filePath.isEmpty ? location : "\(filePath):\(location)"
    }

    if let offset {
      return filePath.isEmpty ? "\(offset)" : "\(filePath):\(offset)"
    }

    if let limit, limit > 0 {
      return collapsed([filePath, "limit=\(limit)"].joined(separator: " ")) ?? ""
    }

    return filePath
  }

  private static func writeSummary(for block: ToolBlock) -> String {
    guard let payload = writePayload(for: block), !payload.path.isEmpty else {
      return ""
    }

    guard let content = payload.content else {
      return payload.path
    }

    return "\(payload.path) · \(lineCountLabel(for: content))"
  }

  private static func lineCountLabel(for text: String) -> String {
    let count: Int
    if text.isEmpty {
      count = 0
    } else {
      count = text.components(separatedBy: "\n").count
    }

    return "\(count) \(count == 1 ? "line" : "lines")"
  }

  private static func formattedArgumentString(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedValue.isEmpty else { return "" }

    if let parsed = parseJSONValue(trimmedValue),
       parsed.objectValue != nil || parsed.arrayValue != nil {
      return parsed.prettyJSONDescription ?? trimmedValue
    }

    return trimmedValue
  }

  private static func normalizedObject(from value: JSONValue?) -> [String: JSONValue]? {
    if let object = value?.objectValue {
      return object
    }

    guard case .string(let text) = value else { return nil }
    return parseJSONValue(text.trimmingCharacters(in: .whitespacesAndNewlines))?.objectValue
  }

  private static func firstText(
    in args: [String: JSONValue]?,
    keys: [String]
  ) -> String {
    guard let args else { return "" }

    for key in keys {
      if let value = text(args[key]) {
        return value
      }
    }

    return ""
  }

  private static func text(_ value: JSONValue?) -> String? {
    guard let value else { return nil }

    switch value {
    case .string(let text):
      let trimmedValue = text.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmedValue.isEmpty ? nil : trimmedValue
    case .number(let number):
      guard number.isFinite else { return nil }
      return formattedNumber(number)
    case .bool(let bool):
      return bool ? "true" : "false"
    default:
      return nil
    }
  }

  private static func number(_ value: JSONValue?) -> Int? {
    guard let number = value?.numberValue, number.isFinite else { return nil }
    return Int(number)
  }

  private static func collapsed(_ value: String) -> String? {
    let collapsedValue = value
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    return collapsedValue.isEmpty ? nil : collapsedValue
  }

  private static func formattedNumber(_ number: Double) -> String {
    if number.rounded(.towardZero) == number {
      return String(Int(number))
    }

    return String(number)
  }

  private static func parseJSONValue(_ text: String) -> JSONValue? {
    guard !text.isEmpty, let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(JSONValue.self, from: data)
  }

  private static func looksLikeJSONObjectPrefix(_ text: String) -> Bool {
    guard text.first == "{" else { return false }

    let afterBrace = text.dropFirst().drop { $0.isWhitespace }
    return text == "{" || afterBrace.first == "\"" || afterBrace.isEmpty
  }

  private static func partialJSONStringProperty(_ text: String, property: String) -> String {
    let pattern = "\\\"\(NSRegularExpression.escapedPattern(for: property))\\\"\\s*:\\s*\\\""
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return "" }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range),
          let matchRange = Range(match.range, in: text) else {
      return ""
    }

    return readPartialJSONStringValue(text, from: matchRange.upperBound)
  }

  private static func readPartialJSONStringValue(
    _ text: String,
    from startIndex: String.Index
  ) -> String {
    var value = ""
    var index = startIndex
    var escaped = false

    while index < text.endIndex {
      let character = text[index]

      if escaped {
        switch character {
        case "\"", "\\", "/":
          value.append(character)
        case "b":
          value.append("\u{0008}")
        case "f":
          value.append("\u{000C}")
        case "n":
          value.append("\n")
        case "r":
          value.append("\r")
        case "t":
          value.append("\t")
        case "u":
          let hexStart = text.index(after: index)
          if let hexEnd = text.index(hexStart, offsetBy: 4, limitedBy: text.endIndex) {
            let hex = String(text[hexStart..<hexEnd])
            if let scalarValue = UInt32(hex, radix: 16),
               let scalar = UnicodeScalar(scalarValue) {
              value.append(Character(scalar))
              index = hexEnd
              escaped = false
              continue
            }
          }
          value.append(character)
        default:
          value.append(character)
        }

        escaped = false
        index = text.index(after: index)
        continue
      }

      if character == "\\" {
        escaped = true
        index = text.index(after: index)
        continue
      }

      if character == "\"" {
        break
      }

      value.append(character)
      index = text.index(after: index)
    }

    return value.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func shellCommandSegments(_ command: String) -> [String] {
    var segments: [String] = []
    var current = ""
    var index = command.startIndex

    while index < command.endIndex {
      let character = command[index]
      let nextIndex = command.index(after: index)
      let nextCharacter = nextIndex < command.endIndex ? command[nextIndex] : nil

      if character == ";" ||
        (character == "&" && nextCharacter == "&") ||
        (character == "|" && nextCharacter == "|") {
        segments.append(current)
        current = ""
        index = character == ";" ? nextIndex : command.index(after: nextIndex)
        continue
      }

      current.append(character)
      index = nextIndex
    }

    segments.append(current)
    return segments
  }

  private static func shellCommandName(from segment: String) -> String {
    var text = segment.trimmingCharacters(in: .whitespacesAndNewlines)

    while !text.isEmpty {
      if let assignment = leadingMatch(
        in: text,
        pattern: #"^(?:env\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*"#
      ) {
        text = String(text.dropFirst(assignment.count))
          .trimmingCharacters(in: .whitespacesAndNewlines)
        continue
      }

      guard let commandPath = leadingCapture(
        in: text,
        pattern: #"^([./A-Za-z0-9_-]+)\b"#
      ) else {
        return ""
      }

      let commandName = pathBaseName(commandPath)
      guard shellCommandWrapperNames.contains(commandName) else {
        return commandName
      }

      let remainingText = String(text.dropFirst(commandPath.count))
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard !remainingText.isEmpty else { return commandName }

      text = remainingText
    }

    return ""
  }

  private static func pathBaseName(_ path: String) -> String {
    let normalizedPath = path
      .replacingOccurrences(of: "\\", with: "/")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedPath.isEmpty else { return "" }

    return normalizedPath.components(separatedBy: "/").last ?? normalizedPath
  }

  private static func leadingMatch(in text: String, pattern: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range),
          match.range.location == 0,
          let matchRange = Range(match.range, in: text) else {
      return nil
    }

    return String(text[matchRange])
  }

  private static func leadingCapture(in text: String, pattern: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range),
          match.range.location == 0,
          match.numberOfRanges > 1,
          let captureRange = Range(match.range(at: 1), in: text) else {
      return nil
    }

    return String(text[captureRange])
  }

  private static func matches(_ text: String, pattern: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range) else { return false }
    return match.range.location == 0 && match.range.length == range.length
  }

  private static func jsonSignature(_ value: JSONValue?) -> String {
    guard let value else { return "nil" }
    let json = value.compactJSONDescription ?? value.description
    return "\(json.count):\(stableHash(json))"
  }

  private static func stableHash(_ value: String) -> String {
    var hash: UInt64 = 14_695_981_039_346_656_037

    for byte in value.utf8 {
      hash ^= UInt64(byte)
      hash &*= 1_099_511_628_211
    }

    return String(hash, radix: 16)
  }
}

private extension String {
  func trimmingTrailingNewlines() -> String {
    var value = self
    while value.last == "\n" || value.last == "\r" {
      value.removeLast()
    }
    return value
  }
}
