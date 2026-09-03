import Foundation
import Testing
@testable import Pico

struct SessionStateReducerTests {
  @Test func appliesConversationDeltasWithoutReplacingHistory() throws {
    let data = try FixtureLoader.data(named: "conversation_delta")
    guard case .conversationDelta(let delta) = try JSONDecoder().decode(
      PicoServerEvent.self,
      from: data
    ) else {
      Issue.record("Expected conversation delta event")
      return
    }
    var state = SessionState(sessionId: "demo")

    state.apply(delta)

    #expect(state.streaming)
    #expect(state.items.count == 1)
    guard let item = state.items.first,
          case .assistant(let assistant) = item,
          let assistantBlock = assistant.blocks.first,
          case .text(let block) = assistantBlock else {
      Issue.record("Expected streaming text block")
      return
    }
    #expect(block.text == "Hello world")
  }

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

  @Test func preservesLoadedHistoryWhenLatestWindowResynchronizes() throws {
    let user = { (key: String, text: String) in
      ConversationItem.user(
        UserConversationItem(itemKey: key, text: text, images: [])
      )
    }
    var state = SessionState(
      items: [
        user("u-old", "Older"),
        user("u-current", "Current"),
      ],
      historyOffset: 49,
      historyTotalCount: 51,
      sessionKey: "session:demo"
    )
    let sync = try JSONDecoder().decode(
      StateSyncPayload.self,
      from: Data(
        #"{"type":"state_sync","sessionKey":"session:demo","historyOffset":50,"historyTotalCount":52,"items":[{"kind":"user","itemKey":"u-current","text":"Current","images":[]},{"kind":"user","itemKey":"u-new","text":"New","images":[]}]}"#.utf8
      )
    )

    state.apply(sync)

    #expect(state.historyOffset == 49)
    #expect(state.historyTotalCount == 52)
    #expect(state.items.map(\.id) == ["u-old", "u-current", "u-new"])

    let page = try JSONDecoder().decode(
      SessionHistoryResponse.self,
      from: Data(
        #"{"ok":true,"offset":0,"limit":49,"totalCount":52,"hasMoreBefore":false,"items":[{"kind":"user","itemKey":"u-first","text":"First","images":[]}]}"#.utf8
      )
    )
    state.prependHistory(page)

    #expect(state.historyOffset == 0)
    #expect(state.items.first?.id == "u-first")
  }
}
