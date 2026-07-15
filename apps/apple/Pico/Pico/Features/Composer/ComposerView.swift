import HotSwiftUI
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

#if os(macOS)
  private let composerCardCornerRadius: CGFloat = 16
  private let composerTextFieldMinHeight: CGFloat = 52
#else
  private let composerCardCornerRadius: CGFloat = 28
  private let composerTextFieldMinHeight: CGFloat = 64
#endif

struct ComposerView: View {
  @ObserveInjection private var forceRedraw
  @Bindable var model: AppModel
  @FocusState private var isPromptFocused: Bool
  @State private var selectedPhotoItems: [PhotosPickerItem] = []
  @State private var isShowingPhotoPicker = false
  @Binding var isQueueExpanded: Bool
  @State private var isShowingCameraPicker = false
  @State private var isShowingFileImporter = false
  @State private var editingGitComment: ComposerGitCommentAttachment?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !model.sessionState.pendingMessages.isEmpty {
        PendingMessagesView(
          messages: model.sessionState.pendingMessages,
          isExpanded: $isQueueExpanded,
          canStartQueue: canStartQueue,
          onStartQueue: startPendingQueue,
          onReorderMessages: reorderPendingMessages,
          onEditMessage: editPendingMessage,
          onDeleteMessage: deletePendingMessage
        )
        .padding(.horizontal)
      }

      if !model.composerImages.isEmpty {
        ComposerAttachmentPreviewStrip(model: model)
      }

      if model.canEditComposerSessionOptions {
        ComposerSessionOptionsBar(model: model)
          .padding(.horizontal)
      }

      composerCard
        .padding(.horizontal)
        .padding(.top, 6)
    }
    .sheet(item: $editingGitComment) { comment in
      NavigationStack {
        GitCommentSheetView(
          previewTitle: comment.title,
          previewSubtitle: comment.subtitle,
          previewSystemImage: comment.systemImage,
          initialComment: comment.comment,
          primaryActionTitle: "Save",
          delete: {
            model.removeComposerGitComment(comment.id)
            editingGitComment = nil
          }
        ) { updatedComment in
          model.updateComposerGitComment(comment.id, comment: updatedComment)
          editingGitComment = nil
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
    #if os(iOS)
      .sheet(isPresented: $isShowingCameraPicker) {
        CameraImagePicker { data, mimeType in
          model.addComposerImage(data: data, mimeType: mimeType)
        }
      }
    #endif
    .fileImporter(
      isPresented: $isShowingFileImporter,
      allowedContentTypes: [.image],
      allowsMultipleSelection: true,
      onCompletion: addFileImages
    )
    .photosPicker(
      isPresented: $isShowingPhotoPicker,
      selection: $selectedPhotoItems,
      maxSelectionCount: max(1, model.remainingComposerImageSlots),
      matching: .images
    )
    .onChange(of: selectedPhotoItems) {
      let items = selectedPhotoItems
      selectedPhotoItems = []
      Task {
        await addPhotoItems(items)
      }
    }
    #if os(macOS)
      .task {
        await Task.yield()
        isPromptFocused = true
      }
    #endif
  }

  private var composerCard: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !model.composerGitComments.isEmpty {
        ComposerGitCommentChipStrip(
          comments: model.composerGitComments,
          openComment: { editingGitComment = $0 },
          removeComment: model.removeComposerGitComment
        )
        .padding(.horizontal, 14)
        .padding(.top, 12)
      }

      composerTextField
        .padding(.horizontal, 18)
        .padding(.top, model.composerGitComments.isEmpty ? 16 : 8)
        #if os(macOS)
          .padding(.bottom, 6)
        #else
          .padding(.bottom, 10)
        #endif
        .frame(
          maxWidth: .infinity,
          minHeight: composerTextFieldMinHeight,
          alignment: .topLeading
        )

      HStack(alignment: .center, spacing: 10) {
        ComposerAttachmentMenu(
          isShowingPhotoPicker: $isShowingPhotoPicker,
          isShowingCameraPicker: $isShowingCameraPicker,
          isShowingFileImporter: $isShowingFileImporter,
          remainingImageSlots: model.remainingComposerImageSlots
        )

        Spacer(minLength: 12)

        if showsStreamingBehaviorButtons {
          streamingBehaviorButtons
        }

        if !isQueueingPrompt {
          sendButton
        }

        if model.sessionState.streaming {
          abortButton
        }
      }
      .controlSize(.large)
      .padding(.horizontal, 8)
      .padding(.bottom, 8)
    }
    .background {
      RoundedRectangle(cornerRadius: composerCardCornerRadius, style: .continuous)
        .fill(.clear)
        .contentShape(
          RoundedRectangle(cornerRadius: composerCardCornerRadius, style: .continuous)
        )
        .onTapGesture {
          isPromptFocused = true
        }
    }
    .picoGlassEffect(
      in: RoundedRectangle(cornerRadius: composerCardCornerRadius, style: .continuous)
    )
  }

  private var composerTextField: some View {
    TextField("Ask Pico anything", text: $model.composerText, axis: .vertical)
      .textFieldStyle(.plain)
      .focused($isPromptFocused)
      .lineLimit(1...6)
      .submitLabel(.return)
      .picoTextInputAutocapitalization(.sentences)
      .onChange(of: model.composerText) {
        model.saveDraft()
      }
      #if os(macOS)
        .onKeyPress(.return, phases: .down, action: handleComposerReturn)
      #endif
  }

  #if os(macOS)
    private func handleComposerReturn(_ keyPress: KeyPress) -> KeyPress.Result {
      if keyPress.modifiers.contains(.shift)
        || keyPress.modifiers.contains(.command)
        || keyPress.modifiers.contains(.control) {
        return .ignored
      }

      guard !model.isSubmitting, hasPromptContent else { return .handled }

      let streamingBehavior: StreamingBehavior?
      if isQueueingPrompt {
        streamingBehavior = keyPress.modifiers.contains(.option) ? .followUp : .steer
      } else {
        streamingBehavior = nil
      }

      submit(streamingBehavior: streamingBehavior)
      return .handled
    }
  #endif

  private var abortButton: some View {
    Button(action: abort) {
      Image(systemName: "stop.fill")
        .font(.system(size: 13, weight: .bold))
    }
    .picoGlassButtonStyle(.prominent, shape: .circle)
    .tint(.red)
    .foregroundStyle(.white)
    .accessibilityLabel("Abort")
  }

  private var streamingBehaviorButtons: some View {
    HStack(spacing: 8) {
      streamingBehaviorButton(.steer)
      streamingBehaviorButton(.followUp)
    }
  }

  private func streamingBehaviorButton(_ behavior: StreamingBehavior) -> some View {
    Button {
      submit(streamingBehavior: behavior)
    } label: {
      Text(behavior.label)
        .font(.body)
        .foregroundStyle(.primary)
        .contentShape(Capsule())
    }
    .picoGlassButtonStyle(shape: .capsule)
    .disabled(model.isSubmitting || !hasPromptContent)
    .accessibilityLabel("Send as \(behavior.label)")
  }

  private var showsStreamingBehaviorButtons: Bool {
    isQueueingPrompt && hasPromptContent
  }

  private var isQueueingPrompt: Bool {
    model.sessionState.streaming || model.sessionState.compacting
  }

  private var canStartQueue: Bool {
    !model.sessionState.pendingMessages.isEmpty && !model.sessionState.streaming
      && !model.sessionState.compacting && !model.isSubmitting
  }

  private var hasPromptText: Bool {
    !model.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var hasPromptContent: Bool {
    hasPromptText || !model.composerImages.isEmpty || !model.composerGitComments.isEmpty
  }

  private var submitDisabled: Bool {
    !hasPromptContent
  }

  private var sendButton: some View {
    Button(action: submit) {
      sendButtonLabel
        .contentShape(Circle())
    }
    .picoGlassButtonStyle(.prominent, shape: .circle)
    .tint(Color.accentColor)
    .foregroundStyle(.white)
    .opacity(submitDisabled ? 0.45 : 1)
    .disabled(model.isSubmitting)
    .allowsHitTesting(!submitDisabled && !model.isSubmitting)
    .accessibilityLabel("Send")
  }

  @ViewBuilder
  private var sendButtonLabel: some View {
    if model.isSubmitting {
      ProgressView()
        .controlSize(.small)
    } else {
      PicoIcon(systemName: "arrow.up")
        .font(.system(size: 14, weight: .bold))
    }
  }

  private func submit() {
    submit(streamingBehavior: isQueueingPrompt ? .steer : nil)
  }

  private func submit(streamingBehavior: StreamingBehavior?) {
    guard !submitDisabled else { return }

    isPromptFocused = false
    Task {
      await model.submitComposerPrompt(streamingBehavior: streamingBehavior)
    }
  }

  private func abort() {
    Task {
      await model.abort()
    }
  }

  private func reorderPendingMessages(_ messages: [PendingUserMessage]) {
    Task {
      await model.reorderPendingMessages(messages)
    }
  }

  private func editPendingMessage(_ message: PendingUserMessage, text: String) {
    Task {
      await model.editPendingMessage(message, text: text)
    }
  }

  private func startPendingQueue() {
    Task {
      await model.startPendingQueue()
    }
  }

  private func deletePendingMessage(_ message: PendingUserMessage) {
    Task {
      await model.deletePendingMessage(message)
    }
  }

  private func addPhotoItems(_ items: [PhotosPickerItem]) async {
    for item in items {
      guard model.remainingComposerImageSlots > 0 else { break }

      do {
        guard let data = try await item.loadTransferable(type: Data.self) else { continue }
        let mimeType =
          item.supportedContentTypes.first { type in
            type.conforms(to: .image)
          }?.preferredMIMEType ?? "image/jpeg"
        model.addComposerImage(data: data, mimeType: mimeType)
      } catch {
        model.alert = AppAlert(
          title: "Could not attach photo",
          message: error.localizedDescription
        )
      }
    }
  }

  private func addFileImages(_ result: Result<[URL], Error>) {
    switch result {
    case .success(let urls):
      Task {
        for url in urls {
          guard model.remainingComposerImageSlots > 0 else { break }
          await addFileImage(url)
        }
      }
    case .failure(let error):
      model.alert = AppAlert(
        title: "Could not attach file",
        message: error.localizedDescription
      )
    }
  }

  private func addFileImage(_ url: URL) async {
    do {
      let hasAccess = url.startAccessingSecurityScopedResource()
      defer {
        if hasAccess {
          url.stopAccessingSecurityScopedResource()
        }
      }

      let data = try Data(contentsOf: url)
      let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/jpeg"
      model.addComposerImage(data: data, mimeType: mimeType)
    } catch {
      model.alert = AppAlert(
        title: "Could not attach file",
        message: error.localizedDescription
      )
    }
  }
}

private struct ComposerGitCommentChipStrip: View {
  var comments: [ComposerGitCommentAttachment]
  var openComment: (ComposerGitCommentAttachment) -> Void
  var removeComment: (String) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(comments) { comment in
          ComposerGitCommentChip(
            comment: comment,
            openComment: { openComment(comment) },
            removeComment: { removeComment(comment.id) }
          )
        }
      }
      .padding(.vertical, 2)
    }
  }
}

private struct ComposerGitCommentChip: View {
  var comment: ComposerGitCommentAttachment
  var openComment: () -> Void
  var removeComment: () -> Void

  var body: some View {
    HStack(spacing: 2) {
      Button(action: openComment) {
        HStack(spacing: 6) {
          PicoIcon(systemName: comment.systemImage)
            .font(.caption.weight(.semibold))
            .accessibilityHidden(true)

          Text("Comment: \(GitFormatting.baseName(comment.title))")
            .lineLimit(1)
        }
        .frame(maxWidth: 220, alignment: .leading)
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Edit Git comment for \(comment.title)")

      Button(action: removeComment) {
        PicoIcon(systemName: "xmark")
          .font(.caption.weight(.bold))
          .frame(width: 24, height: 24)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Remove Git comment for \(comment.title)")
    }
    .font(.caption.weight(.semibold))
    .foregroundStyle(Color(uiColor: .systemOrange))
    .padding(.leading, 9)
    .padding(.trailing, 3)
    .frame(height: 30)
    .background(
      Color(uiColor: .systemOrange).opacity(0.12),
      in: Capsule()
    )
  }
}

private struct ComposerAttachmentMenu: View {
  @ObserveInjection private var forceRedraw
  @Binding var isShowingPhotoPicker: Bool
  @Binding var isShowingCameraPicker: Bool
  @Binding var isShowingFileImporter: Bool
  @State private var isShowingAttachmentPopover = false
  var remainingImageSlots: Int

  var body: some View {
    Button {
      isShowingAttachmentPopover.toggle()
    } label: {
      PicoIcon(systemName: "plus")
        .font(.headline)
    }
    #if os(macOS)
      .buttonStyle(.bordered)
    #else
      .picoGlassButtonStyle(shape: .circle)
    #endif
    .popover(isPresented: $isShowingAttachmentPopover, arrowEdge: .bottom) {
      VStack(alignment: .leading, spacing: 10) {
        #if os(iOS)
          Button("Camera", picoSystemImage: "camera") {
            isShowingAttachmentPopover = false
            isShowingCameraPicker = true
          }
          .disabled(
            !UIImagePickerController.isSourceTypeAvailable(.camera)
              || remainingImageSlots == 0
          )
        #endif

        Button("Photos", picoSystemImage: "photo.on.rectangle") {
          isShowingAttachmentPopover = false
          isShowingPhotoPicker = true
        }
        .disabled(remainingImageSlots == 0)

        Button("Files", picoSystemImage: "folder") {
          isShowingAttachmentPopover = false
          isShowingFileImporter = true
        }
        .disabled(remainingImageSlots == 0)
      }
      .buttonStyle(.plain)
      .padding(12)
    }
    .accessibilityLabel("Add attachment")
  }
}

struct ContextUsageRingMenu: View {
  var contextUsage: ContextUsage?
  var isCompacting: Bool
  var isLoading = false
  var compactSession: () -> Void
  var showsCompactAction = true

  var body: some View {
    Menu {
      if showsCompactAction {
        Section("Session") {
          Button(action: compactSession) {
            Label(
              isCompacting ? "Compacting…" : "Compact context",
              picoSystemImage: "summary",
              size: 20
            )
          }
          .disabled(isCompacting)
        }
      }

      if showsLoadingIndicator {
        Text("Loading context usage…")
      } else if let snapshot {
        Section("Context window") {
          Text(snapshot.displayPercent)
          Text(snapshot.displayTokens)
        }
      } else {
        Text("Context usage unavailable")
      }
    } label: {
      ZStack {
        if showsLoadingIndicator {
          ProgressView()
            .controlSize(.small)
        } else {
          #if os(macOS)
            ContextUsageRingImage(percent: snapshot?.percent)
          #else
            ContextUsageRing(percent: snapshot?.percent)
          #endif
        }
      }
      .frame(width: 20, height: 20)
      .frame(width: 30, height: 30)
      .contentShape(Circle())
    }
    .menuIndicator(.hidden)
    .picoContextUsageMenuStyle()
    .accessibilityLabel(accessibilityLabel)
    .help(accessibilityLabel)
  }

  private var snapshot: ContextUsageSnapshot? {
    guard let contextUsage else { return nil }
    return ContextUsageSnapshot(contextUsage: contextUsage)
  }

  private var showsLoadingIndicator: Bool {
    isLoading
  }

  private var accessibilityLabel: String {
    if showsLoadingIndicator { return "Loading context usage" }
    guard let snapshot else { return "Context usage unavailable" }
    return "Context usage, \(snapshot.displayPercent), \(snapshot.displayTokens)"
  }
}

private struct ContextUsageRing: View {
  var percent: Double?

  var body: some View {
    ZStack {
      Circle()
        .stroke(Color.secondary.opacity(0.55), lineWidth: 2.5)

      if let clampedPercent {
        Circle()
          .trim(from: 0, to: clampedPercent / 100)
          .stroke(
            strokeColor(for: clampedPercent),
            style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
          )
          .rotationEffect(.degrees(-90))
      }
    }
    .frame(width: 16, height: 16)
    .frame(width: 20, height: 20)
  }

  private var clampedPercent: Double? {
    guard let percent, percent.isFinite else { return nil }
    return min(100, max(0, percent))
  }

  private func strokeColor(for percent: Double) -> Color {
    if percent >= 90 { return .red }
    if percent >= 80 { return .orange }
    return .accentColor
  }
}

#if os(macOS)
  private struct ContextUsageRingImage: View {
    var percent: Double?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
      if let image = renderedImage {
        Image(nsImage: image)
          .resizable()
          .frame(width: 20, height: 20)
      } else {
        Image(picoSystemName: "circle", pointSize: 20)
      }
    }

    private var renderedImage: NSImage? {
      let renderer = ImageRenderer(
        content: ContextUsageRing(percent: percent)
          .environment(\.colorScheme, colorScheme)
      )
      renderer.scale = 2
      return renderer.nsImage
    }
  }
#endif

private struct ContextUsageSnapshot {
  var tokens: Double?
  var contextWindow: Double?
  var percent: Double?

  init?(contextUsage: ContextUsage) {
    tokens = contextUsage.tokens
    contextWindow = contextUsage.contextWindow

    if let rawPercent = contextUsage.percent, rawPercent.isFinite {
      percent = min(100, max(0, rawPercent))
    } else if let tokens,
      let contextWindow,
      contextWindow > 0
    {
      percent = min(100, max(0, tokens / contextWindow * 100))
    } else {
      percent = nil
    }

    if tokens == nil && contextWindow == nil && percent == nil {
      return nil
    }
  }

  var displayPercent: String {
    guard let percent else { return "Usage estimate pending" }
    return "\(Int(percent.rounded()))% used"
  }

  var displayTokens: String {
    let tokenText = tokens.map(Self.compactNumber) ?? "Pending"
    guard let contextWindow else {
      return "\(tokenText) tokens used"
    }

    return "\(tokenText) / \(Self.compactNumber(contextWindow)) tokens"
  }

  private static func compactNumber(_ value: Double) -> String {
    let absoluteValue = abs(value)
    if absoluteValue >= 1_000_000 {
      return compactValue(value / 1_000_000, suffix: "M")
    }
    if absoluteValue >= 1_000 {
      return compactValue(value / 1_000, suffix: "k")
    }
    return value.formatted(.number.precision(.fractionLength(0)))
  }

  private static func compactValue(_ value: Double, suffix: String) -> String {
    let precision = abs(value) >= 10 ? 0 : 1
    return value.formatted(.number.precision(.fractionLength(0...precision))) + suffix
  }
}

private struct ComposerAttachmentPreviewStrip: View {
  @Bindable var model: AppModel

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(model.composerImages) { image in
          ComposerImageAttachmentThumbnail(image: image) {
            model.removeComposerImage(image)
          }
        }
      }
      .padding(.horizontal)
    }
  }
}

private struct ComposerImageAttachmentThumbnail: View {
  var image: PromptImage
  var remove: () -> Void

  var body: some View {
    ZStack(alignment: .topTrailing) {
      thumbnail
        .frame(width: 54, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(.quaternary, lineWidth: 0.5)
        }

      Button(action: remove) {
        PicoIcon(systemName: "xmark")
          .font(.caption2.weight(.bold))
          .padding(4)
          .background(.thinMaterial, in: Circle())
      }
      .buttonStyle(.plain)
      .offset(x: 6, y: -6)
      .accessibilityLabel("Remove attachment")
    }
    .padding(.top, 6)
  }

  @ViewBuilder
  private var thumbnail: some View {
    if let data = Data(base64Encoded: image.data),
      let uiImage = UIImage(data: data)
    {
      Image(uiImage: uiImage)
        .resizable()
        .scaledToFill()
    } else {
      PicoIcon(systemName: "photo")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial)
    }
  }
}

#if os(iOS)
  private struct CameraImagePicker: UIViewControllerRepresentable {
    var addImage: (Data, String) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
      Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
      let picker = UIImagePickerController()
      picker.delegate = context.coordinator
      picker.sourceType = .camera
      picker.mediaTypes = [UTType.image.identifier]
      return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate,
      UIImagePickerControllerDelegate
    {
      var parent: CameraImagePicker

      init(parent: CameraImagePicker) {
        self.parent = parent
      }

      func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
      ) {
        defer { parent.dismiss() }

        guard let image = info[.originalImage] as? UIImage,
          let data = image.jpegData(compressionQuality: 0.86)
        else {
          return
        }

        parent.addImage(data, "image/jpeg")
      }

      func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        parent.dismiss()
      }
    }
  }
#endif

private struct ComposerSessionOptionsBar: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ComposerDirectorySelectorView(model: model)

      if model.composerGitStatus != nil {
        ComposerGitBranchSelectorView(model: model)
      }
    }
  }
}

private struct ComposerDirectorySelectorView: View {
  @Bindable var model: AppModel
  @State private var isShowingAddDirectory = false

  var body: some View {
    Menu {
      Section("Directories") {
        ForEach(directoryOptions, id: \.self) { directory in
          Button(action: { select(directory) }) {
            directoryMenuLabel(for: directory)
          }
        }
      }

      Divider()

      Button {
        isShowingAddDirectory = true
      } label: {
        Label("Add another…", picoSystemImage: "folder.badge.plus", size: 20)
      }
    } label: {
      ComposerDirectoryChip(
        title: DirectoryPathFormatter.folderName(selectedDirectory)
      )
    }
    .picoGlassButtonStyle(shape: .capsule)
    .accessibilityLabel("Select directory")
    .sheet(isPresented: $isShowingAddDirectory) {
      SidebarAddDirectoryView(
        model: model,
        onDismiss: { isShowingAddDirectory = false },
        onAdded: { directory in
          await model.selectComposerDirectory(directory)
        }
      )
    }
  }

  private var selectedDirectory: String {
    DirectoryPathFormatter.normalizedDirectoryPrefix(model.composerDirectory)
  }

  private var directoryOptions: [String] {
    var seen = Set<String>()
    var options: [String] = []

    func append(_ directory: String) {
      let normalizedDirectory = DirectoryPathFormatter.normalizedDirectoryPrefix(directory)
      guard !normalizedDirectory.isEmpty, !seen.contains(normalizedDirectory) else {
        return
      }
      seen.insert(normalizedDirectory)
      options.append(normalizedDirectory)
    }

    append(selectedDirectory)
    for directory in model.sidebarDirectories {
      append(directory)
    }

    return options
  }

  private func isSelected(_ directory: String) -> Bool {
    DirectoryPathFormatter.normalizedDirectoryPrefix(directory) == selectedDirectory
  }

  private func directoryMenuLabel(for directory: String) -> some View {
    let selected = isSelected(directory)
    return Label {
      Text(DirectoryPathFormatter.displayPath(directory))
    } icon: {
      Image(picoSystemName: "checkmark", pointSize: 20)
        .opacity(selected ? 1 : 0)
        .accessibilityHidden(true)
    }
  }

  private func select(_ directory: String) {
    guard !isSelected(directory) else { return }

    Task {
      await model.selectComposerDirectory(directory)
    }
  }
}

private struct ComposerGitBranchSelectorView: View {
  @Bindable var model: AppModel
  @State private var isShowingCreateBranch = false
  @State private var createBranchName = ""

  var body: some View {
    Menu {
      Section("Branches") {
        Button {
          isShowingCreateBranch = true
        } label: {
          Label("Create branch…", picoSystemImage: "plus", size: 20)
        }
        .disabled(model.isCheckingOutGitBranch)

        if model.isLoadingGitBranches && model.composerGitLocalBranches.isEmpty {
          Label("Loading branches…", picoSystemImage: "hourglass", size: 20)
        } else if model.composerGitLocalBranches.isEmpty {
          Text("No local branches")
        } else {
          ForEach(model.composerGitLocalBranches) { branch in
            Button(action: { switchBranch(branch) }) {
              if branch.current {
                Label(branchTitle(branch), picoSystemImage: "checkmark", size: 20)
              } else {
                Text(branchTitle(branch))
              }
            }
            .disabled(model.isCheckingOutGitBranch)
          }
        }
      }
    } label: {
      GitBranchChip(
        title: model.composerGitBranchLabel ?? "Branch",
        isLoading: model.isCheckingOutGitBranch
          || (model.isLoadingGitBranches && model.composerGitLocalBranches.isEmpty)
      )
    }
    .picoGlassButtonStyle(shape: .capsule)
    .disabled(model.isCheckingOutGitBranch)
    .accessibilityLabel("Select git branch")
    .task(id: selectedDirectory) {
      model.refreshComposerGitBranches()
    }
    .alert("Create branch", isPresented: $isShowingCreateBranch) {
      TextField("branch-name", text: $createBranchName)
        .picoTextInputAutocapitalization(.never)
        .autocorrectionDisabled()
      Button("Cancel", role: .cancel) {
        createBranchName = ""
      }
      Button("Create") {
        createBranch()
      }
      .disabled(
        createBranchName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      )
    } message: {
      Text("Create and switch from the current HEAD.")
    }
  }

  private var selectedDirectory: String {
    DirectoryPathFormatter.normalizedDirectoryPrefix(model.composerDirectory)
  }

  private func switchBranch(_ branch: GitLocalBranch) {
    guard !branch.current else { return }

    Task {
      await model.checkoutComposerGitBranch(branch)
    }
  }

  private func createBranch() {
    let branchName = createBranchName.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !branchName.isEmpty else { return }

    createBranchName = ""
    Task {
      await model.createComposerGitBranch(named: branchName)
    }
  }

  private func branchTitle(_ branch: GitLocalBranch) -> String {
    GitFormatting.localBranchMenuTitle(branch)
  }
}

private struct ComposerDirectoryChip: View {
  var title: String

  var body: some View {
    HStack(spacing: 6) {
      PicoIcon(systemName: "folder", size: 20)
        .font(.caption.weight(.semibold))
        .accessibilityHidden(true)

      Text(title)
        .lineLimit(1)
        .truncationMode(.tail)

      PicoIcon(systemName: "chevron.down")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
    .font(.subheadline.weight(.semibold))
    .foregroundStyle(.primary)
    .padding(.horizontal, 10)
    .frame(height: 30)
    .contentShape(Capsule())
  }
}

#Preview {
  ComposerView(model: AppModel(), isQueueExpanded: .constant(false))
}
