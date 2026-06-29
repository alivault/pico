import Foundation

public struct UiRequest: Decodable, Hashable, Identifiable, Sendable {
  public var id: String
  public var type: String?
  public var method: String
  public var title: String?
  public var message: String?
  public var placeholder: String?
  public var prefill: String?
  public var authUrl: String?
  public var authManualAllowed: Bool?
  public var allowEmpty: Bool?
  public var notifyType: String?
  public var options: [UiRequestOption]?
  public var timeout: Double?
}
