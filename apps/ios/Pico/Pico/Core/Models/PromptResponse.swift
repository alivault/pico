import Foundation

public struct PromptResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var queued: Bool
  public var pendingId: String?
  public var canceled: Bool?
}
