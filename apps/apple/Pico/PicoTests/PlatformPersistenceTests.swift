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

  @Test
  func isolatesViewerStateByServerURL() throws {
    let suiteName = "Pico.ServerProfilePersistenceTests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let store = ConnectionStore(defaults: defaults)
    let stableURL = try #require(URL(string: "http://localhost:3141"))
    let developmentURL = try #require(URL(string: "http://localhost:4142"))

    store.saveServerURL(stableURL)
    let stableContextId = store.contextId
    let draftStore = DraftStore(defaults: defaults)
    draftStore.saveDraft(
      "stable draft",
      contextId: stableContextId,
      sessionKey: nil
    )
    store.saveLastEventId("stable-event")
    store.rememberSidebarDirectory("/stable/project")

    store.saveServerURL(developmentURL)
    let developmentContextId = store.contextId
    #expect(developmentContextId != stableContextId)
    #expect(store.lastEventId == nil)
    #expect(store.sidebarDirectories.isEmpty)
    #expect(
      draftStore.readDraft(
        contextId: developmentContextId,
        sessionKey: nil
      ).isEmpty
    )
    draftStore.saveDraft(
      "development draft",
      contextId: developmentContextId,
      sessionKey: nil
    )
    store.saveLastEventId("development-event")
    store.rememberSidebarDirectory("/development/project")

    store.saveServerURL(stableURL)
    #expect(store.contextId == stableContextId)
    #expect(store.lastEventId == "stable-event")
    #expect(store.sidebarDirectories == ["/stable/project"])
    #expect(
      draftStore.readDraft(contextId: store.contextId, sessionKey: nil) ==
        "stable draft"
    )

    store.saveServerURL(developmentURL)
    #expect(store.contextId == developmentContextId)
    #expect(store.lastEventId == "development-event")
    #expect(store.sidebarDirectories == ["/development/project"])
    #expect(
      draftStore.readDraft(contextId: store.contextId, sessionKey: nil) ==
        "development draft"
    )

    let restoredStore = ConnectionStore(defaults: defaults)
    #expect(restoredStore.contextId == developmentContextId)
    #expect(restoredStore.lastEventId == "development-event")
    #expect(restoredStore.sidebarDirectories == ["/development/project"])
  }
}
