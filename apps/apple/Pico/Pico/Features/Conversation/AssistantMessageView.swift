import SwiftUI

struct AssistantMessageView: View {
  var model: AppModel?
  var item: AssistantConversationItem
  var hideThinking: Bool
  var hideToolBlocks: Bool

  var body: some View {
    LazyVStack(alignment: .leading, spacing: 10, pinnedViews: [.sectionHeaders]) {
      ForEach(visibleBlocks) { block in
        AssistantBlockView(model: model, block: block)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var visibleBlocks: [AssistantBlock] {
    item.blocks.filter { block in
      if case .thinking = block, hideThinking {
        return false
      }
      if case .tool(let tool) = block {
        if hideToolBlocks { return false }
        if ToolFormatting.isPendingUnclassifiedToolBlock(tool) { return false }
      }
      return true
    }
  }
}

#Preview {
  AssistantMessageView(
    model: nil,
    item: AssistantConversationItem(
      blocks: [.text(TextBlock(text: "Hello from Pico."))],
      streaming: false
    ),
    hideThinking: false,
    hideToolBlocks: false
  )
  .padding()
}
