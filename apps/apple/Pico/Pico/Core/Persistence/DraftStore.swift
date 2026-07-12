import Foundation

@MainActor
public struct DraftStore {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func readDraft(contextId: String, sessionKey: String?) -> String {
    defaults.string(forKey: key(contextId: contextId, sessionKey: sessionKey)) ?? ""
  }

  public func saveDraft(_ draft: String, contextId: String, sessionKey: String?) {
    defaults.set(draft, forKey: key(contextId: contextId, sessionKey: sessionKey))
  }

  private func key(contextId: String, sessionKey: String?) -> String {
#if os(macOS)
    "pico.macos.draft.\(contextId).\(sessionKey ?? "draft")"
#else
    "pico.ios.draft.\(contextId).\(sessionKey ?? "draft")"
#endif
  }
}
