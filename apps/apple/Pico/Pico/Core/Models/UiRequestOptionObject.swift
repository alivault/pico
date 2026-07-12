import Foundation

public struct UiRequestOptionObject: Decodable, Hashable, Sendable {
  public var value: String
  public var label: String?
}
