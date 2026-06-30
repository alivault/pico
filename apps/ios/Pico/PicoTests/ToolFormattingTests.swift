import Foundation
import Testing
@testable import Pico

struct ToolFormattingTests {
  @Test func prettyPrintsJSONValues() throws {
    let value = JSONValue.object([
      "b": .number(2),
      "a": .array([.string("x")]),
    ])

    let pretty = try #require(value.prettyJSONDescription)
    let compact = try #require(value.compactJSONDescription)

    #expect(pretty.contains("\n"))
    #expect(pretty.contains(#""a""#))
    #expect(compact == #"{"a":["x"],"b":2}"#)
    #expect(value.description == compact)
  }

  @Test func buildsReadAndWriteSummaries() {
    let read = ToolBlock(
      name: "read",
      args: .object([
        "path": .string("apps/ios/Pico/Pico/Features/Conversation/ToolBlockView.swift"),
        "offset": .number(10),
        "limit": .number(5),
      ]),
      output: "",
      running: false
    )

    let write = ToolBlock(
      name: "write",
      args: .object([
        "path": .string("Sources/App.swift"),
        "content": .string("let first = 1\nlet second = 2"),
      ]),
      output: "Successfully wrote 32 bytes to Sources/App.swift",
      running: false
    )

    #expect(
      ToolFormatting.summary(for: read) ==
        "apps/ios/Pico/Pico/Features/Conversation/ToolBlockView.swift:10-14"
    )
    #expect(ToolFormatting.summary(for: write) == "Sources/App.swift · 2 lines")
    #expect(ToolFormatting.codeLanguage(fromPath: "Sources/App.swift") == "swift")
  }

  @Test func formatsBashCallsAndClassifiesExploreCommands() {
    let block = ToolBlock(
      name: "bash",
      args: .object([
        "command": .string("env FOO=bar rg \"Tool\" apps/ios")
      ]),
      output: "apps/ios/Pico/Pico/Features/Conversation/ToolBlockView.swift\n",
      running: false
    )

    #expect(
      ToolFormatting.rawShellCommandText(name: block.name, args: block.args) ==
        "env FOO=bar rg \"Tool\" apps/ios"
    )
    #expect(ToolFormatting.callText(for: block) == "$ env FOO=bar rg \"Tool\" apps/ios")
    #expect(ToolFormatting.exploreShellCommandNameFromTool(name: block.name, args: block.args) == "rg")
    #expect(ToolFormatting.toolCategoryFromTool(name: block.name, args: block.args) == "explore")
  }

  @Test func hidesPendingUnclassifiedStreamingBashPrefix() {
    let block = ToolBlock(
      name: "bash",
      args: .string(#"{"command":"r"#),
      output: "",
      running: true
    )

    #expect(ToolFormatting.toolArgsAreIncompleteJSONObject(block.args))
    #expect(ToolFormatting.isPendingUnclassifiedToolBlock(block))
  }

  @Test func extractsDiffStatsAndStripsToolBoilerplate() {
    let patch = """
    --- a/README.md
    +++ b/README.md
    @@ -1,2 +1,3 @@
    -old line
    +new line
    +second new line
     unchanged
    """

    let stats = ToolFormatting.editDiffStats(for: patch)

    #expect(stats == ToolEditDiffStatCounts(additions: 2, removals: 1))
    #expect(
      ToolFormatting.editOutputWithoutSuccessMessage(
        "Successfully replaced 1 block(s) in README.md.\nextra"
      ) == "extra"
    )

    let diffOnlyBlock = ToolBlock(
      name: "edit",
      output: "",
      details: .object(["diff": .string(patch)]),
      running: false
    )
    #expect(ToolFormatting.patchText(for: diffOnlyBlock) == patch)
    #expect(
      ToolFormatting.writeOutputWithoutSuccessMessage(
        "Successfully wrote 128 bytes to README.md\nextra"
      ) == "extra"
    )
  }

  @Test func decodesToolBlocksFromStateSyncPayload() throws {
    let data = Data(
      #"""
      {
        "type": "state_sync",
        "sessionKey": "tool-fixture",
        "items": [
          {
            "kind": "assistant",
            "itemKey": "assistant-tool-fixture",
            "blocks": [
              {
                "type": "tool",
                "blockKey": "tool-1",
                "name": "edit",
                "args": {
                  "path": "README.md"
                },
                "details": {
                  "patch": "@@ -1 +1 @@\n-old\n+new"
                },
                "output": "Successfully replaced 1 block(s) in README.md.",
                "isError": false,
                "running": false
              }
            ]
          }
        ]
      }
      """#.utf8
    )

    guard case .stateSync(let sync) = try JSONDecoder().decode(PicoServerEvent.self, from: data) else {
      Issue.record("Expected state_sync event")
      return
    }

    var state = SessionState()
    state.apply(sync)

    guard case .assistant(let assistant) = state.items.first,
          case .tool(let tool) = assistant.blocks.first else {
      Issue.record("Expected decoded tool block")
      return
    }

    #expect(ToolFormatting.patchText(for: tool) == "@@ -1 +1 @@\n-old\n+new")
    #expect(ToolFormatting.summary(for: tool) == "README.md")
  }
}
