#if os(macOS)
  import AppKit
  import Foundation
  import Observation
  import ServiceManagement

  /// Owns the local Pico server for the macOS app.
  ///
  /// Like a terminal multiplexer, the app attaches to a running server when
  /// one exists and otherwise launches `pico-server serve` as a detached
  /// process. Closing windows never stops the server; quitting the app drains
  /// and stops only a server that this app launched.
  @MainActor
  @Observable
  final class PicoServerController {
    enum State: Equatable {
      case checking
      case starting
      case running
      case stopping
      case stopped
      case failed(String)
    }

    static let localServerURL = URL(string: "http://localhost:3141")!
    static let ownedServerPIDKey = "pico.macos.ownedServerPID"
    static let launchAtLoginConfiguredKey = "pico.macos.launchAtLoginConfigured"
    private static let healthURL = URL(
      string: "http://127.0.0.1:3141/api/system/health"
    )!
    private static let serverProtocolVersion = 2
    private static let apiContractVersion = 1
    private static let startupTimeout: Duration = .seconds(20)
    private static let monitorInterval: Duration = .seconds(3)
    private static let legacyServerAgentPlistName = "com.alivault.pico.server.plist"
    private static let legacyMenuBundleIdentifier = "com.alivault.pico.macos.menu"

    let installation: PicoServerInstallation?
    /// False for sandboxed, dogfood, and unpackaged builds.
    let isManagementAvailable: Bool

    private(set) var state: State = .checking
    /// Whether this app launched the running server and should stop it on quit.
    private(set) var ownsServer = false
    /// A server answers on the Pico port but its control socket is not ours.
    private(set) var isExternalServer = false
    private(set) var isWorking = false
    private(set) var errorMessage: String?
    private(set) var notice: String?
    private(set) var activeListenHosts: [String] = []
    private(set) var serverPort = 3141
    private(set) var networkSettingsLoaded = false
    private(set) var launchAtLoginStatus: SMAppService.Status = .notRegistered
    var remoteAccessEnabled = false
    var remoteBindAddress = ""

    private let defaults: UserDefaults
    private let runner = PicoServerCommandRunner()
    private var startupTask: Task<Void, Never>?
    private var monitorTask: Task<Void, Never>?
    private var isQuitting = false
    private var lastAutomaticRestart: Date?

    init(
      defaults: UserDefaults = .standard,
      installation: PicoServerInstallation? = PicoServerInstallation.resolve(),
      allowsManagement: Bool = true
    ) {
      self.defaults = defaults
      self.installation = installation
      let sandboxed =
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
      isManagementAvailable = allowsManagement && installation != nil && !sandboxed
      if !isManagementAvailable { state = .stopped }
    }

    // MARK: Derived state

    var isServerRunning: Bool { state == .running }

    var canControlServer: Bool {
      isManagementAvailable && !isExternalServer && !isWorking
    }

    var statusText: String {
      switch state {
      case .checking: "Checking server…"
      case .starting: "Starting server…"
      case .running: isExternalServer ? "External server running" : "Server running"
      case .stopping: "Stopping server…"
      case .stopped: "Server stopped"
      case .failed: "Server unavailable"
      }
    }

    var statusSymbol: String {
      switch state {
      case .running: "checkmark.circle.fill"
      case .checking, .starting, .stopping: "clock"
      case .stopped: "stop.circle"
      case .failed: "exclamationmark.triangle.fill"
      }
    }

    var failureMessage: String? {
      if case .failed(let message) = state { return message }
      return nil
    }

    var launchAtLogin: Bool { launchAtLoginStatus == .enabled }

    var launchAtLoginRequiresApproval: Bool {
      launchAtLoginStatus == .requiresApproval
    }

    var remoteListenerActive: Bool {
      remoteAccessEnabled &&
        activeListenHosts.contains(normalizedRemoteBindAddress)
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

    var logsURL: URL {
      URL.applicationSupportDirectory
        .appending(path: "Pico/logs", directoryHint: .isDirectory)
    }

    private var launchLogURL: URL {
      logsURL.appending(path: "server-launch.log")
    }

    private var normalizedRemoteBindAddress: String {
      remoteBindAddress.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var ownedServerPID: Int32? {
      let pid = defaults.integer(forKey: Self.ownedServerPIDKey)
      return pid > 0 ? Int32(pid) : nil
    }

    // MARK: Lifecycle

    func start() {
      refreshLaunchAtLoginStatus()
      guard isManagementAvailable, startupTask == nil else { return }
      startupTask = Task { [weak self] in
        await self?.bootstrap()
        self?.startMonitoring()
      }
    }

    /// Waits for startup and returns the local server URL when it is usable.
    func waitUntilReady() async -> URL? {
      guard isManagementAvailable else { return nil }
      start()
      await startupTask?.value
      return isServerRunning ? Self.localServerURL : nil
    }

    var shouldStopServerOnQuit: Bool {
      isManagementAvailable && ownsServer && !isExternalServer &&
        (state == .running || state == .starting)
    }

    func activeRunCount() async -> Int {
      guard let installation else { return 0 }
      return await runner.status(installation)?.activeRunCount ?? 0
    }

    /// Drains active Pi work, then stops the server. Used when quitting.
    func stopForQuit() async -> Bool {
      guard let installation else { return true }
      isQuitting = true
      isWorking = true
      state = .stopping
      defer { isWorking = false }
      let result = await runner.run(installation, arguments: ["stop", "--wait"])
      guard result.succeeded else {
        isQuitting = false
        state = .running
        errorMessage = result.errorMessage(
          fallback: "The Pico server could not finish active work."
        )
        return false
      }
      defaults.removeObject(forKey: Self.ownedServerPIDKey)
      ownsServer = false
      state = .stopped
      return true
    }

    /// Detaches without stopping the server so it keeps running after quit.
    func prepareToQuitLeavingServerRunning() {
      isQuitting = true
      monitorTask?.cancel()
    }

    func restartServer() {
      guard canControlServer else { return }
      isWorking = true
      errorMessage = nil
      notice = nil
      Task {
        defer { isWorking = false }
        _ = await restartAfterDraining()
      }
    }

    func startServer() {
      guard canControlServer, state != .running else { return }
      isWorking = true
      errorMessage = nil
      Task {
        defer { isWorking = false }
        _ = await launch()
      }
    }

    func openLogs() {
      try? FileManager.default.createDirectory(
        at: logsURL,
        withIntermediateDirectories: true
      )
      if !NSWorkspace.shared.open(logsURL) {
        errorMessage = "The Pico logs folder is not available yet."
      }
    }

    // MARK: Launch at login

    func refreshLaunchAtLoginStatus() {
      launchAtLoginStatus = SMAppService.mainApp.status
    }

    func setLaunchAtLogin(_ enabled: Bool) {
      errorMessage = nil
      defaults.set(true, forKey: Self.launchAtLoginConfiguredKey)
      do {
        if enabled {
          try SMAppService.mainApp.register()
        } else {
          try SMAppService.mainApp.unregister()
        }
      } catch {
        errorMessage = error.localizedDescription
      }
      refreshLaunchAtLoginStatus()
    }

    func openLoginItemSettings() {
      SMAppService.openSystemSettingsLoginItems()
    }

    // MARK: Network access

    func copyRemoteAddress() {
      guard let remoteAddressURL else { return }
      NSPasteboard.general.clearContents()
      if !NSPasteboard.general.setString(remoteAddressURL, forType: .string) {
        errorMessage = "The remote address could not be copied."
      }
    }

    func applyNetworkSettings() {
      guard let installation, canControlServer else { return }
      let address = normalizedRemoteBindAddress
      if remoteAccessEnabled && address.isEmpty {
        errorMessage = "Enter the IP address that Pico should listen on."
        return
      }

      isWorking = true
      errorMessage = nil
      Task {
        defer { isWorking = false }
        let arguments = remoteAccessEnabled
          ? ["network", "set", address]
          : ["network", "disable"]
        let result = await runner.run(installation, arguments: arguments)
        guard result.succeeded else {
          errorMessage = result.errorMessage(
            fallback: "The network settings could not be saved."
          )
          return
        }
        await loadNetworkSettings()
        guard await restartAfterDraining() else { return }
        if remoteAccessEnabled && !remoteListenerActive {
          errorMessage =
            "Pico is still available locally, but the configured remote address is not available on this Mac."
        }
      }
    }

    // MARK: Private

    private func bootstrap() async {
      guard let installation else { return }
      state = .checking
      await migrateLegacyBackgroundServices(installation)
      configureDefaultLaunchAtLogin(installation)

      if let status = await runner.status(installation) {
        adopt(status)
        await loadNetworkSettings()
        await reconcileVersionIfNeeded(status, installation: installation)
        return
      }
      if let health = await runner.health(url: Self.healthURL) {
        // Something else owns the Pico port, such as a server using a
        // different data directory. Use it without trying to manage it.
        apply(health)
        isExternalServer = true
        ownsServer = false
        state = .running
        notice = "Using a Pico server that was started outside this app."
        return
      }
      _ = await launch()
      await loadNetworkSettings()
    }

    private func adopt(_ status: PicoServerControlStatus) {
      isExternalServer = false
      ownsServer = status.pid == ownedServerPID
      activeListenHosts = status.listenHosts ?? ["127.0.0.1"]
      serverPort = status.port
      state = status.phase == "draining" ? .stopping : .running
      if
        status.protocolVersion != Self.serverProtocolVersion ||
        status.apiContractVersion != Self.apiContractVersion
      {
        errorMessage =
          "The running Pico server uses an incompatible protocol. Finish active work and restart it."
      }
    }

    private func apply(_ health: PicoServerHealth) {
      activeListenHosts = health.listenHosts ?? ["127.0.0.1"]
      serverPort = health.port ?? 3141
    }

    @discardableResult
    private func launch() async -> Bool {
      guard let installation else { return false }
      state = .starting
      isExternalServer = false
      let pid: pid_t
      do {
        pid = try await runner.launchDetached(installation, logURL: launchLogURL)
      } catch {
        state = .failed(error.localizedDescription)
        return false
      }
      defaults.set(Int(pid), forKey: Self.ownedServerPIDKey)
      ownsServer = true

      let deadline = ContinuousClock.now + Self.startupTimeout
      while ContinuousClock.now < deadline {
        if let health = await runner.health(url: Self.healthURL) {
          apply(health)
          state = .running
          return true
        }
        if kill(pid, 0) != 0 {
          defaults.removeObject(forKey: Self.ownedServerPIDKey)
          ownsServer = false
          state = .failed(
            "The Pico server exited during startup. Check server-launch.log in the logs folder."
          )
          return false
        }
        try? await Task.sleep(for: .milliseconds(250))
      }
      state = .failed("The Pico server did not become available.")
      return false
    }

    private func restartAfterDraining() async -> Bool {
      guard let installation else { return false }
      if await runner.status(installation) != nil {
        state = .stopping
        let result = await runner.run(installation, arguments: ["stop", "--wait"])
        guard result.succeeded else {
          state = .running
          errorMessage = result.errorMessage(
            fallback: "The server could not finish active work before restarting."
          )
          return false
        }
      }
      return await launch()
    }

    private func reconcileVersionIfNeeded(
      _ status: PicoServerControlStatus,
      installation: PicoServerInstallation
    ) async {
      guard
        installation.kind == .bundled,
        ownsServer,
        errorMessage == nil,
        let bundledVersion = Bundle.main.object(
          forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String,
        status.version != bundledVersion
      else { return }

      guard (status.activeRunCount ?? 0) == 0 else {
        notice =
          "A Pico update is ready. Restart the server after active work finishes."
        return
      }
      isWorking = true
      defer { isWorking = false }
      _ = await restartAfterDraining()
    }

    private func startMonitoring() {
      guard monitorTask == nil else { return }
      monitorTask = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: Self.monitorInterval)
          await self?.refreshHealth()
        }
      }
    }

    private func refreshHealth() async {
      guard !isWorking, !isQuitting else { return }
      if let health = await runner.health(url: Self.healthURL) {
        apply(health)
        if state != .running {
          state = .running
        }
        return
      }
      guard !isWorking, !isQuitting, state == .running else { return }

      // The server went away. Relaunch one this app owns, at most once
      // every 30 seconds, so a crash loop does not spin.
      state = .stopped
      guard ownsServer, !isExternalServer else { return }
      if let last = lastAutomaticRestart, Date.now.timeIntervalSince(last) < 30 {
        state = .failed("The Pico server stopped unexpectedly.")
        return
      }
      lastAutomaticRestart = .now
      isWorking = true
      defer { isWorking = false }
      _ = await launch()
    }

    private func loadNetworkSettings() async {
      guard let installation else {
        networkSettingsLoaded = true
        return
      }
      let result = await runner.run(installation, arguments: ["network", "status"])
      defer { networkSettingsLoaded = true }
      guard
        result.succeeded,
        let settings = try? JSONDecoder().decode(
          PicoServerNetworkSettings.self,
          from: Data(result.standardOutput.utf8)
        ),
        settings.ok
      else {
        errorMessage = result.errorMessage(
          fallback: "The network settings could not be loaded."
        )
        return
      }
      remoteAccessEnabled = settings.remoteAccessEnabled
      remoteBindAddress = settings.remoteBindAddress ?? ""
    }

    /// Distribution builds start at login by default, once.
    private func configureDefaultLaunchAtLogin(
      _ installation: PicoServerInstallation
    ) {
      guard
        installation.kind == .bundled,
        !defaults.bool(forKey: Self.launchAtLoginConfiguredKey)
      else { return }
      defaults.set(true, forKey: Self.launchAtLoginConfiguredKey)
      if SMAppService.mainApp.status != .enabled {
        try? SMAppService.mainApp.register()
      }
      refreshLaunchAtLoginStatus()
    }

    /// Earlier builds registered a launchd agent and a separate menu bar
    /// login item. Unregistering the agent stops its server, so only do it
    /// while no Pi work is running.
    private func migrateLegacyBackgroundServices(
      _ installation: PicoServerInstallation
    ) async {
      guard installation.kind == .bundled else { return }
      let menu = SMAppService.loginItem(identifier: Self.legacyMenuBundleIdentifier)
      if menu.status == .enabled || menu.status == .requiresApproval {
        try? await menu.unregister()
      }
      let agent = SMAppService.agent(plistName: Self.legacyServerAgentPlistName)
      guard agent.status == .enabled || agent.status == .requiresApproval else {
        return
      }
      if (await runner.status(installation)?.activeRunCount ?? 0) > 0 {
        notice =
          "Pico will finish moving its server out of launchd after active work completes."
        return
      }
      try? await agent.unregister()
    }
  }
#endif
