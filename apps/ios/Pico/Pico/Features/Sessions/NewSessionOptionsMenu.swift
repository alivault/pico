import SwiftUI

struct NewSessionOptionsMenu: View {
  @Binding var showHiddenDirectories: Bool

  var body: some View {
    Menu {
      Button(action: toggleHiddenDirectories) {
        Label(
          showHiddenDirectories
            ? "Hide Hidden Files and Folders"
            : "Show Hidden Files and Folders",
          picoSystemImage: showHiddenDirectories ? "eye.slash" : "eye",
          size: 20
        )
      }
    } label: {
      Image(picoSystemName: "ellipsis")
    }
    .accessibilityLabel("Directory options")
  }

  private func toggleHiddenDirectories() {
    showHiddenDirectories.toggle()
  }
}

#Preview {
  @Previewable @State var showHiddenDirectories = false

  NewSessionOptionsMenu(showHiddenDirectories: $showHiddenDirectories)
}
