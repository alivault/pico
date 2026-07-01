import Foundation

struct CodeHighlightResult: Equatable, Sendable {
  var requestID: String
  var language: String
  var html: String?
  var skipped: Bool
  var unsupported: Bool
  var unavailable: Bool

  var isHighlighted: Bool {
    html?.isEmpty == false
  }

  init(
    requestID: String,
    language: String,
    html: String? = nil,
    skipped: Bool = false,
    unsupported: Bool = false,
    unavailable: Bool = false
  ) {
    self.requestID = requestID
    self.language = language
    self.html = html
    self.skipped = skipped
    self.unsupported = unsupported
    self.unavailable = unavailable
  }

  init(
    requestID: String,
    requestedLanguage: String,
    response: HighlightResponse
  ) {
    self.init(
      requestID: requestID,
      language: response.language ?? requestedLanguage,
      html: response.html,
      skipped: response.skipped == true,
      unsupported: response.unsupported == true,
      unavailable: response.unavailable == true
    )
  }

  static func unavailable(
    requestID: String,
    language: String
  ) -> CodeHighlightResult {
    CodeHighlightResult(
      requestID: requestID,
      language: language,
      unavailable: true
    )
  }
}
