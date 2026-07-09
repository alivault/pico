import SwiftUI
import UIKit

struct MarkdownTextView: View {
  var text: String
  var isError = false
  var fillsWidth = true

  private var blocks: [MarkdownBlock] {
    MarkdownBlockParser.parse(text)
  }

  var body: some View {
    MarkdownDocumentView(
      blocks: blocks,
      isError: isError,
      fillsWidth: fillsWidth
    )
      .textSelection(.enabled)
      .foregroundStyle(isError ? .red : .primary)
      .tint(isError ? .red : .accentColor)
  }
}

private struct MarkdownDocumentView: View {
  var blocks: [MarkdownBlock]
  var isError = false
  var fillsWidth = true

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if blocks.isEmpty {
        EmptyView()
      } else {
        ForEach(blocks.indices, id: \.self) { index in
          MarkdownBlockView(block: blocks[index], isError: isError)
        }
      }
    }
    .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: .leading)
  }
}

private struct MarkdownBlockView: View {
  var block: MarkdownBlock
  var isError: Bool

  var body: some View {
    switch block {
    case .blockquote(let blocks):
      MarkdownBlockquoteView(blocks: blocks, isError: isError)
    case .codeBlock(let language, let code):
      MarkdownCodeBlockView(language: language, code: code)
    case .heading(let level, let text):
      MarkdownInlineText(text: text)
        .font(headingFont(for: level))
        .fontWeight(.semibold)
        .padding(.top, level <= 2 ? 4 : 2)
        .accessibilityAddTraits(.isHeader)
    case .horizontalRule:
      Divider()
        .padding(.vertical, 4)
    case .orderedList(let items):
      MarkdownListView(items: items, ordered: true)
    case .paragraph(let text):
      MarkdownInlineText(text: text)
        .fixedSize(horizontal: false, vertical: true)
    case .table(let table):
      MarkdownTableView(table: table)
    case .unorderedList(let items):
      MarkdownListView(items: items, ordered: false)
    }
  }

  private func headingFont(for level: Int) -> Font {
    switch level {
    case 1:
      .title2
    case 2:
      .title3
    case 3:
      .headline
    default:
      .subheadline
    }
  }
}

private struct MarkdownInlineText: View {
  var text: String

  var body: some View {
    Text(MarkdownInlineRenderer.attributedString(from: text))
  }
}

private struct MarkdownBlockquoteView: View {
  var blocks: [MarkdownBlock]
  var isError: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      RoundedRectangle(cornerRadius: 2)
        .fill(.secondary.opacity(0.35))
        .frame(width: 3)

      MarkdownDocumentView(blocks: blocks, isError: isError)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
  }
}

private struct MarkdownListView: View {
  var items: [MarkdownListItem]
  var ordered: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(items.indices, id: \.self) { index in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(marker(for: items[index], fallbackIndex: index))
            .font(.body.monospacedDigit())
            .foregroundStyle(.secondary)
            .frame(minWidth: ordered ? 28 : 18, alignment: .trailing)

          MarkdownInlineText(text: items[index].text)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(.vertical, 2)
  }

  private func marker(for item: MarkdownListItem, fallbackIndex: Int) -> String {
    if let checked = item.checked {
      return checked ? "☑" : "☐"
    }

    if ordered {
      return "\(item.ordinal ?? fallbackIndex + 1)."
    }

    return "•"
  }
}

private struct MarkdownCodeBlockView: View {
  var language: String?
  var code: String

  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        if let language, !language.isEmpty {
          Text(language)
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
        }

        Spacer(minLength: 12)

        Button {
          copyCode()
        } label: {
          Label(
            copied ? "Copied" : "Copy",
            picoSystemImage: copied ? "checkmark" : "doc.on.doc",
            size: 20
          )
            .labelStyle(.titleAndIcon)
        }
        .buttonStyle(.borderless)
        .font(.caption)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)

      Divider()

      ScrollView(.horizontal) {
        Text(verbatim: code.isEmpty ? " " : code)
          .font(.system(.callout, design: .monospaced))
          .foregroundStyle(.primary)
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .stroke(.secondary.opacity(0.18), lineWidth: 1)
    }
  }

  private func copyCode() {
    UIPasteboard.general.string = code
    copied = true

    Task {
      try? await Task.sleep(nanoseconds: 1_200_000_000)
      await MainActor.run {
        copied = false
      }
    }
  }
}

private struct MarkdownTableView: View {
  var table: MarkdownTable

  var body: some View {
    ScrollView(.horizontal) {
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
        GridRow {
          ForEach(0..<table.columnCount, id: \.self) { index in
            MarkdownInlineText(text: table.cell(at: index, in: table.headers))
              .fontWeight(.semibold)
              .fixedSize(horizontal: false, vertical: true)
          }
        }

        ForEach(table.rows.indices, id: \.self) { rowIndex in
          GridRow {
            ForEach(0..<table.columnCount, id: \.self) { columnIndex in
              MarkdownInlineText(text: table.cell(at: columnIndex, in: table.rows[rowIndex]))
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
      }
      .padding(12)
    }
    .background(.secondary.opacity(0.06), in: .rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .stroke(.secondary.opacity(0.16), lineWidth: 1)
    }
  }
}

private enum MarkdownBlock: Hashable {
  case blockquote([MarkdownBlock])
  case codeBlock(language: String?, code: String)
  case heading(level: Int, text: String)
  case horizontalRule
  case orderedList([MarkdownListItem])
  case paragraph(String)
  case table(MarkdownTable)
  case unorderedList([MarkdownListItem])
}

private struct MarkdownListItem: Hashable {
  var ordinal: Int?
  var checked: Bool?
  var text: String
}

private struct MarkdownTable: Hashable {
  var headers: [String]
  var rows: [[String]]

  var columnCount: Int {
    max(headers.count, rows.map(\.count).max() ?? 0)
  }

  func cell(at index: Int, in row: [String]) -> String {
    guard row.indices.contains(index) else { return "" }
    return row[index]
  }
}

private enum MarkdownInlineRenderer {
  static func attributedString(from text: String) -> AttributedString {
    var attributed = (try? AttributedString(
      markdown: text,
      options: markdownOptions
    )) ?? AttributedString(text)

    for run in attributed.runs {
      if run.link != nil {
        attributed[run.range].underlineStyle = .single
      }
    }

    return attributed
  }

  private static let markdownOptions = AttributedString.MarkdownParsingOptions(
    interpretedSyntax: .inlineOnlyPreservingWhitespace,
    failurePolicy: .returnPartiallyParsedIfPossible
  )
}

private enum MarkdownBlockParser {
  static func parse(_ source: String) -> [MarkdownBlock] {
    let normalized = source
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
    let lines = stripHtmlCommentsOutsideCodeBlocks(normalized)
      .components(separatedBy: "\n")
    var parser = Parser(lines: lines)
    return parser.parseBlocks()
  }

  private static func stripHtmlCommentsOutsideCodeBlocks(_ source: String) -> String {
    var strippedLines: [String] = []
    var activeFence: MarkdownFence?
    var insideComment = false

    for line in source.components(separatedBy: "\n") {
      if let fence = activeFence {
        strippedLines.append(line)
        if fence.closes(line) {
          activeFence = nil
        }
        continue
      }

      if !insideComment, let fence = MarkdownFence(line: line) {
        activeFence = fence
        strippedLines.append(line)
        continue
      }

      strippedLines.append(
        stripHtmlComments(from: line, insideComment: &insideComment)
      )
    }

    return strippedLines.joined(separator: "\n")
  }

  private static func stripHtmlComments(
    from line: String,
    insideComment: inout Bool
  ) -> String {
    var remaining = line[...]
    var output = ""

    while !remaining.isEmpty {
      if insideComment {
        guard let endRange = remaining.range(of: "-->") else {
          return output
        }
        remaining = remaining[endRange.upperBound...]
        insideComment = false
        continue
      }

      guard let startRange = remaining.range(of: "<!--") else {
        output.append(contentsOf: remaining)
        break
      }

      output.append(contentsOf: remaining[..<startRange.lowerBound])
      remaining = remaining[startRange.upperBound...]

      guard let endRange = remaining.range(of: "-->") else {
        insideComment = true
        break
      }
      remaining = remaining[endRange.upperBound...]
    }

    return output
  }

  private struct Parser {
    var lines: [String]
    var index = 0

    mutating func parseBlocks() -> [MarkdownBlock] {
      var blocks: [MarkdownBlock] = []

      while index < lines.count {
        if currentLine.isBlank {
          index += 1
          continue
        }

        if let codeBlock = parseCodeBlock() {
          blocks.append(codeBlock)
          continue
        }

        if let table = parseTable() {
          blocks.append(.table(table))
          continue
        }

        if let heading = parseHeading() {
          blocks.append(heading)
          continue
        }

        if isHorizontalRule(currentLine) {
          blocks.append(.horizontalRule)
          index += 1
          continue
        }

        if let blockquote = parseBlockquote() {
          blocks.append(blockquote)
          continue
        }

        if let list = parseList() {
          blocks.append(list)
          continue
        }

        blocks.append(parseParagraph())
      }

      return blocks
    }

    private var currentLine: String {
      lines[index]
    }

    private mutating func parseCodeBlock() -> MarkdownBlock? {
      guard let fence = MarkdownFence(line: currentLine) else { return nil }
      index += 1

      var codeLines: [String] = []
      while index < lines.count {
        let line = lines[index]
        if fence.closes(line) {
          index += 1
          break
        }

        codeLines.append(line)
        index += 1
      }

      return .codeBlock(language: fence.language, code: codeLines.joined(separator: "\n"))
    }

    private mutating func parseTable() -> MarkdownTable? {
      guard index + 1 < lines.count else { return nil }
      guard currentLine.contains("|") else { return nil }
      guard isTableDelimiter(lines[index + 1]) else { return nil }

      let headers = splitTableRow(currentLine)
      guard headers.count >= 2 else { return nil }

      index += 2
      var rows: [[String]] = []
      while index < lines.count, lines[index].contains("|"), !lines[index].isBlank {
        rows.append(splitTableRow(lines[index]))
        index += 1
      }

      return MarkdownTable(headers: headers, rows: rows)
    }

    private mutating func parseHeading() -> MarkdownBlock? {
      let trimmed = currentLine.trimmingCharacters(in: .whitespaces)
      var level = 0

      for character in trimmed {
        if character == "#", level < 6 {
          level += 1
        } else {
          break
        }
      }

      guard level > 0 else { return nil }
      let rest = trimmed.dropFirst(level)
      guard rest.first?.isWhitespace == true else { return nil }

      let text = rest
        .drop(while: \.isWhitespace)
        .trimmingTrailingHashes()
        .trimmingCharacters(in: .whitespaces)

      index += 1
      return .heading(level: level, text: text)
    }

    private mutating func parseBlockquote() -> MarkdownBlock? {
      guard currentLine.isBlockquoteLine else { return nil }

      var quotedLines: [String] = []
      while index < lines.count, lines[index].isBlockquoteLine {
        quotedLines.append(lines[index].removingBlockquoteMarker())
        index += 1
      }

      var nested = Parser(lines: quotedLines)
      return .blockquote(nested.parseBlocks())
    }

    private mutating func parseList() -> MarkdownBlock? {
      guard let firstMarker = MarkdownListMarker(line: currentLine) else { return nil }
      var items: [MarkdownListItem] = []

      while index < lines.count,
        let marker = MarkdownListMarker(line: lines[index]),
        marker.ordered == firstMarker.ordered,
        marker.indent == firstMarker.indent
      {
        index += 1
        var itemLines = [marker.text]

        while index < lines.count {
          let line = lines[index]
          if line.isBlank {
            break
          }
          if let nextMarker = MarkdownListMarker(line: line) {
            if nextMarker.indent == firstMarker.indent,
              nextMarker.ordered == firstMarker.ordered
            {
              break
            }
            if nextMarker.indent <= firstMarker.indent {
              break
            }
          }
          if MarkdownFence(line: line) != nil || line.isNonListBlockStartForParagraph {
            break
          }

          itemLines.append(line.trimmingCharacters(in: .whitespaces))
          index += 1
        }

        items.append(MarkdownListItem(
          ordinal: marker.ordinal,
          checked: taskState(for: itemLines.first),
          text: removingTaskMarker(from: itemLines.joined(separator: "\n"))
        ))

        if index < lines.count, lines[index].isBlank {
          index += 1
          guard index < lines.count,
            let nextMarker = MarkdownListMarker(line: lines[index]),
            nextMarker.indent == firstMarker.indent
          else {
            break
          }
        }
      }

      return firstMarker.ordered ? .orderedList(items) : .unorderedList(items)
    }

    private mutating func parseParagraph() -> MarkdownBlock {
      var paragraphLines: [String] = []

      while index < lines.count {
        let line = lines[index]
        if line.isBlank || MarkdownFence(line: line) != nil || line.isBlockStartForParagraph {
          break
        }

        if index + 1 < lines.count, line.contains("|"), isTableDelimiter(lines[index + 1]) {
          break
        }

        paragraphLines.append(line.trimmingCharacters(in: .whitespaces))
        index += 1
      }

      return .paragraph(paragraphLines.joined(separator: "\n"))
    }

    private func isHorizontalRule(_ line: String) -> Bool {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard trimmed.count >= 3 else { return false }
      let characters = trimmed.filter { !$0.isWhitespace }
      guard characters.count >= 3, let first = characters.first else { return false }
      guard first == "-" || first == "*" || first == "_" else { return false }
      return characters.allSatisfy { $0 == first }
    }

    private func isTableDelimiter(_ line: String) -> Bool {
      let cells = splitTableRow(line)
      guard cells.count >= 2 else { return false }
      return cells.allSatisfy { cell in
        let trimmed = cell.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3 else { return false }
        let withoutColons = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
        return withoutColons.count >= 3 && withoutColons.allSatisfy { $0 == "-" }
      }
    }

    private func splitTableRow(_ line: String) -> [String] {
      var row = line.trimmingCharacters(in: .whitespaces)
      if row.first == "|" {
        row.removeFirst()
      }
      if row.last == "|" {
        row.removeLast()
      }

      var cells: [String] = []
      var current = ""
      var isEscaping = false

      for character in row {
        if isEscaping {
          current.append(character)
          isEscaping = false
        } else if character == "\\" {
          isEscaping = true
        } else if character == "|" {
          cells.append(current.trimmingCharacters(in: .whitespaces))
          current = ""
        } else {
          current.append(character)
        }
      }

      if isEscaping {
        current.append("\\")
      }
      cells.append(current.trimmingCharacters(in: .whitespaces))

      return cells
    }

    private func taskState(for text: String?) -> Bool? {
      guard let text else { return nil }
      let trimmed = text.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("[x] ") || trimmed.hasPrefix("[X] ") {
        return true
      }
      if trimmed.hasPrefix("[ ] ") {
        return false
      }
      return nil
    }

    private func removingTaskMarker(from text: String) -> String {
      let trimmed = text.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("[x] ") || trimmed.hasPrefix("[X] ") || trimmed.hasPrefix("[ ] ") {
        return String(trimmed.dropFirst(4))
      }
      return text
    }
  }
}

private struct MarkdownFence {
  var character: Character
  var length: Int
  var language: String?

  init?(line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard let first = trimmed.first, first == "`" || first == "~" else { return nil }

    var count = 0
    for character in trimmed {
      if character == first {
        count += 1
      } else {
        break
      }
    }

    guard count >= 3 else { return nil }

    let info = trimmed
      .dropFirst(count)
      .trimmingCharacters(in: .whitespaces)
    let language = info
      .split(whereSeparator: \.isWhitespace)
      .first
      .map(String.init)

    self.character = first
    self.length = count
    self.language = language
  }

  func closes(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    var count = 0

    for character in trimmed {
      if character == self.character {
        count += 1
      } else {
        break
      }
    }

    guard count >= length else { return false }
    return trimmed.dropFirst(count).allSatisfy(\.isWhitespace)
  }
}

private struct MarkdownListMarker: Equatable {
  var indent: Int
  var ordered: Bool
  var ordinal: Int?
  var text: String

  init?(line: String) {
    let leadingSpaces = line.prefix { $0 == " " }.count
    guard leadingSpaces <= 6 else { return nil }

    let trimmed = line.dropFirst(leadingSpaces)
    guard let first = trimmed.first else { return nil }

    if first == "-" || first == "*" || first == "+" {
      let rest = trimmed.dropFirst()
      guard rest.first?.isWhitespace == true else { return nil }
      self.indent = leadingSpaces
      self.ordered = false
      self.ordinal = nil
      self.text = rest.drop(while: \.isWhitespace).asString
      return
    }

    guard first.isNumber else { return nil }
    var number = ""
    var cursor = trimmed.startIndex

    while cursor < trimmed.endIndex, trimmed[cursor].isNumber {
      number.append(trimmed[cursor])
      cursor = trimmed.index(after: cursor)
    }

    guard cursor < trimmed.endIndex, trimmed[cursor] == "." || trimmed[cursor] == ")" else { return nil }
    cursor = trimmed.index(after: cursor)
    guard cursor < trimmed.endIndex, trimmed[cursor].isWhitespace else { return nil }

    self.indent = leadingSpaces
    self.ordered = true
    self.ordinal = Int(number)
    self.text = trimmed[cursor...].drop(while: \.isWhitespace).asString
  }
}

private extension String {
  var isBlank: Bool {
    allSatisfy(\.isWhitespace)
  }

  var isBlockquoteLine: Bool {
    trimmingCharacters(in: .whitespaces).hasPrefix(">")
  }

  var isBlockStartForParagraph: Bool {
    isNonListBlockStartForParagraph || MarkdownListMarker(line: self) != nil
  }

  var isNonListBlockStartForParagraph: Bool {
    let trimmed = trimmingCharacters(in: .whitespaces)
    return isBlockquoteLine
      || isHeadingStart(trimmed)
      || isHorizontalRuleStart(trimmed)
  }

  func removingBlockquoteMarker() -> String {
    let trimmed = trimmingCharacters(in: .whitespaces)
    guard trimmed.first == ">" else { return self }
    return trimmed
      .dropFirst()
      .drop(while: \.isWhitespace)
      .asString
  }

  private func isHeadingStart(_ trimmed: String) -> Bool {
    var level = 0
    for character in trimmed {
      if character == "#", level < 6 {
        level += 1
      } else {
        break
      }
    }
    guard level > 0 else { return false }
    return trimmed.dropFirst(level).first?.isWhitespace == true
  }

  private func isHorizontalRuleStart(_ trimmed: String) -> Bool {
    let characters = trimmed.filter { !$0.isWhitespace }
    guard characters.count >= 3, let first = characters.first else { return false }
    guard first == "-" || first == "*" || first == "_" else { return false }
    return characters.allSatisfy { $0 == first }
  }
}

private extension Substring {
  var asString: String {
    String(self)
  }

  func trimmingTrailingHashes() -> String {
    var value = self
    while value.last == "#" {
      value = value.dropLast()
    }
    return value.asString
  }
}

#Preview {
  ScrollView {
    MarkdownTextView(
      text: """
      # Markdown rendering

      SwiftUI **does** support inline Markdown, but Pico renders blocks natively now.

      - Lists keep their markers
      - [x] Task items work
      - Links like [Pico](https://github.com/alivault/pico) stay tappable

      > Block quotes preserve their own blocks.

      ```swift
      let message = "Code fences no longer collapse"
      print(message)
      ```

      | Feature | Status |
      | --- | --- |
      | Headings | **OK** |
      | Tables | Basic |
      """,
      isError: false
    )
    .padding()
  }
}
