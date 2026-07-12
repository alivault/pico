import Foundation

public struct PromptImage: Codable, Hashable, Identifiable, Sendable {
  public var id: String { "\(mimeType):\(data.hashValue)" }

  public var type: String?
  public var mimeType: String
  public var data: String
  public var previewUrl: String?

  private enum CodingKeys: String, CodingKey {
    case type
    case mimeType
    case data
    case previewUrl
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decodeIfPresent(String.self, forKey: .type)
    mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType) ?? ""
    data = try container.decodeIfPresent(String.self, forKey: .data) ?? ""
    previewUrl = try container.decodeIfPresent(String.self, forKey: .previewUrl)
  }

  public init(
    type: String? = "image",
    mimeType: String,
    data: String,
    previewUrl: String? = nil
  ) {
    self.type = type
    self.mimeType = mimeType
    self.data = data
    self.previewUrl = previewUrl
  }
}
