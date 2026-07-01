import Foundation

public struct ForkableMessage: Decodable, Hashable, Identifiable, Sendable {
  public var id: String { entryId }
  public var entryId: String
  public var text: String
}

public struct ForkableMessagesResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var messages: [ForkableMessage]
}

public struct ForkSessionResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var cancelled: Bool?
  public var draft: Bool?
  public var sessionKey: String?
  public var sessionId: String?
  public var sessionFile: String?
}
