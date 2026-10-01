#if os(macOS)
  import AppKit

  /// Keeps Pico alive in the menu bar after its windows close and drains the
  /// app-owned server before quitting.
  @MainActor
  final class PicoMacAppDelegate: NSObject, NSApplicationDelegate {
    let serverController: PicoServerController
    private var observers: [NSObjectProtocol] = []

    override init() {
      #if PICO_DOGFOOD
        serverController = PicoServerController(allowsManagement: false)
      #else
        // Unit tests host the app; they must never start a real server.
        let isTestHost =
          ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        serverController = PicoServerController(allowsManagement: !isTestHost)
      #endif
      super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
      serverController.start()
      let center = NotificationCenter.default
      for name in [
        NSWindow.didBecomeKeyNotification,
        NSWindow.didDeminiaturizeNotification,
      ] {
        observers.append(
          center.addObserver(forName: name, object: nil, queue: .main) {
            [weak self] _ in
            MainActor.assumeIsolated { self?.updateActivationPolicy() }
          }
        )
      }
      observers.append(
        center.addObserver(
          forName: NSWindow.willCloseNotification,
          object: nil,
          queue: .main
        ) { [weak self] notification in
          let window = notification.object as? NSWindow
          MainActor.assumeIsolated {
            self?.updateActivationPolicy(closing: window)
          }
        }
      )
    }

    func applicationShouldTerminateAfterLastWindowClosed(
      _ sender: NSApplication
    ) -> Bool {
      false
    }

    func applicationShouldTerminate(
      _ sender: NSApplication
    ) -> NSApplication.TerminateReply {
      let controller = serverController
      guard controller.shouldStopServerOnQuit else { return .terminateNow }

      Task { @MainActor in
        let activeRuns = await controller.activeRunCount()
        if activeRuns > 0 {
          switch Self.confirmQuitWithActiveWork(activeRuns) {
          case .alertFirstButtonReturn:
            break
          case .alertSecondButtonReturn:
            controller.prepareToQuitLeavingServerRunning()
            sender.reply(toApplicationShouldTerminate: true)
            return
          default:
            sender.reply(toApplicationShouldTerminate: false)
            return
          }
        }
        let stopped = await controller.stopForQuit()
        sender.reply(toApplicationShouldTerminate: stopped)
      }
      return .terminateLater
    }

    /// Show a Dock icon only while a regular window is open, so a closed
    /// window leaves Pico running from the menu bar alone.
    func updateActivationPolicy(closing: NSWindow? = nil) {
      let hasWindow = NSApp.windows.contains { window in
        window !== closing &&
          !(window is NSPanel) &&
          window.styleMask.contains(.titled) &&
          (window.isVisible || window.isMiniaturized)
      }
      let policy: NSApplication.ActivationPolicy = hasWindow ? .regular : .accessory
      guard NSApp.activationPolicy() != policy else { return }
      NSApp.setActivationPolicy(policy)
      if policy == .regular {
        NSApp.activate()
      }
    }

    private static func confirmQuitWithActiveWork(
      _ activeRuns: Int
    ) -> NSApplication.ModalResponse {
      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.messageText = activeRuns == 1
        ? "Pi is still working on 1 session."
        : "Pi is still working on \(activeRuns) sessions."
      alert.informativeText =
        "Pico can stop its server after the active work finishes, or quit now and leave the server running in the background."
      alert.addButton(withTitle: "Quit When Finished")
      alert.addButton(withTitle: "Leave Server Running")
      alert.addButton(withTitle: "Cancel")
      NSApp.activate()
      return alert.runModal()
    }
  }
#endif
