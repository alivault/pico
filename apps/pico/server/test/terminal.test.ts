import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { test } from "node:test"

import { keyBytes } from "../src/services/terminal-keys.ts"
import { TerminalScreen, trimRows } from "../src/services/terminal-screen.ts"
import { Terminals } from "../src/services/terminal.ts"

void test("PTY runs a shell, scopes access, and replays output", async () => {
  const terminals = new Terminals()
  try {
    const previousShell = process.env.PICO_TERMINAL_SHELL
    process.env.PICO_TERMINAL_SHELL = "/bin/sh"
    const terminal = await terminals.create("scope", tmpdir(), "test", 80, 24)
    if (previousShell === undefined) delete process.env.PICO_TERMINAL_SHELL
    else process.env.PICO_TERMINAL_SHELL = previousShell
    assert.equal(
      (await terminals.create("scope", tmpdir(), "test")).id,
      terminal.id
    )
    assert.throws(
      () => terminals.write("other", terminal.id, "echo bad\r", undefined),
      /agent/
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
    await terminals.spawnJob(
      "jviewers",
      "read a; read b; echo got-$a-$b",
      tmpdir(),
      {
        label: "read two lines",
        onOutput: (data) => {
          output += data
        },
        onExit: () => {
          exited = true
        },
      }
    )
    const created = await terminals.create("a", tmpdir(), "job:jviewers")
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
    await terminals.spawnJob("jreplay", "echo in-memory", tmpdir(), {
      onOutput: () => undefined,
      onExit: () => {
        exited = true
      },
    })
    await waitFor(() => exited)
    const { id } = await terminals.create("scope", tmpdir(), "job:jreplay")
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

void test("a finished job without a terminal shows its log", async () => {
  const terminals = new Terminals()
  try {
    assert.equal(terminals.hasJob("jgone"), false)
    terminals.addFinishedJob("jgone", {
      label: "build",
      cwd: tmpdir(),
      exit: { exitCode: 2 },
      replay: () => "old output\r\n",
    })
    const created = await terminals.create("any", tmpdir(), "job:jgone")
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

void test("a screen shows what a person sees, and recent lines with scrollback", async () => {
  const screen = new TerminalScreen(20, 4)
  try {
    screen.write("one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n")
    screen.write("\x1b[31mred\x1b[0m and a line longer than twenty")
    const view = await screen.visible()
    assert.deepEqual(view.rows, [
      "four",
      "five",
      "red and a line longe",
      "r than twenty",
    ])
    assert.equal(view.alternate, false)
    assert.deepEqual(await screen.recent(3), [
      "four",
      "five",
      "red and a line longer than twenty",
    ])
    // A full-screen program draws on the alternate screen.
    screen.write("\x1b[?1049h\x1b[H\x1b[2Jmenu")
    const full = await screen.visible()
    assert.equal(full.alternate, true)
    assert.deepEqual(trimRows(full.rows), ["menu"])
  } finally {
    screen.dispose()
  }
})

void test("key names become terminal bytes", () => {
  assert.equal(keyBytes("enter"), "\r")
  assert.equal(keyBytes("Ctrl+C"), "\x03")
  assert.equal(keyBytes("up"), "\x1b[A")
  assert.equal(keyBytes("alt+b"), "\x1bb")
  assert.equal(keyBytes("hyper+q"), undefined)
})

void test("agents read a live terminal's screen and type into it", async () => {
  const terminals = new Terminals()
  try {
    let exited = false
    const { terminalId } = await terminals.spawnJob(
      "jscreen",
      "cat",
      tmpdir(),
      {
        onOutput: () => undefined,
        onExit: () => {
          exited = true
        },
      }
    )
    terminals.writeForAgent(terminalId, "ping\r")
    await waitFor(() => false, 300).catch(() => undefined)
    const recent = await terminals.readText(terminalId, "recent", 10)
    assert.deepEqual(recent.lines, ["ping", "ping"])
    const visible = await terminals.readText(terminalId, "visible", 0)
    assert.equal(visible.lines[0], "ping")
    terminals.writeForAgent(terminalId, "\x03")
    await waitFor(() => exited)
    const after = await terminals.readText(terminalId, "recent", 10)
    assert.ok(after.exited)
    assert.throws(() => terminals.writeForAgent(terminalId, "x"), /exited/)
  } finally {
    terminals.shutdown()
  }
})

void test("a shared terminal takes the size of the viewer the user used last", async () => {
  const terminals = new Terminals()
  try {
    const { terminalId } = await terminals.spawnJob("jsize", "cat", tmpdir(), {
      onOutput: () => undefined,
      onExit: () => undefined,
    })
    terminals.resize("a", terminalId, 100, 20, "panel")
    assert.deepEqual(terminals.size(terminalId), { cols: 100, rows: 20 })
    // A second viewer's size counts only when the user works in it.
    terminals.resize("b", terminalId, 60, 10, "inline")
    assert.deepEqual(terminals.size(terminalId), { cols: 100, rows: 20 })
    terminals.focus("b", terminalId, "inline")
    assert.deepEqual(terminals.size(terminalId), { cols: 60, rows: 10 })
    // A resize of the panel now waits; input in the panel brings it back.
    terminals.resize("a", terminalId, 120, 30, "panel")
    assert.deepEqual(terminals.size(terminalId), { cols: 60, rows: 10 })
    terminals.write("a", terminalId, "x", 1, "panel")
    assert.deepEqual(terminals.size(terminalId), { cols: 120, rows: 30 })
    // Let the write finish before the terminal closes.
    await new Promise((resolve) => setTimeout(resolve, 100))
  } finally {
    terminals.shutdown()
  }
})

void test("a read does not hang when its screen goes away", async () => {
  const screen = new TerminalScreen(20, 4)
  screen.write("x".repeat(200_000))
  screen.dispose()
  const started = Date.now()
  await screen.flush()
  assert.ok(Date.now() - started < 1000)
})
