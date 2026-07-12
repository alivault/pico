import Foundation
import Testing

@testable import Pico

@MainActor
struct PlatformPersistenceTests {
  @Test
  func storesConnectionAndDraftValuesUnderPlatformKeys() throws {
    let suiteName = "Pico.PlatformPersistenceTests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let connectionStore = ConnectionStore(defaults: defaults)
    let serverURL = try #require(URL(string: "http://localhost:3141"))
    connectionStore.saveServerURL(serverURL)

    let draftStore = DraftStore(defaults: defaults)
    draftStore.saveDraft(
      "platform draft",
      contextId: connectionStore.contextId,
      sessionKey: "session"
    )

    #if os(macOS)
      #expect(
        defaults.string(forKey: "pico.macos.serverURL") == "http://localhost:3141"
      )
      #expect(
        defaults.string(
          forKey: "pico.macos.draft.\(connectionStore.contextId).session"
        ) == "platform draft"
      )
    #else
      #expect(
        defaults.string(forKey: "pico.ios.serverURL") == "http://localhost:3141"
      )
      #expect(
        defaults.string(
          forKey: "pico.ios.draft.\(connectionStore.contextId).session"
        ) == "platform draft"
      )
    #endif
  }
}
