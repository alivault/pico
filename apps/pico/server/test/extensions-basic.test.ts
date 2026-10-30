import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import type { Harness } from "@earendil-works/pi-durable"

import {
  answerQuestion,
  createAskExtension,
  pendingQuestions,
  QuestionsDoc,
  type QuestionsState,
} from "../src/extensions/ask.ts"
import {
  applyTodo,
  createTodoExtension,
  TodoDoc,
  type TodoState,
} from "../src/extensions/todo.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
  type Script,
} from "./support.ts"

async function waitFor<T>(read: () => Promise<T | undefined>, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error("Timed out")
}

void test("todo changes keep ids, one active item, and render a section", async () => {
  const state: TodoState = { items: [], nextId: 1, applied: [], updatedAt: 0 }
  applyTodo(state, { op: "set", items: [{ text: "a" }, { text: "b" }] })
  applyTodo(state, { op: "update", id: "1", status: "active" })
  applyTodo(state, { op: "update", id: "2", status: "active" })
  assert.deepEqual(
    state.items.map((item) => [item.id, item.status]),
    [
      ["1", "pending"],
      ["2", "active"],
    ]
  )
  assert.throws(() => applyTodo(state, { op: "remove", id: "9" }), /No todo/)

  const dir = await tempDir()
  let step = 0
  const script: Script = () => {
    step += 1
    if (step === 1)
      return {
        tools: [
          {
            name: "todo",
            arguments: {
              op: "set",
              items: [{ text: "Write tests" }, { text: "Ship" }],
            },
          },
        ],
      }
    if (step === 2)
      return {
        tools: [
          {
            name: "todo",
            arguments: { op: "update", id: "1", status: "done" },
          },
        ],
      }
    return { text: "done" }
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [createTodoExtension()],
    script
  )
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    await (
      await conversation.submit({ type: "input", content: "plan" }, ctx)
    ).wait(ctx)
    const todo = await harness.snapshot(TodoDoc, conversation.id, ctx)
    assert.deepEqual(
      todo?.items.map((item) => [item.text, item.status]),
      [
        ["Write tests", "done"],
        ["Ship", "pending"],
      ]
    )
    const context = await conversation.context(ctx)
    const system = context.entries
      .filter((entry) => entry.kind === "pi.system")
      .map((entry) => JSON.stringify(entry))
      .join("\n")
    assert.match(system, /\[x\] 1\. Write tests/)
  } finally {
    await harness.close(ctx)
  }
})

void test("ask_user waits for an answer, also across a restart", async () => {
  const dir = await tempDir()
  const database = join(dir, "db.sqlite")
  const script: Script = (messages) => {
    const result = lastToolResult(messages)
    if (result) return { text: `final: ${result}` }
    return {
      tools: [
        {
          name: "ask_user",
          arguments: {
            question: "Which database?",
            options: ["SQLite", "Postgres"],
          },
        },
      ],
    }
  }
  const open = () => openHarness(database, [createAskExtension()], script)
  let harness: Harness = await open()
  let conversationId
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    conversationId = conversation.id
    await conversation.submit({ type: "input", content: "ask me" }, ctx)
    const pending = await waitFor(async () => {
      const state = await harness.snapshot(QuestionsDoc, conversation.id, ctx)
      const open = pendingQuestions(state as QuestionsState | undefined)
      return open.length > 0 ? open : undefined
    })
    assert.equal(pending[0]?.kind, "choice")
    assert.deepEqual(
      pending[0]?.options?.map((option) => option.label),
      ["SQLite", "Postgres"]
    )
  } finally {
    await harness.close(ctx)
  }

  harness = await open()
  try {
    harness.resume()
    const conversation = (await harness.conversation(conversationId!, ctx))!
    assert.equal(
      await answerQuestion(
        harness,
        conversation.id,
        undefined,
        "Postgres",
        "ui",
        ctx
      ),
      true
    )
    await conversation.waitForIdle(ctx)
    const context = await conversation.context(ctx)
    const answer = JSON.stringify(context.entries.at(-1)?.model)
    assert.match(answer, /final: The user answered: Postgres/)
    const asks = context.entries.filter(
      (entry) => entry.kind === "pi.tool-result"
    )
    assert.equal(asks.length, 1)
  } finally {
    await harness.close(ctx)
  }
})
