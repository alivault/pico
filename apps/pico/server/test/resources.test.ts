import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { test } from "node:test"

import {
  jobScopesAvailable,
  scopeLimits,
  validSize,
  wrapInScope,
} from "../src/services/containment.ts"
import {
  processTable,
  scopeMemory,
  treeOf,
  treeRss,
} from "../src/services/process-tree.ts"
import {
  collectResources,
  formatBytes,
  MemoryPressure,
} from "../src/services/resources.ts"
import { Terminals } from "../src/services/terminal.ts"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(check: () => boolean, ms = 8000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out")
    await sleep(25)
  }
}

void test("process trees add up the memory of a process and its children", async () => {
  const table = new Map([
    [1, { pid: 1, ppid: 0, rss: 100, command: "init" }],
    [10, { pid: 10, ppid: 1, rss: 1000, command: "job" }],
    [11, { pid: 11, ppid: 10, rss: 2000, command: "child" }],
    [12, { pid: 12, ppid: 11, rss: 3000, command: "grandchild" }],
    [20, { pid: 20, ppid: 1, rss: 5000, command: "other" }],
  ])
  assert.deepEqual(
    treeOf(table, 10).sort((a, b) => a - b),
    [10, 11, 12]
  )
  assert.equal(treeRss(table, 10), 6000)
  const real = await processTable()
  assert.ok((real.get(process.pid)?.rss ?? 0) > 0)
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(3 * 1024 ** 3), "3.0 GB")
})

void test("job scopes get limits from the settings", () => {
  assert.ok(validSize(""))
  assert.ok(validSize("off"))
  assert.ok(validSize("8G"))
  assert.ok(validSize("50%"))
  assert.ok(!validSize("lots"))
  const limits = scopeLimits({ jobMemoryHigh: "4G", jobMemoryMax: "off" })
  assert.deepEqual(limits, { memoryHigh: "4G" })
  const defaults = scopeLimits({ jobMemoryHigh: "", jobMemoryMax: "" })
  assert.ok(Number(defaults.memoryHigh) < Number(defaults.memoryMax))
  const line = wrapInScope("jx", "/bin/sh", ["-c", "true"], limits)
  assert.deepEqual(line.args.slice(0, 5), [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    "--unit=pico-job-jx",
  ])
  assert.deepEqual(line.args.slice(-5), [
    "MemoryHigh=4G",
    "--",
    "/bin/sh",
    "-c",
    "true",
  ])
})

/** Start a job with a child in the background, stop it, and find no orphans. */
async function stopLeavesNoOrphans(scoped: boolean) {
  const terminals = new Terminals()
  try {
    let exited = false
    const { pid } = await terminals.spawnJob(
      scoped ? "jscoped" : "jgroup",
      "sleep 30 & sleep 30",
      tmpdir(),
      {
        onOutput: () => undefined,
        onExit: () => {
          exited = true
        },
      },
      scoped ? { scope: { memoryMax: "1G" } } : {}
    )
    let tree: number[] = []
    await waitFor(() => false, 500).catch(() => undefined)
    tree = treeOf(await processTable(), pid)
    assert.ok(tree.length >= 2, `a job and its child: ${tree.join(", ")}`)
    if (scoped) assert.ok((await scopeMemory(pid)) !== undefined)
    assert.equal(terminals.stopJob(scoped ? "jscoped" : "jgroup", 500), true)
    await waitFor(() => exited)
    await waitFor(() => tree.every((item) => !alive(item)))
  } finally {
    terminals.shutdown()
  }
}

void test("a stopped job leaves no orphans (process group)", () =>
  stopLeavesNoOrphans(false))

void test("a job in its own systemd scope is counted and stopped as a whole", async (t) => {
  const previous = process.env.PICO_JOB_SCOPES
  delete process.env.PICO_JOB_SCOPES
  try {
    if (!(await jobScopesAvailable())) {
      t.skip("No systemd user manager here")
      return
    }
    await stopLeavesNoOrphans(true)
  } finally {
    if (previous !== undefined) process.env.PICO_JOB_SCOPES = previous
  }
})

void test("a job in a systemd scope gets its command unchanged", async (t) => {
  const previous = process.env.PICO_JOB_SCOPES
  delete process.env.PICO_JOB_SCOPES
  const terminals = new Terminals()
  try {
    if (!(await jobScopesAvailable())) {
      t.skip("No systemd user manager here")
      return
    }
    let output = ""
    let exited = false
    await terminals.spawnJob(
      "jexpand",
      'x=abc; echo "len=${#x} home=${HOME:+set}"',
      tmpdir(),
      {
        onOutput: (data) => {
          output += data
        },
        onExit: () => {
          exited = true
        },
      },
      { scope: {} }
    )
    await waitFor(() => exited)
    assert.match(output, /len=3 home=set/)
  } finally {
    if (previous !== undefined) process.env.PICO_JOB_SCOPES = previous
    terminals.shutdown()
  }
})

void test("idle shells close only when they run nothing but the shell", async () => {
  const previous = process.env.PICO_TERMINAL_SHELL
  process.env.PICO_TERMINAL_SHELL = "/bin/sh"
  const terminals = new Terminals({ idleShellMs: 0 })
  try {
    const idle = await terminals.create("scope:s1:/", tmpdir(), "idle", 80, 24)
    const busy = await terminals.create("scope:s1:/", tmpdir(), "busy", 80, 24)
    terminals.write("scope:s1:/", busy.id, "sleep 30\r", 1)
    await sleep(500)
    assert.equal(await terminals.closeIdleShells(Date.now() + 1000), 1)
    const left = terminals.agentShells("s1").map((shell) => shell.id)
    assert.deepEqual(left, [busy.id])
    assert.ok(!left.includes(idle.id))
  } finally {
    if (previous === undefined) delete process.env.PICO_TERMINAL_SHELL
    else process.env.PICO_TERMINAL_SHELL = previous
    terminals.shutdown()
  }
})

void test("memory pressure frees idle things and names the heaviest jobs, one time", async () => {
  const terminals = new Terminals()
  const sent: Array<{ title: string; body: string }> = []
  try {
    await terminals.spawnJob("jheavy", "sleep 30", tmpdir(), {
      onOutput: () => undefined,
      onExit: () => undefined,
    })
    let pressure = { some: 40, full: 10 }
    const watch = new MemoryPressure(
      {
        terminals,
        jobs: () => [
          {
            id: "jheavy",
            name: "big build",
            command: "sleep 30",
            startedAt: Date.now(),
            agentId: "s1",
          },
        ],
        dropTranscripts: () => 2,
        notifier: {
          send: async (message: { title: string; body: string }) => {
            sent.push(message)
            return 1
          },
        } as never,
        agentLink: (agentId) => `/?session=${agentId}`,
      },
      async () => pressure
    )
    const first = await watch.check()
    assert.equal(first?.freed.transcripts, 2)
    assert.equal(first?.notified, true)
    assert.match(sent[0]!.body, /big build/)
    // The same episode does nothing more.
    assert.equal(await watch.check(), undefined)
    pressure = { some: 1, full: 0 }
    assert.equal(await watch.check(), undefined)
    // A new episode frees again, but does not notify again so soon.
    pressure = { some: 40, full: 10 }
    const again = await watch.check()
    assert.equal(again?.notified, false)
    // The job still runs: pressure never stops a job.
    assert.ok(terminals.jobPid("jheavy"))

    const resources = await collectResources({
      terminals,
      jobs: () => [
        {
          id: "jheavy",
          name: "big build",
          command: "sleep 30",
          startedAt: Date.now(),
          agentId: "s1",
        },
      ],
    })
    assert.ok(resources.server.rss > 0)
    assert.equal(resources.terminals.jobs, 1)
    assert.ok((resources.jobs[0]?.memory ?? 0) > 0)
  } finally {
    terminals.shutdown()
  }
})
