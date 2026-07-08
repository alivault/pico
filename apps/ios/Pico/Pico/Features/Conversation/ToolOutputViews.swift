import SwiftUI
import UIKit

struct ToolBlockBodyView: View {
  var model: AppModel?
  var block: ToolBlock

  var body: some View {
    switch block.name {
    case "bash":
      BashToolOutputView(block: block)
    case "write":
      WriteToolOutputView(model: model, block: block)
    case "edit":
      EditToolOutputView(model: model, block: block)
    default:
      GenericToolOutputView(block: block)
    }
  }
}

private struct BashToolOutputView: View {
  var block: ToolBlock

  private var shellBodyText: String {
    let callText = ToolFormatting.callText(for: block)
    let output = block.output.trimmingTrailingNewlines()
    let joined = [callText, output]
      .filter { !$0.isEmpty }
      .joined(separator: "\n\n")

    return joined.isEmpty ? ToolFormatting.outputText(for: block) : joined
  }

  var body: some View {
    ToolScrollableOutput(
      autoScroll: block.running,
      contentKey: shellBodyText
    ) {
      AnsiText(text: shellBodyText)
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(block.isError ? .red : .primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
    .toolOutputBox(isError: block.isError)
  }
}

private struct WriteToolOutputView: View {
  var model: AppModel?
  var block: ToolBlock

  private var payload: ToolWritePayload? {
    ToolFormatting.writePayload(for: block)
  }

  private var extraOutput: String {
    ToolFormatting.writeOutputWithoutSuccessMessage(block.output.trimmingTrailingNewlines())
  }

  var body: some View {
    if block.isError {
      PlainToolOutput(
        text: extraOutput.isEmpty ? block.output.trimmingTrailingNewlines() : extraOutput,
        isError: true,
        autoScroll: block.running
      )
    } else if let payload, let content = payload.content {
      VStack(alignment: .leading, spacing: 10) {
        ToolCodeBlockView(
          model: model,
          code: content,
          path: payload.path,
          language: ToolFormatting.codeLanguage(fromPath: payload.path),
          autoScroll: block.running
        )

        if !extraOutput.isEmpty {
          PlainToolOutput(text: extraOutput, isError: block.isError)
        }
      }
    } else {
      PlainToolOutput(text: ToolFormatting.outputText(for: block), isError: block.isError)
    }
  }
}

private struct EditToolOutputView: View {
  var model: AppModel?
  var block: ToolBlock

  private var patch: String {
    ToolFormatting.patchText(for: block)
  }

  private var extraOutput: String {
    let output = ToolFormatting.editOutputWithoutSuccessMessage(
      block.output.trimmingTrailingNewlines()
    )
    return output == patch ? "" : output
  }

  private var fallbackOutput: String {
    let output = ToolFormatting.outputText(for: block)
    let cleanedOutput = ToolFormatting.editOutputWithoutSuccessMessage(output)
    return cleanedOutput.isEmpty ? output : cleanedOutput
  }

  var body: some View {
    if patch.isEmpty {
      PlainToolOutput(
        text: fallbackOutput,
        isError: block.isError,
        autoScroll: block.running
      )
    } else {
      VStack(alignment: .leading, spacing: 10) {
        PierrePatchDiffView(
          model: model,
          patch: patch,
          fileName: ToolFormatting.summary(for: block),
          isStreaming: block.running
        )

        if !extraOutput.isEmpty {
          PlainToolOutput(text: extraOutput, isError: block.isError)
        }
      }
    }
  }
}

private struct GenericToolOutputView: View {
  var block: ToolBlock

  private var callText: String {
    ToolFormatting.callText(for: block)
  }

  private var outputText: String {
    ToolFormatting.outputText(for: block)
  }

  private var contentKey: String {
    [callText, outputText].joined(separator: "\n\n")
  }

  var body: some View {
    ToolScrollableOutput(autoScroll: block.running, contentKey: contentKey) {
      VStack(alignment: .leading, spacing: 12) {
        if !callText.isEmpty {
          ToolBlockSection(label: "Call") {
            PlainToolText(text: callText)
          }
        }

        ToolBlockSection(label: block.running ? "Output (streaming)" : "Output") {
          PlainToolText(text: outputText, isError: block.isError)
        }
      }
    }
    .toolOutputBox(isError: block.isError)
  }
}

private struct ToolBlockSection<Content: View>: View {
  var label: String
  var content: () -> Content

  init(label: String, @ViewBuilder content: @escaping () -> Content) {
    self.label = label
    self.content = content
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .textCase(.uppercase)
        .tracking(0.6)

      content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct PlainToolOutput: View {
  var text: String
  var isError = false
  var autoScroll = false

  var body: some View {
    ToolScrollableOutput(autoScroll: autoScroll, contentKey: text) {
      PlainToolText(text: text, isError: isError)
    }
    .toolOutputBox(isError: isError)
  }
}

private struct PlainToolText: View {
  var text: String
  var isError = false

  var body: some View {
    Text(verbatim: text.isEmpty ? " " : text)
      .font(.system(.caption, design: .monospaced))
      .foregroundStyle(isError ? .red : .primary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .textSelection(.enabled)
  }
}

private struct ToolScrollableOutput<Content: View>: View {
  private let bottomAnchorId = "tool-output-bottom"

  var autoScroll: Bool
  var contentKey: String
  var content: () -> Content

  @State private var followsLatestContent = true

  init(
    autoScroll: Bool,
    contentKey: String,
    @ViewBuilder content: @escaping () -> Content
  ) {
    self.autoScroll = autoScroll
    self.contentKey = contentKey
    self.content = content
  }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        content()
          .padding(10)

        Color.clear
          .frame(height: 1)
          .id(bottomAnchorId)
      }
      .frame(maxHeight: 384)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        Self.isNearBottom(geometry)
      } action: { _, isNearBottom in
        followsLatestContent = isNearBottom
      }
      .onAppear {
        guard autoScroll else { return }
        scrollToBottom(proxy)
      }
      .onChange(of: contentKey) {
        guard autoScroll, followsLatestContent else { return }
        scrollToBottom(proxy)
      }
    }
  }

  private static func isNearBottom(_ geometry: ScrollGeometry) -> Bool {
    let bottomDistance = geometry.contentSize.height - geometry.visibleRect.maxY
    return bottomDistance < 8
  }

  private func scrollToBottom(_ proxy: ScrollViewProxy) {
    withAnimation(.smooth(duration: 0.2)) {
      proxy.scrollTo(bottomAnchorId, anchor: .bottom)
    }
  }
}

private struct ToolCodeBlockView: View {
  private static let bottomAnchorId = "tool-code-bottom"

  var model: AppModel?
  var code: String
  var path: String?
  var language: String?
  var autoScroll: Bool

  @Environment(\.colorScheme) private var colorScheme
  @State private var copied = false
  @State private var followsLatestContent = true
  @State private var highlight: CodeHighlightResult?
  @State private var highlightingRequestID: String?

  private var codeLanguage: CodeFileLanguage? {
    if let path,
       let detectedLanguage = CodeFileLanguageDetector.detect(path: path) {
      return detectedLanguage
    }

    guard let language, !language.isEmpty, language != "plaintext" else {
      return nil
    }
    return CodeFileLanguage(shikiLanguage: language, displayName: language)
  }

  private var highlightRequestID: String? {
    guard !autoScroll,
          model != nil,
          let codeLanguage,
          !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return nil
    }

    return "\(path ?? "")\u{0}\(codeLanguage.shikiLanguage)\u{0}\(code.count)\u{0}\(code.hashValue)"
  }

  private var attributedCode: AttributedString {
    CodeAttributedStringBuilder.makeSwiftUI(
      content: code,
      highlight: highlight?.isHighlighted == true ? highlight : nil,
      palette: CodeSyntaxPalette(colorScheme: colorScheme)
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        if let displayLanguage = codeLanguage?.displayName ?? language,
           !displayLanguage.isEmpty {
          Text(displayLanguage)
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
        }

        Spacer(minLength: 12)

        Button {
          copyCode()
        } label: {
          Label(copied ? "Copied" : "Copy", picoSystemImage: copied ? "checkmark" : "doc.on.doc")
            .labelStyle(.titleAndIcon)
        }
        .buttonStyle(.borderless)
        .font(.caption)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)

      Divider()

      ScrollViewReader { proxy in
        ScrollView(.vertical) {
          ScrollView(.horizontal) {
            Text(attributedCode)
              .font(.system(.caption, design: .monospaced))
              .padding(12)
              .fixedSize(horizontal: true, vertical: true)
              .textSelection(.enabled)
          }

          Color.clear
            .frame(height: 1)
            .id(Self.bottomAnchorId)
        }
        .frame(maxHeight: 384)
        .onScrollGeometryChange(for: Bool.self) { geometry in
          Self.isNearBottom(geometry)
        } action: { _, isNearBottom in
          followsLatestContent = isNearBottom
        }
        .onAppear {
          guard autoScroll else { return }
          scrollToBottom(proxy)
        }
        .onChange(of: code) {
          guard autoScroll, followsLatestContent else { return }
          scrollToBottom(proxy)
        }
      }
    }
    .task(id: highlightRequestID) {
      await loadHighlightIfNeeded()
    }
    .background(.background, in: .rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .stroke(.secondary.opacity(0.18), lineWidth: 1)
    }
  }

  private func loadHighlightIfNeeded() async {
    guard let requestID = highlightRequestID,
          let model,
          let codeLanguage,
          highlight?.requestID != requestID else {
      return
    }

    let requestedCode = code
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

  private static func isNearBottom(_ geometry: ScrollGeometry) -> Bool {
    let bottomDistance = geometry.contentSize.height - geometry.visibleRect.maxY
    return bottomDistance < 8
  }

  private func scrollToBottom(_ proxy: ScrollViewProxy) {
    withAnimation(.smooth(duration: 0.2)) {
      proxy.scrollTo(Self.bottomAnchorId, anchor: .bottom)
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

private struct ToolOutputBoxModifier: ViewModifier {
  var isError: Bool

  func body(content: Content) -> some View {
    content
      .background(Color(uiColor: .systemBackground).opacity(0.82), in: .rect(cornerRadius: 12))
      .overlay {
        RoundedRectangle(cornerRadius: 12)
          .stroke(isError ? .red.opacity(0.22) : .secondary.opacity(0.16), lineWidth: 1)
      }
  }
}

private extension View {
  func toolOutputBox(isError: Bool = false) -> some View {
    modifier(ToolOutputBoxModifier(isError: isError))
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

