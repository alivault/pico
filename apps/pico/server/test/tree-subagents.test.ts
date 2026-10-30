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

void test("tree navigation keeps the subagents under the agent", async () => {
  const data = await tempDir("pico-tree-subagents-test-")
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(data, "pico.sqlite")),
    { models: createModels(), registry: createRegistry() },
    ctx
  )
  let parentId = ""
  let subagentId = ""
  try {
    const meta = (name: string) => ({
      cwd: data,
      name,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      firstMessage: name,
      messageCount: 1,
    })
    const parent = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { cwd: data },
        init: async (tx, id) => {
          Object.assign(await tx.doc(AgentMetaDoc, id), meta("Parent"))
        },
      },
      ctx
    )
    parentId = publicId(parent.id)
    await harness.commit(async (tx) => {
      for (const content of ["First", "Second"])
        await tx.appendEntry(parent.id, {
          kind: "pi.user",
          model: [{ role: "user", content, timestamp: Date.now() }],
        })
    }, ctx)
    const subagent = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { cwd: data },
        init: async (tx, id) => {
          Object.assign(await tx.doc(AgentMetaDoc, id), {
            ...meta("Child"),
            parent: parentId,
            depth: 1,
          })
        },
      },
      ctx
    )
    subagentId = publicId(subagent.id)
  } finally {
    await harness.close(ctx)
  }
  const server = spawn(
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
  server.stdout.on("data", (chunk) => {
    log += chunk.toString()
  })
  server.stderr.on("data", (chunk) => {
    log += chunk.toString()
  })
  const exited = new Promise<void>((done) => server.once("exit", () => done()))
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
      if (server.exitCode !== null) throw new Error(log)
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.ok(port, log)
    const url = `http://127.0.0.1:${port}`
    const listed = async () =>
      (
        (await (
          await fetch(
            `${url}/api/project-agents?limit=100&project=${encodeURIComponent(data)}`
          )
        ).json()) as { agents: Array<{ id: string; parent?: string }> }
      ).agents

    const tree = (await (
      await fetch(`${url}/api/agent/tree?agent=${parentId}`)
    ).json()) as { tree: Array<{ entry: { id: string } }> }
    const targetId = tree.tree[0]?.entry.id
    assert.ok(targetId, JSON.stringify(tree))
    const navigated = await fetch(
      `${url}/api/agent/tree?agent=${parentId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId }),
      }
    )
    assert.equal(navigated.status, 200, await navigated.clone().text())

    const agents = await listed()
    const replacement = agents.find(
      (agent) => agent.id !== subagentId && session.id !== parentId
    )
    assert.ok(replacement, JSON.stringify(agents))
    assert.equal(
      agents.find((agent) => agent.id === subagentId)?.parent,
      replacement.id
    )
  } finally {
    server.kill("SIGTERM")
    await exited
  }
})
