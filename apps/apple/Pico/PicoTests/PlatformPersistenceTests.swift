import Foundation
import Testing

@testable import Pico

@MainActor
struct PlatformPersistenceTests {
  @Test
  func normalizesServerHostsAndPreservesExplicitURLs() {
    #expect(
      AppModel.normalizedServerURL(from: "localhost")?.absoluteString ==
        "http://localhost:3141"
    )
    #expect(
      AppModel.normalizedServerURL(from: "100.64.0.10")?.absoluteString ==
        "http://100.64.0.10:3141"
    )
    #expect(
      AppModel.normalizedServerURL(from: "server.internal:4000")?.absoluteString ==
        "http://server.internal:4000"
    )
    #expect(
      AppModel.normalizedServerURL(from: "fd7a:115c:a1e0::1")?.absoluteString ==
        "http://[fd7a:115c:a1e0::1]:3141"
    )
    #expect(
      AppModel.normalizedServerURL(from: "https://pico.example.test")?.absoluteString ==
        "https://pico.example.test"
    )
    #expect(AppModel.normalizedServerURL(from: "ftp://pico.example.test") == nil)
    #expect(AppModel.normalizedServerURL(from: "http://user@host") == nil)
  }

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
