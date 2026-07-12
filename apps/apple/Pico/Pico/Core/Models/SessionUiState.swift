import Foundation

public struct SessionUiState: Codable, Hashable, Sendable {
  public var statuses: [String: String]
  public var title: String?
  public var editorText: String?
  public var workingMessage: String?

  public init(
    statuses: [String: String] = [:],
    title: String? = nil,
    editorText: String? = nil,
    workingMessage: String? = nil
  ) {
    self.statuses = statuses
    self.title = title
    self.editorText = editorText
    self.workingMessage = workingMessage
  }
}
