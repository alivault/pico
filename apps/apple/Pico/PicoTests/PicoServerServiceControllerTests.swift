import Foundation
import Testing
@testable import Pico

#if os(macOS)
  @Suite("Pico macOS service")
  @MainActor
  struct PicoServerServiceControllerTests {
    @Test("Unpackaged builds report background services unavailable")
    func unpackagedServiceState() {
      let suiteName = "PicoServerServiceControllerTests.\(UUID().uuidString)"
      let defaults = UserDefaults(suiteName: suiteName) ?? .standard
      defer { defaults.removePersistentDomain(forName: suiteName) }
      let controller = PicoServerServiceController(defaults: defaults)

      controller.start()

      #expect(controller.startAtLogin)
      #expect(!controller.isAvailable)
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
  }
#endif
