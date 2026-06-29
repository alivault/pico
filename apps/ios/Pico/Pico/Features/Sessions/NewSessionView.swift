import SwiftUI

struct NewSessionView: View {
  @Bindable var model: AppModel
  var openDetail: () -> Void = {}
  var openSidebar: () -> Void = {}
  var showsCancelButton = true
  @Environment(\.dismiss) private var dismiss
  @State private var navigationPath: [String] = []
  @State private var promptText = ""
  @State private var directoryInput = ""
  @State private var selectedDirectory = DirectoryPathFormatter.homePrefix
  @State private var selectedModel: ModelOption?
  @State private var showHiddenDirectories = false
  @State private var homeDirectories: [CompletionItem] = []
  @State private var searchResults: [CompletionItem] = []
  @State private var isLoadingHome = false
  @State private var isSearching = false
  @State private var isCreating = false
  @State private var didInitialize = false
  @State private var presentedAlert: AppAlert?
  @State private var presentedUiRequest: UiRequest?
  @FocusState private var focusedField: FocusedField?

  private enum FocusedField: Hashable {
    case prompt
    case directory
  }

  var body: some View {
    NavigationStack(path: $navigationPath) {
      List {
        Section("Prompt") {
          TextField("Ask Pico anything", text: $promptText, axis: .vertical)
            .focused($focusedField, equals: .prompt)
            .lineLimit(3...8)
            .submitLabel(.send)
            .textInputAutocapitalization(.sentences)
            .onSubmit(startSession)
        }

        Section {
          NewSessionModelPickerView(
            models: model.sessionState.availableModels,
            selectedModel: $selectedModel
          )

          NavigationLink(value: selectedDirectory) {
            NewSessionDirectoryLabel(
              path: selectedDirectory,
              subtitle: "Directory",
              isSelected: true
            )
          }
        } header: {
          Text("Session")
        } footer: {
          Text("The first message starts a new Pico session in this directory.")
        }

        Section {
          TextField("Search or paste a directory path", text: $directoryInput)
            .focused($focusedField, equals: .directory)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }

        if let manualPath {
          Section("Use Path") {
            NewSessionDirectoryRow(
              path: manualPath,
              subtitle: "Set as session directory.",
              isSelected: selectedDirectory == manualPath
            ) {
              chooseDirectory(manualPath)
            }
          }
        }

        if isSearching || !visibleSearchResults.isEmpty {
          Section("Matching Folders") {
            if isSearching && visibleSearchResults.isEmpty {
              ProgressView("Searching directories…")
            }
            ForEach(visibleSearchResults) { item in
              NavigationLink(value: item.value) {
                NewSessionDirectoryLabel(
                  path: item.value,
                  subtitle: item.description ?? "Found on your Mac",
                  isSelected: selectedDirectory == item.value
                )
              }
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
                isSelected: selectedDirectory == item.value
              )
            }
          }

          if !isLoadingHome && visibleHomeDirectories.isEmpty {
            Text("No folders found")
              .foregroundStyle(.secondary)
          }
        }

        if !visibleAddedDirectories.isEmpty {
          Section("Added Directories") {
            ForEach(visibleAddedDirectories, id: \.self) { directory in
              NavigationLink(value: directory) {
                NewSessionDirectoryLabel(
                  path: directory,
                  isSelected: selectedDirectory == directory
                )
              }
            }
          }
        }

        if !visibleKnownDirectories.isEmpty {
          Section(query.isEmpty ? "Known Directories" : "Matching Directories") {
            ForEach(visibleKnownDirectories, id: \.self) { directory in
              NavigationLink(value: directory) {
                NewSessionDirectoryLabel(
                  path: directory,
                  isSelected: selectedDirectory == directory
                )
              }
            }
          }
        }
      }
      .navigationTitle("New session")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          if showsCancelButton {
            Button("Cancel", action: dismiss.callAsFunction)
          } else {
            Button("Sessions", systemImage: "sidebar.left", action: openSidebar)
          }
        }
        ToolbarItem(placement: .primaryAction) {
          NewSessionOptionsMenu(showHiddenDirectories: $showHiddenDirectories)
        }
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button(isCreating ? "Starting…" : "Start Session", action: startSession)
            .disabled(!canStartSession || isCreating)
        }
      }
      .navigationDestination(for: String.self) { folderPath in
        NewSessionBrowseFolderView(
          model: model,
          folderPath: DirectoryPathFormatter.normalizedDirectoryPrefix(folderPath),
          showHiddenDirectories: $showHiddenDirectories,
          chooseDirectory: chooseDirectory
        )
      }
      .safeAreaInset(edge: .bottom) {
        NewSessionCreateButtonBar(
          path: creationDirectory,
          isCreating: isCreating,
          canStart: canStartSession,
          action: startSession
        )
      }
      .task {
        initializeDefaults()
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
      .onChange(of: model.activeUiRequest) { _, request in
        presentedUiRequest = request
      }
      .alert(item: $presentedAlert) { alert in
        Alert(
          title: Text(alert.title),
          message: Text(alert.message),
          dismissButton: .default(Text("OK"))
        )
      }
      .sheet(item: $presentedUiRequest, onDismiss: model.clearActiveUiRequest) { request in
        AuthUiRequestSheetView(model: model, request: request)
      }
    }
  }

  private var query: String {
    directoryInput.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var manualPath: String? {
    guard !query.isEmpty,
          DirectoryPathFormatter.looksLikePath(query),
          !hasExactDirectoryMatch(query) else {
      return nil
    }
    return query
  }

  private var typedDirectoryPath: String? {
    if let exactDirectoryMatch = exactDirectoryMatch(query) {
      return exactDirectoryMatch
    }
    return DirectoryPathFormatter.looksLikePath(query) ? manualPath : nil
  }

  private var creationDirectory: String? {
    typedDirectoryPath ?? selectedDirectory
  }

  private var visibleAddedDirectories: [String] {
    model.sidebarDirectories.filter { directory in
      (showHiddenDirectories || !DirectoryPathFormatter.isHidden(directory)) &&
        DirectoryPathFormatter.matches(directory, query: query)
    }
  }

  private var visibleKnownDirectories: [String] {
    let addedDirectories = Set(model.sidebarDirectories)
    return model.knownDirectories.filter { directory in
      !addedDirectories.contains(directory) &&
        (showHiddenDirectories || !DirectoryPathFormatter.isHidden(directory)) &&
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

  private var canStartSession: Bool {
    !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && creationDirectory != nil
  }

  private func hasExactDirectoryMatch(_ value: String) -> Bool {
    exactDirectoryMatch(value) != nil
  }

  private func exactDirectoryMatch(_ value: String) -> String? {
    let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalizedValue.isEmpty else { return nil }

    return (model.knownDirectories + homeDirectories.map(\.value) + searchResults.map(\.value)).first { directory in
      directory.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedValue ||
        DirectoryPathFormatter.displayPath(directory).lowercased() == normalizedValue
    }
  }

  private func initializeDefaults() {
    guard !didInitialize else { return }
    didInitialize = true
    selectedDirectory = model.sessionState.cwd ??
      model.knownDirectories.first ??
      DirectoryPathFormatter.homePrefix
    selectedModel = AppModel.preferredModel(in: model.sessionState.availableModels) ??
      model.sessionState.model
  }

  private func updateHomeDirectories() async {
    isLoadingHome = true
    let directories = await model.listDirectoryEntries(prefix: DirectoryPathFormatter.homePrefix)
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

  private func chooseDirectory(_ directory: String) {
    selectedDirectory = DirectoryPathFormatter.normalizedDirectoryPrefix(directory)
    directoryInput = ""
    navigationPath.removeAll()
  }

  private func startSession() {
    guard let creationDirectory, canStartSession, !isCreating else { return }

    focusedField = nil
    isCreating = true
    Task {
      defer { isCreating = false }

      let started = await model.startNewSession(
        prompt: promptText,
        directoryInput: creationDirectory,
        model: selectedModel
      )
      if started {
        if showsCancelButton {
          dismiss()
        }
        openDetail()
      } else if presentedAlert == nil, model.activeUiRequest == nil {
        presentStartFailureAlert()
      }
    }
  }

  private func presentStartFailureAlert() {
    if let alert = model.alert {
      presentedAlert = alert
      model.alert = nil
    } else {
      presentedAlert = AppAlert(
        title: "Could not start session",
        message: "Pico could not create the session or send the first prompt."
      )
    }
  }
}

#Preview {
  NewSessionView(model: AppModel())
}
