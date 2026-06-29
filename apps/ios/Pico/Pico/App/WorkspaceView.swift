import SwiftUI
import UIKit

private let sidebarBackgroundColor = Color(uiColor: .systemGroupedBackground)

struct WorkspaceView: View {
  @Bindable var model: AppModel
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @State private var columnVisibility: NavigationSplitViewVisibility = .detailOnly

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
      openNewSession: openNewSession,
      openConversation: openConversation
    )
  }

  private func openNewSession() {
    model.beginNewChat()
    columnVisibility = .detailOnly
  }

  private func openConversation() {
    columnVisibility = .detailOnly
  }

  private func openSidebar() {
    columnVisibility = .all
  }
}

private struct CompactWorkspaceView: View {
  @Bindable var model: AppModel
  @State private var navigationPath: [CompactWorkspaceDestination] = [.conversation]

  private enum CompactWorkspaceDestination: Hashable {
    case conversation
  }

  var body: some View {
    NavigationStack(path: $navigationPath) {
      sidebar
        .navigationDestination(for: CompactWorkspaceDestination.self) { destination in
          switch destination {
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
      openNewSession: openNewSession,
      openConversation: openConversation
    )
  }

  private func openNewSession() {
    model.beginNewChat()
    openConversation()
  }

  private func openSidebar() {
    navigationPath = []
  }

  private func openConversation() {
    navigationPath = [.conversation]
  }
}

#Preview {
  WorkspaceView(model: AppModel())
}
