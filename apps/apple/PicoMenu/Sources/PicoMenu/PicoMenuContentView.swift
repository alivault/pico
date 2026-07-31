import SwiftUI

struct PicoMenuContentView: View {
  @Bindable var model: PicoMenuModel

  var body: some View {
    VStack(alignment: .leading) {
      Label(model.statusText, systemImage: model.statusSymbol)
        .foregroundStyle(model.isServerRunning ? .green : .secondary)

      Divider()

      Button("Open Pico", systemImage: "macwindow", action: model.openPico)
      Button(
        "New Chat",
        systemImage: "square.and.pencil",
        action: model.openNewChat
      )
      Button(
        "Restart Server",
        systemImage: "arrow.clockwise",
        action: model.restartServer
      )
      .disabled(model.isWorking)
      Button("Show Logs", systemImage: "doc.text", action: model.openLogs)
      Button(
        "Start at Login Settings…",
        systemImage: "gearshape",
        action: model.openLoginItemSettings
      )

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .foregroundStyle(.red)
      }

      Divider()

      Button(
        "Quit Completely",
        systemImage: "power",
        role: .destructive,
        action: model.quitCompletely
      )
      .disabled(model.isWorking)
    }
    .padding()
    .frame(width: 300)
    .task {
      model.start()
    }
  }
}

#Preview {
  PicoMenuContentView(model: PicoMenuModel())
}
