import assert from "node:assert/strict"
import { test } from "node:test"

import { stallMessage } from "../src/core/bash-calls.ts"
import { reportMessage, STOPPED_ANSWER } from "../src/extensions/agents.ts"
import {
  isLocalAgentId,
  parseAgentNotice,
} from "../../src/lib/smith/agent-notice.ts"

void test("the client reads the reports of agents as notices", () => {
  const done = parseAgentNotice(
    reportMessage({
      name: "s5",
      title: "Fix the build",
      answer: "Changed two files.\n\n- `a.ts`\n- `b.ts`",
      needsInput: false,
      subagent: true,
    })
  )
  assert.deepEqual(done, {
    kind: "agent",
    label: "Subagent",
    agentId: "s5",
    state: "done",
    tone: "default",
    summary: "Fix the build",
    body: "Changed two files.\n\n- `a.ts`\n- `b.ts`",
    markdown: true,
  })

  const stopped = parseAgentNotice(
    reportMessage({
      name: "workbox:s12",
      title: "Remote work",
      answer: STOPPED_ANSWER,
      needsInput: false,
      subagent: false,
    })
  )
  assert.equal(stopped?.label, "Agent")
  assert.equal(stopped?.agentId, "workbox:s12")
  assert.equal(stopped?.state, "stopped")
  assert.equal(stopped?.tone, "muted")

  for (const needsInput of [false, true]) {
    const question = parseAgentNotice(
      reportMessage({
        name: "s7",
        title: "Helper",
        answer: "Question: may I push?\nOptions: yes, no.",
        needsInput,
        subagent: true,
      })
    )
    assert.equal(question?.state, "question")
    assert.equal(question?.tone, "attention")
    assert.equal(question?.body, "Question: may I push?\nOptions: yes, no.")
    assert.match(question?.hint ?? "", /agents send \(id s7\)/)
  }
})

void test("the client reads messages and stalls of agents as notices", () => {
  const message = parseAgentNotice("[Message from agent s3] Look at a.ts.\nOK?")
  assert.equal(message?.agentId, "s3")
  assert.equal(message?.state, "message")
  assert.equal(message?.summary, "Look at a.ts.")
  assert.equal(message?.body, "Look at a.ts.\nOK?")
  assert.equal(
    parseAgentNotice("[Message from agent s3 on the hub] Hi")?.state,
    "message, on the hub"
  )

  const stall = parseAgentNotice(
    stallMessage({
      agentId: "s9",
      title: "Run (the) tests",
      command: "vim a.txt",
      ranMs: 11 * 60_000,
      silentMs: 10 * 60_000,
      pids: [{ pid: 42, command: "vim" }],
    })
  )
  assert.equal(stall?.agentId, "s9")
  assert.equal(stall?.state, "may hang")
  assert.match(stall?.summary ?? "", /^Run \(the\) tests · bash call ran /)
  assert.match(stall?.body ?? "", /\nCommand: vim a\.txt\nPIDs: 42 \(vim\)$/)
  assert.match(stall?.hint ?? "", /^It may wait for input/)
})

void test("the client reads job notices", () => {
  const failed = parseAgentNotice(
    "[Job failed] build exited with code 2 after 1 h 3 min, while the Smith server restarted.\n(job j1: pnpm build\n--watch)\nLast output:\nerror: x"
  )
  assert.equal(failed?.kind, "job")
  assert.equal(failed?.state, "failed")
  assert.equal(failed?.tone, "error")
  assert.equal(failed?.jobId, "j1")
  assert.equal(failed?.command, "pnpm build\n--watch")
  assert.equal(
    failed?.summary,
    "build · exit 2 · 1 h 3 min, during a server restart"
  )
  assert.equal(failed?.output, "error: x")

  const waits = parseAgentNotice(
    "[Job waits for input] login (job j2) waits for input with echo off: a password or secret, so only the user can type it.\nLast line: Password:\nUse the terminal tool: focus to bring the user to it, then wait for the result. Or stop it with the stop action."
  )
  assert.equal(waits?.state, "waits for input")
  assert.equal(waits?.summary, "login")
  assert.equal(waits?.jobId, "j2")
  assert.match(waits?.hint ?? "", /^Use the terminal tool/)

  const ignored = parseAgentNotice(
    "[Job input not taken] The user pressed Enter in login (job j2), but the job shows no new output after a few seconds and still waits for input.\nLast line: Password:"
  )
  assert.equal(ignored?.state, "input not taken")
  assert.equal(ignored?.summary, "login")

  const changed = parseAgentNotice(
    "[Job changed] Agent s4 (Helper) stopped dev (job j3)."
  )
  assert.equal(changed?.state, "changed")
  assert.equal(changed?.jobId, "j3")
  assert.equal(changed?.summary, "Agent s4 (Helper) stopped dev")
})

void test("a normal prompt is not a notice", () => {
  for (const text of [
    "[WIP] fix the build",
    "[Subagent s5: done]Title",
    "[Subagent s5: finished] Title",
    " [Subagent s5: done] Title",
    "[Job finished] build exited with code 0 after 2s.",
    "[Job finished] build exited with code 0 after 2s.\nsome text",
    "[Job changed] something\nmore",
    "[Message from agent s3]",
    "Agent s9 may hang: please look",
    "Plain text",
  ])
    assert.equal(parseAgentNotice(text), null, text)
  assert.equal(isLocalAgentId("s12"), true)
  assert.equal(isLocalAgentId("workbox:s12"), false)
})
