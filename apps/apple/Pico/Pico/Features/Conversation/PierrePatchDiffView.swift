import Foundation
import SwiftUI

struct PierrePatchDiffView: View {
  var model: AppModel?
  var patch: String
  var fileName: String?
  var maxHeight: CGFloat? = 384
  var scrollsVertically = true
  var isStreaming = false

  @State private var highlight: CodeHighlightResult?
  @State private var highlightingRequestID: String?

  private var diff: PierrePatchDiff {
    PierrePatchDiff(patch: patch, fallbackFileName: fileName)
  }

  private var codeLanguage: CodeFileLanguage? {
    CodeFileLanguageDetector.detect(path: diff.fileName)
  }

  private var highlightCode: String {
    diff.lines
      .map { $0.type.isCode ? $0.content : "" }
      .joined(separator: "\n")
  }

  private var highlightRequestID: String? {
    guard !isStreaming,
          model != nil,
          let codeLanguage,
          !highlightCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return nil
    }

    return "\(diff.fileName)\u{0}\(codeLanguage.shikiLanguage)\u{0}\(highlightCode.count)\u{0}\(highlightCode.hashValue)"
  }

  private var syntaxSegmentsByLineID: [Int: [PierrePatchDiffSyntaxSegment]] {
    guard let html = highlight?.html, !html.isEmpty else { return [:] }

    let parsedLines = ShikiHighlightedHTMLParser.parseLines(html)
    var segmentsByLineID: [Int: [PierrePatchDiffSyntaxSegment]] = [:]

    for (index, line) in diff.lines.enumerated() where line.type.isCode {
      guard parsedLines.indices.contains(index) else { continue }
      segmentsByLineID[line.id] = Self.syntaxSegments(from: parsedLines[index])
    }

    return segmentsByLineID
  }

  var body: some View {
    PierrePatchDiffRowsView(
      diff: diff,
      syntaxSegmentsByLineID: syntaxSegmentsByLineID,
      maxHeight: maxHeight,
      scrollsVertically: scrollsVertically
    )
    .task(id: highlightRequestID) {
      await loadHighlightIfNeeded()
    }
  }

  private func loadHighlightIfNeeded() async {
    guard let requestID = highlightRequestID,
          let model,
          let codeLanguage,
          highlight?.requestID != requestID else {
      return
    }

    let requestedCode = highlightCode
    let requestedLanguage = codeLanguage.shikiLanguage
    highlightingRequestID = requestID
    defer {
      if highlightingRequestID == requestID {
        highlightingRequestID = nil
      }
    }

    do {
      let response = try await model.highlightCode(
        code: requestedCode,
        language: requestedLanguage
      )
      guard !Task.isCancelled, highlightRequestID == requestID else { return }
      highlight = CodeHighlightResult(
        requestID: requestID,
        requestedLanguage: requestedLanguage,
        response: response
      )
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled, highlightRequestID == requestID else { return }
      highlight = .unavailable(requestID: requestID, language: requestedLanguage)
    }
  }

  private static func syntaxSegments(
    from segments: [ShikiHighlightedSegment]
  ) -> [PierrePatchDiffSyntaxSegment] {
    var offset = 0
    var syntaxSegments: [PierrePatchDiffSyntaxSegment] = []

    for segment in segments {
      let length = segment.text.count
      defer { offset += length }
      guard length > 0, segment.cssVariable != nil else { continue }

      syntaxSegments.append(
        PierrePatchDiffSyntaxSegment(
          lowerBound: offset,
          upperBound: offset + length,
          cssVariable: segment.cssVariable
        )
      )
    }

    return syntaxSegments
  }
}

struct PierrePatchDiff: Equatable {
  var fileName: String
  var lines: [PierrePatchDiffLine]

  init(patch: String, fallbackFileName: String?) {
    let normalizedPatch = patch
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
    var patchLines = normalizedPatch.components(separatedBy: "\n")

    if patchLines.last == "" {
      patchLines.removeLast()
    }

    var parsedFileName = fallbackFileName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    var parsedLines: [PierrePatchDiffLine] = []
    var isInsideHunk = false
    var oldLineNumber = 0
    var newLineNumber = 0

    for line in patchLines {
      if parsedFileName.isEmpty {
        parsedFileName = Self.fileName(fromPatchHeaderLine: line)
      }

      if line.hasPrefix("@@") {
        let hunk = Self.hunkInfo(from: line)
        oldLineNumber = hunk.oldStart
        newLineNumber = hunk.newStart
        isInsideHunk = true
        continue
      }

      guard isInsideHunk else { continue }

      if line.hasPrefix("\\") {
        parsedLines.append(
          PierrePatchDiffLine(
            id: parsedLines.count,
            type: .note,
            oldLineNumber: nil,
            newLineNumber: nil,
            content: line
          )
        )
      } else if line.hasPrefix("+") && !line.hasPrefix("+++") {
        parsedLines.append(
          PierrePatchDiffLine(
            id: parsedLines.count,
            type: .addition,
            oldLineNumber: nil,
            newLineNumber: newLineNumber,
            content: String(line.dropFirst())
          )
        )
        newLineNumber += 1
      } else if line.hasPrefix("-") && !line.hasPrefix("---") {
        parsedLines.append(
          PierrePatchDiffLine(
            id: parsedLines.count,
            type: .deletion,
            oldLineNumber: oldLineNumber,
            newLineNumber: nil,
            content: String(line.dropFirst())
          )
        )
        oldLineNumber += 1
      } else if line.hasPrefix(" ") {
        parsedLines.append(
          PierrePatchDiffLine(
            id: parsedLines.count,
            type: .context,
            oldLineNumber: oldLineNumber,
            newLineNumber: newLineNumber,
            content: String(line.dropFirst())
          )
        )
        oldLineNumber += 1
        newLineNumber += 1
      } else if line.isEmpty {
        parsedLines.append(
          PierrePatchDiffLine(
            id: parsedLines.count,
            type: .context,
            oldLineNumber: oldLineNumber,
            newLineNumber: newLineNumber,
            content: ""
          )
        )
        oldLineNumber += 1
        newLineNumber += 1
      }
    }

    if parsedLines.isEmpty && !patchLines.isEmpty {
      parsedLines = patchLines.enumerated().map { offset, line in
        PierrePatchDiffLine(
          id: offset,
          type: .metadata,
          oldLineNumber: nil,
          newLineNumber: nil,
          content: line
        )
      }
    }

    fileName = parsedFileName.isEmpty ? "changes.diff" : parsedFileName
    lines = Self.linesWithIntralineHighlights(parsedLines)
  }

  private static func linesWithIntralineHighlights(
    _ lines: [PierrePatchDiffLine]
  ) -> [PierrePatchDiffLine] {
    var highlightedLines = lines
    var changeBlockStart: Int?

    func flushChangeBlock(upTo endIndex: Int) {
      guard let startIndex = changeBlockStart else { return }

      applyIntralineHighlights(
        in: startIndex..<endIndex,
        to: &highlightedLines
      )
      changeBlockStart = nil
    }

    for index in lines.indices {
      switch lines[index].type {
      case .addition, .deletion:
        changeBlockStart = changeBlockStart ?? index
      case .context, .hunk, .metadata, .note:
        flushChangeBlock(upTo: index)
      }
    }

    flushChangeBlock(upTo: lines.endIndex)
    return highlightedLines
  }

  private static func applyIntralineHighlights(
    in range: Range<Int>,
    to lines: inout [PierrePatchDiffLine]
  ) {
    let deletionIndexes = range.filter { lines[$0].type == .deletion }
    let additionIndexes = range.filter { lines[$0].type == .addition }
    let pairCount = min(deletionIndexes.count, additionIndexes.count)

    guard pairCount > 0 else { return }

    for pairIndex in 0..<pairCount {
      let deletionIndex = deletionIndexes[pairIndex]
      let additionIndex = additionIndexes[pairIndex]
      let ranges = intralineHighlightRanges(
        oldContent: lines[deletionIndex].content,
        newContent: lines[additionIndex].content
      )

      lines[deletionIndex].highlightRanges = ranges.old
      lines[additionIndex].highlightRanges = ranges.new
    }
  }

  private static func intralineHighlightRanges(
    oldContent: String,
    newContent: String
  ) -> (old: [PierrePatchDiffHighlightRange], new: [PierrePatchDiffHighlightRange]) {
    guard oldContent != newContent else { return ([], []) }

    let oldTokens = PierrePatchDiffToken.tokens(in: oldContent)
    let newTokens = PierrePatchDiffToken.tokens(in: newContent)
    let matches = lcsMatchedTokenIndexes(oldTokens: oldTokens, newTokens: newTokens)
    let matchedOldIndexes = Set(matches.map(\.oldIndex))
    let matchedNewIndexes = Set(matches.map(\.newIndex))

    let oldRanges = oldTokens.enumerated().compactMap { index, token in
      matchedOldIndexes.contains(index) || token.isWhitespace ? nil : token.highlightRange
    }
    let newRanges = newTokens.enumerated().compactMap { index, token in
      matchedNewIndexes.contains(index) || token.isWhitespace ? nil : token.highlightRange
    }

    return (
      mergedHighlightRanges(oldRanges),
      mergedHighlightRanges(newRanges)
    )
  }

  private static func lcsMatchedTokenIndexes(
    oldTokens: [PierrePatchDiffToken],
    newTokens: [PierrePatchDiffToken]
  ) -> [(oldIndex: Int, newIndex: Int)] {
    guard !oldTokens.isEmpty, !newTokens.isEmpty else { return [] }

    var lengths = Array(
      repeating: Array(repeating: 0, count: newTokens.count + 1),
      count: oldTokens.count + 1
    )

    for oldIndex in stride(from: oldTokens.count - 1, through: 0, by: -1) {
      for newIndex in stride(from: newTokens.count - 1, through: 0, by: -1) {
        if oldTokens[oldIndex].text == newTokens[newIndex].text {
          lengths[oldIndex][newIndex] = lengths[oldIndex + 1][newIndex + 1] + 1
        } else {
          lengths[oldIndex][newIndex] = max(
            lengths[oldIndex + 1][newIndex],
            lengths[oldIndex][newIndex + 1]
          )
        }
      }
    }

    var matches: [(oldIndex: Int, newIndex: Int)] = []
    var oldIndex = 0
    var newIndex = 0

    while oldIndex < oldTokens.count, newIndex < newTokens.count {
      if oldTokens[oldIndex].text == newTokens[newIndex].text {
        matches.append((oldIndex, newIndex))
        oldIndex += 1
        newIndex += 1
      } else if lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1] {
        oldIndex += 1
      } else {
        newIndex += 1
      }
    }

    return matches
  }

  private static func mergedHighlightRanges(
    _ ranges: [PierrePatchDiffHighlightRange]
  ) -> [PierrePatchDiffHighlightRange] {
    guard var current = ranges.first else { return [] }

    var merged: [PierrePatchDiffHighlightRange] = []

    for range in ranges.dropFirst() {
      if range.lowerBound <= current.upperBound {
        current.upperBound = max(current.upperBound, range.upperBound)
      } else {
        merged.append(current)
        current = range
      }
    }

    merged.append(current)
    return merged
  }

  private static func hunkInfo(from line: String) -> (oldStart: Int, newStart: Int) {
    let parts = line.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    let oldStart = parts.compactMap { hunkStart(from: $0, marker: "-") }.first ?? 0
    let newStart = parts.compactMap { hunkStart(from: $0, marker: "+") }.first ?? 0

    return (oldStart, newStart)
  }

  private static func hunkStart(from component: String, marker: String) -> Int? {
    guard component.hasPrefix(marker) else { return nil }

    let rangeText = component.dropFirst().split(separator: ",", maxSplits: 1).first.map(String.init) ?? ""
    return Int(rangeText)
  }

  private static func fileName(fromPatchHeaderLine line: String) -> String {
    if line.hasPrefix("+++ ") {
      return normalizedPatchPath(String(line.dropFirst(4)))
    }

    if line.hasPrefix("diff --git ") {
      let parts = line.split(whereSeparator: { $0.isWhitespace }).map(String.init)
      if parts.count >= 4 {
        return normalizedPatchPath(parts[3])
      }
    }

    return ""
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

struct PierrePatchDiffLine: Equatable, Identifiable {
  var id: Int
  var type: PierrePatchDiffLineType
  var oldLineNumber: Int?
  var newLineNumber: Int?
  var content: String
  var highlightRanges: [PierrePatchDiffHighlightRange] = []
}

struct PierrePatchDiffHighlightRange: Equatable {
  var lowerBound: Int
  var upperBound: Int
}

struct PierrePatchDiffSyntaxSegment: Equatable {
  var lowerBound: Int
  var upperBound: Int
  var cssVariable: String?
}

private extension PierrePatchDiffLineType {
  var isCode: Bool {
    switch self {
    case .addition, .deletion, .context:
      true
    case .hunk, .metadata, .note:
      false
    }
  }
}

private struct PierrePatchDiffToken: Equatable {
  var text: String
  var lowerBound: Int
  var upperBound: Int
  var kind: Kind

  var isWhitespace: Bool {
    kind == .whitespace
  }

  var highlightRange: PierrePatchDiffHighlightRange {
    PierrePatchDiffHighlightRange(lowerBound: lowerBound, upperBound: upperBound)
  }

  static func tokens(in text: String) -> [PierrePatchDiffToken] {
    var tokens: [PierrePatchDiffToken] = []
    var tokenText = ""
    var tokenKind: Kind?
    var tokenStart = 0
    var offset = 0

    func flushToken() {
      guard let kind = tokenKind else { return }

      tokens.append(
        PierrePatchDiffToken(
          text: tokenText,
          lowerBound: tokenStart,
          upperBound: offset,
          kind: kind
        )
      )
      tokenText = ""
      tokenKind = nil
    }

    for character in text {
      let nextKind = Kind(character: character)
      let continuesToken = tokenKind == nextKind && nextKind != .symbol

      if !continuesToken {
        flushToken()
        tokenStart = offset
        tokenKind = nextKind
      }

      tokenText.append(character)
      offset += 1
    }

    flushToken()
    return tokens
  }

  enum Kind: Equatable {
    case word
    case whitespace
    case symbol

    init(character: Character) {
      if character.isWhitespace {
        self = .whitespace
      } else if character.isLetter || character.isNumber || character == "_" {
        self = .word
      } else {
        self = .symbol
      }
    }
  }
}

enum PierrePatchDiffLineType: Equatable {
  case context
  case addition
  case deletion
  case hunk
  case note
  case metadata
}

private struct PierrePatchDiffRowsView: View {
  var diff: PierrePatchDiff
  var syntaxSegmentsByLineID: [Int: [PierrePatchDiffSyntaxSegment]] = [:]
  var maxHeight: CGFloat? = 384
  var scrollsVertically = true

  @Environment(\.colorScheme) private var colorScheme

  private var palette: PierrePatchDiffPalette {
    PierrePatchDiffPalette(colorScheme: colorScheme)
  }

  var body: some View {
    Group {
      if scrollsVertically {
        ScrollView(.vertical) {
          rows
        }
        .frame(maxHeight: maxHeight)
      } else {
        rows
      }
    }
    .background(palette.containerBackground, in: .rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .stroke(palette.border, lineWidth: 1)
    }
    .clipShape(.rect(cornerRadius: 12))
    .textSelection(.enabled)
  }

  private var rows: some View {
    LazyVStack(alignment: .leading, spacing: 0) {
      ForEach(diff.lines) { line in
        PierrePatchDiffLineView(
          line: line,
          syntaxSegments: syntaxSegmentsByLineID[line.id] ?? [],
          palette: palette
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 6)
  }
}

private struct PierrePatchDiffLineView: View {
  var line: PierrePatchDiffLine
  var syntaxSegments: [PierrePatchDiffSyntaxSegment]
  var palette: PierrePatchDiffPalette

  private let accentWidth: CGFloat = 3
  private let numberColumnWidth: CGFloat = 46
  private let numberColumnGapWidth: CGFloat = 1

  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      Rectangle()
        .fill(palette.accent(for: line.type))
        .frame(width: accentWidth)
        .accessibilityHidden(true)

      lineNumberColumn(lineNumber)

      Text(attributedContent)
        .font(.system(size: 12, design: .monospaced))
        .lineSpacing(1)
        .padding(.horizontal, 10)
        .padding(.vertical, line.type == .hunk ? 5 : 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      Rectangle()
        .fill(palette.background(for: line.type))
    }
    .overlay(alignment: .leading) {
      Rectangle()
        .fill(palette.containerBackground)
        .frame(width: numberColumnGapWidth)
        .offset(x: accentWidth + numberColumnWidth - numberColumnGapWidth)
        .accessibilityHidden(true)
    }
    .accessibilityElement(children: .combine)
  }

  private var displayContent: String {
    line.content.isEmpty ? " " : line.content
  }

  private var attributedContent: AttributedString {
    var attributed = AttributedString(displayContent)
    attributed.foregroundColor = palette.foreground(for: line.type)

    for segment in syntaxSegments {
      guard let range = attributedRange(
        lowerBound: segment.lowerBound,
        upperBound: segment.upperBound,
        in: attributed
      ) else {
        continue
      }

      attributed[range].foregroundColor = palette.syntaxColor(
        forCSSVariable: segment.cssVariable
      )
    }

    for range in line.highlightRanges {
      guard let attributedRange = attributedRange(
        lowerBound: range.lowerBound,
        upperBound: range.upperBound,
        in: attributed
      ) else {
        continue
      }

      attributed[attributedRange].backgroundColor = palette.intralineBackground(
        for: line.type
      )
    }

    return attributed
  }

  private func attributedRange(
    lowerBound: Int,
    upperBound: Int,
    in attributed: AttributedString
  ) -> Range<AttributedString.Index>? {
    guard let lowerBound = attributed.characters.index(
      attributed.startIndex,
      offsetBy: lowerBound,
      limitedBy: attributed.endIndex
    ),
          let upperBound = attributed.characters.index(
            attributed.startIndex,
            offsetBy: upperBound,
            limitedBy: attributed.endIndex
          ),
          lowerBound < upperBound else {
      return nil
    }

    return lowerBound..<upperBound
  }

  private var lineNumber: Int? {
    switch line.type {
    case .addition:
      line.newLineNumber
    case .deletion:
      line.oldLineNumber
    case .context:
      line.newLineNumber ?? line.oldLineNumber
    case .hunk, .metadata, .note:
      nil
    }
  }

  private func lineNumberColumn(_ value: Int?) -> some View {
    Text(value.map { String($0) } ?? "")
      .font(.system(size: 11, weight: .medium, design: .monospaced))
      .foregroundStyle(palette.lineNumberForeground(for: line.type))
      .padding(.vertical, line.type == .hunk ? 5 : 2)
      .padding(.horizontal, 6)
      .frame(width: numberColumnWidth, alignment: .trailing)
  }
}

private struct PierrePatchDiffPalette {
  var colorScheme: ColorScheme

  private var syntaxPalette: CodeSyntaxPalette {
    CodeSyntaxPalette(colorScheme: colorScheme)
  }

  var containerBackground: Color {
    Color(uiColor: .systemBackground)
  }

  var border: Color {
    .secondary.opacity(colorScheme == .dark ? 0.22 : 0.18)
  }

  func accent(for type: PierrePatchDiffLineType) -> Color {
    switch type {
    case .addition:
      Color(uiColor: .systemGreen)
    case .deletion:
      Color(uiColor: .systemRed)
    case .hunk:
      Color(uiColor: .systemBlue)
    case .note:
      Color(uiColor: .systemOrange)
    case .context, .metadata:
      .clear
    }
  }

  func background(for type: PierrePatchDiffLineType) -> Color {
    switch type {
    case .addition:
      Color(uiColor: .systemGreen).opacity(colorScheme == .dark ? 0.18 : 0.11)
    case .deletion:
      Color(uiColor: .systemRed).opacity(colorScheme == .dark ? 0.18 : 0.11)
    case .hunk:
      Color(uiColor: .systemBlue).opacity(colorScheme == .dark ? 0.16 : 0.08)
    case .note:
      Color(uiColor: .systemOrange).opacity(colorScheme == .dark ? 0.14 : 0.08)
    case .context, .metadata:
      .clear
    }
  }

  func foreground(for type: PierrePatchDiffLineType) -> Color {
    switch type {
    case .hunk:
      Color(uiColor: .systemBlue)
    case .note:
      Color(uiColor: .systemOrange)
    case .metadata:
      .secondary
    case .context, .addition, .deletion:
      .primary
    }
  }

  func intralineBackground(for type: PierrePatchDiffLineType) -> Color {
    switch type {
    case .addition:
      Color(uiColor: .systemGreen).opacity(colorScheme == .dark ? 0.38 : 0.22)
    case .deletion:
      Color(uiColor: .systemRed).opacity(colorScheme == .dark ? 0.38 : 0.22)
    case .context, .hunk, .metadata, .note:
      .clear
    }
  }

  func syntaxColor(forCSSVariable cssVariable: String?) -> Color {
    Color(uiColor: syntaxPalette.color(forCSSVariable: cssVariable))
  }

  func lineNumberForeground(for type: PierrePatchDiffLineType) -> Color {
    switch type {
    case .addition:
      Color(uiColor: .systemGreen).opacity(0.92)
    case .deletion:
      Color(uiColor: .systemRed).opacity(0.92)
    case .hunk:
      Color(uiColor: .systemBlue).opacity(0.92)
    case .note:
      Color(uiColor: .systemOrange).opacity(0.84)
    case .context, .metadata:
      .secondary.opacity(0.72)
    }
  }
}
