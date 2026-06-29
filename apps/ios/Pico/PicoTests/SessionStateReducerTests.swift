import Foundation
import Testing
@testable import Pico

struct SessionStateReducerTests {
  @Test func appliesInitialStateAndPatch() throws {
    let decoder = JSONDecoder()
    let initialData = try FixtureLoader.data(named: "state_sync_initial")
    let patchData = try FixtureLoader.data(named: "state_sync_patch")

    guard case .stateSync(let initialSync) = try decoder.decode(PicoServerEvent.self, from: initialData) else {
      Issue.record("Expected state_sync fixture")
      return
    }

    guard case .stateSync(let patchSync) = try decoder.decode(PicoServerEvent.self, from: patchData) else {
      Issue.record("Expected patch state_sync fixture")
      return
    }

    var state = SessionState()
    state.apply(initialSync)

    #expect(state.connected)
    #expect(state.sessionId == "demo")
    #expect(state.items.count == 2)
    #expect(state.streaming)

    state.apply(patchSync)

    #expect(!state.streaming)
    #expect(state.items.count == 2)

    guard case .assistant(let assistant) = state.items.last else {
      Issue.record("Expected assistant item")
      return
    }

    #expect(assistant.streaming == false)
    #expect(assistant.blocks.count == 1)
  }

  @Test func tracksHiddenThinkingPreviewForStreamingTurn() throws {
    let data = Data(
      #"""
      {
        "type": "state_sync",
        "sessionKey": "session:thinking",
        "streaming": true,
        "hideThinkingBlock": true,
        "items": [
          {
            "kind": "user",
            "itemKey": "u1",
            "text": "Previous request",
            "images": []
          },
          {
            "kind": "assistant",
            "itemKey": "a1",
            "streaming": false,
            "blocks": [
              {
                "type": "thinking",
                "blockKey": "old-thinking",
                "text": "Old thinking"
              }
            ]
          },
          {
            "kind": "user",
            "itemKey": "u2",
            "text": "Current request",
            "images": []
          },
          {
            "kind": "assistant",
            "itemKey": "streaming",
            "streaming": true,
            "blocks": [
              {
                "type": "thinking",
                "blockKey": "current-thinking",
                "thinking": "Checking **files**\n\nThen editing."
              }
            ]
          }
        ]
      }
      """#.utf8
    )

    guard case .stateSync(let sync) = try JSONDecoder().decode(PicoServerEvent.self, from: data) else {
      Issue.record("Expected state_sync event")
      return
    }

    var state = SessionState()
    state.apply(sync)

    #expect(state.hideThinkingBlock)
    #expect(state.hiddenThinkingPreview == "Checking files")

    let stoppedData = Data(
      #"""
      {
        "type": "state_sync",
        "sessionKey": "session:thinking",
        "streaming": false,
        "hideThinkingBlock": false
      }
      """#.utf8
    )
    guard case .stateSync(let stoppedSync) = try JSONDecoder().decode(
      PicoServerEvent.self,
      from: stoppedData
    ) else {
      Issue.record("Expected stopped state_sync event")
      return
    }

    state.apply(stoppedSync)
    #expect(state.hiddenThinkingPreview == nil)
  }
}
