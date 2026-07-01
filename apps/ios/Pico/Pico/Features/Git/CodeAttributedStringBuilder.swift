import SwiftUI
import UIKit

enum CodeAttributedStringBuilder {
  @MainActor
  static func make(
    content: String,
    highlight: CodeHighlightResult?,
    palette: CodeSyntaxPalette
  ) -> NSAttributedString {
    guard let html = highlight?.html, !html.isEmpty else {
      return NSAttributedString(
        string: content,
        attributes: baseAttributes(palette: palette)
      )
    }

    let highlightedString = NSMutableAttributedString()
    for segment in ShikiHighlightedHTMLParser.parse(html) {
      var attributes = baseAttributes(palette: palette)
      attributes[.foregroundColor] = palette.color(
        forCSSVariable: segment.cssVariable
      )
      highlightedString.append(
        NSAttributedString(string: segment.text, attributes: attributes)
      )
    }

    return highlightedString
  }

  static func makeSwiftUI(
    content: String,
    highlight: CodeHighlightResult?,
    palette: CodeSyntaxPalette
  ) -> AttributedString {
    guard let html = highlight?.html, !html.isEmpty else {
      var attributed = AttributedString(content.isEmpty ? " " : content)
      attributed.foregroundColor = Color(uiColor: palette.foreground)
      return attributed
    }

    var highlightedString = AttributedString()
    for segment in ShikiHighlightedHTMLParser.parse(html) {
      var attributedSegment = AttributedString(segment.text)
      attributedSegment.foregroundColor = Color(
        uiColor: palette.color(forCSSVariable: segment.cssVariable)
      )
      highlightedString.append(attributedSegment)
    }

    return highlightedString
  }

  @MainActor
  private static func baseAttributes(
    palette: CodeSyntaxPalette
  ) -> [NSAttributedString.Key: Any] {
    let paragraphStyle = NSMutableParagraphStyle()
    paragraphStyle.lineBreakMode = .byClipping
    paragraphStyle.lineSpacing = 1.5

    return [
      .font: UIFont.monospacedSystemFont(ofSize: 12, weight: .regular),
      .foregroundColor: palette.foreground,
      .paragraphStyle: paragraphStyle,
    ]
  }
}
