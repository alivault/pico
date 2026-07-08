import SwiftUI

struct StreamingBehaviorMenu: View {
  @Binding var selection: StreamingBehavior

  var body: some View {
    Menu {
      ForEach(StreamingBehavior.allCases, id: \.self) { behavior in
        Button(behavior.label) {
          selection = behavior
        }
      }
    } label: {
      Label(selection.label, picoSystemImage: "arrow.triangle.branch")
        .labelStyle(.iconOnly)
    }
    .accessibilityLabel("Streaming behavior: \(selection.label)")
  }
}

#Preview {
  @Previewable @State var behavior = StreamingBehavior.steer
  StreamingBehaviorMenu(selection: $behavior)
}
