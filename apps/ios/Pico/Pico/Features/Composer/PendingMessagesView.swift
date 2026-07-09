import SwiftUI
import UIKit

struct PendingMessagesView: View {
  private static let listBodyHeight: CGFloat = 320
  private static let estimatedRowHeight: CGFloat = 76
  private static let estimatedSectionHeaderHeight: CGFloat = 30
  private static let listBodyPadding: CGFloat = 10

  var messages: [PendingUserMessage]
  @Binding var isExpanded: Bool
  var canStartQueue = false
  var onStartQueue: () -> Void = {}
  var onReorderMessages: ([PendingUserMessage]) -> Void = { _ in }
  var onEditMessage: (PendingUserMessage, String) -> Void = { _, _ in }
  var onDeleteMessage: (PendingUserMessage) -> Void = { _ in }
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

          PicoIcon(systemName: "chevron.down")
            .font(.caption.weight(.bold))
            .foregroundStyle(.secondary)
            .rotationEffect(.degrees(isExpanded ? 0 : -90))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Queue")
      .accessibilityValue(accessibilityValue)

      if canStartQueue {
        Button("Start", action: onStartQueue)
          .font(.caption.weight(.semibold))
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
          .accessibilityLabel("Start queue")
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }

  private var pendingMessagesList: some View {
    PendingMessagesTableView(
      sections: sections,
      isScrollEnabled: estimatedListHeight > Self.listBodyHeight,
      onReorderMessages: commitPendingReorder,
      onEditMessage: beginEditing,
      onDeleteMessage: deletePendingMessage
    )
    .frame(height: Self.listContentHeight)
    .padding(Self.listBodyPadding)
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
    return rowCount * Self.estimatedRowHeight + headerHeight +
      Self.listBodyPadding * 2
  }

  private static var listContentHeight: CGFloat {
    max(1, listBodyHeight - listBodyPadding * 2)
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

  func makeUIView(context: Context) -> UICollectionView {
    let coordinator = context.coordinator
    var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
    configuration.backgroundColor = .clear
    configuration.showsSeparators = false
    configuration.headerMode = .supplementary
    configuration.footerMode = .none
    configuration.headerTopPadding = 0
    configuration.trailingSwipeActionsConfigurationProvider = {
      [weak coordinator] indexPath in
      coordinator?.swipeActions(at: indexPath)
    }

    let layout = UICollectionViewCompositionalLayout.list(
      using: configuration
    )
    let collectionView = UICollectionView(
      frame: .zero,
      collectionViewLayout: layout
    )
    collectionView.backgroundColor = .clear
    collectionView.alwaysBounceVertical = false
    collectionView.keyboardDismissMode = .interactive
    collectionView.dragInteractionEnabled = true
    collectionView.allowsSelection = false
    collectionView.delegate = coordinator

    let reorderGesture = UILongPressGestureRecognizer(
      target: coordinator,
      action: #selector(Coordinator.handleLongPress(_:))
    )
    reorderGesture.minimumPressDuration = 0.35
    reorderGesture.cancelsTouchesInView = false
    reorderGesture.delegate = coordinator
    collectionView.addGestureRecognizer(reorderGesture)
    collectionView.contentInset = .zero
    collectionView.scrollIndicatorInsets = .zero

    coordinator.configureDataSource(for: collectionView)
    coordinator.apply(
      sections: sections,
      to: collectionView,
      animatingDifferences: false
    )
    return collectionView
  }

  func updateUIView(_ collectionView: UICollectionView, context: Context) {
    context.coordinator.parent = self
    collectionView.isScrollEnabled = isScrollEnabled
    context.coordinator.apply(sections: sections, to: collectionView)
  }

  private static func signature(for sections: [PendingMessagesSection]) -> String {
    sections.map { section in
      let messages = section.messages.map { message in
        [
          message.pendingId,
          message.streamingBehavior.rawValue,
          message.text,
          String(message.images.count),
        ].joined(separator: "\u{1f}")
      }
      .joined(separator: "\u{1e}")

      return [section.id, section.behavior.rawValue, messages]
        .joined(separator: "\u{1d}")
    }
    .joined(separator: "\u{1c}")
  }

  @MainActor
  final class Coordinator: NSObject,
    UICollectionViewDelegate,
    UIGestureRecognizerDelegate {
    typealias DataSource = UICollectionViewDiffableDataSource<String, String>
    typealias Snapshot = NSDiffableDataSourceSnapshot<String, String>

    var parent: PendingMessagesTableView
    private var sections: [PendingMessagesSection] = []
    private var sectionsSignature = ""
    private var messageById: [String: PendingUserMessage] = [:]
    private var sectionById: [String: PendingMessagesSection] = [:]
    private var dataSource: DataSource?
    private var isInteractiveMoving = false
    private var deferredSections: [PendingMessagesSection]?

    init(parent: PendingMessagesTableView) {
      self.parent = parent
    }

    func configureDataSource(for collectionView: UICollectionView) {
      let cellRegistration = UICollectionView.CellRegistration<
        UICollectionViewListCell,
        String
      > { [weak self] cell, _, pendingId in
        if let message = self?.messageById[pendingId] {
          cell.contentConfiguration = UIHostingConfiguration {
            PendingMessageTableRow(message: message)
          }
          .margins(.all, 0)
        } else if let section = self?.placeholderSection(for: pendingId) {
          cell.contentConfiguration = UIHostingConfiguration {
            PendingEmptySectionRow(text: section.emptyLabel)
          }
          .margins(.all, 0)
        } else {
          cell.contentConfiguration = nil
        }

        cell.backgroundConfiguration = .clear()
        cell.accessories = []
      }

      let headerRegistration = UICollectionView.SupplementaryRegistration<
        UICollectionViewListCell
      >(
        elementKind: UICollectionView.elementKindSectionHeader
      ) { [weak self] supplementaryView, _, indexPath in
        guard let self,
              let section = section(at: indexPath.section) else {
          supplementaryView.contentConfiguration = nil
          supplementaryView.backgroundConfiguration = .clear()
          return
        }

        supplementaryView.contentConfiguration = UIHostingConfiguration {
          PendingSectionHeaderRow(section: section)
        }
        .margins(.all, 0)
        supplementaryView.backgroundConfiguration = .clear()
        supplementaryView.accessories = []
      }

      let dataSource = DataSource(collectionView: collectionView) {
        collectionView,
        indexPath,
        pendingId in
        collectionView.dequeueConfiguredReusableCell(
          using: cellRegistration,
          for: indexPath,
          item: pendingId
        )
      }

      dataSource.supplementaryViewProvider = {
        collectionView,
        elementKind,
        indexPath in
        switch elementKind {
        case UICollectionView.elementKindSectionHeader:
          collectionView.dequeueConfiguredReusableSupplementary(
            using: headerRegistration,
            for: indexPath
          )
        default:
          nil
        }
      }

      var reorderingHandlers = dataSource.reorderingHandlers
      reorderingHandlers.canReorderItem = { [weak self] pendingId in
        self?.messageById[pendingId] != nil
      }
      reorderingHandlers.didReorder = { [weak self] transaction in
        self?.handleReorder(transaction.finalSnapshot)
      }
      dataSource.reorderingHandlers = reorderingHandlers

      self.dataSource = dataSource
    }

    func apply(
      sections newSections: [PendingMessagesSection],
      to collectionView: UICollectionView,
      animatingDifferences: Bool = false
    ) {
      let nextSignature = PendingMessagesTableView.signature(for: newSections)
      guard nextSignature != sectionsSignature else { return }

      guard !isInteractiveMoving else {
        deferredSections = newSections
        return
      }

      sections = newSections
      rebuildIndexes()
      sectionsSignature = nextSignature
      dataSource?.apply(
        snapshot(for: newSections),
        animatingDifferences: animatingDifferences
      )
    }

    @objc func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
      guard let collectionView = gesture.view as? UICollectionView else {
        return
      }

      let location = gesture.location(in: collectionView)
      switch gesture.state {
      case .began:
        guard let indexPath = collectionView.indexPathForItem(at: location),
              let pendingId = dataSource?.itemIdentifier(for: indexPath),
              messageById[pendingId] != nil,
              collectionView.beginInteractiveMovementForItem(
                at: indexPath
              ) else {
          return
        }
        isInteractiveMoving = true
      case .changed:
        collectionView.updateInteractiveMovementTargetPosition(location)
      case .ended:
        collectionView.endInteractiveMovement()
        finishInteractiveMovement(in: collectionView)
      case .cancelled, .failed:
        collectionView.cancelInteractiveMovement()
        finishInteractiveMovement(in: collectionView)
      default:
        break
      }
    }

    func gestureRecognizerShouldBegin(
      _ gestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      guard let collectionView = gestureRecognizer.view as? UICollectionView else {
        return true
      }

      let location = gestureRecognizer.location(in: collectionView)
      guard let indexPath = collectionView.indexPathForItem(at: location) else {
        return false
      }
      guard let pendingId = dataSource?.itemIdentifier(for: indexPath) else {
        return false
      }
      return messageById[pendingId] != nil
    }

    func swipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
      guard let dataSource,
            let pendingId = dataSource.itemIdentifier(for: indexPath),
            let message = messageById[pendingId] else {
        return nil
      }

      let deleteAction = UIContextualAction(
        style: .destructive,
        title: "Delete"
      ) { [weak self] _, _, complete in
        self?.parent.onDeleteMessage(message)
        complete(true)
      }
      deleteAction.image = PicoIcon.uiImage(systemName: "trash", pointSize: 20)

      let editAction = UIContextualAction(
        style: .normal,
        title: "Edit"
      ) { [weak self] _, _, complete in
        self?.parent.onEditMessage(message)
        complete(true)
      }
      editAction.image = PicoIcon.uiImage(systemName: "pencil", pointSize: 20)
      editAction.backgroundColor = .systemBlue

      let configuration = UISwipeActionsConfiguration(actions: [
        deleteAction,
        editAction,
      ])
      configuration.performsFirstActionWithFullSwipe = false
      return configuration
    }

    private func handleReorder(_ finalSnapshot: Snapshot) {
      var nextSections = sections
      for sectionIndex in nextSections.indices {
        let sectionId = nextSections[sectionIndex].id
        let itemIds = finalSnapshot.itemIdentifiers(inSection: sectionId)
        nextSections[sectionIndex].messages = itemIds.compactMap { pendingId in
          guard var message = messageById[pendingId] else { return nil }
          message.streamingBehavior = nextSections[sectionIndex].behavior
          return message
        }
      }

      sections = nextSections
      rebuildIndexes()
      sectionsSignature = PendingMessagesTableView.signature(for: nextSections)
      parent.onReorderMessages(nextSections.flatMap(\.messages))
    }

    private func finishInteractiveMovement(in collectionView: UICollectionView) {
      isInteractiveMoving = false
      guard let deferredSections else { return }

      self.deferredSections = nil
      apply(
        sections: deferredSections,
        to: collectionView,
        animatingDifferences: false
      )
    }

    private func snapshot(for sections: [PendingMessagesSection]) -> Snapshot {
      var snapshot = Snapshot()
      snapshot.appendSections(sections.map(\.id))
      for section in sections {
        let itemIds = section.messages.isEmpty
          ? [Self.placeholderId(for: section.id)]
          : section.messages.map(\.pendingId)
        snapshot.appendItems(itemIds, toSection: section.id)
      }
      return snapshot
    }

    private func rebuildIndexes() {
      messageById = [:]
      sectionById = [:]
      for section in sections {
        sectionById[section.id] = section
        for message in section.messages {
          messageById[message.pendingId] = message
        }
      }
    }

    func collectionView(
      _ collectionView: UICollectionView,
      targetIndexPathForMoveOfItemFromOriginalIndexPath originalIndexPath: IndexPath,
      atCurrentIndexPath currentIndexPath: IndexPath,
      toProposedIndexPath proposedIndexPath: IndexPath
    ) -> IndexPath {
      proposedIndexPath
    }

    private func section(at index: Int) -> PendingMessagesSection? {
      guard sections.indices.contains(index) else { return nil }
      return sections[index]
    }

    private func placeholderSection(for itemId: String) -> PendingMessagesSection? {
      guard itemId.hasPrefix(Self.placeholderPrefix) else { return nil }

      let sectionId = String(itemId.dropFirst(Self.placeholderPrefix.count))
      return sectionById[sectionId]
    }

    private static let placeholderPrefix = "__pico_pending_empty_section__:"

    private static func placeholderId(for sectionId: String) -> String {
      "\(placeholderPrefix)\(sectionId)"
    }
  }
}

private struct PendingSectionHeaderRow: View {
  var section: PendingMessagesSection

  var body: some View {
    HStack(spacing: 8) {
      Text(section.title.uppercased())
        .font(.caption.weight(.semibold))
        .foregroundStyle(.primary)

      Spacer(minLength: 8)

      Text("\(section.messages.count)")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
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

      if !message.images.isEmpty {
        Text(imageCountLabel)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      .secondary.opacity(0.08),
      in: RoundedRectangle(cornerRadius: 12, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 0.5)
    }
    .padding(.vertical, 4)
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
      .background(
        .secondary.opacity(0.05),
        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(Color(uiColor: .separator).opacity(0.25), lineWidth: 0.5)
      }
      .padding(.vertical, 4)
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
            Label(imageCountLabel, picoSystemImage: "photo")
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
  PendingMessagesView(messages: [], isExpanded: .constant(false))
}
