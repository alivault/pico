import Foundation
import Testing
@testable import Pico

struct PicoServerEventTests {
  @Test func decodesSessionsEventFixture() throws {
    let data = try FixtureLoader.data(named: "sessions_event")
    let event = try JSONDecoder().decode(PicoServerEvent.self, from: data)

    guard case .sessions(let sessions) = event else {
      Issue.record("Expected sessions event")
      return
    }

    #expect(sessions.activeSessionId == "demo")
    #expect(sessions.snapshots.count == 1)
    #expect(sessions.snapshots.first?.sessions.first?.title == "Demo session")
  }

  @Test func decodesConversationDeltaFixture() throws {
    let data = try FixtureLoader.data(named: "conversation_delta")
    let event = try JSONDecoder().decode(PicoServerEvent.self, from: data)

    guard case .conversationDelta(let delta) = event else {
      Issue.record("Expected conversation delta event")
      return
    }

    #expect(delta.sessionId == "demo")
    #expect(delta.operations.count == 3)
  }

  @Test func decodesPiPerformanceSettings() throws {
    let data = Data(
      #"{"ok":true,"transport":"websocket-cached","cacheRetention":"long"}"#.utf8
    )
    let settings = try JSONDecoder().decode(
      PiPerformanceSettingsResponse.self,
      from: data
    )

    #expect(settings.transport == .websocketCached)
    #expect(settings.cacheRetention == .long)
  }
}
