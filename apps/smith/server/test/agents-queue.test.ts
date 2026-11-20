/**
 * The `queue` and `unsend` actions of the agents tool on Smith's real
 * `Agents` class: senders of the user's prompts and of agent messages, the
 * permission rule, a paused queue, and the composer's queue in `state_sync`.
 */
import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import type { Message } from "@earendil-works/pi-ai"
import { createRegistry, Harness } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"

import {
  AgentMetaDoc,
  Agents,
  conversationIdOf,
  publicId,
} from "../src/core/agents.ts"
import type { Runtime } from "../src/core/runtime.ts"
import { DEFAULT_SETTINGS } from "../src/core/settings.ts"
import { Viewers } from "../src/core/viewers.ts"
import { EventHub, type ServerEvent } from "../src/events.ts"
import { createAgentsExtension } from "../src/extensions/agents.ts"
import { HostBridge, type HostServices } from "../src/extensions/host.ts"
import {
  ctx,
  lastToolResult,
  scriptedModels,
  tempDir,
  TEST_MODEL,
  type Script,
} from "./support.ts"

function lastUser(messages: readonly Message[]) {
  const message = [...messages].reverse().find((item) => item.role === "user")
  if (!message) return ""
  return typeof message.content === "string"
    ? message.content
    : message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
}

async function eventually<T>(read: () => Promise<T | undefined>, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error("Timed out")
}

void test("agents queue and unsend work on Smith's agents", async () => {
  const dir = await tempDir("smith-queue-test-")
  const host = new HostBridge()
  let release = false
  const script: Script = (messages) => {
    const user = lastUser(messages)
    const result = lastToolResult(messages)
    // The subagent works until the test releases it, so messages queue.
    if (user.startsWith("Slow work"))
      return release
        ? { text: "The work is done." }
        : { tools: [{ name: "agents", arguments: { action: "list" } }] }
    // `call {...}` makes one agents tool call with these arguments.
    if (user.startsWith("call "))
      return result !== undefined
        ? { text: "ok" }
        : {
            tools: [
              {
                name: "agents",
                arguments: JSON.parse(user.slice(5)) as Record<string, unknown>,
              },
            ],
          }
    return { text: "noted" }
  }
  const registry = createRegistry()
  registry.install(createAgentsExtension(host))
  const { NodeExecutionEnv } =
    await import("@earendil-works/pi-durable/env/node")
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(dir, "smith.sqlite")),
    {
      models: scriptedModels(script),
      registry,
      env: () => new NodeExecutionEnv({ cwd: dir }),
    },
    ctx
  )
  const create = async (name: string, parent?: string) => {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: TEST_MODEL, cwd: dir },
        init: async (tx, id) => {
          Object.assign(await tx.doc(AgentMetaDoc, id), {
            cwd: dir,
            name,
            nameSource: "user",
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            firstMessage: "",
            messageCount: 0,
            ...(parent ? { parent, depth: 1 } : {}),
          })
        },
      },
      ctx
    )
    return publicId(conversation.id)
  }
  const a = await create("Parent")
  const b = await create("Child", a)
  const c = await create("Other")

  const settings = { data: { ...DEFAULT_SETTINGS } }
  const runtime = {
    harness,
    registry,
    settings,
    resources: { get: async () => ({ skills: [], prompts: [] }) },
    models: { getModel: () => undefined, getAvailableSnapshot: () => [] },
    piSettings: () => ({
      getDefaultThinkingLevel: () => "off",
      getDefaultProvider: () => undefined,
      getDefaultModel: () => undefined,
    }),
  } as unknown as Runtime
  const hub = new EventHub()
  const events: ServerEvent[] = []
  hub.subscribe((event) => events.push(event))
  const agents = new Agents(runtime, hub, new Viewers(join(dir, "viewers")))
  await agents.load()
  host.bind({
    agents,
    events: hub,
    terminals: {} as HostServices["terminals"],
    harness,
    settings: () => settings.data,
    dataDir: dir,
  })

  /** Run one agents call as `agent`; returns its result. */
  const call = async (agent: string, args: Record<string, unknown>) => {
    await agents.prompt(agent, {
      message: `call ${JSON.stringify(args)}`,
      images: [],
    })
    const conversation = (await harness.conversation(
      conversationIdOf(agent),
      ctx
    ))!
    await conversation.waitForIdle(ctx)
    const results = (await conversation.context(ctx)).entries.filter(
      (entry) => entry.kind === "pi.tool-result"
    )
    const message = results.at(-1)!.model![0] as {
      content: Array<{ text?: string }>
      isError?: boolean
    }
    return {
      text: message.content.map((part) => part.text ?? "").join(""),
      isError: Boolean(message.isError),
    }
  }
  const listed = (text: string) =>
    [...text.matchAll(/^\d+\. ((?:pending|held):\d+) from (.+?)(?:,|$)/gm)].map(
      (match) => ({ id: match[1]!, from: match[2]! })
    )
  /** The texts of the composer queue in the newest state_sync of B. */
  const composerQueue = () => {
    const sync = events.findLast(
      (event) =>
        event.agentId === b &&
        event.payload.type === "state_sync" &&
        Array.isArray(event.payload.pendingUserMessages)
    )
    return (
      sync?.payload.pendingUserMessages as Array<{ text: string }> | undefined
    )?.map((message) => message.text)
  }

  try {
    const stopWatching = agents.watch(b)
    await agents.prompt(b, { message: "Slow work", images: [] })
    await eventually(async () => (agents.isBusy(b) ? true : undefined))

    // (1) The user's prompts wait in B's queue.
    await agents.prompt(b, {
      message: "First user prompt",
      images: [],
      streamingBehavior: "followUp",
    })
    await agents.prompt(b, {
      message: "Second user prompt",
      images: [],
      streamingBehavior: "followUp",
    })
    // (2) A sends to its subagent B; C, not B's parent, sends too.
    await call(a, { action: "send", id: b, message: "From the parent" })
    await call(c, { action: "send", id: b, message: "From other" })

    const first = await call(a, { action: "queue", id: b })
    assert.equal(first.isError, false, first.text)
    const items = listed(first.text)
    assert.deepEqual(
      items.map((item) => item.from),
      ["the user", "the user", `you (${a})`, `agent ${c} (Other)`],
      first.text
    )
    assert.match(first.text, /queued \d{4}-\d\d-\d\dT/)
    assert.equal(first.text.match(/queued \d{4}-/g)?.length, 4, first.text)

    // (3) C sees only its own message and may not remove the user's.
    const otherView = await call(c, { action: "queue", id: b })
    assert.deepEqual(
      listed(otherView.text).map((item) => item.id),
      [items[3]!.id],
      otherView.text
    )
    const refused = await call(c, {
      action: "unsend",
      id: b,
      item: items[0]!.id,
    })
    assert.equal(refused.isError, true)
    assert.match(refused.text, /not your subagent/)

    // (4) A removes the user's first prompt: the composer queue updates and
    // the user gets a notice.
    const removed = await call(a, {
      action: "unsend",
      id: b,
      item: items[0]!.id,
    })
    assert.equal(removed.isError, false, removed.text)
    assert.match(removed.text, /from the user.*First user prompt/s)
    await eventually(async () =>
      composerQueue()?.includes("First user prompt") === false &&
      composerQueue()?.includes("Second user prompt")
        ? true
        : undefined
    )
    assert.ok(
      events.some(
        (event) =>
          event.agentId === b &&
          event.payload.type === "extension_ui_request" &&
          event.payload.message ===
            `${a} removed your queued message: First user prompt`
      )
    )

    // (5) A paused queue keeps the senders, and so does a resumed one.
    await agents.holdQueue(b)
    const held = await call(a, { action: "queue", id: b })
    assert.deepEqual(
      listed(held.text).map((item) => [item.id.split(":")[0], item.from]),
      [
        ["held", "the user"],
        ["held", `you (${a})`],
        ["held", `agent ${c} (Other)`],
      ],
      held.text
    )
    assert.match(held.text, /held \(the queue is paused\)/)
    await agents.requeue(b)
    const resumed = await call(a, { action: "queue", id: b })
    const resumedItems = listed(resumed.text)
    assert.deepEqual(
      resumedItems.map((item) => [item.id.split(":")[0], item.from]),
      [
        ["pending", "the user"],
        ["pending", `you (${a})`],
        ["pending", `agent ${c} (Other)`],
      ],
      resumed.text
    )
    // C can still remove its own message after the queue moved.
    const own = await call(c, {
      action: "unsend",
      id: b,
      item: resumedItems[2]!.id,
    })
    assert.equal(own.isError, false, own.text)

    // (6) After B got the messages, unsend fails.
    release = true
    await eventually(async () =>
      (await agents.queue(b)).length === 0 ? true : undefined
    )
    const late = await call(a, {
      action: "unsend",
      id: b,
      item: resumedItems[0]!.id,
    })
    assert.equal(late.isError, true)
    assert.match(late.text, /not in the queue .* already got it/)
    const child = (await harness.conversation(conversationIdOf(b), ctx))!
    await child.waitForIdle(ctx)
    const delivered = JSON.stringify(
      (await child.context(ctx)).entries
        .filter((entry) => entry.kind === "pi.user")
        .map((entry) => entry.model)
    )
    assert.match(delivered, /Second user prompt/)
    assert.match(delivered, /From the parent/)
    assert.doesNotMatch(delivered, /First user prompt/)
    assert.doesNotMatch(delivered, /From other/)
    stopWatching()
    // The reports of B's answer reach A and C; let their turns end before
    // the harness closes.
    for (const agent of [a, c]) {
      const conversation = (await harness.conversation(
        conversationIdOf(agent),
        ctx
      ))!
      await eventually(async () =>
        JSON.stringify((await conversation.context(ctx)).entries).includes(
          `gent ${b}: done]`
        )
          ? true
          : undefined
      )
      await conversation.waitForIdle(ctx)
    }
    await eventually(async () =>
      [a, b, c].some((agent) => agents.isBusy(agent)) ? undefined : true
    )
    await agents.flushMeta()
  } finally {
    await harness.close(ctx)
  }
})
