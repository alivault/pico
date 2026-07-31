import AppKit
import Foundation
import Observation
import ServiceManagement

@MainActor
@Observable
final class PicoMenuModel {
  private static let serverAgentLabel = "com.alivault.pico.server"
  private static let healthURL = URL(
    string: "http://127.0.0.1:3141/api/system/health"
  )

  private let commandRunner = PicoMenuCommandRunner()
  private var monitorTask: Task<Void, Never>?

  private(set) var isServerRunning = false
  private(set) var isWorking = false
  private(set) var errorMessage: String?

  var statusText: String {
    isServerRunning ? "Server running" : "Server unavailable"
  }

  var statusSymbol: String {
    isServerRunning ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
  }

  func start() {
    guard monitorTask == nil else { return }
    monitorTask = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refreshServerStatus()
        do {
          try await Task.sleep(for: .seconds(3))
        } catch {
          return
        }
      }
    }
  }

  func openPico() {
    guard let hostAppURL else {
      errorMessage = "Pico.app could not be found."
      return
    }
    if !NSWorkspace.shared.open(hostAppURL) {
      errorMessage = "Pico.app could not be opened."
    }
  }

  func openNewChat() {
    guard let url = URL(string: "pico://new") else { return }
    if !NSWorkspace.shared.open(url) {
      errorMessage = "Pico could not open a new chat."
    }
  }

  func restartServer() {
    guard !isWorking else { return }
    isWorking = true
    errorMessage = nil
    Task {
      if let serverBinaryURL {
        _ = await commandRunner.run(
          executable: serverBinaryURL,
          arguments: ["stop"]
        )
      }
      let target = "gui/\(getuid())/\(Self.serverAgentLabel)"
      let status = await commandRunner.run(
        executable: URL(filePath: "/bin/launchctl"),
        arguments: ["kickstart", "-k", target]
      )
      if status != 0 {
        errorMessage = "The server could not be restarted. Check Login Items settings."
      }
      try? await Task.sleep(for: .seconds(1))
      await refreshServerStatus()
      isWorking = false
    }
  }

  func openLogs() {
    let logsURL = URL.applicationSupportDirectory
      .appending(path: "Pico/logs", directoryHint: .isDirectory)
    if !NSWorkspace.shared.open(logsURL) {
      errorMessage = "The Pico logs folder is not available yet."
    }
  }

  func openLoginItemSettings() {
    SMAppService.openSystemSettingsLoginItems()
  }

  func quitCompletely() {
    guard !isWorking else { return }
    isWorking = true
    Task {
      if let serverBinaryURL {
        _ = await commandRunner.run(
          executable: serverBinaryURL,
          arguments: ["stop"]
        )
      }
      NSApplication.shared.terminate(nil)
    }
  }

  private var hostAppURL: URL? {
    var url = Bundle.main.bundleURL
    for _ in 0..<4 {
      url.deleteLastPathComponent()
    }
    guard url.pathExtension == "app" else { return nil }
    return url
  }

  private var serverBinaryURL: URL? {
    guard let hostAppURL else { return nil }
    let url = hostAppURL
      .appending(path: "Contents/Resources/PicoServer")
      .appending(path: "pico-server")
    return FileManager.default.isExecutableFile(atPath: url.path) ? url : nil
  }

  private func refreshServerStatus() async {
    guard let healthURL = Self.healthURL else {
      isServerRunning = false
      return
    }
    var request = URLRequest(url: healthURL)
    request.timeoutInterval = 2
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      isServerRunning = (response as? HTTPURLResponse)?.statusCode == 200
    } catch {
      isServerRunning = false
    }
  }
}
