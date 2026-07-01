import SwiftUI
import UIKit

struct GitHistoryView: View {
  @Bindable var model: AppModel
  var cwd: String
  var commits: [GitCommitGraphEntry]
  var unpushedCommitHashes: [String] = []
  var hasMore: Bool
  var isLoading: Bool
  var loadMore: () -> Void
  var refresh: () -> Void

  @State private var diffTabs: [GitCommitDiffTab] = []
  @State private var activeDiffTabId: String?
  @State private var selectedCommitForFiles: GitCommitGraphEntry?

  private var activeDiffTab: GitCommitDiffTab? {
    guard let activeDiffTabId else { return diffTabs.last }
    return diffTabs.first(where: { $0.id == activeDiffTabId }) ?? diffTabs.last
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if isLoading && commits.isEmpty {
        GitLoadingView(title: "Loading commit history…")
          .padding()
      } else if commits.isEmpty {
        GitEmptyView(
          title: "No commits",
          systemImage: "clock",
          message: "No commit history was returned for this repository."
        )
        .padding()
      } else {
        diffTabsView
        commitList
        if hasMore {
          Button(action: loadMore) {
            if isLoading {
              ProgressView()
            } else {
              Text("Load More")
            }
          }
          .buttonStyle(.bordered)
          .frame(maxWidth: .infinity)
          .padding()
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .sheet(item: $selectedCommitForFiles) { commit in
      NavigationStack {
        GitCommitFilesSheetView(
          model: model,
          cwd: cwd,
          commit: commit
        )
      }
    }
  }

  @ViewBuilder
  private var diffTabsView: some View {
    if !diffTabs.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(diffTabs) { tab in
              Button {
                activeDiffTabId = tab.id
              } label: {
                HStack(spacing: 6) {
                  Text(tab.title)
                    .lineLimit(1)
                  Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
                    .onTapGesture {
                      closeDiff(tab)
                    }
                }
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                  activeDiffTab?.id == tab.id ? Color.accentColor.opacity(0.16) : Color(uiColor: .secondarySystemGroupedBackground),
                  in: Capsule()
                )
              }
              .buttonStyle(.plain)
            }
          }
        }

        if let activeDiffTab {
          GitCommitDiffPanel(model: model, cwd: cwd, tab: activeDiffTab)
        }
      }
      .padding()
    }
  }

  private var commitList: some View {
    let graphLayout = GitCommitGraphLayout.build(commits: commits)
    let unpushedCommitHashSet = Set(unpushedCommitHashes)

    return LazyVStack(alignment: .leading, spacing: 0) {
      ForEach(Array(commits.enumerated()), id: \.element.id) { index, commit in
        GitCommitRowView(
          model: model,
          cwd: cwd,
          commit: commit,
          graphRow: graphLayout.rows[index],
          graphLaneCount: graphLayout.maxLaneCount,
          isUnpushed: unpushedCommitHashSet.contains(commit.fullHash),
          openDiff: openDiff,
          openFiles: { selectedCommitForFiles = commit },
          refresh: refresh
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }

  private func openDiff(_ request: GitCommitDiffRequest) {
    let tab = GitCommitDiffTab(request: request)
    if !diffTabs.contains(where: { $0.id == tab.id }) {
      diffTabs.append(tab)
    }
    activeDiffTabId = tab.id
  }

  private func closeDiff(_ tab: GitCommitDiffTab) {
    let removedIndex = diffTabs.firstIndex(where: { $0.id == tab.id })
    diffTabs.removeAll { $0.id == tab.id }
    if activeDiffTabId == tab.id {
      if let removedIndex, diffTabs.indices.contains(removedIndex) {
        activeDiffTabId = diffTabs[removedIndex].id
      } else {
        activeDiffTabId = diffTabs.last?.id
      }
    }
  }
}

struct GitCommitDiffRequest: Hashable, Sendable {
  var commit: GitCommitGraphEntry
  var mode: GitCommitDiffMode
  var path: String?
  var previousPath: String?
  var leftRevisionLabel: String?
  var rightRevisionLabel: String?
}

struct GitCommitDiffTab: Identifiable, Hashable, Sendable {
  var id: String
  var title: String
  var request: GitCommitDiffRequest

  init(request: GitCommitDiffRequest) {
    self.request = request
    id = [request.mode.rawValue, request.commit.fullHash, request.path ?? ""].joined(separator: ":")
    title = Self.title(for: request)
  }

  private static func title(for request: GitCommitDiffRequest) -> String {
    let shortHash = request.commit.displayHash
    if let path = request.path {
      let leftPath = GitFormatting.baseName(request.previousPath ?? path)
      let rightPath = GitFormatting.baseName(path)
      let leftLabel = request.leftRevisionLabel ?? (request.mode == .head ? shortHash : "\(shortHash)^")
      let rightLabel = request.rightRevisionLabel ?? (request.mode == .head ? "HEAD" : shortHash)
      return "\(leftPath) (\(leftLabel)) → \(rightPath) (\(rightLabel))"
    }
    switch request.mode {
    case .head:
      return "\(shortHash)..HEAD"
    case .previous:
      return "\(shortHash)^..\(shortHash)"
    case .commit:
      return "Diff \(shortHash)"
    }
  }
}

private struct GitCommitRowView: View {
  @Bindable var model: AppModel
  var cwd: String
  var commit: GitCommitGraphEntry
  var graphRow: GitCommitGraphRowLayout
  var graphLaneCount: Int
  var isUnpushed: Bool
  var openDiff: (GitCommitDiffRequest) -> Void
  var openFiles: () -> Void
  var refresh: () -> Void

  @State private var confirmAction: GitCommitActionConfirmation?
  @State private var formAction: GitCommitActionForm?
  @State private var isShowingResetPicker = false

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      Button(action: openFiles) {
        HStack(alignment: .top, spacing: 10) {
          Color.clear
            .frame(width: graphColumnWidth)
            .accessibilityHidden(true)

          VStack(alignment: .leading, spacing: 5) {
            Text(commit.subject.isEmpty ? "Untitled commit" : commit.subject)
              .font(.subheadline.weight(.semibold))
              .lineLimit(2)

            HStack(spacing: 8) {
              if !commit.author.isEmpty {
                Text(commit.author)
              }
              if !commit.relativeDate.isEmpty {
                Text(GitFormatting.commitDetailTime(commit.relativeDate))
              }
              if !commit.stats.isEmpty {
                GitCommitStatsView(stats: commit.stats)
              }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityHint("Opens changed files")

      Menu {
        Button("Open Commit Diff") {
          openDiff(GitCommitDiffRequest(commit: commit, mode: .commit))
        }
        Button("Compare to HEAD") {
          openDiff(GitCommitDiffRequest(commit: commit, mode: .head))
        }
        Button("Compare to Previous") {
          openDiff(GitCommitDiffRequest(commit: commit, mode: .previous))
        }
        Button("Changed Files", action: openFiles)

        Divider()

        Button("Copy Hash") {
          copy(commit.fullHash.isEmpty ? commit.hash : commit.fullHash, label: "hash")
        }
        Button("Copy Message") {
          copy(commit.subject, label: "message")
        }
        Button("Open Remote URL") {
          openRemoteUrl()
        }

        Divider()

        Button("Checkout") {
          confirmAction = GitCommitActionConfirmation(action: .checkout, commit: commit)
        }
        Button("Cherry-pick") {
          confirmAction = GitCommitActionConfirmation(action: .cherryPick, commit: commit)
        }
        Button("Revert") {
          confirmAction = GitCommitActionConfirmation(action: .revert, commit: commit)
        }
        Button("Tag") {
          formAction = GitCommitActionForm(action: .tag, commit: commit, value: "")
        }
        Button("Reset") {
          isShowingResetPicker = true
        }
        Button("Rebase") {
          confirmAction = GitCommitActionConfirmation(action: .rebase, commit: commit)
        }
        Button("Drop", role: .destructive) {
          confirmAction = GitCommitActionConfirmation(action: .drop, commit: commit)
        }
        Button("Squash") {
          formAction = GitCommitActionForm(action: .squash, commit: commit, value: commit.subject)
        }
      } label: {
        Image(systemName: "ellipsis")
          .frame(width: 28, height: 28)
      }
      .accessibilityLabel("Commit actions")
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(uiColor: .systemBackground))
    .overlay(alignment: .leading) {
      GitCommitGraphColumnView(
        row: graphRow,
        maxLaneCount: graphLaneCount,
        isUnpushed: isUnpushed
      )
      .padding(.leading, 12)
      .allowsHitTesting(false)
    }
    .overlay(alignment: .bottom) {
      Divider()
    }
    .confirmationDialog(
      confirmAction?.title ?? "Run action?",
      isPresented: Binding(
        get: { confirmAction != nil },
        set: { if !$0 { confirmAction = nil } }
      ),
      titleVisibility: .visible
    ) {
      if let confirmAction {
        Button(confirmAction.confirmLabel, role: confirmAction.destructive ? .destructive : nil) {
          run(confirmAction)
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(confirmAction?.message ?? "")
    }
    .confirmationDialog(
      "Reset branch to \(commit.displayHash)",
      isPresented: $isShowingResetPicker,
      titleVisibility: .visible
    ) {
      ForEach(GitResetMode.allCases) { mode in
        Button(mode.label, role: mode == .hard ? .destructive : nil) {
          confirmAction = GitCommitActionConfirmation(
            action: .reset,
            commit: commit,
            resetMode: mode
          )
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Choose how Git should reset the current branch.")
    }
    .sheet(item: $formAction) { formAction in
      NavigationStack {
        GitCommitActionFormView(
          form: formAction,
          run: runForm
        )
      }
    }
  }

  private var graphColumnWidth: CGFloat {
    GitCommitGraphColumnView.width(for: graphLaneCount)
  }

  private func copy(_ text: String, label: String) {
    UIPasteboard.general.string = text
    model.alert = AppAlert(title: "Copied \(label)", message: "")
  }

  private func openRemoteUrl() {
    Task {
      do {
        let response = try await model.fetchGitCommitRemoteUrl(
          cwd: cwd,
          commit: commit.fullHash.isEmpty ? commit.hash : commit.fullHash
        )
        if let url = URL(string: response.remoteUrl) {
          await MainActor.run {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
          }
        }
      } catch {
        model.alert = AppAlert(title: "Could not open remote URL", message: Self.message(for: error))
      }
    }
  }

  private func run(_ confirmation: GitCommitActionConfirmation) {
    Task {
      _ = await model.runGitCommitAction(
        cwd: cwd,
        action: confirmation.action,
        commit: confirmation.commit.fullHash.isEmpty ? confirmation.commit.hash : confirmation.commit.fullHash,
        resetMode: confirmation.resetMode
      )
      confirmAction = nil
      refresh()
    }
  }

  private func runForm(_ form: GitCommitActionForm) {
    Task {
      let value = form.value.trimmingCharacters(in: .whitespacesAndNewlines)
      _ = await model.runGitCommitAction(
        cwd: cwd,
        action: form.action,
        commit: form.commit.fullHash.isEmpty ? form.commit.hash : form.commit.fullHash,
        tagName: form.action == .tag ? value : nil,
        message: form.action == .squash ? value : nil
      )
      formAction = nil
      refresh()
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

private struct GitCommitStatsView: View {
  var stats: String

  var body: some View {
    HStack(spacing: 6) {
      let insertions = GitFormatting.commitStatCount(stats, kind: .insertions)
      let deletions = GitFormatting.commitStatCount(stats, kind: .deletions)
      if insertions > 0 {
        Text("+\(insertions)")
          .foregroundStyle(Color(uiColor: .systemGreen))
      }
      if deletions > 0 {
        Text("-\(deletions)")
          .foregroundStyle(Color(uiColor: .systemRed))
      }
    }
    .monospacedDigit()
  }
}

private struct GitCommitDiffPanel: View {
  @Bindable var model: AppModel
  var cwd: String
  var tab: GitCommitDiffTab

  @State private var response: GitCommitDiffResponse?
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var isShowingCommentSheet = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(tab.title)
          .font(.subheadline.weight(.semibold))
          .lineLimit(2)
        Spacer(minLength: 0)
        Button("Comment", systemImage: "text.bubble") {
          isShowingCommentSheet = true
        }
        .disabled(response?.patch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false)
      }

      if isLoading {
        GitLoadingView(title: "Loading commit diff…")
      } else if let errorMessage {
        GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
      } else if let response {
        GitPatchView(model: model, patch: response.patch, fallbackFileName: response.path, maxHeight: 360)
      }
    }
    .padding(12)
    .background(Color(uiColor: .tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .task(id: tab.id) {
      await loadDiff()
    }
    .sheet(isPresented: $isShowingCommentSheet) {
      NavigationStack {
        GitCommentSheetView(
          previewTitle: tab.title,
          previewSubtitle: "Commit diff",
          previewSystemImage: "doc.text.magnifyingglass"
        ) { comment in
          attachDiffToComposer(comment: comment)
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }

  private func loadDiff() async {
    isLoading = true
    errorMessage = nil
    do {
      response = try await model.fetchGitCommitDiff(
        cwd: cwd,
        commit: tab.request.commit.fullHash.isEmpty ? tab.request.commit.hash : tab.request.commit.fullHash,
        mode: tab.request.mode,
        path: tab.request.path,
        previousPath: tab.request.previousPath
      )
    } catch {
      errorMessage = Self.message(for: error)
    }
    isLoading = false
  }

  private func attachDiffToComposer(comment: String) {
    guard let response else { return }
    let context = """
    ```diff
    \(response.patch)
    ```
    """
    model.addComposerGitComment(
      title: tab.title,
      subtitle: "Commit diff",
      systemImage: "doc.text.magnifyingglass",
      comment: comment,
      context: context
    )
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }
    return error.localizedDescription
  }
}

private struct GitCommitFilesSheetView: View {
  @Bindable var model: AppModel
  var cwd: String
  var commit: GitCommitGraphEntry
  @Environment(\.dismiss) private var dismiss
  @State private var files: [GitCommitFile] = []
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var selectedDiffTab: GitCommitDiffTab?

  var body: some View {
    List {
      if isLoading {
        GitLoadingView(title: "Loading commit files…")
      } else if let errorMessage {
        GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
      } else if files.isEmpty {
        ContentUnavailableView("No files", systemImage: "doc", description: Text("This commit did not report changed files."))
      } else {
        ForEach(files) { file in
          Button {
            selectedDiffTab = GitCommitDiffTab(
              request: GitCommitDiffRequest(
                commit: commit,
                mode: .commit,
                path: file.path,
                previousPath: file.previousPath
              )
            )
          } label: {
            HStack(spacing: 10) {
              GitStatusBadge(status: file.status)
              GitFileIcon(path: file.path)
              GitDiffFilePathLabel(path: file.path, previousPath: file.previousPath)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
              Spacer(minLength: 0)
              GitLineCountBadge(added: file.linesAdded, deleted: file.linesDeleted)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
    .navigationTitle("Changed Files")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button {
          dismiss()
        } label: {
          Image(systemName: "xmark")
        }
        .accessibilityLabel("Close")
      }
    }
    .sheet(item: $selectedDiffTab) { tab in
      NavigationStack {
        GitCommitFileDiffSheetView(model: model, cwd: cwd, tab: tab)
      }
      .presentationDetents([.large])
      .presentationDragIndicator(.visible)
    }
    .task {
      await loadFiles()
    }
  }

  private func loadFiles() async {
    isLoading = true
    errorMessage = nil
    do {
      let response = try await model.fetchGitCommitFiles(
        cwd: cwd,
        commit: commit.fullHash.isEmpty ? commit.hash : commit.fullHash
      )
      files = response.files
    } catch {
      errorMessage = Self.message(for: error)
    }
    isLoading = false
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }
    return error.localizedDescription
  }
}

private struct GitCommitFileDiffSheetView: View {
  @Bindable var model: AppModel
  var cwd: String
  var tab: GitCommitDiffTab

  @Environment(\.dismiss) private var dismiss
  @State private var response: GitCommitDiffResponse?
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var isShowingCommentSheet = false

  private var title: String {
    if let path = tab.request.path {
      return GitFormatting.baseName(path)
    }
    return tab.title
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        if isLoading {
          GitLoadingView(title: "Loading file diff…")
        } else if let errorMessage {
          GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
        } else if let response {
          GitPatchView(
            model: model,
            patch: response.patch,
            fallbackFileName: response.path,
            maxHeight: nil,
            scrollsVertically: false
          )
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding()
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button {
          dismiss()
        } label: {
          Image(systemName: "xmark")
        }
        .accessibilityLabel("Close")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button("Comment", systemImage: "text.bubble") {
          isShowingCommentSheet = true
        }
        .disabled(response?.patch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false)
      }
    }
    .task(id: tab.id) {
      await loadDiff()
    }
    .sheet(isPresented: $isShowingCommentSheet) {
      NavigationStack {
        GitCommentSheetView(
          previewTitle: tab.request.path ?? tab.title,
          previewSubtitle: "Commit file diff",
          previewSystemImage: "doc.text"
        ) { comment in
          attachDiffToComposer(comment: comment)
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }

  private func loadDiff() async {
    isLoading = true
    errorMessage = nil
    do {
      response = try await model.fetchGitCommitDiff(
        cwd: cwd,
        commit: tab.request.commit.fullHash.isEmpty ? tab.request.commit.hash : tab.request.commit.fullHash,
        mode: tab.request.mode,
        path: tab.request.path,
        previousPath: tab.request.previousPath
      )
    } catch {
      errorMessage = Self.message(for: error)
    }
    isLoading = false
  }

  private func attachDiffToComposer(comment: String) {
    guard let response else { return }
    let context = """
    ```diff
    \(response.patch)
    ```
    """
    model.addComposerGitComment(
      title: tab.title,
      subtitle: "Commit file diff",
      systemImage: "doc.text",
      comment: comment,
      context: context
    )
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }
    return error.localizedDescription
  }
}

private struct GitCommitActionConfirmation: Identifiable, Hashable {
  var action: GitCommitActionKind
  var commit: GitCommitGraphEntry
  var resetMode: GitResetMode?

  var id: String { action.rawValue + commit.id + (resetMode?.rawValue ?? "") }
  var destructive: Bool { action == .drop || resetMode == .hard }

  var title: String {
    switch action {
    case .checkout:
      "Checkout \(commit.displayHash)?"
    case .cherryPick:
      "Cherry-pick \(commit.displayHash)?"
    case .revert:
      "Revert \(commit.displayHash)?"
    case .reset:
      "Reset to \(commit.displayHash)?"
    case .rebase:
      "Rebase onto \(commit.displayHash)?"
    case .drop:
      "Drop \(commit.displayHash)?"
    case .tag:
      "Tag \(commit.displayHash)?"
    case .squash:
      "Squash \(commit.displayHash)?"
    }
  }

  var message: String {
    switch action {
    case .checkout:
      "Checkout this commit in the repository."
    case .cherryPick:
      "Apply this commit on top of the current branch."
    case .revert:
      "Create a new commit that reverts this commit."
    case .reset:
      "Reset the current branch using \(resetMode?.label ?? "mixed") mode."
    case .rebase:
      "Rebase the current branch onto this commit."
    case .drop:
      "Drop this commit from the current branch history."
    case .tag, .squash:
      "Run this action on the selected commit."
    }
  }

  var confirmLabel: String {
    switch action {
    case .checkout:
      "Checkout"
    case .cherryPick:
      "Cherry-pick"
    case .revert:
      "Revert"
    case .reset:
      "Reset"
    case .rebase:
      "Rebase"
    case .drop:
      "Drop"
    case .tag:
      "Tag"
    case .squash:
      "Squash"
    }
  }
}

private struct GitCommitActionForm: Identifiable, Hashable {
  var action: GitCommitActionKind
  var commit: GitCommitGraphEntry
  var value: String

  var id: String { action.rawValue + commit.id }

  var title: String {
    switch action {
    case .tag:
      "Tag \(commit.displayHash)"
    case .squash:
      "Squash \(commit.displayHash)"
    default:
      action.label
    }
  }

  var prompt: String {
    switch action {
    case .tag:
      "Enter a tag name."
    case .squash:
      "Enter the squashed commit message."
    default:
      "Enter a value."
    }
  }
}

private struct GitCommitActionFormView: View {
  @State var form: GitCommitActionForm
  var run: (GitCommitActionForm) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    Form {
      Section {
        TextField(form.action == .tag ? "Tag name" : "Commit message", text: $form.value, axis: .vertical)
          .lineLimit(1...6)
      } footer: {
        Text(form.prompt)
      }
    }
    .navigationTitle(form.title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button("Run") {
          run(form)
          dismiss()
        }
        .disabled(form.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
  }
}
