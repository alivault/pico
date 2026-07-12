import Foundation

public enum JSONValue: Codable, Hashable, Sendable, CustomStringConvertible {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()

    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      self = .null
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()

    switch self {
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }

  public var description: String {
    switch self {
    case .string(let value):
      value
    case .number(let value):
      value.formatted()
    case .bool(let value):
      value ? "true" : "false"
    case .object:
      compactJSONDescription ?? "{}"
    case .array:
      compactJSONDescription ?? "[]"
    case .null:
      "null"
    }
  }

  public var stringValue: String? {
    guard case .string(let value) = self else { return nil }
    return value
  }

  public var trimmedStringValue: String? {
    let trimmedValue = stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedValue.isEmpty ? nil : trimmedValue
  }

  public var numberValue: Double? {
    switch self {
    case .number(let value):
      value
    case .string(let value):
      Double(value.trimmingCharacters(in: .whitespacesAndNewlines))
    default:
      nil
    }
  }

  public var boolValue: Bool? {
    guard case .bool(let value) = self else { return nil }
    return value
  }

  public var objectValue: [String: JSONValue]? {
    guard case .object(let value) = self else { return nil }
    return value
  }

  public var arrayValue: [JSONValue]? {
    guard case .array(let value) = self else { return nil }
    return value
  }

  public subscript(key: String) -> JSONValue? {
    objectValue?[key]
  }

  public var compactJSONDescription: String? {
    jsonString(prettyPrinted: false)
  }

  public var prettyJSONDescription: String? {
    jsonString(prettyPrinted: true)
  }

  public func jsonString(prettyPrinted: Bool) -> String? {
    let encoder = JSONEncoder()
    if prettyPrinted {
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    } else {
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    }

    guard let data = try? encoder.encode(self) else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
