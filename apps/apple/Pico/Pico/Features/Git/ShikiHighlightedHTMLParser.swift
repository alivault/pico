import Foundation

struct ShikiHighlightedSegment: Equatable, Sendable {
  var text: String
  var cssVariable: String?
}

enum ShikiHighlightedHTMLParser {
  static func parse(_ html: String) -> [ShikiHighlightedSegment] {
    var segments: [ShikiHighlightedSegment] = []
    var colorStack: [String?] = [nil]
    var index = html.startIndex

    while index < html.endIndex {
      if html[index] == "<" {
        guard let tagEnd = html[index...].firstIndex(of: ">") else {
          appendText(
            String(html[index...]),
            cssVariable: colorStack.last ?? nil,
            to: &segments
          )
          break
        }

        let tag = String(html[index...tagEnd])
        if isClosingSpan(tag) {
          if colorStack.count > 1 {
            colorStack.removeLast()
          }
        } else if isOpeningSpan(tag) {
          colorStack.append(cssVariable(in: tag) ?? colorStack.last ?? nil)
        }

        index = html.index(after: tagEnd)
        continue
      }

      let nextTag = html[index...].firstIndex(of: "<") ?? html.endIndex
      appendText(
        String(html[index..<nextTag]),
        cssVariable: colorStack.last ?? nil,
        to: &segments
      )
      index = nextTag
    }

    return segments
  }

  static func parseLines(_ html: String) -> [[ShikiHighlightedSegment]] {
    var lines: [[ShikiHighlightedSegment]] = []
    var currentLine: [ShikiHighlightedSegment] = []
    var stack: [ShikiHTMLStackEntry] = [
      ShikiHTMLStackEntry(cssVariable: nil, isLine: false),
    ]
    var index = html.startIndex
    var foundLineSpans = false

    while index < html.endIndex {
      if html[index] == "<" {
        guard let tagEnd = html[index...].firstIndex(of: ">") else {
          appendText(
            String(html[index...]),
            cssVariable: stack.last?.cssVariable,
            to: &currentLine
          )
          break
        }

        let tag = String(html[index...tagEnd])
        if isClosingSpan(tag) {
          if let entry = stack.popLast(), entry.isLine {
            lines.append(currentLine)
            currentLine = []
          }
          if stack.isEmpty {
            stack.append(ShikiHTMLStackEntry(cssVariable: nil, isLine: false))
          }
        } else if isOpeningSpan(tag) {
          let isLine = isLineSpan(tag)
          foundLineSpans = foundLineSpans || isLine
          stack.append(
            ShikiHTMLStackEntry(
              cssVariable: cssVariable(in: tag) ?? stack.last?.cssVariable,
              isLine: isLine
            )
          )
        }

        index = html.index(after: tagEnd)
        continue
      }

      let nextTag = html[index...].firstIndex(of: "<") ?? html.endIndex
      if stack.contains(where: \.isLine) {
        appendText(
          String(html[index..<nextTag]),
          cssVariable: stack.last?.cssVariable,
          to: &currentLine
        )
      }
      index = nextTag
    }

    if foundLineSpans {
      if !currentLine.isEmpty {
        lines.append(currentLine)
      }
      return lines
    }

    return splitSegmentsIntoLines(parse(html))
  }

  static func plainText(from html: String) -> String {
    parse(html).map(\.text).joined()
  }

  private static func splitSegmentsIntoLines(
    _ segments: [ShikiHighlightedSegment]
  ) -> [[ShikiHighlightedSegment]] {
    var lines: [[ShikiHighlightedSegment]] = [[]]

    for segment in segments {
      let pieces = segment.text.components(separatedBy: "\n")
      for index in pieces.indices {
        appendText(
          pieces[index],
          cssVariable: segment.cssVariable,
          to: &lines[lines.count - 1]
        )

        if index != pieces.indices.last {
          lines.append([])
        }
      }
    }

    return lines
  }

  private static func appendText(
    _ text: String,
    cssVariable: String?,
    to segments: inout [ShikiHighlightedSegment]
  ) {
    guard !text.isEmpty else { return }
    let decodedText = decodeHTMLEntities(text)
    guard !decodedText.isEmpty else { return }

    if let lastSegment = segments.last,
       lastSegment.cssVariable == cssVariable {
      segments[segments.count - 1].text += decodedText
      return
    }

    segments.append(
      ShikiHighlightedSegment(text: decodedText, cssVariable: cssVariable)
    )
  }

  private static func isOpeningSpan(_ tag: String) -> Bool {
    tag.lowercased().hasPrefix("<span")
  }

  private static func isClosingSpan(_ tag: String) -> Bool {
    tag.lowercased().hasPrefix("</span")
  }

  private static func isLineSpan(_ tag: String) -> Bool {
    quotedAttribute("class", in: tag)?
      .split(whereSeparator: { $0.isWhitespace })
      .contains("line") == true
  }

  private static func cssVariable(in tag: String) -> String? {
    guard let style = quotedAttribute("style", in: tag) else { return nil }

    for declaration in style.split(separator: ";") {
      let pieces = declaration.split(separator: ":", maxSplits: 1)
      guard pieces.count == 2 else { continue }

      let property = pieces[0]
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
      guard property == "color" else { continue }

      return firstCSSVariable(in: String(pieces[1]))
    }

    return nil
  }

  private static func quotedAttribute(
    _ name: String,
    in tag: String
  ) -> String? {
    guard let nameRange = tag.range(of: "\(name)=") else { return nil }
    let quoteIndex = nameRange.upperBound
    guard quoteIndex < tag.endIndex else { return nil }

    let quote = tag[quoteIndex]
    guard quote == "\"" || quote == "'" else { return nil }

    let valueStart = tag.index(after: quoteIndex)
    guard let valueEnd = tag[valueStart...].firstIndex(of: quote) else {
      return nil
    }

    return String(tag[valueStart..<valueEnd])
  }

  private static func firstCSSVariable(in value: String) -> String? {
    guard let markerRange = value.range(of: "--") else { return nil }

    var endIndex = markerRange.upperBound
    while endIndex < value.endIndex {
      let scalar = value[endIndex].unicodeScalars.first?.value ?? 0
      let isAllowed =
        (scalar >= 48 && scalar <= 57) ||
        (scalar >= 65 && scalar <= 90) ||
        (scalar >= 97 && scalar <= 122) ||
        scalar == 45
      guard isAllowed else { break }
      endIndex = value.index(after: endIndex)
    }

    return String(value[markerRange.lowerBound..<endIndex])
  }

  private static func decodeHTMLEntities(_ value: String) -> String {
    guard value.contains("&") else { return value }

    var result = ""
    var index = value.startIndex

    while index < value.endIndex {
      if value[index] == "&",
         let semicolon = value[index...].firstIndex(of: ";") {
        let entityStart = value.index(after: index)
        let encoded = String(value[entityStart..<semicolon])
        if let decoded = decodedEntity(encoded) {
          result.append(decoded)
          index = value.index(after: semicolon)
          continue
        }
      }

      result.append(value[index])
      index = value.index(after: index)
    }

    return result
  }

  private static func decodedEntity(_ encoded: String) -> Character? {
    switch encoded.lowercased() {
    case "amp":
      return "&"
    case "lt":
      return "<"
    case "gt":
      return ">"
    case "quot":
      return "\""
    case "apos", "#39":
      return "'"
    default:
      return decodedNumericEntity(encoded)
    }
  }

  private static func decodedNumericEntity(_ encoded: String) -> Character? {
    let lowercased = encoded.lowercased()
    let radix: Int
    let digits: Substring

    if lowercased.hasPrefix("#x") {
      radix = 16
      digits = encoded.dropFirst(2)
    } else if lowercased.hasPrefix("#") {
      radix = 10
      digits = encoded.dropFirst()
    } else {
      return nil
    }

    guard let scalarValue = UInt32(digits, radix: radix),
          let scalar = UnicodeScalar(scalarValue) else {
      return nil
    }

    return Character(scalar)
  }
}

private struct ShikiHTMLStackEntry {
  var cssVariable: String?
  var isLine: Bool
}
