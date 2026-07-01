import SwiftUI
import UIKit

struct PendingMessagesView: View {
  private static let maxListHeight: CGFloat = 320
  private static let estimatedRowHeight: CGFloat = 64
  private static let estimatedSectionHeaderHeight: CGFloat = 30

  var messages: [PendingUserMessage]
  var onReorderMessages: ([PendingUserMessage]) -> Void = { _ in }
  var onEditMessage: (PendingUserMessage, String) -> Void = { _, _ in }
  var onDeleteMessage: (PendingUserMessage) -> Void = { _ in }
  @State private var isExpanded = false
  @State private var pendingOrder: [String] = []
  @State private var pendingBehaviorOverrides: [String: StreamingBehavior] = [:]
  @State private var editingMessage: PendingUserMessage?
  @State private var editText = ""
  @State private var editError: String?

  var body: some View {
    if !messages.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        header

        if isExpanded {
          Divider()
          pendingMessagesList
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
      .sheet(item: $editingMessage, onDismiss: cancelEditing) { message in
        PendingMessageEditSheet(
          message: message,
          text: $editText,
          error: $editError,
          save: { saveEditing(message) },
          cancel: cancelEditing
        )
      }
    }
  }

  private var header: some View {
    HStack(spacing: 10) {
      Button(action: toggleExpanded) {
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
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Queue")
      .accessibilityValue(accessibilityValue)

    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }

  private var pendingMessagesList: some View {
    PendingMessagesTableView(
      sections: sections,
      isScrollEnabled: estimatedListHeight > Self.maxListHeight,
      onReorderMessages: commitPendingReorder,
      onEditMessage: beginEditing,
      onDeleteMessage: deletePendingMessage
    )
    .frame(height: listHeight)
  }

  private var visibleMessages: [PendingUserMessage] {
    let ids = messages.map(\.pendingId)
    let order = sameIdSet(ids, pendingOrder) ? pendingOrder : ids
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
        emptyLabel: "Steer prompts will interrupt the current response.",
        messages: messages.filter { $0.streamingBehavior == .steer }
      ),
      PendingMessagesSection(
        id: "follow-up",
        title: "Follow-up",
        behavior: .followUp,
        emptyLabel: "Follow-up prompts will run after the current response.",
        messages: messages.filter { $0.streamingBehavior != .steer }
      ),
    ]
  }

  private var estimatedListHeight: CGFloat {
    let rowCount = CGFloat(
      sections.reduce(0) { count, section in
        count + max(1, section.messages.count)
      }
    )
    let headerHeight = CGFloat(sections.count) * Self.estimatedSectionHeaderHeight
    return rowCount * Self.estimatedRowHeight + headerHeight
  }

  private var listHeight: CGFloat {
    min(Self.maxListHeight, estimatedListHeight)
  }

  private var accessibilityValue: String {
    let messageLabel = messages.count == 1 ? "message" : "messages"
    let expandedLabel = isExpanded ? "expanded" : "collapsed"
    return "\(messages.count) \(messageLabel), \(expandedLabel)"
  }

  private func toggleExpanded() {
    isExpanded.toggle()
  }

  private func beginEditing(_ message: PendingUserMessage) {
    editingMessage = message
    editText = message.text
    editError = nil
  }

  private func cancelEditing() {
    editingMessage = nil
    editText = ""
    editError = nil
  }

  private func saveEditing(_ message: PendingUserMessage) {
    guard !editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !message.images.isEmpty else {
      editError = "Enter a message or keep at least one image."
      return
    }

    onEditMessage(message, editText)
    cancelEditing()
  }

  private func deletePendingMessage(_ message: PendingUserMessage) {
    if editingMessage?.pendingId == message.pendingId {
      cancelEditing()
    }
    onDeleteMessage(message)
  }

  private func commitPendingReorder(_ nextMessages: [PendingUserMessage]) {
    pendingOrder = nextMessages.map(\.pendingId)
    pendingBehaviorOverrides = behaviorOverrides(for: nextMessages)
    onReorderMessages(nextMessages)
  }

  private func behaviorOverrides(
    for nextMessages: [PendingUserMessage]
  ) -> [String: StreamingBehavior] {
    var currentBehaviorById: [String: StreamingBehavior] = [:]
    for message in messages {
      currentBehaviorById[message.pendingId] = message.streamingBehavior
    }

    var overrides: [String: StreamingBehavior] = [:]
    for message in nextMessages
      where currentBehaviorById[message.pendingId] != message.streamingBehavior {
      overrides[message.pendingId] = message.streamingBehavior
    }
    return overrides
  }

  private func syncPendingOrder(force: Bool = false) {
    let ids = messages.map(\.pendingId)
    pendingBehaviorOverrides = pendingBehaviorOverrides.filter {
      pendingId,
      behavior in
      guard let message = messages.first(where: {
        $0.pendingId == pendingId
      }) else {
        return false
      }
      return message.streamingBehavior != behavior
    }

    guard force || ids != pendingOrder else { return }
    pendingOrder = ids
  }

  private func sameIdSet(_ left: [String], _ right: [String]) -> Bool {
    left.count == right.count && Set(left) == Set(right)
  }
}

private struct PendingMessagesSection: Identifiable, Hashable {
  var id: String
  var title: String
  var behavior: StreamingBehavior
  var emptyLabel: String
  var messages: [PendingUserMessage]
}

private struct PendingMessagesTableView: UIViewRepresentable {
  var sections: [PendingMessagesSection]
  var isScrollEnabled: Bool
  var onReorderMessages: ([PendingUserMessage]) -> Void
  var onEditMessage: (PendingUserMessage) -> Void
  var onDeleteMessage: (PendingUserMessage) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  func makeUIView(context: Context) -> UITableView {
    let tableView = UITableView(frame: .zero, style: .plain)
    tableView.register(
      UITableViewCell.self,
      forCellReuseIdentifier: Coordinator.messageReuseIdentifier
    )
    tableView.register(
      UITableViewHeaderFooterView.self,
      forHeaderFooterViewReuseIdentifier: Coordinator.headerReuseIdentifier
    )
    tableView.dataSource = context.coordinator
    tableView.delegate = context.coordinator
    tableView.dragDelegate = context.coordinator
    tableView.dropDelegate = context.coordinator
    tableView.dragInteractionEnabled = true
    tableView.allowsSelection = false
    tableView.backgroundColor = .clear
    tableView.separatorStyle = .singleLine
    tableView.separatorColor = UIColor.separator.withAlphaComponent(0.45)
    tableView.separatorInset = UIEdgeInsets(
      top: 0,
      left: 12,
      bottom: 0,
      right: 0
    )
    tableView.layoutMargins = .zero
    tableView.contentInset = .zero
    tableView.scrollIndicatorInsets = .zero
    tableView.keyboardDismissMode = .interactive
    tableView.estimatedRowHeight = 64
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedSectionHeaderHeight = 30
    tableView.sectionHeaderHeight = UITableView.automaticDimension
    tableView.sectionFooterHeight = 0
    tableView.estimatedSectionFooterHeight = 0
    tableView.tableFooterView = UIView(frame: .zero)
    tableView.sectionHeaderTopPadding = 0
    return tableView
  }

  func updateUIView(_ tableView: UITableView, context: Context) {
    context.coordinator.parent = self
    tableView.isScrollEnabled = isScrollEnabled
    tableView.reloadData()
  }

  final class Coordinator: NSObject,
    UITableViewDataSource,
    UITableViewDelegate,
    UITableViewDragDelegate,
    UITableViewDropDelegate {
    static let messageReuseIdentifier = "PendingMessageCell"
    static let headerReuseIdentifier = "PendingMessageHeader"

    var parent: PendingMessagesTableView

    init(parent: PendingMessagesTableView) {
      self.parent = parent
    }

    func numberOfSections(in tableView: UITableView) -> Int {
      parent.sections.count
    }

    func tableView(
      _ tableView: UITableView,
      numberOfRowsInSection section: Int
    ) -> Int {
      guard let section = sectionModel(at: section) else { return 0 }
      return max(1, section.messages.count)
    }

    func tableView(
      _ tableView: UITableView,
      cellForRowAt indexPath: IndexPath
    ) -> UITableViewCell {
      let cell = tableView.dequeueReusableCell(
        withIdentifier: Self.messageReuseIdentifier,
        for: indexPath
      )
      cell.selectionStyle = .none
      cell.backgroundColor = .clear
      cell.contentView.backgroundColor = .clear
      cell.backgroundConfiguration = .clear()
      cell.preservesSuperviewLayoutMargins = false
      cell.layoutMargins = .zero
      cell.separatorInset = UIEdgeInsets(
        top: 0,
        left: 12,
        bottom: 0,
        right: 0
      )

      if let message = message(at: indexPath) {
        cell.contentConfiguration = UIHostingConfiguration {
          PendingMessageTableRow(message: message)
        }
        .margins(.all, 0)
      } else if let section = sectionModel(at: indexPath.section) {
        cell.contentConfiguration = UIHostingConfiguration {
          PendingEmptySectionRow(text: section.emptyLabel)
        }
        .margins(.all, 0)
      }

      return cell
    }

    func tableView(
      _ tableView: UITableView,
      viewForHeaderInSection section: Int
    ) -> UIView? {
      guard let section = sectionModel(at: section) else { return nil }
      let header = tableView.dequeueReusableHeaderFooterView(
        withIdentifier: Self.headerReuseIdentifier
      ) ?? UITableViewHeaderFooterView(
        reuseIdentifier: Self.headerReuseIdentifier
      )
      header.backgroundConfiguration = .clear()
      header.contentConfiguration = UIHostingConfiguration {
        PendingSectionHeaderRow(section: section)
      }
      .margins(.all, 0)
      return header
    }

    func tableView(
      _ tableView: UITableView,
      heightForFooterInSection section: Int
    ) -> CGFloat {
      0.01
    }

    func tableView(
      _ tableView: UITableView,
      canEditRowAt indexPath: IndexPath
    ) -> Bool {
      message(at: indexPath) != nil
    }

    func tableView(
      _ tableView: UITableView,
      trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath
    ) -> UISwipeActionsConfiguration? {
      guard let message = message(at: indexPath) else { return nil }

      let deleteAction = UIContextualAction(
        style: .destructive,
        title: "Delete"
      ) { [weak self] _, _, complete in
        self?.parent.onDeleteMessage(message)
        complete(true)
      }
      deleteAction.image = UIImage(systemName: "trash")

      let editAction = UIContextualAction(
        style: .normal,
        title: "Edit"
      ) { [weak self] _, _, complete in
        self?.parent.onEditMessage(message)
        complete(true)
      }
      editAction.image = UIImage(systemName: "pencil")
      editAction.backgroundColor = .systemBlue

      let configuration = UISwipeActionsConfiguration(actions: [
        deleteAction,
        editAction,
      ])
      configuration.performsFirstActionWithFullSwipe = false
      return configuration
    }

    func tableView(
      _ tableView: UITableView,
      itemsForBeginning session: UIDragSession,
      at indexPath: IndexPath
    ) -> [UIDragItem] {
      guard let message = message(at: indexPath) else { return [] }
      let itemProvider = NSItemProvider(object: message.pendingId as NSString)
      let item = UIDragItem(itemProvider: itemProvider)
      item.localObject = message.pendingId
      return [item]
    }

    func tableView(
      _ tableView: UITableView,
      canHandle session: UIDropSession
    ) -> Bool {
      session.localDragSession != nil
    }

    func tableView(
      _ tableView: UITableView,
      dropSessionDidUpdate session: UIDropSession,
      withDestinationIndexPath destinationIndexPath: IndexPath?
    ) -> UITableViewDropProposal {
      guard session.localDragSession != nil else {
        return UITableViewDropProposal(operation: .cancel)
      }

      return UITableViewDropProposal(
        operation: .move,
        intent: .insertAtDestinationIndexPath
      )
    }

    func tableView(
      _ tableView: UITableView,
      performDropWith coordinator: UITableViewDropCoordinator
    ) {
      guard let dropItem = coordinator.items.first,
            let pendingId = dropItem.dragItem.localObject as? String,
            let destination = normalizedDestinationIndexPath(
              coordinator.destinationIndexPath,
              moving: pendingId
            ) else {
        return
      }

      let nextMessages = reorderedMessages(
        moving: pendingId,
        to: destination
      )
      parent.onReorderMessages(nextMessages)
      coordinator.drop(dropItem.dragItem, toRowAt: destination)
    }

    private func sectionModel(at index: Int) -> PendingMessagesSection? {
      guard parent.sections.indices.contains(index) else { return nil }
      return parent.sections[index]
    }

    private func message(at indexPath: IndexPath) -> PendingUserMessage? {
      guard let section = sectionModel(at: indexPath.section),
            section.messages.indices.contains(indexPath.row) else {
        return nil
      }
      return section.messages[indexPath.row]
    }

    private func indexPath(for pendingId: String) -> IndexPath? {
      for sectionIndex in parent.sections.indices {
        guard let row = parent.sections[sectionIndex].messages.firstIndex(
          where: { $0.pendingId == pendingId }
        ) else {
          continue
        }
        return IndexPath(row: row, section: sectionIndex)
      }
      return nil
    }

    private func normalizedDestinationIndexPath(
      _ proposedIndexPath: IndexPath?,
      moving pendingId: String
    ) -> IndexPath? {
      guard !parent.sections.isEmpty,
            indexPath(for: pendingId) != nil else {
        return nil
      }

      let proposedSection = proposedIndexPath?.section ?? 0
      let sectionIndex = min(
        max(0, proposedSection),
        parent.sections.count - 1
      )
      let messageCount = parent.sections[sectionIndex].messages.count
      let proposedRow = proposedIndexPath?.row ?? messageCount
      let row = min(max(0, proposedRow), messageCount)
      return IndexPath(row: row, section: sectionIndex)
    }

    private func reorderedMessages(
      moving pendingId: String,
      to destination: IndexPath
    ) -> [PendingUserMessage] {
      var nextSections = parent.sections
      guard let sourceSectionIndex = nextSections.firstIndex(where: {
              section in
              section.messages.contains { $0.pendingId == pendingId }
            }),
            let sourceRow = nextSections[sourceSectionIndex].messages
              .firstIndex(where: { $0.pendingId == pendingId }) else {
        return parent.sections.flatMap(\.messages)
      }

      var movingMessage = nextSections[sourceSectionIndex].messages.remove(
        at: sourceRow
      )
      let destinationSectionIndex = min(
        max(0, destination.section),
        nextSections.count - 1
      )
      movingMessage.streamingBehavior = nextSections[destinationSectionIndex]
        .behavior

      var destinationRow = min(
        max(0, destination.row),
        nextSections[destinationSectionIndex].messages.count
      )
      if destinationSectionIndex == sourceSectionIndex,
         sourceRow < destinationRow {
        destinationRow -= 1
      }

      nextSections[destinationSectionIndex].messages.insert(
        movingMessage,
        at: destinationRow
      )
      return nextSections.flatMap(\.messages)
    }
  }
}

private struct PendingSectionHeaderRow: View {
  var section: PendingMessagesSection

  var body: some View {
    HStack(spacing: 8) {
      Text(section.title.uppercased())
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)

      Spacer(minLength: 8)

      Text("\(section.messages.count)")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.tertiary)
    }
    .padding(.horizontal, 12)
    .padding(.top, 9)
    .padding(.bottom, 5)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.clear)
  }
}

private struct PendingMessageTableRow: View {
  var message: PendingUserMessage

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(displayText)
        .font(.footnote)
        .foregroundStyle(.primary)
        .lineLimit(3)
        .frame(maxWidth: .infinity, alignment: .leading)

      HStack(spacing: 6) {
        Text(message.streamingBehavior.label)
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 7)
          .padding(.vertical, 2)
          .background(.quaternary, in: Capsule())

        if !message.images.isEmpty {
          Text(imageCountLabel)
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .accessibilityHint(
      "Swipe for edit and delete actions. Long-press and drag to reorder."
    )
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

private struct PendingEmptySectionRow: View {
  var text: String

  var body: some View {
    Text(text)
      .font(.footnote)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 12)
      .padding(.vertical, 12)
      .contentShape(Rectangle())
      .accessibilityHint("Drop queued prompts here to move them into this section.")
  }
}

private struct PendingMessageEditSheet: View {
  var message: PendingUserMessage
  @Binding var text: String
  @Binding var error: String?
  var save: () -> Void
  var cancel: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField(textPlaceholder, text: $text, axis: .vertical)
            .lineLimit(4...10)
            .textInputAutocapitalization(.sentences)
            .onChange(of: text) {
              error = nil
            }

          if let error {
            Text(error)
              .font(.caption)
              .foregroundStyle(.red)
          }
        } footer: {
          if !message.images.isEmpty {
            Text("Images stay attached to this queued prompt.")
          }
        }

        if !message.images.isEmpty {
          Section("Attachments") {
            Label(imageCountLabel, systemImage: "photo")
          }
        }
      }
      .navigationTitle("Edit Queue Message")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            cancel()
          }
        }

        ToolbarItem(placement: .primaryAction) {
          Button("Save") {
            save()
          }
          .disabled(!canSave)
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var textPlaceholder: String {
    message.images.isEmpty ? "Queued message" : "Optional image prompt text"
  }

  private var canSave: Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !message.images.isEmpty
  }

  private var imageCountLabel: String {
    let imageLabel = message.images.count == 1 ? "image" : "images"
    return "\(message.images.count) \(imageLabel)"
  }
}

#Preview {
  PendingMessagesView(messages: [])
}
