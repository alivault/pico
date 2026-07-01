import SwiftUI
import UIKit

struct GitChangesWorkspaceView: View {
  @Bindable var model: AppModel
  var cwd: String
  var status: GitStatusSummary?
  var files: [GitChangeFile]
  var isLoadingFiles: Bool
  var refresh: () -> Void

  @State private var expandedFileIds: Set<String> = []

  var body: some View {
    ScrollView {
      diffContent
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .refreshable {
      refresh()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Color(uiColor: .systemBackground))
    .onChange(of: files) {
      pruneExpandedFiles()
    }
    .onAppear {
      pruneExpandedFiles()
    }
  }

  @ViewBuilder
  private var diffContent: some View {
    if status == nil {
      GitInlineNote(title: "No git repository detected.")
        .padding()
    } else if isLoadingFiles && files.isEmpty {
      GitLoadingView(title: "Loading changed files…")
        .padding()
    } else if files.isEmpty {
      GitEmptyView(
        title: "No changes",
        systemImage: "checkmark.circle",
        message: "Your working tree is clean."
      )
      .padding()
    } else {
      fileAccordions
    }
  }

  private var fileAccordions: some View {
    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
      ForEach(files) { file in
        Section {
          if expandedFileIds.contains(file.id) {
            GitFileDiffDetailView(
              model: model,
              cwd: cwd,
              file: file,
              showsFileSummary: false,
              refresh: refresh
            )
            .padding(12)
            .background(Color(uiColor: .systemBackground))

            if file.id != files.last?.id {
              Divider()
            }
          }
        } header: {
          GitChangedFileAccordionHeader(
            file: file,
            isExpanded: expandedFileIds.contains(file.id),
            toggle: { toggleFile(file) }
          )
        }
      }
    }
    .background(Color(uiColor: .systemBackground))
  }

  private func toggleFile(_ file: GitChangeFile) {
    if expandedFileIds.contains(file.id) {
      expandedFileIds.remove(file.id)
    } else {
      expandedFileIds.insert(file.id)
    }
  }

  private func pruneExpandedFiles() {
    let fileIds = Set(files.map(\.id))
    expandedFileIds = expandedFileIds.intersection(fileIds)
  }
}

private struct GitChangedFileAccordionHeader: View {
  var file: GitChangeFile
  var isExpanded: Bool
  var toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      HStack(spacing: 8) {
        GitStatusBadge(status: file.status)
        GitFileIcon(path: file.path)
        fileTitle
        Spacer(minLength: 0)
        GitLineCountBadge(added: file.linesAdded, deleted: file.linesDeleted)
        Image(systemName: "chevron.right")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .rotationEffect(.degrees(isExpanded ? 90 : 0))
          .animation(.snappy(duration: 0.18), value: isExpanded)
          .accessibilityHidden(true)
      }
      .contentShape(Rectangle())
      .padding(.horizontal, 14)
      .padding(.vertical, 11)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .buttonStyle(.plain)
    .background(Color(uiColor: .systemBackground))
    .overlay(alignment: .bottom) {
      Divider()
    }
    .accessibilityLabel(file.path)
    .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
  }

  private var fileTitle: some View {
    GitDiffFilePathLabel(path: file.path, previousPath: file.previousPath)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct GitFileDiffDetailView: View {
  @Bindable var model: AppModel
  var cwd: String
  var file: GitChangeFile
  var showsFileSummary = true
  var refresh: () -> Void

  @State private var patch = ""
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var isShowingDiscardConfirmation = false
  @State private var isShowingCommentSheet = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if showsFileSummary {
        fileSummaryHeader
      }
      fileActionRow
      if isLoading && patch.isEmpty {
        GitLoadingView(title: "Loading diff…")
      } else if let errorMessage {
        GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
      } else {
        GitPatchView(
          model: model,
          patch: patch,
          fallbackFileName: file.path,
          maxHeight: showsFileSummary ? 360 : nil,
          scrollsVertically: showsFileSummary
        )
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .task(id: file.id) {
      await loadDiff()
    }
    .confirmationDialog(
      "Discard \(GitFormatting.baseName(file.path))?",
      isPresented: $isShowingDiscardConfirmation,
      titleVisibility: .visible
    ) {
      Button("Discard File", role: .destructive) {
        Task {
          _ = await model.discardGitFile(cwd: cwd, file: file)
          refresh()
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This discards working-tree changes for this file.")
    }
    .sheet(isPresented: $isShowingCommentSheet) {
      NavigationStack {
        GitCommentSheetView(
          previewTitle: file.path,
          previewSubtitle: "Working tree diff",
          previewSystemImage: "doc.text"
        ) { comment in
          attachDiffToComposer(comment: comment)
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }

  private var fileSummaryHeader: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      GitStatusBadge(status: file.status)
      GitDiffFilePathLabel(path: file.path, previousPath: file.previousPath)
        .frame(maxWidth: .infinity, alignment: .leading)
      Spacer(minLength: 0)
      GitLineCountBadge(added: file.linesAdded, deleted: file.linesDeleted)
    }
  }

  private var fileActionRow: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        Button("Stage") {
          Task {
            _ = await model.stageGitFile(cwd: cwd, file: file)
            refresh()
          }
        }
        .disabled(!GitFormatting.canStage(file))

        Button("Unstage") {
          Task {
            _ = await model.stageGitFile(cwd: cwd, file: file, unstage: true)
            refresh()
          }
        }
        .disabled(!GitFormatting.canUnstage(file))

        Button("Comment") {
          isShowingCommentSheet = true
        }
        .disabled(patch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        Button("Discard", role: .destructive) {
          isShowingDiscardConfirmation = true
        }
      }
      .buttonStyle(.bordered)
      .font(.caption)
    }
  }

  private func loadDiff() async {
    isLoading = true
    errorMessage = nil
    do {
      let response = try await model.fetchGitFileDiff(cwd: cwd, path: file.path)
      patch = response.patch
    } catch {
      errorMessage = Self.message(for: error)
    }
    isLoading = false
  }

  private func attachDiffToComposer(comment: String) {
    let context = """
    ```diff
    \(patch)
    ```
    """
    model.addComposerGitComment(
      title: file.path,
      subtitle: "Working tree diff",
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
