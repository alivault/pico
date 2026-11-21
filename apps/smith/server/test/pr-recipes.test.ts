/**
 * Recipes: template rendering, the values of a pull request (with a fake
 * `gh` for the logs and the diff), validation, the store, and the target.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import type { GhPr } from "../src/services/github-prs.ts"
import * as recipes from "../src/services/pr-recipes.ts"
import { tempDir } from "./support.ts"

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n")
if (args[0] === "run" && args[1] === "view") {
  if (args[3] === "99") { process.stderr.write("log expired\\n"); process.exit(1) }
  console.log("test\\tRun\\t2024-01-01T00:00:00.0000000Z npm test\\ntest\\tRun\\t2024-01-01T00:00:01.0000000Z ##[error]expected 3 to be 4")
} else if (args[0] === "pr" && args[1] === "diff") {
  process.stdout.write(process.env.FAKE_DIFF || "")
}
`

function pr(change: Partial<GhPr> = {}): GhPr {
  return {
    number: 7,
    title: "Fix the parser",
    state: "OPEN",
    isDraft: false,
    author: "ann",
    headRefName: "fix-parser",
    baseRefName: "main",
    updatedAt: "",
    url: "https://github.com/me/p/pull/7",
    reviewDecision: "",
    mergeable: "MERGEABLE",
    checks: { state: "failure", passed: 1, failed: 2, pending: 0, skipped: 0 },
    commentCount: 0,
    labels: [],
    body: "It fixes the parser.",
    createdAt: "",
    mergeStateStatus: "CLEAN",
    headRepositoryOwner: "me",
    headRepository: "p",
    isCrossRepository: false,
    additions: 3,
    deletions: 1,
    changedFiles: 2,
    reviews: [],
    comments: [],
    checkRuns: [
      {
        name: "test",
        bucket: "fail",
        state: "FAILURE",
        link: "https://x/actions/runs/5/job/1",
        workflow: "CI",
        description: "",
        startedAt: "",
        completedAt: "",
        runId: "5",
        jobId: "1",
      },
      {
        name: "e2e",
        bucket: "fail",
        state: "FAILURE",
        link: "https://x/actions/runs/5/job/99",
        workflow: "CI",
        description: "",
        startedAt: "",
        completedAt: "",
        runId: "5",
        jobId: "99",
      },
      {
        name: "vercel",
        bucket: "pass",
        state: "SUCCESS",
        link: "https://vercel.com",
        workflow: "",
        description: "",
        startedAt: "",
        completedAt: "",
      },
    ],
    threads: [
      {
        id: "T1",
        isResolved: false,
        isOutdated: false,
        path: "src/parse.ts",
        line: 12,
        startLine: null,
        diffHunk: "@@ -1,2 +1,2 @@\n-old\n+new",
        comments: [
          {
            id: "c",
            author: "bob",
            body: "Handle empty input",
            createdAt: "",
            url: "",
          },
        ],
      },
      {
        id: "T2",
        isResolved: true,
        isOutdated: false,
        path: "src/done.ts",
        line: 1,
        startLine: null,
        diffHunk: "",
        comments: [
          { id: "d", author: "bob", body: "Done one", createdAt: "", url: "" },
        ],
      },
    ],
    files: [
      {
        path: "src/parse.ts",
        additions: 2,
        deletions: 1,
        changeType: "MODIFIED",
      },
      {
        path: "test/parse.test.ts",
        additions: 1,
        deletions: 0,
        changeType: "ADDED",
      },
    ],
    assignees: [],
    reviewRequests: [],
    ...change,
  }
}

async function withFakeGh(
  run: (
    calls: () => Promise<Array<Array<string>>>,
    dir: string
  ) => Promise<void>,
  diff = ""
) {
  const dir = await tempDir("smith-recipes-")
  const bin = join(dir, "bin")
  await mkdir(bin)
  await writeFile(join(bin, "gh"), FAKE_GH)
  await chmod(join(bin, "gh"), 0o755)
  const log = join(dir, "log.jsonl")
  await writeFile(log, "")
  const saved = {
    PATH: process.env.PATH,
    FAKE_GH_LOG: process.env.FAKE_GH_LOG,
    FAKE_DIFF: process.env.FAKE_DIFF,
  }
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
  process.env.FAKE_GH_LOG = log
  process.env.FAKE_DIFF = diff
  try {
    await run(
      async () =>
        (await readFile(log, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Array<string>),
      dir
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

void test("recipes: variables and rendering", () => {
  const { used, unknown } = recipes.templateVariables(
    "{{pr}} {{ title }} {{nope}} {{diff}} {{nope}} {not}"
  )
  assert.deepEqual([...used].sort(), ["diff", "pr", "title"])
  assert.deepEqual(unknown, ["nope"])
  assert.equal(
    recipes.renderTemplate("A {{pr}} {{ title }} {{body}}.", {
      pr: "#7",
      title: "T",
    }),
    "A #7 T ."
  )
  assert.throws(
    () => recipes.renderTemplate("{{nope}} {{bad}}", {}),
    /Unknown variables: \{\{nope\}\}, \{\{bad\}\}/
  )
})

void test("recipes: all values of a pull request, on demand only when asked", async () => {
  const all = recipes.RECIPE_VARIABLES.map(
    (item) => `[${item.name}]{{${item.name}}}`
  ).join("\n")
  const patch = `diff --git a/a b/a\n+${"x".repeat(100)}\n`
  await withFakeGh(async (calls, dir) => {
    // Preview: no logs and no diff are loaded.
    let { values } = await recipes.recipeValues(dir, 7, all, {
      load: false,
      pr: pr(),
    })
    let text = recipes.renderTemplate(all, values)
    assert.equal((await calls()).length, 0)
    assert.match(text, /\[pr\]#7\n\[number\]7\n\[title\]Fix the parser\n/)
    assert.match(text, /\[url\]https:\/\/github.com\/me\/p\/pull\/7/)
    assert.match(text, /\[branch\]fix-parser\n\[base\]main\n\[author\]ann/)
    assert.match(text, /\[body\]It fixes the parser\./)
    assert.match(
      text,
      /\[failedChecks\]‹failedChecks: loads when the recipe runs›/
    )
    assert.match(text, /\[diff\]‹diff: loads when the recipe runs›/)
    assert.match(text, /\[question\]‹your question›/)
    // Only the unresolved thread, with its place, hunk and comments.
    assert.match(
      text,
      /### src\/parse\.ts:12\n```diff\n-old\n\+new\n```\n- bob: Handle empty input/
    )
    assert.doesNotMatch(text, /Done one/)
    assert.match(
      text,
      /src\/parse\.ts \+2 −1\ntest\/parse\.test\.ts \+1 −0\n2 files, \+3 −1/
    )

    // Run: the logs and the diff load.
    ;({ values } = await recipes.recipeValues(dir, 7, all, {
      load: true,
      question: "Why?",
      pr: pr(),
    }))
    text = recipes.renderTemplate(all, values)
    assert.match(
      text,
      /### test \(CI\)\nhttps:\/\/x\/actions\/runs\/5\/job\/1\nThe end of the failed steps:\n```\nnpm test\n##\[error\]expected 3 to be 4\n```/
    )
    assert.match(
      text,
      /### e2e \(CI\)[\s\S]*The log could not be loaded: .*log expired/
    )
    assert.doesNotMatch(text, /vercel/)
    assert.match(text, /\[diff\]```diff\ndiff --git a\/a b\/a/)
    assert.doesNotMatch(text, /The diff is cut/)
    assert.match(text, /\[question\]Why\?/)
    const ran = (await calls()).map((args) => args.slice(0, 4).join(" "))
    assert.deepEqual(ran.sort(), [
      "pr diff 7 --color",
      "run view --job 1",
      "run view --job 99",
    ])
  }, patch)

  // A template without the on-demand variables does not load them.
  await withFakeGh(async (calls, dir) => {
    await recipes.recipeValues(dir, 7, "{{title}} {{threads}}", {
      load: true,
      pr: pr(),
    })
    assert.equal((await calls()).length, 0)
  })

  // Nothing to show.
  const empty = pr({ checkRuns: [], threads: [], files: [], body: " " })
  const { values } = await recipes.recipeValues(
    "/",
    7,
    "{{failedChecks}}{{threads}}{{diffStat}}{{body}}",
    {
      load: true,
      pr: empty,
    }
  )
  assert.equal(values.failedChecks, "(No failed checks.)")
  assert.equal(values.threads, "(No unresolved threads.)")
  assert.equal(values.diffStat, "(No changed files.)")
  assert.equal(values.body, "(No description.)")
})

void test("recipes: the diff is cut at a file, with a note", () => {
  const file = (name: string, size: number) =>
    `diff --git a/${name} b/${name}\n+${"x".repeat(size)}\n`
  const patch = file("a", 40) + file("b", 40) + file("c", 40)
  const cut = recipes.cappedDiff(patch, false, 140)
  assert.match(cut, /diff --git a\/a/)
  assert.match(cut, /diff --git a\/b/)
  assert.doesNotMatch(cut, /diff --git a\/c/)
  assert.match(cut, /The diff is cut here/)
  const whole = recipes.cappedDiff(patch, false, 10_000)
  assert.doesNotMatch(whole, /cut/)
  // gh cut it already.
  assert.match(
    recipes.cappedDiff("diff --git a/a b/a\n", true),
    /The diff is cut/
  )
})

void test("recipes: validation of a list", () => {
  const base = recipes.BUILTIN_RECIPES.map((recipe) => ({ ...recipe }))
  const custom = (change: Record<string, unknown> = {}) => ({
    id: "deploy",
    name: "Deploy preview",
    template: "Deploy {{branch}}",
    target: "new",
    wake: { ci: true },
    showIn: "row",
    when: "always",
    key: "p",
    ...change,
  })
  const saved = recipes.validateRecipes([...base, custom()])
  assert.equal(saved.length, 5)
  assert.deepEqual(saved[4], {
    id: "deploy",
    name: "Deploy preview",
    template: "Deploy {{branch}}",
    target: "new",
    wake: { ci: true, comments: false, state: false },
    showIn: "row",
    when: "always",
    hidden: false,
    key: "p",
  })
  const bad: Array<[unknown, RegExp]> = [
    [{ key: "r" }, /key r is a key of the GitHub tab/],
    [{ key: "R" }, /key R is a key of the GitHub tab/],
    [{ key: "pp" }, /one letter or digit/],
    [{ key: "!" }, /one letter or digit/],
    [{ name: "" }, /name is required/],
    [{ name: "x".repeat(61) }, /name is too long/],
    [{ name: "fix ci" }, /Two recipes are named/],
    [{ template: "{{nope}}" }, /unknown variable \{\{nope\}\}/],
    [{ template: " " }, /template is empty/],
    [{ target: "elsewhere" }, /target must be one of/],
    [{ showIn: "menu" }, /show in must be one of/],
    [{ id: "Bad Id" }, /bad id/],
    [{ id: "review", builtin: undefined }, /id review is used twice/],
    [{ builtin: "review" }, /not a built-in/],
    [{ thinking: "huge" }, /thinking must be one of/],
    [{ model: { provider: "x" } }, /bad model/],
  ]
  for (const [change, message] of bad)
    assert.throws(
      () =>
        recipes.validateRecipes([
          ...base,
          custom(change as Record<string, unknown>),
        ]),
      message,
      JSON.stringify(change)
    )
  // Two recipes with one key.
  assert.throws(
    () =>
      recipes.validateRecipes([
        ...base,
        custom(),
        custom({ id: "other", name: "Other" }),
      ]),
    /key p is used by “Deploy preview”/
  )
  // A built-in cannot be deleted, only hidden.
  assert.throws(
    () =>
      recipes.validateRecipes(base.filter((recipe) => recipe.id !== "review")),
    /“Review” cannot be deleted/
  )
  const hidden = recipes.validateRecipes(
    base.map((recipe) =>
      recipe.id === "review" ? { ...recipe, hidden: true } : recipe
    )
  )
  assert.equal(hidden.find((recipe) => recipe.id === "review")!.hidden, true)
})

void test("recipes: store per project, reset of the built-ins", async () => {
  const dir = await tempDir("smith-recipes-store-")
  const repo = join(dir, "repo")
  execFileSync("git", ["init", "-q", "-b", "main", repo])
  await mkdir(join(repo, "sub"))
  const other = join(dir, "other")
  execFileSync("git", ["init", "-q", "-b", "main", other])
  const store = new recipes.RecipeStore(join(dir, "data"))
  assert.deepEqual(
    (await store.list(repo)).map((recipe) => recipe.id),
    ["fix-ci", "address", "review", "ask"]
  )
  const changed = (await store.list(repo)).map((recipe) =>
    recipe.id === "fix-ci"
      ? { ...recipe, template: "Just fix {{pr}}", hidden: true }
      : recipe
  )
  // Reordered, with a custom recipe first.
  await store.save(join(repo, "sub"), [
    { id: "hi", name: "Hi", template: "Hi {{author}}" },
    ...changed.reverse(),
  ])
  // A new store reads the file: the same project from its subfolder.
  const again = new recipes.RecipeStore(join(dir, "data"))
  const list = await again.list(repo)
  assert.deepEqual(
    list.map((recipe) => recipe.id),
    ["hi", "ask", "review", "address", "fix-ci"]
  )
  assert.equal(list[4]!.template, "Just fix {{pr}}")
  assert.equal(list[4]!.hidden, true)
  // Another project keeps the defaults.
  assert.equal((await again.list(other)).length, 4)
  // A bad list is refused and changes nothing.
  await assert.rejects(
    again.save(repo, [{ id: "x", name: "X", template: "{{y}}" }]),
    /unknown variable/
  )
  assert.equal((await again.list(repo)).length, 5)
  // Reset: the built-ins as they ship, first; the custom recipe stays.
  const reset = await again.reset(repo)
  assert.deepEqual(
    reset.map((recipe) => recipe.id),
    ["fix-ci", "address", "review", "ask", "hi"]
  )
  assert.equal(reset[0]!.hidden, false)
  assert.match(reset[0]!.template, /\{\{failedChecks\}\}/)
  await assert.rejects(again.get(repo, "nope"), /No recipe nope/)
})

void test("recipes: built-ins keep the hand-off behaviour", () => {
  const byId = new Map(
    recipes.BUILTIN_RECIPES.map((recipe) => [recipe.id, recipe])
  )
  assert.deepEqual(byId.get("fix-ci")!.wake, {
    ci: true,
    comments: true,
    state: true,
  })
  assert.deepEqual(byId.get("address")!.wake, {
    ci: true,
    comments: true,
    state: true,
  })
  assert.deepEqual(byId.get("review")!.wake, {
    ci: false,
    comments: false,
    state: false,
  })
  for (const recipe of recipes.BUILTIN_RECIPES)
    assert.equal(recipe.target, "branch")
  const full = pr()
  const none = pr({ checkRuns: [], threads: [] })
  assert.equal(recipes.recipeApplies(byId.get("fix-ci")!, full), true)
  assert.equal(recipes.recipeApplies(byId.get("fix-ci")!, none), false)
  assert.equal(recipes.recipeApplies(byId.get("address")!, none), false)
  assert.equal(recipes.recipeApplies(byId.get("review")!, none), true)
  // Each built-in renders without an unknown variable.
  for (const recipe of recipes.BUILTIN_RECIPES)
    assert.deepEqual(recipes.templateVariables(recipe.template).unknown, [])
})

void test("recipes: the target of a run", () => {
  assert.equal(recipes.runTarget({ target: "branch" }, "new"), "branch")
  assert.equal(recipes.runTarget({ target: "new" }, undefined), "new")
  assert.equal(recipes.runTarget({ target: "ask" }, "new"), "new")
  assert.equal(recipes.runTarget({ target: "ask" }, "branch"), "branch")
  assert.throws(
    () => recipes.runTarget({ target: "ask" }, undefined),
    /Choose the agent/
  )
  assert.throws(
    () => recipes.runTarget({ target: "ask" }, "x"),
    /Choose the agent/
  )
})
