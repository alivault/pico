/**
 * Recipes: prompt templates that hand a pull request to an agent. Each
 * project has its own list, stored by the server in `<data>/pr-recipes.json`
 * (keyed by the main checkout), so all browsers and machines see the same.
 *
 * A template has variables such as `{{title}}`. The expensive ones
 * (`{{failedChecks}}`, `{{diff}}`) load only when the template uses them;
 * a preview shows them as placeholders until it is asked to load them.
 *
 * The built-ins are the hand-off buttons of earlier versions: Fix CI,
 * Address comments, Review, Ask. They can be changed or hidden, not
 * deleted, and a reset restores them.
 */
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { badRequest } from "../http.ts"
import { run } from "./github.ts"
import { logTail, prDiff, viewPr, type GhPr } from "./github-prs.ts"
import { repoRoot } from "./worktree.ts"

// ---------------------------------------------------------------------------
// Variables

export const RECIPE_VARIABLES = [
  { name: "pr", description: "#number" },
  { name: "number", description: "The number, for gh commands" },
  { name: "title", description: "Title" },
  { name: "url", description: "Link" },
  { name: "branch", description: "Head branch" },
  { name: "base", description: "Base branch" },
  { name: "author", description: "Author login" },
  { name: "body", description: "Description" },
  {
    name: "failedChecks",
    description: "Failed checks with log tails (loads on run)",
    onDemand: true,
  },
  {
    name: "threads",
    description: "Unresolved threads: path:line, hunk, comments",
  },
  { name: "diffStat", description: "Changed files with + and − counts" },
  {
    name: "diff",
    description: "The diff, cut when long (loads on run)",
    onDemand: true,
  },
  { name: "question", description: "A question that you type when it runs" },
] as const

export type RecipeVariable = (typeof RECIPE_VARIABLES)[number]["name"]

const KNOWN = new Set<string>(RECIPE_VARIABLES.map((item) => item.name))
const ON_DEMAND = new Set<string>(
  RECIPE_VARIABLES.filter((item) => "onDemand" in item).map((item) => item.name)
)
const TOKEN = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g

/** The diff in a prompt stops at this many characters. */
export const DIFF_CAP = 60_000
const MAX_LOGS = 5
const LOG_LINES = 60
const HUNK_LINES = 6

/** The variables of a template: the known ones it uses, and unknown ones. */
export function templateVariables(template: string) {
  const used = new Set<string>()
  const unknown = new Set<string>()
  for (const match of template.matchAll(TOKEN)) {
    const name = match[1]!
    if (KNOWN.has(name)) used.add(name)
    else unknown.add(name)
  }
  return { used, unknown: [...unknown] }
}

/** Fill the variables in; a missing value stays as an empty string. */
export function renderTemplate(
  template: string,
  values: Partial<Record<string, string>>
) {
  const { unknown } = templateVariables(template)
  if (unknown.length > 0)
    throw badRequest(
      `Unknown variable${unknown.length === 1 ? "" : "s"}: ${unknown.map((name) => `{{${name}}}`).join(", ")}`
    )
  return template.replace(TOKEN, (_, name: string) => values[name] ?? "")
}

// ---------------------------------------------------------------------------
// Values of a pull request

function hunkTail(hunk: string) {
  return hunk
    .split("\n")
    .filter((line) => !line.startsWith("@@"))
    .slice(-HUNK_LINES)
    .join("\n")
}

export function threadsText(pr: Pick<GhPr, "threads">) {
  const threads = pr.threads.filter((thread) => !thread.isResolved)
  if (threads.length === 0) return "(No unresolved threads.)"
  return threads
    .map((thread) => {
      const place =
        thread.line === null ? thread.path : `${thread.path}:${thread.line}`
      const hunk = thread.diffHunk
        ? `\`\`\`diff\n${hunkTail(thread.diffHunk)}\n\`\`\``
        : ""
      const comments = thread.comments
        .map((comment) => `- ${comment.author}: ${comment.body}`)
        .join("\n")
      return [
        `### ${place}${thread.isOutdated ? " (outdated)" : ""}`,
        hunk,
        comments,
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n\n")
}

export function diffStatText(pr: Pick<GhPr, "files">) {
  if (pr.files.length === 0) return "(No changed files.)"
  const added = pr.files.reduce((sum, file) => sum + file.additions, 0)
  const removed = pr.files.reduce((sum, file) => sum + file.deletions, 0)
  return [
    ...pr.files.map(
      (file) => `${file.path} +${file.additions} −${file.deletions}`
    ),
    `${pr.files.length} file${pr.files.length === 1 ? "" : "s"}, +${added} −${removed}`,
  ].join("\n")
}

/** A diff for a prompt: cut at a file when it is too long, with a note. */
export function cappedDiff(patch: string, truncated: boolean, cap = DIFF_CAP) {
  let text = patch
  let cut = truncated
  if (text.length > cap) {
    const head = text.slice(0, cap)
    const lastFile = head.lastIndexOf("\ndiff --git ")
    text = lastFile > 0 ? head.slice(0, lastFile + 1) : head
    cut = true
  }
  const fence = `\`\`\`diff\n${text.trimEnd()}\n\`\`\``
  return cut
    ? `${fence}\n(The diff is cut here, at about ${cap.toLocaleString("en-US")} characters. Read all of it with \`gh pr diff\`.)`
    : fence
}

async function jobLogTail(cwd: string, jobId: string) {
  const output = await run(
    cwd,
    ["run", "view", "--job", jobId, "--log-failed"],
    { timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 }
  )
  return logTail(output, LOG_LINES).log
}

export async function failedChecksText(
  cwd: string,
  pr: Pick<GhPr, "checkRuns">
) {
  const failed = pr.checkRuns.filter(
    (check) => check.bucket === "fail" || check.bucket === "cancel"
  )
  if (failed.length === 0) return "(No failed checks.)"
  const parts = await Promise.all(
    failed.map(async (check, index) => {
      const title = `### ${check.name}${check.workflow ? ` (${check.workflow})` : ""}`
      let body: string
      if (!check.jobId || index >= MAX_LOGS) {
        body = "(No log here. Open the link for the details.)"
      } else {
        try {
          const log = await jobLogTail(cwd, check.jobId)
          body = log
            ? `The end of the failed steps:\n\`\`\`\n${log}\n\`\`\``
            : "(The log is empty.)"
        } catch (error) {
          body = `(The log could not be loaded: ${error instanceof Error ? error.message : String(error)})`
        }
      }
      return [title, check.link, body].filter(Boolean).join("\n")
    })
  )
  return parts.join("\n\n")
}

/** A value that the preview does not load. */
export function placeholder(name: string) {
  return `‹${name}: loads when the recipe runs›`
}

/** The values that a template uses, for one pull request. */
export async function recipeValues(
  cwd: string,
  number: number,
  template: string,
  options: {
    /** Load the on-demand values; false shows placeholders. */
    load: boolean
    question?: string
    /** For tests and for a caller that has the PR already. */
    pr?: GhPr
  }
) {
  const { used } = templateVariables(template)
  const pr = options.pr ?? (await viewPr(cwd, number))
  const values: Record<string, string> = {
    pr: `#${pr.number}`,
    number: String(pr.number),
    title: pr.title,
    url: pr.url,
    branch: pr.headRefName,
    base: pr.baseRefName,
    author: pr.author,
    body: pr.body.trim() || "(No description.)",
    question: options.question?.trim() || "‹your question›",
  }
  if (used.has("threads")) values.threads = threadsText(pr)
  if (used.has("diffStat")) values.diffStat = diffStatText(pr)
  for (const name of ON_DEMAND) {
    if (!used.has(name)) continue
    if (!options.load) {
      values[name] = placeholder(name)
      continue
    }
    if (name === "failedChecks")
      values.failedChecks = await failedChecksText(cwd, pr)
    if (name === "diff") {
      const diff = await prDiff(cwd, number)
      values.diff = cappedDiff(diff.patch, diff.truncated)
    }
  }
  return { pr, values }
}

// ---------------------------------------------------------------------------
// Recipes

export type RecipeTarget = "branch" | "new" | "ask"
export type RecipeShowIn = "detail" | "row" | "both"
/** When a recipe shows for a pull request. */
export type RecipeWhen = "always" | "failed-checks" | "threads"
export type BuiltinRecipe = "fix-ci" | "address" | "review" | "ask"

export type Recipe = {
  id: string
  name: string
  template: string
  target: RecipeTarget
  /** Wake events of a new agent that the recipe starts. */
  wake: { ci: boolean; comments: boolean; state: boolean }
  /** A single key in the GitHub tab. */
  key?: string
  /** For a new agent; an agent on the branch keeps its model. */
  model?: { provider: string; modelId: string }
  thinking?: string
  showIn: RecipeShowIn
  when: RecipeWhen
  hidden: boolean
  builtin?: BuiltinRecipe
}

const HEADER =
  "GitHub pull request {{pr}}: {{title}}\n{{url}}\nBranch: {{branch}} → {{base}}"

const WAKE_ALL = { ci: true, comments: true, state: true }
const WAKE_NONE = { ci: false, comments: false, state: false }

export const BUILTIN_RECIPES: Array<Recipe> = [
  {
    id: "fix-ci",
    builtin: "fix-ci",
    name: "Fix CI",
    template: `Fix the failing CI of ${HEADER}

Failed checks:

{{failedChecks}}

Find the cause, fix it, and run the same checks here if you can. Then commit and push to the branch, and tell me what you changed.`,
    target: "branch",
    wake: WAKE_ALL,
    showIn: "both",
    when: "failed-checks",
    hidden: false,
  },
  {
    id: "address",
    builtin: "address",
    name: "Address comments",
    template: `Address the unresolved review comments of ${HEADER}

Unresolved threads:

{{threads}}

For each thread, change the code, or tell me why not. Commit and push to the branch. Do not resolve the threads or reply on GitHub; tell me what you did for each thread.`,
    target: "branch",
    wake: WAKE_ALL,
    showIn: "both",
    when: "threads",
    hidden: false,
  },
  {
    id: "review",
    builtin: "review",
    name: "Review",
    template: `Review ${HEADER}

Read the description with \`gh pr view {{number}}\` and the diff with \`gh pr diff {{number}}\`.
Write your findings, the most important first: bugs, risks, missing tests, then smaller points.
Then propose line comments, each as \`path:line\` and the comment text.
Do not post anything to GitHub and do not change the code.`,
    target: "branch",
    wake: WAKE_NONE,
    showIn: "both",
    when: "always",
    hidden: false,
  },
  {
    id: "ask",
    builtin: "ask",
    name: "Ask…",
    template: `About ${HEADER}
(Read it with \`gh pr view {{number}}\` and \`gh pr diff {{number}}\`.)

{{question}}`,
    target: "branch",
    wake: WAKE_NONE,
    showIn: "detail",
    when: "always",
    hidden: false,
  },
]

/** Keys of the GitHub tab (`right-sidebar-prs-keys.tsx`); a recipe cannot use them. */
export const RESERVED_KEYS = [
  "j",
  "k",
  "/",
  "r",
  "o",
  "c",
  "m",
  "a",
  "R",
  "u",
  "d",
  "x",
  "l",
  "v",
  "1",
  "2",
  "3",
  "?",
]

const MAX_RECIPES = 40
const MAX_NAME = 60
const MAX_TEMPLATE = 20_000
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/

function enumOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
  fallback?: T
): T {
  if (value === undefined && fallback !== undefined) return fallback
  if (
    typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
  )
    return value as T
  throw badRequest(`${name} must be one of: ${allowed.join(", ")}`)
}

/** Check and normalize a list of recipes; throws a message for the editor. */
export function validateRecipes(input: unknown): Array<Recipe> {
  if (!Array.isArray(input)) throw badRequest("recipes must be a list")
  if (input.length > MAX_RECIPES) throw badRequest("Too many recipes")
  const ids = new Set<string>()
  const names = new Set<string>()
  const keys = new Map<string, string>()
  const result = input.map((raw: unknown, index): Recipe => {
    if (!raw || typeof raw !== "object")
      throw badRequest(`Recipe ${index + 1} is not an object`)
    const item = raw as Record<string, unknown>
    const name = typeof item.name === "string" ? item.name.trim() : ""
    const label = name || `Recipe ${index + 1}`
    if (!name) throw badRequest(`${label}: the name is required`)
    if (name.length > MAX_NAME)
      throw badRequest(`${label}: the name is too long`)
    if (names.has(name.toLowerCase()))
      throw badRequest(`Two recipes are named “${name}”`)
    names.add(name.toLowerCase())
    const id = typeof item.id === "string" ? item.id : ""
    if (!ID.test(id)) throw badRequest(`${label}: bad id`)
    if (ids.has(id)) throw badRequest(`${label}: the id ${id} is used twice`)
    ids.add(id)
    const template = typeof item.template === "string" ? item.template : ""
    if (!template.trim()) throw badRequest(`${label}: the template is empty`)
    if (template.length > MAX_TEMPLATE)
      throw badRequest(`${label}: the template is too long`)
    const { unknown } = templateVariables(template)
    if (unknown.length > 0)
      throw badRequest(
        `${label}: unknown variable${unknown.length === 1 ? "" : "s"} ${unknown.map((value) => `{{${value}}}`).join(", ")}`
      )
    const rawWake = (
      item.wake && typeof item.wake === "object" ? item.wake : {}
    ) as Record<string, unknown>
    const recipe: Recipe = {
      id,
      name,
      template,
      target: enumOf(
        item.target,
        ["branch", "new", "ask"],
        `${label}: target`,
        "branch"
      ),
      wake: {
        ci: rawWake.ci === true,
        comments: rawWake.comments === true,
        state: rawWake.state === true,
      },
      showIn: enumOf(
        item.showIn,
        ["detail", "row", "both"],
        `${label}: show in`,
        "both"
      ),
      when: enumOf(
        item.when,
        ["always", "failed-checks", "threads"],
        `${label}: when`,
        "always"
      ),
      hidden: item.hidden === true,
    }
    const builtin = item.builtin
    if (builtin !== undefined) {
      const known = BUILTIN_RECIPES.find((entry) => entry.builtin === builtin)
      if (!known || known.id !== id)
        throw badRequest(`${label}: not a built-in recipe`)
      recipe.builtin = known.builtin
    }
    if (item.key !== undefined && item.key !== "") {
      const key = item.key
      if (typeof key !== "string" || !/^[A-Za-z0-9]$/.test(key))
        throw badRequest(`${label}: the key must be one letter or digit`)
      if (RESERVED_KEYS.includes(key))
        throw badRequest(`${label}: the key ${key} is a key of the GitHub tab`)
      const other = keys.get(key)
      if (other)
        throw badRequest(`${label}: the key ${key} is used by “${other}”`)
      keys.set(key, name)
      recipe.key = key
    }
    if (item.model !== undefined && item.model !== null) {
      const model = item.model as Record<string, unknown>
      if (
        typeof model.provider !== "string" ||
        !model.provider ||
        typeof model.modelId !== "string" ||
        !model.modelId
      )
        throw badRequest(`${label}: bad model`)
      recipe.model = { provider: model.provider, modelId: model.modelId }
    }
    if (item.thinking !== undefined && item.thinking !== "") {
      recipe.thinking = enumOf(item.thinking, THINKING, `${label}: thinking`)
    }
    return recipe
  })
  // A built-in cannot be deleted: one that is missing comes back hidden.
  for (const builtin of BUILTIN_RECIPES)
    if (!result.some((recipe) => recipe.builtin === builtin.builtin))
      throw badRequest(
        `The built-in recipe “${builtin.name}” cannot be deleted; hide it`
      )
  return result
}

/** The built-ins as they ship, with the custom recipes after them. */
export function resetBuiltins(recipes: Array<Recipe>) {
  return [
    ...BUILTIN_RECIPES.map((recipe) => structuredClone(recipe)),
    ...recipes.filter((recipe) => !recipe.builtin),
  ]
}

type Store = { version: 1; projects: Record<string, Array<Recipe>> }

export class RecipeStore {
  readonly #path: string
  #store: Store | undefined
  #queue: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string) {
    this.#path = join(dataDir, "pr-recipes.json")
  }

  /** The key of a project: its main checkout, after symlinks. */
  async projectKey(cwd: string) {
    const root = (await repoRoot(cwd).catch(() => undefined)) ?? cwd
    return await realpath(root).catch(() => root)
  }

  async #load() {
    if (this.#store) return this.#store
    try {
      const raw = JSON.parse(await readFile(this.#path, "utf8")) as Store
      this.#store =
        raw?.version === 1 && raw.projects ? raw : { version: 1, projects: {} }
    } catch {
      this.#store = { version: 1, projects: {} }
    }
    return this.#store
  }

  async #save(store: Store) {
    await mkdir(dirname(this.#path), { recursive: true })
    const temp = `${this.#path}.tmp`
    await writeFile(temp, JSON.stringify(store, null, 1))
    await rename(temp, this.#path)
  }

  /** One write at a time. */
  #serial<T>(work: () => Promise<T>) {
    const next = this.#queue.then(work, work)
    this.#queue = next.catch(() => undefined)
    return next
  }

  async list(cwd: string): Promise<Array<Recipe>> {
    const store = await this.#load()
    const stored = store.projects[await this.projectKey(cwd)]
    if (!stored) return BUILTIN_RECIPES.map((recipe) => structuredClone(recipe))
    // A newer version can ship a new built-in: add it at the end.
    const missing = BUILTIN_RECIPES.filter(
      (builtin) => !stored.some((recipe) => recipe.builtin === builtin.builtin)
    )
    return [...stored, ...missing.map((recipe) => structuredClone(recipe))]
  }

  async get(cwd: string, id: string) {
    const recipe = (await this.list(cwd)).find((item) => item.id === id)
    if (!recipe) throw badRequest(`No recipe ${id}`)
    return recipe
  }

  async save(cwd: string, input: unknown) {
    const recipes = validateRecipes(input)
    return this.#serial(async () => {
      const store = await this.#load()
      store.projects[await this.projectKey(cwd)] = recipes
      await this.#save(store)
      return recipes
    })
  }

  reset(cwd: string) {
    return this.#serial(async () => {
      const store = await this.#load()
      const key = await this.projectKey(cwd)
      const recipes = resetBuiltins(await this.list(cwd))
      store.projects[key] = recipes
      await this.#save(store)
      return recipes
    })
  }
}

/** Whether a recipe shows for a pull request (its `when`). */
export function recipeApplies(
  recipe: Pick<Recipe, "when">,
  pr: Pick<GhPr, "checkRuns" | "threads">
) {
  if (recipe.when === "failed-checks")
    return pr.checkRuns.some(
      (check) => check.bucket === "fail" || check.bucket === "cancel"
    )
  if (recipe.when === "threads")
    return pr.threads.some((thread) => !thread.isResolved)
  return true
}

/**
 * Where a run goes: the recipe's target, or the choice of the user for a
 * recipe that asks each time.
 */
export function runTarget(
  recipe: Pick<Recipe, "target">,
  chosen: unknown
): "branch" | "new" {
  if (recipe.target !== "ask") return recipe.target
  if (chosen === "branch" || chosen === "new") return chosen
  throw badRequest("Choose the agent: target must be branch or new")
}
