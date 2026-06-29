import Foundation

public struct ExtensionErrorEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var error: String?
}
