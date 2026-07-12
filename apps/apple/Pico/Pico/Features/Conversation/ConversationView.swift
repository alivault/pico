import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct ConversationView: View {
  private static let bottomAnchorId = "conversation-bottom"
  private static let bottomStickyThreshold: CGFloat = 48

  var model: AppModel? = nil
  var items: [ConversationItem]
  var hideThinking: Bool
  var hideToolBlocks: Bool = false
  var hiddenThinkingPreview: String?
  var isStreaming: Bool = false
  var isCompacting: Bool = false
  var workingLabel: String = "Working…"
  var bottomContentInset: CGFloat = 0
  var canEditUserMessages = true
  var canBranchAssistantMessages = true
  var onEditUserMessage: (UserConversationItem) -> Void = { _ in }
  var onBranchAssistantMessage: (AssistantConversationItem) -> Void = { _ in }
  var onCancelCompaction: () -> Void = {}

  @State private var isNearBottom = true
  @State private var followsLatestContent = true
  @State private var scrollPhase: ScrollPhase = .idle
  @State private var interactionStartOffsetY: CGFloat = 0

  var body: some View {
    ScrollViewReader { proxy in
      ZStack(alignment: .bottom) {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 16, pinnedViews: [.sectionHeaders]) {
            if items.isEmpty {
              ContentUnavailableView(
                "No conversation yet",
                picoSystemImage: "message",
                description: Text("Start a session from the composer below.")
              )
              .frame(maxWidth: .infinity, minHeight: 280)
            } else {
              ForEach(visibleElements) { element in
                ConversationElementView(
                  model: model,
                  element: element,
                  canEditUserMessages: canEditUserMessages,
                  canBranchAssistantMessages: canBranchAssistantMessages,
                  onEditUserMessage: onEditUserMessage,
                  onBranchAssistantMessage: onBranchAssistantMessage
                )
                .id(element.id)
              }

              if shouldShowWorkingIndicator {
                ConversationWorkingIndicator(
                  label: workingIndicatorLabel,
                  onCancel: isCompacting ? onCancelCompaction : nil
                )
              }

              Color.clear
                .frame(height: max(1, bottomContentInset))
                .id(Self.bottomAnchorId)
            }
          }
          .padding()
          .textSelection(.enabled)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.topLeading, for: .alignment)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
          Self.isScrollGeometryNearBottom(geometry)
        } action: { _, isNearBottom in
          self.isNearBottom = isNearBottom
          if isNearBottom {
            followsLatestContent = true
          } else if scrollPhase == .interacting {
            followsLatestContent = false
          }
        }
        .onScrollPhaseChange { oldPhase, newPhase, context in
          updateFollowState(
            oldPhase: oldPhase,
            newPhase: newPhase,
            geometry: context.geometry
          )
        }
        .onChange(of: conversationIdentity) {
          followsLatestContent = true
          scrollToBottom(proxy)
        }
        .onChange(of: isStreaming) {
          guard isStreaming else { return }
          followsLatestContent = true
          scrollToBottom(proxy)
        }
        .onChange(of: isCompacting) {
          guard isCompacting else { return }
          followsLatestContent = true
          scrollToBottom(proxy)
        }
        .onChange(of: scrollSignature) {
          guard followsLatestContent else { return }
          scrollToBottom(proxy)
        }

        if shouldShowBackToBottomButton {
          BackToBottomButton {
            followsLatestContent = true
            scrollToBottom(proxy)
          }
          .padding(.bottom, backToBottomButtonBottomPadding)
          .transition(.opacity.combined(with: .scale(scale: 0.92)))
          .zIndex(1)
        }
      }
      .animation(.smooth(duration: 0.2), value: shouldShowBackToBottomButton)
    }
  }

  private var visibleItems: [ConversationItem] {
    items.filter { item in
      switch item {
      case .assistant(let assistant):
        Self.assistantItemHasVisibleContent(
          assistant,
          hideThinking: hideThinking,
          hideToolBlocks: hideToolBlocks
        )
      case .user:
        true
      case .unknown:
        false
      }
    }
  }

  private var visibleElements: [ConversationElement] {
    let items = visibleItems
    return items.indices.flatMap { index -> [ConversationElement] in
      let item = items[index]

      switch item {
      case .assistant(let assistant):
        let blocks = Self.visibleAssistantBlocks(
          assistant,
          hideThinking: hideThinking,
          hideToolBlocks: hideToolBlocks
        )
        let blockElements: [ConversationElement] = blocks.map { block in
          .assistantBlock(assistantId: assistant.id, block: block)
        }
        let showsBranch = isLastAssistantMessageInTurn(at: index, in: items)
        guard shouldShowAssistantActions(
          assistant,
          visibleBlocks: blocks,
          showsBranch: showsBranch
        ) else {
          return blockElements
        }

        return blockElements + [.assistantActions(assistant, showsBranch: showsBranch)]
      case .user(let user):
        return [.user(user)]
      case .unknown:
        return []
      }
    }
  }

  private var shouldShowBackToBottomButton: Bool {
    !isNearBottom && !visibleItems.isEmpty
  }

  private var backToBottomButtonBottomPadding: CGFloat {
    max(16, bottomContentInset)
  }

  private func shouldShowAssistantActions(
    _ assistant: AssistantConversationItem,
    visibleBlocks: [AssistantBlock],
    showsBranch: Bool
  ) -> Bool {
    !Self.assistantItemIsWorking(assistant) && !visibleBlocks.isEmpty &&
      (Self.assistantText(assistant) != nil ||
        (showsBranch && assistant.branchEntryId?.isEmpty == false))
  }

  private static func assistantItemIsWorking(
    _ item: AssistantConversationItem
  ) -> Bool {
    item.streaming == true ||
      item.done == false ||
      item.blocks.contains { block in
        guard case .tool(let tool) = block else { return false }
        return tool.running
      }
  }

  private func isLastAssistantMessageInTurn(
    at index: Int,
    in items: [ConversationItem]
  ) -> Bool {
    guard items.indices.contains(index),
          case .assistant = items[index] else {
      return false
    }

    for nextItem in items.dropFirst(index + 1) {
      switch nextItem {
      case .assistant:
        return false
      case .user:
        return true
      case .unknown:
        continue
      }
    }

    return true
  }

  fileprivate static func assistantText(_ assistant: AssistantConversationItem) -> String? {
    let text = assistant.blocks.compactMap { block in
      guard case .text(let text) = block else { return nil }
      let trimmedText = text.text.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmedText.isEmpty ? nil : trimmedText
    }
    .joined(separator: "\n\n")

    return text.isEmpty ? nil : text
  }

  private var shouldShowWorkingIndicator: Bool {
    isCompacting ||
      (isStreaming && (hasHiddenThinkingPreview || !hasVisibleStreamingAssistant))
  }

  private var hasHiddenThinkingPreview: Bool {
    hideThinking && normalized(hiddenThinkingPreview) != nil
  }

  private var workingIndicatorLabel: String {
    if isCompacting {
      return "Compacting context…"
    }

    if hasHiddenThinkingPreview, let hiddenThinkingPreview = normalized(hiddenThinkingPreview) {
      return hiddenThinkingPreview
    }

    return normalized(workingLabel) ?? "Working…"
  }

  private var hasVisibleStreamingAssistant: Bool {
    items.contains { item in
      guard case .assistant(let assistant) = item,
            assistant.streaming == true else {
        return false
      }

      return Self.assistantItemHasVisibleContent(
        assistant,
        hideThinking: hideThinking,
        hideToolBlocks: hideToolBlocks
      )
    }
  }

  private var conversationIdentity: String {
    items.first?.id ?? "empty"
  }

  private var scrollSignature: String {
    let itemSignature = items.suffix(4).map(Self.itemScrollSignature).joined(separator: "|")
    return [
      "count:\(items.count)",
      "streaming:\(isStreaming)",
      "compacting:\(isCompacting)",
      "hideThinking:\(hideThinking)",
      "hideToolBlocks:\(hideToolBlocks)",
      "working:\(workingIndicatorLabel)",
      itemSignature,
    ].joined(separator: "|")
  }

  private static func itemScrollSignature(_ item: ConversationItem) -> String {
    switch item {
    case .user(let user):
      "user:\(user.id):\(user.text.count):\(user.images.count)"
    case .assistant(let assistant):
      "assistant:\(assistant.id):\(assistant.streaming == true):" +
        assistant.blocks.map(blockScrollSignature).joined(separator: ",")
    case .unknown(let kind):
      "unknown:\(kind)"
    }
  }

  private static func blockScrollSignature(_ block: AssistantBlock) -> String {
    switch block {
    case .text(let text):
      "text:\(text.id):\(text.text.count)"
    case .thinking(let thinking):
      "thinking:\(thinking.id):\(thinking.text.count):\(thinking.summaryLabel ?? "")"
    case .tool(let tool):
      ToolFormatting.scrollSignature(for: tool)
    case .compaction(let compaction):
      "compaction:\(compaction.id):\(compaction.summary.count)"
    case .unknown(let block):
      "unknown:\(block.id)"
    }
  }

  private static func assistantItemHasVisibleContent(
    _ item: AssistantConversationItem,
    hideThinking: Bool,
    hideToolBlocks: Bool
  ) -> Bool {
    item.blocks.contains { block in
      isVisibleAssistantBlock(
        block,
        hideThinking: hideThinking,
        hideToolBlocks: hideToolBlocks
      )
    }
  }

  private static func visibleAssistantBlocks(
    _ item: AssistantConversationItem,
    hideThinking: Bool,
    hideToolBlocks: Bool
  ) -> [AssistantBlock] {
    item.blocks.filter { block in
      isVisibleAssistantBlock(
        block,
        hideThinking: hideThinking,
        hideToolBlocks: hideToolBlocks
      )
    }
  }

  private static func isVisibleAssistantBlock(
    _ block: AssistantBlock,
    hideThinking: Bool,
    hideToolBlocks: Bool
  ) -> Bool {
    if case .thinking = block, hideThinking { return false }
    if case .tool(let tool) = block {
      if hideToolBlocks { return false }
      if ToolFormatting.isPendingUnclassifiedToolBlock(tool) { return false }
    }
    return true
  }

  private func normalized(_ value: String?) -> String? {
    let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedValue.isEmpty ? nil : trimmedValue
  }

  private func updateFollowState(
    oldPhase: ScrollPhase,
    newPhase: ScrollPhase,
    geometry: ScrollGeometry
  ) {
    scrollPhase = newPhase

    if newPhase == .interacting {
      interactionStartOffsetY = geometry.contentOffset.y
    }

    if Self.isScrollGeometryNearBottom(geometry) {
      followsLatestContent = true
      return
    }

    if oldPhase == .interacting, newPhase != .animating,
       geometry.contentOffset.y < interactionStartOffsetY - 1 {
      followsLatestContent = false
    }
  }

  private static func isScrollGeometryNearBottom(_ geometry: ScrollGeometry) -> Bool {
    let bottomDistance = geometry.contentSize.height - geometry.visibleRect.maxY
    return bottomDistance < bottomStickyThreshold
  }

  private func scrollToBottom(_ proxy: ScrollViewProxy) {
    withAnimation(.smooth(duration: 0.2)) {
      proxy.scrollTo(Self.bottomAnchorId, anchor: .bottom)
    }
  }
}

private enum ConversationElement: Identifiable {
  case user(UserConversationItem)
  case assistantBlock(assistantId: String, block: AssistantBlock)
  case assistantActions(AssistantConversationItem, showsBranch: Bool)

  var id: String {
    switch self {
    case .user(let user):
      user.id
    case .assistantBlock(let assistantId, let block):
      "\(assistantId):\(block.id)"
    case .assistantActions(let assistant, _):
      "\(assistant.id):actions"
    }
  }
}

private struct ConversationElementView: View {
  var model: AppModel?
  var element: ConversationElement
  var canEditUserMessages: Bool
  var canBranchAssistantMessages: Bool
  var onEditUserMessage: (UserConversationItem) -> Void
  var onBranchAssistantMessage: (AssistantConversationItem) -> Void

  var body: some View {
    switch element {
    case .user(let user):
      UserMessageView(
        item: user,
        canEdit: canEditUserMessages,
        onEdit: onEditUserMessage
      )
    case .assistantBlock(_, let block):
      AssistantBlockView(model: model, block: block)
    case .assistantActions(let assistant, let showsBranch):
      AssistantMessageActionsView(
        item: assistant,
        canBranch: canBranchAssistantMessages,
        showsBranch: showsBranch,
        onBranch: onBranchAssistantMessage
      )
    }
  }
}

private struct AssistantMessageActionsView: View {
  var item: AssistantConversationItem
  var canBranch: Bool
  var showsBranch: Bool
  var onBranch: (AssistantConversationItem) -> Void

  @State private var didCopy = false
  @State private var copyFeedbackToken = 0

  var body: some View {
    HStack(spacing: 6) {
      Button(action: copyMessage) {
        PicoIcon(systemName: didCopy ? "checkmark" : "doc.on.doc", size: 20)
          .contentTransition(.symbolEffect(.replace))
          .frame(width: 30, height: 30)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .disabled(copyText.isEmpty)
      .accessibilityLabel(didCopy ? "Copied" : "Copy")

      if showsBranch {
        Button(action: { onBranch(item) }) {
          PicoIcon(systemName: "arrow.triangle.branch", size: 20)
            .frame(width: 30, height: 30)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .disabled(!canBranch || item.branchEntryId?.isEmpty != false)
        .accessibilityLabel("Branch in New Chat")
      }
    }
    .font(.subheadline.weight(.semibold))
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
  }

  private var copyText: String {
    ConversationView.assistantText(item) ?? ""
  }

  private func copyMessage() {
    let text = copyText
    guard !text.isEmpty else { return }

    UIPasteboard.general.string = text
    showCopiedConfirmation()
  }

  private func showCopiedConfirmation() {
    copyFeedbackToken += 1
    let token = copyFeedbackToken
    didCopy = true

    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(1400))
      guard copyFeedbackToken == token else { return }
      didCopy = false
    }
  }
}

private struct BackToBottomButton: View {
  var action: () -> Void

  var body: some View {
    Button("Jump to latest message", picoSystemImage: "arrow.down", action: action)
      .labelStyle(.iconOnly)
      .font(.headline.weight(.semibold))
      .foregroundStyle(.primary)
      .frame(width: 44, height: 44)
      .contentShape(Circle())
      .picoGlassEffect(in: Circle())
      .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
      .buttonStyle(.plain)
      .highPriorityGesture(TapGesture().onEnded(action), including: .all)
      .accessibilityLabel("Jump to latest message")
  }
}

private struct ConversationWorkingIndicator: View {
  var label: String
  var onCancel: (() -> Void)?

  var body: some View {
    HStack(spacing: 10) {
      ProgressView()

      Text(label)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(3)

      if let onCancel {
        Button("Cancel", action: onCancel)
          .font(.caption.weight(.semibold))
          .picoGlassButtonStyle(shape: .capsule)
          .controlSize(.small)
          .keyboardShortcut(.cancelAction)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: onCancel == nil ? .combine : .contain)
  }
}

#Preview {
  ConversationView(items: [], hideThinking: false, isStreaming: true)
}
