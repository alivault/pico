import SwiftUI

struct GitWorkspaceView: View {
  @Bindable var model: AppModel
  var directory: String? = nil
  @State private var selectedTab: GitWorkspaceTab = .changes
  @State private var data = GitWorkspaceData()
  @State private var loadTask: Task<Void, Never>?
  @State private var isShowingCommitSheet = false
  @State private var isShowingForcePushConfirmation = false
  @State private var isShowingDiscardAllConfirmation = false
  @State private var isShowingNukeConfirmation = false

  private var cwd: String? {
    directory ?? model.filesWorkspaceDirectory
  }

  var body: some View {
    VStack(spacing: 0) {
      Picker("Files", selection: $selectedTab) {
        ForEach(GitWorkspaceTab.allCases) { tab in
          Label(tab.title, picoSystemImage: tab.systemImage).tag(tab)
        }
      }
      .pickerStyle(.segmented)
      .padding(.horizontal)
      .padding(.top, 8)
      .padding(.bottom, 10)

      Divider()

      content
    }
    .background(Color(uiColor: .systemGroupedBackground))
    .task(id: cwd ?? "") {
      await reloadAll()
    }
    .onChange(of: model.gitRefreshRevision) {
      refresh()
    }
    .sheet(isPresented: $isShowingCommitSheet) {
      if let cwd {
        NavigationStack {
          GitCommitSheetView(
            model: model,
            cwd: cwd,
            status: data.status,
            files: data.files,
            onComplete: {
              isShowingCommitSheet = false
              refresh()
            }
          )
        }
      }
    }
    .confirmationDialog(
      "Force push with lease?",
      isPresented: $isShowingForcePushConfirmation,
      titleVisibility: .visible
    ) {
      Button("Force Push", role: .destructive) {
        push(force: true)
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This uses Pico's guarded force-with-lease push on the server.")
    }
    .confirmationDialog(
      "Discard all changes?",
      isPresented: $isShowingDiscardAllConfirmation,
      titleVisibility: .visible
    ) {
      Button("Discard All Changes", role: .destructive) {
        discardAll(nukeWorkingTree: false)
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This resets tracked working-tree changes. Untracked files are preserved.")
    }
    .confirmationDialog(
      "Nuke working tree?",
      isPresented: $isShowingNukeConfirmation,
      titleVisibility: .visible
    ) {
      Button("Nuke Working Tree", role: .destructive) {
        discardAll(nukeWorkingTree: true)
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This discards tracked changes and removes untracked files. This cannot be undone.")
    }
  }

  @ViewBuilder
  private var content: some View {
    if cwd == nil {
      GitEmptyView(
        title: "No directory selected",
        systemImage: "folder",
        message: "Select or create a session with a project directory to browse files and Git changes."
      )
    } else if let errorMessage = data.errorMessage {
      ScrollView {
        GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
          .padding()
      }
    } else {
      switch selectedTab {
      case .changes:
        changesContent
      case .history:
        historyContent
      case .allFiles:
        ProjectFilesWorkspaceView(
          model: model,
          cwd: cwd ?? "",
          paths: data.projectPaths,
          gitFiles: data.files,
          isLoading: data.isLoadingTree,
          refresh: refresh
        )
      }
    }
  }

  private var changesContent: some View {
    VStack(spacing: 0) {
      GitWorkspaceToolbar(
        cwd: cwd,
        status: data.status,
        files: data.files,
        branches: data.localBranches,
        remoteBranches: data.remoteBranches,
        isLoading: data.isLoadingAny,
        refresh: refresh,
        openCommitSheet: { isShowingCommitSheet = true },
        checkoutBranch: checkoutBranch,
        pull: pull,
        push: { push(force: false) },
        confirmForcePush: { isShowingForcePushConfirmation = true },
        stageAll: { stageAll(unstage: false) },
        unstageAll: { stageAll(unstage: true) },
        confirmDiscardAll: { isShowingDiscardAllConfirmation = true },
        confirmNukeWorkingTree: { isShowingNukeConfirmation = true }
      )
      .padding(.horizontal)
      .padding(.vertical, 10)

      Divider()

      GitChangesWorkspaceView(
        model: model,
        cwd: cwd ?? "",
        status: data.status,
        files: data.files,
        isLoadingFiles: data.isLoadingFiles,
        refresh: refresh
      )
    }
  }

  private var historyContent: some View {
    ScrollView {
      GitHistoryView(
        model: model,
        cwd: cwd ?? "",
        commits: data.commitEntries,
        unpushedCommitHashes: data.unpushedCommitHashes,
        hasMore: data.commitsHasMore,
        isLoading: data.isLoadingCommits,
        loadMore: loadMoreCommits,
        refresh: refresh
      )
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .refreshable {
      refresh()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Color(uiColor: .systemBackground))
  }

  private func refresh() {
    loadTask?.cancel()
    loadTask = Task {
      await reloadAll()
    }
  }

  private func reloadAll() async {
    guard let cwd else {
      data = GitWorkspaceData()
      return
    }

    data.isLoadingStatus = true
    data.isLoadingFiles = true
    data.isLoadingBranches = true
    data.isLoadingCommits = true
    data.isLoadingTree = true
    data.errorMessage = nil

    do {
      async let statusResponse = model.fetchGitStatus(cwd: cwd)
      async let filesResponse = model.fetchGitChanges(cwd: cwd, scope: "files")
      async let branchesResponse = model.fetchGitChanges(cwd: cwd, scope: "branches")
      async let commitsResponse = model.fetchGitChanges(
        cwd: cwd,
        scope: "commits",
        commitsLimit: data.commitsLimit
      )
      async let treeResponse = model.fetchProjectFileTree(cwd: cwd)

      let (status, files, branches, commits, tree) = try await (
        statusResponse,
        filesResponse,
        branchesResponse,
        commitsResponse,
        treeResponse
      )

      guard !Task.isCancelled else { return }
      data.status = status.gitStatus
      data.files = files.files ?? []
      data.localBranches = branches.localBranches ?? []
      data.remoteBranches = branches.remoteBranches ?? []
      data.commits = commits.commits ?? []
      data.commitsHasMore = commits.commitsHasMore ?? false
      data.commitsLimit = commits.commitsLimit ?? data.commitsLimit
      data.unpushedCommitHashes = commits.unpushedCommitHashes ?? []
      data.projectPaths = tree.paths
      data.errorMessage = nil
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled else { return }
      data.errorMessage = Self.message(for: error)
    }

    data.isLoadingStatus = false
    data.isLoadingFiles = false
    data.isLoadingBranches = false
    data.isLoadingCommits = false
    data.isLoadingTree = false
  }

  private func loadMoreCommits() {
    guard let cwd else { return }
    data.commitsLimit += GitFormatting.commitPageSize
    data.isLoadingCommits = true
    Task {
      do {
        let response = try await model.fetchGitChanges(
          cwd: cwd,
          scope: "commits",
          commitsLimit: data.commitsLimit
        )
        data.commits = response.commits ?? []
        data.commitsHasMore = response.commitsHasMore ?? false
        data.commitsLimit = response.commitsLimit ?? data.commitsLimit
        data.unpushedCommitHashes = response.unpushedCommitHashes ?? []
        data.isLoadingCommits = false
      } catch {
        data.isLoadingCommits = false
        model.alert = AppAlert(
          title: "Could not load commits",
          message: Self.message(for: error)
        )
      }
    }
  }

  private func pull() {
    guard let cwd else { return }
    Task {
      _ = await model.pullGitChanges(cwd: cwd)
      refresh()
    }
  }

  private func push(force: Bool) {
    guard let cwd else { return }
    Task {
      _ = await model.pushGitChanges(cwd: cwd, force: force)
      refresh()
    }
  }

  private func stageAll(unstage: Bool) {
    guard let cwd else { return }
    Task {
      _ = await model.stageGitAll(cwd: cwd, unstage: unstage)
      refresh()
    }
  }

  private func discardAll(nukeWorkingTree: Bool) {
    guard let cwd else { return }
    Task {
      _ = await model.discardGitAll(
        cwd: cwd,
        nukeWorkingTree: nukeWorkingTree
      )
      refresh()
    }
  }

  private func checkoutBranch(
    branchName: String,
    create: Bool,
    startPoint: String?,
    track: Bool
  ) {
    guard let cwd else { return }
    Task {
      let ok = await model.checkoutGitBranch(
        cwd: cwd,
        branchName: branchName,
        create: create,
        startPoint: startPoint,
        track: track
      )
      if ok {
        refresh()
      }
    }
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }
    return error.localizedDescription
  }
}

private enum GitWorkspaceTab: String, CaseIterable, Identifiable {
  case changes
  case history
  case allFiles

  var id: String { rawValue }

  var title: String {
    switch self {
    case .changes:
      "Changes"
    case .history:
      "History"
    case .allFiles:
      "All Files"
    }
  }

  var systemImage: String {
    switch self {
    case .changes:
      "square.and.pencil"
    case .history:
      "clock.arrow.circlepath"
    case .allFiles:
      "folder"
    }
  }
}

private struct GitWorkspaceData: Equatable {
  var status: GitStatusSummary?
  var files: [GitChangeFile] = []
  var localBranches: [GitLocalBranch] = []
  var remoteBranches: [GitRemoteBranch] = []
  var commits: [String] = []
  var commitsHasMore = false
  var commitsLimit = GitFormatting.commitPageSize
  var unpushedCommitHashes: [String] = []
  var projectPaths: [String] = []
  var isLoadingStatus = false
  var isLoadingFiles = false
  var isLoadingBranches = false
  var isLoadingCommits = false
  var isLoadingTree = false
  var errorMessage: String?

  var isLoadingAny: Bool {
    isLoadingStatus || isLoadingFiles || isLoadingBranches || isLoadingCommits || isLoadingTree
  }

  var commitEntries: [GitCommitGraphEntry] {
    commits.map(GitFormatting.parseCommitGraphLine).filter { !$0.hash.isEmpty || !$0.subject.isEmpty }
  }
}

struct GitWorkspaceToolbar: View {
  var cwd: String?
  var status: GitStatusSummary?
  var files: [GitChangeFile]
  var branches: [GitLocalBranch]
  var remoteBranches: [GitRemoteBranch]
  var isLoading: Bool
  var refresh: () -> Void
  var openCommitSheet: () -> Void
  var checkoutBranch: (String, Bool, String?, Bool) -> Void
  var pull: () -> Void
  var push: () -> Void
  var confirmForcePush: () -> Void
  var stageAll: () -> Void
  var unstageAll: () -> Void
  var confirmDiscardAll: () -> Void
  var confirmNukeWorkingTree: () -> Void

  @State private var isShowingCreateBranch = false
  @State private var createBranchName = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 10) {
        branchDropdown
        Spacer(minLength: 8)
        Menu {
          Button(action: refresh) {
            Label("Refresh", picoSystemImage: "arrow.clockwise", size: 20)
          }
          Button(action: pull) {
            Label("Pull", picoSystemImage: "arrow.down", size: 20)
          }
          .disabled(status == nil)
          Button(action: push) {
            Label("Push", picoSystemImage: "arrow.up.circle", size: 20)
          }
          .disabled(status == nil)
          Button(role: .destructive, action: confirmForcePush) {
            Label(
              "Force Push with Lease",
              picoSystemImage: "exclamationmark.triangle",
              size: 20
            )
          }
          .disabled(status == nil)

          Divider()

          Button(action: stageAll) {
            Label("Stage All", picoSystemImage: "checkmark.circle", size: 20)
          }
          .disabled(status == nil || files.isEmpty)
          Button(action: unstageAll) {
            Label("Unstage All", picoSystemImage: "minus.circle", size: 20)
          }
          .disabled(status == nil || files.isEmpty)

          Divider()

          Button(role: .destructive, action: confirmDiscardAll) {
            Label("Discard All", picoSystemImage: "trash", size: 20)
          }
          .disabled(status == nil || files.isEmpty)
          Button(role: .destructive, action: confirmNukeWorkingTree) {
            Label(
              "Nuke Working Tree",
              picoSystemImage: "exclamationmark.triangle",
              size: 20
            )
          }
          .disabled(status == nil || files.isEmpty)
        } label: {
          Group {
            if isLoading {
              ProgressView()
                .controlSize(.small)
            } else {
              Image(picoSystemName: "ellipsis")
                .accessibilityHidden(true)
            }
          }
          .frame(width: 18, height: 18)
          .padding(7)
          .contentShape(Circle())
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Git actions")

        Button(action: openCommitSheet) {
          Text("Commit")
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
        }
        .buttonStyle(.glassProminent)
        .tint(Color.accentColor)
        .foregroundStyle(.white)
        .disabled(status == nil || files.isEmpty)
      }
    }
  }

  private var branchDropdown: some View {
    Menu {
      branchMenuContent
    } label: {
      GitBranchChip(
        title: branchTitle,
        isLoading: isLoading && renderedBranches.isEmpty
      )
    }
    .buttonStyle(.glass)
    .buttonBorderShape(.capsule)
    .disabled(status == nil)
    .accessibilityLabel("Select git branch")
    .alert("Create branch", isPresented: $isShowingCreateBranch) {
      TextField("branch-name", text: $createBranchName)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      Button("Cancel", role: .cancel) {
        createBranchName = ""
      }
      Button("Create") {
        createBranch()
      }
      .disabled(createBranchName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    } message: {
      Text("Create and switch from the current HEAD.")
    }
  }

  @ViewBuilder
  private var branchMenuContent: some View {
    Button {
      isShowingCreateBranch = true
    } label: {
      Label("Create branch…", picoSystemImage: "plus", size: 20)
    }
    .disabled(status == nil)

    let localBranches = renderedBranches
    if localBranches.isEmpty && remoteBranches.isEmpty {
      Text("No branches")
    } else {
      if !localBranches.isEmpty {
        Section("Local Branches") {
          ForEach(localBranches) { branch in
            Button {
              checkoutBranch(branch.name, false, nil, false)
            } label: {
              if branch.current {
                Label(
                  GitFormatting.localBranchMenuTitle(branch),
                  picoSystemImage: "checkmark",
                  size: 20
                )
              } else {
                Text(GitFormatting.localBranchMenuTitle(branch))
              }
            }
            .disabled(branch.current)
          }
        }
      }

      if !remoteBranches.isEmpty {
        Section("Remote Branches") {
          ForEach(remoteBranches) { branch in
            let parts = GitFormatting.remoteBranchParts(branch.name)
            let localName = parts.branch.isEmpty ? branch.name : parts.branch
            let localExists = localBranchNames.contains(localName)
            let isCurrent = status?.branch == localName
            Button {
              checkoutBranch(
                localName,
                !localExists,
                localExists ? nil : branch.name,
                !localExists
              )
            } label: {
              if isCurrent {
                Label(branch.name, picoSystemImage: "checkmark", size: 20)
              } else if localExists {
                Text(branch.name)
              } else {
                Label(branch.name, picoSystemImage: "plus", size: 20)
              }
            }
            .disabled(isCurrent)
          }
        }
      }
    }
  }

  private func createBranch() {
    let branchName = createBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !branchName.isEmpty else { return }

    createBranchName = ""
    checkoutBranch(branchName, true, nil, false)
  }

  private var renderedBranches: [GitLocalBranch] {
    guard branches.isEmpty,
          let status,
          let branchName = status.branch,
          !branchName.isEmpty else {
      return branches
    }

    return [
      GitLocalBranch(
        name: branchName,
        current: true,
        upstream: nil,
        ahead: status.ahead,
        behind: status.behind,
        upstreamGone: false,
        hash: status.revision,
        subject: nil,
        relativeDate: nil,
        committerDate: nil
      ),
    ]
  }

  private var localBranchNames: Set<String> {
    Set(renderedBranches.map(\.name))
  }

  private var branchTitle: String {
    guard let status else { return cwd == nil ? "Select session" : "No git repository" }
    return GitFormatting.branchText(status)
  }
}

#Preview {
  GitWorkspaceView(model: AppModel())
}
