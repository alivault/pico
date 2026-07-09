import SwiftUI

struct SessionSidebarView: View {
  @Bindable var model: AppModel
  @Binding var sessionSearchText: String
  var openDetail: () -> Void = {}
  var openDirectory: (String) -> Void = { _ in }
  var openPurge: (String) -> Void = { _ in }
  var openFiles: (String) -> Void = { _ in }
  var setFloatingNewSessionHidden: (Bool) -> Void = { _ in }
  var clearFloatingSearch: () -> Void = {}
  @State private var isShowingSettings = false
  @State private var isShowingAddDirectory = false
  @State private var selectedDirectories = Set<String>()
  @State private var editMode = EditMode.inactive

  var body: some View {
    directoryList
      .environment(\.editMode, $editMode)
      .contentMargins(.top, 0, for: .scrollContent)
      .safeAreaPadding(.bottom, isEditing ? 48 : 72)
      .overlay(alignment: .bottomTrailing) {
        floatingDeleteSelectedButton
      }
      .animation(.smooth(duration: 0.2), value: isEditing)
      .navigationTitle(sidebarNavigationTitle)
      .toolbar {
        if isEditing {
          ToolbarItem(placement: .topBarLeading) {
            selectAllDirectoriesButton
          }

          ToolbarItem(placement: .topBarTrailing) {
            Button("Done", action: finishEditing)
              .fontWeight(.semibold)
          }
        } else {
          ToolbarItemGroup(placement: .topBarTrailing) {
            ControlGroup {
              Button(action: showAddDirectory) {
                PicoIcon(systemName: "folder.badge.plus")
              }
              .accessibilityLabel("Add directory")

              Menu {
                Button(action: beginEditing) {
                  Label("Edit Directories", picoSystemImage: "folder", size: 20)
                }
                .disabled(model.sidebarDirectories.isEmpty)

                Button(action: showSettings) {
                  Label("Settings", picoSystemImage: "gearshape", size: 20)
                }
              } label: {
                Image(picoSystemName: "ellipsis")
              }
              .accessibilityLabel("Sidebar actions")
            }
          }
        }
      }
      .sheet(isPresented: $isShowingSettings) {
        NavigationStack {
          SettingsView(model: model)
        }
      }
      .sheet(isPresented: $isShowingAddDirectory) {
        SidebarAddDirectoryView(model: model) {
          isShowingAddDirectory = false
        }
      }
      .onAppear(perform: updateFloatingNewSessionVisibility)
      .onChange(of: shouldHideFloatingNewSessionButton) { _, _ in
        updateFloatingNewSessionVisibility()
      }
      .onChange(of: model.sidebarDirectories) { _, directories in
        selectedDirectories.formIntersection(Set(directories))
        if directories.isEmpty, isEditing {
          finishEditing()
        }
      }
  }

  private var directoryList: some View {
    List(selection: $selectedDirectories) {
      directoryListContent
    }
  }

  @ViewBuilder
  private var directoryListContent: some View {
    if model.sessionSnapshots.isEmpty {
      ContentUnavailableView(
        "No directories",
        picoSystemImage: "folder",
        description: Text("Add a directory to show its Pico sessions here.")
      )
    } else if isSessionSearchActive {
      if visibleSessionSnapshots.isEmpty {
        PicoSearchUnavailableView(text: sessionSearchText)
      } else {
        ForEach(visibleSessionSnapshots) { snapshot in
          Section {
            ForEach(snapshot.sessions) { entry in
              DirectorySessionRowButton(
                entry: entry,
                directory: snapshot.directory,
                model: model,
                openDetail: openDetail
              )
            }
          } header: {
            SidebarSearchDirectoryHeader(directory: snapshot.directory)
          }
        }
      }
    } else {
      ForEach(visibleSessionSnapshots) { snapshot in
        directoryRow(for: snapshot)
          .tag(snapshot.directory)
      }
      .onMove(perform: moveDirectories)
    }
  }

  @ViewBuilder
  private func directoryRow(
    for snapshot: DirectorySessionsIndexSnapshot
  ) -> some View {
    let directory = snapshot.directory
    let row = SidebarDirectoryRowView(
      snapshot: snapshot,
      isEditing: isEditing,
      isLoading: model.loadingDirectorySessionIndexes.contains(directory),
      openDirectory: { openDirectory(directory) }
    )

    if isEditing {
      row
    } else {
      row
        .contextMenu {
          Button(action: { openFiles(directory) }) {
            Label("Files", picoSystemImage: "folder", size: 20)
          }

          Button(action: { openPurge(directory) }) {
            Label("Purge Sessions…", picoSystemImage: "trash", size: 20)
          }

          Divider()

          Button(role: .destructive, action: { removeDirectory(directory) }) {
            Label("Remove Directory", picoSystemImage: "minus.circle", size: 20)
          }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
          Button(role: .destructive, action: { removeDirectory(directory) }) {
            Label("Remove", picoSystemImage: "minus.circle", size: 20)
          }
        }
    }
  }

  @ViewBuilder
  private var floatingDeleteSelectedButton: some View {
    if isEditing {
      SidebarDeleteSelectedButton(
        deleteSelected: deleteSelectedDirectories
      )
      .disabled(selectedDirectories.isEmpty)
      .padding(.trailing)
      .transition(.scale.combined(with: .opacity))
    }
  }

  private var isEditing: Bool {
    editMode.isEditing
  }

  private var sidebarNavigationTitle: String {
    guard isEditing else { return "Directories" }
    let selectedCount = selectedDirectories.count
    guard selectedCount > 0 else { return "Select Directories" }
    return "\(selectedCount) Selected"
  }

  private var isSessionSearchActive: Bool {
    !sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var allDirectoriesAreSelected: Bool {
    !model.sidebarDirectories.isEmpty &&
      selectedDirectories.count == model.sidebarDirectories.count
  }

  @ViewBuilder
  private var selectAllDirectoriesButton: some View {
    if allDirectoriesAreSelected {
      Button("Deselect All", action: toggleAllDirectoriesSelected)
        .disabled(model.sidebarDirectories.isEmpty)
        .accessibilityValue("All selected")
    } else {
      Button("Select All", action: toggleAllDirectoriesSelected)
        .disabled(model.sidebarDirectories.isEmpty)
        .accessibilityValue("Not all selected")
    }
  }

  private var shouldHideFloatingNewSessionButton: Bool {
    isEditing
  }

  private var visibleSessionSnapshots: [DirectorySessionsIndexSnapshot] {
    let query = sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !isEditing, !query.isEmpty else { return model.sessionSnapshots }

    return model.sessionSnapshots.compactMap { snapshot in
      let sessions = snapshot.sessions.filter { sessionMatches($0, query: query) }
      guard !sessions.isEmpty else { return nil }

      return DirectorySessionsIndexSnapshot(
        directory: snapshot.directory,
        totalCount: sessions.count,
        revision: "\(snapshot.revision):search:\(query)",
        sessions: sessions
      )
    }
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

  private func showSettings() {
    isShowingSettings = true
  }

  private func showAddDirectory() {
    isShowingAddDirectory = true
  }

  private func updateFloatingNewSessionVisibility() {
    setFloatingNewSessionHidden(shouldHideFloatingNewSessionButton)
  }

  private func beginEditing() {
    clearFloatingSearch()
    selectedDirectories.formIntersection(Set(model.sidebarDirectories))
    withAnimation(.smooth(duration: 0.2)) {
      editMode = .active
    }
  }

  private func finishEditing() {
    withAnimation(.smooth(duration: 0.2)) {
      editMode = .inactive
      selectedDirectories.removeAll()
    }
  }

  private func toggleAllDirectoriesSelected() {
    setAllDirectoriesSelected(!allDirectoriesAreSelected)
  }

  private func setAllDirectoriesSelected(_ isSelected: Bool) {
    withAnimation(.smooth(duration: 0.2)) {
      if isSelected {
        selectedDirectories = Set(model.sidebarDirectories)
      } else {
        selectedDirectories.removeAll()
      }
    }
  }

  private func deleteSelectedDirectories() {
    let directories = model.sidebarDirectories.filter {
      selectedDirectories.contains($0)
    }
    guard !directories.isEmpty else { return }

    withAnimation(.smooth(duration: 0.2)) {
      selectedDirectories.removeAll()
    }
    model.removeSidebarDirectories(directories)
    if model.sidebarDirectories.isEmpty {
      finishEditing()
    }
  }

  private func removeDirectory(_ directory: String) {
    model.removeSidebarDirectory(directory)
  }

  private func moveDirectories(from source: IndexSet, to destination: Int) {
    guard isEditing, !isSessionSearchActive else { return }
    model.moveSidebarDirectories(fromOffsets: source, toOffset: destination)
    selectedDirectories.formIntersection(Set(model.sidebarDirectories))
  }
}

private struct SidebarDirectoryRowView: View {
  var snapshot: DirectorySessionsIndexSnapshot
  var isEditing: Bool
  var isLoading: Bool
  var openDirectory: () -> Void

  var body: some View {
    Group {
      if isEditing {
        rowContent
      } else {
        Button(action: openDirectory) {
          rowContent
        }
        .buttonStyle(.plain)
      }
    }
    .accessibilityLabel(rowAccessibilityLabel)
    .accessibilityHint(accessibilityHint)
    .padding(.vertical, 2)
  }

  private var rowContent: some View {
    HStack(spacing: 10) {
      PicoIcon(systemName: "folder")
        .font(.body.weight(.semibold))
        .foregroundStyle(.secondary)
        .frame(width: 24)

      Text(folderName)
        .font(.body)
        .fontWeight(.semibold)
        .foregroundStyle(.primary)
        .lineLimit(1)

      Spacer(minLength: 8)

      if unreadCount > 0 {
        Text("\(unreadCount)")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.white)
          .padding(.horizontal, 7)
          .padding(.vertical, 3)
          .background(.tint, in: Capsule())
          .accessibilityLabel(unreadCountAccessibilityLabel)
      }

      if isLoading {
        ProgressView()
          .controlSize(.small)
          .accessibilityLabel("Loading sessions")
      } else if !isEditing {
        PicoIcon(systemName: "chevron.right")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tertiary)
          .accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
  }

  private var folderName: String {
    DirectoryPathFormatter.folderName(snapshot.directory)
  }

  private var unreadCount: Int {
    snapshot.sessions.filter { $0.unread == true }.count
  }

  private var rowAccessibilityLabel: String {
    guard unreadCount > 0 else { return folderName }
    return "\(folderName), \(unreadCountAccessibilityLabel)"
  }

  private var accessibilityHint: String {
    isEditing
      ? "Select for bulk deletion, or use the move control to reorder."
      : "Open sessions in this directory"
  }

  private var unreadCountAccessibilityLabel: String {
    let suffix = unreadCount == 1 ? "unread session" : "unread sessions"
    return "\(unreadCount) \(suffix)"
  }
}

private struct SidebarSearchDirectoryHeader: View {
  var directory: String

  var body: some View {
    HStack(spacing: 8) {
      PicoIcon(systemName: "folder")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .frame(width: 20, height: 28)

      Text(DirectoryPathFormatter.folderName(directory))
        .font(.body)
        .fontWeight(.bold)
        .foregroundStyle(.primary)
        .lineLimit(1)

      Spacer(minLength: 8)
    }
    .textCase(nil)
    .accessibilityLabel(DirectoryPathFormatter.folderName(directory))
  }
}

struct SidebarSessionSearchField: View {
  @Binding var text: String
  @FocusState.Binding var isFocused: Bool
  var placeholder: String

  var body: some View {
    HStack(spacing: 8) {
      PicoIcon(systemName: "magnifyingglass")
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)

      TextField(placeholder, text: $text)
        .focused($isFocused)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.search)

      if !text.isEmpty {
        Button(action: clearSearch) {
          PicoIcon(systemName: "xmark.circle.fill")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .frame(maxWidth: .infinity)
    .glassEffect(.regular, in: Capsule())
  }

  private func clearSearch() {
    text = ""
    isFocused = true
  }
}

struct SidebarAddDirectoryView: View {
  @Bindable var model: AppModel
  var onDismiss: () -> Void
  var onAdded: (String) async -> Void = { _ in }
  @State private var navigationPath: [String] = []
  @State private var searchText = ""
  @State private var showHiddenDirectories = false
  @State private var homeDirectories: [CompletionItem] = []
  @State private var searchResults: [CompletionItem] = []
  @State private var isLoadingHome = false
  @State private var isSearching = false
  @State private var isAdding = false
  @State private var presentedAlert: AppAlert?
  @FocusState private var isSearchFocused: Bool

  var body: some View {
    NavigationStack(path: $navigationPath) {
      List {
        Section {
          TextField("Search or paste a directory path", text: $searchText)
            .focused($isSearchFocused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        } footer: {
          Text(
            "Add directories to the sidebar explicitly. Pico will keep other known directories out of the sidebar until you add them here."
          )
        }

        if let manualPath {
          Section("Add Path") {
            NewSessionDirectoryRow(
              path: manualPath,
              subtitle: "Add this path to the sidebar.",
              isSelected: false
            ) {
              addDirectory(manualPath)
            }
          }
        }

        if !visibleKnownDirectories.isEmpty {
          Section("Known Directories") {
            ForEach(visibleKnownDirectories, id: \.self) { directory in
              Button {
                addDirectory(directory)
              } label: {
                NewSessionDirectoryLabel(
                  path: directory,
                  isSelected: false
                )
              }
              .buttonStyle(.plain)
            }
          }
        }

        if isSearching || !visibleSearchResults.isEmpty {
          Section("Matching Directories") {
            if isSearching && visibleSearchResults.isEmpty {
              ProgressView("Searching directories…")
            }

            ForEach(visibleSearchResults) { item in
              Button {
                addDirectory(item.value)
              } label: {
                NewSessionDirectoryLabel(
                  path: item.value,
                  subtitle: item.description ?? "Found on your Mac",
                  isSelected: false
                )
              }
              .buttonStyle(.plain)
            }
          }
        }

        Section("Browse Home") {
          if isLoadingHome && visibleHomeDirectories.isEmpty {
            ProgressView("Loading folders…")
          }

          ForEach(visibleHomeDirectories) { item in
            NavigationLink(value: item.value) {
              NewSessionDirectoryLabel(
                path: item.value,
                isSelected: false
              )
            }
          }

          if !isLoadingHome && visibleHomeDirectories.isEmpty {
            Text("No folders found")
              .foregroundStyle(.secondary)
          }
        }
      }
      .disabled(isAdding)
      .navigationTitle("Add directory")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: onDismiss)
        }
        ToolbarItem(placement: .primaryAction) {
          if isAdding {
            ProgressView()
          } else {
            NewSessionOptionsMenu(showHiddenDirectories: $showHiddenDirectories)
          }
        }
      }
      .navigationDestination(for: String.self) { folderPath in
        NewSessionBrowseFolderView(
          model: model,
          folderPath: DirectoryPathFormatter.normalizedDirectoryPrefix(
            folderPath
          ),
          showHiddenDirectories: $showHiddenDirectories,
          chooseDirectory: addDirectory,
          useButtonTitle: "Add This Directory"
        )
      }
      .task {
        isSearchFocused = true
        await updateHomeDirectories()
      }
      .task(id: query) {
        await updateSearchResults()
      }
      .onChange(of: model.alert) { _, alert in
        guard let alert else { return }
        presentedAlert = alert
        model.alert = nil
      }
      .alert(item: $presentedAlert) { alert in
        Alert(
          title: Text(alert.title),
          message: Text(alert.message),
          dismissButton: .default(Text("OK"))
        )
      }
    }
  }

  private var query: String {
    searchText.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var manualPath: String? {
    guard !query.isEmpty,
          DirectoryPathFormatter.looksLikePath(query),
          !hasExactDirectoryMatch(query) else {
      return nil
    }
    return query
  }

  private var visibleKnownDirectories: [String] {
    let addedDirectories = Set(model.sidebarDirectories)
    return model.knownDirectories.filter { directory in
      !addedDirectories.contains(directory) &&
        (showHiddenDirectories ||
          !DirectoryPathFormatter.isHidden(directory)) &&
        DirectoryPathFormatter.matches(directory, query: query)
    }
  }

  private var visibleHomeDirectories: [CompletionItem] {
    homeDirectories.filter { item in
      item.isDirectory &&
        (showHiddenDirectories || !item.isHidden) &&
        DirectoryPathFormatter.matches(item.value, query: query)
    }
  }

  private var visibleSearchResults: [CompletionItem] {
    let knownDirectories = Set(model.knownDirectories)
    return searchResults.filter { item in
      item.isDirectory &&
        !knownDirectories.contains(item.value) &&
        (showHiddenDirectories || !item.isHidden)
    }
  }

  private func hasExactDirectoryMatch(_ value: String) -> Bool {
    exactDirectoryMatch(value) != nil
  }

  private func exactDirectoryMatch(_ value: String) -> String? {
    let normalizedValue = value
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    guard !normalizedValue.isEmpty else { return nil }

    let directories = model.knownDirectories +
      homeDirectories.map(\.value) +
      searchResults.map(\.value)

    return directories.first { directory in
      directory
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() == normalizedValue ||
        DirectoryPathFormatter.displayPath(directory).lowercased() ==
        normalizedValue
    }
  }

  private func updateHomeDirectories() async {
    isLoadingHome = true
    let directories = await model.listDirectoryEntries(
      prefix: DirectoryPathFormatter.homePrefix
    )
    guard !Task.isCancelled else { return }
    homeDirectories = directories
    isLoadingHome = false
  }

  private func updateSearchResults() async {
    guard !query.isEmpty, !DirectoryPathFormatter.looksLikePath(query) else {
      searchResults = []
      isSearching = false
      return
    }

    isSearching = true
    do {
      try await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      searchResults = await model.searchDirectories(query: query)
      isSearching = false
    } catch {
      guard !Task.isCancelled else { return }
      searchResults = []
      isSearching = false
    }
  }

  private func addDirectory(_ directory: String) {
    guard !isAdding else { return }

    isAdding = true
    Task {
      defer { isAdding = false }
      let added = await model.addDirectory(directory)
      if added {
        await onAdded(directory)
        onDismiss()
      } else if let alert = model.alert {
        presentedAlert = alert
        model.alert = nil
      }
    }
  }
}

struct SidebarCloseSearchButton: View {
  var closeSearch: () -> Void

  var body: some View {
    Button(action: closeSearch) {
      PicoIcon(systemName: "xmark")
        .font(.system(size: 16, weight: .semibold))
        .frame(width: 33, height: 33)
        .contentShape(Circle())
    }
    .buttonStyle(.glass)
    .buttonBorderShape(.circle)
    .accessibilityLabel("Close search")
  }
}

private struct SidebarDeleteSelectedButton: View {
  var deleteSelected: () -> Void

  var body: some View {
    Button(role: .destructive, action: deleteSelected) {
      PicoIcon(systemName: "trash")
        .font(.system(size: 20, weight: .semibold))
        .frame(width: 40, height: 40)
        .contentShape(Circle())
    }
    .buttonStyle(.glassProminent)
    .buttonBorderShape(.circle)
    .tint(.red)
    .foregroundStyle(.white)
    .accessibilityLabel("Delete selected directories")
  }
}

struct SidebarNewSessionButton: View {
  var openNewSession: () -> Void

  var body: some View {
    Button(action: openNewSession) {
      PicoIcon(systemName: "square.and.pencil")
        .font(.system(size: 20, weight: .semibold))
        .frame(width: 40, height: 40)
        .contentShape(Circle())
    }
    .buttonStyle(.glassProminent)
    .buttonBorderShape(.circle)
    .accessibilityLabel("New Session")
  }
}

#Preview {
  NavigationStack {
    SessionSidebarView(
      model: AppModel(),
      sessionSearchText: .constant("")
    )
  }
}
