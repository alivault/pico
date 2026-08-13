import Foundation

public struct ConversationDeltaEvent: Decodable, Sendable {
  public var type: String
  public var sessionId: String
  public var operations: [ConversationDeltaOperation]
}

public enum ConversationDeltaOperation: Decodable, Sendable {
  case replaceItem(AssistantConversationItem)
  case appendBlock(
    contentIndex: Int,
    blockKey: String,
    blockType: String,
    delta: String
  )
  case replaceBlock(contentIndex: Int, block: AssistantBlock)
  case updateTool(
    callId: String,
    output: String?,
    details: JSONValue?,
    isError: Bool?,
    running: Bool
  )
  case unknown(String)

  private enum CodingKeys: String, CodingKey {
    case op
    case item
    case contentIndex
    case blockKey
    case blockType
    case delta
    case block
    case callId
    case output
    case details
    case isError
    case running
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let operation = try container.decodeIfPresent(String.self, forKey: .op) ?? "missing"
    switch operation {
    case "replaceItem":
      let item = try container.decode(ConversationItem.self, forKey: .item)
      guard case .assistant(let assistant) = item else {
        self = .unknown(operation)
        return
      }
      self = .replaceItem(assistant)
    case "appendBlock":
      self = .appendBlock(
        contentIndex: try container.decode(Int.self, forKey: .contentIndex),
        blockKey: try container.decode(String.self, forKey: .blockKey),
        blockType: try container.decode(String.self, forKey: .blockType),
        delta: try container.decode(String.self, forKey: .delta)
      )
    case "replaceBlock":
      self = .replaceBlock(
        contentIndex: try container.decode(Int.self, forKey: .contentIndex),
        block: try container.decode(AssistantBlock.self, forKey: .block)
      )
    case "updateTool":
      self = .updateTool(
        callId: try container.decode(String.self, forKey: .callId),
        output: try container.decodeIfPresent(String.self, forKey: .output),
        details: try container.decodeIfPresent(JSONValue.self, forKey: .details),
        isError: try container.decodeIfPresent(Bool.self, forKey: .isError),
        running: try container.decode(Bool.self, forKey: .running)
      )
    default:
      self = .unknown(operation)
    }
  }
}
