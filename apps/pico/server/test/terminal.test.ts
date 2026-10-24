import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { test } from "node:test"

import { Terminals } from "../src/services/terminal.ts"

void test("PTY runs a shell, scopes access, and replays output", async () => {
  const terminals = new Terminals()
  try {
    const previousShell = process.env.PICO_TERMINAL_SHELL
    process.env.PICO_TERMINAL_SHELL = "/bin/sh"
    const terminal = terminals.create("scope", tmpdir(), "test", 80, 24)
    if (previousShell === undefined) delete process.env.PICO_TERMINAL_SHELL
    else process.env.PICO_TERMINAL_SHELL = previousShell
    assert.equal(terminals.create("scope", tmpdir(), "test").id, terminal.id)
    assert.throws(
      () => terminals.write("other", terminal.id, "echo bad\r", undefined),
      /session/
    )
    let output = ""
    let done: () => void
    const received = new Promise<void>((resolve) => {
      done = resolve
    })
    const subscription = terminals.subscribe(
      "scope",
      terminal.id,
      undefined,
      (event) => {
        if (event.type === "output") {
          output += event.data
          if (output.includes("pico-pty-ok")) done()
        }
      }
    )
    terminals.write("scope", terminal.id, "printf 'pico-pty-%s\\n' ok\r", 1)
    await Promise.race([
      received,
      new Promise<void>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("PTY output timed out")),
          5000
        )
        timer.unref()
      }),
    ])
    assert.ok(output.includes("pico-pty-ok"))
    assert.equal(
      terminals.write("scope", terminal.id, "echo duplicate\r", 1),
      1
    )
    const replay = terminals.subscribe("scope", terminal.id, 0, () => undefined)
    assert.ok(replay.initial.some((event) => event.type === "output"))
    replay.unsubscribe()
    subscription.unsubscribe()
  } finally {
    terminals.shutdown()
  }
})

function waitFor(check: () => boolean, ms = 5000) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > ms) {
        clearInterval(timer)
        reject(new Error("Timed out"))
      }
    }, 20)
  })
}

void test("two viewers of a job do not drop each other's input", async () => {
  const terminals = new Terminals()
  try {
    let output = ""
    let exited = false
    terminals.spawnJob("jviewers", "read a; read b; echo got-$a-$b", tmpdir(), {
      label: "read two lines",
      onOutput: (data) => {
        output += data
      },
      onExit: () => {
        exited = true
      },
    })
    const created = terminals.create("a", tmpdir(), "job:jviewers")
    assert.equal(created.label, "read two lines")
    assert.equal(created.jobId, "jviewers")
    const first = terminals.subscribe(
      "a",
      created.id,
      undefined,
      () => undefined,
      "viewer-1"
    )
    const second = terminals.subscribe(
      "b",
      created.id,
      undefined,
      () => undefined,
      "viewer-2"
    )
    for (const subscription of [first, second]) {
      const ready = subscription.initial[0]
      assert.equal(ready?.type, "ready")
      if (ready?.type === "ready") assert.equal(ready.nextInputSeq, 1)
    }
    // Both viewers send their first input with sequence 1.
    terminals.write("a", created.id, "one\r", 1, "viewer-1")
    terminals.write("b", created.id, "two\r", 1, "viewer-2")
    // A retry of the same input is written once.
    terminals.write("b", created.id, "two\r", 1, "viewer-2")
    await waitFor(() => exited)
    assert.match(output, /got-one-two/)
    const again = terminals.subscribe(
      "a",
      created.id,
      undefined,
      () => undefined,
      "viewer-1"
    )
    const ready = again.initial[0]
    if (ready?.type === "ready") assert.equal(ready.nextInputSeq, 2)
    first.unsubscribe()
    second.unsubscribe()
    again.unsubscribe()
  } finally {
    terminals.shutdown()
  }
})

void test("an exited job drops its backlog and replays its log", async () => {
  const terminals = new Terminals()
  try {
    let exited = false
    terminals.spawnJob("jreplay", "echo in-memory", tmpdir(), {
      onOutput: () => undefined,
      onExit: () => {
        exited = true
      },
    })
    await waitFor(() => exited)
    const { id } = terminals.create("scope", tmpdir(), "job:jreplay")
    const before = terminals.subscribe("scope", id, undefined, () => undefined)
    assert.ok(
      before.initial.some(
        (event) => event.type === "output" && event.data.includes("in-memory")
      )
    )
    const last = before.initial.reduce(
      (max, event) =>
        event.type === "output" ? Math.max(max, event.seq) : max,
      0
    )
    before.unsubscribe()
    terminals.releaseJobOutput("jreplay", () => "from-the-log\r\n")
    const fresh = terminals.subscribe("scope", id, undefined, () => undefined)
    const outputs = fresh.initial.filter((event) => event.type === "output")
    assert.equal(outputs.length, 1)
    assert.match(
      outputs[0]!.type === "output" ? outputs[0]!.data : "",
      /from-the-log/
    )
    assert.equal(fresh.initial.at(-1)?.type, "exit")
    fresh.unsubscribe()
    // A viewer that has all the output gets no replay.
    const current = terminals.subscribe("scope", id, last, () => undefined)
    assert.ok(!current.initial.some((event) => event.type === "output"))
    current.unsubscribe()
  } finally {
    terminals.shutdown()
  }
})

void test("a finished job without a terminal shows its log", () => {
  const terminals = new Terminals()
  try {
    assert.equal(terminals.hasJob("jgone"), false)
    terminals.addFinishedJob("jgone", {
      label: "build",
      cwd: tmpdir(),
      exit: { exitCode: 2 },
      replay: () => "old output\r\n",
    })
    const created = terminals.create("any", tmpdir(), "job:jgone")
    assert.equal(created.label, "build")
    const view = terminals.subscribe("other", created.id, undefined, () => {})
    assert.deepEqual(
      view.initial.slice(1).map((event) => event.type),
      ["output", "exit"]
    )
    const exit = view.initial.at(-1)
    if (exit?.type === "exit") assert.equal(exit.exitCode, 2)
    assert.throws(() => terminals.write("any", created.id, "x", 1), /exited/)
    view.unsubscribe()
  } finally {
    terminals.shutdown()
  }
})
