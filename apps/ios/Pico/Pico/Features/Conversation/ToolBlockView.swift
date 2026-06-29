import SwiftUI

struct ToolBlockView: View {
  var block: ToolBlock

  @State private var isExpanded = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      headerButton
        .zIndex(1)

      if isExpanded {
        Divider()
          .zIndex(0)
        ToolBlockBodyView(block: block)
          .padding(12)
          .transition(.opacity)
          .zIndex(0)
      }
    }
    .background(cardBackground, in: cardShape)
    .overlay {
      cardShape.stroke(cardBorderColor, lineWidth: 1)
    }
    .clipShape(cardShape)
    .onAppear(perform: syncExpandedStateFromMemory)
    .onChange(of: disclosureStateKey) {
      syncExpandedStateFromMemory()
    }
  }

  private var headerButton: some View {
    Button {
      withAnimation(.smooth(duration: 0.2)) {
        isExpanded.toggle()
        ToolBlockDisclosureMemory.setOpen(isExpanded, for: disclosureStateKey)
      }
    } label: {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 8) {
            Text(ToolFormatting.displayName(for: block.name))
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.primary)
              .lineLimit(1)

            if block.running {
              ToolStatusBadge(text: "Running", tint: .orange)
            } else if block.isError {
              ToolStatusBadge(text: "Error", tint: .red)
            }
          }

          Text(ToolFormatting.summary(for: block))
            .font(.caption)
            .foregroundStyle(block.isError ? .red : .secondary)
            .lineLimit(1)
            .truncationMode(.middle)
        }

        Spacer(minLength: 8)

        if let stats = editStats {
          EditDiffStatCountsView(stats: stats)
        }

        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .frame(width: 12)
          .accessibilityHidden(true)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(ToolFormatting.displayName(for: block.name))
    .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
    .accessibilityHint(isExpanded ? "Collapse tool details" : "Expand tool details")
  }

  private var editStats: ToolEditDiffStatCounts? {
    guard block.name == "edit", !block.running else { return nil }

    let stats = ToolFormatting.editDiffStats(for: ToolFormatting.patchText(for: block))
    guard stats.additions > 0 || stats.removals > 0 else { return nil }
    return stats
  }

  private var disclosureStateKey: String {
    ToolFormatting.collapsibleStateKey(for: block)
  }

  private var cardShape: RoundedRectangle {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
  }

  private var cardBackground: Color {
    if block.running {
      return .orange.opacity(0.08)
    }

    if block.isError {
      return .red.opacity(0.08)
    }

    return .secondary.opacity(0.08)
  }

  private var cardBorderColor: Color {
    if block.running {
      return .orange.opacity(0.28)
    }

    if block.isError {
      return .red.opacity(0.28)
    }

    return .secondary.opacity(0.16)
  }

  private func syncExpandedStateFromMemory() {
    isExpanded = ToolBlockDisclosureMemory.isOpen(disclosureStateKey)
  }
}

@MainActor
private enum ToolBlockDisclosureMemory {
  private static var openKeys: [String] = []
  private static let limit = 500

  static func isOpen(_ key: String) -> Bool {
    openKeys.contains(key)
  }

  static func setOpen(_ isOpen: Bool, for key: String) {
    openKeys.removeAll { $0 == key }
    guard isOpen else { return }

    openKeys.append(key)
    if openKeys.count > limit {
      openKeys.removeFirst(openKeys.count - limit)
    }
  }
}

private struct ToolStatusBadge: View {
  var text: String
  var tint: Color

  var body: some View {
    Text(text)
      .font(.caption2.weight(.semibold))
      .foregroundStyle(tint)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(tint.opacity(0.12), in: .capsule)
      .accessibilityHidden(true)
  }
}

private struct EditDiffStatCountsView: View {
  var stats: ToolEditDiffStatCounts

  var body: some View {
    HStack(spacing: 6) {
      Text("+\(stats.additions)")
        .foregroundStyle(.green)
      Text("−\(stats.removals)")
        .foregroundStyle(.red)
    }
    .font(.caption.monospacedDigit().weight(.semibold))
    .accessibilityLabel("\(stats.additions) lines added, \(stats.removals) lines removed")
  }
}

#Preview {
  VStack(spacing: 12) {
    ToolBlockView(
      block: ToolBlock(
        name: "bash",
        args: .object(["command": .string("rg \"Tool\" apps/ios")]),
        output: "\u{001B}[32mapps/ios/Pico/Pico/Features/Conversation/ToolBlockView.swift\u{001B}[0m\n",
        running: false
      )
    )

    ToolBlockView(
      block: ToolBlock(
        name: "edit",
        output: "Successfully replaced 1 block(s) in README.md.",
        details: .object([
          "patch": .string("@@ -1 +1 @@\n-old\n+new")
        ]),
        running: false
      )
    )
  }
  .padding()
}
