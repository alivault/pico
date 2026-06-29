import Foundation

public struct SessionListEntry: Codable, Hashable, Identifiable, Sendable {
  public var id: String { path ?? self.sessionId ?? title }

  public var path: String?
  public var sessionId: String?
  public var cwd: String?
  public var name: String?
  public var title: String
  public var modified: String?
  public var lastUserMessageAt: String?
  public var lastMessageAt: String?
  public var lastMessagePreview: String?
  public var messageCount: Int?
  public var contextUsage: ContextUsage?
  public var streaming: Bool?
  public var unread: Bool?
  public var optimistic: Bool?

  private enum CodingKeys: String, CodingKey {
    case path
    case sessionId = "id"
    case cwd
    case name
    case title
    case modified
    case lastUserMessageAt
    case lastMessageAt
    case lastMessagePreview
    case messageCount
    case contextUsage
    case streaming
    case unread
    case optimistic
  }

  public var selectionId: String? {
    sessionId ?? path
  }

  public init(
    path: String? = nil,
    sessionId: String? = nil,
    cwd: String? = nil,
    name: String? = nil,
    title: String,
    modified: String? = nil,
    lastUserMessageAt: String? = nil,
    lastMessageAt: String? = nil,
    lastMessagePreview: String? = nil,
    messageCount: Int? = nil,
    contextUsage: ContextUsage? = nil,
    streaming: Bool? = nil,
    unread: Bool? = nil,
    optimistic: Bool? = nil
  ) {
    self.path = path
    self.sessionId = sessionId
    self.cwd = cwd
    self.name = name
    self.title = title
    self.modified = modified
    self.lastUserMessageAt = lastUserMessageAt
    self.lastMessageAt = lastMessageAt
    self.lastMessagePreview = lastMessagePreview
    self.messageCount = messageCount
    self.contextUsage = contextUsage
    self.streaming = streaming
    self.unread = unread
    self.optimistic = optimistic
  }
}
