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
}
