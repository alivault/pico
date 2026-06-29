import Foundation

public struct AppAlert: Identifiable, Equatable, Sendable {
  public var id = UUID()
  public var title: String
  public var message: String
}
