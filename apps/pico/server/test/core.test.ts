import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { Viewers } from "../src/core/viewers.ts"
import { EventHub, eventMatches } from "../src/events.ts"
import {
  cleanupCandidate,
  heuristicAgentName,
} from "../src/extensions/auto-name.ts"
import {
  messageImages,
  messageText,
  contextTokens,
  assistantBlocks,
  detailsImage,
  itemsFromEntries,
} from "../src/core/items.ts"
import { Security } from "../src/security.ts"
import type { IncomingMessage } from "node:http"
import { tempDir } from "./support.ts"

void test("automatic names remove filler and stay short", () => {
  assert.equal(
    heuristicAgentName("Please help me with `SQLite` recovery!", 0),
    "SQLite recovery"
  )
  assert.equal(cleanupCandidate('Title: "SQLite recovery"'), "SQLite recovery")
  assert.equal(heuristicAgentName("", 1), "Image task")
  assert.equal(heuristicAgentName("", 0), undefined)
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
  const event = hub.push({ type: "conversation_delta" }, { agentId: "s1" })
  assert.ok(event.sequence > hub.firstSequence)
  assert.equal(eventMatches(event, "viewer", "s1"), true)
  assert.equal(eventMatches(event, "viewer", "s2"), false)
  assert.equal(
    eventMatches(
      hub.push({ type: "agents" }, { contextId: "one" }),
      "two",
      undefined
    ),
    false
  )
  for (let i = 0; i < 600; i++) hub.push({ type: "agent_status" })
  assert.equal(hub.eventsAfter(event.sequence), undefined)
  assert.equal(hub.eventsAfter(hub.currentSequence)!.length, 0)
})

void test("message conversion preserves text, images, and tool calls", () => {
  assert.equal(
    messageText({ content: [{ type: "text", text: "hello" }] }),
    "hello"
  )
  assert.deepEqual(
    messageImages({
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    }),
    [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }]
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
  security.check(
    request({
      host: "pico.tail1234.ts.net:3141",
      origin: "https://pico.tail1234.ts.net:3141",
    })
  )
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

void test("tool results keep their images as URLs", () => {
  const items = itemsFromEntries(
    [
      {
        id: 1,
        kind: "pi.assistant",
        model: [
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call",
                name: "read",
                arguments: { path: "a.png" },
              },
            ],
          },
        ],
      },
      {
        id: 2,
        kind: "pi.tool-result",
        model: [
          {
            role: "toolResult",
            toolCallId: "call",
            content: [
              { type: "text", text: "Read image file [image/png]" },
              { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
            ],
            details: {
              kind: "image",
              title: "a.png",
              data: "data:image/png;base64,aGVsbG8=",
            },
          },
        ],
      },
    ] as never,
    "abc"
  )
  const item = items[0]
  assert.equal(item?.kind, "assistant")
  const block = item?.kind === "assistant" ? item.blocks[0] : undefined
  assert.equal(block?.type, "tool")
  assert.deepEqual(block?.type === "tool" ? block.images : undefined, [
    { mimeType: "image/png", url: "/api/agent-image/abc/2/0" },
  ])
  assert.deepEqual(block?.type === "tool" ? block.details : undefined, {
    kind: "image",
    title: "a.png",
    data: "/api/agent-image/abc/2/details",
  })
  assert.deepEqual(
    detailsImage({ kind: "image", data: "data:image/png;base64,aGVsbG8=" }),
    { mimeType: "image/png", data: "aGVsbG8=" }
  )
})

void test("read state is global and an open tab keeps its agent read", async () => {
  const dir = await tempDir("pico-viewers-")
  const file = join(dir, "viewers.json")
  const viewers = new Viewers(file)
  const changes: string[] = []
  viewers.onReadChange((id, unread) => changes.push(`${id}:${unread}`))

  viewers.selectAgent("tab-a", "s1")
  viewers.markDone("s2")
  assert.deepEqual([...viewers.unread()], ["s2"])
  // Read in one tab: read in all of them.
  viewers.selectAgent("tab-b", "s2")
  assert.equal(viewers.isUnread("s2"), false)

  // A closed tab that showed s1 does not keep it read; an open one does.
  viewers.markDone("s1")
  assert.equal(viewers.isUnread("s1"), true)
  viewers.setRead("s1", true)
  const detach = viewers.attach("tab-a")
  viewers.markDone("s1")
  assert.equal(viewers.isUnread("s1"), false)
  detach()
  viewers.markDone("s1")
  assert.equal(viewers.isUnread("s1"), true)
  assert.deepEqual(changes, [
    "s2:true",
    "s2:false",
    "s1:true",
    "s1:false",
    "s1:true",
  ])

  viewers.flush()
  assert.deepEqual([...new Viewers(file).unread()], ["s1"])
  assert.equal(new Viewers(file).get("tab-b")?.selectedAgent, "s2")
  // The file keeps the stored names.
  const stored = JSON.parse(await readFile(file, "utf8")) as {
    contexts: Record<string, { selectedSession?: string }>
  }
  assert.equal(stored.contexts["tab-b"]?.selectedSession, "s2")
})

void test("viewer contexts from before global read state keep the newest unread list", async () => {
  const dir = await tempDir("pico-viewers-")
  const file = join(dir, "viewers.json")
  await writeFile(
    file,
    JSON.stringify({
      old: { sidebarDirectories: [], unread: ["s1", "s2"], updatedAt: 1 },
      new: {
        selectedSession: "s3",
        sidebarDirectories: ["/p"],
        unread: ["s2"],
        updatedAt: 2,
      },
    })
  )
  const viewers = new Viewers(file)
  assert.deepEqual([...viewers.unread()], ["s2"])
  assert.equal(viewers.get("new")?.selectedAgent, "s3")
  assert.deepEqual(viewers.get("new")?.sidebarProjects, ["/p"])
})
