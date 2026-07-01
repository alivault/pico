import SwiftUI
import UIKit

struct ConversationScreen: View {
  @Bindable var model: AppModel
  var openSidebar: () -> Void = {}
  var openNewSession: () -> Void = {}
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @State private var composerHeight: CGFloat = 0
  @State private var contentWidth: CGFloat = 0
  @State private var isKeyboardVisible = false
  @State private var renameTitle = ""
  @State private var isShowingRenameAlert = false
  @State private var isShowingDeleteConfirmation = false
  @State private var isShowingFilesDrawer = false
  @State private var isShowingHeaderCommitSheet = false
  @State private var isQueueExpanded = false
  @State private var headerCommitCwd: String?
  @State private var headerCommitStatus: GitStatusSummary?
  @State private var headerCommitFiles: [GitChangeFile] = []
  @State private var isPreparingHeaderCommit = false
  @State private var isPushingHeaderGit = false
  @State private var editingUserMessage: EditableUserMessage?
  @State private var assistantBranchTarget: BranchableAssistantMessage?

  var body: some View {
    ZStack(alignment: .bottom) {
      conversationContent
        .frame(maxWidth: .infinity, maxHeight: .infinity)

      if !model.isLoadingSelectedSession {
        composerOverlay
          .background {
            GeometryReader { proxy in
              Color.clear.preference(
                key: ComposerHeightPreferenceKey.self,
                value: proxy.size.height
              )
            }
          }
      }
    }
    .background {
      ZStack {
        Rectangle()
          .fill(.background)
          .ignoresSafeArea()

        GeometryReader { proxy in
          Color.clear.preference(
            key: ConversationWidthPreferenceKey.self,
            value: proxy.size.width
          )
        }
      }
    }
    .onPreferenceChange(ComposerHeightPreferenceKey.self) { height in
      composerHeight = height
    }
    .onPreferenceChange(ConversationWidthPreferenceKey.self) { width in
      if width > 0 {
        contentWidth = width
      }
    }
    .onReceive(
      NotificationCenter.default.publisher(
        for: UIResponder.keyboardWillShowNotification
      )
    ) { _ in
      isKeyboardVisible = true
    }
    .onReceive(
      NotificationCenter.default.publisher(
        for: UIResponder.keyboardWillHideNotification
      )
    ) { _ in
      isKeyboardVisible = false
    }
    .navigationTitle("")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if horizontalSizeClass != .compact {
        ToolbarItem(placement: .topBarLeading) {
          Button("Sessions", systemImage: "sidebar.left", action: openSidebar)
        }
      }
      ToolbarItem(placement: .topBarLeading) {
        ConversationNavigationTitleLayout {
          ConversationNavigationTitleView(
            title: navigationTitle,
            subtitle: model.conversationHeaderSubtitle
          )
        }
        .frame(width: navigationTitleMaxWidth, alignment: .leading)
        .allowsHitTesting(false)
      }
      .sharedBackgroundVisibility(.hidden)
      ToolbarItemGroup(placement: .topBarTrailing) {
        if model.hasRealCurrentSession {
          ContextUsageRingMenu(
            contextUsage: model.sessionState.contextUsage,
            isCompacting: model.sessionState.compacting,
            compactSession: compactSession
          )
        }
        ConversationHeaderOptionsMenu(
          model: model,
          isPreparingCommit: isPreparingHeaderCommit,
          isPushing: isPushingHeaderGit,
          openFiles: showFilesDrawer,
          commitChanges: showHeaderCommitSheet,
          pushChanges: pushHeaderGit,
          renameSession: showRenameSessionAlert,
          deleteSession: showDeleteSessionConfirmation
        )
      }
    }
    .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
    .alert("Rename session", isPresented: $isShowingRenameAlert) {
      TextField("Session name", text: $renameTitle)
      Button("Cancel", role: .cancel) {}
      Button("Rename") {
        renameCurrentSession()
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
        deleteCurrentSession()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This removes the session from Pico and moves it to Trash when possible.")
    }
    .alert("Branch in new chat?", isPresented: branchConfirmationBinding) {
      Button("Cancel", role: .cancel) {
        assistantBranchTarget = nil
      }

      Button("Branch in New Chat") {
        branchFromAssistantMessage()
      }
      .disabled(model.isSubmitting)
    } message: {
      Text(
        "Pico will create a new chat that contains this conversation up through the selected assistant response. Future prompts continue in the new branch, and this chat stays unchanged."
      )
    }
    .sheet(isPresented: $isShowingFilesDrawer) {
      NavigationStack {
        GitWorkspaceView(model: model)
          .navigationTitle("Files")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .topBarLeading) {
              Button {
                isShowingFilesDrawer = false
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
    .sheet(isPresented: $isShowingHeaderCommitSheet) {
      if let cwd = headerCommitCwd {
        NavigationStack {
          GitCommitSheetView(
            model: model,
            cwd: cwd,
            status: headerCommitStatus,
            files: headerCommitFiles,
            onComplete: completeHeaderCommit
          )
        }
      }
    }
    .sheet(item: $editingUserMessage) { editingMessage in
      EditUserMessageSheet(
        item: editingMessage.item,
        isSubmitting: model.isSubmitting,
        onResend: { editedText in
          await model.forkAndSubmitEditedMessage(
            editingMessage.item,
            editedText: editedText
          )
        }
      )
    }
  }

  private var composerOverlay: some View {
    ComposerView(model: model, isQueueExpanded: $isQueueExpanded)
      .padding(.bottom, isKeyboardVisible ? 8 : 0)
  }

  private var conversationContent: some View {
    Group {
      if model.isLoadingSelectedSession {
        LoadingSessionView(title: model.loadingSessionTitle)
      } else if model.conversationItems.isEmpty {
        ChatWelcomeView(
          model: model,
          bottomContentInset: composerContentInset
        )
      } else {
        ConversationView(
          model: model,
          items: model.conversationItems,
          hideThinking: model.sessionState.hideThinkingBlock,
          hideToolBlocks: model.hideToolBlocks,
          hiddenThinkingPreview: model.sessionState.hiddenThinkingPreview,
          isStreaming: model.sessionState.streaming,
          isCompacting: model.sessionState.compacting,
          workingLabel: model.conversationWorkingLabel,
          bottomContentInset: composerContentInset,
          canEditUserMessages: model.canForkUserMessages,
          canBranchAssistantMessages: model.canBranchAssistantMessages,
          onEditUserMessage: editUserMessage,
          onBranchAssistantMessage: confirmBranchAssistantMessage,
          onCancelCompaction: cancelCompaction
        )
      }
    }
  }

  private var composerContentInset: CGFloat {
    model.isLoadingSelectedSession ? 0 : composerHeight + 16
  }

  private var navigationTitle: String {
    model.conversationTitle
  }

  private var branchConfirmationBinding: Binding<Bool> {
    Binding(
      get: { assistantBranchTarget != nil },
      set: { isPresented in
        if !isPresented {
          assistantBranchTarget = nil
        }
      }
    )
  }

  private var navigationTitleMaxWidth: CGFloat {
    let leadingReserve: CGFloat = horizontalSizeClass == .compact ? 84 : 132
    let trailingReserve: CGFloat = 132
    let measuredWidth = contentWidth > 0 ? contentWidth : 390
    return max(120, measuredWidth - leadingReserve - trailingReserve)
  }

  private func showFilesDrawer() {
    isShowingFilesDrawer = true
  }

  private func showHeaderCommitSheet() {
    guard !isPreparingHeaderCommit,
          let cwd = model.conversationGitDirectory else {
      return
    }

    isPreparingHeaderCommit = true
    Task {
      defer { isPreparingHeaderCommit = false }

      do {
        async let statusResponse = model.fetchGitStatus(cwd: cwd)
        async let changesResponse = model.fetchGitChanges(cwd: cwd, scope: "files")
        let (status, changes) = try await (statusResponse, changesResponse)

        headerCommitCwd = cwd
        headerCommitStatus = status.gitStatus ?? model.conversationGitStatus
        headerCommitFiles = changes.files ?? []
        isShowingHeaderCommitSheet = true
      } catch is CancellationError {
        return
      } catch {
        model.alert = AppAlert(
          title: "Could not load changes",
          message: Self.message(for: error)
        )
      }
    }
  }

  private func completeHeaderCommit() {
    isShowingHeaderCommitSheet = false
    _ = model.refreshFilesGitStateAfterMutation(force: true)
  }

  private func pushHeaderGit() {
    guard !isPushingHeaderGit,
          let cwd = model.conversationGitDirectory else {
      return
    }

    isPushingHeaderGit = true
    Task {
      _ = await model.pushGitChanges(cwd: cwd)
      isPushingHeaderGit = false
    }
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }

    return error.localizedDescription
  }

  private func editUserMessage(_ item: UserConversationItem) {
    editingUserMessage = EditableUserMessage(item: item)
  }

  private func confirmBranchAssistantMessage(_ item: AssistantConversationItem) {
    assistantBranchTarget = BranchableAssistantMessage(item: item)
  }

  private func branchFromAssistantMessage() {
    guard let target = assistantBranchTarget else { return }

    assistantBranchTarget = nil
    Task {
      await model.branchFromAssistantMessage(target.item)
    }
  }

  private func showRenameSessionAlert() {
    guard model.canRenameCurrentSession else { return }
    renameTitle = model.currentSessionRenameTitle
    isShowingRenameAlert = true
  }

  private func showDeleteSessionConfirmation() {
    guard model.canDeleteCurrentSession else { return }
    isShowingDeleteConfirmation = true
  }

  private func renameCurrentSession() {
    let name = renameTitle
    Task {
      await model.renameCurrentSession(to: name)
    }
  }

  private func deleteCurrentSession() {
    Task {
      await model.deleteCurrentSession()
    }
  }

  private func compactSession() {
    Task {
      await model.compactSession()
    }
  }

  private func cancelCompaction() {
    Task {
      await model.cancelCompaction()
    }
  }
}

private struct EditableUserMessage: Identifiable {
  var id: String { item.id }
  var item: UserConversationItem
}

private struct BranchableAssistantMessage: Identifiable {
  var id: String { item.id }
  var item: AssistantConversationItem
}

private struct EditUserMessageSheet: View {
  var item: UserConversationItem
  var isSubmitting: Bool
  var onResend: (String) async -> Bool

  @Environment(\.dismiss) private var dismiss
  @State private var text: String
  @State private var isResending = false

  init(
    item: UserConversationItem,
    isSubmitting: Bool,
    onResend: @escaping (String) async -> Bool
  ) {
    self.item = item
    self.isSubmitting = isSubmitting
    self.onResend = onResend
    _text = State(initialValue: item.text)
  }

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 12) {
        Text("Edit the message, then resend it from this point in the conversation.")
          .font(.subheadline)
          .foregroundStyle(.secondary)

        TextEditor(text: $text)
          .font(.body)
          .scrollContentBackground(.hidden)
          .background(.clear)
          .frame(minHeight: 180)
          .padding(8)
          .background(
            Color(uiColor: .secondarySystemBackground),
            in: .rect(cornerRadius: 14)
          )
          .accessibilityLabel("Edited message")

        if !item.images.isEmpty {
          Label(attachmentLabel, systemImage: "photo")
            .font(.caption)
            .foregroundStyle(.secondary)
        }

        Spacer(minLength: 0)
      }
      .padding()
      .navigationTitle("Edit Message")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            dismiss()
          }
          .disabled(isResending)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Resend") {
            resend()
          }
          .disabled(submitDisabled)
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var submitDisabled: Bool {
    isSubmitting || isResending ||
      (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        item.images.isEmpty)
  }

  private var attachmentLabel: String {
    let suffix = item.images.count == 1 ? "" : "s"
    return "Resends \(item.images.count) image attachment\(suffix)"
  }

  private func resend() {
    guard !submitDisabled else { return }

    isResending = true
    Task {
      let success = await onResend(text)
      isResending = false
      if success {
        dismiss()
      }
    }
  }
}

private struct ConversationNavigationTitleLayout: Layout {
  func sizeThatFits(
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) -> CGSize {
    guard let subview = subviews.first else { return .zero }

    let proposedWidth = proposal.width ?? subview.sizeThatFits(.unspecified).width
    let size = subview.sizeThatFits(
      ProposedViewSize(width: proposedWidth, height: proposal.height)
    )

    return CGSize(width: proposedWidth, height: size.height)
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    guard let subview = subviews.first else { return }

    subview.place(
      at: CGPoint(x: bounds.minX, y: bounds.midY),
      anchor: .leading,
      proposal: ProposedViewSize(width: bounds.width, height: bounds.height)
    )
  }
}

private struct ConversationNavigationTitleView: View {
  var title: String
  var subtitle: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title)
        .font(.headline)
        .lineLimit(1)
        .truncationMode(.tail)

      if let subtitle, !subtitle.isEmpty {
        Text(subtitle)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.tail)
      }
    }
    .multilineTextAlignment(.leading)
  }
}

private struct ConversationHeaderOptionsMenu: View {
  @Bindable var model: AppModel
  var isPreparingCommit: Bool
  var isPushing: Bool
  var openFiles: () -> Void
  var commitChanges: () -> Void
  var pushChanges: () -> Void
  var renameSession: () -> Void
  var deleteSession: () -> Void

  var body: some View {
    Menu {
      modelMenu
      reasoningMenu

      Divider()

      thinkingVisibilityButton
      toolVisibilityButton

      if showsGitActions {
        Divider()

        gitActionButtons
      }

      Divider()

      Button(action: openFiles) {
        Label("Files", systemImage: "folder")
      }

      if model.canRenameCurrentSession {
        Divider()

        Button(action: renameSession) {
          Label("Rename", systemImage: "pencil")
        }

        Button(role: .destructive, action: deleteSession) {
          Label("Delete", systemImage: "trash")
        }
        .disabled(!model.canDeleteCurrentSession)
      }
    } label: {
      Label("More", systemImage: "ellipsis")
    }
    .accessibilityLabel("Session options")
  }

  private var showsGitActions: Bool {
    model.hasConversationGitChangesToCommit || model.hasConversationGitCommitsToPush
  }

  @ViewBuilder
  private var gitActionButtons: some View {
    if model.hasConversationGitChangesToCommit {
      Button(action: commitChanges) {
        Label(commitTitle, systemImage: "checkmark.circle")
      }
      .disabled(isPreparingCommit)
    }

    if model.hasConversationGitCommitsToPush {
      Button(action: pushChanges) {
        Label(pushTitle, systemImage: "arrow.up.circle")
      }
      .disabled(isPushing)
    }
  }

  private var commitTitle: String {
    let count = model.conversationGitStatus?.changedFileCount ?? 0
    guard count > 0 else { return "Commit" }
    return count == 1 ? "Commit 1 Change" : "Commit \(count) Changes"
  }

  private var pushTitle: String {
    let count = model.conversationGitStatus?.ahead ?? 0
    guard count > 0 else { return "Push" }
    return count == 1 ? "Push 1 Commit" : "Push \(count) Commits"
  }

  private var modelMenu: some View {
    Menu {
      if modelOptions.isEmpty {
        Text("No models")
      } else {
        ForEach(providerNames, id: \.self) { provider in
          Menu(provider) {
            ForEach(models(for: provider), id: \.stableIdentifier) { option in
              Button(action: { selectModel(option) }) {
                if selectedModel?.stableIdentifier == option.stableIdentifier {
                  Label(option.displayName, systemImage: "checkmark")
                } else {
                  Text(option.displayName)
                }
              }
            }
          }
        }
      }
    } label: {
      Text(modelMenuTitle)
    }
    .disabled(modelOptions.isEmpty)
  }

  private var reasoningMenu: some View {
    Menu {
      ForEach(model.composerThinkingLevels, id: \.self) { level in
        Button(action: { selectThinkingLevel(level) }) {
          if level == model.sessionState.thinkingLevel {
            Label(Self.reasoningLabel(for: level), systemImage: "checkmark")
          } else {
            Text(Self.reasoningLabel(for: level))
          }
        }
      }
    } label: {
      Text(reasoningMenuTitle)
    }
    .disabled(model.composerThinkingLevels.isEmpty)
  }

  private var selectedModel: ModelOption? {
    model.composerModel
  }

  private var modelMenuTitle: String {
    if let selectedModel {
      "Model: \(selectedModel.displayName)"
    } else {
      "Model"
    }
  }

  private var reasoningMenuTitle: String {
    "Reasoning: \(Self.reasoningLabel(for: model.sessionState.thinkingLevel))"
  }

  private var modelOptions: [ModelOption] {
    var options = model.sessionState.availableModels
    if let selectedModel,
       !options.contains(where: { $0.stableIdentifier == selectedModel.stableIdentifier }) {
      options.append(selectedModel)
    }

    return options.sorted { left, right in
      let providerCompare = left.providerDisplayName.localizedStandardCompare(
        right.providerDisplayName
      )
      if providerCompare != .orderedSame {
        return providerCompare == .orderedAscending
      }

      return left.displayName.localizedStandardCompare(right.displayName) == .orderedAscending
    }
  }

  private var providerNames: [String] {
    var seen = Set<String>()
    return modelOptions.compactMap { option in
      let provider = option.providerDisplayName
      guard !seen.contains(provider) else { return nil }
      seen.insert(provider)
      return provider
    }
  }

  private func models(for provider: String) -> [ModelOption] {
    modelOptions.filter { $0.providerDisplayName == provider }
  }

  private var thinkingVisibilityButton: some View {
    Button(action: toggleThinkingVisibility) {
      Label(
        model.sessionState.hideThinkingBlock ? "Show thinking" : "Hide thinking",
        systemImage: model.sessionState.hideThinkingBlock ? "eye" : "eye.slash"
      )
    }
  }

  private var toolVisibilityButton: some View {
    Button(action: toggleToolVisibility) {
      Label(
        model.hideToolBlocks ? "Show tools" : "Hide tools",
        systemImage: model.hideToolBlocks ? "eye" : "eye.slash"
      )
    }
  }

  private func selectModel(_ option: ModelOption) {
    Task {
      await model.selectComposerModel(option)
    }
  }

  private func selectThinkingLevel(_ level: String) {
    Task {
      await model.setThinkingLevel(level)
    }
  }

  private func toggleThinkingVisibility() {
    Task {
      await model.setThinkingHidden(!model.sessionState.hideThinkingBlock)
    }
  }

  private func toggleToolVisibility() {
    model.setToolBlocksHidden(!model.hideToolBlocks)
  }

  private static func reasoningLabel(for level: String) -> String {
    switch level {
    case "off":
      "Off"
    case "minimal":
      "Minimal"
    case "low":
      "Low"
    case "medium":
      "Medium"
    case "high":
      "High"
    case "xhigh":
      "Extra High"
    case "pro":
      "Pro"
    default:
      level
    }
  }
}

private struct LoadingSessionView: View {
  var title: String?

  var body: some View {
    VStack(spacing: 12) {
      ProgressView()
      VStack(spacing: 4) {
        Text("Loading session…")
          .font(.headline)
        if let title, !title.isEmpty {
          Text(title)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding()
  }
}

private struct ChatWelcomeView: View {
  @Bindable var model: AppModel
  var bottomContentInset: CGFloat = 0

  var body: some View {
    ScrollView {
      Spacer(minLength: 0)
        .frame(maxWidth: .infinity)
        .padding()
        .padding(.bottom, bottomContentInset)
    }
    .scrollDismissesKeyboard(.interactively)
  }
}

private struct ComposerHeightPreferenceKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

private struct ConversationWidthPreferenceKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

#Preview {
  ConversationScreen(model: AppModel())
}
