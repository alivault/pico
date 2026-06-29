import Foundation

public actor PicoEventStream {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func events(
    baseURL: URL,
    contextId: String,
    sessionId: String?,
    sessionKey: String?,
    sidebarDirectories: [String],
    lastEventId: String?
  ) -> AsyncThrowingStream<PicoStreamEvent, Error> {
    let session = session

    return AsyncThrowingStream { continuation in
      let task = Task {
        let decoder = JSONDecoder()

        do {
          let eventQueryItems = sidebarDirectories.map {
            URLQueryItem(name: "sidebarDirectory", value: $0)
          } + (lastEventId.map {
            [URLQueryItem(name: "lastEventId", value: $0)]
          } ?? [])
          let url = try PicoEndpoint.events.url(
            baseURL: baseURL,
            contextId: contextId,
            sessionId: sessionId,
            sessionKey: sessionKey,
            extraQueryItems: eventQueryItems
          )
          var request = URLRequest(url: url)
          request.setValue("text/event-stream", forHTTPHeaderField: "accept")

          let (bytes, response) = try await session.bytes(for: request)
          guard let httpResponse = response as? HTTPURLResponse else {
            throw PicoAPIError.invalidResponse
          }
          guard (200..<300).contains(httpResponse.statusCode) else {
            throw PicoAPIError.httpStatus(
              httpResponse.statusCode,
              "Event stream failed."
            )
          }

          var parser = SSEEventParser()
          var lineBytes: [UInt8] = []
          lineBytes.reserveCapacity(4096)

          // Parse bytes directly instead of using AsyncBytes.lines so blank
          // SSE dispatch lines are delivered promptly even after large events.

          func yield(_ event: SSEEvent) throws {
            let decoded = try decoder.decode(
              PicoServerEvent.self,
              from: Data(event.data.utf8)
            )
            continuation.yield(PicoStreamEvent(id: event.id, event: decoded))
          }

          for try await byte in bytes {
            try Task.checkCancellation()

            if byte == 10 {
              if lineBytes.last == 13 {
                lineBytes.removeLast()
              }
              let line = String(decoding: lineBytes, as: UTF8.self)
              lineBytes.removeAll(keepingCapacity: true)
              if let event = parser.feed(line: line) {
                try yield(event)
              }
            } else {
              lineBytes.append(byte)
            }
          }

          if !lineBytes.isEmpty {
            if lineBytes.last == 13 {
              lineBytes.removeLast()
            }
            if let event = parser.feed(
              line: String(decoding: lineBytes, as: UTF8.self)
            ) {
              try yield(event)
            }
          }

          if let event = parser.finish() {
            try yield(event)
          }
          continuation.finish()
        } catch is CancellationError {
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }

      continuation.onTermination = { _ in
        task.cancel()
      }
    }
  }
}
