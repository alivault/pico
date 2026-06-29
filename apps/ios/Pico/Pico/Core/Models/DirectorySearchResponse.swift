import Foundation

public struct DirectorySearchResponse: Decodable, Hashable, Sendable {
  public var ok: Bool
  public var query: String
  public var totalCount: Int
  public var items: [CompletionItem]
}
