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
const input = args.includes("--body-file") ? fs.readFileSync(0, "utf8") : ""
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, input }) + "\\n")
const mode = process.env.FAKE_GH_MODE || ""
if (mode === "logged-out") {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\\n")
  process.exit(4)
}
const [group, command] = args
if (group === "repo") {
  console.log(JSON.stringify({ nameWithOwner: "me/proj", url: "https://github.com/me/proj", hasIssuesEnabled: true, viewerPermission: "ADMIN" }))
} else if (group === "issue" && command === "list") {
  console.log(JSON.stringify([{ number: 3, title: "Bug", state: "OPEN", stateReason: "", labels: [{ name: "bug", color: "d73a4a" }], author: { login: "me" }, comments: [{}, {}], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", url: "https://github.com/me/proj/issues/3" }]))
} else if (group === "issue" && command === "view") {
  console.log(JSON.stringify({ number: 3, title: "Bug", state: "CLOSED", stateReason: "NOT_PLANNED", labels: [], author: { login: "me" }, assignees: [{ login: "you" }], body: "Body", comments: [{ id: "c1", author: { login: "you" }, body: "Hi", createdAt: "2026-01-03T00:00:00Z", url: "u" }], createdAt: "", updatedAt: "", url: "https://github.com/me/proj/issues/3" }))
} else if (group === "issue" && command === "create") {
  console.log("https://github.com/me/proj/issues/9")
} else if (group === "issue" && command === "comment") {
  console.log("https://github.com/me/proj/issues/3#issuecomment-1")
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

test("github: repo, list, view, create, comment, state, labels", async () => {
  await withFakeGh("", async (cwd, log) => {
    assert.deepEqual(await github.repo(cwd), {
      available: true,
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

    assert.deepEqual(
      await github.createIssue(cwd, {
        title: "  New  ",
        body: "Some *body*",
        labels: ["bug", 3, " "],
      }),
      { number: 9, url: "https://github.com/me/proj/issues/9" }
    )
    await github.commentIssue(cwd, 3, "Thanks")
    await github.setIssueState(cwd, 3, "closed", "not planned")
    await github.setIssueState(cwd, 3, "open")
    await github.editIssueLabels(cwd, 3, ["a"], ["b"])
    await github.editIssueLabels(cwd, 3, [], [])

    const calls = await log()
    const list = calls[1]
    assert.deepEqual(list.args.slice(0, 6), [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
    ])
    assert.ok(list.args.includes("--label") && list.args.includes("crash"))
    assert.deepEqual(calls[3], {
      args: [
        "issue",
        "create",
        "--title",
        "New",
        "--body-file",
        "-",
        "--label",
        "bug",
      ],
      input: "Some *body*",
    })
    assert.equal(calls[4].input, "Thanks")
    assert.deepEqual(calls[5].args, [
      "issue",
      "close",
      "3",
      "--reason",
      "not planned",
    ])
    assert.deepEqual(calls[6].args, ["issue", "reopen", "3"])
    assert.deepEqual(calls[7].args, [
      "issue",
      "edit",
      "3",
      "--add-label",
      "a",
      "--remove-label",
      "b",
    ])
    // Nothing to change: no call.
    assert.equal(calls.length, 8)
  })
})

test("github: bad input and a logged-out gh", async () => {
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

test("github: gh is not installed", async () => {
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
