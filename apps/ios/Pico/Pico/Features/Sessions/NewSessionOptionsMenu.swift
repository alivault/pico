import SwiftUI

struct NewSessionOptionsMenu: View {
  @Binding var showHiddenDirectories: Bool

  var body: some View {
    Menu {
      Toggle(isOn: $showHiddenDirectories) {
        Label("Show Hidden Files and Folders", picoSystemImage: "eye")
      }
    } label: {
      Image(picoSystemName: "ellipsis")
    }
    .accessibilityLabel("Directory options")
  }
}

#Preview {
  @Previewable @State var showHiddenDirectories = false

  NewSessionOptionsMenu(showHiddenDirectories: $showHiddenDirectories)
}
