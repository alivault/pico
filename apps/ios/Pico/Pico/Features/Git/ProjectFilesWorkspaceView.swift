import SwiftUI
import UIKit

struct ProjectFilesWorkspaceView: View {
  @Bindable var model: AppModel
  var cwd: String
  var paths: [String]
  var gitFiles: [GitChangeFile]
  var isLoading: Bool
  var refresh: () -> Void

  @State private var selectedPath: String?
  @State private var previewedFile: ProjectFilePreview?
  @State private var fileContentCache: [String: ProjectFileContentCacheEntry] = [:]
  @State private var searchText = ""
  @FocusState private var isSearchFocused: Bool

  private var visiblePaths: [String] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return paths }
    return paths.filter { $0.localizedCaseInsensitiveContains(query) }
  }

  private var treeNodes: [ProjectFileTreeNode] {
    ProjectFileTreeBuilder.build(paths: visiblePaths, gitFiles: gitFiles)
  }

  private var isSearchActive: Bool {
    !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var isCloseSearchVisible: Bool {
    isSearchFocused || isSearchActive
  }

  var body: some View {
    Group {
      if isLoading && paths.isEmpty {
        GitLoadingView(title: "Loading project files…")
          .padding()
      } else if paths.isEmpty {
        GitEmptyView(
          title: "No files",
          systemImage: "folder",
          message: "No project files were returned for this directory."
        )
      } else {
        fileTree
      }
    }
    .refreshable {
      refresh()
    }
    .safeAreaBar(edge: .bottom, alignment: .center) {
      if !paths.isEmpty {
        fileSearchBar
      }
    }
    .sheet(item: $previewedFile) { preview in
      let cacheKey = fileCacheKey(for: preview.path)
      NavigationStack {
        ProjectFileDetailView(
          model: model,
          cwd: cwd,
          path: preview.path,
          gitFile: gitFiles.first(where: { $0.path == preview.path }),
          cachedFile: Binding(
            get: { fileContentCache[cacheKey] },
            set: { fileContentCache[cacheKey] = $0 }
          )
        )
        .navigationTitle(GitFormatting.baseName(preview.path))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .topBarLeading) {
            Button {
              previewedFile = nil
            } label: {
              Image(systemName: "xmark")
            }
            .accessibilityLabel("Close")
          }
        }
      }
      .presentationDetents([.large])
      .presentationDragIndicator(.visible)
    }
  }

  private var fileTree: some View {
    List {
      ForEach(treeNodes) { node in
        ProjectFileTreeRow(
          node: node,
          selectedPath: $selectedPath,
          openFile: openFile
        )
      }
    }
    .listStyle(.plain)
    .background(Color(uiColor: .systemGroupedBackground))
  }

  private var fileSearchBar: some View {
    HStack(spacing: 10) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        TextField("Search files", text: $searchText)
          .focused($isSearchFocused)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.search)
        if !searchText.isEmpty {
          Button(action: clearSearch) {
            Image(systemName: "xmark.circle.fill")
          }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Clear file search")
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity)
      .contentShape(Capsule())
      .glassEffect(.regular, in: Capsule())
      .onTapGesture {
        isSearchFocused = true
      }

      if isCloseSearchVisible {
        SidebarCloseSearchButton(closeSearch: closeSearch)
          .transition(.scale.combined(with: .opacity))
      }
    }
    .padding(.horizontal)
    .padding(.vertical, 8)
    .animation(.smooth(duration: 0.2), value: isCloseSearchVisible)
  }

  private func clearSearch() {
    searchText = ""
    isSearchFocused = true
  }

  private func closeSearch() {
    searchText = ""
    isSearchFocused = false
  }

  private func openFile(_ path: String) {
    selectedPath = path
    previewedFile = ProjectFilePreview(path: path)
  }

  private func fileCacheKey(for path: String) -> String {
    "\(cwd)\u{0}\(path)"
  }
}

private struct ProjectFileContentCacheEntry: Equatable {
  var content: String
  var errorMessage: String?
  var highlight: CodeHighlightResult?
}

private struct ProjectFilePreview: Identifiable {
  var path: String
  var id: String { path }
}

private struct ProjectFileTreeRow: View {
  var node: ProjectFileTreeNode
  @Binding var selectedPath: String?
  var openFile: (String) -> Void

  var body: some View {
    if node.isDirectory {
      DisclosureGroup {
        ForEach(node.sortedChildren) { child in
          ProjectFileTreeRow(
            node: child,
            selectedPath: $selectedPath,
            openFile: openFile
          )
        }
      } label: {
        HStack(spacing: 8) {
          GitFileIcon(path: node.path, isDirectory: true)
          Text(node.name)
            .lineLimit(1)
        }
      }
    } else {
      Button {
        openFile(node.path)
      } label: {
        HStack(spacing: 8) {
          if let gitStatus = node.gitStatus {
            GitStatusBadge(status: gitStatus.status)
          }
          GitFileIcon(path: node.path)
          VStack(alignment: .leading, spacing: 2) {
            Text(node.name)
              .foregroundStyle(.primary)
              .lineLimit(1)
            let parent = GitFormatting.parentPath(node.path)
            if !parent.isEmpty {
              Text(parent)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
          Spacer(minLength: 0)
          if let gitStatus = node.gitStatus {
            GitLineCountBadge(added: gitStatus.linesAdded, deleted: gitStatus.linesDeleted)
          }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .listRowBackground(selectedPath == node.path ? Color.accentColor.opacity(0.12) : Color.clear)
    }
  }
}

private struct ProjectFileDetailView: View {
  @Bindable var model: AppModel
  var cwd: String
  var path: String
  var gitFile: GitChangeFile?
  @Binding var cachedFile: ProjectFileContentCacheEntry?

  @State private var isLoading = false
  @State private var highlightingRequestID: String?
  @State private var isShowingDiff = false
  @State private var isShowingCommentSheet = false
  @State private var markdownMode: MarkdownMode = .preview

  private var content: String {
    cachedFile?.content ?? ""
  }

  private var errorMessage: String? {
    cachedFile?.errorMessage
  }

  private var isMarkdown: Bool {
    let lowercased = path.lowercased()
    return lowercased.hasSuffix(".md") || lowercased.hasSuffix(".markdown")
  }

  private var codeLanguage: CodeFileLanguage? {
    CodeFileLanguageDetector.detect(path: path)
  }

  private var shouldRenderCode: Bool {
    guard codeLanguage != nil else { return false }
    return !isMarkdown || markdownMode == .source
  }

  private var highlightRequestID: String? {
    guard shouldRenderCode,
          let codeLanguage,
          errorMessage == nil,
          !content.isEmpty else {
      return nil
    }

    return "\(path)\u{0}\(codeLanguage.shikiLanguage)\u{0}\(content.count)"
  }

  private var isHighlightingCode: Bool {
    highlightingRequestID != nil && highlightingRequestID == highlightRequestID
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      contentView
    }
    .task(id: path) {
      await loadFileIfNeeded()
    }
    .task(id: highlightRequestID) {
      await loadHighlightIfNeeded()
    }
    .sheet(isPresented: $isShowingDiff) {
      if let gitFile {
        NavigationStack {
          GitProjectFileDiffSheet(model: model, cwd: cwd, file: gitFile)
        }
      }
    }
    .sheet(isPresented: $isShowingCommentSheet) {
      NavigationStack {
        GitCommentSheetView(
          previewTitle: path,
          previewSubtitle: "Project file",
          previewSystemImage: "doc.text"
        ) { comment in
          attachFileToComposer(comment: comment)
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }

  private var fileActionsRow: some View {
    HStack(spacing: 8) {
      Button("Comment") {
        isShowingCommentSheet = true
      }
      .buttonStyle(.glass)
      .buttonBorderShape(.capsule)
      .disabled(content.isEmpty)

      Button("Copy", action: copyFile)
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .disabled(content.isEmpty)

      Button("Diff") {
        isShowingDiff = true
      }
      .buttonStyle(.glass)
      .buttonBorderShape(.capsule)
      .disabled(gitFile == nil)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 10) {
        GitFileIcon(path: path)
        VStack(alignment: .leading, spacing: 2) {
          Text(path)
            .font(.subheadline.weight(.semibold))
            .lineLimit(2)
          if let gitFile {
            Text(GitFormatting.statusDescription(gitFile.status))
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        Spacer(minLength: 0)
      }

      fileActionsRow

      if isMarkdown {
        Picker("Markdown", selection: $markdownMode) {
          ForEach(MarkdownMode.allCases) { mode in
            Text(mode.title).tag(mode)
          }
        }
        .pickerStyle(.segmented)
        .frame(width: 180)
      }
    }
    .padding()
  }

  @ViewBuilder
  private var contentView: some View {
    if isLoading || cachedFile == nil {
      GitLoadingView(title: "Loading file…")
        .padding()
    } else if let errorMessage {
      GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
        .padding()
    } else if content.isEmpty {
      GitEmptyView(title: "Empty file", systemImage: "doc", message: "This file has no text content.")
    } else if isMarkdown && markdownMode == .preview {
      ScrollView {
        MarkdownTextView(text: content)
          .padding()
      }
    } else if shouldRenderCode, let codeLanguage {
      CodeFileTextView(
        path: path,
        content: content,
        language: codeLanguage,
        highlight: cachedFile?.highlight,
        isHighlighting: isHighlightingCode
      )
    } else {
      GeometryReader { proxy in
        ScrollView([.vertical, .horizontal]) {
          Text(content)
            .font(.system(size: 12, design: .monospaced))
            .textSelection(.enabled)
            .padding()
            .frame(
              minWidth: proxy.size.width,
              minHeight: proxy.size.height,
              alignment: .topLeading
            )
        }
      }
    }
  }

  private func loadFileIfNeeded() async {
    guard cachedFile == nil, !isLoading else { return }
    await loadFile()
  }

  private func loadHighlightIfNeeded() async {
    guard let requestID = highlightRequestID,
          let codeLanguage,
          cachedFile?.highlight?.requestID != requestID else {
      return
    }

    let requestedContent = content
    let requestedLanguage = codeLanguage.shikiLanguage
    highlightingRequestID = requestID
    defer {
      if highlightingRequestID == requestID {
        highlightingRequestID = nil
      }
    }

    do {
      let response = try await model.highlightCode(
        code: requestedContent,
        language: requestedLanguage
      )
      guard !Task.isCancelled, highlightRequestID == requestID else { return }
      updateHighlight(
        CodeHighlightResult(
          requestID: requestID,
          requestedLanguage: requestedLanguage,
          response: response
        )
      )
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled, highlightRequestID == requestID else { return }
      updateHighlight(
        .unavailable(requestID: requestID, language: requestedLanguage)
      )
    }
  }

  private func updateHighlight(_ highlight: CodeHighlightResult) {
    guard var cachedFile else { return }
    cachedFile.highlight = highlight
    self.cachedFile = cachedFile
  }

  private func loadFile() async {
    let requestedPath = path
    highlightingRequestID = nil
    isLoading = true
    defer {
      isLoading = false
    }

    do {
      let response = try await model.fetchProjectFile(cwd: cwd, path: requestedPath)
      guard !Task.isCancelled else { return }
      cachedFile = ProjectFileContentCacheEntry(
        content: response.content,
        errorMessage: nil,
        highlight: nil
      )
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled else { return }
      cachedFile = ProjectFileContentCacheEntry(
        content: "",
        errorMessage: Self.message(for: error),
        highlight: nil
      )
    }
  }

  private func copyFile() {
    UIPasteboard.general.string = content
    model.alert = AppAlert(title: "Copied file", message: "")
  }

  private func attachFileToComposer(comment: String) {
    let context = """
    ```
    \(content)
    ```
    """
    model.addComposerGitComment(
      title: path,
      subtitle: "Project file",
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

private struct GitProjectFileDiffSheet: View {
  @Bindable var model: AppModel
  var cwd: String
  var file: GitChangeFile
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ScrollView {
      GitFileDiffSheetContent(model: model, cwd: cwd, file: file)
        .padding()
    }
    .navigationTitle(GitFormatting.baseName(file.path))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Done") { dismiss() }
      }
    }
  }
}

private struct GitFileDiffSheetContent: View {
  @Bindable var model: AppModel
  var cwd: String
  var file: GitChangeFile
  @State private var patch = ""
  @State private var isLoading = false
  @State private var errorMessage: String?

  var body: some View {
    Group {
      if isLoading {
        GitLoadingView(title: "Loading diff…")
      } else if let errorMessage {
        GitInlineNote(title: errorMessage, systemImage: "exclamationmark.triangle", isError: true)
      } else {
        GitPatchView(patch: patch, fallbackFileName: file.path, maxHeight: nil)
      }
    }
    .task(id: file.id) {
      await loadDiff()
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

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }
    return error.localizedDescription
  }
}

private enum MarkdownMode: String, CaseIterable, Identifiable {
  case preview
  case source

  var id: String { rawValue }

  var title: String {
    switch self {
    case .preview:
      "Preview"
    case .source:
      "Source"
    }
  }
}
