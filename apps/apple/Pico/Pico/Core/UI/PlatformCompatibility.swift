import SwiftUI

#if os(macOS)
  import AppKit
#endif

enum PicoNavigationTitleDisplayMode {
  case inline
  case large
}

enum PicoTextInputAutocapitalization {
  case never
  case sentences
}

enum PicoGlassButtonProminence {
  case regular
  case prominent
}

enum PicoGlassButtonShape {
  case automatic
  case capsule
  case circle
}

extension ToolbarItemPlacement {
  static var picoLeading: ToolbarItemPlacement {
    #if os(macOS)
      .navigation
    #else
      .topBarLeading
    #endif
  }

  static var picoTrailing: ToolbarItemPlacement {
    #if os(macOS)
      .automatic
    #else
      .topBarTrailing
    #endif
  }
}

extension View {
  @ViewBuilder
  func picoNavigationTitleDisplayMode(
    _ mode: PicoNavigationTitleDisplayMode
  ) -> some View {
    #if os(iOS)
      switch mode {
      case .inline:
        navigationBarTitleDisplayMode(.inline)
      case .large:
        navigationBarTitleDisplayMode(.large)
      }
    #else
      self
    #endif
  }

  @ViewBuilder
  func picoTextInputAutocapitalization(
    _ behavior: PicoTextInputAutocapitalization
  ) -> some View {
    #if os(iOS)
      switch behavior {
      case .never:
        textInputAutocapitalization(.never)
      case .sentences:
        textInputAutocapitalization(.sentences)
      }
    #else
      self
    #endif
  }

  @ViewBuilder
  func picoListSectionSpacing(_ spacing: CGFloat) -> some View {
    #if os(iOS)
      listSectionSpacing(spacing)
    #else
      self
    #endif
  }

  @ViewBuilder
  func picoURLInputTraits() -> some View {
    #if os(iOS)
      keyboardType(.URL)
        .textContentType(.URL)
        .submitLabel(.go)
    #else
      self
    #endif
  }

  @ViewBuilder
  func picoNavigationToolbarBackgroundHidden() -> some View {
    #if os(iOS)
      toolbarBackgroundVisibility(.hidden, for: .navigationBar)
    #else
      self
    #endif
  }

  @ViewBuilder
  func picoGlassEffect<S: Shape>(in shape: S) -> some View {
    #if os(macOS)
      if #available(macOS 26.0, *) {
        glassEffect(.regular, in: shape)
      } else {
        background(.regularMaterial, in: shape)
      }
    #else
      glassEffect(.regular, in: shape)
    #endif
  }

  @ViewBuilder
  func picoGlassButtonStyle(
    _ prominence: PicoGlassButtonProminence = .regular,
    shape: PicoGlassButtonShape = .automatic
  ) -> some View {
    #if os(macOS)
      if #available(macOS 26.0, *) {
        picoModernGlassButtonStyle(prominence, shape: shape)
      } else if prominence == .prominent {
        buttonStyle(.borderedProminent)
      } else {
        picoLegacyGlassButtonStyle(shape: shape)
      }
    #else
      picoModernGlassButtonStyle(prominence, shape: shape)
    #endif
  }

  #if os(macOS)
    @ViewBuilder
    private func picoLegacyGlassButtonStyle(
      shape: PicoGlassButtonShape
    ) -> some View {
      switch shape {
      case .automatic:
        buttonStyle(.plain)
      case .capsule:
        buttonStyle(.plain)
          .background(.regularMaterial, in: Capsule())
          .overlay {
            Capsule()
              .stroke(.separator.opacity(0.35), lineWidth: 0.5)
          }
      case .circle:
        buttonStyle(.plain)
          .background(.regularMaterial, in: Circle())
          .overlay {
            Circle()
              .stroke(.separator.opacity(0.35), lineWidth: 0.5)
          }
      }
    }
  #endif

  @available(iOS 26.0, macOS 26.0, *)
  @ViewBuilder
  private func picoModernGlassButtonStyle(
    _ prominence: PicoGlassButtonProminence,
    shape: PicoGlassButtonShape
  ) -> some View {
    switch (prominence, shape) {
    case (.regular, .automatic):
      buttonStyle(.glass)
    case (.regular, .capsule):
      buttonStyle(.glass)
        .buttonBorderShape(.capsule)
    case (.regular, .circle):
      buttonStyle(.glass)
        .buttonBorderShape(.circle)
    case (.prominent, .automatic):
      buttonStyle(.glassProminent)
    case (.prominent, .capsule):
      buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
    case (.prominent, .circle):
      buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
    }
  }

  @ViewBuilder
  func picoBottomSafeAreaBar<Content: View>(
    @ViewBuilder content: () -> Content
  ) -> some View {
    #if os(macOS)
      if #available(macOS 26.0, *) {
        safeAreaBar(edge: .bottom, alignment: .center, content: content)
      } else {
        safeAreaInset(edge: .bottom, alignment: .center, content: content)
      }
    #else
      safeAreaBar(edge: .bottom, alignment: .center, content: content)
    #endif
  }
}

#if os(macOS)
  typealias UIColor = NSColor
  typealias UIImage = NSImage
  typealias UIFont = NSFont

  extension Color {
    init(uiColor: NSColor) {
      self.init(nsColor: uiColor)
    }
  }

  extension Image {
    init(uiImage: NSImage) {
      self.init(nsImage: uiImage)
    }
  }

  extension NSColor {
    static var systemGroupedBackground: NSColor { .windowBackgroundColor }
    static var secondarySystemGroupedBackground: NSColor { .controlBackgroundColor }
    static var tertiarySystemGroupedBackground: NSColor { .underPageBackgroundColor }
    static var systemBackground: NSColor { .textBackgroundColor }
    static var secondarySystemBackground: NSColor { .controlBackgroundColor }
    static var separator: NSColor { .separatorColor }
  }

  @MainActor
  final class UIPasteboard {
    static let general = UIPasteboard()

    var string: String? {
      get {
        NSPasteboard.general.string(forType: .string)
      }
      set {
        NSPasteboard.general.clearContents()
        if let newValue {
          NSPasteboard.general.setString(newValue, forType: .string)
        }
      }
    }
  }

  @MainActor
  final class UIApplication {
    static let shared = UIApplication()

    func open(
      _ url: URL,
      options: [String: Any] = [:],
      completionHandler: ((Bool) -> Void)? = nil
    ) {
      completionHandler?(NSWorkspace.shared.open(url))
    }
  }
#endif
