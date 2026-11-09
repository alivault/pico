/**
 * The MCP server and the `agent` command, end to end: a Pico server with a
 * fake OpenAI-compatible model, which answers `echo: <the last user text>`.
 * A message with SLOW gets its answer after 1.5 s.
 */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { test } from "node:test"

import { parseCommandArgs } from "../src/control/cli.ts"
import { stateOf } from "../src/control/agent-ops.ts"
import { tempDir } from "./support.ts"

function lastUserText(body: {
  messages?: Array<{ role: string; content: unknown }>
}) {
  const user = [...(body.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user")
  if (!user) return ""
  if (typeof user.content === "string") return user.content
  return (user.content as Array<{ type: string; text?: string }>)
    .map((part) => part.text ?? "")
    .join("")
}

/** An OpenAI-compatible chat completions server that streams one answer. */
async function fakeModel(): Promise<Server> {
  const server = createServer((request, response) => {
    let raw = ""
    request.on("data", (chunk) => (raw += chunk))
    request.on("end", () => {
      const body = JSON.parse(raw || "{}") as {
        messages?: Array<{ role: string; content: unknown }>
      }
      const text = lastUserText(body)
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "fake",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(chunk({ role: "assistant", content: "echo: " }, null))
      setTimeout(
        () => {
          response.write(chunk({ content: text }, null))
          response.write(chunk({}, "stop"))
          response.end("data: [DONE]\n\n")
        },
        text.includes("SLOW") ? 1500 : 10
      )
    })
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return server
}

async function startPico(data: string, modelPort: number) {
  const agentDir = join(data, "agent")
  await mkdir(agentDir, { recursive: true })
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
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
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir }
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
    { env, stdio: ["ignore", "pipe", "pipe"] }
  )
  let log = ""
  child.stdout.on("data", (chunk) => (log += chunk.toString()))
  child.stderr.on("data", (chunk) => (log += chunk.toString()))
  const exited = new Promise<void>((done) => child.once("exit", () => done()))
  let port: number | undefined
  for (let i = 0; i < 150 && !port; i++) {
    try {
      port = JSON.parse(await readFile(join(data, "server.json"), "utf8")).port
    } catch {
      if (child.exitCode !== null) throw new Error(log)
      await new Promise((done) => setTimeout(done, 100))
    }
  }
  assert.ok(port, log)
  return {
    url: `http://127.0.0.1:${port}`,
    env,
    log: () => log,
    async stop() {
      child.kill("SIGTERM")
      await exited
    },
  }
}

/** Run `pico-server agent …`; stdin is `input`. */
function cli(
  data: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  input?: string
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (done) => {
      const child = spawn(
        process.execPath,
        ["dist/pico-server.mjs", ...args, "--data-dir", data],
        { env, stdio: ["pipe", "pipe", "pipe"] }
      )
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()))
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()))
      child.stdin.end(input ?? "")
      child.once("exit", (code) => done({ code: code ?? -1, stdout, stderr }))
    }
  )
}

void test("the agent command parses arguments and states", () => {
  assert.deepEqual(
    parseCommandArgs(["start", "--wait", "goal", "--timeout", "5"]),
    {
      positional: ["start", "goal"],
      options: new Map<string, string | true>([
        ["wait", true],
        ["timeout", "5"],
      ]),
    }
  )
  assert.deepEqual(parseCommandArgs(["send", "s1", "--", "--not-a-flag"]), {
    positional: ["send", "s1", "--not-a-flag"],
    options: new Map(),
  })
  assert.throws(() => parseCommandArgs(["list", "--machine"]), /needs a value/)
  const base = {
    agentId: "s1",
    title: "t",
    cwd: "/",
    busy: false,
    needsInput: false,
  }
  // Older servers send no state.
  assert.equal(stateOf({ ...base, idle: true, answer: "hi" }), "done")
  assert.equal(stateOf({ ...base, idle: false }), "working")
  assert.equal(stateOf({ ...base, idle: true, waiting: "job x" }), "waiting")
  assert.equal(
    stateOf({ ...base, idle: false, needsInput: true }),
    "needs_input"
  )
  assert.equal(
    stateOf({ ...base, idle: true, answer: "(stopped before it answered)" }),
    "stopped"
  )
  assert.equal(
    stateOf({ ...base, idle: true, answer: "(the turn failed: x)" }),
    "failed"
  )
})

void test("the MCP server and the agent command start, message, and wait for agents", async () => {
  const data = await tempDir("pico-control-")
  const project = await tempDir("pico-control-project-")
  const model = await fakeModel()
  const pico = await startPico(data, (model.address() as AddressInfo).port)
  try {
    let rpcId = 0
    const rpc = async (method: string, params?: unknown) => {
      const response = await fetch(`${pico.url}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++rpcId,
          method,
          ...(params ? { params } : {}),
        }),
      })
      assert.equal(response.status, 200)
      return (await response.json()) as {
        result?: Record<string, unknown>
        error?: { code: number; message: string }
      }
    }
    const call = async (name: string, args: Record<string, unknown>) => {
      const answer = await rpc("tools/call", { name, arguments: args })
      assert.ok(answer.result, JSON.stringify(answer))
      return answer.result as {
        content: Array<{ text: string }>
        structuredContent?: Record<string, unknown>
        isError?: boolean
      }
    }

    // The protocol.
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    })
    assert.equal(init.result?.protocolVersion, "2025-06-18")
    assert.equal(
      (init.result?.serverInfo as { name: string } | undefined)?.name,
      "pico"
    )
    const notified = await fetch(`${pico.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    })
    assert.equal(notified.status, 202)
    assert.equal((await fetch(`${pico.url}/mcp`)).status, 405)
    assert.equal((await rpc("nope")).error?.code, -32601)
    const tools = (
      (await rpc("tools/list")).result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name)
    assert.deepEqual(tools, [
      "list_machines",
      "list_agents",
      "start_agent",
      "send_message",
      "search_agents",
      "read_agent",
      "wait_for_agent",
      "stop_agent",
    ])
    // A browser page on another site cannot call it.
    assert.equal(
      (
        await fetch(`${pico.url}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: "{}",
        })
      ).status,
      403
    )

    // Start an agent and wait for its answer.
    const started = await call("start_agent", {
      goal: "hello from mcp",
      cwd: project,
      model: "fake/fake",
      wait: true,
      timeout: 30,
    })
    assert.equal(started.isError, undefined, started.content[0]?.text)
    assert.equal(started.structuredContent?.state, "done")
    assert.equal(started.structuredContent?.answer, "echo: hello from mcp")
    const id = String(started.structuredContent?.id)
    assert.match(id, /^s\d+$/)

    // The agent's project shows in the sidebar.
    const sidebar = (await (
      await fetch(`${pico.url}/api/sidebar-state`)
    ).json()) as { projects: string[] }
    assert.ok(sidebar.projects.length === 1, JSON.stringify(sidebar))

    // A message, with the answer to that message.
    const sent = await call("send_message", {
      id,
      message: "second",
      wait: true,
    })
    assert.equal(sent.structuredContent?.answer, "echo: second")
    const listed = await call("list_agents", {})
    assert.match(listed.content[0]!.text, new RegExp(`^${id}\\s`))
    const read = await call("read_agent", { id })
    assert.match(read.content[0]!.text, /echo: second/)
    const missing = await call("read_agent", { id: "s999999" })
    assert.equal(missing.isError, true)
    assert.match(missing.content[0]!.text, /Unknown agent/)
    const unknownMachine = await call("list_agents", { machine: "nowhere" })
    assert.equal(unknownMachine.isError, true)

    // A wait that ends before the answer; then the answer.
    const slow = await call("send_message", {
      id,
      message: "SLOW one",
      wait: true,
      timeout: 0.3,
    })
    assert.equal(slow.structuredContent?.state, "working")
    const waited = await call("wait_for_agent", { id, timeout: 30 })
    assert.equal(waited.structuredContent?.state, "done")
    assert.equal(waited.structuredContent?.answer, "echo: SLOW one")

    // Search finds the agent by its messages, and reads around a hit.
    const found = await call("search_agents", { query: "hello mcp" })
    const matches = found.structuredContent?.agents as Array<{
      agentId: string
      hits: Array<{ entryId: number; snippet: string }>
    }>
    assert.equal(matches[0]?.agentId, id, found.content[0]!.text)
    assert.match(matches[0]!.hits[0]!.snippet, /\*\*hello\*\*/)
    const around = await call("read_agent", {
      id,
      entry: matches[0]!.hits[0]!.entryId,
    })
    assert.match(around.content[0]!.text, /hello from mcp/)
    const none = await call("search_agents", { query: "zebrafish" })
    assert.match(none.content[0]!.text, /No agent has messages/)

    // The command.
    const env = pico.env
    const start = await cli(data, env, [
      "agent",
      "start",
      project,
      "hello from the cli",
      "--model",
      "fake/fake",
      "--wait",
      "--timeout",
      "30",
    ])
    assert.equal(start.code, 0, start.stderr)
    assert.equal(start.stdout.trim(), "echo: hello from the cli")
    const list = await cli(data, env, ["agent", "list", "--json"])
    assert.equal(list.code, 0, list.stderr)
    const agents = JSON.parse(list.stdout) as Array<{ id: string }>
    assert.equal(agents.length, 2)
    const cliId = agents[0]!.id
    const send = await cli(
      data,
      env,
      ["agent", "send", cliId, "-", "--wait", "--json"],
      "from stdin\n"
    )
    assert.equal(send.code, 0, send.stderr)
    assert.deepEqual(JSON.parse(send.stdout), {
      id: cliId,
      state: "done",
      title: JSON.parse(send.stdout).title,
      answer: "echo: from stdin",
    })
    const timedOut = await cli(data, env, [
      "agent",
      "send",
      cliId,
      "SLOW two",
      "--wait",
      "--timeout",
      "0.3",
    ])
    assert.equal(timedOut.code, 3, timedOut.stdout + timedOut.stderr)
    const wait = await cli(data, env, ["agent", "wait", cliId])
    assert.equal(wait.code, 0, wait.stderr)
    assert.equal(wait.stdout.trim(), "echo: SLOW two")
    const show = await cli(data, env, ["agent", "show", cliId, "--last", "2"])
    assert.equal(show.code, 0, show.stderr)
    assert.match(show.stdout, /## Assistant\necho: SLOW two/)
    const search = await cli(data, env, [
      "agent",
      "search",
      "from",
      "stdin",
      "--json",
    ])
    assert.equal(search.code, 0, search.stderr)
    const searched = JSON.parse(search.stdout) as {
      agents: Array<{ agentId: string; hits: Array<{ entryId: number }> }>
    }
    assert.equal(searched.agents[0]?.agentId, cliId)
    const entry = searched.agents[0]!.hits[0]!.entryId
    const aroundCli = await cli(data, env, [
      "agent",
      "show",
      cliId,
      "--entry",
      String(entry),
    ])
    assert.equal(aroundCli.code, 0, aroundCli.stderr)
    assert.match(aroundCli.stdout, /from stdin/)
    const unknown = await cli(data, env, ["agent", "show", "s999999"])
    assert.equal(unknown.code, 1)
    assert.match(unknown.stderr, /Unknown agent/)
    const usage = await cli(data, env, ["agent", "send", cliId])
    assert.equal(usage.code, 1)
    assert.match(usage.stderr, /needs a message/)
    const mcp = await cli(data, env, ["mcp", "--json"])
    assert.deepEqual(JSON.parse(mcp.stdout), { url: `${pico.url}/mcp` })
  } catch (error) {
    console.error(pico.log())
    throw error
  } finally {
    await pico.stop()
    model.close()
  }
})
