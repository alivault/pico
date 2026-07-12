import SwiftUI

struct NewSessionDirectoryLabel: View {
  var path: String
  var subtitle: String? = nil
  var isSelected: Bool

  var body: some View {
    HStack(spacing: 12) {
      PicoIcon(systemName: "folder")
        .foregroundStyle(.secondary)
        .frame(width: 24)
      VStack(alignment: .leading, spacing: 3) {
        Text(DirectoryPathFormatter.displayPath(path))
          .lineLimit(1)
        if let subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      if isSelected {
        PicoIcon(systemName: "checkmark.circle.fill")
          .foregroundStyle(.tint)
          .accessibilityLabel("Selected")
      }
    }
    .contentShape(.rect)
  }
}

#Preview {
  List {
    NewSessionDirectoryLabel(
      path: "/Users/alice/project",
      subtitle: "Add to sidebar and start here.",
      isSelected: true
    )
  }
}
