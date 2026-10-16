import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

void test("server needs no token, refuses a second owner, and stops cleanly", async () => {
  const data = await mkdtemp(join(tmpdir(), "pico-test-"))
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(data, "agent"),
  }
  const args = [
    "dist/pico-server.mjs",
    "serve",
    "--host",
    "0.0.0.0",
    "--port",
    "0",
    "--data-dir",
    data,
    "--web-dir",
    "none",
  ]
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
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
    for (let i = 0; i < 150; i++) {
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
    assert.equal((await fetch(`${url}/api/system/health`)).status, 200)
    assert.equal(
      (
        await fetch(`${url}/api/system/health`, {
          headers: { origin: "https://evil.example" },
        })
      ).status,
      403
    )
    const manifest = (await (
      await fetch(`${url}/api/client/manifest`)
    ).json()) as { authentication: { type: string } }
    assert.equal(manifest.authentication.type, "none")
    const sidebar = async (path: string, body?: unknown) =>
      (await (
        await fetch(`${url}${path}`, {
          ...(body
            ? {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        })
      ).json()) as {
        directories: string[]
        pinnedSessionKeys: string[]
        initialized: boolean
      }
    assert.equal((await sidebar("/api/sidebar-state")).initialized, false)
    await sidebar("/api/sidebar-state", {
      clientId: "one",
      directories: ["/a"],
    })
    const merged = await sidebar("/api/sidebar-state/merge", {
      clientId: "two",
      directories: ["/b", "/a"],
      pinnedSessionKeys: ["s1"],
    })
    assert.deepEqual(merged.directories, ["/a", "/b"])
    assert.deepEqual((await sidebar("/api/sidebar-state")).pinnedSessionKeys, [
      "s1",
    ])
    assert.ok(JSON.parse(await readFile(join(data, "sidebar.json"), "utf8")))
    const duplicate = spawn(process.execPath, args, { env, stdio: "ignore" })
    const code = await new Promise((done) => duplicate.once("exit", done))
    assert.equal(code, 1)
    assert.equal(
      (await fetch(`${url}/api/system/shutdown`, { method: "POST" })).status,
      200
    )
    await exited
    assert.equal(child.exitCode, 0, log)
    await assert.rejects(readFile(join(data, "server.lock")), /ENOENT/)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await exited
    }
  }
})
