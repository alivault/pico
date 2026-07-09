import Foundation

public enum PicoAPIError: LocalizedError, Sendable {
  case invalidBaseURL(String)
  case notConnected
  case invalidURL
  case invalidResponse
  case httpStatus(Int, String)
  case apiError(String)
  case unsupportedManifest(String)

  public var errorDescription: String? {
    switch self {
    case .invalidBaseURL(let value):
      "Invalid Pico server URL: \(value)"
    case .notConnected:
      "Connect to a Pico server first."
    case .invalidURL:
      "Could not build the Pico request URL."
    case .invalidResponse:
      "The Pico server returned an invalid response."
    case .httpStatus(let status, let body):
      body.isEmpty ? "Pico server returned HTTP \(status)." : body
    case .apiError(let message):
      message
    case .unsupportedManifest(let message):
      message
    }
  }
}
