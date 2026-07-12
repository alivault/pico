import SwiftUI

struct SessionRowView: View {
  var entry: SessionListEntry

  var body: some View {
    let lastMessagePreview =
      entry.lastMessagePreview?.trimmingCharacters(in: .whitespacesAndNewlines)

    HStack(alignment: .top, spacing: 6) {
      ZStack {
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
      .frame(width: 14, height: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(entry.title)
          .font(.body)
          .foregroundStyle(.primary)
          .lineLimit(1)
          .truncationMode(.tail)

        if let lastMessagePreview, !lastMessagePreview.isEmpty {
          Text(lastMessagePreview)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

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
