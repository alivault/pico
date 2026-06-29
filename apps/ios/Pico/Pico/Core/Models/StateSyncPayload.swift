import Foundation

public struct StateSyncPayload: Decodable, Sendable {
  public var type: String
  public var activationRevision: Int?
  public var sessionKey: String?
  public var items: [ConversationItem]?
  public var itemsPatch: ConversationItemsPatch?
  public var pendingUserMessages: [PendingUserMessage]?
  public var draft: Bool?
  public var streaming: Bool?
  public var compacting: Bool?
  public var historyOffset: Int?
  public var historyTotalCount: Int?
  public var contextUsage: ContextUsage?
  public var hideThinkingBlock: Bool?
  public var model: ModelOption?
  public var thinkingLevel: String?
  public var availableThinkingLevels: [String]?
  public var availableModels: [ModelOption]?
  public var availableSkills: [SkillOption]?
  public var sessionId: String?
  public var sessionFile: String?
  public var sessionName: String?
  public var firstMessage: String?
  public var cwd: String?
  public var modified: String?
  public var uiState: SessionUiState?
}
