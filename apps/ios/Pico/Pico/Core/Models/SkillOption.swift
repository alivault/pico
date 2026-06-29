import Foundation

public struct SkillOption: Codable, Hashable, Identifiable, Sendable {
  public var id: String { name }

  public var name: String
  public var description: String?
  public var scope: String?
  public var source: String?
}
