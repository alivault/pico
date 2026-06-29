import SwiftUI

struct RootView: View {
  @Bindable var model: AppModel
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      if model.isConnected {
        WorkspaceView(model: model)
      } else {
        ConnectionView(model: model)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background {
      Rectangle()
        .fill(.background)
        .ignoresSafeArea()
    }
    .task {
      await model.restoreConnection()
    }
    .onChange(of: scenePhase, initial: true) {
      model.setSceneActive(scenePhase == .active)
    }
    .onReceive(NotificationCenter.default.publisher(for: .picoOpenNewChatShortcut)) { _ in
      model.beginNewChat()
    }
    .alert(item: $model.alert) { alert in
      Alert(
        title: Text(alert.title),
        message: Text(alert.message)
      )
    }
    .sheet(item: $model.activeUiRequest, onDismiss: model.clearActiveUiRequest) { request in
      AuthUiRequestSheetView(model: model, request: request)
    }
  }
}

#Preview {
  RootView(model: AppModel())
}
