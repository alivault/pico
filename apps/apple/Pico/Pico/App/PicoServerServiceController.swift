#if os(macOS)
  import Foundation
  import Observation
  import ServiceManagement
  import SwiftUI

  private actor PicoServerCommandRunner {
    struct RunningStatus: Decodable {
      var version: String
      var protocolVersion: Int
      var apiContractVersion: Int?
    }

    private struct StatusResponse: Decodable {
      var status: RunningStatus?
    }

    func status(executable: URL) -> RunningStatus? {
      let output = Pipe()
      let process = Process()
      process.executableURL = executable
      process.arguments = ["status"]
      process.standardOutput = output
      process.standardError = FileHandle.nullDevice
      do {
        try process.run()
        process.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let response = try JSONDecoder().decode(StatusResponse.self, from: data)
        return response.status
      } catch {
        return nil
      }
    }

    func run(executable: URL, arguments: [String]) -> Int32 {
      let process = Process()
      process.executableURL = executable
      process.arguments = arguments
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      do {
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
      } catch {
        return -1
      }
    }
  }

  @MainActor
  @Observable
  final class PicoServerServiceController {
    static let serverAgentLabel = "com.alivault.pico.server"
    static let serverAgentPlistName = "com.alivault.pico.server.plist"
    static let menuBundleIdentifier = "com.alivault.pico.macos.menu"

    private static let preferenceKey = "pico.macos.startAtLogin"
    private static let availabilityInfoKey = "PicoBackgroundServicesAvailable"
    private static let serverProtocolVersion = 2
    private static let apiContractVersion = 1

    private let defaults: UserDefaults
    private let serverService: SMAppService
    private let menuService: SMAppService
    private let commandRunner = PicoServerCommandRunner()
    private var hasStarted = false
    private var versionReconciliationTask: Task<Void, Never>?

    var startAtLogin: Bool {
      didSet {
        guard oldValue != startAtLogin else { return }
        defaults.set(startAtLogin, forKey: Self.preferenceKey)
        applyPreference()
      }
    }
    private(set) var serverStatus = "Not registered"
    private(set) var menuStatus = "Not registered"
    private(set) var requiresApproval = false
    private(set) var isAvailable = false
    private(set) var errorMessage: String?

    init(defaults: UserDefaults = .standard) {
      self.defaults = defaults
      serverService = .agent(plistName: Self.serverAgentPlistName)
      menuService = .loginItem(identifier: Self.menuBundleIdentifier)
      if defaults.object(forKey: Self.preferenceKey) == nil {
        startAtLogin = true
      } else {
        startAtLogin = defaults.bool(forKey: Self.preferenceKey)
      }
    }

    func start() {
      guard !hasStarted else { return }
      hasStarted = true
      isAvailable =
        backgroundServicesAllowed && bundledServerAgentExists &&
        bundledServerBinaryExists && bundledMenuAppExists
      refreshStatus()
      applyPreference()
      reconcileServerVersionIfNeeded()
    }

    func refreshStatus() {
      serverStatus = label(for: serverService.status)
      menuStatus = label(for: menuService.status)
      requiresApproval =
        serverService.status == .requiresApproval ||
        menuService.status == .requiresApproval
    }

    func openLoginItemSettings() {
      SMAppService.openSystemSettingsLoginItems()
    }

    private var backgroundServicesAllowed: Bool {
      let configuredValue = Bundle.main.object(
        forInfoDictionaryKey: Self.availabilityInfoKey
      ) as? Bool
      return configuredValue ?? true
    }

    private var bundledServerAgentExists: Bool {
      FileManager.default.fileExists(atPath: serverAgentPlistURL.path)
    }

    private var bundledServerBinaryExists: Bool {
      FileManager.default.isExecutableFile(atPath: serverBinaryURL.path)
    }

    private var bundledMenuAppExists: Bool {
      FileManager.default.fileExists(atPath: menuAppURL.path)
    }

    private var serverAgentPlistURL: URL {
      Bundle.main.bundleURL
        .appending(path: "Contents/Library/LaunchAgents")
        .appending(path: Self.serverAgentPlistName)
    }

    private var packagedVersion: String? {
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    private var serverBinaryURL: URL {
      Bundle.main.bundleURL
        .appending(path: "Contents/Resources/PicoServer/pico-server")
    }

    private var menuAppURL: URL {
      Bundle.main.bundleURL
        .appending(path: "Contents/Library/LoginItems/PicoMenu.app")
    }

    private func applyPreference() {
      guard isAvailable else { return }
      if startAtLogin {
        registerServicesIfNeeded()
      } else {
        unregisterServices()
      }
    }

    private func registerServicesIfNeeded() {
      errorMessage = nil
      do {
        if shouldRegister(serverService.status) {
          try serverService.register()
        }
        if shouldRegister(menuService.status) {
          try menuService.register()
        }
        refreshStatus()
        if menuService.status == .enabled {
          _ = NSWorkspace.shared.open(menuAppURL)
        }
      } catch {
        refreshStatus()
        errorMessage = error.localizedDescription
      }
    }

    private func unregisterServices() {
      errorMessage = nil
      do {
        if menuService.status != .notRegistered && menuService.status != .notFound {
          try menuService.unregister()
        }
        if serverService.status != .notRegistered && serverService.status != .notFound {
          try serverService.unregister()
        }
        refreshStatus()
      } catch {
        refreshStatus()
        errorMessage = error.localizedDescription
      }
    }

    private func reconcileServerVersionIfNeeded() {
      guard
        isAvailable,
        startAtLogin,
        serverService.status == .enabled,
        versionReconciliationTask == nil,
        let packagedVersion
      else { return }

      let commandRunner = commandRunner
      let serverBinaryURL = serverBinaryURL
      versionReconciliationTask = Task { [weak self] in
        guard let running = await commandRunner.status(executable: serverBinaryURL) else {
          self?.versionReconciliationTask = nil
          return
        }
        guard running.version != packagedVersion else {
          self?.versionReconciliationTask = nil
          return
        }
        guard
          running.protocolVersion == Self.serverProtocolVersion,
          running.apiContractVersion == Self.apiContractVersion
        else {
          self?.errorMessage =
            "The running Pico server uses an incompatible protocol. Finish active work and restart it manually."
          self?.versionReconciliationTask = nil
          return
        }

        let stopStatus = await commandRunner.run(
          executable: serverBinaryURL,
          arguments: ["stop", "--wait"]
        )
        guard stopStatus == 0 else {
          self?.errorMessage = "The previous Pico server could not drain for update."
          self?.versionReconciliationTask = nil
          return
        }
        let restartStatus = await commandRunner.run(
          executable: URL(filePath: "/bin/launchctl"),
          arguments: [
            "kickstart",
            "-k",
            "gui/\(getuid())/\(Self.serverAgentLabel)",
          ]
        )
        if restartStatus != 0 {
          self?.errorMessage = "The updated Pico server could not be started."
        }
        self?.refreshStatus()
        self?.versionReconciliationTask = nil
      }
    }

    private func shouldRegister(_ status: SMAppService.Status) -> Bool {
      status == .notRegistered || status == .notFound
    }

    private func label(for status: SMAppService.Status) -> String {
      switch status {
      case .enabled:
        "Enabled"
      case .notRegistered:
        "Not registered"
      case .requiresApproval:
        "Needs approval"
      case .notFound:
        "Unavailable"
      @unknown default:
        "Unknown"
      }
    }
  }
#endif
