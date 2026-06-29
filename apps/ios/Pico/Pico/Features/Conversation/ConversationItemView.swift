import SwiftUI

struct ConversationItemView: View {
  var item: ConversationItem
  var hideThinking: Bool
  var hideToolBlocks: Bool

  var body: some View {
    switch item {
    case .user(let user):
      UserMessageView(item: user)
    case .assistant(let assistant):
      AssistantMessageView(
        item: assistant,
        hideThinking: hideThinking,
        hideToolBlocks: hideToolBlocks
      )
    case .unknown:
      EmptyView()
    }
  }
}
