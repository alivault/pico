import SwiftUI

struct ThinkingBlockView: View {
  var block: ThinkingBlock

  var body: some View {
    Group {
      if block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        Text("Thinking…")
          .font(.callout)
          .foregroundStyle(.secondary)
      } else {
        MarkdownTextView(text: block.text)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.leading, 12)
    .padding(.vertical, 4)
    .overlay(alignment: .leading) {
      RoundedRectangle(cornerRadius: 2)
        .fill(.orange.opacity(0.45))
        .frame(width: 2)
    }
  }
}

#Preview {
  ThinkingBlockView(
    block: ThinkingBlock(
      text: "Considering **options** with `inline code`…\n\n```swift\nlet value = 1\n```"
    )
  )
  .padding()
}
