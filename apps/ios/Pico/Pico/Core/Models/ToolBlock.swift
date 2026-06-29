import Foundation

public struct ToolBlock: Decodable, Hashable, Identifiable, Sendable {
  public var id: String {
    blockKey ?? renderKey ?? callId ?? "tool:\(name ?? "unknown"):\(output.hashValue)"
  }

  public var type: String?
  public var blockKey: String?
  public var renderKey: String?
  public var callId: String?
  public var name: String?
  public var args: JSONValue?
  public var category: String?
  public var output: String
  public var details: JSONValue?
  public var isError: Bool
  public var running: Bool

  private enum CodingKeys: String, CodingKey {
    case type
    case blockKey
    case renderKey
    case callId
    case name
    case args
    case category
    case output
    case details
    case isError
    case running
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decodeIfPresent(String.self, forKey: .type)
    blockKey = try container.decodeIfPresent(String.self, forKey: .blockKey)
    renderKey = try container.decodeIfPresent(String.self, forKey: .renderKey)
    callId = try container.decodeIfPresent(String.self, forKey: .callId)
    name = try container.decodeIfPresent(String.self, forKey: .name)
    args = try container.decodeIfPresent(JSONValue.self, forKey: .args)
    category = try container.decodeIfPresent(String.self, forKey: .category)
    output = try container.decodeIfPresent(String.self, forKey: .output) ?? ""
    details = try container.decodeIfPresent(JSONValue.self, forKey: .details)
    isError = try container.decodeIfPresent(Bool.self, forKey: .isError) ?? false
    running = try container.decodeIfPresent(Bool.self, forKey: .running) ?? false
  }

  public init(
    type: String? = "tool",
    blockKey: String? = nil,
    renderKey: String? = nil,
    callId: String? = nil,
    name: String? = nil,
    args: JSONValue? = nil,
    category: String? = nil,
    output: String,
    details: JSONValue? = nil,
    isError: Bool = false,
    running: Bool = false
  ) {
    self.type = type
    self.blockKey = blockKey
    self.renderKey = renderKey
    self.callId = callId
    self.name = name
    self.args = args
    self.category = category
    self.output = output
    self.details = details
    self.isError = isError
    self.running = running
  }
}
