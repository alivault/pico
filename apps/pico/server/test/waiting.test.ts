import assert from "node:assert/strict"
import { test } from "node:test"

import type { JobsState } from "../src/extensions/jobs.ts"
import type { TimerItem, TimersState } from "../src/extensions/schedule.ts"
import { waitingLabel } from "../src/extensions/waiting.ts"

function timer(
  id: string,
  kind: TimerItem["kind"],
  status: TimerItem["status"]
): TimerItem {
  return {
    id,
    kind,
    label: id,
    message: "",
    status,
    createdAt: 0,
    runs: 0,
  }
}

test("waitingLabel names pending timers, watches, and notifying jobs", () => {
  const timers: TimersState = {
    byCall: {},
    items: {
      a: timer("deploy", "watch", "pending"),
      b: timer("old", "watch", "done"),
      c: timer("ci", "timer", "pending"),
    },
  }
  const jobs = {
    items: {
      j1: { status: "running", notifyOnExit: true, name: "build" },
      j2: { status: "running", notifyOnExit: false, name: "dev" },
      j3: { status: "exited", notifyOnExit: true, name: "test" },
    },
  } as unknown as JobsState
  assert.equal(
    waitingLabel(timers, jobs),
    "a timer (ci) and a watch (deploy) and a job (build)"
  )
})

test("waitingLabel is undefined when nothing is pending", () => {
  assert.equal(waitingLabel(undefined, undefined), undefined)
  assert.equal(
    waitingLabel(
      { byCall: {}, items: { a: timer("x", "watch", "cancelled") } },
      undefined
    ),
    undefined
  )
})
