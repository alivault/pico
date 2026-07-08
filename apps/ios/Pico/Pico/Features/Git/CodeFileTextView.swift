import SwiftUI
import UIKit

struct CodeFileTextView: View {
  var path: String
  var content: String
  var language: CodeFileLanguage
  var highlight: CodeHighlightResult?
  var isHighlighting: Bool

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    ZStack(alignment: .topTrailing) {
      CodeFileNativeTextView(
        path: path,
        content: content,
        language: language,
        highlight: highlight,
        colorScheme: colorScheme
      )

      if isHighlighting && highlight?.isHighlighted != true {
        Label("Highlighting", picoSystemImage: "sparkles")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .glassEffect(.regular, in: Capsule())
          .padding(10)
          .accessibilityLabel("Highlighting code")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct CodeFileNativeTextView: UIViewRepresentable {
  var path: String
  var content: String
  var language: CodeFileLanguage
  var highlight: CodeHighlightResult?
  var colorScheme: ColorScheme

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeUIView(context: Context) -> UITextView {
    let textView = UITextView()
    textView.isEditable = false
    textView.isSelectable = true
    textView.isScrollEnabled = true
    textView.backgroundColor = .clear
    textView.textContainerInset = UIEdgeInsets(
      top: 12,
      left: 12,
      bottom: 12,
      right: 12
    )
    textView.textContainer.lineFragmentPadding = 0
    textView.textContainer.lineBreakMode = .byClipping
    textView.textContainer.widthTracksTextView = false
    textView.textContainer.heightTracksTextView = false
    textView.textContainer.size = CGSize(
      width: CGFloat.greatestFiniteMagnitude,
      height: CGFloat.greatestFiniteMagnitude
    )
    textView.alwaysBounceHorizontal = true
    textView.alwaysBounceVertical = true
    textView.showsHorizontalScrollIndicator = true
    textView.showsVerticalScrollIndicator = true
    textView.keyboardDismissMode = .interactive
    textView.autocorrectionType = .no
    textView.spellCheckingType = .no
    textView.smartDashesType = .no
    textView.smartQuotesType = .no
    textView.smartInsertDeleteType = .no
    return textView
  }

  func updateUIView(_ textView: UITextView, context: Context) {
    let renderID = renderID
    guard context.coordinator.renderID != renderID else { return }

    let previousOffset = textView.contentOffset
    let previousSelection = textView.selectedRange
    let hadRenderedContent = context.coordinator.renderID != nil

    textView.attributedText = CodeAttributedStringBuilder.make(
      content: content,
      highlight: highlight?.isHighlighted == true ? highlight : nil,
      palette: CodeSyntaxPalette(colorScheme: colorScheme)
    )

    let textLength = textView.attributedText.length
    if previousSelection.location <= textLength {
      textView.selectedRange = NSRange(
        location: previousSelection.location,
        length: min(
          previousSelection.length,
          textLength - previousSelection.location
        )
      )
    }

    if hadRenderedContent {
      textView.setContentOffset(previousOffset, animated: false)
    }

    context.coordinator.renderID = renderID
  }

  private var renderID: String {
    let styleID = colorScheme == .dark ? "dark" : "light"
    if let highlight, highlight.isHighlighted {
      return "\(styleID):\(language.shikiLanguage):highlight:\(highlight.requestID)"
    }

    return "\(styleID):\(language.shikiLanguage):plain:\(path):\(content.count):\(content.hashValue)"
  }

  final class Coordinator {
    var renderID: String?
  }
}
