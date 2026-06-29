import SwiftUI

struct CompactionBlockView: View {
  var block: CompactionBlock

  var body: some View {
    DisclosureGroup {
      MarkdownTextView(text: summaryText)
        .font(.callout)
        .padding(.top, 6)
    } label: {
      VStack(alignment: .leading, spacing: 4) {
        Text("Context compacted")
          .font(.subheadline.weight(.semibold))
        Text(tokenSummary)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(10)
    .background(.blue.opacity(0.08), in: .rect(cornerRadius: 12))
  }

  private var summaryText: String {
    let trimmedSummary = block.summary.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedSummary.isEmpty ? "No summary available." : trimmedSummary
  }

  private var tokenSummary: String {
    guard let estimatedTokensAfter = block.estimatedTokensAfter,
          estimatedTokensAfter > 0 else {
      return "\(block.tokensBefore.formatted()) tokens before compaction"
    }

    return "\(block.tokensBefore.formatted()) → ~\(estimatedTokensAfter.formatted()) tokens"
  }
}

#Preview {
  CompactionBlockView(
    block: CompactionBlock(
      summary: "Trimmed earlier tool output.",
      tokensBefore: 12000,
      estimatedTokensAfter: 2400
    )
  )
  .padding()
}
