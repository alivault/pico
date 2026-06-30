import SwiftUI

struct DirectorySessionsSectionView: View {
  var snapshot: DirectorySessionsIndexSnapshot
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
  var openPurge: (String) -> Void = { _ in }
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
              model: model,
              openDetail: openDetail
            )
          }

          if hasMoreSessions {
            NavigationLink {
              DirectorySessionsFullListView(
                directory: snapshot.directory,
                model: model,
                openDetail: openDetail,
                openPurge: openPurge
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
    .listSectionSpacing(8)
    .headerProminence(.increased)
  }

  private var directoryHeaderRow: some View {
    HStack(spacing: 8) {
      Button(action: toggleExpanded) {
        HStack(spacing: 8) {
          Image(systemName: "folder")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(width: 20, height: 28)

          SidebarDirectoryPathLabel(path: snapshot.directory)

          Image(systemName: "chevron.down")
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
        "\(DirectoryPathFormatter.displayPath(snapshot.directory)), \(isExpanded ? "expanded" : "collapsed")"
      )
      .accessibilityHint(isExpanded ? "Collapse directory" : "Expand directory")

      Button(action: startNewSession) {
        Image(systemName: "square.and.pencil")
          .font(.subheadline.weight(.semibold))
          .frame(width: 44, height: 32)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .accessibilityLabel(
        "New session in \(DirectoryPathFormatter.displayPath(snapshot.directory))"
      )
      .accessibilityHint("Starts a new draft in this directory")

      Menu {
        Button(action: showPurgeSheet) {
          Label("Purge Sessions…", systemImage: "trash")
        }

        Button(role: .destructive, action: removeDirectory) {
          Label("Remove Directory", systemImage: "minus.circle")
        }
      } label: {
        Image(systemName: "ellipsis")
          .font(.subheadline.weight(.semibold))
          .frame(width: 44, height: 32)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .accessibilityLabel(
        "Actions for \(DirectoryPathFormatter.displayPath(snapshot.directory))"
      )
    }
    .textCase(nil)
  }

  private var visibleSessions: Array<SessionListEntry> {
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

  private func removeDirectory() {
    model.removeSidebarDirectory(snapshot.directory)
  }
}

private struct DirectorySessionsFullListView: View {
  var directory: String
  @Bindable var model: AppModel
  @Environment(\.dismiss) private var dismiss
  var openDetail: () -> Void = {}
  var openPurge: (String) -> Void = { _ in }
  @State private var sessionSearchText = ""
  @State private var isSessionSearchPresented = false
  @FocusState private var isSessionSearchFocused: Bool

  var body: some View {
    List {
      if snapshot.sessions.isEmpty {
        ContentUnavailableView(
          "No sessions",
          systemImage: "text.bubble",
          description: Text("This directory does not have any Pico sessions yet.")
        )
      } else if visibleSessions.isEmpty {
        ContentUnavailableView.search(text: sessionSearchText)
      } else {
        Section {
          ForEach(visibleSessions) { entry in
            DirectorySessionRowButton(
              entry: entry,
              model: model,
              openDetail: openDetail
            )
          }
        } header: {
          SidebarDirectoryPathLabel(path: snapshot.directory)
            .textCase(nil)
        }
      }
    }
    .navigationTitle(DirectoryPathFormatter.folderName(directory))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button(action: showSearch) {
          Image(systemName: "magnifyingglass")
        }
        .disabled(snapshot.sessions.isEmpty)
        .accessibilityLabel("Search sessions")

        ControlGroup {
          Button(action: startNewSession) {
            Image(systemName: "square.and.pencil")
          }
          .accessibilityLabel(
            "New session in \(DirectoryPathFormatter.displayPath(directory))"
          )

          Menu {
            Button(action: showPurgeSheet) {
              Label("Purge Sessions…", systemImage: "trash")
            }

            Button(role: .destructive, action: removeDirectory) {
              Label("Remove Directory", systemImage: "minus.circle")
            }
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel(
            "Actions for \(DirectoryPathFormatter.displayPath(directory))"
          )
        }
      }
    }
    .safeAreaBar(edge: .bottom, alignment: .center) {
      if isSessionSearchVisible {
        sessionSearchBar
      }
    }
    .onChange(of: isSessionSearchPresented) { _, isPresented in
      if isPresented {
        isSessionSearchFocused = true
      }
    }
  }

  private var sessionSearchBar: some View {
    HStack(spacing: 10) {
      SidebarSessionSearchField(
        text: $sessionSearchText,
        isFocused: $isSessionSearchFocused
      )

      SidebarCloseSearchButton(closeSearch: closeSearch)
    }
    .padding(.horizontal)
    .padding(.vertical, 8)
    .animation(.smooth(duration: 0.2), value: isSessionSearchVisible)
  }

  private var isSessionSearchVisible: Bool {
    isSessionSearchPresented || isSessionSearchFocused || isSessionSearchActive
  }

  private var isSessionSearchActive: Bool {
    !sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var visibleSessions: [SessionListEntry] {
    let query = sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return snapshot.sessions }

    return snapshot.sessions.filter { sessionMatches($0, query: query) }
  }

  private var snapshot: DirectorySessionsIndexSnapshot {
    model.sessionSnapshots.first { $0.directory == directory } ??
      DirectorySessionsIndexSnapshot(
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

  private func showSearch() {
    isSessionSearchPresented = true
    isSessionSearchFocused = true
  }

  private func closeSearch() {
    sessionSearchText = ""
    isSessionSearchFocused = false
    isSessionSearchPresented = false
  }

  private func startNewSession() {
    model.beginNewChat(cwd: directory)
    openDetail()
  }

  private func showPurgeSheet() {
    openPurge(directory)
  }

  private func removeDirectory() {
    model.removeSidebarDirectory(directory)
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
      .navigationTitle("Purge Sessions")
      .navigationBarTitleDisplayMode(.inline)
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
          !matchingSessions.isEmpty else {
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

private struct DirectorySessionRowButton: View {
  var entry: SessionListEntry
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
  @State private var renameTitle = ""
  @State private var isShowingRenameAlert = false
  @State private var isShowingDeleteConfirmation = false

  var body: some View {
    Button {
      select()
    } label: {
      SessionRowView(entry: entry)
    }
    .buttonStyle(.plain)
    .listRowBackground(selectedRowBackground)
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      if canMutateSession {
        Button {
          showDeleteSessionConfirmation()
        } label: {
          Label("Delete", systemImage: "trash")
        }
        .tint(.red)

        Button {
          showRenameSessionAlert()
        } label: {
          Label("Rename", systemImage: "pencil")
        }
        .tint(.blue)
      }
    }
    .alert("Rename session", isPresented: $isShowingRenameAlert) {
      TextField("Session name", text: $renameTitle)
      Button("Cancel", role: .cancel) {}
      Button("Rename") {
        renameSession()
      }
    } message: {
      Text("Enter a new name for this session.")
    }
    .confirmationDialog(
      "Delete session?",
      isPresented: $isShowingDeleteConfirmation,
      titleVisibility: .visible
    ) {
      Button("Delete Session", role: .destructive) {
        deleteSession()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This removes the session from Pico and moves it to Trash when possible.")
    }
  }

  private var selectedRowBackground: Color? {
    isSelected ? Color(.tertiarySystemFill) : nil
  }

  private var canMutateSession: Bool {
    entry.optimistic != true &&
      entry.path?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
  }

  private var isSelected: Bool {
    if let selectionId = entry.selectionId,
       selectionId == model.selectedSessionId {
      return true
    }

    if let sessionId = entry.sessionId,
       sessionId == model.sessionState.sessionId {
      return true
    }

    if let path = entry.path,
       path == model.sessionState.sessionFile {
      return true
    }

    return entry.optimistic == true &&
      entry.cwd == model.sessionState.cwd &&
      entry.title == model.sessionState.displayTitle
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

  private func showDeleteSessionConfirmation() {
    isShowingDeleteConfirmation = true
  }

  private func showRenameSessionAlert() {
    let name = entry.name?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let name, !name.isEmpty {
      renameTitle = name
    } else {
      renameTitle = entry.title
    }
    isShowingRenameAlert = true
  }

  private func renameSession() {
    let name = renameTitle
    Task {
      await model.renameSession(entry, to: name)
    }
  }

  private func deleteSession() {
    Task {
      await model.deleteSession(entry)
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

private struct SidebarDirectoryPathLabel: View {
  var path: String

  var body: some View {
    let splitPath = splitDisplayPath(
      DirectoryPathFormatter.displayPath(path)
    )

    HStack(spacing: 0) {
      if !splitPath.leading.isEmpty {
        Text(splitPath.leading)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }

      Text(splitPath.trailing)
        .foregroundStyle(.primary)
        .lineLimit(1)
        .layoutPriority(1)
    }
    .font(.body)
    .fontWeight(.bold)
  }

  private func splitDisplayPath(_ value: String) -> (
    leading: String,
    trailing: String
  ) {
    guard !value.isEmpty else {
      return (leading: "", trailing: "")
    }

    var trimmedEnd = value.endIndex
    while trimmedEnd > value.startIndex {
      let previousIndex = value.index(before: trimmedEnd)
      let character = value[previousIndex]
      guard character == "/" || character == "\\" else { break }
      trimmedEnd = previousIndex
    }

    let trimmedPath = String(value[..<trimmedEnd])
    guard !trimmedPath.isEmpty else {
      return (leading: "", trailing: value)
    }

    let suffix = String(value[trimmedEnd...])
    guard let separatorIndex = trimmedPath.lastIndex(where: {
      $0 == "/" || $0 == "\\"
    }) else {
      return (leading: "", trailing: "\(trimmedPath)\(suffix)")
    }

    let trailingStart = trimmedPath.index(after: separatorIndex)
    return (
      leading: String(trimmedPath[...separatorIndex]),
      trailing: "\(String(trimmedPath[trailingStart...]))\(suffix)"
    )
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
