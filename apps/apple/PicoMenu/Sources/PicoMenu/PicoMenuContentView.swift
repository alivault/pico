import SwiftUI

struct PicoMenuContentView: View {
  @Bindable var model: PicoMenuModel

  var body: some View {
    VStack(alignment: .leading) {
      Label(model.statusText, systemImage: model.statusSymbol)
        .foregroundStyle(model.isServerRunning ? .green : .secondary)

      GroupBox("Network Access") {
        VStack(alignment: .leading) {
          Toggle(
            "Allow remote connections",
            isOn: $model.remoteAccessEnabled
          )
          .disabled(!model.networkSettingsLoaded || model.isWorking)

          TextField("Remote IP address", text: $model.remoteBindAddress)
            .textFieldStyle(.roundedBorder)
            .disabled(!model.remoteAccessEnabled || model.isWorking)

          Text(model.networkStatusText)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)

          HStack {
            Button(
              "Apply",
              systemImage: "checkmark",
              action: model.applyNetworkSettings
            )
            .disabled(!model.networkSettingsLoaded || model.isWorking)

            if model.remoteListenerActive {
              Button(
                "Copy Address",
                systemImage: "doc.on.doc",
                action: model.copyRemoteAddress
              )
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }

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
          .textSelection(.enabled)
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
    .frame(width: 360)
    .task {
      model.start()
    }
  }
}

#Preview {
  PicoMenuContentView(model: PicoMenuModel())
}
