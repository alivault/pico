import SwiftUI
import UIKit

struct UserMessageView: View {
  var item: UserConversationItem
  var canEdit = true
  var onEdit: (UserConversationItem) -> Void = { _ in }

  @State private var previewImage: PromptImage?

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
                previewImage = image
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
    .fullScreenCover(item: $previewImage) { image in
      UserMessageImagePreview(image: image)
    }
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

private struct UserMessageImagePreview: View {
  var image: PromptImage

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Group {
        if let uiImage = image.uiImage {
          ZStack {
            Color.black.ignoresSafeArea()

            GeometryReader { proxy in
              Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
            .padding()
          }
        } else {
          ContentUnavailableView(
            "Image unavailable",
            picoSystemImage: "photo",
            description: Text("Pico could not load this image attachment.")
          )
        }
      }
      .navigationTitle("Image preview")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") {
            dismiss()
          }
        }
      }
    }
  }
}

private extension PromptImage {
  var uiImage: UIImage? {
    guard let imageData = Data(base64Encoded: data) else { return nil }
    return UIImage(data: imageData)
  }
}

#Preview {
  UserMessageView(item: UserConversationItem(text: "Build an iOS app", images: []))
    .padding()
}
