import SwiftUI
import UIKit

extension Notification.Name {
  static let picoOpenNewChatShortcut = Notification.Name(
    "PicoOpenNewChatShortcut"
  )
  static let picoOpenDeepLink = Notification.Name("PicoOpenDeepLink")
}

@main
struct PicoApp: App {
  @UIApplicationDelegateAdaptor(PicoAppDelegate.self) private var appDelegate
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView(model: model)
    }
  }
}

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
