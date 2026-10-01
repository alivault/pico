import SwiftUI

struct WorkspaceView: View {
  @Bindable var model: AppModel

  var body: some View {
    PlatformWorkspaceView(model: model)
  }
}

#Preview {
  WorkspaceView(model: AppModel())
}
