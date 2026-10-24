import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { ptyHostPaths } from "../src/pty-host/protocol.ts"
import { HostPtyBackend, type PtyEnd } from "../src/services/pty-backend.ts"
import { Terminals } from "../src/services/terminal.ts"
import { tempDir } from "./support.ts"

// Tests start real pty-host processes, one for each temp data directory.
process.env.PICO_PTY_HOST_SYSTEMD = "0"
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "pty-host.mjs"
)

function server(dataDir: string) {
  return new Terminals({
    dataDir,
    backend: new HostPtyBackend({ dataDir, script, version: "test" }),
  })
}

function hostPid(dataDir: string) {
  try {
    return Number(readFileSync(ptyHostPaths(dataDir).pidFile, "utf8").trim())
  } catch {
    return 0
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function eventually<T>(read: () => T | undefined, ms = 8000) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = read()
    if (value !== undefined && value !== false) return value
    if (Date.now() > deadline) throw new Error("Timed out")
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Stop the host of a data directory, as a user would. */
async function stopHost(dataDir: string) {
  const pid = hostPid(dataDir)
  if (!pid || !alive(pid)) return
  process.kill(pid, "SIGTERM")
  await eventually(() => !alive(pid))
}

const noHandlers = {
  onOutput: () => undefined,
  onExit: () => undefined,
}

void test("jobs and shells keep running over a server restart", async () => {
  const dataDir = await tempDir()
  let terminals = server(dataDir)
  try {
    await terminals.start()
    await terminals.spawnJob(
      "jkeep",
      "echo before; read line; echo got-$line; sleep 0.3; exit 3",
      dataDir,
      { ...noHandlers, label: "keep" }
    )
    const shell = await terminals.create("scope", dataDir, "tab-1", 80, 24)
    const shellView = terminals.subscribe(
      "scope",
      shell.id,
      undefined,
      () => {}
    )
    terminals.write("scope", shell.id, "echo shell-$((40+2))\r", 1, "v1")
    shellView.unsubscribe()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const pid = hostPid(dataDir)
    assert.ok(pid > 0 && pid !== process.pid)

    // The server stops: the host and its ptys go on.
    terminals.shutdown()
    assert.ok(alive(pid))
    terminals = server(dataDir)
    assert.equal(await terminals.start(), 2)
    assert.equal(hostPid(dataDir), pid)

    // The shell comes back for its tab, with its history and input state.
    const again = await terminals.create("scope", dataDir, "tab-1")
    assert.equal(again.reused, true)
    const view = terminals.subscribe(
      "scope",
      again.id,
      undefined,
      () => {},
      "v1"
    )
    const ready = view.initial[0]
    if (ready?.type === "ready") assert.equal(ready.nextInputSeq, 2)
    assert.ok(
      view.initial.some(
        (event) => event.type === "output" && event.data.includes("shell-42")
      )
    )
    view.unsubscribe()

    // The job: the new server takes it over and gets its exit.
    let output = ""
    let end: PtyEnd | undefined
    const adopted = terminals.adoptJob("jkeep", {
      onOutput: (data) => {
        output += data
      },
      onExit: (exit) => {
        end = exit
      },
    })
    assert.ok(adopted && !adopted.exited)
    terminals.writeForAgent(adopted.terminalId, "hello\r")
    await eventually(() => end)
    assert.equal(end?.exitCode, 3)
    assert.match(output, /got-hello/)
    // The host wrote the job's log.
    assert.match(
      readFileSync(join(dataDir, "jobs", "jkeep.log"), "utf8"),
      /before[\s\S]*got-hello/
    )
  } finally {
    terminals.shutdown()
    await stopHost(dataDir)
  }
})

void test("a job that ends while the server is down, and while the host restarts, keeps its exit", async () => {
  const dataDir = await tempDir()
  let terminals = server(dataDir)
  try {
    await terminals.start()
    await terminals.spawnJob("jdown", "sleep 0.3; exit 7", dataDir, noHandlers)
    terminals.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 800))
    // The job ended with no server. Then the host stops too: its exit
    // journal keeps the end for the next host.
    await stopHost(dataDir)
    terminals = server(dataDir)
    assert.equal(await terminals.start(), 1)
    const adopted = terminals.adoptJob("jdown", noHandlers)
    assert.deepEqual(adopted?.exited, { exitCode: 7 })
    // The server recorded it: the host forgets it.
    terminals.forgetJob("jdown")
    await new Promise((resolve) => setTimeout(resolve, 200))
    terminals.shutdown()
    terminals = server(dataDir)
    assert.equal(await terminals.start(), 0)
  } finally {
    terminals.shutdown()
    await stopHost(dataDir)
  }
})

void test("a host that crashes makes its jobs lost; a stale lock and socket do not block a new host", async () => {
  const dataDir = await tempDir()
  let terminals = server(dataDir)
  try {
    await terminals.start()
    let end: PtyEnd | undefined
    await terminals.spawnJob("jcrash", "sleep 30", dataDir, {
      onOutput: () => undefined,
      onExit: (exit) => {
        end = exit
      },
    })
    const pid = hostPid(dataDir)
    process.kill(pid, "SIGKILL")
    await eventually(() => end)
    assert.equal(end?.lost, true)
    terminals.shutdown()

    // The crash left the pid file and the socket. Make the pid a dead one.
    const paths = ptyHostPaths(dataDir)
    writeFileSync(paths.pidFile, "999999")
    mkdirSync(dirname(paths.socket), { recursive: true })
    terminals = server(dataDir)
    assert.equal(await terminals.start(), 0)
    const fresh = hostPid(dataDir)
    assert.ok(fresh !== pid && alive(fresh))
    const shell = await terminals.create("scope", dataDir, "tab", 80, 24)
    assert.equal(shell.reused, false)
  } finally {
    terminals.shutdown()
    await stopHost(dataDir)
  }
})
