import SwiftUI

struct UserMessageView: View {
  var item: UserConversationItem

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
            systemImage: "photo"
          )
          .font(.caption)
          .foregroundStyle(.secondary)
        }
        if item.queued == true {
          Label("Queued", systemImage: "clock")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      .padding(12)
      .background(.tint.opacity(0.12), in: .rect(cornerRadius: 16))
    }
  }
}

#Preview {
  UserMessageView(item: UserConversationItem(text: "Build an iOS app", images: []))
    .padding()
}
