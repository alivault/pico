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
    .listSectionSpacing(8)
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

  var body: some View {
    List {
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
            openDetail: openDetail
          )
        }
      }
    }
    .safeAreaPadding(.bottom, 72)
    .navigationTitle(DirectoryPathFormatter.folderName(directory))
    .navigationBarTitleDisplayMode(.large)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        ControlGroup {
          Button(action: showFiles) {
            PicoIcon(systemName: "folder", size: 20)
          }
          .accessibilityLabel(
            "Files for \(DirectoryPathFormatter.folderName(directory))"
          )

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
    }
    .onAppear(perform: updateFloatingNewSessionVisibility)
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

  private func updateFloatingNewSessionVisibility() {
    setFloatingNewSessionHidden(false)
  }

  private func showPurgeSheet() {
    openPurge(directory)
  }

  private func showFiles() {
    openFiles(directory)
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

struct DirectorySessionRowButton: View {
  var entry: SessionListEntry
  var directory: String
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
  @State private var renameTitle = ""
  @State private var isShowingRenameSheet = false

  var body: some View {
    Button {
      select()
    } label: {
      SessionRowView(entry: entry)
    }
    .buttonStyle(.plain)
    .listRowBackground(selectedRowBackground)
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

  private var selectedRowBackground: Color? {
    nil
  }

  private var canMutateSession: Bool {
    entry.optimistic != true &&
      entry.path?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
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
