import Foundation

public struct PromptRequestBody: Encodable, Sendable {
  public var message: String
  public var images: [PromptImage]
  public var streamingBehavior: StreamingBehavior?
  public var pendingId: String?
  public var clientRequestId: String?
  public var thinkingLevel: String?
  public var draftOwnerKey: String?
  public var draftCwd: String?
}
