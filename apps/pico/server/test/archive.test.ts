import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { Harness, createRegistry } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { AgentMetaDoc, publicId } from "../src/core/agents.ts"
import { tempDir } from "./support.ts"

void test("an archived session is listed and can be restored", async () => {
  const data = await tempDir("pico-archive-test-")
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(data, "pico.sqlite")),
    { models: createModels(), registry: createRegistry() },
    ctx
  )
  let id = ""
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { cwd: data },
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
  } finally {
    await harness.close(ctx)
  }
  const child = spawn(
    process.execPath,
    [
      "dist/pico-server.mjs",
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
            `${url}/api/directory-agents?directory=${encodeURIComponent(data)}`
          )
        ).json()) as { totalCount: number }
      ).totalCount
    const archived = async () =>
      (
        (await (await fetch(`${url}/api/agents/archived`)).json()) as {
          agents: Array<{
            id: string
            directory: string
            archivedAt?: string
          }>
        }
      ).agents

    assert.equal(await visibleCount(), 1)
    assert.deepEqual(await archived(), [])

    assert.equal(
      (await post("/api/agents/delete", { paths: [`pico:${id}`] })).status,
      200
    )
    assert.equal(await visibleCount(), 0)
    const list = await archived()
    assert.equal(list.length, 1)
    assert.equal(list[0]!.id, id)
    assert.equal(list[0]!.directory, data)
    assert.ok(list[0]!.archivedAt)

    const restored = await post("/api/session/restore", { path: `pico:${id}` })
    assert.equal(restored.status, 200)
    assert.deepEqual(await restored.json(), {
      ok: true,
      path: `pico:${id}`,
      directory: data,
    })
    assert.equal(await visibleCount(), 1)
    assert.deepEqual(await archived(), [])
  } finally {
    child.kill("SIGTERM")
    await exited
  }
})
