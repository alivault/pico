import Foundation

public struct ContextUsage: Codable, Hashable, Sendable {
  public var tokens: Double?
  public var contextWindow: Double?
  public var percent: Double?

  public var displayPercent: String? {
    guard let percent else { return nil }
    return percent.formatted(.number.precision(.fractionLength(0...1))) + "%"
  }
}
