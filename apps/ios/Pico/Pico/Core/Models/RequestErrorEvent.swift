import Foundation

public struct RequestErrorEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var scope: String?
  public var message: String?
  public var error: String?
}
