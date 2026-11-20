import assert from "node:assert/strict"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

import {
  entryRow,
  matchQuery,
  SearchIndex,
} from "../src/services/search-index.ts"
import { tempDir } from "./support.ts"

void test("matchQuery quotes words and phrases", () => {
  assert.equal(matchQuery("heap OOM"), '"heap" "OOM"')
  assert.equal(matchQuery('"machine add" ssh'), '"machine add" "ssh"')
  assert.equal(matchQuery("foo bar", { prefix: true }), '"foo" "bar"*')
  assert.equal(matchQuery("foo bar", { any: true }), '"foo" OR "bar"')
  // FTS5 syntax in the text is only text.
  assert.equal(matchQuery('a* OR "b'), '"a*" "OR" "b"')
  assert.equal(matchQuery("  ** -- "), undefined)
})

void test("entryRow keeps text and short tool calls, not thinking", () => {
  const assistant = entryRow(
    JSON.stringify({
      kind: "pi.assistant",
      model: [
        {
          role: "assistant",
          timestamp: 5,
          content: [
            { type: "thinking", thinking: "secret plan" },
            { type: "text", text: "I will list files." },
            {
              type: "toolCall",
              name: "bash",
              arguments: { command: "ls -la" },
            },
          ],
        },
      ],
    })
  )
  assert.deepEqual(assistant, {
    kind: "assistant",
    ts: 5,
    text: "I will list files.\n[bash] ls -la",
  })
  assert.equal(
    entryRow(
      JSON.stringify({
        kind: "pi.tool-result",
        tool: "bash",
        text: "total 0",
        ts: 6,
      })
    )?.text,
    "[bash result] total 0"
  )
  assert.equal(
    entryRow(
      JSON.stringify({
        kind: "pi.user",
        model: [{ role: "user", content: "hello" }],
      })
    )?.kind,
    "user"
  )
  assert.equal(entryRow(JSON.stringify({ kind: "pi.system" })), undefined)
  assert.equal(entryRow("{"), undefined)
})

void test("the index reads new entries of the durable database", async () => {
  const dir = await tempDir("pico-search-")
  const source = join(dir, "pico.sqlite")
  const durable = new DatabaseSync(source)
  durable.exec(
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, head INTEGER, commit_seq INTEGER NOT NULL, record TEXT NOT NULL)"
  )
  const add = (id: number, conversation: number, record: unknown) =>
    durable
      .prepare(
        "INSERT INTO entries (id, conversation_id, commit_seq, record) VALUES (?, ?, 0, ?)"
      )
      .run(id, conversation, JSON.stringify(record))
  const user = (text: string) => ({
    kind: "pi.user",
    model: [{ role: "user", content: text, timestamp: 1 }],
  })
  add(1, 7, user("the build fails on arm64"))
  add(2, 7, {
    kind: "pi.tool-result",
    model: [
      {
        role: "toolResult",
        toolName: "bash",
        content: [{ type: "text", text: `error: ${"x".repeat(5000)}` }],
      },
    ],
  })
  const index = new SearchIndex(join(dir, "search.sqlite"), source)
  index.start()
  await index.catchUp()
  const hits = index.search(matchQuery("build arm64")!, 10)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.conversation, 7)
  assert.match(hits[0]!.snippet, /\uE000build\uE001/)
  // The tool result is kept only in short.
  assert.ok(index.entry(2)!.text.length < 1100)

  add(3, 8, user("deploy the build"))
  await index.catchUp()
  assert.equal(index.search(matchQuery("build")!, 10).length, 2)
  assert.deepEqual(
    index.around(7, 2, 1, 1).map((entry) => entry.entryId),
    [1, 2]
  )
  index.close()

  // A new index object goes on from where the last one stopped.
  const again = new SearchIndex(join(dir, "search.sqlite"), source)
  again.start()
  await again.catchUp()
  assert.equal(again.search(matchQuery("deploy")!, 10).length, 1)
  again.close()
  durable.close()
})
