import SwiftUI

struct DirectorySessionsSectionView: View {
  var snapshot: DirectorySessionsIndexSnapshot
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
  var openPurge: (String) -> Void = { _ in }
  var openFiles: (String) -> Void = { _ in }
  var isSearchActive = false
  var isLoading = false
  @State private var isExpanded = true

  private static let visibleSessionPreviewCount = 4

  var body: some View {
    Section {
      if isExpanded || isSearchActive {
        if snapshot.sessions.isEmpty {
          if isLoading {
            DirectorySessionsLoadingRow()
          } else {
            Text("No sessions yet")
              .foregroundStyle(.secondary)
          }
        } else {
          ForEach(visibleSessions) { entry in
            DirectorySessionRowButton(
              entry: entry,
              directory: snapshot.directory,
              model: model,
              openDetail: openDetail
            )
          }

          if hasMoreSessions {
            NavigationLink {
              DirectorySessionsFullListView(
                directory: snapshot.directory,
                model: model,
                sessionSearchText: .constant(""),
                openDetail: openDetail,
                openPurge: openPurge,
                openFiles: openFiles
              )
            } label: {
              Text("See all")
                .foregroundStyle(.blue)
            }
          }
        }
      }
    } header: {
      directoryHeaderRow
    }
    .picoListSectionSpacing(8)
    .headerProminence(.increased)
  }

  private var directoryHeaderRow: some View {
    HStack(spacing: 8) {
      Button(action: toggleExpanded) {
        HStack(spacing: 8) {
          PicoIcon(systemName: "folder")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(width: 20, height: 28)

          SidebarDirectoryNameLabel(path: snapshot.directory)

          PicoIcon(systemName: "chevron.down")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.secondary)
            .rotationEffect(.degrees(isExpanded ? 0 : -90))
            .frame(width: 20, height: 28)

          Spacer(minLength: 8)

          if isLoading {
            ProgressView()
              .controlSize(.small)
              .accessibilityLabel("Loading sessions")
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(
        "\(DirectoryPathFormatter.folderName(snapshot.directory)), \(isExpanded ? "expanded" : "collapsed")"
      )
      .accessibilityHint(isExpanded ? "Collapse directory" : "Expand directory")

      Button(action: startNewSession) {
        PicoIcon(systemName: "square.and.pencil", size: 20)
          .font(.subheadline.weight(.semibold))
          .frame(width: 44, height: 32)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .accessibilityLabel(
        "New session in \(DirectoryPathFormatter.folderName(snapshot.directory))"
      )
      .accessibilityHint("Starts a new draft in this directory")

      Menu {
        Button(action: showFiles) {
          Label("Files", picoSystemImage: "folder", size: 20)
        }

        Divider()

        Button(action: showPurgeSheet) {
          Label("Purge Sessions…", picoSystemImage: "trash", size: 20)
        }

        Button(role: .destructive, action: removeDirectory) {
          Label("Remove Directory", picoSystemImage: "minus.circle", size: 20)
        }
      } label: {
        Image(picoSystemName: "ellipsis")
          .frame(width: 44, height: 32)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .accessibilityLabel(
        "Actions for \(DirectoryPathFormatter.folderName(snapshot.directory))"
      )
    }
    .textCase(nil)
  }

  private var visibleSessions: [SessionListEntry] {
    if isSearchActive {
      return snapshot.sessions
    }

    return Array(snapshot.sessions.prefix(Self.visibleSessionPreviewCount))
  }

  private var hasMoreSessions: Bool {
    !isSearchActive && snapshot.sessions.count > Self.visibleSessionPreviewCount
  }

  private func toggleExpanded() {
    isExpanded.toggle()
  }

  private func startNewSession() {
    model.beginNewChat(cwd: snapshot.directory)
    openDetail()
  }

  private func showPurgeSheet() {
    openPurge(snapshot.directory)
  }

  private func showFiles() {
    openFiles(snapshot.directory)
  }

  private func removeDirectory() {
    model.removeSidebarDirectory(snapshot.directory)
  }
}

struct DirectorySessionsFullListView: View {
  var directory: String
  @Bindable var model: AppModel
  @Binding var sessionSearchText: String
  @Environment(\.dismiss) private var dismiss
  var openDetail: () -> Void = {}
  var openPurge: (String) -> Void = { _ in }
  var openFiles: (String) -> Void = { _ in }
  var setFloatingNewSessionHidden: (Bool) -> Void = { _ in }
  var onRemoveDirectory: (String) -> Void = { _ in }
  var showsSessionSelection = true
  var deselectSession: () -> Void = {}
  var sessionSelectionCountChanged: (Int) -> Void = { _ in }
  @State private var selectedSessionIds = Set<String>()

  var body: some View {
    sessionsList
      .navigationTitle(directoryNavigationTitle)
      .picoNavigationTitleDisplayMode(.large)
      .toolbar {
        #if os(iOS)
          ToolbarItemGroup(placement: .picoTrailing) {
            ControlGroup {
              Button(action: showFiles) {
                PicoIcon(systemName: "folder", size: 20)
              }
              .accessibilityLabel(
                "Files for \(DirectoryPathFormatter.folderName(directory))"
              )
              .help("Toggle Files Sidebar")

              Menu {
                Button(action: showPurgeSheet) {
                  Label("Purge Sessions…", picoSystemImage: "trash", size: 20)
                }

                Button(role: .destructive, action: removeDirectory) {
                  Label("Remove Directory", picoSystemImage: "minus.circle", size: 20)
                }
              } label: {
                Image(picoSystemName: "ellipsis")
              }
              .accessibilityLabel(
                "Actions for \(DirectoryPathFormatter.folderName(directory))"
              )
            }
          }
        #endif
      }
      .onAppear {
        updateFloatingNewSessionVisibility()
        syncSelectedSession()
      }
      .onChange(of: model.selectedSessionId) {
        syncSelectedSession()
      }
      .onChange(of: model.sessionState.sessionId) {
        syncSelectedSession()
      }
      .onChange(of: selectedSessionIds) { _, selectedIds in
        handleSessionSelection(selectedIds)
      }
  }

  @ViewBuilder
  private var sessionsList: some View {
    #if os(macOS)
      List(selection: $selectedSessionIds) {
        sessionsListContent
      }
    #else
      List {
        sessionsListContent
      }
    #endif
  }

  @ViewBuilder
  private var sessionsListContent: some View {
    if snapshot.sessions.isEmpty {
      ContentUnavailableView(
        "No sessions",
        picoSystemImage: "text.bubble",
        description: Text("This directory does not have any Pico sessions yet.")
      )
    } else if visibleSessions.isEmpty {
      PicoSearchUnavailableView(text: sessionSearchText)
    } else {
      ForEach(visibleSessions) { entry in
        DirectorySessionRowButton(
          entry: entry,
          directory: snapshot.directory,
          model: model,
          openDetail: openDetail,
          contextSelectionCount: contextSelectionCount(for: entry),
          deleteContextSelection: { deleteContextSelection(including: entry) }
        )
        .tag(entry.id)
      }
    }
  }

  private var directoryNavigationTitle: String {
    #if os(macOS)
      ""
    #else
      DirectoryPathFormatter.folderName(directory)
    #endif
  }

  private var visibleSessions: [SessionListEntry] {
    let query = sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return snapshot.sessions }

    return snapshot.sessions.filter { sessionMatches($0, query: query) }
  }

  private var snapshot: DirectorySessionsIndexSnapshot {
    model.sessionSnapshots.first { $0.directory == directory }
      ?? DirectorySessionsIndexSnapshot(
        directory: directory,
        totalCount: 0,
        revision: "local",
        sessions: []
      )
  }

  private func sessionMatches(_ entry: SessionListEntry, query: String) -> Bool {
    let fields = [
      entry.title,
      entry.name,
      entry.lastMessagePreview,
      entry.path,
      entry.sessionId,
    ]

    return fields.contains { value in
      value?.localizedCaseInsensitiveContains(query) == true
    }
  }

  private func updateFloatingNewSessionVisibility() {
    setFloatingNewSessionHidden(false)
  }

  private func syncSelectedSession() {
    #if os(macOS)
      guard showsSessionSelection,
        selectedSessionIds.count <= 1
      else {
        return
      }

      let activeIds = [
        model.selectedSessionId,
        model.sessionState.sessionId,
        model.sessionState.sessionFile,
        model.sessionState.sessionKey,
      ].compactMap { $0 }
      guard
        let activeId = visibleSessions.first(where: { entry in
          activeIds.contains(entry.selectionId ?? "")
        })?.id
      else {
        return
      }
      selectedSessionIds = [activeId]
      sessionSelectionCountChanged(1)
    #endif
  }

  private func handleSessionSelection(_ selectedIds: Set<String>) {
    #if os(macOS)
      sessionSelectionCountChanged(selectedIds.count)
      guard selectedIds.count == 1,
        let selectedId = selectedIds.first,
        let entry = visibleSessions.first(where: { $0.id == selectedId })
      else {
        if selectedIds.isEmpty {
          deselectSession()
        }
        return
      }

      openDetail()
      guard !isActiveSession(entry) else { return }
      Task {
        await model.selectSession(entry)
      }
    #endif
  }

  private func isActiveSession(_ entry: SessionListEntry) -> Bool {
    guard let selectionId = entry.selectionId else { return false }
    let activeIds = [
      model.selectedSessionId,
      model.sessionState.sessionId,
      model.sessionState.sessionFile,
      model.sessionState.sessionKey,
    ].compactMap { $0 }
    return activeIds.contains(selectionId)
  }

  private func contextSelectionCount(for entry: SessionListEntry) -> Int {
    #if os(macOS)
      guard selectedSessionIds.contains(entry.id) else { return 1 }
      return max(1, selectedSessionIds.count)
    #else
      return 1
    #endif
  }

  private func deleteContextSelection(including entry: SessionListEntry) {
    #if os(macOS)
      let entries: [SessionListEntry]
      if selectedSessionIds.contains(entry.id) {
        entries = visibleSessions.filter { selectedSessionIds.contains($0.id) }
      } else {
        entries = [entry]
      }

      selectedSessionIds.subtract(entries.map(\.id))
      Task {
        for entry in entries {
          _ = await model.deleteSession(entry, directory: directory)
        }
      }
    #else
      Task {
        await model.deleteSession(entry, directory: directory)
      }
    #endif
  }

  private func showPurgeSheet() {
    openPurge(directory)
  }

  private func showFiles() {
    openFiles(directory)
  }

  private func removeDirectory() {
    model.removeSidebarDirectory(directory)
    onRemoveDirectory(directory)
    dismiss()
  }
}

private enum DirectorySessionPurgeRange: CaseIterable, Hashable, Identifiable {
  case oneWeek
  case oneMonth
  case oneYear

  var id: Self { self }

  var title: String {
    switch self {
    case .oneWeek:
      "1 week"
    case .oneMonth:
      "1 month"
    case .oneYear:
      "1 year"
    }
  }

  var olderThanMilliseconds: Int {
    days * 24 * 60 * 60 * 1000
  }

  private var days: Int {
    switch self {
    case .oneWeek:
      7
    case .oneMonth:
      30
    case .oneYear:
      365
    }
  }
}

struct DirectorySessionPurgeSheet: View {
  @Bindable var model: AppModel
  var directory: String
  @Environment(\.dismiss) private var dismiss
  @State private var selectedRange: DirectorySessionPurgeRange = .oneMonth
  @State private var preview: DeleteOldDirectorySessionsResponse?
  @State private var isPreviewing = false

  init(model: AppModel, directory: String) {
    self.model = model
    self.directory = directory
  }

  var body: some View {
    NavigationStack {
      Form {
        Section("Directory") {
          Text(directory)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Section {
          Picker("Older than", selection: $selectedRange) {
            ForEach(DirectorySessionPurgeRange.allCases) { range in
              Text(range.title).tag(range)
            }
          }
          .pickerStyle(.menu)
        } footer: {
          Text(
            "Preview updates automatically. Active and streaming sessions are skipped."
          )
        }

        Section("Preview") {
          previewContent
        }
      }
      #if os(macOS)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 720)
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .top)
      #endif
      .navigationTitle("Purge Sessions")
      .picoNavigationTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            dismiss()
          }
        }

        ToolbarItem(placement: .primaryAction) {
          Button("Purge") {
            purge()
          }
          .buttonStyle(.borderedProminent)
          .tint(.accentColor)
          .foregroundStyle(.white)
          .disabled(!canPurge)
        }
      }
      .task(id: selectedRange) {
        await refreshPreview()
      }
    }
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
  }

  @ViewBuilder
  private var previewContent: some View {
    if isPreviewing {
      HStack(spacing: 8) {
        ProgressView()
          .controlSize(.small)

        Text("Loading preview…")
          .foregroundStyle(.secondary)
      }
    } else if let preview {
      if preview.matchingSessions.isEmpty {
        Text("No old sessions found.")
          .foregroundStyle(.secondary)
      } else {
        Text(
          "\(preview.matchingSessions.count) session\(preview.matchingSessions.count == 1 ? "" : "s") will be purged."
        )
        .fontWeight(.semibold)

        ForEach(Array(preview.matchingSessions.prefix(20))) { session in
          Text(session.title)
            .lineLimit(1)
        }

        if preview.matchingSessions.count > 20 {
          Text("…and \(preview.matchingSessions.count - 20) more")
            .foregroundStyle(.secondary)
        }
      }
    } else {
      Text("Preview unavailable.")
        .foregroundStyle(.secondary)
    }
  }

  private var olderThanMilliseconds: Int {
    selectedRange.olderThanMilliseconds
  }

  private var canPurge: Bool {
    preview?.matchingSessions.isEmpty == false && !isPreviewing
  }

  private func refreshPreview() async {
    let range = selectedRange
    isPreviewing = true
    preview = nil

    let nextPreview = await model.previewDirectorySessionPurge(
      directory: directory,
      olderThanMs: range.olderThanMilliseconds
    )
    guard !Task.isCancelled, range == selectedRange else { return }

    preview = nextPreview
    isPreviewing = false
  }

  private func purge() {
    guard let matchingSessions = preview?.matchingSessions,
      !matchingSessions.isEmpty
    else {
      return
    }

    dismiss()
    model.purgeDirectorySessionsOptimistically(
      directory: directory,
      olderThanMs: olderThanMilliseconds,
      matchingSessions: matchingSessions
    )
  }
}

struct DirectorySessionRowButton: View {
  var entry: SessionListEntry
  var directory: String
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
  var contextSelectionCount = 1
  var deleteContextSelection: () -> Void = {}
  @State private var renameTitle = ""
  @State private var isShowingRenameSheet = false

  var body: some View {
    rowControl
      .buttonStyle(.plain)
      #if os(macOS)
        .contextMenu {
          if canMutateSession {
            if contextSelectionCount == 1 {
              Button {
                showRenameSessionSheet()
              } label: {
                Label("Rename", picoSystemImage: "pencil", size: 20)
              }

              Divider()
            }

            Button(role: .destructive) {
              deleteContextSelection()
            } label: {
              Label(deleteContextTitle, picoSystemImage: "trash", size: 20)
            }
          }
        }
      #endif
      .swipeActions(edge: .trailing, allowsFullSwipe: true) {
        if canMutateSession {
          Button(role: .destructive) {
            deleteSession()
          } label: {
            Label("Delete", picoSystemImage: "trash", size: 20)
          }
          .tint(.red)

          Button {
            showRenameSessionSheet()
          } label: {
            Label("Rename", picoSystemImage: "pencil", size: 20)
          }
          .tint(.blue)
        }
      }
      .sheet(isPresented: $isShowingRenameSheet) {
        NavigationStack {
          RenameSessionSheetView(
            model: model,
            initialName: renameTitle,
            path: entry.path
          ) { name in
            await model.renameSession(entry, to: name)
          }
        }
        .presentationDetents([.medium, .large])
      }
  }

  @ViewBuilder
  private var rowControl: some View {
    #if os(macOS)
      SessionRowView(entry: entry)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    #else
      Button {
        select()
      } label: {
        SessionRowView(entry: entry)
      }
    #endif
  }

  private var deleteContextTitle: String {
    contextSelectionCount == 1
      ? "Delete"
      : "Delete \(contextSelectionCount) Sessions"
  }

  private var canMutateSession: Bool {
    entry.optimistic != true
      && entry.path?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
  }

  private func select() {
    guard entry.selectionId != nil else {
      openDetail()
      return
    }

    openDetail()
    Task {
      await model.selectSession(entry)
    }
  }

  private func showRenameSessionSheet() {
    let name = entry.name?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let name, !name.isEmpty {
      renameTitle = name
    } else {
      renameTitle = entry.title
    }
    isShowingRenameSheet = true
  }

  private func deleteSession() {
    Task {
      await model.deleteSession(entry, directory: directory)
    }
  }
}

private struct DirectorySessionsLoadingRow: View {
  var body: some View {
    HStack(spacing: 8) {
      ProgressView()
        .controlSize(.small)

      Text("Loading sessions…")
        .foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

private struct SidebarDirectoryNameLabel: View {
  var path: String

  var body: some View {
    Text(DirectoryPathFormatter.folderName(path))
      .foregroundStyle(.primary)
      .lineLimit(1)
      .layoutPriority(1)
      .font(.body)
      .fontWeight(.bold)
  }
}

#Preview {
  List {
    DirectorySessionsSectionView(
      snapshot: DirectorySessionsIndexSnapshot(
        directory: "/Users/alice/project",
        totalCount: 1,
        revision: "1",
        sessions: [
          SessionListEntry(title: "Plan native app")
        ]
      ),
      model: AppModel()
    )
  }
}
