/**
 * The live refresh and the agent wake of GitHub pull requests, with a fake
 * `gh` on PATH. The fake answers the poll query from a JSON file.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import {
  GitHubWatcher,
  POLL_INTERVAL_MS,
} from "../src/services/github-watch.ts"
import { tempDir } from "./support.ts"

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n")
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"))
if (state.fail) { process.stderr.write("gh: Something went wrong (HTTP 502)\\n"); process.exit(1) }
if (args[0] === "run" && args[1] === "view") {
  console.log("build\\tRun tests\\t2024-01-01T00:00:00.0000000Z npm test\\nbuild\\tRun tests\\t\uFEFF2024-01-01T00:00:01.0000000Z \u001b[31m##[error]expected 3 to be 4\u001b[0m")
} else {
  console.log(JSON.stringify({ data: state.answer }))
}
`

type Pr = {
  state?: string
  failed?: Array<number>
  threads?: Array<{ id: number; author: string; body: string }>
  comments?: Array<{ id: number; author: string; body: string }>
}

/** A poll answer with open PR 7 (and its details, when it is subscribed). */
function answer(
  pr: Pr,
  extra: { updatedAt?: string; remaining?: number } = {}
) {
  return {
    viewer: { login: "me" },
    rateLimit: {
      remaining: extra.remaining ?? 4000,
      resetAt: "2030-01-01T00:00:00Z",
    },
    repository: {
      pullRequests: {
        nodes:
          (pr.state ?? "OPEN") === "OPEN"
            ? [
                {
                  number: 7,
                  updatedAt: extra.updatedAt ?? "2024-01-01T00:00:00Z",
                  state: "OPEN",
                  headRefOid: "abc",
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: {
                            state: pr.failed?.length ? "FAILURE" : "SUCCESS",
                          },
                        },
                      },
                    ],
                  },
                },
              ]
            : [],
      },
      p7: {
        number: 7,
        title: "Fix the parser",
        url: "https://github.com/me/proj/pull/7",
        state: pr.state ?? "OPEN",
        headRefOid: "abc",
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [
                      {
                        __typename: "CheckRun",
                        databaseId: 1,
                        name: "lint",
                        status: "COMPLETED",
                        conclusion: "SUCCESS",
                        detailsUrl: "https://x/actions/runs/5/job/1",
                      },
                      ...(pr.failed ?? []).map((id) => ({
                        __typename: "CheckRun",
                        databaseId: id,
                        name: `test-${id}`,
                        status: "COMPLETED",
                        conclusion: "FAILURE",
                        detailsUrl: `https://github.com/me/proj/actions/runs/5/job/${id}`,
                      })),
                    ],
                  },
                },
              },
            },
          ],
        },
        reviewThreads: {
          nodes: (pr.threads ?? []).map((comment) => ({
            path: "src/parse.ts",
            line: 12,
            comments: {
              nodes: [
                {
                  databaseId: comment.id,
                  author: { login: comment.author },
                  body: comment.body,
                },
              ],
            },
          })),
        },
        comments: {
          nodes: (pr.comments ?? []).map((comment) => ({
            databaseId: comment.id,
            author: { login: comment.author },
            body: comment.body,
          })),
        },
        reviews: { nodes: [] },
      },
    },
  }
}

type Setup = {
  dir: string
  clock: { now: number }
  events: Array<{ type: string; [key: string]: unknown }>
  wakes: Array<{ agentId: string; message: string; requestId: string }>
  busy: { value: boolean }
  setState: (state: Record<string, unknown>) => Promise<void>
  calls: () => Promise<Array<Array<string>>>
  watcher: () => GitHubWatcher
}

async function withFakeGh(run: (setup: Setup) => Promise<void>) {
  const dir = await tempDir("smith-gh-watch-")
  const bin = join(dir, "bin")
  execFileSync("mkdir", ["-p", bin])
  await writeFile(join(bin, "gh"), FAKE_GH)
  await chmod(join(bin, "gh"), 0o755)
  const logPath = join(dir, "log.jsonl")
  const statePath = join(dir, "state.json")
  await writeFile(logPath, "")
  await writeFile(statePath, JSON.stringify({ answer: answer({}) }))
  const saved = {
    PATH: process.env.PATH,
    FAKE_GH_LOG: process.env.FAKE_GH_LOG,
    FAKE_GH_STATE: process.env.FAKE_GH_STATE,
  }
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
  process.env.FAKE_GH_LOG = logPath
  process.env.FAKE_GH_STATE = statePath
  const clock = { now: Date.parse("2025-01-01T00:00:00Z") }
  const events: Setup["events"] = []
  const wakes: Setup["wakes"] = []
  const busy = { value: false }
  try {
    await run({
      dir,
      clock,
      events,
      wakes,
      busy,
      setState: (state) => writeFile(statePath, JSON.stringify(state)),
      calls: async () =>
        (await readFile(logPath, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Array<string>),
      // A new watcher on the same data folder is a server restart.
      watcher: () =>
        new GitHubWatcher({
          dataDir: join(dir, "data"),
          hub: { push: (event) => events.push(event) },
          target: {
            alive: (id) => id !== "gone",
            busy: () => busy.value,
            prompt: async (agentId, message, requestId) => {
              wakes.push({ agentId, message, requestId })
            },
          },
          now: () => clock.now,
        }),
    })
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

void test("github watch: a change of the pull requests sends one event", async () => {
  await withFakeGh(async ({ dir, clock, events, setState, watcher }) => {
    const live = watcher()
    // No client looks: no poll.
    await live.tick()
    assert.equal(live.repoState(dir), undefined)
    const root = await live.viewing(dir)
    await live.tick()
    assert.equal(events.length, 0, "the first answer is the baseline")
    // Not due yet: no poll.
    clock.now += POLL_INTERVAL_MS / 2
    await setState({
      answer: answer({}, { updatedAt: "2024-02-02T00:00:00Z" }),
    })
    await live.tick()
    assert.equal(events.length, 0)
    clock.now += POLL_INTERVAL_MS
    await live.tick()
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "github_changed")
    assert.equal(events[0]!.root, root)
    assert.deepEqual(events[0]!.cwds, [root])
    // The same answer again: no event.
    clock.now += POLL_INTERVAL_MS
    await live.tick()
    assert.equal(events.length, 1)
    // The client went away: the poll stops after the view time.
    clock.now += 10 * POLL_INTERVAL_MS
    await setState({ answer: answer({ failed: [9] }) })
    await live.tick()
    assert.equal(events.length, 1)
  })
})

void test("github watch: wakes once per event, also after a restart", async () => {
  await withFakeGh(
    async ({ dir, clock, wakes, busy, setState, watcher, calls }) => {
      let live = watcher()
      // An old failure and comment are there before the subscription.
      await setState({
        answer: answer({
          failed: [100],
          comments: [{ id: 1, author: "ann", body: "old" }],
        }),
      })
      await live.subscribe({
        agentId: "s1",
        cwd: dir,
        number: 7,
        events: { ci: true, comments: true, state: true },
      })
      assert.equal(live.get("s1")?.initialized, false)
      await live.tick()
      assert.equal(live.get("s1")?.initialized, true)
      assert.equal(wakes.length, 0, "what was there before does not wake")

      // A new failed check and a new review comment: one wake with both.
      // The agent works, so the comment of the viewer ("me") is its own.
      busy.value = true
      await setState({
        answer: answer({
          failed: [100, 101],
          comments: [{ id: 1, author: "ann", body: "old" }],
          threads: [
            { id: 2, author: "bob", body: "Handle the empty case" },
            { id: 3, author: "me", body: "My own note" },
          ],
        }),
      })
      clock.now += POLL_INTERVAL_MS
      await live.tick()
      assert.equal(wakes.length, 1)
      const message = wakes[0]!.message
      assert.match(
        message,
        /^\[GitHub PR #7: CI failed \(1 check\), 1 new comment\]/
      )
      assert.match(message, /### test-101/)
      assert.match(message, /\n##\[error\]expected 3 to be 4\n/)
      assert.doesNotMatch(message, /2024-01-01|\u001b/)
      assert.doesNotMatch(message, /test-100/)
      assert.match(message, /src\/parse\.ts:12, bob: Handle the empty case/)
      assert.doesNotMatch(message, /My own note/)
      busy.value = false
      assert.ok(
        (await calls()).some(
          (args) => args.join(" ") === "run view --job 101 --log-failed"
        )
      )

      // The same answer: no second wake, also after a restart.
      clock.now += POLL_INTERVAL_MS
      await live.tick()
      live = watcher()
      clock.now += POLL_INTERVAL_MS
      await live.tick()
      assert.equal(wakes.length, 1)

      // A comment of the viewer while the agent is idle is from the user.
      await setState({
        answer: answer({
          failed: [100, 101],
          comments: [
            { id: 1, author: "ann", body: "old" },
            { id: 5, author: "me", body: "Please rename it" },
          ],
        }),
      })
      clock.now += POLL_INTERVAL_MS
      await live.tick()
      assert.equal(wakes.length, 2)
      assert.match(wakes[1]!.message, /conversation, me: Please rename it/)

      // Comments off: a new comment does not wake, and is not kept for later.
      await live.subscribe({
        agentId: "s1",
        cwd: dir,
        number: 7,
        events: { ci: true, comments: false, state: true },
      })
      await setState({
        answer: answer({
          failed: [100, 101],
          comments: [
            { id: 1, author: "ann", body: "old" },
            { id: 5, author: "me", body: "Please rename it" },
            { id: 4, author: "ann", body: "Ping" },
          ],
        }),
      })
      clock.now += POLL_INTERVAL_MS
      await live.tick()
      assert.equal(wakes.length, 2)

      // Merged: the last wake, and the subscription ends.
      await setState({
        answer: answer({ state: "MERGED", failed: [100, 101] }),
      })
      clock.now += POLL_INTERVAL_MS
      await live.tick()
      assert.equal(wakes.length, 3)
      assert.match(wakes[2]!.message, /^\[GitHub PR #7: merged\]/)
      assert.equal(live.get("s1"), null)
      assert.equal(watcher().get("s1"), null)
      await watcher().load()
    }
  )
})

void test("github watch: a gone agent loses its subscription", async () => {
  await withFakeGh(async ({ dir, watcher, calls }) => {
    const live = watcher()
    await live.subscribe({
      agentId: "gone",
      cwd: dir,
      number: 7,
      events: { ci: true, comments: false, state: false },
    })
    await live.tick()
    assert.equal(live.get("gone"), null)
    assert.equal((await calls()).length, 0)
  })
})

void test("github watch: backs off on errors and on a low rate limit", async () => {
  await withFakeGh(async ({ dir, clock, setState, watcher }) => {
    const live = watcher()
    const root = await live.viewing(dir)
    await setState({ fail: true })
    await live.tick()
    assert.deepEqual(live.repoState(root), {
      failures: 1,
      nextAt: clock.now + 2 * POLL_INTERVAL_MS,
    })
    clock.now += 2 * POLL_INTERVAL_MS
    await live.viewing(dir)
    await live.tick()
    assert.deepEqual(live.repoState(root), {
      failures: 2,
      nextAt: clock.now + 4 * POLL_INTERVAL_MS,
    })
    // A client view does not cut the back-off short.
    await live.viewing(dir)
    assert.equal(live.repoState(root)!.nextAt, clock.now + 4 * POLL_INTERVAL_MS)
    clock.now += 4 * POLL_INTERVAL_MS
    await live.viewing(dir)
    await setState({ answer: answer({}) })
    await live.tick()
    assert.deepEqual(live.repoState(root), {
      failures: 0,
      nextAt: clock.now + POLL_INTERVAL_MS,
    })
    // Few points left: wait for the reset of the rate limit.
    clock.now += POLL_INTERVAL_MS
    await setState({ answer: answer({}, { remaining: 20 }) })
    await live.tick()
    assert.equal(
      live.repoState(root)!.nextAt,
      Date.parse("2030-01-01T00:00:00Z")
    )
  })
})
