import assert from "node:assert/strict"
import { test } from "node:test"

import {
  InputWaitWatcher,
  lastLine,
  parseTerminalMode,
  promptLike,
  type TerminalMode,
} from "../src/services/input-wait.ts"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

void test("terminal modes and prompts are read", () => {
  assert.deepEqual(parseTerminalMode("speed 38400 baud; isig icanon -echo"), {
    echo: false,
    icanon: true,
  })
  assert.deepEqual(parseTerminalMode("-icanon echo echoe"), {
    echo: true,
    icanon: false,
  })
  assert.equal(parseTerminalMode("nothing here"), undefined)
  for (const line of [
    "ali@asahi's password:",
    "Continue? [y/N]",
    "Are you sure (yes/no/[fingerprint])?",
    "user@host:~$",
    "~ ❯",
  ])
    assert.ok(promptLike(line), line)
  for (const line of ["", "Compiled in 3s", "Progress: 100%", "</div>"])
    assert.ok(!promptLike(line), line)
  assert.equal(lastLine("one\r\n\x1b[1mPass\x1b[0mword: \r\n\r\n"), "Password:")
})

void test("a quiet job with echo off waits; Enter with no change is reported", async () => {
  let mode: TerminalMode = { echo: false, icanon: true }
  const events: string[] = []
  const watcher = new InputWaitWatcher(
    "/dev/pts/x",
    {
      waiting: (prompt, secret) => events.push(`waiting ${prompt} ${secret}`),
      resumed: () => events.push("resumed"),
      ignored: (prompt) => events.push(`ignored ${prompt}`),
    },
    {
      readMode: async () => mode,
      quietMs: 20,
      promptQuietMs: 60,
      inputCheckMs: 40,
    }
  )
  try {
    watcher.output("Password: ")
    await sleep(60)
    assert.deepEqual(events, ["waiting Password: true"])
    // Typing echoes nothing; Enter with no output is reported.
    watcher.input("wrong\r")
    await sleep(80)
    assert.deepEqual(events.at(-1), "ignored Password:")
    // Output with a line break ends the wait.
    watcher.output("\r\nWelcome\r\n")
    assert.equal(events.at(-1), "resumed")
    mode = { echo: true, icanon: true }
    // A prompt-like line counts after the longer quiet time.
    watcher.output("Continue? [y/N] ")
    await sleep(30)
    assert.equal(events.at(-1), "resumed")
    await sleep(80)
    assert.equal(events.at(-1), "waiting Continue? [y/N] false")
    // Raw mode (a TUI or a shortcut handler) with no prompt is not a wait.
    watcher.output("y\r\n  press h + enter to show help\r\n")
    mode = { echo: false, icanon: false }
    await sleep(120)
    assert.equal(events.at(-1), "resumed")
  } finally {
    watcher.stop()
  }
})
