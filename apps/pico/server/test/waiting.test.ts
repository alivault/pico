import assert from "node:assert/strict"
import { test } from "node:test"

import type { JobsState } from "../src/extensions/jobs.ts"
import { waitingLabel } from "../src/extensions/waiting.ts"

void test("waitingLabel names running jobs that notify", () => {
  const jobs = {
    items: {
      j1: { status: "running", notifyOnExit: true, name: "build" },
      j2: { status: "running", notifyOnExit: false, name: "dev" },
      j3: { status: "exited", notifyOnExit: true, name: "test" },
      j4: { status: "running", notifyOnExit: true, name: "lint" },
    },
  } as unknown as JobsState
  assert.equal(waitingLabel(jobs), "2 jobs (build, lint)")
})

void test("waitingLabel is undefined when nothing is pending", () => {
  assert.equal(waitingLabel(undefined), undefined)
  const jobs = {
    items: { j1: { status: "exited", notifyOnExit: true, name: "test" } },
  } as unknown as JobsState
  assert.equal(waitingLabel(jobs), undefined)
})
