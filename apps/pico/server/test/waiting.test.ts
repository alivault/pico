import assert from "node:assert/strict"
import { test } from "node:test"

import type { JobsState } from "../src/extensions/jobs.ts"
import { agentJobs, waitingLabel } from "../src/extensions/waiting.ts"

void test("waitingLabel names running jobs that the agent waits on", () => {
  const jobs = {
    items: {
      j1: {
        status: "running",
        notifyOnExit: true,
        waitOnExit: true,
        name: "build",
      },
      j2: { status: "running", notifyOnExit: false, name: "dev" },
      j3: {
        status: "exited",
        notifyOnExit: true,
        waitOnExit: true,
        name: "test",
      },
      j4: {
        status: "running",
        notifyOnExit: true,
        waitOnExit: true,
        name: "lint",
      },
      // It reports its exit, but the agent does not wait on it.
      j5: { status: "running", notifyOnExit: true, name: "server" },
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

void test("agentJobs shows live jobs and failures the agent did not hear of", () => {
  const job = (id: string, fields: Record<string, unknown>) => ({
    id,
    name: id,
    startedAt: Number(id.slice(1)),
    notifyOnExit: false,
    ...fields,
  })
  const jobs = {
    items: {
      j1: job("j1", { status: "running" }),
      j2: job("j2", { status: "running", waiting: { prompt: "?" } }),
      j3: job("j3", { status: "exited", exitCode: 1, endedAt: 9 }),
      j4: job("j4", { status: "exited", exitCode: 0 }),
      j5: job("j5", { status: "exited", exitCode: 1, notifyOnExit: true }),
      j6: job("j6", { status: "stopped" }),
      j7: job("j7", { status: "running", shell: true }),
      j8: job("j8", { status: "lost" }),
    },
  } as unknown as JobsState
  assert.deepEqual(agentJobs(jobs), [
    { id: "j1", name: "j1", state: "running" },
    { id: "j2", name: "j2", state: "input" },
    { id: "j3", name: "j3", state: "failed", endedAt: 9 },
    { id: "j8", name: "j8", state: "failed" },
  ])
  assert.equal(agentJobs({ items: {} }), undefined)
})
