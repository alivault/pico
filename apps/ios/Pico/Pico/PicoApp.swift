import SwiftUI
import UIKit

extension Notification.Name {
  static let picoOpenNewChatShortcut = Notification.Name("PicoOpenNewChatShortcut")
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

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    pendingShortcutItem = connectionOptions.shortcutItem
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    guard let shortcutItem = pendingShortcutItem else { return }

    pendingShortcutItem = nil
    _ = handle(shortcutItem)
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
}
