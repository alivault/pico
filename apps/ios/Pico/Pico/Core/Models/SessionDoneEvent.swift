import Foundation

public struct SessionDoneEvent: Decodable, Hashable, Identifiable, Sendable {
  public var id: String
  public var type: String
  public var sessionKey: String?
  public var sessionId: String?
  public var sessionPath: String?
  public var cwd: String?
  public var title: String?
  public var reason: String
  public var outcome: String?
  public var completedAt: String
}
