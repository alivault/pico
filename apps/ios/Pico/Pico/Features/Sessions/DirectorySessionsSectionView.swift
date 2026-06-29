import SwiftUI

struct DirectorySessionsSectionView: View {
  var snapshot: DirectorySessionsIndexSnapshot
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
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
                openDetail: openDetail
              )
            } label: {
              Text("See all")
            }
          }
        }
      }
    } header: {
      directoryHeaderRow
    }
    .listSectionSpacing(8)
  }

  private var directoryHeaderRow: some View {
    HStack(spacing: 8) {
      Button(action: toggleExpanded) {
        HStack(spacing: 8) {
          SidebarDirectoryPathLabel(path: snapshot.directory)

          Spacer(minLength: 8)

          if isLoading {
            ProgressView()
              .controlSize(.small)
              .accessibilityLabel("Loading sessions")
          }

          Image(systemName: "chevron.down")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.secondary)
            .rotationEffect(.degrees(isExpanded ? 0 : -90))
            .frame(width: 20, height: 28)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(
        "\(DirectoryPathFormatter.displayPath(snapshot.directory)), \(isExpanded ? "expanded" : "collapsed")"
      )
      .accessibilityHint(isExpanded ? "Collapse directory" : "Expand directory")
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
}

private struct DirectorySessionsFullListView: View {
  var directory: String
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
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
      ToolbarItem(placement: .topBarTrailing) {
        Button(action: showSearch) {
          Image(systemName: "magnifyingglass")
        }
        .disabled(snapshot.sessions.isEmpty)
        .accessibilityLabel("Search sessions")
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
        Button(role: .destructive) {
          isShowingDeleteConfirmation = true
        } label: {
          Label("Delete", systemImage: "trash")
        }

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
