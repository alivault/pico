#if os(macOS)
  import AppKit
  import SwiftUI

  struct PicoMenuBarLabel: View {
    var serverController: PicoServerController

    var body: some View {
      Image(
        systemName: serverController.isServerRunning ||
          !serverController.isManagementAvailable
          ? "bubble.left.and.bubble.right.fill"
          : "exclamationmark.bubble"
      )
      .accessibilityLabel(Text("Pico, \(serverController.statusText)"))
    }
  }

  struct PicoMenuBarView: View {
    @Bindable var model: AppModel
    @Bindable var serverController: PicoServerController
    @Environment(\.openWindow) private var openWindow

    var body: some View {
      VStack(alignment: .leading, spacing: 10) {
        if serverController.isManagementAvailable {
          serverStatus
          networkAccess
        } else {
          Label(model.connectionStatus.label, systemImage: "network")
            .foregroundStyle(.secondary)
        }

        Divider()

        Button("Open Pico", systemImage: "macwindow", action: openPico)
        Button("New Chat", systemImage: "square.and.pencil") {
          model.beginNewChat()
          openPico()
        }

        if serverController.isManagementAvailable {
          Button(
            serverController.isServerRunning ? "Restart Server" : "Start Server",
            systemImage: serverController.isServerRunning
              ? "arrow.clockwise"
              : "play.fill"
          ) {
            if serverController.isServerRunning {
              serverController.restartServer()
            } else {
              serverController.startServer()
            }
          }
          .disabled(!serverController.canControlServer)

          Button("Show Logs", systemImage: "doc.text") {
            dismissMenu()
            serverController.openLogs()
          }

          Toggle(
            "Launch at Login",
            isOn: Binding(
              get: { serverController.launchAtLogin },
              set: { serverController.setLaunchAtLogin($0) }
            )
          )
          if serverController.launchAtLoginRequiresApproval {
            Button(
              "Approve in Login Items…",
              systemImage: "gearshape",
              action: serverController.openLoginItemSettings
            )
          }
        }

        if let message = serverController.errorMessage {
          Text(message)
            .font(.footnote)
            .foregroundStyle(.red)
            .textSelection(.enabled)
        }

        Divider()

        Button("Quit Pico", systemImage: "power") {
          NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
      }
      .buttonStyle(.borderless)
      .padding()
      .frame(width: 320, alignment: .leading)
      .onAppear(perform: serverController.refreshLaunchAtLoginStatus)
    }

    private var serverStatus: some View {
      VStack(alignment: .leading, spacing: 4) {
        Label(serverController.statusText, systemImage: serverController.statusSymbol)
          .foregroundStyle(serverController.isServerRunning ? .green : .secondary)
        if let failure = serverController.failureMessage {
          Text(failure)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        if let notice = serverController.notice {
          Text(notice)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
    }

    private var networkAccess: some View {
      GroupBox("Network Access") {
        VStack(alignment: .leading) {
          Toggle(
            "Allow remote connections",
            isOn: $serverController.remoteAccessEnabled
          )
          .disabled(
            !serverController.networkSettingsLoaded ||
              !serverController.canControlServer
          )

          TextField("Remote IP address", text: $serverController.remoteBindAddress)
            .textFieldStyle(.roundedBorder)
            .disabled(
              !serverController.remoteAccessEnabled ||
                !serverController.canControlServer
            )

          Text(serverController.networkStatusText)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)

          HStack {
            Button(
              "Apply",
              systemImage: "checkmark",
              action: serverController.applyNetworkSettings
            )
            .disabled(
              !serverController.networkSettingsLoaded ||
                !serverController.canControlServer
            )

            if serverController.remoteListenerActive {
              Button(
                "Copy Address",
                systemImage: "doc.on.doc",
                action: serverController.copyRemoteAddress
              )
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }

    private func openPico() {
      dismissMenu()
      NSApp.setActivationPolicy(.regular)
      NSApp.activate()
      openWindow(id: PicoApp.mainWindowID)
    }

    /// SwiftUI has no API to close a window-style menu bar extra, so close
    /// its panel directly before handing focus to another window.
    private func dismissMenu() {
      NSApp.windows
        .first { String(describing: type(of: $0)).contains("MenuBarExtra") }?
        .close()
    }
  }
#endif
