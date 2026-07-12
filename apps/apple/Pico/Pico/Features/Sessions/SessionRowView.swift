import SwiftUI

struct SessionRowView: View {
  var entry: SessionListEntry

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 6) {
          Text(entry.title)
            .font(.body)
            .foregroundStyle(.primary)
            .lineLimit(1)
            .truncationMode(.tail)
          if entry.streaming == true {
            ProgressView()
              .controlSize(.small)
              .accessibilityLabel("Streaming")
          } else if entry.unread == true {
            Circle()
              .fill(.tint)
              .frame(width: 8, height: 8)
              .accessibilityLabel("Unread")
          }
        }

      }

      Spacer(minLength: 8)
    }
    .contentShape(.rect)
    .padding(.vertical, 4)
  }
}

#Preview {
  SessionRowView(
    entry: SessionListEntry(
      cwd: "/Users/alice/project",
      title: "Implement SwiftUI client",
      lastMessagePreview: "Let's start with the event stream and composer.",
      streaming: true,
      unread: true
    )
  )
  .padding()
}
