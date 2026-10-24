import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { Harness, createRegistry } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { SessionDoc, publicId } from "../src/core/sessions.ts"
import { tempDir } from "./support.ts"

void test("an open event stream follows session selection and moves its live watcher", async () => {
  const data = await tempDir("pico-switch-test-")
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(data, "pico.sqlite")),
    { models: createModels(), registry: createRegistry() },
    ctx
  )
  const ids: string[] = []
  try {
    for (const name of ["First", "Second"]) {
      const conversation = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { cwd: data },
          init: async (tx, id) => {
            Object.assign(await tx.doc(SessionDoc, id), {
              cwd: data,
              name,
              createdAt: Date.now(),
              modifiedAt: Date.now(),
              firstMessage: name,
              messageCount: 1,
            })
            await tx.appendEntry(id, {
              kind: "pi.user",
              model: [{ role: "user", content: name, timestamp: Date.now() }],
            })
          },
        },
        ctx
      )
      ids.push(publicId(conversation.id))
    }
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
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 15000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
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
    const response = await fetch(
      `${url}/events?context=browser&session=${ids[0]}`,
      { signal: abort.signal }
    )
    assert.equal(response.status, 200)
    reader = response.body!.getReader()
    let buffer = ""
    const decoder = new TextDecoder()
    async function nextState() {
      while (true) {
        const end = buffer.indexOf("\n\n")
        if (end >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const line = block
            .split("\n")
            .find((part) => part.startsWith("data: "))
          if (!line) continue
          const event = JSON.parse(line.slice(6)) as {
            type: string
            sessionId?: string
            sessionName?: string
            items?: unknown[]
          }
          if (event.type === "state_sync") return event
          continue
        }
        const chunk = await reader!.read()
        if (chunk.done) throw new Error("Event stream closed")
        buffer += decoder.decode(chunk.value, { stream: true })
      }
    }
    assert.equal((await nextState()).sessionId, ids[0])
    const selection = await fetch(
      `${url}/api/session/select?context=browser&session=${ids[1]}`,
      { method: "POST" }
    )
    assert.equal(selection.status, 200)
    const selected = await nextState()
    assert.equal(selected.sessionId, ids[1])
    assert.equal(selected.items?.length, 1)
    const renamed = await fetch(`${url}/api/session/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `pico:${ids[1]}`, name: "Renamed second" }),
    })
    assert.equal(renamed.status, 200)
    assert.equal((await nextState()).sessionName, "Renamed second")
  } finally {
    clearTimeout(timeout)
    abort.abort()
    await reader?.cancel().catch(() => undefined)
    child.kill("SIGTERM")
    await exited
  }
})
