#if os(iOS)
  import SwiftUI
  import UIKit

  typealias PlatformWorkspaceView = IOSWorkspaceView

  private let sidebarBackgroundColor = Color(uiColor: .systemGroupedBackground)

  struct IOSWorkspaceView: View {
    @Bindable var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var sidebarPath: [SidebarNavigationDestination] = []
    @State private var purgeRequest: DirectoryActionRequest?
    @State private var filesRequest: DirectoryActionRequest?
    @State private var isSidebarNewSessionHiddenByContent = false
    @State private var sidebarSessionSearchText = ""
    @State private var isSidebarSessionSearchPresented = false

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
        .sidebarSearchToolbar(
          text: $sidebarSessionSearchText,
          isPresented: $isSidebarSessionSearchPresented,
          prompt: "Search all sessions",
          newSessionDirectory: topmostSidebarDirectory,
          isVisible: shouldShowSidebarFloatingControls,
          placesSearchInBottomBar: false,
          openNewSession: openNewSession(in:)
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
            .sidebarSearchToolbar(
              text: $sidebarSessionSearchText,
              isPresented: $isSidebarSessionSearchPresented,
              prompt: "Search this directory",
              newSessionDirectory: directory,
              isVisible: shouldShowSidebarFloatingControls,
              placesSearchInBottomBar: false,
              openNewSession: openNewSession(in:)
            )
          }
        }
      }
    }

    private var shouldShowSidebarFloatingControls: Bool {
      !isSidebarNewSessionHiddenByContent
        && (activeSidebarDirectory != nil || topmostSidebarDirectory != nil)
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
      isSidebarSessionSearchPresented = false
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
      isSidebarSessionSearchPresented = false
    }
  }

  private struct CompactWorkspaceView: View {
    @Bindable var model: AppModel
    @State private var navigationPath: [CompactWorkspaceDestination] = []
    @State private var purgeRequest: DirectoryActionRequest?
    @State private var filesRequest: DirectoryActionRequest?
    @State private var isSidebarNewSessionHiddenByContent = false
    @State private var sidebarSessionSearchText = ""
    @State private var isSidebarSessionSearchPresented = false

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
              .sidebarSearchToolbar(
                text: $sidebarSessionSearchText,
                isPresented: $isSidebarSessionSearchPresented,
                prompt: "Search this directory",
                newSessionDirectory: directory,
                isVisible: shouldShowSidebarFloatingControls,
                placesSearchInBottomBar: placesSearchInBottomBar,
                openNewSession: openNewSession(in:)
              )
            case .conversation:
              chatScreen
            }
          }
      }
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
      .sidebarSearchToolbar(
        text: $sidebarSessionSearchText,
        isPresented: $isSidebarSessionSearchPresented,
        prompt: "Search all sessions",
        newSessionDirectory: topmostSidebarDirectory,
        isVisible: shouldShowSidebarFloatingControls,
        placesSearchInBottomBar: placesSearchInBottomBar,
        openNewSession: openNewSession(in:)
      )
    }

    private var shouldShowSidebarFloatingControls: Bool {
      isShowingSessionSidebarContent && !isSidebarNewSessionHiddenByContent
        && (activeSidebarDirectory != nil || topmostSidebarDirectory != nil)
    }

    private var placesSearchInBottomBar: Bool {
      UIDevice.current.userInterfaceIdiom == .phone
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
      isSidebarSessionSearchPresented = false
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
      isSidebarSessionSearchPresented = false
    }
  }

  private struct SidebarSearchToolbarModifier: ViewModifier {
    @Binding var text: String
    @Binding var isPresented: Bool
    var prompt: String
    var newSessionDirectory: String?
    var isVisible: Bool
    var placesSearchInBottomBar: Bool
    var openNewSession: (String?) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
      if isVisible {
        content
          .searchable(
            text: $text,
            isPresented: $isPresented,
            prompt: Text(prompt)
          )
          .toolbar {
            if placesSearchInBottomBar {
              DefaultToolbarItem(kind: .search, placement: .bottomBar)
              ToolbarSpacer(placement: .bottomBar)
            }

            if let newSessionDirectory {
              ToolbarItem(placement: newSessionToolbarPlacement) {
                SidebarNewSessionButton {
                  openNewSession(newSessionDirectory)
                }
              }
            }
          }
      } else {
        content
      }
    }

    private var newSessionToolbarPlacement: ToolbarItemPlacement {
      placesSearchInBottomBar ? .bottomBar : .picoTrailing
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
              .picoNavigationTitleDisplayMode(.inline)
              .toolbar {
                ToolbarItem(placement: .picoLeading) {
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

  extension View {
    fileprivate func sidebarSearchToolbar(
      text: Binding<String>,
      isPresented: Binding<Bool>,
      prompt: String,
      newSessionDirectory: String?,
      isVisible: Bool,
      placesSearchInBottomBar: Bool,
      openNewSession: @escaping (String?) -> Void
    ) -> some View {
      modifier(
        SidebarSearchToolbarModifier(
          text: text,
          isPresented: isPresented,
          prompt: prompt,
          newSessionDirectory: newSessionDirectory,
          isVisible: isVisible,
          placesSearchInBottomBar: placesSearchInBottomBar,
          openNewSession: openNewSession
        )
      )
    }

    fileprivate func directoryActionSheets(
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

#endif
