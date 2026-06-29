import Foundation

public struct CompletionItem: Decodable, Hashable, Identifiable, Sendable {
  public var id: String { value }

  public var value: String
  public var label: String
  public var description: String?
  public var isDirectory: Bool

  public var isHidden: Bool {
    let labelName = label.trimmingCharacters(
      in: CharacterSet(charactersIn: "/")
    )
    if labelName.hasPrefix(".") { return true }

    let valueName = value
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      .split(separator: "/")
      .last
    return valueName?.hasPrefix(".") == true
  }
}
