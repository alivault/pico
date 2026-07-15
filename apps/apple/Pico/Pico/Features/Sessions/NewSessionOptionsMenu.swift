import SwiftUI

struct NewSessionOptionsMenu: View {
  @Binding var showHiddenDirectories: Bool

  var body: some View {
    #if os(macOS)
      Toggle(isOn: $showHiddenDirectories) {
        Text("Show hidden files")
      }
      .accessibilityLabel("Show hidden files")
    #else
      Menu {
        Toggle(isOn: $showHiddenDirectories) {
          Label(
            "Show hidden files",
            picoSystemImage: "eye",
            size: 20
          )
        }
      } label: {
        Image(picoSystemName: "ellipsis")
      }
      .accessibilityLabel("Directory options")
    #endif
  }
}

#Preview {
  @Previewable @State var showHiddenDirectories = false

  NewSessionOptionsMenu(showHiddenDirectories: $showHiddenDirectories)
}
