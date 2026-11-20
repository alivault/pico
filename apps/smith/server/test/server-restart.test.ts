import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
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
    "dist/smith-server.mjs",
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
  const data = await tempDir("smith-restart-test-")
  const child = spawn(process.execPath, serverArgs(data), {
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: join(data, "agent"),
      SMITH_SUPERVISED: "1",
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
      restart?: object
      update?: { available: boolean }
    }
    assert.deepEqual(health.restart, {})
    assert.equal(health.update?.available, false)
    const response = await fetch(`${url}/api/system/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
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
  const data = await tempDir("smith-restart-test-")
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(data, "agent"),
    SMITH_SUPERVISED: undefined,
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
      ["dist/smith-server.mjs", "restart", "--data-dir", data],
      { env, encoding: "utf8" }
    )
    assert.equal(restart.status, 0, restart.stderr + restart.stdout)
    assert.equal(await exited, 0)
    const after = await startedState(data, before.pid)
    assert.notEqual(after.pid, before.pid)
  } finally {
    spawnSync(
      process.execPath,
      ["dist/smith-server.mjs", "stop", "--wait", "--data-dir", data],
      { env }
    )
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await exited
    }
  }
})

/**
 * A fake OpenAI-compatible model. While `slow` is set, its answers come
 * after a minute (a restart cuts them off); later answers come at once.
 */
async function slowModel() {
  let requests = 0
  let slow = true
  const server = createServer((request, response) => {
    request.resume()
    request.on("end", () => {
      requests += 1
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "fake",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(chunk({ role: "assistant", content: "" }, null))
      const timer = setTimeout(
        () => {
          response.write(chunk({ content: `answer ${requests}` }, null))
          response.write(chunk({}, "stop"))
          response.end("data: [DONE]\n\n")
        },
        slow ? 60_000 : 10
      )
      response.on("close", () => clearTimeout(timer))
    })
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return {
    server,
    requests: () => requests,
    answerFast: () => {
      slow = false
    },
  }
}

void test("a restart does not wait for an active turn, and the turn continues", async () => {
  const data = await tempDir("smith-restart-test-")
  const project = await tempDir("smith-restart-project-")
  const model = await slowModel()
  const agentDir = join(data, "agent")
  await mkdir(agentDir, { recursive: true })
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl: `http://127.0.0.1:${(model.server.address() as AddressInfo).port}/v1`,
          api: "openai-completions",
          apiKey: "test",
          models: [
            {
              id: "fake",
              name: "Fake",
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    })
  )
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    SMITH_SUPERVISED: undefined,
  }
  const child = spawn(process.execPath, serverArgs(data), {
    env,
    stdio: "ignore",
  })
  const exited = new Promise<number | null>((done) =>
    child.once("exit", (code) => done(code))
  )
  // Not spawnSync: the fake model answers in this process.
  const cli = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (done) => {
        const command = spawn(
          process.execPath,
          ["dist/smith-server.mjs", ...args, "--data-dir", data],
          { env, stdio: ["ignore", "pipe", "pipe"] }
        )
        let stdout = ""
        let stderr = ""
        command.stdout.on("data", (chunk) => (stdout += chunk.toString()))
        command.stderr.on("data", (chunk) => (stderr += chunk.toString()))
        command.once("exit", (status) => done({ status, stdout, stderr }))
      }
    )
  try {
    const before = await startedState(data)
    const start = await cli([
      "agent",
      "start",
      project,
      "hello",
      "--model",
      "fake/fake",
    ])
    assert.equal(start.status, 0, start.stderr + start.stdout)
    for (let i = 0; i < 100 && model.requests() === 0; i++)
      await new Promise((done) => setTimeout(done, 100))
    assert.ok(model.requests() > 0)
    const health = (await (
      await fetch(`http://127.0.0.1:${before.port}/api/system/health`)
    ).json()) as { activeTurnCount: number }
    assert.equal(health.activeTurnCount, 1)

    // Without --now: the restart is at once all the same.
    model.answerFast()
    const started = Date.now()
    const restart = await cli(["restart"])
    assert.equal(restart.status, 0, restart.stderr + restart.stdout)
    assert.doesNotMatch(restart.stdout, /active turn/)
    assert.equal(await exited, 0)
    assert.ok(Date.now() - started < 30_000, "the restart waited")
    const after = await startedState(data, before.pid)
    assert.notEqual(after.pid, before.pid)

    // The new server continues the turn that the restart cut off.
    const list = await cli(["agent", "list", "--json"])
    assert.equal(list.status, 0, list.stderr)
    const agentId = (JSON.parse(list.stdout) as Array<{ id: string }>)[0]!.id
    const wait = await cli(["agent", "wait", agentId, "--timeout", "30"])
    assert.equal(wait.status, 0, wait.stderr + wait.stdout)
    assert.match(wait.stdout, /answer \d+/)
  } finally {
    await cli(["stop", "--wait"])
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await exited
    }
    model.server.closeAllConnections()
    model.server.close()
  }
})

/**
 * A fake OpenAI-compatible model whose first answer in a turn with tools
 * is one `job_start` call; after the tool result it answers with text.
 */
async function jobStartModel(agentDir: string, command: string) {
  let toolCalls = 0
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      const parsed = JSON.parse(body || "{}") as {
        tools?: unknown[]
        messages?: Array<{ role: string }>
      }
      const callTool =
        (parsed.tools?.length ?? 0) > 0 &&
        !parsed.messages?.some((message) => message.role === "tool")
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "fake",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`
      response.writeHead(200, { "content-type": "text/event-stream" })
      if (callTool) {
        toolCalls += 1
        response.write(
          chunk(
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_${toolCalls}`,
                  type: "function",
                  function: {
                    name: "job_start",
                    arguments: JSON.stringify({ command }),
                  },
                },
              ],
            },
            null
          )
        )
        response.write(chunk({}, "tool_calls"))
      } else {
        response.write(chunk({ role: "assistant", content: "done" }, null))
        response.write(chunk({}, "stop"))
      }
      response.end("data: [DONE]\n\n")
    })
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  await mkdir(agentDir, { recursive: true })
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
          api: "openai-completions",
          apiKey: "test",
          models: [
            {
              id: "fake",
              name: "Fake",
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    })
  )
  return { server, toolCalls: () => toolCalls }
}

// An agent ran `smith restart` as a job: the restart came while its
// job_start call waited for the job's first output. The server then exited
// with code 0 instead of the restart code, and the launcher stopped.
void test("a supervised server exits with the restart code while a job_start call waits", async () => {
  const data = await tempDir("smith-restart-test-")
  const project = await tempDir("smith-restart-project-")
  const agentDir = join(data, "agent")
  const model = await jobStartModel(agentDir, "sleep 30")
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    // The jobs run in a pty-host, as in a real Smith.
    SMITH_NO_PTY_HOST: undefined,
    SMITH_SUPERVISED: undefined,
  }
  const child = spawn(process.execPath, serverArgs(data), {
    env: { ...env, SMITH_SUPERVISED: "1" },
    stdio: "ignore",
  })
  const exited = new Promise<number | null>((done) =>
    child.once("exit", (code) => done(code))
  )
  const cli = (args: string[]) =>
    new Promise<{ status: number | null; output: string }>((done) => {
      const command = spawn(
        process.execPath,
        ["dist/smith-server.mjs", ...args, "--data-dir", data],
        { env, stdio: ["ignore", "pipe", "pipe"] }
      )
      let output = ""
      command.stdout.on("data", (chunk) => (output += chunk.toString()))
      command.stderr.on("data", (chunk) => (output += chunk.toString()))
      command.once("exit", (status) => done({ status, output }))
    })
  try {
    const state = await startedState(data)
    const url = `http://127.0.0.1:${state.port}`
    const start = await cli([
      "agent",
      "start",
      project,
      "hello",
      "--model",
      "fake/fake",
    ])
    assert.equal(start.status, 0, start.output)
    // Restart while the call waits (2 s by default) for the job's output.
    for (let i = 0; i < 100 && model.toolCalls() === 0; i++)
      await new Promise((done) => setTimeout(done, 50))
    assert.equal(model.toolCalls(), 1)
    await new Promise((done) => setTimeout(done, 300))
    const health = (await (await fetch(`${url}/api/system/health`)).json()) as {
      activeTurnCount: number
    }
    assert.equal(health.activeTurnCount, 1)
    const response = await fetch(`${url}/api/system/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    assert.equal(response.status, 200)
    assert.equal(await exited, 75)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await exited
    }
    // Stop the pty-host, and the job in it.
    await cli(["stop", "--pty-host"])
    model.server.closeAllConnections()
    model.server.close()
  }
})

void test("the launcher starts the server again, with its output in server.log", async () => {
  const data = await tempDir("smith-restart-test-")
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(data, "agent"),
    SMITH_SUPERVISED: undefined,
  }
  const launcher = spawn(
    process.execPath,
    [
      "../bin/smith.mjs",
      "serve",
      "--no-open",
      "--port",
      "0",
      "--data-dir",
      data,
      "--web-dir",
      "none",
    ],
    { env, stdio: "ignore" }
  )
  const exited = new Promise<number | null>((done) =>
    launcher.once("exit", (code) => done(code))
  )
  try {
    const before = await startedState(data)
    const restart = spawnSync(
      process.execPath,
      ["dist/smith-server.mjs", "restart", "--data-dir", data],
      { env, encoding: "utf8" }
    )
    assert.equal(restart.status, 0, restart.stderr + restart.stdout)
    const after = await startedState(data, before.pid)
    assert.notEqual(after.pid, before.pid)
    assert.equal(launcher.exitCode, null, "the launcher stopped")
    const log = await readFile(join(data, "server.log"), "utf8")
    assert.match(log, /Smith is restarting…/)
    assert.match(log, new RegExp(`restart: server pid ${after.pid}`))
  } finally {
    spawnSync(
      process.execPath,
      ["dist/smith-server.mjs", "stop", "--wait", "--data-dir", data],
      { env }
    )
    if (launcher.exitCode === null && launcher.signalCode === null) {
      launcher.kill("SIGTERM")
    }
    await exited
  }
})
