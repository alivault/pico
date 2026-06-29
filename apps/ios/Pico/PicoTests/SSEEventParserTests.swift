import Testing
@testable import Pico

struct SSEEventParserTests {
  @Test func parsesMultilineEvent() throws {
    var parser = SSEEventParser()

    #expect(parser.feed(line: "id: 42") == nil)
    #expect(parser.feed(line: "event: message") == nil)
    #expect(parser.feed(line: "data: {\"type\":") == nil)
    #expect(parser.feed(line: "data: \"sessions\"}") == nil)

    let parsedEvent = parser.feed(line: "")
    let event = try #require(parsedEvent)
    #expect(event.id == "42")
    #expect(event.event == "message")
    #expect(event.data == "{\"type\":\n\"sessions\"}")
  }
}
