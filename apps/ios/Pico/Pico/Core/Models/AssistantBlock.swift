import Foundation

public enum AssistantBlock: Decodable, Hashable, Identifiable, Sendable {
  case text(TextBlock)
  case thinking(ThinkingBlock)
  case tool(ToolBlock)
  case compaction(CompactionBlock)
  case unknown(UnknownAssistantBlock)

  public var id: String {
    switch self {
    case .text(let block):
      block.id
    case .thinking(let block):
      block.id
    case .tool(let block):
      block.id
    case .compaction(let block):
      block.id
    case .unknown(let block):
      block.id
    }
  }

  private enum CodingKeys: String, CodingKey {
    case type
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decodeIfPresent(String.self, forKey: .type)

    switch type {
    case "text":
      self = (try? .text(TextBlock(from: decoder))) ?? .unknown(Self.unknownBlock(from: decoder))
    case "thinking":
      self = (try? .thinking(ThinkingBlock(from: decoder))) ?? .unknown(Self.unknownBlock(from: decoder))
    case "tool":
      self = (try? .tool(ToolBlock(from: decoder))) ?? .unknown(Self.unknownBlock(from: decoder))
    case "compaction":
      self = (try? .compaction(CompactionBlock(from: decoder))) ?? .unknown(Self.unknownBlock(from: decoder))
    default:
      self = .unknown(Self.unknownBlock(from: decoder))
    }
  }

  private static func unknownBlock(from decoder: Decoder) -> UnknownAssistantBlock {
    (try? UnknownAssistantBlock(from: decoder)) ?? UnknownAssistantBlock()
  }
}
