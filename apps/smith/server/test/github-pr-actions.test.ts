/**
 * Quick actions on pull requests, with a fake `gh` on PATH and a real git
 * repository. The fake logs its arguments and reads its answers from a
 * JSON file.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import * as actions from "../src/services/github-pr-actions.ts"
import { clearBranchPrCache } from "../src/services/github-prs.ts"
import { tempDir } from "./support.ts"

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n")
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"))
const out = (value) => console.log(JSON.stringify(value))
const query = (args.find((arg) => arg.startsWith("query=")) || "").slice(6)
const [group, command] = args
if (group === "pr" && command === "checks") {
  out(state.checks || [])
  process.exit((state.checks || []).some((c) => c.bucket === "fail") ? 1 : 0)
} else if (group === "run" && command === "rerun") {
  if ((state.rerunFails || []).includes(args[2])) { process.stderr.write("run is too old\\n"); process.exit(1) }
} else if (group === "api" && command === "graphql") {
  if (query.includes("assignableUsers")) {
    out({ data: { viewer: { login: "me" }, repository: { assignableUsers: { nodes: [{ login: "me", name: "Me" }, { login: "ann", name: null }] }, pullRequest: { suggestedReviewers: [{ reviewer: { login: "bob", name: "Bob" } }] } } } })
  } else {
    out({ data: { repository: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: Boolean(state.rebase), viewerDefaultMergeMethod: "MERGE", defaultBranchRef: { name: "main" }, pullRequest: { state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", viewerCanMergeAsAdmin: false, title: "Fix", headRefName: state.head || "feature", headRefOid: "abc", isCrossRepository: Boolean(state.fork), viewerMergeHeadlineText: "", viewerMergeBodyText: "" } } } })
  }
} else if (group === "pr" && command === "checkout") {
  const branch = args[args.indexOf("--branch") + 1]
  require("node:child_process").execFileSync("git", ["checkout", "-q", "-b", branch])
}
`

type Calls = () => Promise<Array<Array<string>>>

async function withFakeGh(
  state: Record<string, unknown>,
  run: (
    dir: string,
    calls: Calls,
    setState: (state: Record<string, unknown>) => Promise<void>
  ) => Promise<void>
) {
  const dir = await tempDir("smith-gh-actions-")
  const bin = join(dir, "bin")
  execFileSync("mkdir", ["-p", bin])
  await writeFile(join(bin, "gh"), FAKE_GH)
  await chmod(join(bin, "gh"), 0o755)
  const logPath = join(dir, "log.jsonl")
  const statePath = join(dir, "state.json")
  await writeFile(logPath, "")
  await writeFile(statePath, JSON.stringify(state))
  const saved = {
    PATH: process.env.PATH,
    FAKE_GH_LOG: process.env.FAKE_GH_LOG,
    FAKE_GH_STATE: process.env.FAKE_GH_STATE,
  }
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
  process.env.FAKE_GH_LOG = logPath
  process.env.FAKE_GH_STATE = statePath
  clearBranchPrCache()
  try {
    await run(
      dir,
      async () =>
        (await readFile(logPath, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Array<string>),
      (next) => writeFile(statePath, JSON.stringify(next))
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function sh(cwd: string, ...args: Array<string>) {
  return execFileSync("git", args, { cwd }).toString().trim()
}

async function repo(dir: string) {
  const path = join(dir, "repo")
  execFileSync("git", ["init", "-q", "-b", "main", path])
  sh(path, "config", "user.email", "t@example.com")
  sh(path, "config", "user.name", "Test")
  await writeFile(join(path, "a.txt"), "a\n")
  sh(path, "add", ".")
  sh(path, "commit", "-qm", "init")
  return path
}

const last = async (calls: Calls) => (await calls()).at(-1)

void test("pr actions: edit flags and input checks", () => {
  assert.deepEqual(
    actions.editArgs(7, {
      addAssignees: ["@me", "ann"],
      removeAssignees: ["bob"],
      addReviewers: ["carl", "acme/core-team"],
      removeReviewers: [],
      addLabels: ["bug", "good first issue"],
      removeLabels: ["wip"],
    }),
    [
      "pr",
      "edit",
      "7",
      "--add-assignee",
      "@me,ann",
      "--remove-assignee",
      "bob",
      "--add-reviewer",
      "carl,acme/core-team",
      "--add-label",
      "bug,good first issue",
      "--remove-label",
      "wip",
    ]
  )
  assert.throws(() => actions.editArgs(7, {}), /Nothing to change/)
  for (const bad of ["-x", "a b", "a,b", "--remove", "x".repeat(40)])
    assert.throws(
      () => actions.editArgs(7, { addAssignees: [bad] }),
      /Not a GitHub login/,
      bad
    )
  // A team can review, but not be assigned.
  assert.throws(
    () => actions.editArgs(7, { addAssignees: ["acme/core"] }),
    /Not a GitHub login/
  )
  assert.throws(() => actions.editArgs(7, { addLabels: ["a,b"] }), /comma/)
  assert.throws(() => actions.editArgs(7, { addLabels: "bug" }), /list/)
  assert.throws(() => actions.editArgs(7, { addLabels: [""] }), /text/)
  assert.throws(
    () => actions.editArgs(7, { addReviewers: Array(21).fill("ann") }),
    /Too many/
  )
})

void test("pr actions: rerun failed checks per run, links for others", async () => {
  const fail = (name: string, link: string) => ({
    name,
    state: "FAILURE",
    bucket: "fail",
    link,
    workflow: "CI",
    description: "",
    startedAt: "",
    completedAt: "",
  })
  await withFakeGh(
    {
      checks: [
        fail("test", "https://github.com/me/p/actions/runs/11/job/1"),
        fail("lint", "https://github.com/me/p/actions/runs/11/job/2"),
        fail("e2e", "https://github.com/me/p/actions/runs/12/job/3"),
        fail("vercel", "https://vercel.com/x"),
        {
          ...fail("ok", "https://github.com/me/p/actions/runs/13/job/4"),
          bucket: "pass",
        },
      ],
      rerunFails: ["12"],
    },
    async (dir, calls, setState) => {
      const result = await actions.rerunFailed(dir, 7)
      assert.deepEqual(result.rerun, ["11"])
      assert.deepEqual(result.links, [
        { name: "vercel", link: "https://vercel.com/x" },
      ])
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0]!, /Run 12: .*too old/)
      const reruns = (await calls())
        .filter((args) => args[0] === "run")
        .sort((a, b) => a[2]!.localeCompare(b[2]!))
      assert.deepEqual(reruns, [
        ["run", "rerun", "11", "--failed"],
        ["run", "rerun", "12", "--failed"],
      ])
      await setState({ checks: [] })
      await assert.rejects(actions.rerunFailed(dir, 7), /No failed checks/)
    }
  )
})

void test("pr actions: update branch, draft, close and reopen, people", async () => {
  await withFakeGh({ rebase: false }, async (dir, calls, setState) => {
    await actions.updateBranch(dir, 7, false)
    assert.deepEqual(await last(calls), ["pr", "update-branch", "7"])
    await assert.rejects(
      actions.updateBranch(dir, 7, true),
      /does not allow rebase/
    )
    await setState({ rebase: true })
    await actions.updateBranch(dir, 7, true)
    assert.deepEqual(await last(calls), [
      "pr",
      "update-branch",
      "7",
      "--rebase",
    ])
    await actions.setDraft(dir, 7, true)
    assert.deepEqual(await last(calls), ["pr", "ready", "7", "--undo"])
    await actions.setDraft(dir, 7, false)
    assert.deepEqual(await last(calls), ["pr", "ready", "7"])
    await actions.setOpen(dir, 7, false)
    assert.deepEqual(await last(calls), ["pr", "close", "7"])
    await actions.setOpen(dir, 7, true)
    assert.deepEqual(await last(calls), ["pr", "reopen", "7"])
    await actions.editPr(dir, 7, { addAssignees: ["@me"] })
    assert.deepEqual(await last(calls), [
      "pr",
      "edit",
      "7",
      "--add-assignee",
      "@me",
    ])
    const people = await actions.prPeople(dir, 7)
    assert.deepEqual(people, {
      viewer: "me",
      assignable: [
        { login: "me", name: "Me" },
        { login: "ann", name: "" },
      ],
      suggested: [{ login: "bob", name: "Bob" }],
    })
  })
})

void test("pr actions: check out only in a clean project", async () => {
  await withFakeGh({}, async (dir, calls, setState) => {
    const path = await repo(dir)
    let info = await actions.checkoutInfo(path, 7)
    assert.deepEqual(info, {
      root: info.root,
      current: "main",
      branch: "feature",
      dirty: false,
      worktree: "",
    })
    // Uncommitted changes: refused, and gh does not run.
    await writeFile(join(path, "a.txt"), "changed\n")
    assert.equal((await actions.checkoutInfo(path, 7)).dirty, true)
    await assert.rejects(actions.checkoutPr(path, 7), /uncommitted changes/)
    assert.ok(!(await calls()).some((args) => args[1] === "checkout"))
    sh(path, "checkout", "-q", "--", "a.txt")
    // An untracked file does not count.
    await writeFile(join(path, "new.txt"), "x\n")
    const result = await actions.checkoutPr(path, 7)
    assert.equal(result.branch, "feature")
    assert.equal(sh(path, "branch", "--show-current"), "feature")
    assert.deepEqual(await last(calls), [
      "pr",
      "checkout",
      "7",
      "--branch",
      "feature",
    ])
    // A fork gets its own local name.
    sh(path, "checkout", "-q", "main")
    await setState({ fork: true, head: "main" })
    info = await actions.checkoutInfo(path, 8)
    assert.equal(info.branch, "pr-8-main")
    // A branch in another worktree is refused.
    await setState({})
    sh(path, "branch", "-q", "-D", "feature")
    sh(path, "worktree", "add", "-q", "-b", "feature", join(dir, "wt"))
    info = await actions.checkoutInfo(path, 7)
    assert.match(info.worktree, /wt$/)
    await assert.rejects(actions.checkoutPr(path, 7), /checked out in/)
  })
})
