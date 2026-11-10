import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { tempDir } from "./support.ts"

type State = { pid: number; port: number }

async function startedState(data: string, notPid?: number) {
  for (let i = 0; i < 200; i++) {
    try {
      const state = JSON.parse(
        await readFile(join(data, "server.json"), "utf8")
      ) as State
      if (state.pid !== notPid) {
        const health = await fetch(
          `http://127.0.0.1:${state.port}/api/system/health`
        )
        if (health.ok) return state
      }
    } catch {
      /* Wait for startup. */
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error("The server did not start")
}

function serverArgs(data: string) {
  return [
    "dist/pico-server.mjs",
    "serve",
    "--port",
    "0",
    "--data-dir",
    data,
    "--web-dir",
    "none",
  ]
}

void test("a supervised server exits with the restart code", async () => {
  const data = await tempDir("pico-restart-test-")
  const child = spawn(process.execPath, serverArgs(data), {
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: join(data, "agent"),
      PICO_SUPERVISED: "1",
    },
    stdio: "ignore",
  })
  const exited = new Promise<number | null>((done) =>
    child.once("exit", (code) => done(code))
  )
  try {
    const state = await startedState(data)
    const url = `http://127.0.0.1:${state.port}`
    const health = (await (await fetch(`${url}/api/system/health`)).json()) as {
      restart?: { pending: boolean }
      update?: { available: boolean }
    }
    assert.deepEqual(health.restart, { pending: false })
    assert.equal(health.update?.available, false)
    const response = await fetch(`${url}/api/system/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ now: true }),
    })
    assert.equal(response.status, 200)
    assert.equal(await exited, 75)
    await assert.rejects(readFile(join(data, "server.lock")), /ENOENT/)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await exited
    }
  }
})

void test("a server without a launcher starts itself again", async () => {
  const data = await tempDir("pico-restart-test-")
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(data, "agent"),
    PICO_SUPERVISED: undefined,
  }
  const child = spawn(process.execPath, serverArgs(data), {
    env,
    stdio: "ignore",
  })
  const exited = new Promise<number | null>((done) =>
    child.once("exit", (code) => done(code))
  )
  try {
    const before = await startedState(data)
    const restart = spawnSync(
      process.execPath,
      ["dist/pico-server.mjs", "restart", "--data-dir", data],
      { env, encoding: "utf8" }
    )
    assert.equal(restart.status, 0, restart.stderr + restart.stdout)
    assert.equal(await exited, 0)
    const after = await startedState(data, before.pid)
    assert.notEqual(after.pid, before.pid)
  } finally {
    spawnSync(
      process.execPath,
      ["dist/pico-server.mjs", "stop", "--wait", "--data-dir", data],
      { env }
    )
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await exited
    }
  }
})
