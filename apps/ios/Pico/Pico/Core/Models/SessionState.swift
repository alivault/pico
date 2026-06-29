import Foundation

public struct SessionState: Hashable, Sendable {
  public var connected: Bool
  public var replaying: Bool
  public var streaming: Bool
  public var compacting: Bool
  public var draft: Bool
  public var items: [ConversationItem]
  public var pendingMessages: [PendingUserMessage]
  public var historyOffset: Int
  public var historyTotalCount: Int
  public var sessionId: String?
  public var sessionKey: String?
  public var sessionName: String?
  public var firstMessage: String
  public var sessionFile: String?
  public var cwd: String?
  public var modified: String?
  public var model: ModelOption?
  public var thinkingLevel: String
  public var availableThinkingLevels: [String]
  public var availableModels: [ModelOption]
  public var availableSkills: [SkillOption]
  public var hideThinkingBlock: Bool
  public var hiddenThinkingPreview: String?
  public var contextUsage: ContextUsage?
  public var uiState: SessionUiState

  public init(
    connected: Bool = false,
    replaying: Bool = true,
    streaming: Bool = false,
    compacting: Bool = false,
    draft: Bool = false,
    items: [ConversationItem] = [],
    pendingMessages: [PendingUserMessage] = [],
    historyOffset: Int = 0,
    historyTotalCount: Int = 0,
    sessionId: String? = nil,
    sessionKey: String? = nil,
    sessionName: String? = nil,
    firstMessage: String = "",
    sessionFile: String? = nil,
    cwd: String? = nil,
    modified: String? = nil,
    model: ModelOption? = nil,
    thinkingLevel: String = "xhigh",
    availableThinkingLevels: [String] = [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ],
    availableModels: [ModelOption] = [],
    availableSkills: [SkillOption] = [],
    hideThinkingBlock: Bool = false,
    hiddenThinkingPreview: String? = nil,
    contextUsage: ContextUsage? = nil,
    uiState: SessionUiState = SessionUiState()
  ) {
    self.connected = connected
    self.replaying = replaying
    self.streaming = streaming
    self.compacting = compacting
    self.draft = draft
    self.items = items
    self.pendingMessages = pendingMessages
    self.historyOffset = historyOffset
    self.historyTotalCount = historyTotalCount
    self.sessionId = sessionId
    self.sessionKey = sessionKey
    self.sessionName = sessionName
    self.firstMessage = firstMessage
    self.sessionFile = sessionFile
    self.cwd = cwd
    self.modified = modified
    self.model = model
    self.thinkingLevel = thinkingLevel
    self.availableThinkingLevels = availableThinkingLevels
    self.availableModels = availableModels
    self.availableSkills = availableSkills
    self.hideThinkingBlock = hideThinkingBlock
    self.hiddenThinkingPreview = hiddenThinkingPreview
    self.contextUsage = contextUsage
    self.uiState = uiState
  }

  public var displayTitle: String {
    if let sessionName, !sessionName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      sessionName
    } else if !firstMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      firstMessage
    } else {
      "New session"
    }
  }

  public mutating func apply(_ sync: StateSyncPayload) {
    let wasConnected = connected

    let carriedLocalItems = Self.localUserItemsCarriedAcrossSessionKeyChange(
      current: self,
      sync: sync
    )
    let carriedFirstMessage = carriedLocalItems.isEmpty ? "" : firstMessage

    if let nextSessionKey = sync.sessionKey, nextSessionKey != sessionKey {
      self = SessionState(
        connected: wasConnected,
        replaying: replaying,
        items: carriedLocalItems,
        firstMessage: carriedFirstMessage
      )
    }

    connected = true
    replaying = false
    let previousItems = items

    if let streaming = sync.streaming {
      self.streaming = streaming
    }
    if let compacting = sync.compacting {
      self.compacting = compacting
    }
    if let draft = sync.draft {
      self.draft = draft
    }

    if let patch = sync.itemsPatch {
      items = Self.mergingLocalUserItems(
        from: previousItems,
        into: Self.applyItemsPatch(to: items, patch: patch)
      )
    } else if let items = sync.items {
      self.items = Self.mergingLocalUserItems(from: previousItems, into: items)
    }
    items = Self.deduplicatingLocalUserItems(items)

    if let pendingUserMessages = sync.pendingUserMessages {
      pendingMessages = pendingUserMessages
    }
    if let historyOffset = sync.historyOffset {
      self.historyOffset = historyOffset
    }
    if let historyTotalCount = sync.historyTotalCount {
      self.historyTotalCount = historyTotalCount
    }
    if let sessionKey = sync.sessionKey {
      self.sessionKey = sessionKey
    }
    if let sessionId = sync.sessionId {
      self.sessionId = sessionId
    }
    if let sessionName = sync.sessionName {
      self.sessionName = sessionName
    }
    if let firstMessage = sync.firstMessage {
      self.firstMessage = firstMessage
    }
    if let sessionFile = sync.sessionFile {
      self.sessionFile = sessionFile
    }
    if let cwd = sync.cwd {
      self.cwd = cwd
    }
    if let modified = sync.modified {
      self.modified = modified
    }
    if let model = sync.model {
      self.model = model
    }
    if let thinkingLevel = sync.thinkingLevel, !thinkingLevel.isEmpty {
      self.thinkingLevel = thinkingLevel
    }
    if let availableThinkingLevels = sync.availableThinkingLevels {
      self.availableThinkingLevels = availableThinkingLevels
    }
    if let availableModels = sync.availableModels {
      self.availableModels = availableModels
    }
    if let availableSkills = sync.availableSkills {
      self.availableSkills = availableSkills
    }
    if let hideThinkingBlock = sync.hideThinkingBlock {
      self.hideThinkingBlock = hideThinkingBlock
    }
    if let contextUsage = sync.contextUsage {
      self.contextUsage = contextUsage
    }
    if let uiState = sync.uiState {
      self.uiState = uiState
    }

    refreshHiddenThinkingPreview()
  }

  public mutating func setHideThinkingBlock(_ hideThinkingBlock: Bool) {
    self.hideThinkingBlock = hideThinkingBlock
    refreshHiddenThinkingPreview()
  }

  public mutating func refreshHiddenThinkingPreview() {
    hiddenThinkingPreview = streaming && hideThinkingBlock
      ? latestCurrentTurnThinkingSummary()
      : nil
  }

  private static func applyItemsPatch(
    to previousItems: [ConversationItem],
    patch: ConversationItemsPatch
  ) -> [ConversationItem] {
    let start = max(0, min(patch.start, previousItems.count))
    let deleteCount = max(0, patch.deleteCount)
    let deleteEnd = min(previousItems.count, start + deleteCount)

    var nextItems = Array(previousItems.prefix(start))
    nextItems.append(contentsOf: patch.items)
    nextItems.append(contentsOf: previousItems.suffix(previousItems.count - deleteEnd))
    return nextItems
  }

  private static func localUserItemsCarriedAcrossSessionKeyChange(
    current: SessionState,
    sync: StateSyncPayload
  ) -> [ConversationItem] {
    guard let nextSessionKey = sync.sessionKey,
          nextSessionKey != current.sessionKey,
          current.sessionId == nil,
          sync.draft == true || sync.sessionId == nil else {
      return []
    }

    return current.items.filter { item in
      guard case .user(let user) = item else { return false }
      return isLocalUserItem(user)
    }
  }

  private static func mergingLocalUserItems(
    from previousItems: [ConversationItem],
    into nextItems: [ConversationItem]
  ) -> [ConversationItem] {
    var mergedItems = nextItems

    for item in previousItems {
      guard case .user(let user) = item,
            isLocalUserItem(user),
            !containsEquivalentUserItem(user, in: mergedItems) else {
        continue
      }

      mergedItems.append(item)
    }

    return mergedItems
  }

  private static func deduplicatingLocalUserItems(
    _ items: [ConversationItem]
  ) -> [ConversationItem] {
    let serverUsers = items.compactMap { item -> UserConversationItem? in
      guard case .user(let user) = item, !isLocalUserItem(user) else {
        return nil
      }
      return user
    }
    guard !serverUsers.isEmpty else { return items }

    return items.filter { item in
      guard case .user(let user) = item,
            isLocalUserItem(user) else {
        return true
      }

      return !serverUsers.contains { serverUser in
        userItemsMatch(user, serverUser)
      }
    }
  }

  private static func containsEquivalentUserItem(
    _ user: UserConversationItem,
    in items: [ConversationItem]
  ) -> Bool {
    items.contains { item in
      guard case .user(let existingUser) = item else { return false }
      return userItemsMatch(user, existingUser)
    }
  }

  private static func userItemsMatch(
    _ left: UserConversationItem,
    _ right: UserConversationItem
  ) -> Bool {
    if let leftText = normalizedUserText(left.text),
       let rightText = normalizedUserText(right.text) {
      return leftText == rightText
    }

    return normalizedUserText(left.text) == nil &&
      normalizedUserText(right.text) == nil &&
      !left.images.isEmpty &&
      left.images == right.images
  }

  private static func isLocalUserItem(_ item: UserConversationItem) -> Bool {
    item.itemKey?.hasPrefix("local:user:") == true ||
      item.renderKey?.hasPrefix("local:user:") == true
  }

  private static func normalizedUserText(_ text: String) -> String? {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedText.isEmpty ? nil : trimmedText
  }

  private func latestCurrentTurnThinkingSummary() -> String? {
    for item in items.reversed() {
      if Self.isCurrentResponseBoundaryUser(item) { return nil }
      guard case .assistant(let assistant) = item else { continue }

      for block in assistant.blocks.reversed() {
        guard case .thinking(let thinking) = block else { continue }
        let summary = Self.thinkingSummaryText(
          thinking,
          allowPlaceholder: streaming
        )
        if !summary.isEmpty { return summary }
      }
    }

    return nil
  }

  private static func isCurrentResponseBoundaryUser(_ item: ConversationItem) -> Bool {
    guard case .user(let user) = item else { return false }
    if user.queued == true { return false }
    if user.streamingBehavior == .followUp || user.streamingBehavior == .steer {
      return false
    }
    return true
  }

  private static func thinkingSummaryText(
    _ block: ThinkingBlock,
    allowPlaceholder: Bool
  ) -> String {
    if let label = meaningfulHiddenThinkingLabel(block.summaryLabel) {
      return truncateThinkingSummary(label)
    }

    let text = primaryThinkingSummaryText(block.text)
    if text.isEmpty { return allowPlaceholder ? "Thinking…" : "" }
    return truncateThinkingSummary(text)
  }

  private static func primaryThinkingSummaryText(_ value: String) -> String {
    let normalized = value
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")

    let paragraphs = normalized.components(separatedBy: "\n\n").compactMap { part in
      let summary = sanitizeThinkingSummaryText(part)
      return summary.isEmpty ? nil : summary
    }

    return paragraphs.first ?? sanitizeThinkingSummaryText(normalized)
  }

  private static func meaningfulHiddenThinkingLabel(_ value: String?) -> String? {
    let label = sanitizeThinkingSummaryText(value ?? "")
    return label.isEmpty || label == "Thinking..." || label == "Thinking"
      ? nil
      : label
  }

  private static func sanitizeThinkingSummaryText(_ value: String) -> String {
    var text = value
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")

    text = replacingMatches(
      in: text,
      pattern: #"!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#,
      with: "$1"
    )
    text = replacingMatches(
      in: text,
      pattern: #"\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#,
      with: "$1"
    )
    text = replacingMatches(in: text, pattern: #"```([\s\S]*?)```"#, with: "$1")
    text = replacingMatches(in: text, pattern: #"`([^`]+)`"#, with: "$1")
    text = replacingMatches(in: text, pattern: #"\*\*([^*]+)\*\*"#, with: "$1")
    text = replacingMatches(in: text, pattern: #"__([^_]+)__"#, with: "$1")
    text = replacingMatches(in: text, pattern: #"\*([^*\n]+)\*"#, with: "$1")
    text = replacingMatches(in: text, pattern: #"_([^_\n]+)_"#, with: "$1")
    text = replacingMatches(in: text, pattern: #"^\s{0,3}#{1,6}\s+"#, with: "")
    text = replacingMatches(in: text, pattern: #"^\s*>\s?"#, with: "")
    text = replacingMatches(in: text, pattern: #"^\s*[-*+]\s+"#, with: "")
    text = replacingMatches(in: text, pattern: #"^\s*\d+\.\s+"#, with: "")
    text = replacingMatches(
      in: text,
      pattern: #"/var/folders/[^\s)]*/pi-clipboard-[A-Za-z0-9-]+\.(?:png|jpe?g|gif|webp)\b"#,
      with: "pasted image"
    )
    text = replacingMatches(in: text, pattern: #"\s+"#, with: " ")

    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func replacingMatches(
    in value: String,
    pattern: String,
    with template: String
  ) -> String {
    guard let regex = try? NSRegularExpression(
      pattern: pattern,
      options: [.anchorsMatchLines]
    ) else {
      return value
    }

    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.stringByReplacingMatches(
      in: value,
      options: [],
      range: range,
      withTemplate: template
    )
  }

  private static func truncateThinkingSummary(_ value: String, maxLength: Int = 140) -> String {
    let normalized = replacingMatches(
      in: value,
      pattern: #"\s+"#,
      with: " "
    )
    .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return "" }
    guard normalized.count > maxLength else { return normalized }

    let endIndex = normalized.index(
      normalized.startIndex,
      offsetBy: max(0, maxLength - 1)
    )
    return String(normalized[..<endIndex])
      .trimmingCharacters(in: .whitespacesAndNewlines) + "…"
  }
}
