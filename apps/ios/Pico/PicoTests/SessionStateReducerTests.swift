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

  @Test func preservesOptimisticFirstUserMessageAcrossDraftActivation() throws {
    var state = SessionState(
      streaming: true,
      items: [
        .user(
          UserConversationItem(
            itemKey: "local:user:optimistic",
            renderKey: "local:user:optimistic",
            text: "Hello from iPhone",
            images: []
          )
        ),
      ],
      firstMessage: "Hello from iPhone"
    )

    let draftActivationData = Data(
      #"""
      {
        "type": "state_sync",
        "sessionKey": "draft:ios",
        "draft": true,
        "streaming": false,
        "items": []
      }
      """#.utf8
    )
    guard case .stateSync(let draftActivation) = try JSONDecoder().decode(
      PicoServerEvent.self,
      from: draftActivationData
    ) else {
      Issue.record("Expected draft activation state_sync event")
      return
    }

    state.apply(draftActivation)

    #expect(state.sessionKey == "draft:ios")
    #expect(state.items.count == 1)
    #expect(state.firstMessage == "Hello from iPhone")
    guard case .user(let optimisticUser) = state.items.first else {
      Issue.record("Expected optimistic user item")
      return
    }
    #expect(optimisticUser.itemKey == "local:user:optimistic")

    let serverEchoData = Data(
      #"""
      {
        "type": "state_sync",
        "sessionKey": "draft:ios",
        "streaming": true,
        "items": [
          {
            "kind": "user",
            "itemKey": "server:user:1",
            "text": "Hello from iPhone",
            "images": []
          }
        ]
      }
      """#.utf8
    )
    guard case .stateSync(let serverEcho) = try JSONDecoder().decode(
      PicoServerEvent.self,
      from: serverEchoData
    ) else {
      Issue.record("Expected server echo state_sync event")
      return
    }

    state.apply(serverEcho)

    #expect(state.items.count == 1)
    guard case .user(let serverUser) = state.items.first else {
      Issue.record("Expected server user item")
      return
    }
    #expect(serverUser.itemKey == "server:user:1")
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
