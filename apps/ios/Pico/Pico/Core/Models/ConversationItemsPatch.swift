import Foundation

public struct ConversationItemsPatch: Decodable, Hashable, Sendable {
  public var previousLength: Int
  public var start: Int
  public var deleteCount: Int
  public var items: [ConversationItem]
}
