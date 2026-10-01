#if os(macOS)
  import SwiftUI

  typealias PlatformWorkspaceView = MacWorkspaceView

  struct MacWorkspaceView: View {
    @Bindable var model: AppModel
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var selectedDirectory: String?
    @State private var sessionSearchText = ""
    @State private var isSessionSearchPresented = false
    @State private var purgeRequest: MacDirectoryActionRequest?
    @State private var isFilesSidebarPresented = false
    @State private var isSessionSelectionCleared = false
    @State private var selectedSessionCount = 0

    var body: some View {
      NavigationSplitView(columnVisibility: $columnVisibility) {
        MacDirectorySidebarView(
          model: model,
          selectedDirectory: $selectedDirectory,
          openPurge: showPurgeDirectory
        )
        .navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 320)
      } content: {
        sessionsColumn
          .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 480)
      } detail: {
        detailWorkspace
      }
      .navigationSplitViewStyle(.balanced)
      .searchable(
        text: $sessionSearchText,
        isPresented: $isSessionSearchPresented,
        placement: .toolbar,
        prompt: "Search sessions"
      )
      .toolbar {
        ToolbarItem(placement: .navigation) {
          Button(
            "New Session",
            picoSystemImage: "square.and.pencil",
            action: startNewSession
          )
          .help("New Session")
          .disabled(selectedDirectory == nil)
        }
      }
      .sheet(item: $purgeRequest) { request in
        DirectorySessionPurgeSheet(
          model: model,
          directory: request.directory
        )
      }
      .onChange(of: model.sidebarDirectories, initial: true) {
        ensureSelectedDirectory()
      }
      .onChange(of: model.sessionState.cwd) { _, cwd in
        guard model.hasRealCurrentSession,
          let cwd,
          model.sidebarDirectories.contains(cwd)
        else {
          return
        }
        selectedDirectory = cwd
      }
      .onChange(of: selectedDirectory) {
        closeSessionSearch()
        if let selectedDirectory,
          model.isComposingNewSession
        {
          model.beginNewChat(cwd: selectedDirectory)
        } else if selectedDirectory == nil {
          isFilesSidebarPresented = false
        }
      }
      .onChange(of: model.conversationPresentationRequest) {
        selectedSessionCount = 1
        isSessionSelectionCleared = false
        columnVisibility = .all
      }
    }

    @ViewBuilder
    private var sessionsColumn: some View {
      if let selectedDirectory {
        NavigationStack {
          DirectorySessionsFullListView(
            directory: selectedDirectory,
            model: model,
            sessionSearchText: $sessionSearchText,
            openDetail: showConversation,
            openPurge: showPurgeDirectory,
            onRemoveDirectory: handleRemovedDirectory,
            showsSessionSelection: !isSessionSelectionCleared,
            deselectSession: clearSessionSelection,
            sessionSelectionCountChanged: updateSessionSelectionCount
          )
        }
      } else {
        ContentUnavailableView(
          "Select a directory",
          picoSystemImage: "folder",
          description: Text("Choose a directory to see its sessions.")
        )
        .navigationTitle("Sessions")
      }
    }

    @ViewBuilder
    private var detailWorkspace: some View {
      if isFilesSidebarPresented, let selectedDirectory {
        HSplitView {
          detailColumn
            .frame(minWidth: 400, maxWidth: .infinity)

          GitWorkspaceView(
            model: model,
            directory: selectedDirectory
          )
          .frame(
            minWidth: 320,
            idealWidth: 420,
            maxWidth: 700,
            maxHeight: .infinity
          )
        }
      } else {
        detailColumn
      }
    }

    private var detailColumn: some View {
      ConversationScreen(
        model: model,
        openSidebar: showAllColumns,
        openNewSession: startNewSession,
        macFilesToolbar: AnyView(macFilesToolbarButton),
        isConversationPresented: showsConversation && selectedSessionCount == 1,
        unavailableTitle: detailUnavailableTitle,
        unavailableDescription: detailUnavailableDescription
      )
    }

    private var detailUnavailableTitle: String {
      selectedSessionCount > 1
        ? "\(selectedSessionCount) Sessions Selected"
        : "Select a session"
    }

    private var detailUnavailableDescription: String {
      selectedSessionCount > 1
        ? "Use the session list context menu to delete the selected sessions."
        : "Choose a session from the middle column."
    }

    private var macFilesToolbarButton: some View {
      Button(
        "Files",
        picoSystemImage: "folder",
        action: toggleFilesSidebar
      )
      .help(isFilesSidebarPresented ? "Hide Files" : "Show Files")
      .disabled(selectedDirectory == nil)
    }

    private var showsConversation: Bool {
      guard !isSessionSelectionCleared,
        let selectedDirectory
      else {
        return false
      }
      return model.composerDirectory == selectedDirectory
        || model.loadingSessionCwd == selectedDirectory
        || model.sessionState.cwd == selectedDirectory
    }

    private func ensureSelectedDirectory() {
      let directories = model.sidebarDirectories
      guard !directories.isEmpty else {
        selectedDirectory = nil
        return
      }

      if let selectedDirectory, directories.contains(selectedDirectory) {
        return
      }
      if let sessionDirectory = model.sessionState.cwd,
        directories.contains(sessionDirectory)
      {
        selectedDirectory = sessionDirectory
      } else {
        selectedDirectory = directories.first
      }
    }

    private func closeSessionSearch() {
      isSessionSearchPresented = false
      sessionSearchText = ""
    }

    private func startNewSession() {
      guard let selectedDirectory else { return }
      model.beginNewChat(cwd: selectedDirectory)
      showConversation()
    }

    private func showConversation() {
      selectedSessionCount = 1
      isSessionSelectionCleared = false
      columnVisibility = .all
    }

    private func clearSessionSelection() {
      selectedSessionCount = 0
      isSessionSelectionCleared = true
    }

    private func updateSessionSelectionCount(_ count: Int) {
      selectedSessionCount = count
      isSessionSelectionCleared = count != 1
    }

    private func showAllColumns() {
      columnVisibility = .all
    }

    private func showPurgeDirectory(_ directory: String) {
      purgeRequest = MacDirectoryActionRequest(directory: directory)
    }

    private func toggleFilesSidebar() {
      guard selectedDirectory != nil else { return }
      isFilesSidebarPresented.toggle()
    }

    private func handleRemovedDirectory(_ directory: String) {
      guard selectedDirectory == directory else { return }
      selectedDirectory = model.sidebarDirectories.first
    }
  }

  private struct MacDirectorySidebarView: View {
    @Bindable var model: AppModel
    @Binding var selectedDirectory: String?
    var openPurge: (String) -> Void
    @State private var isShowingAddDirectory = false
    @State private var isDirectoriesExpanded = true

    var body: some View {
      List(selection: $selectedDirectory) {
        directoriesHeader

        if isDirectoriesExpanded {
          if model.sessionSnapshots.isEmpty {
            ContentUnavailableView(
              "No directories",
              picoSystemImage: "folder",
              description: Text("Add a directory to begin.")
            )
          } else {
            ForEach(model.sessionSnapshots) { snapshot in
              directoryRow(snapshot)
                .tag(snapshot.directory)
            }
            .onMove(perform: moveDirectories)
          }
        }
      }
      .navigationTitle("Directories")
      .onReceive(
        NotificationCenter.default.publisher(for: .picoAddDirectory)
      ) { _ in
        isShowingAddDirectory = true
      }
      .sheet(isPresented: $isShowingAddDirectory) {
        SidebarAddDirectoryView(model: model) {
          isShowingAddDirectory = false
        } onAdded: { directory in
          selectedDirectory = directory
        }
        .frame(minWidth: 620, minHeight: 560)
      }
    }

    private var directoriesHeader: some View {
      HStack {
        Text("Directories")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)

        Spacer()

        HStack(spacing: 0) {
          Button {
            isShowingAddDirectory = true
          } label: {
            PicoIcon(systemName: "plus.circle", size: 12, strokeWidth: 1)
              .frame(width: 24, height: 24)
              .contentShape(Rectangle())
          }
          .accessibilityLabel("Add Directory")

          Button {
            withAnimation(.easeInOut(duration: 0.15)) {
              isDirectoriesExpanded.toggle()
            }
          } label: {
            PicoIcon(
              systemName: isDirectoriesExpanded
                ? "chevron.down"
                : "chevron.right",
              size: 12,
              strokeWidth: 1
            )
            .frame(width: 24, height: 24, alignment: .trailing)
            .contentShape(Rectangle())
          }
          .accessibilityLabel(
            isDirectoriesExpanded
              ? "Collapse Directories"
              : "Expand Directories"
          )
        }
        .buttonStyle(.plain)
        .frame(minHeight: 24)
      }
      .contentShape(Rectangle())
      .listRowInsets(
        EdgeInsets(top: 6, leading: 4, bottom: 4, trailing: 4)
      )
      .listRowSeparator(.hidden)
      .listRowBackground(Color.clear)
    }

    private func directoryRow(
      _ snapshot: DirectorySessionsIndexSnapshot
    ) -> some View {
      SidebarDirectoryRowView(
        snapshot: snapshot,
        isEditing: true,
        isLoading: model.loadingDirectorySessionIndexes.contains(
          snapshot.directory
        ),
        showsDisclosureIndicator: false,
        openDirectory: { selectedDirectory = snapshot.directory }
      )
      .accessibilityHint("Select directory or drag to reorder")
      .contextMenu {
        Button("Purge Sessions…", picoSystemImage: "trash") {
          openPurge(snapshot.directory)
        }

        Divider()

        Button(
          "Remove Directory",
          picoSystemImage: "minus.circle",
          role: .destructive
        ) {
          removeDirectory(snapshot.directory)
        }
      }
      .swipeActions(edge: .trailing, allowsFullSwipe: true) {
        Button(role: .destructive) {
          removeDirectory(snapshot.directory)
        } label: {
          Label("Remove", picoSystemImage: "trash", size: 18)
        }
      }
    }

    private func moveDirectories(
      from source: IndexSet,
      to destination: Int
    ) {
      model.moveSidebarDirectories(
        fromOffsets: source,
        toOffset: destination
      )
    }

    private func removeDirectory(_ directory: String) {
      model.removeSidebarDirectory(directory)
      if selectedDirectory == directory {
        selectedDirectory = model.sidebarDirectories.first
      }
    }
  }

  private struct MacDirectoryActionRequest: Identifiable {
    var directory: String
    var id: String { directory }
  }
#endif
