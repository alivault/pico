import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

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
      .picoGlassEffect(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
    return rowCount * Self.estimatedRowHeight + headerHeight + Self.listBodyPadding * 2
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
    guard
      !editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !message.images.isEmpty
    else {
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
      guard
        let message = messages.first(where: {
          $0.pendingId == pendingId
        })
      else {
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

#if os(iOS)
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
      collectionView.dragDelegate = coordinator
      collectionView.dropDelegate = coordinator
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
      UICollectionViewDragDelegate,
      UICollectionViewDropDelegate
    {
      typealias DataSource = UICollectionViewDiffableDataSource<String, String>
      typealias Snapshot = NSDiffableDataSourceSnapshot<String, String>

      var parent: PendingMessagesTableView
      private var sections: [PendingMessagesSection] = []
      private var sectionsSignature = ""
      private var messageById: [String: PendingUserMessage] = [:]
      private var dataSource: DataSource?
      private var highlightedDropSectionId: String?

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
          guard let self else {
            supplementaryView.contentConfiguration = nil
            supplementaryView.backgroundConfiguration = .clear()
            return
          }

          configure(supplementaryView, sectionIndex: indexPath.section)
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

        self.dataSource = dataSource
      }

      private func configure(
        _ headerView: UICollectionViewListCell,
        sectionIndex: Int
      ) {
        guard let section = section(at: sectionIndex) else {
          headerView.contentConfiguration = nil
          headerView.backgroundConfiguration = .clear()
          headerView.accessories = []
          return
        }

        headerView.contentConfiguration = UIHostingConfiguration {
          PendingSectionHeaderRow(
            section: section,
            isDropTarget: section.id == highlightedDropSectionId
          )
        }
        .margins(.all, 0)
        headerView.backgroundConfiguration = .clear()
        headerView.accessories = []
      }

      func apply(
        sections newSections: [PendingMessagesSection],
        to collectionView: UICollectionView,
        animatingDifferences: Bool = false
      ) {
        let nextSignature = PendingMessagesTableView.signature(for: newSections)
        guard nextSignature != sectionsSignature else { return }

        applyCommittedSections(
          newSections,
          signature: nextSignature,
          animatingDifferences: animatingDifferences
        )
      }

      func collectionView(
        _ collectionView: UICollectionView,
        itemsForBeginning session: any UIDragSession,
        at indexPath: IndexPath
      ) -> [UIDragItem] {
        guard let pendingId = dataSource?.itemIdentifier(for: indexPath),
          messageById[pendingId] != nil
        else {
          return []
        }

        let provider = NSItemProvider(object: pendingId as NSString)
        let dragItem = UIDragItem(itemProvider: provider)
        dragItem.localObject = pendingId
        return [dragItem]
      }

      func collectionView(
        _ collectionView: UICollectionView,
        dragPreviewParametersForItemAt indexPath: IndexPath
      ) -> UIDragPreviewParameters? {
        previewParameters(forItemAt: indexPath, in: collectionView)
      }

      func collectionView(
        _ collectionView: UICollectionView,
        dropPreviewParametersForItemAt indexPath: IndexPath
      ) -> UIDragPreviewParameters? {
        previewParameters(forItemAt: indexPath, in: collectionView)
      }

      func collectionView(
        _ collectionView: UICollectionView,
        dropSessionDidUpdate session: any UIDropSession,
        withDestinationIndexPath destinationIndexPath: IndexPath?
      ) -> UICollectionViewDropProposal {
        guard session.localDragSession != nil else {
          setHighlightedDropSection(nil, in: collectionView)
          return UICollectionViewDropProposal(
            operation: .forbidden,
            intent: .unspecified
          )
        }

        let destination = resolvedDestinationIndexPath(
          for: session,
          providedDestinationIndexPath: destinationIndexPath,
          in: collectionView
        )
        guard let destination else {
          setHighlightedDropSection(nil, in: collectionView)
          return UICollectionViewDropProposal(
            operation: .forbidden,
            intent: .unspecified
          )
        }

        setHighlightedDropSection(
          section(at: destination.section)?.id,
          in: collectionView
        )
        return UICollectionViewDropProposal(
          operation: .move,
          intent: .insertAtDestinationIndexPath
        )
      }

      func collectionView(
        _ collectionView: UICollectionView,
        dropSessionDidExit session: any UIDropSession
      ) {
        setHighlightedDropSection(nil, in: collectionView)
      }

      func collectionView(
        _ collectionView: UICollectionView,
        dropSessionDidEnd session: any UIDropSession
      ) {
        setHighlightedDropSection(nil, in: collectionView)
      }

      func collectionView(
        _ collectionView: UICollectionView,
        performDropWith coordinator: any UICollectionViewDropCoordinator
      ) {
        defer { setHighlightedDropSection(nil, in: collectionView) }

        guard let item = coordinator.items.first,
          let pendingId = item.dragItem.localObject as? String
        else {
          return
        }

        let destination = resolvedDestinationIndexPath(
          for: coordinator.session,
          providedDestinationIndexPath: coordinator.destinationIndexPath,
          in: collectionView
        )
        guard let destination,
          let finalIndexPath = movePendingMessage(
            pendingId,
            to: destination
          )
        else {
          return
        }

        coordinator.drop(item.dragItem, toItemAt: finalIndexPath)
      }

      func swipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let dataSource,
          let pendingId = dataSource.itemIdentifier(for: indexPath),
          let message = messageById[pendingId]
        else {
          return nil
        }

        let deleteAction = UIContextualAction(
          style: .destructive,
          title: "Delete"
        ) { [weak self] _, _, complete in
          self?.parent.onDeleteMessage(message)
          complete(true)
        }
        deleteAction.image = PicoIcon.uiImage(
          systemName: "trash",
          pointSize: 16,
          strokeWidth: 1.5
        )

        let editAction = UIContextualAction(
          style: .normal,
          title: "Edit"
        ) { [weak self] _, _, complete in
          self?.parent.onEditMessage(message)
          complete(true)
        }
        editAction.image = PicoIcon.uiImage(
          systemName: "pencil",
          pointSize: 16,
          strokeWidth: 1.5
        )
        editAction.backgroundColor = .systemBlue

        let configuration = UISwipeActionsConfiguration(actions: [
          deleteAction,
          editAction,
        ])
        configuration.performsFirstActionWithFullSwipe = false
        return configuration
      }

      private func setHighlightedDropSection(
        _ sectionId: String?,
        in collectionView: UICollectionView
      ) {
        guard highlightedDropSectionId != sectionId else { return }
        highlightedDropSectionId = sectionId
        refreshVisibleSectionHeaders(in: collectionView)
      }

      private func refreshVisibleSectionHeaders(
        in collectionView: UICollectionView
      ) {
        let indexPaths = collectionView.indexPathsForVisibleSupplementaryElements(
          ofKind: UICollectionView.elementKindSectionHeader
        )

        for indexPath in indexPaths {
          guard
            let headerView = collectionView.supplementaryView(
              forElementKind: UICollectionView.elementKindSectionHeader,
              at: indexPath
            ) as? UICollectionViewListCell
          else {
            continue
          }

          configure(headerView, sectionIndex: indexPath.section)
        }
      }

      private func movePendingMessage(
        _ pendingId: String,
        to destinationIndexPath: IndexPath
      ) -> IndexPath? {
        var nextSections = sections
        guard nextSections.indices.contains(destinationIndexPath.section) else {
          return nil
        }

        var movedMessage: PendingUserMessage?
        var sourceSectionIndex: Int?
        var sourceItemIndex: Int?
        for sectionIndex in nextSections.indices {
          guard
            let itemIndex = nextSections[sectionIndex].messages.firstIndex(
              where: { $0.pendingId == pendingId }
            )
          else {
            continue
          }

          movedMessage = nextSections[sectionIndex].messages.remove(at: itemIndex)
          sourceSectionIndex = sectionIndex
          sourceItemIndex = itemIndex
          break
        }

        guard var message = movedMessage else { return nil }

        let destinationSectionIndex = destinationIndexPath.section
        var destinationItemIndex = destinationIndexPath.item
        if sourceSectionIndex == destinationSectionIndex,
          let sourceItemIndex,
          sourceItemIndex < destinationItemIndex
        {
          destinationItemIndex -= 1
        }

        destinationItemIndex = min(
          max(0, destinationItemIndex),
          nextSections[destinationSectionIndex].messages.count
        )
        message.streamingBehavior = nextSections[destinationSectionIndex].behavior
        nextSections[destinationSectionIndex].messages.insert(
          message,
          at: destinationItemIndex
        )

        let nextSignature = PendingMessagesTableView.signature(for: nextSections)
        let didChange = nextSignature != sectionsSignature
        applyCommittedSections(
          nextSections,
          signature: nextSignature,
          animatingDifferences: true
        )

        if didChange {
          parent.onReorderMessages(nextSections.flatMap(\.messages))
        }

        return IndexPath(
          item: destinationItemIndex,
          section: destinationSectionIndex
        )
      }

      private func previewParameters(
        forItemAt indexPath: IndexPath,
        in collectionView: UICollectionView
      ) -> UIDragPreviewParameters? {
        guard collectionView.cellForItem(at: indexPath) != nil else {
          return nil
        }

        let parameters = UIDragPreviewParameters()
        let previewBounds =
          collectionView.layoutAttributesForItem(
            at: indexPath
          )?.bounds ?? collectionView.cellForItem(at: indexPath)?.bounds ?? .zero
        let visibleRect = previewBounds.insetBy(dx: 0, dy: 4)
        parameters.backgroundColor = .clear
        parameters.visiblePath = UIBezierPath(
          roundedRect: visibleRect,
          cornerRadius: 12
        )
        return parameters
      }

      private func resolvedDestinationIndexPath(
        for session: any UIDropSession,
        providedDestinationIndexPath: IndexPath?,
        in collectionView: UICollectionView
      ) -> IndexPath? {
        indexPathForDropLocation(
          session.location(in: collectionView),
          in: collectionView
        )
          ?? normalizedDestinationIndexPath(
            providedDestinationIndexPath,
            in: collectionView
          )
      }

      private func normalizedDestinationIndexPath(
        _ indexPath: IndexPath?,
        in collectionView: UICollectionView
      ) -> IndexPath? {
        guard let indexPath,
          sections.indices.contains(indexPath.section)
        else {
          return nil
        }

        let itemCount = collectionView.numberOfItems(inSection: indexPath.section)
        return IndexPath(
          item: min(max(0, indexPath.item), itemCount),
          section: indexPath.section
        )
      }

      private func indexPathForDropLocation(
        _ point: CGPoint,
        in collectionView: UICollectionView
      ) -> IndexPath? {
        collectionView.layoutIfNeeded()

        if let itemIndexPath = collectionView.indexPathForItem(at: point) {
          return normalizedDestinationIndexPath(itemIndexPath, in: collectionView)
        }

        var sectionFrames: [(section: Int, frame: CGRect)] = []
        for sectionIndex in 0..<collectionView.numberOfSections {
          guard let frame = frameForSection(sectionIndex, in: collectionView) else {
            continue
          }

          if frame.insetBy(dx: 0, dy: -8).contains(point) {
            let itemCount = collectionView.numberOfItems(inSection: sectionIndex)
            return IndexPath(item: itemCount, section: sectionIndex)
          }
          sectionFrames.append((sectionIndex, frame))
        }

        if let emptySectionIndex = emptySectionIndexForDropLocation(
          point,
          sectionFrames: sectionFrames,
          in: collectionView
        ) {
          return IndexPath(item: 0, section: emptySectionIndex)
        }

        guard
          let nearestSection = sectionFrames.min(by: {
            abs($0.frame.midY - point.y) < abs($1.frame.midY - point.y)
          })?.section
        else {
          return nil
        }

        let itemCount = collectionView.numberOfItems(inSection: nearestSection)
        return IndexPath(item: itemCount, section: nearestSection)
      }

      private func frameForSection(
        _ sectionIndex: Int,
        in collectionView: UICollectionView
      ) -> CGRect? {
        var sectionFrame: CGRect?
        let headerIndexPath = IndexPath(item: 0, section: sectionIndex)
        let headerAttributes = collectionView.layoutAttributesForSupplementaryElement(
          ofKind: UICollectionView.elementKindSectionHeader,
          at: headerIndexPath
        )
        if let headerFrame = headerAttributes?.frame {
          sectionFrame = headerFrame
        }

        let itemCount = collectionView.numberOfItems(inSection: sectionIndex)
        for itemIndex in 0..<itemCount {
          let itemIndexPath = IndexPath(item: itemIndex, section: sectionIndex)
          guard
            let itemFrame =
              collectionView
              .layoutAttributesForItem(at: itemIndexPath)?.frame
          else {
            continue
          }
          sectionFrame = sectionFrame.map { $0.union(itemFrame) } ?? itemFrame
        }

        return sectionFrame
      }

      private func emptySectionIndexForDropLocation(
        _ point: CGPoint,
        sectionFrames: [(section: Int, frame: CGRect)],
        in collectionView: UICollectionView
      ) -> Int? {
        for sectionIndex in sections.indices
        where collectionView.numberOfItems(inSection: sectionIndex) == 0 {
          let previousFrame =
            sectionFrames
            .filter { $0.section < sectionIndex }
            .max { $0.section < $1.section }?.frame
          let nextFrame =
            sectionFrames
            .filter { $0.section > sectionIndex }
            .min { $0.section < $1.section }?.frame
          let minY = previousFrame?.maxY ?? collectionView.bounds.minY
          let maxY = nextFrame?.minY ?? collectionView.bounds.maxY
          if point.y >= minY - 12 && point.y <= maxY + 12 {
            return sectionIndex
          }
        }
        return nil
      }

      private func applyCommittedSections(
        _ nextSections: [PendingMessagesSection],
        signature: String,
        animatingDifferences: Bool
      ) {
        if let highlightedDropSectionId,
          !nextSections.contains(where: { $0.id == highlightedDropSectionId })
        {
          self.highlightedDropSectionId = nil
        }

        sections = nextSections
        rebuildIndexes()
        sectionsSignature = signature
        dataSource?.apply(
          snapshot(for: nextSections),
          animatingDifferences: animatingDifferences
        )
      }

      private func snapshot(for sections: [PendingMessagesSection]) -> Snapshot {
        var snapshot = Snapshot()
        snapshot.appendSections(sections.map(\.id))
        for section in sections {
          snapshot.appendItems(
            section.messages.map(\.pendingId),
            toSection: section.id
          )
        }
        return snapshot
      }

      private func rebuildIndexes() {
        messageById = [:]
        for section in sections {
          for message in section.messages {
            messageById[message.pendingId] = message
          }
        }
      }

      private func section(at index: Int) -> PendingMessagesSection? {
        guard sections.indices.contains(index) else { return nil }
        return sections[index]
      }

    }
  }
#else
  private struct PendingMessagesTableView: View {
    var sections: [PendingMessagesSection]
    var isScrollEnabled: Bool
    var onReorderMessages: ([PendingUserMessage]) -> Void
    var onEditMessage: (PendingUserMessage) -> Void
    var onDeleteMessage: (PendingUserMessage) -> Void

    var body: some View {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 4) {
          ForEach(sections) { section in
            PendingSectionHeaderRow(section: section)

            ForEach(section.messages) { message in
              HStack(alignment: .center, spacing: 8) {
                PendingMessageTableRow(message: message)

                Menu {
                  Button("Move Up", picoSystemImage: "arrow.up") {
                    move(message, offset: -1)
                  }
                  .disabled(!canMove(message, offset: -1))

                  Button("Move Down", picoSystemImage: "arrow.down") {
                    move(message, offset: 1)
                  }
                  .disabled(!canMove(message, offset: 1))

                  Button(
                    message.streamingBehavior == .steer
                      ? "Move to Follow-up"
                      : "Move to Steer",
                    picoSystemImage: "arrow.left.arrow.right"
                  ) {
                    moveToOtherSection(message)
                  }

                  Divider()

                  Button("Edit", picoSystemImage: "pencil") {
                    onEditMessage(message)
                  }

                  Button("Delete", picoSystemImage: "trash", role: .destructive) {
                    onDeleteMessage(message)
                  }
                } label: {
                  Label("Queue message actions", picoSystemImage: "ellipsis")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
              }
            }
          }
        }
        .padding(.horizontal, 2)
      }
      .scrollDisabled(!isScrollEnabled)
    }

    private func canMove(_ message: PendingUserMessage, offset: Int) -> Bool {
      guard
        let section = sections.first(where: {
          $0.behavior == message.streamingBehavior
        }),
        let index = section.messages.firstIndex(where: {
          $0.pendingId == message.pendingId
        })
      else {
        return false
      }
      return section.messages.indices.contains(index + offset)
    }

    private func move(_ message: PendingUserMessage, offset: Int) {
      var nextSections = sections
      guard
        let sectionIndex = nextSections.firstIndex(where: {
          $0.behavior == message.streamingBehavior
        }),
        let messageIndex = nextSections[sectionIndex].messages.firstIndex(where: {
          $0.pendingId == message.pendingId
        })
      else {
        return
      }

      let destination = messageIndex + offset
      guard nextSections[sectionIndex].messages.indices.contains(destination) else {
        return
      }
      nextSections[sectionIndex].messages.swapAt(messageIndex, destination)
      onReorderMessages(nextSections.flatMap(\.messages))
    }

    private func moveToOtherSection(_ message: PendingUserMessage) {
      var nextSections = sections
      guard
        let sourceIndex = nextSections.firstIndex(where: {
          $0.behavior == message.streamingBehavior
        }),
        let messageIndex = nextSections[sourceIndex].messages.firstIndex(where: {
          $0.pendingId == message.pendingId
        })
      else {
        return
      }

      var movedMessage = nextSections[sourceIndex].messages.remove(at: messageIndex)
      movedMessage.streamingBehavior =
        message.streamingBehavior == .steer
        ? .followUp
        : .steer
      guard
        let destinationIndex = nextSections.firstIndex(where: {
          $0.behavior == movedMessage.streamingBehavior
        })
      else {
        return
      }
      nextSections[destinationIndex].messages.append(movedMessage)
      onReorderMessages(nextSections.flatMap(\.messages))
    }
  }
#endif

private struct PendingSectionHeaderRow: View {
  var section: PendingMessagesSection
  var isDropTarget = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(section.title.uppercased())
          .font(.caption.weight(.semibold))
          .foregroundStyle(isDropTarget ? Color.accentColor : Color.primary)

        Spacer(minLength: 8)

        Text("\(section.messages.count)")
          .font(.caption.weight(.semibold))
          .foregroundStyle(isDropTarget ? Color.accentColor : Color.secondary)
      }

      if section.messages.isEmpty {
        Text(section.emptyLabel)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .padding(.horizontal, 12)
    .padding(.top, 9)
    .padding(.bottom, section.messages.isEmpty ? 10 : 5)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      if isDropTarget {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.accentColor.opacity(0.16))
      } else if section.messages.isEmpty {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(.secondary.opacity(0.05))
      }
    }
    .overlay {
      if isDropTarget || section.messages.isEmpty {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(
            isDropTarget
              ? Color.accentColor.opacity(0.8)
              : Color(uiColor: .separator).opacity(0.25),
            lineWidth: isDropTarget ? 1.5 : 0.5
          )
      }
    }
    .padding(.vertical, section.messages.isEmpty ? 4 : 0)
    .contentShape(Rectangle())
    .animation(.smooth(duration: 0.16), value: isDropTarget)
    .accessibilityHint(
      section.messages.isEmpty
        ? "Drop queued prompts here to move them into this section."
        : "Long-press and drag prompts to reorder this section."
    )
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
            .picoTextInputAutocapitalization(.sentences)
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
      .picoNavigationTitleDisplayMode(.inline)
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
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !message.images.isEmpty
  }

  private var imageCountLabel: String {
    let imageLabel = message.images.count == 1 ? "image" : "images"
    return "\(message.images.count) \(imageLabel)"
  }
}

#Preview {
  PendingMessagesView(messages: [], isExpanded: .constant(false))
}
