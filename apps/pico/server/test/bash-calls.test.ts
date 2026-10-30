import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { test } from "node:test"

import {
  almostIdle,
  checkBashCalls,
  endBashCall,
  formatDuration,
  sampleProcesses,
  startBashCall,
  STALL_MS,
  type ProcessSample,
} from "../src/core/bash-calls.ts"
import { HostBridge, type HostServices } from "../src/extensions/host.ts"
import { runningToolLines } from "../src/extensions/agents.ts"

function sample(cpuMs: number, io: number, at = 0): ProcessSample {
  return {
    at,
    processes: new Map([[100, { cpuMs, io, command: "nvim" }]]),
  }
}

/** A host with a parent `s1` and a child `s2`; `followUp` records messages. */
function fakeHost(
  sent: Array<{ id: string; message: string; requestId: string }>
) {
  const metas: Record<string, { cwd: string; parent?: string }> = {
    s1: { cwd: "/" },
    s2: { cwd: "/", parent: "s1" },
  }
  const host = new HostBridge()
  host.bind({
    agents: {
      has: (id: string | undefined) => id !== undefined && id in metas,
      meta: (id: string) => metas[id],
      list: () => [{ id: "s2", title: "Child" }],
      followUp: (id: string, message: string, requestId: string) => {
        sent.push({ id, message, requestId })
        return Promise.resolve()
      },
    },
  } as unknown as HostServices)
  return host
}

void test("formatDuration", () => {
  assert.equal(formatDuration(45_000), "45s")
  assert.equal(formatDuration(12 * 60_000), "12 min")
  assert.equal(formatDuration(111 * 60_000), "1 h 51 min")
})

void test("almostIdle counts CPU, I/O, and new processes", () => {
  assert.equal(almostIdle(sample(1000, 0), sample(1100, 1000)), true)
  assert.equal(almostIdle(sample(1000, 0), sample(3000, 0)), false)
  assert.equal(almostIdle(sample(0, 0), sample(0, 10_000_000)), false)
  const grown = sample(0, 0)
  grown.processes.set(200, { cpuMs: 0, io: 0, command: "git" })
  assert.equal(almostIdle(sample(0, 0), grown), false)
})

void test("the watchdog tells the parent about an idle, silent call one time", async () => {
  const sent: Array<{ id: string; message: string; requestId: string }> = []
  const host = fakeHost(sent)
  const start = 1_000_000
  const call = startBashCall({
    agentId: "s2",
    callId: "call-1",
    command: "git rebase -i HEAD~3",
    now: start,
  })
  const parentCall = startBashCall({
    agentId: "s1",
    callId: "call-2",
    command: "sleep 9999",
    now: start,
  })
  let cpu = 0
  const sampler = (markers: string[]) => {
    cpu += 100
    return Promise.resolve(
      new Map(markers.map((marker) => [marker, sample(cpu, 0)]))
    )
  }
  try {
    // Too early: not silent for long enough.
    assert.deepEqual(
      await checkBashCalls(host, { now: start + 60_000, sample: sampler }),
      []
    )
    // One interval before the limit: the first sample, no report.
    assert.deepEqual(
      await checkBashCalls(host, {
        now: start + STALL_MS - 60_000,
        sample: sampler,
      }),
      []
    )
    const reported = await checkBashCalls(host, {
      now: start + STALL_MS,
      sample: sampler,
    })
    assert.deepEqual(reported, [call])
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.id, "s1")
    assert.equal(sent[0]!.requestId, "stall:s2:call-1")
    assert.match(sent[0]!.message, /Session s2 \(Child\) may hang/)
    assert.match(sent[0]!.message, /git rebase -i HEAD~3/)
    assert.match(sent[0]!.message, /10 min/)
    assert.match(sent[0]!.message, /PIDs: 100 \(nvim\)/)
    // One report per call.
    await checkBashCalls(host, { now: start + STALL_MS * 2, sample: sampler })
    assert.equal(sent.length, 1)
  } finally {
    endBashCall(call)
    endBashCall(parentCall)
  }
})

void test("the watchdog does not report a busy call", async () => {
  const sent: Array<{ id: string; message: string; requestId: string }> = []
  const host = fakeHost(sent)
  const call = startBashCall({
    agentId: "s2",
    callId: "call-3",
    command: "make",
    now: 0,
  })
  let cpu = 0
  const sampler = (markers: string[]) => {
    cpu += 30_000
    return Promise.resolve(
      new Map(markers.map((marker) => [marker, sample(cpu, 0)]))
    )
  }
  try {
    await checkBashCalls(host, { now: STALL_MS - 60_000, sample: sampler })
    await checkBashCalls(host, { now: STALL_MS, sample: sampler })
    assert.equal(sent.length, 0)
  } finally {
    endBashCall(call)
  }
})

void test("runningToolLines shows the tool, its time, and the bash command", () => {
  const now = 10 * 60_000
  const call = startBashCall({
    agentId: "s5",
    callId: "c1",
    command: "git log -S foo\necho done",
    now: 0,
  })
  try {
    const lines = runningToolLines(
      {
        runningTools: () => [
          { callId: "c1", name: "bash", startedAt: 0 },
          { callId: "c2", name: "read", startedAt: now - 5000 },
        ],
      },
      "s5",
      now
    )
    assert.deepEqual(lines, [
      "running bash for 10 min, no output for 10 min: git log -S foo …",
      "running read for 5s",
    ])
  } finally {
    endBashCall(call)
  }
})

void test(
  "sampleProcesses finds the processes of a call by its marker",
  { skip: process.platform !== "linux" },
  async () => {
    const child = spawn("sleep", ["30"], {
      env: { ...process.env, PICO_TOOL_CALL: "test-marker" },
      stdio: "ignore",
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const samples = await sampleProcesses(["test-marker", "other"])
      assert.ok(samples)
      assert.deepEqual(
        [...samples.get("test-marker")!.processes.keys()],
        [child.pid]
      )
      assert.equal(samples.get("other")!.processes.size, 0)
    } finally {
      child.kill()
    }
  }
)
