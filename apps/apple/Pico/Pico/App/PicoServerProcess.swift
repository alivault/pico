#if os(macOS)
  import Darwin
  import Foundation

  /// A runnable `pico-server` executable plus the environment it needs.
  struct PicoServerInstallation: Sendable, Equatable {
    enum Kind: Sendable, Equatable {
      /// Bundled inside `Pico.app/Contents/Resources/PicoServer`.
      case bundled
      /// Built from a local repository checkout by a Debug app build.
      case development
    }

    var kind: Kind
    var executable: URL
    var environment: [String: String]
    var workingDirectory: URL?

    static let bundledRelativePath = "Contents/Resources/PicoServer/pico-server"
    static let developmentRootInfoKey = "PicoDevelopmentRepositoryRoot"

    /// Resolves the bundled server first, then a Debug build's repository.
    static func resolve(bundle: Bundle = .main) -> PicoServerInstallation? {
      let bundled = bundle.bundleURL.appending(path: bundledRelativePath)
      if FileManager.default.isExecutableFile(atPath: bundled.path) {
        return PicoServerInstallation(
          kind: .bundled,
          executable: bundled,
          environment: [:],
          workingDirectory: nil
        )
      }

      guard
        let root = bundle.object(forInfoDictionaryKey: developmentRootInfoKey)
          as? String,
        !root.isEmpty
      else { return nil }
      return development(repositoryRoot: URL(filePath: root).standardizedFileURL)
    }

    static func development(repositoryRoot root: URL) -> PicoServerInstallation? {
      let fileManager = FileManager.default
      let candidates = ["debug", "release"]
        .map { root.appending(path: "target/\($0)/pico-server") }
        .filter { fileManager.isExecutableFile(atPath: $0.path) }
      guard
        let executable = candidates.max(by: {
          modificationDate($0) < modificationDate($1)
        })
      else { return nil }

      var environment: [String: String] = [:]
      if let pi = developmentPiBinary(repositoryRoot: root) {
        environment["PICO_PI_BIN"] = pi.path
      }
      let bridge = root.appending(path: "target/pico-pi-bridge")
      if fileManager.isExecutableFile(atPath: bridge.path) {
        environment["PICO_PI_BRIDGE_BIN"] = bridge.path
      }
      // The server resolves `.output/public` and `native/pi-extensions`
      // relative to its working directory during development.
      return PicoServerInstallation(
        kind: .development,
        executable: executable,
        environment: environment,
        workingDirectory: root
      )
    }

    private static func developmentPiBinary(repositoryRoot root: URL) -> URL? {
      let fileManager = FileManager.default
      #if arch(arm64)
        let architecture = "darwin-arm64"
      #else
        let architecture = "darwin-x64"
      #endif
      if
        let data = try? Data(contentsOf: root.appending(path: "package.json")),
        let package = try? JSONSerialization.jsonObject(with: data)
          as? [String: Any],
        let devDependencies = package["devDependencies"] as? [String: Any],
        let version = devDependencies["@earendil-works/pi-coding-agent"]
          as? String
      {
        let pinned = root.appending(path: "artifacts/pi/\(version)/\(architecture)/pi/pi")
        if fileManager.isExecutableFile(atPath: pinned.path) { return pinned }
      }
      let home = fileManager.homeDirectoryForCurrentUser
      return [
        home.appending(path: ".local/bin/pi"),
        URL(filePath: "/opt/homebrew/bin/pi"),
        URL(filePath: "/usr/local/bin/pi"),
      ].first { fileManager.isExecutableFile(atPath: $0.path) }
    }

    private static func modificationDate(_ url: URL) -> Date {
      (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
        .contentModificationDate ?? .distantPast
    }
  }

  /// Snapshot reported by `pico-server status` over the control socket.
  struct PicoServerControlStatus: Decodable, Sendable, Equatable {
    var version: String
    var protocolVersion: Int
    var apiContractVersion: Int?
    var listenHosts: [String]?
    var port: Int
    var phase: String
    var pid: Int32
    var activeRunCount: Int?
  }

  struct PicoServerHealth: Decodable, Sendable {
    var ok: Bool
    var listenHosts: [String]?
    var port: Int?
  }

  struct PicoServerNetworkSettings: Decodable, Sendable {
    var ok: Bool
    var remoteAccessEnabled: Bool
    var remoteBindAddress: String?
  }

  struct PicoServerCommandResult: Sendable {
    var status: Int32
    var standardOutput: String
    var standardError: String

    var succeeded: Bool { status == 0 }

    func errorMessage(fallback: String) -> String {
      let message = standardError.trimmingCharacters(in: .whitespacesAndNewlines)
      return message.isEmpty ? fallback : message
    }
  }

  enum PicoServerLaunchError: LocalizedError {
    case spawnFailed(Int32)

    var errorDescription: String? {
      switch self {
      case .spawnFailed(let code):
        "The Pico server could not be launched (\(String(cString: strerror(code))))."
      }
    }
  }

  /// Runs short `pico-server` subcommands and launches the detached server.
  actor PicoServerCommandRunner {
    func run(
      _ installation: PicoServerInstallation,
      arguments: [String]
    ) -> PicoServerCommandResult {
      let standardOutput = Pipe()
      let standardError = Pipe()
      let process = Process()
      process.executableURL = installation.executable
      process.arguments = arguments
      process.environment = ProcessInfo.processInfo.environment.merging(
        installation.environment
      ) { _, new in new }
      if let workingDirectory = installation.workingDirectory {
        process.currentDirectoryURL = workingDirectory
      }
      process.standardOutput = standardOutput
      process.standardError = standardError
      do {
        try process.run()
        // Read before waiting so large output cannot fill the pipe buffer.
        let output = standardOutput.fileHandleForReading.readDataToEndOfFile()
        let error = standardError.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return PicoServerCommandResult(
          status: process.terminationStatus,
          standardOutput: String(decoding: output, as: UTF8.self),
          standardError: String(decoding: error, as: UTF8.self)
        )
      } catch {
        return PicoServerCommandResult(
          status: -1,
          standardOutput: "",
          standardError: error.localizedDescription
        )
      }
    }

    func status(_ installation: PicoServerInstallation) -> PicoServerControlStatus? {
      struct Response: Decodable { var status: PicoServerControlStatus? }
      let result = run(installation, arguments: ["status"])
      guard result.succeeded else { return nil }
      return try? JSONDecoder().decode(
        Response.self,
        from: Data(result.standardOutput.utf8)
      ).status
    }

    func health(url: URL) async -> PicoServerHealth? {
      var request = URLRequest(url: url)
      request.timeoutInterval = 2
      guard
        let (data, response) = try? await URLSession.shared.data(for: request),
        (response as? HTTPURLResponse)?.statusCode == 200,
        let health = try? JSONDecoder().decode(PicoServerHealth.self, from: data),
        health.ok
      else { return nil }
      return health
    }

    /// Starts `pico-server serve` in its own session so it outlives the app,
    /// like a terminal multiplexer daemon. Output goes to `logURL`.
    func launchDetached(
      _ installation: PicoServerInstallation,
      logURL: URL
    ) throws -> pid_t {
      try FileManager.default.createDirectory(
        at: logURL.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )

      var attributes = posix_spawnattr_t(nil as OpaquePointer?)
      posix_spawnattr_init(&attributes)
      defer { posix_spawnattr_destroy(&attributes) }
      // Start from a clean signal state: app threads may block or ignore
      // signals that the server's async runtime depends on.
      var emptyMask = sigset_t()
      sigemptyset(&emptyMask)
      posix_spawnattr_setsigmask(&attributes, &emptyMask)
      var defaultSignals = sigset_t()
      sigfillset(&defaultSignals)
      posix_spawnattr_setsigdefault(&attributes, &defaultSignals)
      posix_spawnattr_setflags(
        &attributes,
        Int16(
          POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT |
            POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF
        )
      )

      var actions = posix_spawn_file_actions_t(nil as OpaquePointer?)
      posix_spawn_file_actions_init(&actions)
      defer { posix_spawn_file_actions_destroy(&actions) }
      posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
      posix_spawn_file_actions_addopen(
        &actions,
        1,
        logURL.path,
        O_WRONLY | O_CREAT | O_APPEND,
        0o600
      )
      posix_spawn_file_actions_adddup2(&actions, 1, 2)
      if let workingDirectory = installation.workingDirectory {
        posix_spawn_file_actions_addchdir_np(&actions, workingDirectory.path)
      }

      let environment = ProcessInfo.processInfo.environment.merging(
        installation.environment
      ) { _, new in new }
      let arguments = [installation.executable.path, "serve"]
      let argv: [UnsafeMutablePointer<CChar>?] = arguments.map { strdup($0) }
      let envp: [UnsafeMutablePointer<CChar>?] = environment.map {
        strdup("\($0.key)=\($0.value)")
      }
      defer {
        argv.forEach { free($0) }
        envp.forEach { free($0) }
      }

      var pid: pid_t = 0
      let code = (argv + [nil]).withUnsafeBufferPointer { argvBuffer in
        (envp + [nil]).withUnsafeBufferPointer { envpBuffer in
          posix_spawn(
            &pid,
            installation.executable.path,
            &actions,
            &attributes,
            argvBuffer.baseAddress,
            envpBuffer.baseAddress
          )
        }
      }
      guard code == 0 else { throw PicoServerLaunchError.spawnFailed(code) }
      Self.reapWhenExited(pid)
      return pid
    }

    /// The server is our child until the app exits; reap it if it stops first.
    private static func reapWhenExited(_ pid: pid_t) {
      let source = DispatchSource.makeProcessSource(
        identifier: pid,
        eventMask: .exit,
        queue: .global(qos: .utility)
      )
      source.setEventHandler {
        var status: Int32 = 0
        waitpid(pid, &status, WNOHANG)
        source.cancel()
      }
      source.resume()
      // Covers an exit that happened before the source was registered.
      var status: Int32 = 0
      waitpid(pid, &status, WNOHANG)
    }
  }
#endif
