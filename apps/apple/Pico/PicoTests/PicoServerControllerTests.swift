import Foundation
import Testing
@testable import Pico

#if os(macOS)
  @Suite("Pico macOS server controller")
  @MainActor
  struct PicoServerControllerTests {
    @Test("Builds without a server installation cannot manage one")
    func missingInstallation() {
      let suiteName = "PicoServerControllerTests.\(UUID().uuidString)"
      let defaults = UserDefaults(suiteName: suiteName) ?? .standard
      defer { defaults.removePersistentDomain(forName: suiteName) }
      let controller = PicoServerController(
        defaults: defaults,
        installation: nil
      )

      #expect(!controller.isManagementAvailable)
      #expect(controller.state == .stopped)
      #expect(!controller.shouldStopServerOnQuit)
    }

    @Test("Dogfood clients never manage the production server")
    func dogfoodClient() throws {
      let installation = PicoServerInstallation(
        kind: .bundled,
        executable: URL(filePath: "/usr/bin/true"),
        environment: [:],
        workingDirectory: nil
      )
      let controller = PicoServerController(
        installation: installation,
        allowsManagement: false
      )

      #expect(!controller.isManagementAvailable)
      #expect(!controller.canControlServer)
      #expect(!controller.shouldStopServerOnQuit)
    }

    @Test("Debug builds resolve the server, Pi, and bridge from the repository")
    func developmentInstallation() throws {
      let root = FileManager.default.temporaryDirectory
        .appending(path: "pico-dev-\(UUID().uuidString)")
      defer { try? FileManager.default.removeItem(at: root) }
      #if arch(arm64)
        let architecture = "darwin-arm64"
      #else
        let architecture = "darwin-x64"
      #endif
      let server = root.appending(path: "target/debug/pico-server")
      let bridge = root.appending(path: "target/pico-pi-bridge")
      let pi = root.appending(path: "artifacts/pi/1.2.3/\(architecture)/pi/pi")
      for executable in [server, bridge, pi] {
        try makeExecutable(at: executable)
      }
      try Data(
        #"{"devDependencies":{"@earendil-works/pi-coding-agent":"1.2.3"}}"#.utf8
      ).write(to: root.appending(path: "package.json"))

      let installation = try #require(
        PicoServerInstallation.development(repositoryRoot: root)
      )

      #expect(installation.kind == .development)
      #expect(installation.executable.path == server.path)
      #expect(installation.environment["PICO_PI_BIN"] == pi.path)
      #expect(installation.environment["PICO_PI_BRIDGE_BIN"] == bridge.path)
      #expect(installation.workingDirectory == root)
    }

    @Test("Repositories without a built server are not runnable")
    func missingDevelopmentServer() {
      let root = FileManager.default.temporaryDirectory
        .appending(path: "pico-dev-\(UUID().uuidString)")

      #expect(PicoServerInstallation.development(repositoryRoot: root) == nil)
    }

    @Test("New-chat deep links reset the composer")
    func newChatDeepLink() throws {
      let model = AppModel()
      model.isComposingNewSession = false
      model.composerText = "Existing draft"
      let url = try #require(URL(string: "pico://new"))

      model.handleDeepLink(url)

      #expect(model.isComposingNewSession)
      #expect(model.composerText.isEmpty)
    }

    private func makeExecutable(at url: URL) throws {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try Data("#!/bin/sh\n".utf8).write(to: url)
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o755],
        ofItemAtPath: url.path
      )
    }
  }
#endif
