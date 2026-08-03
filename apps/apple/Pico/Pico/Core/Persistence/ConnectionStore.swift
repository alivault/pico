import Foundation
import Observation

@MainActor
@Observable
public final class ConnectionStore {
  private struct ServerProfile: Codable {
    var contextId: String
    var lastEventId: String?
    var sidebarDirectories: [String]
  }

  private let defaults: UserDefaults
  private var serverProfiles: [String: ServerProfile]

  public var serverURLText: String
  public private(set) var contextId: String
  public var lastEventId: String?
  public var hasSavedServerURL: Bool
  public private(set) var sidebarDirectories: [String]
  public private(set) var hideToolBlocks: Bool

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let savedServerURL = defaults.string(forKey: Self.storageKey("serverURL"))
    let decodedProfiles = Self.decodeServerProfiles(
      defaults.data(forKey: Self.storageKey("serverProfiles"))
    )
    let legacyContextId = defaults.string(forKey: Self.storageKey("contextId")) ??
      Self.makeContextId()
    let legacyLastEventId = defaults.string(forKey: Self.storageKey("lastEventId"))
    let legacySidebarDirectories = Self.decodeStringArray(
      defaults.data(forKey: Self.storageKey("sidebarDirectories"))
    )
    let savedProfile = savedServerURL.flatMap { decodedProfiles[$0] }
    let initialProfile = savedProfile ?? ServerProfile(
      contextId: legacyContextId,
      lastEventId: legacyLastEventId,
      sidebarDirectories: legacySidebarDirectories
    )

    serverProfiles = decodedProfiles
    hasSavedServerURL = savedServerURL != nil
    serverURLText = savedServerURL ?? "localhost"
    contextId = initialProfile.contextId
    lastEventId = initialProfile.lastEventId
    sidebarDirectories = initialProfile.sidebarDirectories
    hideToolBlocks = defaults.bool(forKey: Self.storageKey("hideToolBlocks"))
    if let savedServerURL, savedProfile == nil {
      serverProfiles[savedServerURL] = currentProfile
      saveServerProfiles()
    }
    saveLegacyCurrentProfile()
  }

  public func saveServerURL(_ url: URL) {
    let newServerURL = url.absoluteString
    guard !hasSavedServerURL || serverURLText != newServerURL else {
      saveLegacyCurrentProfile()
      return
    }

    let isFirstServer = !hasSavedServerURL
    persistCurrentProfile()
    serverURLText = newServerURL
    hasSavedServerURL = true
    if !isFirstServer {
      let profile = serverProfiles[newServerURL] ?? ServerProfile(
        contextId: Self.makeContextId(),
        lastEventId: nil,
        sidebarDirectories: []
      )
      contextId = profile.contextId
      lastEventId = profile.lastEventId
      sidebarDirectories = profile.sidebarDirectories
    }
    persistCurrentProfile()
    defaults.set(serverURLText, forKey: Self.storageKey("serverURL"))
  }

  public func saveLastEventId(_ id: String?) {
    lastEventId = id
    persistCurrentProfile()
  }

  public func setHideToolBlocks(_ hidden: Bool) {
    hideToolBlocks = hidden
    defaults.set(hidden, forKey: Self.storageKey("hideToolBlocks"))
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
    persistCurrentProfile()
  }

  private var currentProfile: ServerProfile {
    ServerProfile(
      contextId: contextId,
      lastEventId: lastEventId,
      sidebarDirectories: sidebarDirectories
    )
  }

  private func persistCurrentProfile() {
    guard hasSavedServerURL else {
      saveLegacyCurrentProfile()
      return
    }
    serverProfiles[serverURLText] = currentProfile
    saveServerProfiles()
    saveLegacyCurrentProfile()
  }

  private func saveServerProfiles() {
    guard let data = try? JSONEncoder().encode(serverProfiles) else { return }
    defaults.set(data, forKey: Self.storageKey("serverProfiles"))
  }

  private func saveLegacyCurrentProfile() {
    defaults.set(contextId, forKey: Self.storageKey("contextId"))
    defaults.set(lastEventId, forKey: Self.storageKey("lastEventId"))
    guard let data = try? JSONEncoder().encode(sidebarDirectories) else { return }
    defaults.set(data, forKey: Self.storageKey("sidebarDirectories"))
  }

  private static func decodeServerProfiles(_ data: Data?) -> [String: ServerProfile] {
    guard let data,
          let profiles = try? JSONDecoder().decode(
            [String: ServerProfile].self,
            from: data
          ) else {
      return [:]
    }
    return profiles
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

  private static func storageKey(_ name: String) -> String {
#if os(macOS)
    "pico.macos.\(name)"
#else
    "pico.ios.\(name)"
#endif
  }

  private static func makeContextId() -> String {
#if os(macOS)
    "macos-" + UUID().uuidString.lowercased()
#else
    "ios-" + UUID().uuidString.lowercased()
#endif
  }
}
