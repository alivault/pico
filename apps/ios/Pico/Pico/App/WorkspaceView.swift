import SwiftUI
import UIKit

private let sidebarBackgroundColor = Color(uiColor: .systemGroupedBackground)

struct WorkspaceView: View {
  @Bindable var model: AppModel
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @State private var columnVisibility: NavigationSplitViewVisibility = .all
  @State private var sidebarPath: [SidebarNavigationDestination] = []
  @State private var purgeRequest: DirectoryActionRequest?
  @State private var filesRequest: DirectoryActionRequest?
  @State private var isSidebarNewSessionHiddenByContent = false
  @State private var sidebarSessionSearchText = ""
  @FocusState private var isSidebarSessionSearchFocused: Bool

  var body: some View {
    Group {
      if horizontalSizeClass == .compact {
        CompactWorkspaceView(model: model)
      } else {
        NavigationSplitView(columnVisibility: $columnVisibility) {
          sidebar
        } detail: {
          chatScreen
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background {
      Rectangle()
        .fill(sidebarBackgroundColor)
        .ignoresSafeArea()
    }
    .directoryActionSheets(
      model: model,
      purgeRequest: $purgeRequest,
      filesRequest: $filesRequest
    )
    .onChange(of: model.conversationPresentationRequest) {
      openConversation()
    }
  }

  private var chatScreen: some View {
    ConversationScreen(
      model: model,
      openSidebar: openSidebar,
      openNewSession: openNewSession
    )
  }

  private var sidebar: some View {
    NavigationStack(path: $sidebarPath) {
      SessionSidebarView(
        model: model,
        sessionSearchText: $sidebarSessionSearchText,
        openDetail: openConversation,
        openDirectory: openDirectory,
        openPurge: showPurgeDirectory,
        openFiles: showFilesDirectory,
        setFloatingNewSessionHidden: setSidebarNewSessionHidden,
        clearFloatingSearch: clearSidebarSessionSearch
      )
      .navigationDestination(for: SidebarNavigationDestination.self) { destination in
        switch destination {
        case .directory(let directory):
          DirectorySessionsFullListView(
            directory: directory,
            model: model,
            sessionSearchText: $sidebarSessionSearchText,
            openDetail: openConversation,
            openPurge: showPurgeDirectory,
            openFiles: showFilesDirectory,
            setFloatingNewSessionHidden: setSidebarNewSessionHidden
          )
        }
      }
    }
    .overlay(alignment: .bottom) {
      sidebarFloatingControls
    }
    .animation(.smooth(duration: 0.2), value: sidebarNewSessionDirectory)
    .animation(
      .smooth(duration: 0.2),
      value: isSidebarNewSessionHiddenByContent
    )
  }

  @ViewBuilder
  private var sidebarFloatingControls: some View {
    if shouldShowSidebarFloatingControls {
      HStack(spacing: 10) {
        SidebarSessionSearchField(
          text: $sidebarSessionSearchText,
          isFocused: $isSidebarSessionSearchFocused,
          placeholder: sidebarSearchPlaceholder
        )

        if let directory = sidebarNewSessionDirectory {
          SidebarNewSessionButton {
            openNewSession(in: directory)
          }
          .transition(.scale.combined(with: .opacity))
        }
      }
      .padding(.horizontal)
      .padding(.bottom, 8)
      .transition(.move(edge: .bottom).combined(with: .opacity))
    }
  }

  private var shouldShowSidebarFloatingControls: Bool {
    !isSidebarNewSessionHiddenByContent &&
      (sidebarNewSessionDirectory != nil || !model.sessionSnapshots.isEmpty)
  }

  private var sidebarSearchPlaceholder: String {
    activeSidebarDirectory == nil ? "Search all sessions" : "Search this directory"
  }

  private var sidebarNewSessionDirectory: String? {
    activeSidebarDirectory ?? topmostSidebarDirectory
  }

  private var activeSidebarDirectory: String? {
    guard case .directory(let directory) = sidebarPath.last else { return nil }
    return directory
  }

  private var topmostSidebarDirectory: String? {
    model.sessionSnapshots.first?.directory ?? model.sidebarDirectories.first
  }

  private func openDirectory(_ directory: String) {
    sidebarPath = [.directory(directory)]
    columnVisibility = .all
  }

  private func openNewSession() {
    openNewSession(in: nil)
  }

  private func openNewSession(in directory: String?) {
    model.beginNewChat(cwd: directory)
    openConversation()
  }

  private func openConversation() {
    isSidebarSessionSearchFocused = false
    columnVisibility = .detailOnly
  }

  private func openSidebar() {
    columnVisibility = .all
  }

  private func showPurgeDirectory(_ directory: String) {
    purgeRequest = DirectoryActionRequest(directory: directory)
  }

  private func showFilesDirectory(_ directory: String) {
    filesRequest = DirectoryActionRequest(directory: directory)
  }

  private func setSidebarNewSessionHidden(_ hidden: Bool) {
    guard isSidebarNewSessionHiddenByContent != hidden else { return }
    withAnimation(.smooth(duration: 0.2)) {
      isSidebarNewSessionHiddenByContent = hidden
    }
  }

  private func clearSidebarSessionSearch() {
    sidebarSessionSearchText = ""
    isSidebarSessionSearchFocused = false
  }
}

private struct CompactWorkspaceView: View {
  @Bindable var model: AppModel
  @State private var navigationPath: [CompactWorkspaceDestination] = []
  @State private var purgeRequest: DirectoryActionRequest?
  @State private var filesRequest: DirectoryActionRequest?
  @State private var isSidebarNewSessionHiddenByContent = false
  @State private var sidebarSessionSearchText = ""
  @FocusState private var isSidebarSessionSearchFocused: Bool

  private enum CompactWorkspaceDestination: Hashable {
    case directory(String)
    case conversation
  }

  var body: some View {
    NavigationStack(path: $navigationPath) {
      sidebar
        .navigationDestination(for: CompactWorkspaceDestination.self) { destination in
          switch destination {
          case .directory(let directory):
            DirectorySessionsFullListView(
              directory: directory,
              model: model,
              sessionSearchText: $sidebarSessionSearchText,
              openDetail: openConversation,
              openPurge: showPurgeDirectory,
              openFiles: showFilesDirectory,
              setFloatingNewSessionHidden: setSidebarNewSessionHidden
            )
          case .conversation:
            chatScreen
          }
        }
    }
    .overlay(alignment: .bottom) {
      sidebarFloatingControls
    }
    .animation(.smooth(duration: 0.2), value: sidebarNewSessionDirectory)
    .animation(
      .smooth(duration: 0.2),
      value: isSidebarNewSessionHiddenByContent
    )
    .background {
      Rectangle()
        .fill(sidebarBackgroundColor)
        .ignoresSafeArea()
    }
    .directoryActionSheets(
      model: model,
      purgeRequest: $purgeRequest,
      filesRequest: $filesRequest
    )
    .onChange(of: model.conversationPresentationRequest) {
      openConversation()
    }
  }

  private var chatScreen: some View {
    ConversationScreen(
      model: model,
      openSidebar: openSidebar,
      openNewSession: openNewSession
    )
  }

  private var sidebar: some View {
    SessionSidebarView(
      model: model,
      sessionSearchText: $sidebarSessionSearchText,
      openDetail: openConversation,
      openDirectory: openDirectory,
      openPurge: showPurgeDirectory,
      openFiles: showFilesDirectory,
      setFloatingNewSessionHidden: setSidebarNewSessionHidden,
      clearFloatingSearch: clearSidebarSessionSearch
    )
  }

  @ViewBuilder
  private var sidebarFloatingControls: some View {
    if shouldShowSidebarFloatingControls {
      HStack(spacing: 10) {
        SidebarSessionSearchField(
          text: $sidebarSessionSearchText,
          isFocused: $isSidebarSessionSearchFocused,
          placeholder: sidebarSearchPlaceholder
        )

        if let directory = sidebarNewSessionDirectory {
          SidebarNewSessionButton {
            openNewSession(in: directory)
          }
          .transition(.scale.combined(with: .opacity))
        }
      }
      .padding(.horizontal)
      .padding(.bottom, 8)
      .transition(.move(edge: .bottom).combined(with: .opacity))
    }
  }

  private var shouldShowSidebarFloatingControls: Bool {
    isShowingSessionSidebarContent &&
      !isSidebarNewSessionHiddenByContent &&
      (sidebarNewSessionDirectory != nil || !model.sessionSnapshots.isEmpty)
  }

  private var sidebarSearchPlaceholder: String {
    activeSidebarDirectory == nil ? "Search all sessions" : "Search this directory"
  }

  private var sidebarNewSessionDirectory: String? {
    guard isShowingSessionSidebarContent else { return nil }
    return activeSidebarDirectory ?? topmostSidebarDirectory
  }

  private var isShowingSessionSidebarContent: Bool {
    navigationPath.last != .conversation
  }

  private var activeSidebarDirectory: String? {
    for destination in navigationPath.reversed() {
      if case .directory(let directory) = destination {
        return directory
      }
    }
    return nil
  }

  private var topmostSidebarDirectory: String? {
    model.sessionSnapshots.first?.directory ?? model.sidebarDirectories.first
  }

  private func openDirectory(_ directory: String) {
    navigationPath = [.directory(directory)]
  }

  private func openNewSession() {
    openNewSession(in: nil)
  }

  private func openNewSession(in directory: String?) {
    model.beginNewChat(cwd: directory)
    openConversation()
  }

  private func openSidebar() {
    navigationPath = []
  }

  private func openConversation() {
    isSidebarSessionSearchFocused = false
    guard navigationPath.last != .conversation else { return }
    navigationPath.append(.conversation)
  }

  private func showPurgeDirectory(_ directory: String) {
    purgeRequest = DirectoryActionRequest(directory: directory)
  }

  private func showFilesDirectory(_ directory: String) {
    filesRequest = DirectoryActionRequest(directory: directory)
  }

  private func setSidebarNewSessionHidden(_ hidden: Bool) {
    guard isSidebarNewSessionHiddenByContent != hidden else { return }
    withAnimation(.smooth(duration: 0.2)) {
      isSidebarNewSessionHiddenByContent = hidden
    }
  }

  private func clearSidebarSessionSearch() {
    sidebarSessionSearchText = ""
    isSidebarSessionSearchFocused = false
  }
}

private enum SidebarNavigationDestination: Hashable {
  case directory(String)
}

private struct DirectoryActionRequest: Identifiable {
  var directory: String
  var id: String { directory }
}

private struct DirectoryActionSheetsModifier: ViewModifier {
  var model: AppModel
  @Binding var purgeRequest: DirectoryActionRequest?
  @Binding var filesRequest: DirectoryActionRequest?

  func body(content: Content) -> some View {
    content
      .sheet(item: $purgeRequest) { request in
        DirectorySessionPurgeSheet(
          model: model,
          directory: request.directory
        )
      }
      .sheet(item: $filesRequest) { request in
        NavigationStack {
          GitWorkspaceView(model: model, directory: request.directory)
            .navigationTitle("Files")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
              ToolbarItem(placement: .topBarLeading) {
                Button {
                  filesRequest = nil
                } label: {
                  PicoIcon(systemName: "xmark")
                }
                .accessibilityLabel("Close files")
              }
            }
        }
      }
  }
}

private extension View {
  func directoryActionSheets(
    model: AppModel,
    purgeRequest: Binding<DirectoryActionRequest?>,
    filesRequest: Binding<DirectoryActionRequest?>
  ) -> some View {
    modifier(
      DirectoryActionSheetsModifier(
        model: model,
        purgeRequest: purgeRequest,
        filesRequest: filesRequest
      )
    )
  }
}

#Preview {
  WorkspaceView(model: AppModel())
}
