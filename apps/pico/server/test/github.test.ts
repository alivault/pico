/**
 * The GitHub issues service, with a fake `gh` on PATH. The fake writes its
 * arguments and stdin to a log and prints canned JSON.
 */
import assert from "node:assert/strict"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import * as github from "../src/services/github.ts"
import { tempDir } from "./support.ts"

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const input = args.includes("--input") ? fs.readFileSync(0, "utf8") : ""
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, input }) + "\\n")
const mode = process.env.FAKE_GH_MODE || ""
if (mode === "logged-out") {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\\n")
  process.exit(4)
}
const out = (value) => console.log(JSON.stringify(value))
const restIssue = { number: 9, title: "New", state: "closed", state_reason: "not_planned", labels: [{ name: "bug", color: "d73a4a" }], user: { login: "me" }, comments: 1, created_at: "c", updated_at: "u", html_url: "https://github.com/me/proj/issues/9", body: null, assignees: [] }
const [group, command] = args
if (group === "repo") {
  out({ nameWithOwner: "me/proj", url: "https://github.com/me/proj", hasIssuesEnabled: true, viewerPermission: "ADMIN" })
} else if (group === "api" && command === "user") {
  console.log("me")
} else if (group === "api") {
  const method = args[2]
  const path = args[3]
  if (method === "DELETE" && path.endsWith("/labels/gone")) {
    process.stderr.write("gh: Label does not exist (HTTP 404)\\n")
    process.exit(1)
  }
  if (path.endsWith("/comments")) out({ id: 77, user: { login: "me" }, body: JSON.parse(input).body, created_at: "t", html_url: "cu" })
  else if (path.includes("/labels")) out([{ name: "a", color: "ffffff" }])
  else out(restIssue)
} else if (group === "issue" && command === "list") {
  out([{ number: 3, title: "Bug", state: "OPEN", stateReason: "", labels: [{ name: "bug", color: "d73a4a" }], author: { login: "me" }, comments: [{}, {}], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", url: "https://github.com/me/proj/issues/3" }])
} else if (group === "issue" && command === "view") {
  out({ number: 3, title: "Bug", state: "CLOSED", stateReason: "NOT_PLANNED", labels: [], author: { login: "me" }, assignees: [{ login: "you" }], body: "Body", comments: [{ id: "c1", author: { login: "you" }, body: "Hi", createdAt: "2026-01-03T00:00:00Z", url: "u" }], createdAt: "", updatedAt: "", url: "https://github.com/me/proj/issues/3" })
}
`

async function withFakeGh(
  mode: string,
  run: (
    cwd: string,
    log: () => Promise<Array<{ args: Array<string>; input: string }>>
  ) => Promise<void>
) {
  const dir = await tempDir("pico-gh-")
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
        .map((line) => JSON.parse(line))
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

void test("github: repo, list, view, create, comment, state, labels", async () => {
  await withFakeGh("", async (cwd, log) => {
    assert.deepEqual(await github.repo(cwd), {
      available: true,
      viewerLogin: "me",
      nameWithOwner: "me/proj",
      url: "https://github.com/me/proj",
      viewerCanWrite: true,
    })

    const issues = await github.listIssues(cwd, {
      state: "bogus",
      label: "bug",
      search: "crash",
      limit: 5000,
    })
    assert.equal(issues.length, 1)
    assert.equal(issues[0].commentCount, 2)
    assert.equal(issues[0].author, "me")
    assert.equal("stateReason" in issues[0], false)

    const issue = await github.viewIssue(cwd, 3)
    assert.equal(issue.state, "CLOSED")
    assert.equal(issue.stateReason, "NOT_PLANNED")
    assert.deepEqual(issue.assignees, ["you"])
    assert.equal(issue.comments[0].author, "you")

    // The writes answer with the new data, mapped like the reads.
    assert.deepEqual(
      await github.createIssue(cwd, {
        title: "  New  ",
        body: "Some *body*",
        labels: ["bug", 3, " "],
      }),
      {
        number: 9,
        title: "New",
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
        labels: [{ name: "bug", color: "d73a4a" }],
        author: "me",
        commentCount: 1,
        createdAt: "c",
        updatedAt: "u",
        url: "https://github.com/me/proj/issues/9",
        body: "",
        assignees: [],
      }
    )
    assert.deepEqual(await github.commentIssue(cwd, 3, "Thanks"), {
      id: "77",
      author: "me",
      body: "Thanks",
      createdAt: "t",
      url: "cu",
    })
    assert.equal(
      (await github.setIssueState(cwd, 3, "closed", "not planned")).state,
      "CLOSED"
    )
    await github.setIssueState(cwd, 3, "open")
    assert.deepEqual(await github.editIssueLabels(cwd, 3, ["a"], ["b"]), [
      { name: "a", color: "ffffff" },
    ])
    // A label that is not on the issue is not an error.
    await github.editIssueLabels(cwd, 3, [], ["gone"])
    assert.equal(await github.editIssueLabels(cwd, 3, [], []), undefined)

    const calls = (await log()).filter(
      (call) => call.args[0] !== "repo" && call.args[1] !== "user"
    )
    const list = calls[0]
    assert.deepEqual(list.args.slice(0, 6), [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
    ])
    assert.ok(list.args.includes("--label") && list.args.includes("crash"))
    const writes = calls.slice(2)
    assert.deepEqual(
      writes.map((call) => [call.args[2], call.args[3], call.input]),
      [
        [
          "POST",
          "repos/{owner}/{repo}/issues",
          JSON.stringify({
            title: "New",
            body: "Some *body*",
            labels: ["bug"],
          }),
        ],
        [
          "POST",
          "repos/{owner}/{repo}/issues/3/comments",
          JSON.stringify({ body: "Thanks" }),
        ],
        [
          "PATCH",
          "repos/{owner}/{repo}/issues/3",
          JSON.stringify({ state: "closed", state_reason: "not_planned" }),
        ],
        [
          "PATCH",
          "repos/{owner}/{repo}/issues/3",
          JSON.stringify({ state: "open", state_reason: "reopened" }),
        ],
        [
          "POST",
          "repos/{owner}/{repo}/issues/3/labels",
          JSON.stringify({ labels: ["a"] }),
        ],
        ["DELETE", "repos/{owner}/{repo}/issues/3/labels/b", ""],
        ["DELETE", "repos/{owner}/{repo}/issues/3/labels/gone", ""],
      ]
    )
  })
})

void test("github: bad input and a logged-out gh", async () => {
  await withFakeGh("logged-out", async (cwd) => {
    const repo = await github.repo(cwd)
    assert.equal(repo.available, false)
    assert.match(repo.available ? "" : repo.reason, /gh auth login/)
    await assert.rejects(github.listIssues(cwd, {}), /auth login/)
  })
  assert.throws(() => github.issueNumber("abc"), /issue number/)
  assert.throws(() => github.issueNumber("0"), /issue number/)
  assert.equal(github.issueNumber("12"), 12)
  await assert.rejects(github.createIssue("/", { title: " " }), /title/)
  await assert.rejects(github.commentIssue("/", 1, " "), /comment/)
  await assert.rejects(github.setIssueState("/", 1, "merged"), /state/)
})

void test("github: gh is not installed", async () => {
  const saved = process.env.PATH
  process.env.PATH = "/nonexistent"
  try {
    const repo = await github.repo("/")
    assert.equal(repo.available, false)
    assert.match(repo.available ? "" : repo.reason, /not installed/)
  } finally {
    process.env.PATH = saved
  }
})
