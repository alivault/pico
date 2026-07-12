import Foundation

public struct SessionStatusEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var sessionKey: String?
  public var sessionId: String?
  public var sessionPath: String?
  public var streaming: Bool?
  public var unread: Bool?
}
