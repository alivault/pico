#if os(macOS)
  import Foundation
  import Observation
  import ServiceManagement
  import SwiftUI

  @MainActor
  @Observable
  final class PicoServerServiceController {
    static let serverAgentLabel = "com.alivault.pico.server"
    static let serverAgentPlistName = "com.alivault.pico.server.plist"
    static let menuBundleIdentifier = "com.alivault.pico.macos.menu"

    private static let preferenceKey = "pico.macos.startAtLogin"
    private static let availabilityInfoKey = "PicoBackgroundServicesAvailable"

    private let defaults: UserDefaults
    private let serverService: SMAppService
    private let menuService: SMAppService
    private var hasStarted = false

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
