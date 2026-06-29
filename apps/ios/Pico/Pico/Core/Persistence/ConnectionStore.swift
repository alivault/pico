import Foundation
import Observation

@MainActor
@Observable
public final class ConnectionStore {
  private let defaults: UserDefaults

  public var serverURLText: String
  public var contextId: String
  public var lastEventId: String?
  public var hasSavedServerURL: Bool
  public private(set) var sidebarDirectories: [String]
  public private(set) var hideToolBlocks: Bool

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let savedServerURL = defaults.string(forKey: "pico.ios.serverURL")
    hasSavedServerURL = savedServerURL != nil
    serverURLText = savedServerURL ?? "http://localhost:3141"
    contextId = defaults.string(forKey: "pico.ios.contextId") ?? Self.makeContextId()
    lastEventId = defaults.string(forKey: "pico.ios.lastEventId")
    sidebarDirectories = Self.decodeStringArray(
      defaults.data(forKey: "pico.ios.sidebarDirectories")
    )
    hideToolBlocks = defaults.bool(forKey: "pico.ios.hideToolBlocks")
    defaults.set(contextId, forKey: "pico.ios.contextId")
  }

  public func saveServerURL(_ url: URL) {
    serverURLText = url.absoluteString
    hasSavedServerURL = true
    defaults.set(serverURLText, forKey: "pico.ios.serverURL")
  }

  public func saveLastEventId(_ id: String?) {
    lastEventId = id
    defaults.set(id, forKey: "pico.ios.lastEventId")
  }

  public func setHideToolBlocks(_ hidden: Bool) {
    hideToolBlocks = hidden
    defaults.set(hidden, forKey: "pico.ios.hideToolBlocks")
  }

  public func rememberSidebarDirectory(_ directory: String) {
    let normalizedDirectory = directory.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedDirectory.isEmpty else { return }

    var directories = sidebarDirectories.filter { $0 != normalizedDirectory }
    directories.insert(normalizedDirectory, at: 0)
    sidebarDirectories = directories
    saveSidebarDirectories()
  }

  public func removeSidebarDirectory(_ directory: String) {
    removeSidebarDirectories([directory])
  }

  public func removeSidebarDirectories(_ directories: [String]) {
    let normalizedDirectories = Set(
      directories.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    )
    guard !normalizedDirectories.isEmpty else { return }

    sidebarDirectories = sidebarDirectories.filter {
      !normalizedDirectories.contains($0)
    }
    saveSidebarDirectories()
  }

  public func setSidebarDirectories(_ directories: [String]) {
    sidebarDirectories = Self.normalizedStringArray(directories)
    saveSidebarDirectories()
  }

  public func moveSidebarDirectories(
    fromOffsets source: IndexSet,
    toOffset destination: Int
  ) {
    guard !source.isEmpty else { return }

    var movingDirectories: [String] = []
    var remainingDirectories: [String] = []
    for (index, directory) in sidebarDirectories.enumerated() {
      if source.contains(index) {
        movingDirectories.append(directory)
      } else {
        remainingDirectories.append(directory)
      }
    }

    guard !movingDirectories.isEmpty else { return }

    let removedBeforeDestination = source.filter { $0 < destination }.count
    let insertionIndex = max(
      0,
      min(destination - removedBeforeDestination, remainingDirectories.count)
    )
    remainingDirectories.insert(contentsOf: movingDirectories, at: insertionIndex)
    sidebarDirectories = remainingDirectories
    saveSidebarDirectories()
  }

  public func removeAllSidebarDirectories() {
    sidebarDirectories = []
    saveSidebarDirectories()
  }

  private func saveSidebarDirectories() {
    guard let data = try? JSONEncoder().encode(sidebarDirectories) else { return }
    defaults.set(data, forKey: "pico.ios.sidebarDirectories")
  }

  private static func decodeStringArray(_ data: Data?) -> [String] {
    guard let data,
          let values = try? JSONDecoder().decode([String].self, from: data) else {
      return []
    }

    return normalizedStringArray(values)
  }

  private static func normalizedStringArray(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.compactMap { value in
      let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalizedValue.isEmpty, !seen.contains(normalizedValue) else {
        return nil
      }

      seen.insert(normalizedValue)
      return normalizedValue
    }
  }

  private static func makeContextId() -> String {
    "ios-" + UUID().uuidString.lowercased()
  }
}
