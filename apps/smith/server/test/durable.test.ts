import assert from "node:assert/strict"

import { join } from "node:path"
import { test } from "node:test"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import {
  createModels,
  createProvider,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai"
import { Harness, createRegistry } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { tempDir } from "./support.ts"

void test("durable agents run concurrently, deduplicate, queue, and persist", async () => {
  const directory = await tempDir("pico-durable-test-")
  const database = join(directory, "test.sqlite")
  let active = 0
  let maxActive = 0
  const model: Model<"openai-completions"> = {
    id: "test",
    name: "Test",
    provider: "test",
    api: "openai-completions",
    baseUrl: "http://localhost",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 1024,
  }
  const models = createModels()
  const stream = () => {
    const events = createAssistantMessageEventStream()
    active += 1
    maxActive = Math.max(maxActive, active)
    setTimeout(() => {
      active -= 1
      const message: AssistantMessage = {
        role: "assistant",
        api: "openai-completions",
        provider: "test",
        model: "test",
        content: [{ type: "text", text: "done" }],
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      events.push({ type: "done", reason: "stop", message })
    }, 100)
    return events
  }
  models.setProvider(
    createProvider({
      id: "test",
      models: [model],
      auth: {
        apiKey: {
          name: "Test",
          async resolve() {
            return { auth: { apiKey: "test" } }
          },
        },
      },
      api: { stream, streamSimple: stream },
    })
  )
  const open = async () =>
    Harness.open(
      await openNodeSqliteStorage(database),
      { models, registry: createRegistry() },
      ctx
    )
  let harness = await open()
  try {
    const options = {
      ownership: { kind: "ownerless" as const },
      agent: { model: { provider: "test", modelId: "test" } },
    }
    const first = await harness.createConversation(options, ctx)
    const second = await harness.createConversation(options, ctx)
    const input = {
      type: "input" as const,
      content: [{ type: "text" as const, text: "hello" }],
      requestId: "first-request",
    }
    const [a, b] = await Promise.all([
      first.submit(input, ctx),
      second.submit(input, ctx),
    ])
    const duplicate = await first.submit(input, ctx)
    assert.equal(duplicate.id, a.id)
    const queued = await first.submit(
      {
        type: "input",
        content: [{ type: "text", text: "follow up" }],
        whenBusy: "followUp",
      },
      ctx
    )
    await Promise.all([a.wait(ctx), b.wait(ctx), queued.wait(ctx)])
    assert.ok(maxActive >= 2, "Conversations must not share a run mutex")
    await harness.waitForIdle(ctx)
    const before = await first.context(ctx)
    assert.equal(
      before.entries.filter((entry) => entry.kind === "pi.user").length,
      2
    )
    const id = first.id
    await first.submit(
      { type: "input", content: [{ type: "text", text: "resume me" }] },
      ctx
    )
    await new Promise((done) => setTimeout(done, 20))
    await harness.close(ctx)
    harness = await open()
    const restored = await harness.conversation(id, ctx)
    assert.ok(restored)
    await restored.waitForIdle(ctx)
    const after = await restored.context(ctx)
    assert.deepEqual(
      after.entries.slice(0, before.entries.length).map((entry) => entry.kind),
      before.entries.map((entry) => entry.kind)
    )
    assert.equal(
      after.entries.filter((entry) => entry.kind === "pi.user").length,
      3
    )
    assert.equal(
      after.entries.filter((entry) => entry.kind === "pi.assistant").length,
      3
    )
  } finally {
    await harness.close(ctx)
  }
})
