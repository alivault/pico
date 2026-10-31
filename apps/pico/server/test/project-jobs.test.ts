import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import type { Message } from "@earendil-works/pi-ai"
import type { Conversation } from "@earendil-works/pi-durable"

import { DEFAULT_SETTINGS } from "../src/core/settings.ts"
import {
  agentIdOf,
  HostBridge,
  type HostAgentMeta,
  type HostServices,
} from "../src/extensions/host.ts"
import {
  createJobsExtension,
  jobAccess,
  JobsDoc,
} from "../src/extensions/jobs.ts"
import { Terminals } from "../src/services/terminal.ts"
import {
  ctx,
  lastToolResult,
  openHarness,
  tempDir,
  TEST_MODEL,
} from "./support.ts"

/** Stub agents over a map of metas: enough for the jobs extension. */
function stubAgents(metas: Map<string, Partial<HostAgentMeta>>) {
  const visible = () =>
    [...metas.entries()].filter(([, meta]) => !meta.archived)
  return {
    current: (id: string | undefined) => id,
    has: (id: string | undefined) => id !== undefined && metas.has(id),
    meta: (id: string) => metas.get(id) as HostAgentMeta,
    isBusy: () => false,
    list: ({ project }: { project?: string }) =>
      visible()
        .filter(([, meta]) => (meta.group ?? meta.cwd) === project)
        .map(([id]) => ({ id })),
    archivedAgents: () =>
      [...metas.entries()]
        .filter(([, meta]) => meta.archived)
        .map(([id, meta]) => ({ id, title: id, cwd: meta.cwd })),
    subagents: (id: string) =>
      visible()
        .filter(([, meta]) => meta.parent === id)
        .map(([subagent]) => subagent),
    extensionStateChanged: () => undefined,
  } as unknown as HostServices["agents"]
}

void test("job access: own, control from above or after archive, view in the project", () => {
  const metas = new Map<string, Partial<HostAgentMeta>>([
    ["s1", { cwd: "/p" }],
    ["s2", { cwd: "/p/wt", group: "/p", parent: "s1" }],
    ["s3", { cwd: "/p/wt2", group: "/p", parent: "s2" }],
    ["s4", { cwd: "/p" }],
    ["s5", { cwd: "/other" }],
    ["s6", { cwd: "/p", archived: true }],
    ["s7", { cwd: "/p", parent: "s6", archived: true }],
    ["s8", { cwd: "/p", parent: "s1", archived: true }],
  ])
  const services = { agents: stubAgents(metas) }
  assert.equal(jobAccess(services, "s1", "s1"), "own")
  // A parent and a grandparent control a subagent's jobs.
  assert.equal(jobAccess(services, "s1", "s2"), "control")
  assert.equal(jobAccess(services, "s1", "s3"), "control")
  // A subagent only reads its parent's jobs.
  assert.equal(jobAccess(services, "s2", "s1"), "view")
  assert.equal(jobAccess(services, "s4", "s1"), "view")
  assert.equal(jobAccess(services, "s5", "s1"), undefined)
  // An archived agent without a visible agent above it: the project controls.
  assert.equal(jobAccess(services, "s4", "s6"), "control")
  assert.equal(jobAccess(services, "s4", "s7"), "control")
  assert.equal(jobAccess(services, "s5", "s6"), undefined)
  // An archived subagent of a visible agent: that agent controls, others read.
  assert.equal(jobAccess(services, "s1", "s8"), "control")
  assert.equal(jobAccess(services, "s4", "s8"), "view")
})

function firstUserText(messages: readonly Message[]) {
  const first = messages.find((message) => message.role === "user")
  if (!first) return ""
  return typeof first.content === "string"
    ? first.content
    : first.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
}

async function eventually<T>(read: () => Promise<T | undefined>, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error("Timed out")
}

async function entriesText(conversation: Conversation) {
  const context = await conversation.context(ctx)
  return context.entries.map((entry) => JSON.stringify(entry)).join("\n")
}

void test("agents of a project see each other's jobs; only the parent stops a subagent's job", async () => {
  const dir = await tempDir()
  const host = new HostBridge()
  const jobs = createJobsExtension(host, dir)
  let jobId = ""
  const results: Record<string, string[]> = {
    child: [],
    viewer: [],
    parent: [],
  }
  type Call = { name: string; arguments: Record<string, unknown> }
  const steps: Record<string, Array<() => Call>> = {
    child: [
      () => ({
        name: "job_start",
        arguments: { command: "sleep 30", name: "dev server", wait_ms: 0 },
      }),
    ],
    viewer: [
      () => ({ name: "terminal", arguments: { action: "list" } }),
      () => ({ name: "terminal", arguments: { action: "stop", id: jobId } }),
      () => ({
        name: "terminal",
        arguments: { action: "send_text", id: jobId, text: "x" },
      }),
      () => ({
        name: "terminal",
        arguments: { action: "wait", id: jobId, timeout_ms: 50 },
      }),
      () => ({ name: "terminal", arguments: { action: "output", id: jobId } }),
    ],
    parent: [
      () => ({ name: "terminal", arguments: { action: "stop", id: jobId } }),
    ],
  }
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [jobs.extension],
    (messages) => {
      const role = firstUserText(messages)
      const list = results[role]!
      const toolResults = messages.filter(
        (message) => message.role === "toolResult"
      )
      if (toolResults.length > list.length)
        list.push(lastToolResult([toolResults.at(-1)!])!)
      if (role === "child" && list[0] && !jobId)
        jobId = /^Job (\S+)/.exec(list[0])?.[1] ?? ""
      const step = steps[role]![toolResults.length]
      return step ? { tools: [step()] } : { text: "done" }
    },
    dir
  )
  const create = () =>
    harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: TEST_MODEL, cwd: dir },
      },
      ctx
    )
  const parent = await create()
  const child = await create()
  const viewer = await create()
  const metas = new Map<string, Partial<HostAgentMeta>>([
    [agentIdOf(parent.id), { cwd: dir }],
    [
      agentIdOf(child.id),
      { cwd: join(dir, "wt"), group: dir, parent: agentIdOf(parent.id) },
    ],
    [agentIdOf(viewer.id), { cwd: dir }],
  ])
  const terminals = new Terminals({ dataDir: dir })
  host.bind({
    agents: stubAgents(metas),
    events: { push: () => undefined },
    terminals,
    harness,
    settings: () => ({ ...DEFAULT_SETTINGS, worktreeCopy: [] }),
    dataDir: dir,
  })
  try {
    await child.submit({ type: "input", content: "child" }, ctx)
    await eventually(async () => (jobId ? true : undefined))

    await viewer.submit({ type: "input", content: "viewer" }, ctx)
    await eventually(async () =>
      results.viewer!.length >= steps.viewer!.length ? true : undefined
    )
    const [list, stop, send, wait, output] = results.viewer
    assert.match(
      list!,
      new RegExp(`Running jobs of other agents[\\s\\S]*${jobId}`)
    )
    assert.match(list!, /read only for you/)
    assert.match(stop!, /belongs to agent/)
    assert.match(send!, /belongs to agent/)
    assert.match(wait!, /Timed out/)
    assert.match(output!, /dev server/)
    // The viewer's prompt names the job.
    assert.match(
      await entriesText(viewer),
      new RegExp(`project_jobs[\\s\\S]*${jobId}`)
    )

    await parent.submit({ type: "input", content: "parent" }, ctx)
    await eventually(async () =>
      results.parent!.length >= 1 ? true : undefined
    )
    assert.match(results.parent[0]!, /Stopping job/)
    const state = await eventually(async () => {
      const value = await harness.snapshot(JobsDoc, child.id, ctx)
      return value?.items[jobId]?.status === "stopped" ? value : undefined
    })
    assert.equal(state.items[jobId]?.status, "stopped")
  } finally {
    terminals.shutdown()
    await harness.close(ctx)
  }
})
