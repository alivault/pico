import Foundation

public struct PathCompletionsResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var prefix: String
  public var totalCount: Int
  public var items: [CompletionItem]
}
