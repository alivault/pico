/**
 * The GitHub pull requests service, with a fake `gh` on PATH. The fake
 * writes its arguments to a log and prints canned JSON.
 */
import assert from "node:assert/strict"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import * as prs from "../src/services/github-prs.ts"
import { tempDir } from "./support.ts"

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args }) + "\\n")
const mode = process.env.FAKE_GH_MODE || ""
if (mode === "logged-out") {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\\n")
  process.exit(4)
}
const out = (value) => console.log(JSON.stringify(value))
const rollup = [
  { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
  { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
  { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
  { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
  { __typename: "StatusContext", state: "SUCCESS" },
]
const pr = { number: 5, title: "Fix", state: "OPEN", isDraft: true, author: { login: "me" }, headRefName: "fix", baseRefName: "main", updatedAt: "2026-01-02T00:00:00Z", url: "https://github.com/me/proj/pull/5", reviewDecision: "CHANGES_REQUESTED", mergeable: "CONFLICTING", statusCheckRollup: rollup, comments: [{ id: "c1", author: { login: "you" }, body: "Hi", createdAt: "t", url: "u" }], labels: [{ name: "bug", color: "d73a4a" }] }
const [group, command] = args
const listNode = { ...pr, author: { login: "me" }, labels: { nodes: pr.labels }, comments: { totalCount: 1 }, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: {
  checkRunCountsByState: [{ state: "SUCCESS", count: 1 }, { state: "FAILURE", count: 1 }, { state: "IN_PROGRESS", count: 1 }, { state: "SKIPPED", count: 1 }, { state: "QUEUED", count: 0 }],
  statusContextCountsByState: [{ state: "SUCCESS", count: 1 }],
} } } }] } }
if (group === "pr" && command === "view") {
  out({ ...pr, createdAt: "c", body: "Body", mergeStateStatus: "DIRTY", headRepositoryOwner: { login: "fork" }, headRepository: { name: "proj" }, isCrossRepository: true, additions: 3, deletions: 1, changedFiles: 1, files: [{ path: "a.ts", additions: 3, deletions: 1, changeType: "MODIFIED" }], reviews: [{ id: "r1", author: { login: "you" }, state: "CHANGES_REQUESTED", body: "Please fix", submittedAt: "s" }, { id: "r2", author: { login: "you" }, state: "COMMENTED", body: "", submittedAt: "s" }] })
} else if (group === "pr" && command === "checks") {
  if (mode === "no-checks") {
    process.stderr.write("no checks reported on the 'fix' branch\\n")
    process.exit(1)
  }
  out([
    { name: "lint", state: "SUCCESS", bucket: "pass", link: "https://github.com/me/proj/actions/runs/11/job/22", workflow: "CI" },
    { name: "test", state: "FAILURE", bucket: "fail", link: "https://github.com/me/proj/actions/runs/11/job/33", workflow: "CI" },
    { name: "ext", state: "FAILURE", bucket: "fail", link: "https://ci.example.com/build/1", workflow: "" },
  ])
  // gh exits with 1 when a check failed.
  process.exit(1)
} else if (group === "pr" && command === "diff") {
  if (mode === "big-diff") {
    const file = (name) => "diff --git a/" + name + " b/" + name + "\\n--- a/" + name + "\\n+++ b/" + name + "\\n@@ -1 +1 @@\\n-a\\n+" + "x".repeat(1024 * 1024) + "\\n"
    process.stdout.write([1, 2, 3, 4, 5, 6, 7].map((n) => file("f" + n)).join(""))
  } else {
    process.stdout.write("diff --git a/a.ts b/a.ts\\n--- a/a.ts\\n+++ b/a.ts\\n@@ -1 +1 @@\\n-a\\n+b\\n")
  }
} else if (group === "run" && command === "view") {
  const lines = []
  for (let i = 0; i < 300; i++) lines.push("test\\tRun tests\\t2026-01-01T00:00:00.0000000Z line " + i)
  lines.push("test\\tRun tests\\t2026-01-01T00:00:01.0000000Z ##[error]Process completed with exit code 1.")
  for (let i = 0; i < 20; i++) lines.push("test\\tPost job\\t2026-01-01T00:00:02.0000000Z cleanup " + i)
  process.stdout.write(lines.join("\\n") + "\\n")
} else if (group === "api" && command === "graphql") {
  if (args.some((arg) => arg.startsWith("q="))) {
    out({ data: { search: { nodes: [listNode, {}] } } })
  } else if (args.some((arg) => arg.startsWith("limit="))) {
    out({ data: { repository: { pullRequests: { nodes: [listNode] } } } })
  } else if (args.some((arg) => arg.includes("nameWithOwner"))) {
    out({ data: { repository: { nameWithOwner: "me/proj" } } })
  } else if (args.some((arg) => arg.startsWith("number="))) {
    out({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
      { id: "t1", isResolved: false, isOutdated: false, path: "a.ts", line: 4, startLine: null, comments: { nodes: [{ id: "k1", author: { login: "you" }, body: "Why?", createdAt: "t", url: "u", diffHunk: "@@ -1 +1 @@" }] } },
      { id: "t2", isResolved: true, isOutdated: true, path: "b.ts", line: null, originalLine: 9, startLine: null, comments: { nodes: [] } },
    ] } } } } })
  } else {
    const repository = {}
    const branchArgs = args.filter((arg) => /^b\\d+=/.test(arg))
    for (const arg of branchArgs) {
      const [key, branch] = arg.split("=")
      repository[key] = { nodes: branch === "none" ? [] : [
        { number: 3, state: "OPEN", isCrossRepository: true, headRepositoryOwner: { login: "other" }, updatedAt: "2026-02-01", headRefName: branch, reviewThreads: { nodes: [] }, commits: { nodes: [] } },
        { number: 1, state: "MERGED", updatedAt: "2026-01-01", headRefName: branch, reviewThreads: { nodes: [] }, commits: { nodes: [] } },
        { number: 2, state: "OPEN", updatedAt: "2025-01-01", headRefName: branch, reviewDecision: "APPROVED", reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] }, commits: listNode.commits },
      ] }
    }
    out({ data: { viewer: { login: "me" }, repository } })
  }
}
`

type Call = { args: Array<string> }

async function withFakeGh(
  mode: string,
  run: (cwd: string, log: () => Promise<Array<Call>>) => Promise<void>
) {
  const dir = await tempDir("smith-gh-prs-")
  const bin = join(dir, "gh")
  const logPath = join(dir, "log.jsonl")
  await writeFile(bin, FAKE_GH)
  await chmod(bin, 0o755)
  await writeFile(logPath, "")
  const saved = {
    PATH: process.env.PATH,
    FAKE_GH_LOG: process.env.FAKE_GH_LOG,
    FAKE_GH_MODE: process.env.FAKE_GH_MODE,
  }
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`
  process.env.FAKE_GH_LOG = logPath
  process.env.FAKE_GH_MODE = mode
  try {
    await run(dir, async () =>
      (await readFile(logPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call)
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

void test("github prs: summarize checks", () => {
  assert.deepEqual(prs.summarizeChecks([]), {
    state: "none",
    passed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  })
  assert.equal(
    prs.summarizeChecks([
      { __typename: "CheckRun", status: "QUEUED" },
      { __typename: "StatusContext", state: "SUCCESS" },
    ]).state,
    "pending"
  )
  assert.equal(
    prs.summarizeChecks([
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "NEUTRAL" },
      { __typename: "StatusContext", state: "SUCCESS" },
    ]).state,
    "success"
  )
  assert.equal(
    prs.summarizeChecks([{ __typename: "StatusContext", state: "ERROR" }])
      .state,
    "failure"
  )
})

void test("github prs: list, view, diff, check log, branch prs", async () => {
  await withFakeGh("", async (cwd, log) => {
    const list = await prs.listPrs(cwd, { filter: "review", limit: 9999 })
    // The search can find issues too; they have no PR fields and drop out.
    assert.equal(list.length, 1)
    assert.deepEqual(list[0].checks, {
      state: "failure",
      passed: 2,
      failed: 1,
      pending: 1,
      skipped: 1,
    })
    assert.equal(list[0].isDraft, true)
    assert.equal(list[0].commentCount, 1)
    assert.equal(list[0].mergeable, "CONFLICTING")
    await prs.listPrs(cwd, { filter: "mine" })
    await prs.listPrs(cwd, { filter: "bogus" })

    const pr = await prs.viewPr(cwd, 5)
    assert.equal(pr.body, "Body")
    assert.equal(pr.isCrossRepository, true)
    assert.equal(pr.headRepositoryOwner, "fork")
    // The review without text only holds thread comments.
    assert.deepEqual(
      pr.reviews.map((review) => review.state),
      ["CHANGES_REQUESTED"]
    )
    // Failed first, and Actions jobs know their run and job.
    assert.deepEqual(
      pr.checkRuns.map((item) => [item.name, item.runId, item.jobId]),
      [
        ["ext", undefined, undefined],
        ["test", "11", "33"],
        ["lint", "11", "22"],
      ]
    )
    assert.equal(pr.threads.length, 2)
    assert.equal(pr.threads[0].comments[0].body, "Why?")
    assert.equal(pr.threads[0].diffHunk, "@@ -1 +1 @@")
    assert.equal(pr.threads[1].line, 9)
    assert.deepEqual(pr.files[0], {
      path: "a.ts",
      additions: 3,
      deletions: 1,
      changeType: "MODIFIED",
    })

    const diff = await prs.prDiff(cwd, 5)
    assert.equal(diff.truncated, false)
    assert.match(diff.patch, /^diff --git a\/a.ts/)

    const actionsLog = await prs.prCheckLog(cwd, 5, "test")
    assert.equal(actionsLog.kind, "actions")
    if (actionsLog.kind === "actions") {
      assert.equal(actionsLog.jobId, "33")
      assert.equal(actionsLog.truncated, true)
      const lines = actionsLog.log.split("\n")
      assert.equal(lines.length, 200)
      // It ends near the error, without the job, step and time columns.
      assert.match(lines.at(-3) ?? "", /^##\[error\]Process completed/)
      assert.equal(lines.at(-1), "cleanup 1")
    }
    assert.equal((await prs.prCheckLog(cwd, 5, "22")).name, "lint")
    assert.deepEqual(await prs.prCheckLog(cwd, 5, "ext"), {
      kind: "link",
      name: "ext",
      link: "https://ci.example.com/build/1",
    })
    await assert.rejects(prs.prCheckLog(cwd, 5, "nope"), /No check named/)

    prs.clearBranchPrCache()
    const branches = prs.branchList("fix, none,fix")
    assert.deepEqual(branches, ["fix", "none"])
    const byBranch = await prs.branchPrs(cwd, branches)
    assert.equal(byBranch.none, null)
    assert.equal(byBranch.fix?.number, 2)
    assert.equal(byBranch.fix?.state, "OPEN")
    assert.equal(byBranch.fix?.unresolvedThreads, 1)
    assert.equal(byBranch.fix?.checks.state, "failure")
    // A second call in 30 s comes from the cache.
    await prs.branchPrs(cwd, branches)

    const calls = await log()
    const lists = calls.filter(
      (call) =>
        call.args[1] === "graphql" &&
        call.args.some((arg) => arg.startsWith("limit="))
    )
    const query = (call: Call) =>
      call.args.find((arg) => arg.startsWith("q=")) ?? ""
    assert.equal(
      query(lists[0]),
      "q=repo:me/proj is:pr is:open sort:updated-desc review-requested:@me"
    )
    assert.ok(lists[0].args.includes("limit=100"))
    assert.match(query(lists[1]), /author:@me$/)
    assert.equal(query(lists[2]), "")
    // The name of the repository is asked one time.
    assert.equal(
      calls.filter((call) =>
        call.args.some((arg) => arg.includes("{ nameWithOwner }"))
      ).length,
      1
    )
    const branchQueries = calls.filter(
      (call) =>
        call.args[1] === "graphql" &&
        call.args.some((arg) => arg.startsWith("b0="))
    )
    assert.equal(branchQueries.length, 1)
    assert.ok(branchQueries[0].args.includes("b1=none"))
    assert.deepEqual(
      calls
        .filter((call) => call.args[0] === "run")
        .map((call) => call.args.slice(0, 5)),
      [
        ["run", "view", "--job", "33", "--log-failed"],
        ["run", "view", "--job", "22", "--log-failed"],
      ]
    )
  })
})

void test("github prs: a big diff is cut at a file", async () => {
  await withFakeGh("big-diff", async (cwd) => {
    const diff = await prs.prDiff(cwd, 5)
    assert.equal(diff.truncated, true)
    assert.ok(diff.patch.length <= 5 * 1024 * 1024)
    assert.ok(diff.patch.endsWith("\n"))
    assert.equal(diff.patch.match(/^diff --git /gm)?.length, 4)
  })
})

void test("github prs: no checks, bad input and a logged-out gh", async () => {
  await withFakeGh("no-checks", async (cwd) => {
    assert.deepEqual(await prs.prChecks(cwd, 5), [])
  })
  await withFakeGh("logged-out", async (cwd) => {
    await assert.rejects(prs.listPrs(cwd, {}), /gh is not logged in/)
    await assert.rejects(prs.viewPr(cwd, 1), /gh is not logged in/)
  })
  assert.throws(() => prs.prNumber("x"), /pull request number/)
  assert.throws(() => prs.branchList(" , "), /branches is required/)
  assert.throws(
    () =>
      prs.branchList(Array.from({ length: 31 }, (_, i) => `b${i}`).join(",")),
    /At most 30/
  )
})

void test("github prs: gh is not installed", async () => {
  const saved = process.env.PATH
  process.env.PATH = "/nonexistent"
  try {
    await assert.rejects(prs.listPrs("/", {}), /not installed/)
  } finally {
    process.env.PATH = saved
  }
})

void test("github prs: a closed PR shows only while its branch has no newer commits", async () => {
  const { execFileSync } = await import("node:child_process")
  const cwd = await tempDir("smith-gh-prs-git-")
  const git = (...args: Array<string>) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
  git("init", "-q", "-b", "fuji")
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "one"
  )
  const first = git("rev-parse", "HEAD")
  assert.equal(await prs.closedPrIsCurrent(cwd, "fuji", first), true)
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "two"
  )
  const second = git("rev-parse", "HEAD")
  // The branch moved on after the PR: the old PR is not shown.
  assert.equal(await prs.closedPrIsCurrent(cwd, "fuji", first), false)
  // The local branch is behind the PR: still the same work.
  git("branch", "-f", "old", first)
  assert.equal(await prs.closedPrIsCurrent(cwd, "old", second), true)
  // No such branch, or no head commit: keep the PR.
  assert.equal(await prs.closedPrIsCurrent(cwd, "gone", first), true)
  assert.equal(await prs.closedPrIsCurrent(cwd, "fuji", ""), true)
})
