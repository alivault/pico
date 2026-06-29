import Foundation

public enum UiRequestOption: Decodable, Hashable, Sendable {
  case string(String)
  case object(value: String, label: String?)

  public var value: String {
    switch self {
    case .string(let value), .object(let value, _):
      value
    }
  }

  public var label: String {
    switch self {
    case .string(let value):
      value
    case .object(let value, let label):
      label ?? value
    }
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()

    if let value = try? container.decode(String.self) {
      self = .string(value)
      return
    }

    let object = try container.decode(UiRequestOptionObject.self)
    self = .object(value: object.value, label: object.label)
  }
}
