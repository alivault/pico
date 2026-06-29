import Foundation

public struct PicoStreamEvent: Sendable {
  public var id: String?
  public var event: PicoServerEvent
}
