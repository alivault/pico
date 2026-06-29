import SwiftUI

struct SessionSidebarView: View {
  @Bindable var model: AppModel
  var openNewSession: () -> Void = {}
  var openConversation: () -> Void = {}
  @State private var isShowingSettings = false
  @State private var isShowingAddDirectory = false
  @State private var isShowingManageDirectories = false
  @State private var sessionSearchText = ""
  @State private var isSessionSearchPresented = false
  @FocusState private var isSessionSearchFocused: Bool

  var body: some View {
    List {
      if model.sessionSnapshots.isEmpty {
        ContentUnavailableView(
          "No directories",
          systemImage: "folder",
          description: Text("Add a directory to show its Pico sessions here.")
        )
      } else if visibleSessionSnapshots.isEmpty {
        ContentUnavailableView.search(text: sessionSearchText)
      }

      ForEach(visibleSessionSnapshots) { snapshot in
        DirectorySessionsSectionView(
          snapshot: snapshot,
          model: model,
          openDetail: openConversation,
          isSearchActive: isSessionSearchActive,
          isLoading: model.loadingDirectorySessionIndexes.contains(
            snapshot.directory
          )
        )
      }
    }
    .contentMargins(.top, 0, for: .scrollContent)
    .safeAreaPadding(.bottom, isSessionSearchVisible ? 0 : 48)
    .overlay(alignment: .bottomTrailing) {
      floatingNewSessionButton
    }
    .navigationTitle("Sessions")
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button(action: showSearch) {
          Image(systemName: "magnifyingglass")
        }
        .disabled(model.sessionSnapshots.isEmpty)
        .accessibilityLabel("Search sessions")

        ControlGroup {
          Button(action: showAddDirectory) {
            Image(systemName: "folder.badge.plus")
          }
          .accessibilityLabel("Add directory")

          Menu {
            Button(action: showManageDirectories) {
              Label("Edit Directories", systemImage: "folder")
            }

            Button(action: showSettings) {
              Label("Settings", systemImage: "gearshape")
            }
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel("Sidebar actions")
        }
      }
    }
    .safeAreaBar(edge: .bottom, alignment: .center) {
      if isSessionSearchVisible {
        sidebarSearchBar
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
    .sheet(isPresented: $isShowingManageDirectories) {
      SidebarManageDirectoriesView(model: model) {
        isShowingManageDirectories = false
      }
      .presentationDetents([.large])
      .presentationDragIndicator(.visible)
    }
    .onChange(of: isSessionSearchPresented) { _, isPresented in
      if isPresented {
        isSessionSearchFocused = true
      }
    }
  }

  private var sidebarSearchBar: some View {
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

  @ViewBuilder
  private var floatingNewSessionButton: some View {
    if !isSessionSearchVisible {
      SidebarNewSessionButton(openNewSession: openNewSession)
        .padding(.trailing)
    }
  }

  private var isSessionSearchVisible: Bool {
    isSessionSearchPresented || isSessionSearchFocused || isSessionSearchActive
  }

  private var isSessionSearchActive: Bool {
    !sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var visibleSessionSnapshots: [DirectorySessionsIndexSnapshot] {
    let query = sessionSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return model.sessionSnapshots }

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

  private func showSearch() {
    isSessionSearchPresented = true
    isSessionSearchFocused = true
  }

  private func closeSearch() {
    sessionSearchText = ""
    isSessionSearchFocused = false
    isSessionSearchPresented = false
  }

  private func showSettings() {
    isShowingSettings = true
  }

  private func showAddDirectory() {
    isShowingAddDirectory = true
  }

  private func showManageDirectories() {
    isShowingManageDirectories = true
  }
}

struct SidebarSessionSearchField: View {
  @Binding var text: String
  @FocusState.Binding var isFocused: Bool

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)

      TextField("Search sessions", text: $text)
        .focused($isFocused)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.search)

      if !text.isEmpty {
        Button(action: clearSearch) {
          Image(systemName: "xmark.circle.fill")
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

private struct SidebarManageDirectoriesView: View {
  @Bindable var model: AppModel
  var onDismiss: () -> Void
  @State private var isShowingAddDirectory = false
  @State private var selectedDirectories = Set<String>()
  @State private var editMode = EditMode.active
  @State private var originalSidebarDirectories: [String] = []
  @State private var didCaptureOriginalDirectories = false
  @State private var isShowingDiscardConfirmation = false

  var body: some View {
    NavigationStack {
      List(selection: $selectedDirectories) {
        if model.sidebarDirectories.isEmpty {
          ContentUnavailableView(
            "No directories",
            systemImage: "folder",
            description: Text("Add directories to show their Pico sessions.")
          )
          .listRowBackground(Color.clear)
        } else {
          Section {
            ForEach(model.sidebarDirectories, id: \.self) { directory in
              NewSessionDirectoryLabel(
                path: directory,
                isSelected: false
              )
              .tag(directory)
            }
            .onMove(perform: moveDirectories)
            .onDelete(perform: deleteDirectories)
          } footer: {
            Text(
              "Select directories to delete multiple, drag directories into a new order, or use the row delete button to remove one directory."
            )
          }
        }

        Section {
          Button(action: showAddDirectory) {
            Label("Add Directory", systemImage: "folder.badge.plus")
          }
        }
      }
      .environment(\.editMode, $editMode)
      .navigationTitle("Edit Directories")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(action: closeAndMaybeDiscardChanges) {
            Image(systemName: "xmark")
          }
          .accessibilityLabel("Close and discard changes")
          .confirmationDialog(
            "Discard directory changes?",
            isPresented: $isShowingDiscardConfirmation,
            titleVisibility: .visible
          ) {
            Button("Discard Changes", role: .destructive) {
              discardChanges()
            }
            Button("Cancel", role: .cancel) {}
          } message: {
            Text(
              "This restores the directory list to how it was when you opened Edit Directories."
            )
          }
        }
        ToolbarItem(placement: .primaryAction) {
          Button(action: onDismiss) {
            Image(systemName: "checkmark")
          }
          .buttonStyle(.borderedProminent)
          .buttonBorderShape(.circle)
          .accessibilityLabel("Done")
        }
        ToolbarItemGroup(placement: .bottomBar) {
          if editMode.isEditing && !model.sidebarDirectories.isEmpty {
            Button(selectAllTitle, action: toggleSelectAll)

            Spacer()

            Button(role: .destructive, action: deleteSelectedDirectories) {
              Label(deleteSelectedTitle, systemImage: "trash")
            }
            .disabled(selectedDirectories.isEmpty)
          }
        }
      }
      .sheet(isPresented: $isShowingAddDirectory) {
        SidebarAddDirectoryView(model: model) {
          isShowingAddDirectory = false
        }
      }
      .onAppear(perform: captureOriginalDirectoriesIfNeeded)
      .onChange(of: model.sidebarDirectories) { _, directories in
        selectedDirectories.formIntersection(Set(directories))
      }
    }
  }

  private var selectAllTitle: String {
    selectedDirectories.count == model.sidebarDirectories.count
      ? "Deselect All"
      : "Select All"
  }

  private var deleteSelectedTitle: String {
    selectedDirectories.isEmpty
      ? "Delete"
      : "Delete (\(selectedDirectories.count))"
  }

  private var hasDirectoryChanges: Bool {
    didCaptureOriginalDirectories &&
      model.sidebarDirectories != originalSidebarDirectories
  }

  private func showAddDirectory() {
    isShowingAddDirectory = true
  }

  private func captureOriginalDirectoriesIfNeeded() {
    guard !didCaptureOriginalDirectories else { return }
    originalSidebarDirectories = model.sidebarDirectories
    didCaptureOriginalDirectories = true
  }

  private func closeAndMaybeDiscardChanges() {
    if hasDirectoryChanges {
      isShowingDiscardConfirmation = true
    } else {
      onDismiss()
    }
  }

  private func discardChanges() {
    Task {
      await model.replaceSidebarDirectories(originalSidebarDirectories)
      selectedDirectories.formIntersection(Set(originalSidebarDirectories))
      onDismiss()
    }
  }

  private func toggleSelectAll() {
    if selectedDirectories.count == model.sidebarDirectories.count {
      selectedDirectories.removeAll()
    } else {
      selectedDirectories = Set(model.sidebarDirectories)
    }
  }

  private func moveDirectories(from source: IndexSet, to destination: Int) {
    model.moveSidebarDirectories(fromOffsets: source, toOffset: destination)
  }

  private func deleteDirectories(at offsets: IndexSet) {
    let directories: [String] = offsets.compactMap { offset -> String? in
      guard model.sidebarDirectories.indices.contains(offset) else {
        return nil
      }
      return model.sidebarDirectories[offset]
    }

    guard !directories.isEmpty else { return }
    selectedDirectories.subtract(Set(directories))
    model.removeSidebarDirectories(directories)
  }

  private func deleteSelectedDirectories() {
    let directories = model.sidebarDirectories.filter {
      selectedDirectories.contains($0)
    }
    guard !directories.isEmpty else { return }

    selectedDirectories.removeAll()
    model.removeSidebarDirectories(directories)
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
      Image(systemName: "xmark")
        .font(.system(size: 16, weight: .semibold))
        .frame(width: 33, height: 33)
        .contentShape(Circle())
    }
    .buttonStyle(.glass)
    .buttonBorderShape(.circle)
    .accessibilityLabel("Close search")
  }
}

private struct SidebarNewSessionButton: View {
  var openNewSession: () -> Void

  var body: some View {
    Button(action: openNewSession) {
      Image(systemName: "square.and.pencil")
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
    SessionSidebarView(model: AppModel())
  }
}
