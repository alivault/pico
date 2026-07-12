import SwiftUI

#if os(iOS)
  import UIKit
#endif

extension Notification.Name {
  static let picoOpenNewChatShortcut = Notification.Name(
    "PicoOpenNewChatShortcut"
  )
  static let picoOpenDeepLink = Notification.Name("PicoOpenDeepLink")
  static let picoAddDirectory = Notification.Name("PicoAddDirectory")
}

@main
struct PicoApp: App {
  #if os(iOS)
    @UIApplicationDelegateAdaptor(PicoAppDelegate.self) private var appDelegate
  #endif
  @State private var model = AppModel()

  var body: some Scene {
    #if os(macOS)
      WindowGroup {
        RootView(model: model)
          .frame(minWidth: 900, minHeight: 600)
      }
      .defaultSize(CGSize(width: 1280, height: 820))
      .commands {
        CommandGroup(replacing: .newItem) {
          Button("New Chat", picoSystemImage: "square.and.pencil") {
            model.beginNewChat()
          }
          .keyboardShortcut("n")

          Divider()

          Button("Add Directory…", picoSystemImage: "folder.badge.plus") {
            NotificationCenter.default.post(name: .picoAddDirectory, object: nil)
          }
          .disabled(!model.isConnected)
        }
        SidebarCommands()
        ToolbarCommands()
      }

      Settings {
        SettingsView(model: model)
          .frame(minWidth: 520, minHeight: 420)
      }
    #else
      WindowGroup {
        RootView(model: model)
      }
    #endif
  }
}

#if os(iOS)
  private enum PicoQuickAction {
    static let newChatType = "com.alivault.pico.new-chat"
  }

  private final class PicoAppDelegate: NSObject, UIApplicationDelegate {
    func application(
      _ application: UIApplication,
      configurationForConnecting connectingSceneSession: UISceneSession,
      options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
      let configuration = UISceneConfiguration(
        name: "Default Configuration",
        sessionRole: connectingSceneSession.role
      )
      configuration.delegateClass = PicoSceneDelegate.self
      return configuration
    }
  }

  private final class PicoSceneDelegate: NSObject, UIWindowSceneDelegate {
    private var pendingShortcutItem: UIApplicationShortcutItem?
    private var pendingDeepLinkURLs: [URL] = []

    func scene(
      _ scene: UIScene,
      willConnectTo session: UISceneSession,
      options connectionOptions: UIScene.ConnectionOptions
    ) {
      pendingShortcutItem = connectionOptions.shortcutItem
      pendingDeepLinkURLs = connectionOptions.urlContexts.map(\.url)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
      if let shortcutItem = pendingShortcutItem {
        pendingShortcutItem = nil
        _ = handle(shortcutItem)
      }

      guard !pendingDeepLinkURLs.isEmpty else { return }

      let urls = pendingDeepLinkURLs
      pendingDeepLinkURLs = []
      for url in urls {
        postDeepLink(url)
      }
    }

    func scene(
      _ scene: UIScene,
      openURLContexts URLContexts: Set<UIOpenURLContext>
    ) {
      for context in URLContexts {
        postDeepLink(context.url)
      }
    }

    func windowScene(
      _ windowScene: UIWindowScene,
      performActionFor shortcutItem: UIApplicationShortcutItem,
      completionHandler: @escaping (Bool) -> Void
    ) {
      completionHandler(handle(shortcutItem))
    }

    private func handle(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
      guard shortcutItem.type == PicoQuickAction.newChatType else { return false }

      NotificationCenter.default.post(name: .picoOpenNewChatShortcut, object: nil)
      return true
    }

    private func postDeepLink(_ url: URL) {
      NotificationCenter.default.post(name: .picoOpenDeepLink, object: url)
    }
  }
#endif
