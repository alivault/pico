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
