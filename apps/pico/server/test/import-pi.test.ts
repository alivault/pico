import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { Harness, createRegistry } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"

import { importPiFile, readPiFile } from "../src/core/import-pi.ts"
import { conversationIdOf, SessionDoc } from "../src/core/sessions.ts"
import { tempDir } from "./support.ts"

void test("Pi import preserves branches, edits, settings, and history without running work", async () => {
  const directory = await tempDir("pico-import-test-")
  const source = join(directory, "session.jsonl")
  const timestamp = "2026-01-02T03:04:05.000Z"
  const header = {
    type: "session",
    version: 3,
    id: "legacy-session",
    cwd: directory,
    timestamp,
  }
  const entries = [
    {
      type: "model_change",
      id: "m",
      parentId: null,
      provider: "test",
      modelId: "test",
      timestamp,
    },
    {
      type: "thinking_level_change",
      id: "t",
      parentId: "m",
      thinkingLevel: "high",
      timestamp,
    },
    {
      type: "message",
      id: "u",
      parentId: "t",
      timestamp,
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.parse(timestamp),
      },
    },
    {
      type: "message",
      id: "a",
      parentId: "u",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "first branch" }],
        provider: "test",
        model: "test",
        stopReason: "stop",
        timestamp: Date.parse(timestamp),
      },
    },
    {
      type: "message",
      id: "b",
      parentId: "u",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "second branch" }],
        provider: "test",
        model: "test",
        stopReason: "stop",
        timestamp: Date.parse(timestamp),
      },
    },
    {
      type: "context_edit",
      id: "e",
      parentId: "b",
      targetId: "u",
      replacement: { content: [{ type: "text", text: "edited hello" }] },
      timestamp,
    },
    {
      type: "session_info",
      id: "n",
      parentId: "e",
      name: "Imported title",
      timestamp,
    },
    {
      type: "label",
      id: "l",
      parentId: "n",
      targetId: "b",
      label: "bookmark",
      timestamp,
    },
  ]
  const bytes =
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n"
  await writeFile(source, bytes)
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(directory, "pico.sqlite")),
    { models: createModels(), registry: createRegistry() },
    ctx
  )
  try {
    const result = await importPiFile(harness, source)
    assert.equal(result.entries, 8)
    assert.equal(result.branches, 2)
    const id = conversationIdOf(result.sessionId)
    const conversation = await harness.conversation(id, ctx)
    assert.ok(conversation)
    const context = await conversation.context(ctx)
    assert.equal(
      context.messages.some((message) =>
        JSON.stringify(message).includes("first branch")
      ),
      false
    )
    assert.ok(JSON.stringify(context.messages).includes("second branch"))
    assert.ok(JSON.stringify(context.messages).includes("edited hello"))
    const agent = await conversation.agent(ctx)
    assert.equal(agent.model?.modelId, "test")
    assert.equal(agent.thinkingLevel, "high")
    const meta = await harness.snapshot(SessionDoc, id, ctx)
    assert.equal(meta?.name, "Imported title")
    assert.equal(meta?.createdAt, Date.parse(timestamp))
    assert.ok(
      Object.values(meta?.labels ?? {}).some(
        (label) => label.label === "bookmark"
      )
    )
    const inspection = await harness.inspect(ctx)
    assert.equal(inspection.tasks.length, 0)
    assert.equal(inspection.submissions.length, 0)
    assert.equal((await importPiFile(harness, source)).skipped, true)
    assert.equal(await readFile(source, "utf8"), bytes)
  } finally {
    await harness.close(ctx)
  }
})

void test("Pi import rejects broken parents instead of silently discarding entries", async () => {
  const directory = await tempDir("pico-import-bad-")
  const source = join(directory, "bad.jsonl")
  await writeFile(
    source,
    JSON.stringify({
      type: "session",
      version: 3,
      id: "test",
      cwd: directory,
    }) +
      "\n" +
      JSON.stringify({ type: "custom", id: "entry", parentId: "missing" })
  )
  await assert.rejects(readPiFile(source), /parent .* missing/)
})
