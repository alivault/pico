import assert from "node:assert/strict"
import { test } from "node:test"

import { EventHub, eventMatches } from "../src/events.ts"
import {
  cleanupCandidate,
  heuristicSessionName,
} from "../src/extensions/auto-name.ts"
import {
  messageImages,
  messageText,
  contextTokens,
  assistantBlocks,
} from "../src/core/items.ts"
import { Security } from "../src/security.ts"
import type { IncomingMessage } from "node:http"

void test("automatic names remove filler and stay short", () => {
  assert.equal(
    heuristicSessionName("Please help me with `SQLite` recovery!", 0),
    "SQLite recovery"
  )
  assert.equal(cleanupCandidate('Title: "SQLite recovery"'), "SQLite recovery")
  assert.equal(heuristicSessionName("", 1), "Image task")
  assert.equal(heuristicSessionName("", 0), undefined)
  assert.equal(
    cleanupCandidate("Title: Fix database restart.\nOther text"),
    "Fix database restart"
  )
  const name = cleanupCandidate("one two three four five six seven eight")!
  assert.equal(name.split(" ").length, 6)
  assert.ok(cleanupCandidate("a".repeat(100))!.length <= 48)
})

void test("events are ordered, scoped, and bounded", () => {
  const hub = new EventHub()
  const event = hub.push({ type: "conversation_delta" }, { sessionId: "s1" })
  assert.ok(event.sequence > hub.firstSequence)
  assert.equal(eventMatches(event, "viewer", "s1"), true)
  assert.equal(eventMatches(event, "viewer", "s2"), false)
  assert.equal(
    eventMatches(
      hub.push({ type: "sessions" }, { contextId: "one" }),
      "two",
      undefined
    ),
    false
  )
  for (let i = 0; i < 600; i++) hub.push({ type: "session_status" })
  assert.equal(hub.eventsAfter(event.sequence), undefined)
  assert.equal(hub.eventsAfter(hub.currentSequence)!.length, 0)
})

void test("message conversion preserves text, images, and tool calls", () => {
  assert.equal(
    messageText({ content: [{ type: "text", text: "hello" }] }),
    "hello"
  )
  assert.equal(
    messageImages({
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    })[0]!.previewUrl,
    "data:image/png;base64,aGVsbG8="
  )
  const blocks = assistantBlocks(
    {
      content: [
        {
          type: "toolCall",
          id: "call",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
    },
    "entry"
  )
  assert.equal(blocks[0]!.type, "tool")
  assert.equal(contextTokens(undefined), undefined)
})

const request = (headers: Record<string, string>) =>
  ({ headers }) as IncomingMessage

void test("remote requests need no token but reject foreign origins", () => {
  const security = new Security("0.0.0.0")
  security.check(request({ host: "pico:3141" }))
  security.check(request({ host: "pico:3141", origin: "http://pico:3141" }))
  assert.throws(
    () =>
      security.check(
        request({ host: "pico:3141", origin: "https://evil.example" })
      ),
    /Cross-origin/
  )
})

void test("local requests reject foreign hosts and origins", () => {
  const security = new Security("127.0.0.1")
  security.check(request({ host: "127.0.0.1:3141" }))
  assert.throws(
    () => security.check(request({ host: "evil.example:3141" })),
    /Host/
  )
  assert.throws(
    () =>
      security.check(
        request({ host: "localhost:3141", origin: "https://evil.example" })
      ),
    /Cross-origin/
  )
})
