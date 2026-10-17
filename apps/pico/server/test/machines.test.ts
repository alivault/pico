import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { Agent } from "node:http"
import { join } from "node:path"
import { test } from "node:test"

import {
  backoffMs,
  MachineManager,
  parseSummary,
  SseParser,
  type ManagerTimers,
} from "../src/machines/manager.ts"
import {
  findProfile,
  labelFromTarget,
  parseProfiles,
  readProfiles,
  writeProfiles,
  type MachineProfile,
} from "../src/machines/profiles.ts"
import { allowedRemotePath, machineRoute } from "../src/machines/proxy.ts"
import { applyStatePatch, OfflineCache } from "../src/machines/offline-cache.ts"
import {
  isAuthFailure,
  parseDiscovery,
  pickNode,
  picoCommand,
  versionAtLeast,
} from "../src/machines/remote.ts"
import { socketPath, targetArgs } from "../src/machines/ssh.ts"
import {
  shellQuote,
  TransportError,
  type ExecResult,
  type MachineTransport,
} from "../src/machines/transport.ts"
import { tempDir } from "./support.ts"

void test("machine profiles parse, validate, and round-trip", async () => {
  const machines = parseProfiles(
    JSON.stringify({
      version: 1,
      machines: [
        { id: "m_7f3a2c", label: "workbox", target: "ali@workbox" },
        {
          id: "m_000001",
          target: "ssh://ali@gpu.tail1234.ts.net:2222",
          dataDir: "~/pico-data",
          enabled: false,
        },
      ],
    })
  )
  assert.deepEqual(machines[0], {
    id: "m_7f3a2c",
    label: "workbox",
    target: "ali@workbox",
    dataDir: null,
    enabled: true,
  })
  assert.equal(machines[1]!.label, "gpu")
  assert.equal(machines[1]!.enabled, false)
  assert.equal(findProfile(machines, "WORKBOX")?.id, "m_7f3a2c")
  assert.equal(findProfile(machines, "m_000001")?.label, "gpu")

  assert.throws(() => parseProfiles("{"))
  assert.throws(() => parseProfiles(JSON.stringify({ version: 2 })), /version/)
  assert.throws(
    () =>
      parseProfiles(
        JSON.stringify({
          version: 1,
          machines: [{ id: "m_aaaa", target: "-oProxyCommand=evil" }],
        })
      ),
    /Invalid SSH target/
  )
  assert.throws(
    () =>
      parseProfiles(
        JSON.stringify({
          version: 1,
          machines: [
            { id: "m_aaaa", target: "a" },
            { id: "m_aaaa", target: "b" },
          ],
        })
      ),
    /Duplicate/
  )

  const file = join(await tempDir("pico-machines-"), "machines.json")
  assert.deepEqual(readProfiles(file), [])
  writeProfiles(file, machines)
  assert.deepEqual(readProfiles(file), machines)

  assert.equal(labelFromTarget("ali@workbox.tail1234.ts.net"), "workbox")
  assert.equal(labelFromTarget("100.101.102.103"), "100.101.102.103")
  assert.equal(labelFromTarget("ssh://ali@box:2222"), "box")
})

void test("SSH helpers quote, split targets, and keep socket paths short", () => {
  assert.equal(shellQuote("/usr/bin/node"), "/usr/bin/node")
  assert.equal(shellQuote("a b"), "'a b'")
  assert.equal(shellQuote("it's"), `'it'"'"'s'`)
  assert.deepEqual(targetArgs("ali@workbox"), ["ali@workbox"])
  assert.deepEqual(targetArgs("ssh://ali@workbox:2222"), [
    "-p",
    "2222",
    "ali@workbox",
  ])
  assert.deepEqual(targetArgs("ssh://workbox"), ["workbox"])
  const long = socketPath(`/tmp/${"x".repeat(120)}`, "ssh.sock")
  assert.ok(Buffer.byteLength(long) <= 80, long)
  assert.equal(socketPath("/tmp/m", "ssh.sock"), "/tmp/m/ssh.sock")
})

void test("remote discovery picks a new enough node and the first pico-app", () => {
  const found = parseDiscovery(
    [
      "os=Linux",
      "home=/home/ali",
      "node=/usr/bin v18.19.0",
      "node=/home/ali/.nvm/versions/node/v22.20.0/bin v22.20.0",
      "node=/usr/bin v18.19.0",
      "pico=/home/ali/.local/bin/pico-app",
    ].join("\n")
  )
  assert.equal(found.os, "Linux")
  assert.equal(found.nodes.length, 2)
  assert.equal(
    pickNode(found)?.dir,
    "/home/ali/.nvm/versions/node/v22.20.0/bin"
  )
  assert.ok(versionAtLeast("v22.19.0", [22, 19]))
  assert.ok(!versionAtLeast("v22.18.9", [22, 19]))
  assert.ok(versionAtLeast("v23.0.0", [22, 19]))
  assert.deepEqual(
    picoCommand({ nodeDir: "/n", picoPath: "/p/pico-app" }, { dataDir: "/d" }, [
      "status",
      "--json",
    ]),
    [
      "env",
      "PATH=/n:/usr/local/bin:/usr/bin:/bin",
      "PICO_OPEN=0",
      "/p/pico-app",
      "status",
      "--json",
      "--data-dir",
      "/d",
    ]
  )
  assert.ok(isAuthFailure("ali@workbox: Permission denied (publickey)."))
  assert.ok(isAuthFailure("Host key verification failed."))
  assert.ok(!isAuthFailure("ssh: connect to host workbox port 22: timed out"))
})

void test("the proxy accepts only machine API paths", () => {
  assert.deepEqual(machineRoute("/m/m_abc/api/prompt?context=x"), {
    machineId: "m_abc",
    path: "/api/prompt",
    search: "?context=x",
  })
  assert.equal(machineRoute("/api/prompt"), undefined)
  assert.ok(allowedRemotePath("/events"))
  assert.ok(allowedRemotePath("/api/git-status"))
  assert.ok(!allowedRemotePath("/api/system/shutdown"))
  assert.ok(!allowedRemotePath("/index.html"))
  assert.ok(!allowedRemotePath("/api/../events"))
})

void test("the SSE parser joins data lines and skips comments", () => {
  const events: string[] = []
  const parser = new SseParser((data) => events.push(data))
  parser.push(': keepalive\n\nid: 3\ndata: {"a":')
  parser.push("1}\n\ndata: x\ndata: y\n\n")
  assert.deepEqual(events, ['{"a":1}', "x\ny"])
  assert.equal(parseSummary({ sessions: "no" }), undefined)
  assert.equal(
    parseSummary({ sessions: [{ id: "s1", busy: true }] })?.sessions[0]?.busy,
    true
  )
})

void test("the offline cache follows state patches and session lists", () => {
  assert.deepEqual(
    applyStatePatch(
      { type: "state_sync", sessionId: "s1", items: [1, 2, 3] },
      {
        type: "state_sync",
        itemsPatch: {
          previousLength: 3,
          start: 1,
          deleteCount: 1,
          items: [9, 8],
        },
        isStreaming: true,
      }
    ),
    {
      type: "state_sync",
      sessionId: "s1",
      items: [1, 9, 8, 3],
      isStreaming: true,
    }
  )
  assert.equal(
    applyStatePatch(
      { items: [1] },
      { itemsPatch: { previousLength: 2, start: 0, deleteCount: 0, items: [] } }
    ),
    undefined
  )

  const cache = new OfflineCache()
  const observe = cache.observeStream("ctx")
  observe({ type: "state_sync", sessionId: "s1", items: ["a"] })
  observe({
    type: "state_sync",
    itemsPatch: { previousLength: 1, start: 1, deleteCount: 0, items: ["b"] },
  })
  observe({ type: "sessions", directories: ["/p"] })
  const [state, sessions] = cache.bootstrap("ctx", "s1")
  assert.deepEqual(state?.items, ["a", "b"])
  assert.deepEqual(sessions?.directories, ["/p"])
  assert.deepEqual(cache.bootstrap("other", undefined), [])

  cache.putResponse("/api/a", "application/json", Buffer.from("{}"))
  assert.equal(cache.response("/api/a")?.body.toString(), "{}")
  assert.equal(cache.response("/api/b"), undefined)
  assert.deepEqual(
    parseSummary({ sessions: [{ id: "s1", unreadBy: ["ctx", 3] }] })
      ?.sessions[0]?.unreadBy,
    ["ctx"]
  )
})

/** Timers that run only when the test says so. */
function manualTimers() {
  let now = 1_000_000
  let next = 0
  const pending = new Map<number, { at: number; callback: () => void }>()
  const timers: ManagerTimers = {
    now: () => now,
    setTimeout(callback, ms) {
      next += 1
      pending.set(next, { at: now + ms, callback })
      return next
    },
    clearTimeout(handle) {
      pending.delete(handle as number)
    },
  }
  return {
    timers,
    /** The delays of the waiting timers, from now. */
    delays: () => [...pending.values()].map((entry) => entry.at - now),
    /** Move the clock to the next timer and run it. */
    async runNext() {
      const [id, entry] = [...pending.entries()].sort(
        (left, right) => left[1].at - right[1].at
      )[0]!
      pending.delete(id)
      now = Math.max(now, entry.at)
      entry.callback()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
      await new Promise((resolve) => setImmediate(resolve))
    },
    advance(ms: number) {
      now += ms
    },
  }
}

class FailingTransport implements MachineTransport {
  error: Error
  connects = 0
  constructor(error: Error) {
    this.error = error
  }
  async connect() {
    this.connects += 1
    throw this.error
  }
  async exec(): Promise<ExecResult> {
    return { code: 0, stdout: "", stderr: "" }
  }
  async attach() {}
  endpoint() {
    return { host: "127.0.0.1", port: 9 }
  }
  agent() {
    return new Agent()
  }
  async forward() {
    return { localPort: 0, close: async () => undefined }
  }
  async close() {}
}

async function managerWith(
  profile: Partial<MachineProfile>,
  transport: MachineTransport
) {
  const dir = await tempDir("pico-machines-")
  const file = join(dir, "machines.json")
  writeProfiles(file, [
    {
      id: "m_aaaaaa",
      label: "workbox",
      target: "workbox",
      dataDir: null,
      enabled: true,
      ...profile,
    },
  ])
  const clock = manualTimers()
  const manager = new MachineManager({
    machinesFile: file,
    machinesDir: join(dir, "machines"),
    transport: () => transport,
    timers: clock.timers,
    watch: false,
  })
  return { manager, clock, file }
}

void test("network failures back off up to two minutes", async () => {
  const transport = new FailingTransport(
    new TransportError(
      "ssh: connect to host workbox: Connection refused",
      255,
      ""
    )
  )
  const { manager, clock } = await managerWith({}, transport)
  manager.start()
  assert.equal(manager.list()[0]!.state, "connecting")
  const delays: number[] = []
  for (let attempt = 0; attempt < 9; attempt += 1) {
    await clock.runNext()
    assert.equal(manager.list()[0]!.state, "offline")
    assert.equal(manager.list()[0]!.problem?.kind, "error")
    delays.push(clock.delays()[0]!)
  }
  assert.deepEqual(
    delays,
    [1, 2, 5, 15, 30, 60, 120, 120, 120].map((seconds) => seconds * 1000)
  )
  assert.equal(backoffMs(0), 1000)
  assert.equal(transport.connects, 9)

  // A manual retry starts at once and resets the backoff.
  manager.retry("workbox")
  await clock.runNext()
  assert.equal(clock.delays()[0], 1000)
  await manager.close()
})

void test("auth failures need attention and retry every 30 seconds", async () => {
  const transport = new FailingTransport(
    new TransportError(
      "ali@workbox: Permission denied (publickey).",
      255,
      "ali@workbox: Permission denied (publickey)."
    )
  )
  const { manager, clock } = await managerWith({}, transport)
  manager.start()
  await clock.runNext()
  const info = manager.list()[0]!
  assert.equal(info.state, "attention")
  assert.equal(info.problem?.kind, "auth")
  assert.match(
    info.problem?.message ?? "",
    /pico-app machine reconnect workbox/
  )
  assert.deepEqual(clock.delays(), [30_000])
  await manager.close()
})

void test("disabled profiles do not connect, and file changes apply", async () => {
  const transport = new FailingTransport(new Error("down"))
  const { manager, clock, file } = await managerWith(
    { enabled: false },
    transport
  )
  manager.start()
  assert.equal(manager.list()[0]!.state, "disabled")
  assert.deepEqual(clock.delays(), [])

  writeFileSync(file, "{ bad json")
  manager.reload()
  assert.match(manager.fileError ?? "", /not valid/)
  assert.equal(manager.list().length, 1)

  assert.throws(() => manager.rename("workbox", "box"))
  writeProfiles(file, [])
  manager.reload()
  assert.equal(manager.fileError, undefined)
  assert.equal(manager.list().length, 0)
  await manager.close()
})

// -----------------------------------------------------------------------------
// A hub and a remote Pico on this computer, with a fake transport.

type Started = {
  url: string
  port: number
  data: string
  stop(): Promise<void>
}

/** Bundle the test hub like the server (see `build.mjs`). */
async function buildLocalHub() {
  const esbuild = await import("esbuild")
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>
  }
  const external = Object.keys(pkg.dependencies).filter(
    (name) => name !== "pi-web-access"
  )
  await esbuild.build({
    entryPoints: ["test/fixtures/local-hub.ts"],
    // In node_modules: the checks skip it, and it finds the dependencies.
    outfile: "node_modules/.cache/pico-test/local-hub.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
    external: [...external, ...external.map((name) => `${name}/*`)],
    banner: {
      js: [
        'import { createRequire as __picoCreateRequire } from "node:module";',
        "const require = __picoCreateRequire(import.meta.url);",
      ].join("\n"),
    },
  })
  return "node_modules/.cache/pico-test/local-hub.mjs"
}

async function startPico(
  data: string,
  args = [
    "dist/pico-server.mjs",
    "serve",
    "--port",
    "0",
    "--data-dir",
    data,
    "--web-dir",
    "none",
  ]
): Promise<Started> {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, PI_CODING_AGENT_DIR: join(data, "agent") },
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
  let port: number | undefined
  for (let i = 0; i < 150 && !port; i++) {
    try {
      port = JSON.parse(await readFile(join(data, "server.json"), "utf8")).port
    } catch {
      await new Promise((done) => setTimeout(done, 100))
    }
    if (child.exitCode !== null) throw new Error(log)
  }
  assert.ok(port, log)
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    data,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM")
        await exited
      }
    },
  }
}

async function until<T>(read: () => Promise<T | undefined>, ms = 10_000) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error("Timed out")
    await new Promise((done) => setTimeout(done, 100))
  }
}

void test("a hub proxies HTTP, SSE, and terminals to a remote machine", async () => {
  const remoteData = await tempDir("pico-remote-")
  const hubData = await tempDir("pico-hub-")
  const remote = await startPico(remoteData)
  writeProfiles(join(hubData, "machines.json"), [
    {
      id: "m_remote",
      label: "workbox",
      target: "workbox",
      dataDir: null,
      enabled: true,
    },
  ])
  const hub = await startPico(hubData, [
    await buildLocalHub(),
    hubData,
    String(remote.port),
  ])
  try {
    const online = await until(async () => {
      const list = (await (await fetch(`${hub.url}/api/machines`)).json()) as {
        machines: Array<{ id: string; state: string; problem?: unknown }>
      }
      const machine = list.machines.find((entry) => entry.id === "m_remote")
      return machine?.state === "online" ? list : undefined
    })
    assert.equal(online.machines[0]!.id, "local")

    // HTTP through the proxy.
    const manifest = (await (
      await fetch(`${hub.url}/m/m_remote/api/client/manifest`)
    ).json()) as { capabilities: { features: string[] } }
    assert.ok(manifest.capabilities.features.includes("machine-hub"))
    const summary = (await (
      await fetch(`${hub.url}/m/m_remote/api/machine/summary`)
    ).json()) as { ok: boolean; sessions: unknown[] }
    assert.equal(summary.ok, true)
    assert.deepEqual(summary.sessions, [])
    assert.equal(
      (await fetch(`${hub.url}/m/m_remote/api/machine/session/read?id=s999`))
        .status,
      404
    )

    // The hub's machine stream starts with all machines.
    const machinesAbort = new AbortController()
    const machineEvents = await fetch(`${hub.url}/api/machines/events`, {
      signal: machinesAbort.signal,
    })
    const first = Buffer.from(
      (await machineEvents.body!.getReader().read()).value!
    ).toString("utf8")
    assert.match(first, /"type":"machines"/)
    assert.match(first, /m_remote/)
    machinesAbort.abort()
    const directory = (await (
      await fetch(`${hub.url}/m/m_remote/api/directory/resolve?context=t`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: remoteData }),
      })
    ).json()) as { ok: boolean; path: string }
    assert.equal(directory.ok, true)

    // The browser checks still apply, and shutdown never goes through.
    assert.equal(
      (
        await fetch(`${hub.url}/m/m_remote/api/system/health`, {
          headers: { origin: "https://evil.example" },
        })
      ).status,
      403
    )
    assert.equal(
      (
        await fetch(`${hub.url}/m/m_remote/api/system/shutdown`, {
          method: "POST",
        })
      ).status,
      403
    )
    assert.equal((await fetch(`${hub.url}/m/m_remote/`)).status, 403)
    assert.equal((await fetch(`${hub.url}/m/m_nope/api/x`)).status, 404)

    // SSE streams through without buffering.
    const abort = new AbortController()
    const events = await fetch(`${hub.url}/m/m_remote/events?context=t`, {
      signal: abort.signal,
    })
    assert.equal(events.status, 200)
    const reader = events.body!.getReader()
    let text = ""
    while (!text.includes("state_sync")) {
      const { value, done } = await reader.read()
      if (done) break
      text += Buffer.from(value).toString("utf8")
    }
    assert.match(text, /state_sync/)
    abort.abort()

    // A terminal WebSocket through the proxy.
    const scope = new URLSearchParams({
      context: "t",
      sessionKey: `draft:${remoteData}`,
    }).toString()
    const created = (await (
      await fetch(`${hub.url}/m/m_remote/api/terminal?${scope}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: remoteData }),
      })
    ).json()) as { ok: boolean; id: string }
    assert.equal(created.ok, true)
    const socket = new WebSocket(
      `ws://127.0.0.1:${hub.port}/m/m_remote/api/terminal/${created.id}/ws?${scope}`
    )
    const ready = await new Promise<string>((resolve, reject) => {
      socket.onmessage = (message) => resolve(String(message.data))
      socket.onerror = () => reject(new Error("WebSocket failed"))
    })
    assert.match(ready, /"type":"ready"/)
    socket.close()

    // The hub sees the remote stop and answers 503 at once.
    await remote.stop()
    await until(async () => {
      const list = (await (await fetch(`${hub.url}/api/machines`)).json()) as {
        machines: Array<{ id: string; state: string; summary?: unknown }>
      }
      const machine = list.machines.find((entry) => entry.id === "m_remote")
      return machine && machine.state !== "online" ? machine : undefined
    })
    const offline = await fetch(`${hub.url}/m/m_remote/api/system/health`)
    assert.equal(offline.status, 503)
    assert.equal(((await offline.json()) as { state: string }).state, "offline")
    // The offline view: copies of GET answers and the last event state.
    const cached = await fetch(`${hub.url}/m/m_remote/api/client/manifest`)
    assert.equal(cached.status, 200)
    assert.equal(cached.headers.get("x-pico-offline"), "1")
    const offlineAbort = new AbortController()
    const offlineEvents = await fetch(
      `${hub.url}/m/m_remote/events?context=t`,
      { signal: offlineAbort.signal }
    )
    assert.equal(offlineEvents.status, 200)
    const offlineReader = offlineEvents.body!.getReader()
    let offlineText = ""
    while (!offlineText.includes("state_sync")) {
      const { value, done } = await offlineReader.read()
      if (done) break
      offlineText += Buffer.from(value).toString("utf8")
    }
    assert.match(offlineText, /state_sync/)
    assert.doesNotMatch(offlineText, /^id:/m)
    offlineAbort.abort()
    assert.equal(
      (
        await fetch(`${hub.url}/m/m_remote/api/prompt?context=t`, {
          method: "POST",
          body: "{}",
        })
      ).status,
      503
    )

    // The local machine still works.
    assert.equal((await fetch(`${hub.url}/api/system/health`)).status, 200)
  } finally {
    await hub.stop()
    await remote.stop()
  }
})
