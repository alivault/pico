import SwiftUI

struct AnsiText: View {
  var text: String

  var body: some View {
    ansiSegments.reduce(Text("")) { partial, segment in
      partial + segment.textView
    }
  }

  private var ansiSegments: [AnsiTextSegment] {
    AnsiParser.parse(text)
  }
}

private struct AnsiTextSegment: Equatable, Sendable {
  var text: String
  var style: AnsiStyleState?

  var textView: Text {
    var view = Text(verbatim: text)

    if style?.bold == true {
      view = view.bold()
    }

    if style?.italic == true {
      view = view.italic()
    }

    if style?.underline == true {
      view = view.underline()
    }

    if let foreground = style?.foreground {
      let color = foreground.color.opacity(style?.dim == true ? 0.72 : 1)
      view = view.foregroundColor(color)
    } else if style?.dim == true {
      view = view.foregroundColor(.secondary)
    }

    return view
  }
}

private struct AnsiStyleState: Equatable, Sendable {
  var bold = false
  var dim = false
  var italic = false
  var underline = false
  var foreground: AnsiColor?
  var background: AnsiColor?

  var isDefault: Bool {
    !bold && !dim && !italic && !underline && foreground == nil && background == nil
  }
}

private struct AnsiColor: Equatable, Sendable {
  var red: Double
  var green: Double
  var blue: Double

  var color: Color {
    Color(red: red / 255, green: green / 255, blue: blue / 255)
  }
}

private struct ParsedAnsiSequence: Sendable {
  var kind: Kind
  var end: String.Index
  var params: String?

  enum Kind {
    case sgr
    case control
  }
}

private enum AnsiParser {
  private static let colors16: [AnsiColor] = [
    AnsiColor(red: 63, green: 63, blue: 70),
    AnsiColor(red: 239, green: 68, blue: 68),
    AnsiColor(red: 34, green: 197, blue: 94),
    AnsiColor(red: 234, green: 179, blue: 8),
    AnsiColor(red: 59, green: 130, blue: 246),
    AnsiColor(red: 217, green: 70, blue: 239),
    AnsiColor(red: 6, green: 182, blue: 212),
    AnsiColor(red: 228, green: 228, blue: 231),
    AnsiColor(red: 113, green: 113, blue: 122),
    AnsiColor(red: 248, green: 113, blue: 113),
    AnsiColor(red: 74, green: 222, blue: 128),
    AnsiColor(red: 250, green: 204, blue: 21),
    AnsiColor(red: 96, green: 165, blue: 250),
    AnsiColor(red: 232, green: 121, blue: 249),
    AnsiColor(red: 34, green: 211, blue: 238),
    AnsiColor(red: 250, green: 250, blue: 250),
  ]

  static func parse(_ text: String) -> [AnsiTextSegment] {
    var segments: [AnsiTextSegment] = []
    var style = AnsiStyleState()
    var index = text.startIndex

    while index < text.endIndex {
      guard let escapeIndex = findNextAnsiSequenceIndex(in: text, from: index) else {
        pushSegment(String(text[index...]), style: style, into: &segments)
        break
      }

      if escapeIndex > index {
        pushSegment(String(text[index..<escapeIndex]), style: style, into: &segments)
      }

      guard let sequence = parseSequence(in: text, at: escapeIndex) else {
        index = text.index(after: escapeIndex)
        continue
      }

      if sequence.kind == .sgr {
        applySgrCodes(parseSgrParams(sequence.params), to: &style)
      }

      index = sequence.end
    }

    return segments
  }

  private static func pushSegment(
    _ text: String,
    style: AnsiStyleState,
    into segments: inout [AnsiTextSegment]
  ) {
    guard !text.isEmpty else { return }

    let nextStyle = style.isDefault ? nil : style
    if let lastSegment = segments.last,
       lastSegment.style == nextStyle {
      segments[segments.count - 1].text += text
      return
    }

    segments.append(AnsiTextSegment(text: text, style: nextStyle))
  }

  private static func findNextAnsiSequenceIndex(
    in text: String,
    from startIndex: String.Index
  ) -> String.Index? {
    var index = startIndex
    while index < text.endIndex {
      if text[index].unicodeScalars.first?.value == 0x1B ||
        text[index].unicodeScalars.first?.value == 0x9B {
        return index
      }

      index = text.index(after: index)
    }

    return nil
  }

  private static func parseSequence(
    in text: String,
    at index: String.Index
  ) -> ParsedAnsiSequence? {
    let scalarValue = text[index].unicodeScalars.first?.value
    if scalarValue == 0x9B {
      return parseCSISequence(in: text, start: index, paramsStart: text.index(after: index))
    }

    guard scalarValue == 0x1B else { return nil }
    let introducerIndex = text.index(after: index)
    guard introducerIndex < text.endIndex else {
      return ParsedAnsiSequence(kind: .control, end: text.endIndex)
    }

    let introducer = text[introducerIndex]
    if introducer == "[" {
      return parseCSISequence(
        in: text,
        start: index,
        paramsStart: text.index(after: introducerIndex)
      )
    }

    if introducer == "]" {
      return ParsedAnsiSequence(
        kind: .control,
        end: controlSequenceEnd(in: text, from: text.index(after: introducerIndex))
      )
    }

    return ParsedAnsiSequence(
      kind: .control,
      end: text.index(after: introducerIndex)
    )
  }

  private static func parseCSISequence(
    in text: String,
    start: String.Index,
    paramsStart: String.Index
  ) -> ParsedAnsiSequence {
    var index = paramsStart

    while index < text.endIndex {
      let scalarValue = text[index].unicodeScalars.first?.value ?? 0
      if scalarValue >= 0x40 && scalarValue <= 0x7E {
        let final = text[index]
        return ParsedAnsiSequence(
          kind: final == "m" ? .sgr : .control,
          end: text.index(after: index),
          params: String(text[paramsStart..<index])
        )
      }

      index = text.index(after: index)
    }

    return ParsedAnsiSequence(kind: .control, end: text.index(after: start))
  }

  private static func controlSequenceEnd(
    in text: String,
    from startIndex: String.Index
  ) -> String.Index {
    var index = startIndex

    while index < text.endIndex {
      let scalarValue = text[index].unicodeScalars.first?.value
      if scalarValue == 0x07 {
        return text.index(after: index)
      }

      if scalarValue == 0x1B {
        let nextIndex = text.index(after: index)
        if nextIndex < text.endIndex, text[nextIndex] == "\\" {
          return text.index(after: nextIndex)
        }
      }

      index = text.index(after: index)
    }

    return text.endIndex
  }

  private static func parseSgrParams(_ params: String?) -> [Int] {
    guard let params, !params.isEmpty else { return [0] }

    return params
      .replacingOccurrences(of: ":", with: ";")
      .components(separatedBy: ";")
      .map { value in
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedValue.isEmpty || trimmedValue.hasPrefix("?") {
          return 0
        }

        return Int(trimmedValue) ?? 0
      }
  }

  private static func applySgrCodes(_ codes: [Int], to style: inout AnsiStyleState) {
    var index = 0

    while index < codes.count {
      let code = codes[index]

      switch code {
      case 0:
        style = AnsiStyleState()
      case 1:
        style.bold = true
      case 2:
        style.dim = true
      case 3:
        style.italic = true
      case 4:
        style.underline = true
      case 22:
        style.bold = false
        style.dim = false
      case 23:
        style.italic = false
      case 24:
        style.underline = false
      case 39:
        style.foreground = nil
      case 49:
        style.background = nil
      case 30...37:
        style.foreground = colors16[code - 30]
      case 40...47:
        style.background = colors16[code - 40]
      case 90...97:
        style.foreground = colors16[8 + code - 90]
      case 100...107:
        style.background = colors16[8 + code - 100]
      case 38, 48:
        let extendedColor = readExtendedColor(codes, at: index)
        if let color = extendedColor.color {
          if code == 38 {
            style.foreground = color
          } else {
            style.background = color
          }
        }
        index = extendedColor.nextIndex
      default:
        break
      }

      index += 1
    }
  }

  private static func readExtendedColor(
    _ codes: [Int],
    at index: Int
  ) -> (color: AnsiColor?, nextIndex: Int) {
    guard index + 1 < codes.count else { return (nil, index) }

    let mode = codes[index + 1]
    if mode == 5, index + 2 < codes.count {
      return (ansi256ToColor(codes[index + 2]), index + 2)
    }

    if mode == 2, index + 4 < codes.count {
      let red = codes[index + 2]
      let green = codes[index + 3]
      let blue = codes[index + 4]
      if [red, green, blue].allSatisfy({ (0...255).contains($0) }) {
        return (
          AnsiColor(red: Double(red), green: Double(green), blue: Double(blue)),
          index + 4
        )
      }
    }

    return (nil, index)
  }

  private static func ansi256ToColor(_ value: Int) -> AnsiColor? {
    if (0..<16).contains(value) {
      return colors16[value]
    }

    if (16...231).contains(value) {
      let offset = value - 16
      let red = offset / 36
      let green = (offset % 36) / 6
      let blue = offset % 6

      func channel(_ value: Int) -> Double {
        value == 0 ? 0 : Double(55 + value * 40)
      }

      return AnsiColor(
        red: channel(red),
        green: channel(green),
        blue: channel(blue)
      )
    }

    if (232...255).contains(value) {
      let channel = Double(8 + (value - 232) * 10)
      return AnsiColor(red: channel, green: channel, blue: channel)
    }

    return nil
  }
}

