import SwiftUI
import UniformTypeIdentifiers

struct PendingMessagesView: View {
  private static let maxExpandedBodyHeight: CGFloat = 320

  var messages: [PendingUserMessage]
  var onReorderMessages: ([PendingUserMessage]) -> Void = { _ in }
  @State private var isExpanded = false
  @State private var expandedBodyContentHeight: CGFloat = 0
  @State private var pendingOrder: [String] = []
  @State private var pendingBehaviorOverrides: [String: StreamingBehavior] = [:]
  @State private var draggingPendingId: String?

  var body: some View {
    if !messages.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        Button(action: toggleExpanded) {
          header
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Queue")
        .accessibilityValue(accessibilityValue)

        if isExpanded {
          Divider()

          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(
                Array(sections.enumerated()),
                id: \.element.id
              ) { index, section in
                if index > 0 {
                  Divider()
                }

                PendingMessagesSectionView(
                  section: section,
                  draggingPendingId: $draggingPendingId,
                  onDrag: beginDragging,
                  moveMessage: movePendingMessage,
                  moveMessageToSectionEnd: movePendingMessageToSectionEnd,
                  commitReorder: commitPendingReorder
                )
              }
            }
            .background {
              GeometryReader { proxy in
                Color.clear.preference(
                  key: PendingQueueBodyHeightPreferenceKey.self,
                  value: proxy.size.height
                )
              }
            }
          }
          .frame(height: expandedBodyHeight, alignment: .top)
          .frame(maxHeight: Self.maxExpandedBodyHeight, alignment: .top)
          .onPreferenceChange(PendingQueueBodyHeightPreferenceKey.self) { height in
            expandedBodyContentHeight = height
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .glassEffect(
        .regular,
        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
      )
      .padding(.horizontal)
      .onAppear {
        syncPendingOrder(force: true)
      }
      .onChange(of: messages) {
        syncPendingOrder()
      }
      .onDrop(
        of: [.text],
        delegate: PendingQueueDropDelegate(
          draggingPendingId: $draggingPendingId,
          resetDrag: resetPendingDrag,
          commitReorder: commitPendingReorder
        )
      )
    }
  }

  private var header: some View {
    HStack(spacing: 10) {
      HStack(spacing: 8) {
        Text("Queue")
          .font(.subheadline.weight(.semibold))

        Text("\(messages.count)")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 7)
          .padding(.vertical, 2)
          .background(.quaternary, in: Capsule())
      }

      Spacer(minLength: 8)

      Image(systemName: "chevron.down")
        .font(.caption.weight(.bold))
        .foregroundStyle(.secondary)
        .rotationEffect(.degrees(isExpanded ? 0 : -90))
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .contentShape(Rectangle())
  }

  private var expandedBodyHeight: CGFloat? {
    guard expandedBodyContentHeight > 0 else { return nil }
    return min(expandedBodyContentHeight, Self.maxExpandedBodyHeight)
  }

  private var visibleMessages: [PendingUserMessage] {
    let ids = messages.map(\.pendingId)
    let order = sameIds(ids, pendingOrder) ? pendingOrder : ids
    var messagesById: [String: PendingUserMessage] = [:]
    for message in messages {
      messagesById[message.pendingId] = message
    }

    return order.compactMap { pendingId in
      guard var message = messagesById[pendingId] else { return nil }
      if let behavior = pendingBehaviorOverrides[pendingId] {
        message.streamingBehavior = behavior
      }
      return message
    }
  }

  private var sections: [PendingMessagesSection] {
    let messages = visibleMessages
    return [
      PendingMessagesSection(
        id: "steer",
        title: "Steer",
        behavior: .steer,
        messages: messages.filter { $0.streamingBehavior == .steer },
        emptyLabel: "Steer prompts will interrupt the current response."
      ),
      PendingMessagesSection(
        id: "follow-up",
        title: "Follow-up",
        behavior: .followUp,
        messages: messages.filter { $0.streamingBehavior != .steer },
        emptyLabel: "Follow-up prompts will run after the current response."
      ),
    ]
  }

  private var accessibilityValue: String {
    let messageLabel = messages.count == 1 ? "message" : "messages"
    let expandedLabel = isExpanded ? "expanded" : "collapsed"
    return "\(messages.count) \(messageLabel), \(expandedLabel)"
  }

  private func toggleExpanded() {
    isExpanded.toggle()
  }

  private func beginDragging(_ message: PendingUserMessage) -> NSItemProvider {
    if !sameIds(messages.map(\.pendingId), pendingOrder) {
      pendingOrder = messages.map(\.pendingId)
    }
    draggingPendingId = message.pendingId
    return NSItemProvider(object: message.pendingId as NSString)
  }

  private func movePendingMessage(
    _ pendingId: String,
    to targetPendingId: String,
    behavior: StreamingBehavior
  ) {
    var ids = currentOrderIds()
    guard let sourceIndex = ids.firstIndex(of: pendingId) else { return }

    pendingBehaviorOverrides[pendingId] = behavior

    guard pendingId != targetPendingId,
          let targetIndex = ids.firstIndex(of: targetPendingId) else {
      return
    }

    withAnimation(.smooth(duration: 0.16)) {
      let destination = targetIndex > sourceIndex ? targetIndex + 1 : targetIndex
      ids.move(fromOffsets: IndexSet(integer: sourceIndex), toOffset: destination)
      pendingOrder = ids
    }
  }

  private func movePendingMessageToSectionEnd(
    _ pendingId: String,
    behavior: StreamingBehavior
  ) {
    var ids = currentOrderIds()
    guard let sourceIndex = ids.firstIndex(of: pendingId) else { return }

    withAnimation(.smooth(duration: 0.16)) {
      ids.remove(at: sourceIndex)
      pendingBehaviorOverrides[pendingId] = behavior
      let insertionIndex = sectionEndInsertionIndex(for: behavior, in: ids)
      ids.insert(pendingId, at: insertionIndex)
      pendingOrder = ids
    }
  }

  private func commitPendingReorder() {
    let nextMessages = visibleMessages
    draggingPendingId = nil
    pendingOrder = nextMessages.map(\.pendingId)
    onReorderMessages(nextMessages)
  }

  private func resetPendingDrag() {
    draggingPendingId = nil
    syncPendingOrder(force: true)
  }

  private func currentOrderIds() -> [String] {
    let ids = messages.map(\.pendingId)
    return sameIds(ids, pendingOrder) ? pendingOrder : ids
  }

  private func sectionEndInsertionIndex(
    for behavior: StreamingBehavior,
    in ids: [String]
  ) -> Int {
    if let lastMatchingIndex = ids.lastIndex(where: { pendingId in
      behaviorForPendingId(pendingId) == behavior
    }) {
      return ids.index(after: lastMatchingIndex)
    }

    return behavior == .steer ? 0 : ids.count
  }

  private func behaviorForPendingId(_ pendingId: String) -> StreamingBehavior {
    if let override = pendingBehaviorOverrides[pendingId] {
      return override
    }

    return messages.first { $0.pendingId == pendingId }?.streamingBehavior ?? .followUp
  }

  private func syncPendingOrder(force: Bool = false) {
    let ids = messages.map(\.pendingId)
    guard force || draggingPendingId == nil || !sameIds(ids, pendingOrder) else {
      return
    }

    pendingOrder = ids
    pendingBehaviorOverrides = [:]
  }

  private func sameIds(_ left: [String], _ right: [String]) -> Bool {
    left.count == right.count && Set(left) == Set(right)
  }
}

private struct PendingMessagesSection: Identifiable {
  var id: String
  var title: String
  var behavior: StreamingBehavior
  var messages: [PendingUserMessage]
  var emptyLabel: String
}

private struct PendingQueueBodyHeightPreferenceKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

private struct PendingMessagesSectionView: View {
  var section: PendingMessagesSection
  @Binding var draggingPendingId: String?
  var onDrag: (PendingUserMessage) -> NSItemProvider
  var moveMessage: (String, String, StreamingBehavior) -> Void
  var moveMessageToSectionEnd: (String, StreamingBehavior) -> Void
  var commitReorder: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(section.title.uppercased())
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)

        Spacer(minLength: 8)

        Text("\(section.messages.count)")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.tertiary)
      }

      if section.messages.isEmpty {
        PendingSectionDropTarget(
          section: section,
          isDragging: draggingPendingId != nil,
          draggingPendingId: $draggingPendingId,
          moveMessageToSectionEnd: moveMessageToSectionEnd,
          commitReorder: commitReorder
        )
      } else {
        ForEach(section.messages) { message in
          PendingMessageCard(
            message: message,
            isDragging: draggingPendingId == message.pendingId
          )
          .onDrag { onDrag(message) }
          .onDrop(
            of: [.text],
            delegate: PendingMessageDropDelegate(
              targetPendingId: message.pendingId,
              targetBehavior: section.behavior,
              draggingPendingId: $draggingPendingId,
              moveMessage: moveMessage,
              commitReorder: commitReorder
            )
          )
        }

        PendingSectionDropTarget(
          section: section,
          isDragging: draggingPendingId != nil,
          draggingPendingId: $draggingPendingId,
          moveMessageToSectionEnd: moveMessageToSectionEnd,
          commitReorder: commitReorder
        )
      }
    }
    .padding(12)
  }
}

private struct PendingMessageCard: View {
  var message: PendingUserMessage
  var isDragging: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top, spacing: 8) {
        Image(systemName: "line.3.horizontal")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tertiary)
          .padding(.top, 3)
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 8) {
          Text(displayText)
            .font(.footnote)
            .foregroundStyle(.primary)
            .lineLimit(3)
            .frame(maxWidth: .infinity, alignment: .leading)

          if !message.images.isEmpty {
            Text(imageCountLabel)
              .font(.caption2)
              .foregroundStyle(.secondary)
          }
        }
      }
    }
    .padding(10)
    .background(
      .secondary.opacity(0.08),
      in: RoundedRectangle(cornerRadius: 12, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .stroke(.quaternary, lineWidth: 0.5)
    }
    .opacity(isDragging ? 0.55 : 1)
    .contentShape(
      .dragPreview,
      RoundedRectangle(cornerRadius: 12, style: .continuous)
    )
    .accessibilityHint("Drag to reorder queued prompts")
  }

  private var displayText: String {
    let trimmedText = message.text.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    if !trimmedText.isEmpty {
      return trimmedText
    }

    return message.streamingBehavior == .steer
      ? "Steer image prompt"
      : "Follow-up image prompt"
  }

  private var imageCountLabel: String {
    let imageLabel = message.images.count == 1 ? "image" : "images"
    return "\(message.images.count) \(imageLabel)"
  }
}

private struct PendingSectionDropTarget: View {
  var section: PendingMessagesSection
  var isDragging: Bool
  @Binding var draggingPendingId: String?
  var moveMessageToSectionEnd: (String, StreamingBehavior) -> Void
  var commitReorder: () -> Void

  var body: some View {
    Group {
      if section.messages.isEmpty {
        Text(section.emptyLabel)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 12)
          .padding(.vertical, 12)
          .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .stroke(
                .quaternary,
                style: StrokeStyle(lineWidth: 0.75, dash: [4])
              )
          }
      } else if isDragging {
        Text("Drop here to move to \(section.title)")
          .font(.caption2.weight(.medium))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .center)
          .padding(.vertical, 8)
          .overlay {
            Capsule()
              .stroke(
                .quaternary,
                style: StrokeStyle(lineWidth: 0.75, dash: [4])
              )
          }
      } else {
        Color.clear
          .frame(height: 1)
      }
    }
    .onDrop(
      of: [.text],
      delegate: PendingSectionDropDelegate(
        targetBehavior: section.behavior,
        draggingPendingId: $draggingPendingId,
        moveMessageToSectionEnd: moveMessageToSectionEnd,
        commitReorder: commitReorder
      )
    )
  }
}

private struct PendingQueueDropDelegate: DropDelegate {
  @Binding var draggingPendingId: String?
  var resetDrag: () -> Void
  var commitReorder: () -> Void

  func dropUpdated(info: DropInfo) -> DropProposal? {
    draggingPendingId == nil ? nil : DropProposal(operation: .move)
  }

  func dropExited(info: DropInfo) {
    resetDrag()
  }

  func performDrop(info: DropInfo) -> Bool {
    guard draggingPendingId != nil else { return false }
    commitReorder()
    return true
  }
}

private struct PendingMessageDropDelegate: DropDelegate {
  var targetPendingId: String
  var targetBehavior: StreamingBehavior
  @Binding var draggingPendingId: String?
  var moveMessage: (String, String, StreamingBehavior) -> Void
  var commitReorder: () -> Void

  func dropEntered(info: DropInfo) {
    guard let draggingPendingId else { return }
    moveMessage(draggingPendingId, targetPendingId, targetBehavior)
  }

  func dropUpdated(info: DropInfo) -> DropProposal? {
    draggingPendingId == nil ? nil : DropProposal(operation: .move)
  }

  func performDrop(info: DropInfo) -> Bool {
    guard let draggingPendingId else { return false }
    moveMessage(draggingPendingId, targetPendingId, targetBehavior)
    self.draggingPendingId = nil
    commitReorder()
    return true
  }
}

private struct PendingSectionDropDelegate: DropDelegate {
  var targetBehavior: StreamingBehavior
  @Binding var draggingPendingId: String?
  var moveMessageToSectionEnd: (String, StreamingBehavior) -> Void
  var commitReorder: () -> Void

  func dropEntered(info: DropInfo) {
    guard let draggingPendingId else { return }
    moveMessageToSectionEnd(draggingPendingId, targetBehavior)
  }

  func dropUpdated(info: DropInfo) -> DropProposal? {
    draggingPendingId == nil ? nil : DropProposal(operation: .move)
  }

  func performDrop(info: DropInfo) -> Bool {
    guard let draggingPendingId else { return false }
    moveMessageToSectionEnd(draggingPendingId, targetBehavior)
    self.draggingPendingId = nil
    commitReorder()
    return true
  }
}

#Preview {
  PendingMessagesView(messages: [])
}
