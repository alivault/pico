/**
 * Writes to pull requests, with a fake `gh` on PATH and real git
 * repositories. The fake logs its arguments and stdin, and reads the pull
 * request state from a JSON file.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import * as writes from "../src/services/github-pr-writes.ts"
import { clearBranchPrCache } from "../src/services/github-prs.ts"
import { tempDir } from "./support.ts"

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const input = args.includes("--input") || args.includes("--body-file") ? fs.readFileSync(0, "utf8") : ""
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, input }) + "\\n")
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"))
const out = (value) => console.log(JSON.stringify(value))
const query = (args.find((arg) => arg.startsWith("query=")) || "").slice(6)
const [group, command] = args
if (group === "api" && command === "graphql") {
  if (query.includes("resolveReviewThread") || query.includes("unresolveReviewThread")) {
    const name = query.includes("unresolveReviewThread") ? "unresolveReviewThread" : "resolveReviewThread"
    out({ data: { [name]: { thread: { isResolved: name === "resolveReviewThread" } } } })
  } else if (query.includes("addPullRequestReviewThreadReply")) {
    out({ data: { addPullRequestReviewThreadReply: { comment: { id: "C1", url: "u" } } } })
  } else if (query.includes("viewerMergeHeadlineText")) {
    out({ data: { repository: { mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true, viewerDefaultMergeMethod: "MERGE", defaultBranchRef: { name: "main" }, pullRequest: { state: state.prState, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: state.mergeStateStatus || "CLEAN", viewerCanMergeAsAdmin: Boolean(state.canAdmin), title: "Fix", headRefName: "feature", headRefOid: state.headOid, isCrossRepository: false, viewerMergeHeadlineText: "Fix (#7)", viewerMergeBodyText: "" } } } })
  } else if (query.includes("defaultBranchRef { name } } }")) {
    out({ data: { repository: { defaultBranchRef: { name: "main" } } } })
  } else {
    out({ data: { viewer: { login: "me" }, repository: { b0: { nodes: state.openPr ? [{ number: 3, state: "OPEN", headRefName: "feature" }] : [] } } } })
  }
} else if (group === "api") {
  const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET"
  const path = args.find((arg) => arg.startsWith("repos/"))
  if (method === "POST" && path.endsWith("/reviews")) out({ id: 42, state: JSON.parse(input).event, html_url: "r" })
  else if (method === "GET" && path.includes("/git/ref/heads/")) {
    if (state.remoteGone) { process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1) }
    out({ object: { sha: state.remoteSha || state.headOid } })
  } else if (method === "DELETE") console.log("")
} else if (group === "pr" && command === "create") {
  console.log("https://github.com/me/proj/pull/9")
} else if (group === "pr" && command === "comment") {
  console.log("https://github.com/me/proj/pull/7#issuecomment-1")
} else if (group === "pr" && command === "merge") {
  state.prState = "MERGED"
  fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state))
}
`

type Call = { args: Array<string>; input: string }

function sh(cwd: string, ...args: Array<string>) {
  return execFileSync("git", args, { cwd }).toString().trim()
}

/** A repository with a bare origin, a pushed branch "feature", and the PR ref. */
async function setup(dir: string) {
  const origin = join(dir, "origin.git")
  const repo = join(dir, "repo")
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin])
  execFileSync("git", ["init", "-q", "-b", "main", repo])
  sh(repo, "config", "user.email", "t@example.com")
  sh(repo, "config", "user.name", "Test")
  await writeFile(join(repo, "README.md"), "hi\n")
  sh(repo, "add", ".")
  sh(repo, "commit", "-qm", "init")
  sh(repo, "remote", "add", "origin", origin)
  sh(repo, "push", "-q", "-u", "origin", "main")
  sh(repo, "checkout", "-q", "-b", "feature")
  await writeFile(join(repo, "a.txt"), "a\n")
  sh(repo, "add", ".")
  sh(repo, "commit", "-qm", "Add a")
  sh(repo, "push", "-q", "-u", "origin", "feature")
  const headOid = sh(repo, "rev-parse", "HEAD")
  sh(origin, "update-ref", "refs/pull/7/head", headOid)
  return { repo, origin, headOid }
}

async function withFakeGh(
  state: Record<string, unknown>,
  run: (
    dir: string,
    log: () => Promise<Array<Call>>,
    setState: (change: Record<string, unknown>) => Promise<void>
  ) => Promise<void>
) {
  const dir = await tempDir("smith-gh-writes-")
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
          .map((line) => JSON.parse(line) as Call),
      async (change) => {
        const current = JSON.parse(await readFile(statePath, "utf8"))
        await writeFile(statePath, JSON.stringify({ ...current, ...change }))
      }
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

void test("pr writes: input checks and text", () => {
  assert.equal(writes.branchName("feature/x"), "feature/x")
  for (const bad of ["", "-x", "a..b", "a b", "a~1", "x.lock", "a//b"]) {
    assert.throws(() => writes.branchName(bad), /valid branch/)
  }
  assert.deepEqual(
    writes.mergeArgs(7, { method: "squash", subject: "Fix (#7)", body: "" }, [
      "squash",
      "rebase",
    ]),
    ["pr", "merge", "7", "--squash", "--subject", "Fix (#7)", "--body", ""]
  )
  assert.deepEqual(
    writes.mergeArgs(7, { method: "rebase", subject: "x", admin: true }, [
      "rebase",
    ]),
    ["pr", "merge", "7", "--rebase", "--admin"]
  )
  assert.throws(
    () => writes.mergeArgs(7, { method: "merge" }, ["squash"]),
    /does not allow merge/
  )
  assert.throws(
    () => writes.mergeArgs(7, { method: "--admin" }, ["squash"]),
    /method must be/
  )
  assert.deepEqual(writes.parsePrText("Title: Add a\n\nBody text\n- one"), {
    title: "Add a",
    body: "Body text\n- one",
  })
  assert.deepEqual(writes.heuristicPrText("ali/fix-login_bug", ["b", "a"]), {
    title: "Fix login bug",
    body: "- a\n- b",
  })
  assert.equal(writes.heuristicPrText("x", ["Only one"]).title, "Only one")
})

void test("pr writes: create checks the branch, then runs gh pr create", async () => {
  await withFakeGh({ prState: "OPEN" }, async (dir, log, setState) => {
    const { repo } = await setup(dir)
    const info = await writes.createPrInfo(repo)
    assert.equal(info.branch, "feature")
    assert.equal(info.defaultBranch, "main")
    assert.equal(info.reason, "")
    assert.deepEqual(info.bases, ["main"])
    const created = await writes.createPr(repo, {
      base: "main",
      title: " Add a ",
      body: "Body",
      draft: true,
    })
    assert.equal(created.number, 9)
    const call = (await log()).find((item) => item.args[0] === "pr")!
    assert.deepEqual(call.args, [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      "feature",
      "--title",
      "Add a",
      "--body-file",
      "-",
      "--draft",
    ])
    assert.equal(call.input, "Body")
    // Not pushed, an open PR, the default branch: no create.
    await writeFile(join(repo, "b.txt"), "b\n")
    sh(repo, "add", ".")
    sh(repo, "commit", "-qm", "Add b")
    await assert.rejects(
      writes.createPr(repo, { base: "main", title: "x" }),
      /1 commit is not pushed/
    )
    sh(repo, "push", "-q")
    await setState({ openPr: true })
    assert.match(
      (await writes.createPrInfo(repo)).reason,
      /already has pull request #3/
    )
    sh(repo, "checkout", "-q", "main")
    assert.match((await writes.createPrInfo(repo)).reason, /default branch/)
    const { context, subjects } = await writes.prTextContext(
      join(dir, "repo"),
      "main"
    )
    assert.deepEqual(subjects, [])
    assert.match(context, /COMMITS:/)
  })
})

void test("pr writes: review payload, reply, resolve, comment", async () => {
  await withFakeGh({ prState: "OPEN" }, async (dir, log) => {
    const review = await writes.submitReview(dir, 7, {
      event: "REQUEST_CHANGES",
      body: "Please fix",
      comments: [
        { path: "a.ts", line: 4, side: "RIGHT", body: "Why?" },
        {
          path: "b.ts",
          line: 9,
          side: "LEFT",
          startLine: 7,
          body: "Range",
        },
      ],
    })
    assert.deepEqual(review, { id: 42, state: "REQUEST_CHANGES", url: "r" })
    await assert.rejects(
      writes.submitReview(dir, 7, { event: "COMMENT", body: " " }),
      /needs a text or a line comment/
    )
    await assert.rejects(
      writes.submitReview(dir, 7, {
        event: "COMMENT",
        comments: [{ path: "../x", line: 1, side: "RIGHT", body: "x" }],
      }),
      /needs a path/
    )
    await assert.rejects(
      writes.submitReview(dir, 7, { event: "MERGE" }),
      /event must be/
    )
    // An approval needs no text.
    await writes.submitReview(dir, 7, { event: "APPROVE" })
    assert.deepEqual(await writes.replyToThread(dir, "PRRT_abc", "Done"), {
      id: "C1",
    })
    assert.deepEqual(await writes.setThreadResolved(dir, "PRRT_abc", true), {
      isResolved: true,
    })
    assert.deepEqual(await writes.setThreadResolved(dir, "PRRT_abc", false), {
      isResolved: false,
    })
    await assert.rejects(
      writes.setThreadResolved(dir, "bad id!", true),
      /thread ID/
    )
    await writes.commentPr(dir, 7, "Thanks")

    const calls = await log()
    const reviews = calls.filter((call) =>
      call.args.some((arg) => arg.endsWith("/reviews"))
    )
    assert.deepEqual(reviews[0].args, [
      "api",
      "--method",
      "POST",
      "repos/{owner}/{repo}/pulls/7/reviews",
      "--input",
      "-",
    ])
    assert.deepEqual(JSON.parse(reviews[0].input), {
      event: "REQUEST_CHANGES",
      body: "Please fix",
      comments: [
        { path: "a.ts", line: 4, side: "RIGHT", body: "Why?" },
        {
          path: "b.ts",
          line: 9,
          side: "LEFT",
          body: "Range",
          start_line: 7,
          start_side: "LEFT",
        },
      ],
    })
    const mutations = calls.filter((call) => call.args[1] === "graphql")
    // A mutation by ID needs no owner and repo.
    assert.ok(mutations.every((call) => !call.args.includes("owner={owner}")))
    assert.ok(mutations[0].args.includes("thread=PRRT_abc"))
    assert.ok(mutations[0].args.includes("body=Done"))
    const comment = calls.find((call) => call.args[1] === "comment")!
    assert.deepEqual(comment.args, ["pr", "comment", "7", "--body-file", "-"])
    assert.equal(comment.input, "Thanks")
  })
})

void test("pr writes: merge flags and the admin check", async () => {
  await withFakeGh(
    { prState: "OPEN", headOid: "x", mergeStateStatus: "BLOCKED" },
    async (dir, log, setState) => {
      const info = await writes.mergeInfo(dir, 7)
      assert.deepEqual(info.allowed, ["squash", "rebase"])
      // The default MERGE is not allowed: the first allowed method.
      assert.equal(info.defaultMethod, "squash")
      assert.equal(info.squashTitle, "Fix (#7)")
      await assert.rejects(
        writes.mergePr(dir, 7, { method: "squash", admin: true }),
        /cannot merge this pull request as an admin/
      )
      await setState({ canAdmin: true })
      const result = await writes.mergePr(dir, 7, {
        method: "squash",
        admin: true,
        subject: "Fix (#7)",
        body: "Body",
      })
      assert.deepEqual(result, { state: "MERGED", merged: true })
      const merge = (await log()).find((call) => call.args[1] === "merge")!
      assert.deepEqual(merge.args, [
        "pr",
        "merge",
        "7",
        "--squash",
        "--subject",
        "Fix (#7)",
        "--body",
        "Body",
        "--admin",
      ])
      await assert.rejects(
        writes.mergePr(dir, 7, { method: "squash" }),
        /not open/
      )
    }
  )
})

void test("pr writes: clean-up keeps a branch with unpushed commits", async () => {
  const dir0 = await tempDir("smith-gh-clean-")
  const { repo, headOid } = await setup(dir0)
  await withFakeGh(
    { prState: "OPEN", headOid },
    async (_dir, log, setState) => {
      // A worktree on the branch, with one commit that is not in the PR.
      sh(repo, "checkout", "-q", "main")
      const worktree = join(dir0, "wt")
      sh(repo, "worktree", "add", "-q", worktree, "feature")
      await writeFile(join(worktree, "c.txt"), "c\n")
      sh(worktree, "add", ".")
      sh(worktree, "commit", "-qm", "Not pushed")

      let info = await writes.cleanupInfo(repo, 7)
      await assert.rejects(
        writes.cleanupBranch(repo, info, {
          removeLocal: true,
          deleteRemote: true,
        }),
        /only after the pull request is merged/
      )
      await setState({ prState: "MERGED" })
      info = await writes.cleanupInfo(repo, 7)
      assert.equal(info.localBranch.unpushed, 1)
      assert.match(writes.localWorkReason(info), /1 commit that is not in/)
      assert.deepEqual(
        info.worktrees.map((item) => item.path.endsWith("wt")),
        [true]
      )
      let steps = await writes.cleanupBranch(repo, info, {
        removeLocal: true,
        deleteRemote: true,
      })
      assert.deepEqual(
        steps.map((step) => [step.step, step.ok, Boolean(step.skipped)]),
        [
          ["worktree", false, true],
          ["local-branch", false, true],
          ["remote-branch", true, false],
        ]
      )
      assert.ok(existsSync(worktree))
      assert.equal(
        sh(repo, "branch", "--list", "--format=%(refname:short)", "feature"),
        "feature"
      )
      assert.equal(
        (await log()).filter((call) => call.args.includes("DELETE")).length,
        1
      )

      // Without the extra commit, all of it goes. The remote is gone already.
      sh(worktree, "reset", "-q", "--hard", headOid)
      await setState({ remoteGone: true })
      info = await writes.cleanupInfo(repo, 7)
      assert.equal(info.localBranch.unpushed, 0)
      steps = await writes.cleanupBranch(repo, info, {
        removeLocal: true,
        deleteRemote: true,
      })
      assert.deepEqual(
        steps.map((step) => [step.step, step.ok]),
        [
          ["worktree", true],
          ["local-branch", true],
          ["remote-branch", true],
        ]
      )
      assert.match(steps[2].message, /gone already/)
      assert.equal(existsSync(worktree), false)
      assert.equal(
        sh(repo, "branch", "--list", "--format=%(refname:short)", "feature"),
        ""
      )
    }
  )
})

void test("pr writes: a remote branch with newer commits stays", async () => {
  const dir0 = await tempDir("smith-gh-clean2-")
  const { repo, headOid } = await setup(dir0)
  await withFakeGh(
    { prState: "MERGED", headOid, remoteSha: "other" },
    async (_dir, log) => {
      const info = await writes.cleanupInfo(repo, 7)
      const steps = await writes.cleanupBranch(repo, info, {
        removeLocal: false,
        deleteRemote: true,
      })
      assert.deepEqual(
        steps.map((step) => step.message),
        [
          "Did not delete the remote branch: it has commits that are not in the pull request.",
        ]
      )
      assert.equal(
        (await log()).filter((call) => call.args.includes("DELETE")).length,
        0
      )
    }
  )
})
