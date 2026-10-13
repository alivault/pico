import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

void test("server authenticates, refuses a second owner, and stops cleanly", async () => {
  const data = await mkdtemp(join(tmpdir(), "pico-test-"))
  const token = "pico-test-token-" + "a".repeat(32)
  const env = {
    ...process.env,
    PICO_TOKEN: token,
    PI_CODING_AGENT_DIR: join(data, "agent"),
  }
  const args = [
    "dist/pico-server.mjs",
    "serve",
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
    assert.equal((await fetch(`${url}/api/system/health`)).status, 401)
    const headers = { authorization: `Bearer ${token}` }
    assert.equal(
      (await fetch(`${url}/api/system/health`, { headers })).status,
      200
    )
    assert.equal(
      (
        await fetch(`${url}/api/system/health`, {
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
      403
    )
    const login = await fetch(`${url}/login`, {
      method: "POST",
      body: new URLSearchParams({ token }),
      redirect: "manual",
    })
    assert.equal(login.status, 303)
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!
    assert.equal(
      (await fetch(`${url}/api/system/health`, { headers: { cookie } })).status,
      200
    )
    const duplicate = spawn(process.execPath, args, { env, stdio: "ignore" })
    const code = await new Promise((done) => duplicate.once("exit", done))
    assert.equal(code, 1)
    assert.equal(
      (await fetch(`${url}/api/system/shutdown`, { method: "POST", headers }))
        .status,
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
