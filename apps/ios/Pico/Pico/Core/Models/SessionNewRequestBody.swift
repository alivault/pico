import Foundation

public struct SessionNewRequestBody: Encodable, Sendable {
  public var cwd: String?
}
