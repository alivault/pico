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
  private(set) var networkSettingsLoaded = false
  private(set) var activeListenHosts: [String] = []
  private(set) var serverPort = 3141
  private(set) var errorMessage: String?
  var remoteAccessEnabled = false
  var remoteBindAddress = ""

  var statusText: String {
    isServerRunning ? "Server running" : "Server unavailable"
  }

  var statusSymbol: String {
    isServerRunning ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
  }

  var remoteListenerActive: Bool {
    remoteAccessEnabled && activeListenHosts.contains(remoteBindAddress)
  }

  var remoteAddressURL: String? {
    guard remoteAccessEnabled else { return nil }
    let address = normalizedRemoteBindAddress
    guard !address.isEmpty else { return nil }
    let host = address.contains(":") ? "[\(address)]" : address
    return "http://\(host):\(serverPort)"
  }

  var networkStatusText: String {
    guard networkSettingsLoaded else { return "Loading network settings…" }
    guard remoteAccessEnabled else { return "Local access only" }
    guard isServerRunning else { return "Waiting for the server to start" }
    if remoteListenerActive, let remoteAddressURL {
      return "Available at \(remoteAddressURL)"
    }
    return "The configured address is not currently available"
  }

  func start() {
    guard monitorTask == nil else { return }
    monitorTask = Task { [weak self] in
      await self?.loadNetworkSettings()
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

  func copyRemoteAddress() {
    guard let remoteAddressURL else { return }
    NSPasteboard.general.clearContents()
    if !NSPasteboard.general.setString(remoteAddressURL, forType: .string) {
      errorMessage = "The remote address could not be copied."
    }
  }

  func applyNetworkSettings() {
    guard !isWorking else { return }
    let address = normalizedRemoteBindAddress
    if remoteAccessEnabled && address.isEmpty {
      errorMessage = "Enter the IP address that Pico should listen on."
      return
    }
    guard let serverBinaryURL else {
      errorMessage = "The bundled Pico server could not be found."
      return
    }

    isWorking = true
    errorMessage = nil
    Task {
      defer { isWorking = false }
      let arguments = remoteAccessEnabled
        ? ["network", "set", address]
        : ["network", "disable"]
      let result = await commandRunner.runCapturingOutput(
        executable: serverBinaryURL,
        arguments: arguments
      )
      guard result.status == 0 else {
        errorMessage = commandError(
          result,
          fallback: "The network settings could not be saved."
        )
        return
      }

      await loadNetworkSettings()
      guard await restartServerAfterDraining() else { return }
      if remoteAccessEnabled && !remoteListenerActive {
        errorMessage =
          "Pico is still available locally, but the configured remote address is not available on this Mac."
      }
    }
  }

  func restartServer() {
    guard !isWorking else { return }
    isWorking = true
    errorMessage = nil
    Task {
      defer { isWorking = false }
      _ = await restartServerAfterDraining()
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
          arguments: ["stop", "--wait"]
        )
      }
      NSApplication.shared.terminate(nil)
    }
  }

  private var normalizedRemoteBindAddress: String {
    remoteBindAddress.trimmingCharacters(in: .whitespacesAndNewlines)
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

  private func loadNetworkSettings() async {
    guard let serverBinaryURL else {
      networkSettingsLoaded = true
      return
    }
    let result = await commandRunner.runCapturingOutput(
      executable: serverBinaryURL,
      arguments: ["network", "status"]
    )
    guard
      result.status == 0,
      let data = result.standardOutput.data(using: .utf8),
      let status = try? JSONDecoder().decode(PicoMenuNetworkStatus.self, from: data),
      status.ok
    else {
      networkSettingsLoaded = true
      errorMessage = commandError(
        result,
        fallback: "The network settings could not be loaded."
      )
      return
    }

    remoteAccessEnabled = status.remoteAccessEnabled
    remoteBindAddress = status.remoteBindAddress ?? ""
    networkSettingsLoaded = true
  }

  private func restartServerAfterDraining() async -> Bool {
    guard let serverBinaryURL else {
      errorMessage = "The bundled Pico server could not be found."
      return false
    }
    if isServerRunning {
      let stopStatus = await commandRunner.run(
        executable: serverBinaryURL,
        arguments: ["stop", "--wait"]
      )
      guard stopStatus == 0 else {
        errorMessage = "The server could not finish active work before restarting."
        return false
      }
    }

    let target = "gui/\(getuid())/\(Self.serverAgentLabel)"
    let restartStatus = await commandRunner.run(
      executable: URL(filePath: "/bin/launchctl"),
      arguments: ["kickstart", "-k", target]
    )
    guard restartStatus == 0 else {
      errorMessage =
        "The server could not be restarted. Check Login Items settings."
      return false
    }

    for _ in 0..<20 {
      try? await Task.sleep(for: .milliseconds(500))
      await refreshServerStatus()
      if isServerRunning { return true }
    }
    errorMessage = "The server did not become available after restarting."
    return false
  }

  private func refreshServerStatus() async {
    guard let healthURL = Self.healthURL else {
      isServerRunning = false
      activeListenHosts = []
      return
    }
    var request = URLRequest(url: healthURL)
    request.timeoutInterval = 2
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      let statusCode = (response as? HTTPURLResponse)?.statusCode
      let health = try JSONDecoder().decode(PicoMenuHealthStatus.self, from: data)
      isServerRunning = statusCode == 200 && health.ok
      activeListenHosts = health.listenHosts ?? ["127.0.0.1"]
      serverPort = health.port ?? 3141
    } catch {
      isServerRunning = false
      activeListenHosts = []
    }
  }

  private func commandError(
    _ result: PicoMenuCommandResult,
    fallback: String
  ) -> String {
    let message = result.standardError.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    return message.isEmpty ? fallback : message
  }
}
