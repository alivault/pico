import Foundation

public struct AutoSessionNamingErrorEvent: Decodable, Hashable, Sendable {
  public var type: String
  public var sessionId: String?
  public var cwd: String?
  public var promptPreview: String?
  public var imageCount: Int?
  public var heuristicReason: String?
  public var refinementReason: String?
}
