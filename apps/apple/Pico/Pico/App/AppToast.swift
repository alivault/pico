import Foundation

public struct AppToast: Identifiable, Sendable {
  public var id = UUID()
  public var title: String
  public var message: String?
  public var style: AppToastStyle
  public var duration: Duration

  public init(
    title: String,
    message: String? = nil,
    style: AppToastStyle = .info,
    duration: Duration = .seconds(4)
  ) {
    self.title = title
    self.message = message
    self.style = style
    self.duration = duration
  }
}

public enum AppToastStyle: Sendable {
  case info
  case success
  case warning
  case error
}
