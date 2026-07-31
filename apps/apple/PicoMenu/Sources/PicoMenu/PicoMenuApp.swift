import SwiftUI

@main
struct PicoMenuApp: App {
  @State private var model = PicoMenuModel()

  var body: some Scene {
    MenuBarExtra {
      PicoMenuContentView(model: model)
    } label: {
      Image(
        systemName: model.isServerRunning
          ? "bubble.left.and.bubble.right.fill"
          : "exclamationmark.bubble"
      )
      .accessibilityLabel("Pico Server")
    }
    .menuBarExtraStyle(.window)
  }
}
