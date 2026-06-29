import Foundation
import SwiftUI
import WebKit

struct PierrePatchDiffView: View {
  var patch: String
  var fileName: String?

  @State private var contentHeight: CGFloat = 220

  private var patchContents: PierrePatchContents {
    PierrePatchContents(patch: patch, fallbackFileName: fileName)
  }

  var body: some View {
    if patchContents.hasRenderableChanges {
      PierreDiffWebView(
        oldContent: patchContents.oldContent,
        newContent: patchContents.newContent,
        fileName: patchContents.fileName,
        diffStyle: .unified,
        overflowMode: .wrap,
        renderOptions: PierreDiffRenderOptions(
          diffIndicators: .bars,
          hunkSeparators: .lineInfo,
          lineDiffType: .wordAlt,
          disableFileHeader: true,
          maxLineDiffLength: 1000
        ),
        onHeightChange: updateContentHeight
      )
      .frame(height: contentHeight)
      .background(Color(uiColor: .systemBackground), in: .rect(cornerRadius: 12))
      .overlay {
        RoundedRectangle(cornerRadius: 12)
          .stroke(.secondary.opacity(0.18), lineWidth: 1)
      }
      .clipShape(.rect(cornerRadius: 12))
    } else {
      ToolDiffBlockView(patch: patch)
    }
  }

  private func updateContentHeight(_ height: CGFloat) {
    let nextHeight = min(384, max(160, height))
    guard abs(nextHeight - contentHeight) > 1 else { return }

    withAnimation(.smooth(duration: 0.2)) {
      contentHeight = nextHeight
    }
  }
}

private struct PierrePatchContents: Equatable {
  var oldContent: String
  var newContent: String
  var fileName: String

  var hasRenderableChanges: Bool {
    oldContent != newContent || !oldContent.isEmpty || !newContent.isEmpty
  }

  init(patch: String, fallbackFileName: String?) {
    let lines = patch
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .components(separatedBy: "\n")

    var oldLines: [String] = []
    var newLines: [String] = []
    var parsedFileName = fallbackFileName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    var isInsideHunk = false

    for line in lines {
      if parsedFileName.isEmpty {
        parsedFileName = Self.fileName(fromPatchHeaderLine: line)
      }

      if line.hasPrefix("@@") {
        isInsideHunk = true
        continue
      }

      guard isInsideHunk else { continue }
      guard !line.hasPrefix("\\") else { continue }

      if line.hasPrefix("+") && !line.hasPrefix("+++") {
        newLines.append(String(line.dropFirst()))
      } else if line.hasPrefix("-") && !line.hasPrefix("---") {
        oldLines.append(String(line.dropFirst()))
      } else if line.hasPrefix(" ") {
        let contextLine = String(line.dropFirst())
        oldLines.append(contextLine)
        newLines.append(contextLine)
      } else if line.isEmpty {
        oldLines.append("")
        newLines.append("")
      }
    }

    oldContent = oldLines.joined(separator: "\n")
    newContent = newLines.joined(separator: "\n")
    fileName = parsedFileName.isEmpty ? "changes.diff" : parsedFileName
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

private struct PierreDiffWebView: UIViewRepresentable {
  var oldContent: String
  var newContent: String
  var fileName: String
  var diffStyle: PierreDiffStyle
  var overflowMode: PierreOverflowMode
  var renderOptions: PierreDiffRenderOptions
  var onHeightChange: (CGFloat) -> Void

  @Environment(\.colorScheme) private var colorScheme

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.userContentController.add(context.coordinator, name: "diffBridge")

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = context.coordinator
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.backgroundColor = .clear
    webView.scrollView.showsVerticalScrollIndicator = true
    webView.scrollView.showsHorizontalScrollIndicator = true
    webView.scrollView.bounces = false

    context.coordinator.webView = webView
    webView.loadHTMLString(PierreDiffHTMLTemplate.html, baseURL: Bundle.main.resourceURL)

    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    let coordinator = context.coordinator
    coordinator.onHeightChange = onHeightChange
    let theme = colorScheme == .dark ? "dark" : "light"

    let contentChanged = coordinator.lastOldContent != oldContent ||
      coordinator.lastNewContent != newContent ||
      coordinator.lastFileName != fileName
    let styleChanged = coordinator.lastDiffStyle != diffStyle
    let overflowChanged = coordinator.lastOverflowMode != overflowMode
    let themeChanged = coordinator.lastTheme != theme
    let optionsChanged = coordinator.lastRenderOptions != renderOptions

    if contentChanged || styleChanged || overflowChanged || themeChanged || optionsChanged {
      coordinator.lastOldContent = oldContent
      coordinator.lastNewContent = newContent
      coordinator.lastFileName = fileName
      coordinator.lastDiffStyle = diffStyle
      coordinator.lastOverflowMode = overflowMode
      coordinator.lastTheme = theme
      coordinator.lastRenderOptions = renderOptions
      coordinator.renderDiff(
        oldContent: oldContent,
        newContent: newContent,
        fileName: fileName,
        theme: theme,
        diffStyle: diffStyle,
        overflowMode: overflowMode,
        renderOptions: renderOptions
      )
    }
  }

  func makeCoordinator() -> PierreDiffWebViewCoordinator {
    PierreDiffWebViewCoordinator()
  }

  static func dismantleUIView(_ uiView: WKWebView, coordinator: PierreDiffWebViewCoordinator) {
    coordinator.cleanup()
  }
}

@MainActor
private final class PierreDiffWebViewCoordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  weak var webView: WKWebView?
  var onHeightChange: ((CGFloat) -> Void)?

  var lastOldContent: String?
  var lastNewContent: String?
  var lastFileName: String?
  var lastDiffStyle: PierreDiffStyle?
  var lastOverflowMode: PierreOverflowMode?
  var lastTheme: String?
  var lastRenderOptions: PierreDiffRenderOptions?

  private var isReady = false
  private var pendingOperations: [() -> Void] = []

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isReady = true
    executePendingOperations()
  }

  nonisolated func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    Task { @MainActor [weak self] in
      guard let self else { return }

      guard let body = message.body as? [String: Any],
            let type = body["type"] as? String else {
        return
      }

      if type == "bridgeReady" || type == "ready" {
        isReady = true
        executePendingOperations()
        scheduleContentHeightUpdate()
      }
    }
  }

  func renderDiff(
    oldContent: String,
    newContent: String,
    fileName: String,
    theme: String,
    diffStyle: PierreDiffStyle,
    overflowMode: PierreOverflowMode,
    renderOptions: PierreDiffRenderOptions
  ) {
    let input = PierreDiffInput(
      oldFile: PierreDiffInput.FileContents(name: fileName, contents: oldContent),
      newFile: PierreDiffInput.FileContents(name: fileName, contents: newContent),
      options: PierreDiffInput.Options(
        theme: renderOptions.theme.config,
        themeType: theme,
        diffStyle: diffStyle.rawValue,
        overflow: overflowMode.rawValue,
        enableLineSelection: false,
        renderOptions: renderOptions
      )
    )

    executeWhenReady { [weak self] in
      self?.callJavaScript("renderDiff", with: input)
    }
  }

  func cleanup() {
    webView?.stopLoading()
    webView?.navigationDelegate = nil
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "diffBridge")
    webView = nil
    pendingOperations.removeAll()
    onHeightChange = nil
  }

  private func scheduleContentHeightUpdate() {
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 120_000_000)
      self?.requestContentHeight()
    }
  }

  private func requestContentHeight() {
    let script = """
    (function() {
      const container = document.getElementById('diff-container');
      const height = Math.max(
        container ? container.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      return height;
    })();
    """

    webView?.evaluateJavaScript(script) { [weak self] result, _ in
      guard let self else { return }

      let numberValue: Double?
      if let number = result as? NSNumber {
        numberValue = number.doubleValue
      } else if let double = result as? Double {
        numberValue = double
      } else {
        numberValue = nil
      }

      guard let numberValue, numberValue.isFinite else { return }
      self.onHeightChange?(CGFloat(numberValue))
    }
  }

  private func executeWhenReady(_ operation: @escaping () -> Void) {
    if isReady {
      operation()
    } else {
      pendingOperations.append(operation)
    }
  }

  private func executePendingOperations() {
    let operations = pendingOperations
    pendingOperations.removeAll()
    operations.forEach { $0() }
  }

  private func callJavaScript<T: Encodable>(_ method: String, with input: T) {
    do {
      let data = try JSONEncoder().encode(input)
      let base64String = data.base64EncodedString()
      let script = """
      (function() {
        try {
          const decoded = atob('\(base64String)');
          const input = JSON.parse(decoded);
          window.pierreBridge.\(method)(input);
        } catch (error) {
          console.error('Failed to render Pierre diff:', error);
          if (window.webkit?.messageHandlers?.diffBridge) {
            window.webkit.messageHandlers.diffBridge.postMessage({ type: 'error', message: error.message });
          }
        }
      })();
      """
      evaluateJavaScript(script)
    } catch {
      print("PierreDiffWebViewCoordinator: Failed to encode diff input: \(error)")
    }
  }

  private func evaluateJavaScript(_ script: String) {
    webView?.evaluateJavaScript(script) { _, error in
      if let error {
        print("PierreDiffWebViewCoordinator: JavaScript error: \(error)")
      }
    }
  }
}

private struct PierreDiffInput: Codable, Sendable {
  struct FileContents: Codable, Sendable {
    var name: String
    var contents: String
    var lang: String?
  }

  struct Options: Codable, Sendable {
    var theme: PierreDiffThemeConfig
    var themeType: String?
    var diffStyle: String
    var overflow: String
    var enableLineSelection: Bool
    var diffIndicators: String
    var hunkSeparators: String
    var lineDiffType: String
    var disableLineNumbers: Bool
    var disableFileHeader: Bool
    var disableBackground: Bool
    var expandUnchanged: Bool
    var collapsedContextThreshold: Int?
    var maxLineDiffLength: Int?
    var expansionLineCount: Int?
    var tokenizeMaxLength: Int?
    var tokenizeMaxLineLength: Int?
    var stickyHeader: Bool

    init(
      theme: PierreDiffThemeConfig,
      themeType: String?,
      diffStyle: String,
      overflow: String,
      enableLineSelection: Bool,
      renderOptions: PierreDiffRenderOptions
    ) {
      self.theme = theme
      self.themeType = themeType
      self.diffStyle = diffStyle
      self.overflow = overflow
      self.enableLineSelection = enableLineSelection
      diffIndicators = renderOptions.diffIndicators.rawValue
      hunkSeparators = renderOptions.hunkSeparators.rawValue
      lineDiffType = renderOptions.lineDiffType.rawValue
      disableLineNumbers = renderOptions.disableLineNumbers
      disableFileHeader = renderOptions.disableFileHeader
      disableBackground = renderOptions.disableBackground
      expandUnchanged = renderOptions.expandUnchanged
      collapsedContextThreshold = renderOptions.collapsedContextThreshold
      maxLineDiffLength = renderOptions.maxLineDiffLength
      expansionLineCount = renderOptions.expansionLineCount
      tokenizeMaxLength = renderOptions.tokenizeMaxLength
      tokenizeMaxLineLength = renderOptions.tokenizeMaxLineLength
      stickyHeader = renderOptions.stickyHeader
    }
  }

  var oldFile: FileContents
  var newFile: FileContents
  var options: Options
}

private enum PierreDiffStyle: String, Sendable {
  case split
  case unified
}

private enum PierreOverflowMode: String, Sendable {
  case scroll
  case wrap
}

private struct PierreDiffRenderOptions: Equatable, Sendable {
  var theme: PierreDiffTheme = .pierreSoft
  var diffIndicators: PierreDiffIndicatorStyle = .bars
  var hunkSeparators: PierreHunkSeparatorStyle = .lineInfo
  var lineDiffType: PierreLineDiffType = .wordAlt
  var disableLineNumbers = false
  var disableFileHeader = false
  var disableBackground = false
  var expandUnchanged = false
  var collapsedContextThreshold: Int?
  var maxLineDiffLength: Int?
  var expansionLineCount: Int?
  var tokenizeMaxLength: Int?
  var tokenizeMaxLineLength: Int?
  var stickyHeader = false
}

private enum PierreDiffTheme: Equatable, Sendable {
  case pierre
  case pierreSoft

  var config: PierreDiffThemeConfig {
    switch self {
    case .pierre:
      PierreDiffThemeConfig(dark: "pierre-dark", light: "pierre-light")
    case .pierreSoft:
      PierreDiffThemeConfig(dark: "pierre-dark-soft", light: "pierre-light-soft")
    }
  }
}

private struct PierreDiffThemeConfig: Codable, Equatable, Sendable {
  var dark: String
  var light: String
}

private enum PierreDiffIndicatorStyle: String, Sendable {
  case classic
  case bars
  case none
}

private enum PierreLineDiffType: String, Sendable {
  case wordAlt = "word-alt"
  case word
  case char
  case none
}

private enum PierreHunkSeparatorStyle: String, Sendable {
  case simple
  case metadata
  case lineInfo = "line-info"
  case lineInfoBasic = "line-info-basic"
}

private enum PierreDiffHTMLTemplate {
  static let html: String = {
    let bundleJS = loadBundledJavaScript()

    return """
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        \(styles)
      </style>
    </head>
    <body>
      <div id="diff-container"></div>
      <script>
        \(bundleJS)
      </script>
    </body>
    </html>
    """
  }()

  private static func loadBundledJavaScript() -> String {
    let urls = [
      Bundle.main.url(forResource: "pierre-diffs-bundle", withExtension: "js", subdirectory: "Resources"),
      Bundle.main.url(forResource: "pierre-diffs-bundle", withExtension: "js"),
    ]

    guard let url = urls.compactMap({ $0 }).first,
          let content = try? String(contentsOf: url, encoding: .utf8) else {
      return fallbackJavaScript
    }

    return content
  }

  private static let fallbackJavaScript = """
  window.pierreBridge = {
    renderDiff: function() {
      const container = document.getElementById('diff-container');
      container.innerHTML = '<div style="color: red; padding: 16px; font-family: -apple-system, sans-serif;">Failed to load Pierre diff renderer.</div>';
      if (window.webkit?.messageHandlers?.diffBridge) {
        window.webkit.messageHandlers.diffBridge.postMessage({ type: 'error', message: 'Bundle not loaded' });
      }
    }
  };
  """

  private static let styles = """
  * {
    box-sizing: border-box;
  }

  :root {
    --diffs-font-family: ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
    --diffs-font-size: 12px;
    --diffs-line-height: 1.5;
    --diffs-tab-size: 2;
    --diffs-header-font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    --diffs-min-number-column-width: 4ch;
  }

  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: transparent;
    font-family: var(--diffs-font-family);
    font-size: var(--diffs-font-size);
    line-height: var(--diffs-line-height);
    -webkit-font-smoothing: antialiased;
  }

  #diff-container {
    width: 100%;
    height: 100%;
    overflow: auto;
    background: transparent;
  }

  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background-color: rgba(128, 128, 128, 0.3);
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(128, 128, 128, 0.5);
  }

  ::selection {
    background-color: rgba(59, 130, 246, 0.3);
  }
  """
}
