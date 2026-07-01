import SwiftUI

struct AssistantBlockView: View {
  var model: AppModel?
  var block: AssistantBlock

  var body: some View {
    switch block {
    case .text(let text):
      MarkdownTextView(text: text.text, isError: text.isError == true)
    case .thinking(let thinking):
      ThinkingBlockView(block: thinking)
    case .tool(let tool):
      ToolBlockView(model: model, block: tool)
    case .compaction(let compaction):
      CompactionBlockView(block: compaction)
    case .unknown:
      EmptyView()
    }
  }
}

#Preview {
  AssistantBlockView(model: nil, block: .text(TextBlock(text: "Hello **Pico**.")))
    .padding()
}
