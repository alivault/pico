import Foundation

public struct UnknownAssistantBlock: Decodable, Hashable, Identifiable, Sendable {
  public var id: String { blockKey ?? renderKey ?? type ?? "unknown-block" }

  public var type: String?
  public var blockKey: String?
  public var renderKey: String?

  public init(
    type: String? = nil,
    blockKey: String? = nil,
    renderKey: String? = nil
  ) {
    self.type = type
    self.blockKey = blockKey
    self.renderKey = renderKey
  }
}
