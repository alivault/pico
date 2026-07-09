import SwiftUI
import UIKit

struct AppToastView: View {
  var toast: AppToast
  var onDismiss: () -> Void
  var onOpenDetails: ((AppToast) -> Void)?

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      if canOpenDetails {
        Button {
          onOpenDetails?(toast)
        } label: {
          toastContent
        }
        .buttonStyle(.plain)
        .accessibilityLabel(toast.accessibilityText)
        .accessibilityHint("Opens the full error details.")
      } else {
        toastContent
          .accessibilityElement(children: .combine)
          .accessibilityLabel(toast.accessibilityText)
      }

      Button {
        onDismiss()
      } label: {
        Image(systemName: "xmark")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.secondary)
          .frame(width: 28, height: 28)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Dismiss notification")
    }
    .padding(.vertical, 12)
    .padding(.leading, 14)
    .padding(.trailing, 10)
    .frame(maxWidth: 520, alignment: .leading)
    .background(
      .regularMaterial,
      in: RoundedRectangle(cornerRadius: 18, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .strokeBorder(toast.style.tint.opacity(0.28), lineWidth: 1)
    }
    .shadow(color: .black.opacity(0.18), radius: 18, x: 0, y: 8)
  }

  private var canOpenDetails: Bool {
    toast.style == .error && onOpenDetails != nil
  }

  private var toastContent: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: toast.style.systemImageName)
        .font(.headline)
        .foregroundStyle(toast.style.tint)
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 3) {
        Text(toast.title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)

        if let message = toast.displayMessage {
          Text(message)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(3)
        }

        if canOpenDetails {
          Text("Tap for full error details")
            .font(.caption)
            .foregroundStyle(toast.style.tint)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .contentShape(Rectangle())
  }
}

private struct AppToastPresenter: ViewModifier {
  var toast: AppToast?
  var dismiss: (UUID) -> Void

  @State private var detailedToast: AppToast?

  func body(content: Content) -> some View {
    content
      .overlay(alignment: .bottom) {
        if let toast {
          AppToastView(
            toast: toast,
            onDismiss: {
              dismiss(toast.id)
            },
            onOpenDetails: { toast in
              detailedToast = toast
              dismiss(toast.id)
            }
          )
          .padding(.horizontal, 16)
          .padding(.bottom, 16)
          .transition(.move(edge: .bottom).combined(with: .opacity))
        }
      }
      .animation(.snappy(duration: 0.22), value: toast?.id)
      .sheet(item: $detailedToast) { toast in
        AppToastDetailSheetView(toast: toast)
          .presentationDetents([.medium, .large])
      }
  }
}

extension View {
  func picoToast(
    toast: AppToast?,
    dismiss: @escaping (UUID) -> Void
  ) -> some View {
    modifier(AppToastPresenter(toast: toast, dismiss: dismiss))
  }
}

private struct AppToastDetailSheetView: View {
  var toast: AppToast

  @Environment(\.dismiss) private var dismiss
  @State private var copied = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Label(toast.title, systemImage: toast.style.systemImageName)
            .font(.headline)
            .foregroundStyle(toast.style.tint)

          VStack(alignment: .leading, spacing: 8) {
            Text("Full error")
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.secondary)

            Text(toast.fullDetailText)
              .font(.footnote)
              .foregroundStyle(.primary)
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding(14)
          .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
          )
        }
        .padding()
      }
      .navigationTitle("Error Details")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button("Done") { dismiss() }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            copyError()
          } label: {
            Label(
              copied ? "Copied" : "Copy",
              systemImage: copied ? "checkmark" : "doc.on.doc"
            )
          }
        }
      }
    }
  }

  private func copyError() {
    UIPasteboard.general.string = toast.fullDetailText
    copied = true
  }
}

private extension AppToast {
  var displayMessage: String? {
    guard let message else { return nil }
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  var accessibilityText: String {
    guard let displayMessage else { return title }
    return "\(title). \(displayMessage)"
  }

  var fullDetailText: String {
    guard let displayMessage else { return title }
    return "\(title)\n\n\(displayMessage)"
  }
}

private extension AppToastStyle {
  var systemImageName: String {
    switch self {
    case .info:
      "info.circle.fill"
    case .success:
      "checkmark.circle.fill"
    case .warning:
      "exclamationmark.triangle.fill"
    case .error:
      "xmark.circle.fill"
    }
  }

  var tint: Color {
    switch self {
    case .info:
      .blue
    case .success:
      .green
    case .warning:
      .orange
    case .error:
      .red
    }
  }
}
