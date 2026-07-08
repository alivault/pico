import SwiftUI
import UIKit

struct UserMessageView: View {
  var item: UserConversationItem
  var canEdit = true
  var onEdit: (UserConversationItem) -> Void = { _ in }

  var body: some View {
    HStack(alignment: .top) {
      Spacer(minLength: 32)
      VStack(alignment: .leading, spacing: 8) {
        if !item.text.isEmpty {
          MarkdownTextView(text: item.text, fillsWidth: false)
        }
        if !item.images.isEmpty {
          Label(
            "\(item.images.count) image attachment\(item.images.count == 1 ? "" : "s")",
            picoSystemImage: "photo"
          )
          .font(.caption)
          .foregroundStyle(.secondary)
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
}

#Preview {
  UserMessageView(item: UserConversationItem(text: "Build an iOS app", images: []))
    .padding()
}
