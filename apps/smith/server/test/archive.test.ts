import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import { AgentMetaDoc, publicId } from "../src/core/agents.ts"
import { HostBridge } from "../src/extensions/host.ts"
import { createScheduleExtension } from "../src/extensions/schedule.ts"
import { lastToolResult, openHarness, tempDir, TEST_MODEL } from "./support.ts"

void test("an archived agent is listed and can be restored", async () => {
  const data = await tempDir("smith-archive-test-")
  // The agent sets a timer, so archiving it can cancel the timer.
  const harness = await openHarness(
    join(data, "smith.sqlite"),
    [createScheduleExtension(new HostBridge())],
    (messages) =>
      lastToolResult(messages)
        ? { text: "set" }
        : {
            tools: [
              { name: "schedule", arguments: { in: "1h", message: "later" } },
            ],
          },
    data
  )
  let id = ""
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { cwd: data, model: TEST_MODEL },
        init: async (tx, conversationId) => {
          Object.assign(await tx.doc(AgentMetaDoc, conversationId), {
            cwd: data,
            name: "Keep me",
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            firstMessage: "Keep me",
            messageCount: 1,
          })
        },
      },
      ctx
    )
    id = publicId(conversation.id)
    await (
      await conversation.submit({ type: "input", content: "Keep me" }, ctx)
    ).wait(ctx)
  } finally {
    await harness.close(ctx)
  }
  const child = spawn(
    process.execPath,
    [
      "dist/smith-server.mjs",
      "serve",
      "--port",
      "0",
      "--data-dir",
      data,
      "--web-dir",
      "none",
    ],
    {
      env: { ...process.env, PI_CODING_AGENT_DIR: join(data, "agent") },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  let log = ""
  child.stdout.on("data", (chunk) => {
    log += chunk.toString()
  })
  child.stderr.on("data", (chunk) => {
    log += chunk.toString()
  })
  const exited = new Promise<void>((done) => child.once("exit", () => done()))
  try {
    let port: number | undefined
    for (let i = 0; i < 100; i++) {
      try {
        port = JSON.parse(
          await readFile(join(data, "server.json"), "utf8")
        ).port
        break
      } catch {
        /* Wait for startup. */
      }
      if (child.exitCode !== null) throw new Error(log)
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.ok(port, log)
    const url = `http://127.0.0.1:${port}`
    const post = (path: string, body: unknown) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    const visibleCount = async () =>
      (
        (await (
          await fetch(
            `${url}/api/project-agents?project=${encodeURIComponent(data)}`
          )
        ).json()) as { totalCount: number }
      ).totalCount
    const archived = async () =>
      (
        (await (await fetch(`${url}/api/agents/archived`)).json()) as {
          agents: Array<{
            id: string
            project: string
            archivedAt?: string
          }>
        }
      ).agents

    const timers = async () =>
      (
        (await (
          await fetch(`${url}/api/agent/extensions?agent=${id}`)
        ).json()) as { state: { timers?: Array<{ status: string }> } }
      ).state.timers?.map((item) => item.status)

    assert.equal(await visibleCount(), 1)
    assert.deepEqual(await archived(), [])
    assert.deepEqual(await timers(), ["pending"])

    assert.equal(
      (await post("/api/agents/delete", { paths: [`smith:${id}`] })).status,
      200
    )
    assert.equal(await visibleCount(), 0)
    const list = await archived()
    assert.equal(list.length, 1)
    assert.equal(list[0]!.id, id)
    assert.equal(list[0]!.project, data)
    assert.ok(list[0]!.archivedAt)
    // Archiving cancels the agent's timers and watches.
    for (let i = 0; i < 50 && (await timers())?.[0] !== "cancelled"; i++)
      await new Promise((done) => setTimeout(done, 50))
    assert.deepEqual(await timers(), ["cancelled"])

    const restored = await post("/api/agent/restore", { path: `smith:${id}` })
    assert.equal(restored.status, 200)
    assert.deepEqual(await restored.json(), {
      ok: true,
      path: `smith:${id}`,
      project: data,
    })
    assert.equal(await visibleCount(), 1)
    assert.deepEqual(await archived(), [])
  } finally {
    child.kill("SIGTERM")
    await exited
  }
})
