import Foundation

public struct UserMessageEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var message: String?
  public var images: [PromptImage]?
  public var queued: Bool?
}
