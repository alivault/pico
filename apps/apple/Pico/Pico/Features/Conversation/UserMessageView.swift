import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct UserMessageView: View {
  var item: UserConversationItem
  var canEdit = true
  var onEdit: (UserConversationItem) -> Void = { _ in }

  @State private var previewRequest: UserMessageImagePreviewRequest?

  var body: some View {
    HStack(alignment: .top) {
      Spacer(minLength: 32)
      VStack(alignment: .leading, spacing: 8) {
        if !item.text.isEmpty {
          MarkdownTextView(text: item.text, fillsWidth: false)
        }
        if !item.images.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(item.images.enumerated()), id: \.offset) { index, image in
              UserMessageImageAttachmentButton(
                image: image,
                accessibilityLabel: imageAccessibilityLabel(at: index)
              ) {
                previewRequest = UserMessageImagePreviewRequest(index: index)
              }
            }
          }
        }
        if item.queued == true {
          Label("Queued", picoSystemImage: "clock")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      .padding(12)
      .background(.tint.opacity(0.12), in: .rect(cornerRadius: 16))
      .contextMenu {
        Button(action: copyMessage) {
          Label("Copy", picoSystemImage: "doc.on.doc")
        }
        .disabled(!hasCopyableText)

        Button(action: { onEdit(item) }) {
          Label("Edit", picoSystemImage: "pencil")
        }
        .disabled(!canEdit || !hasEditableText)
      }
    }
#if os(macOS)
    .sheet(item: $previewRequest) { request in
      UserMessageImagePreview(images: item.images, initialIndex: request.index)
        .frame(minWidth: 640, minHeight: 480)
    }
#else
    .fullScreenCover(item: $previewRequest) { request in
      UserMessageImagePreview(images: item.images, initialIndex: request.index)
    }
#endif
  }

  private var hasCopyableText: Bool {
    !item.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var hasEditableText: Bool {
    hasCopyableText
  }

  private func copyMessage() {
    UIPasteboard.general.string = item.text
  }

  private func imageAccessibilityLabel(at index: Int) -> String {
    guard item.images.count > 1 else { return "Preview image attachment" }
    return "Preview image attachment \(index + 1) of \(item.images.count)"
  }
}

private struct UserMessageImagePreviewRequest: Identifiable {
  var index: Int

  var id: Int { index }
}

private struct UserMessageImageAttachmentButton: View {
  private static let maxImageSize = CGSize(width: 260, height: 260)

  var image: PromptImage
  var accessibilityLabel: String
  var preview: () -> Void

  var body: some View {
    Button(action: preview) {
      Label {
        Text(accessibilityLabel)
      } icon: {
        imageContent
      }
      .labelStyle(.iconOnly)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel)
    .accessibilityHint("Opens a larger preview.")
  }

  @ViewBuilder
  private var imageContent: some View {
    if let uiImage = image.uiImage {
      let displaySize = Self.displaySize(for: uiImage, maxSize: Self.maxImageSize)

      Image(uiImage: uiImage)
        .resizable()
        .scaledToFit()
        .frame(width: displaySize.width, height: displaySize.height)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(.quaternary, lineWidth: 0.5)
        }
    } else {
      Label("Image attachment unavailable", picoSystemImage: "photo")
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(10)
        .background(.regularMaterial, in: .rect(cornerRadius: 12))
    }
  }

  private static func displaySize(for uiImage: UIImage, maxSize: CGSize) -> CGSize {
    let imageSize = uiImage.size
    guard imageSize.width > 0, imageSize.height > 0 else { return maxSize }

    let scale = min(
      maxSize.width / imageSize.width,
      maxSize.height / imageSize.height,
      1
    )
    return CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
  }
}


#Preview {
  UserMessageView(item: UserConversationItem(text: "Build an iOS app", images: []))
    .padding()
}
