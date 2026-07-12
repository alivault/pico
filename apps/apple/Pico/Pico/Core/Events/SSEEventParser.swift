import Foundation

public struct SSEEventParser: Sendable {
  private var eventName: String?
  private var eventId: String?
  private var dataLines: [String] = []

  public init() {}

  public mutating func feed(line rawLine: String) -> SSEEvent? {
    let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))

    if line.isEmpty {
      return dispatch()
    }

    if line.hasPrefix(":") {
      return nil
    }

    let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let field = String(parts.first ?? "")
    var value = parts.count > 1 ? String(parts[1]) : ""
    if value.hasPrefix(" ") {
      value.removeFirst()
    }

    switch field {
    case "event":
      eventName = value
    case "id":
      eventId = value
    case "data":
      dataLines.append(value)
    case "retry":
      break
    default:
      break
    }

    return nil
  }

  public mutating func finish() -> SSEEvent? {
    dispatch()
  }

  private mutating func dispatch() -> SSEEvent? {
    defer {
      eventName = nil
      dataLines.removeAll(keepingCapacity: true)
    }

    guard !dataLines.isEmpty else {
      return nil
    }

    return SSEEvent(
      id: eventId,
      event: eventName,
      data: dataLines.joined(separator: "\n")
    )
  }
}
