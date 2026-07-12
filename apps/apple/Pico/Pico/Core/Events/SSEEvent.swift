import Foundation

public struct SSEEvent: Hashable, Sendable {
  public var id: String?
  public var event: String?
  public var data: String
}
