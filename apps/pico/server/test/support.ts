/**
 * Test support: a scripted model and a Harness on a temporary SQLite file.
 *
 * The script receives the request's messages and returns the next answer:
 * text, or tool calls. Extension tests use it to run real durable turns.
 */
import { rmSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type AssistantMessage,
  type Message,
  type Model,
} from "@earendil-works/pi-ai"
import {
  createRegistry,
  Harness,
  type Extension,
} from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"

export type ScriptStep =
  | { text: string }
  | { tools: Array<{ name: string; arguments: Record<string, unknown> }> }

export type Script = (messages: readonly Message[]) => ScriptStep

export const TEST_MODEL = { provider: "test", modelId: "test" }

export function scriptedModels(script: Script) {
  const model: Model<"openai-completions"> = {
    id: "test",
    name: "Test",
    provider: "test",
    api: "openai-completions",
    baseUrl: "http://localhost",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64000,
    maxTokens: 1024,
  }
  const models = createModels()
  let calls = 0
  const stream = (_model: unknown, context: { messages: Message[] }) => {
    const events = createAssistantMessageEventStream()
    const step = script(context.messages)
    calls += 1
    const toolUse = "tools" in step
    const message: AssistantMessage = {
      role: "assistant",
      api: "openai-completions",
      provider: "test",
      model: "test",
      content: toolUse
        ? step.tools.map((call, index) => ({
            type: "toolCall" as const,
            id: `call-${calls}-${index}`,
            name: call.name,
            arguments: call.arguments as never,
          }))
        : [{ type: "text" as const, text: step.text }],
      stopReason: toolUse ? "toolUse" : "stop",
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
    setTimeout(() => {
      events.push({
        type: "done",
        reason: toolUse ? "toolUse" : "stop",
        message,
      })
    }, 5)
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
      api: { stream: stream as never, streamSimple: stream as never },
    })
  )
  return models
}

/** The text of the newest tool result message, for scripts. */
export function lastToolResult(messages: readonly Message[]) {
  const last = messages.at(-1)
  if (!last || last.role !== "toolResult") return undefined
  return last.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

const tempDirs: string[] = []
// The tests remove their temp directories when they end.
process.on("exit", () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

export async function tempDir(prefix = "pico-ext-test-") {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** Open a Harness with `extensions` on `database`; reopen it with the same arguments. */
export async function openHarness(
  database: string,
  extensions: Extension[],
  script: Script,
  cwd?: string
) {
  const registry = createRegistry()
  for (const extension of extensions) registry.install(extension)
  const { NodeExecutionEnv } =
    await import("@earendil-works/pi-durable/env/node")
  return Harness.open(
    await openNodeSqliteStorage(database),
    {
      models: scriptedModels(script),
      registry,
      env: ({ cwd: agentCwd }) =>
        new NodeExecutionEnv({ cwd: agentCwd ?? cwd ?? tmpdir() }),
    },
    ctx
  )
}

export { ctx }
