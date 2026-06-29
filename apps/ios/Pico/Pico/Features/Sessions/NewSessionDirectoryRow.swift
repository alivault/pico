import SwiftUI

struct NewSessionDirectoryRow: View {
  var path: String
  var subtitle: String
  var isSelected: Bool
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      NewSessionDirectoryLabel(
        path: path,
        subtitle: subtitle,
        isSelected: isSelected
      )
    }
    .buttonStyle(.plain)
  }
}

#Preview {
  List {
    NewSessionDirectoryRow(
      path: "/Users/alice/project",
      subtitle: "Add to sidebar and start here.",
      isSelected: true,
      action: {}
    )
  }
}
