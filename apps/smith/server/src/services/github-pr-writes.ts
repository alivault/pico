/**
 * Writes to GitHub pull requests, through `gh`: create, review, reply,
 * resolve, comment, merge, and the clean-up after a merge. Also the local
 * git work for them: the text for a new pull request, and a worktree on
 * the branch of a pull request for an agent.
 */
import { badRequest } from "../http.ts"
import { runCommand } from "../extensions/util.ts"
import { gh, ghJson } from "./github.ts"
import { branchPrs, clearBranchPrCache, graphql } from "./github-prs.ts"
import { createWorktree, discardWorktree, repoRoot } from "./worktree.ts"

const TEXT_LIMIT = 65_000
const MAX_REVIEW_COMMENTS = 100

// ---------------------------------------------------------------------------
// Small parts

async function git(cwd: string, args: Array<string>, timeoutMs = 60_000) {
  const result = await runCommand(["git", ...args], { cwd, timeoutMs })
  if (result.code !== 0) {
    throw badRequest(
      (result.stderr || result.stdout).trim() || `git ${args[0]} failed`
    )
  }
  return result.stdout.trim()
}

async function gitOr(cwd: string, args: Array<string>, fallback = "") {
  try {
    return await git(cwd, args)
  } catch {
    return fallback
  }
}

function text(
  value: unknown,
  name: string,
  options: { required?: boolean } = {}
) {
  const result = typeof value === "string" ? value : ""
  if (options.required && !result.trim())
    throw badRequest(`${name} is required`)
  if (result.length > TEXT_LIMIT) throw badRequest(`${name} is too long`)
  return result
}

/** A branch name that git accepts and that cannot be read as an option. */
export function branchName(value: unknown, name = "branch") {
  const branch = typeof value === "string" ? value.trim() : ""
  if (
    !branch ||
    branch.startsWith("-") ||
    branch.length > 250 ||
    /[\s~^:?*[\\]|\.\.|@\{|\/\/|\.lock$|^\/|\/$|\.$/.test(branch) ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(branch)
  ) {
    throw badRequest(`A valid ${name} is required`)
  }
  return branch
}

function threadId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : ""
  if (!/^[A-Za-z0-9_=-]{4,200}$/.test(id)) {
    throw badRequest("A valid thread ID is required")
  }
  return id
}

// ---------------------------------------------------------------------------
// Create

export type CreatePrInfo = {
  branch: string
  defaultBranch: string
  /** The remote branches, for the base menu. */
  bases: Array<string>
  upstream: string
  /** Local commits that are not pushed. */
  ahead: number
  /** The open pull request of the branch, if any. */
  openPr: number | null
  /** Why a pull request cannot be made now; empty when it can. */
  reason: string
}

/** What the Create PR dialog needs to know about the branch of `cwd`. */
export async function createPrInfo(cwd: string): Promise<CreatePrInfo> {
  const [branch, data] = await Promise.all([
    gitOr(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    graphql<{ repository?: { defaultBranchRef?: { name?: string } | null } }>(
      cwd,
      "query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { defaultBranchRef { name } } }",
      {}
    ),
  ])
  const defaultBranch = data.repository?.defaultBranchRef?.name ?? ""
  const upstream = branch
    ? await gitOr(cwd, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ])
    : ""
  const ahead = upstream
    ? Number(
        await gitOr(cwd, ["rev-list", "--count", "@{upstream}..HEAD"], "0")
      )
    : 0
  const remote = upstream.split("/")[0] || "origin"
  const bases = (
    await gitOr(cwd, [
      "for-each-ref",
      "--format=%(refname:short)",
      `refs/remotes/${remote}`,
    ])
  )
    .split("\n")
    .map((ref) => ref.slice(remote.length + 1))
    .filter((ref) => ref && ref !== "HEAD" && ref !== branch)
    .slice(0, 300)
  if (defaultBranch && !bases.includes(defaultBranch))
    bases.unshift(defaultBranch)
  let openPr: number | null = null
  if (branch) {
    clearBranchPrCache()
    const pr = (await branchPrs(cwd, [branch]))[branch]
    if (pr?.state === "OPEN") openPr = pr.number
  }
  const reason = !branch
    ? "No branch is checked out."
    : branch === defaultBranch
      ? `${branch} is the default branch.`
      : !upstream
        ? "Push the branch first."
        : ahead > 0
          ? `Push the branch first: ${ahead} commit${ahead === 1 ? " is" : "s are"} not pushed.`
          : openPr
            ? `The branch already has pull request #${openPr}.`
            : ""
  return { branch, defaultBranch, bases, upstream, ahead, openPr, reason }
}

/** The commits and the diff of the branch against `base`, for the model. */
export async function prTextContext(cwd: string, base: string) {
  const baseRef = `origin/${branchName(base, "base branch")}`
  const log = await gitOr(cwd, [
    "log",
    "--no-merges",
    "--format=- %s%n%w(0,2,2)%b",
    `${baseRef}..HEAD`,
  ])
  const stat = await gitOr(cwd, ["diff", "--stat", `${baseRef}...HEAD`])
  const patch = await gitOr(cwd, ["diff", "--no-ext-diff", `${baseRef}...HEAD`])
  return {
    subjects: (
      await gitOr(cwd, [
        "log",
        "--no-merges",
        "--format=%s",
        `${baseRef}..HEAD`,
      ])
    )
      .split("\n")
      .filter(Boolean),
    context: `COMMITS:\n${log}\n\nDIFF STAT:\n${stat}\n\nDIFF:\n${patch}`.slice(
      0,
      24_000
    ),
  }
}

/** A title and body from the commits, when no model can write them. */
export function heuristicPrText(branch: string, subjects: Array<string>) {
  const title =
    subjects.length === 1
      ? subjects[0]!
      : branch
          .replace(/^.*\//, "")
          .replace(/[-_]+/g, " ")
          .replace(/^\w/, (letter) => letter.toUpperCase())
  const body =
    subjects.length > 1
      ? subjects
          .slice()
          .reverse()
          .map((subject) => `- ${subject}`)
          .join("\n")
      : ""
  return { title: title.slice(0, 120), body }
}

/** Read "title, empty line, body" from the answer of the model. */
export function parsePrText(answer: string) {
  const lines = answer
    .replace(/^```[a-z]*\n?|```$/g, "")
    .trim()
    .split("\n")
  const title = (lines.shift() ?? "")
    .replace(/^#+\s*/, "")
    .replace(/^title:\s*/i, "")
    .replace(/^[`"']+|[`"']+$/g, "")
    .trim()
    .slice(0, 120)
  const body = lines
    .join("\n")
    .replace(/^body:\s*/i, "")
    .trim()
  return { title, body }
}

export async function createPr(
  cwd: string,
  input: { base?: unknown; title?: unknown; body?: unknown; draft?: unknown }
) {
  const info = await createPrInfo(cwd)
  if (info.reason) throw badRequest(info.reason)
  const base = branchName(input.base, "base branch")
  const title = text(input.title, "title", { required: true }).trim()
  const body = text(input.body, "body")
  const args = [
    "pr",
    "create",
    "--base",
    base,
    "--head",
    info.branch,
    "--title",
    title,
    "--body-file",
    "-",
  ]
  if (input.draft === true) args.push("--draft")
  const output = await gh(cwd, args, { input: body, timeoutMs: 60_000 })
  const url = output.trim().split("\n").pop() ?? ""
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0)
  clearBranchPrCache()
  return { url, number, branch: info.branch }
}

// ---------------------------------------------------------------------------
// Reviews, threads, comments

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES"

export type ReviewCommentInput = {
  path: string
  line: number
  side: "LEFT" | "RIGHT"
  startLine?: number
  startSide?: "LEFT" | "RIGHT"
  body: string
}

function reviewComment(value: unknown, index: number) {
  const raw = (value ?? {}) as Record<string, unknown>
  const path = typeof raw.path === "string" ? raw.path.trim() : ""
  const line = Number(raw.line)
  const side =
    raw.side === "LEFT" ? "LEFT" : raw.side === "RIGHT" ? "RIGHT" : ""
  const body = text(raw.body, `comment ${index + 1}`, { required: true })
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw badRequest(`comment ${index + 1} needs a path`)
  }
  if (!Number.isInteger(line) || line <= 0 || !side) {
    throw badRequest(`comment ${index + 1} needs a line and a side`)
  }
  const comment: Record<string, unknown> = { path, line, side, body }
  const startLine = Number(raw.startLine)
  if (Number.isInteger(startLine) && startLine > 0 && startLine < line) {
    comment.start_line = startLine
    comment.start_side = raw.startSide === "LEFT" ? "LEFT" : side
  }
  return comment
}

/** Send a review with its line comments in one request. */
export async function submitReview(
  cwd: string,
  number: number,
  input: { event?: unknown; body?: unknown; comments?: unknown }
) {
  const event = input.event
  if (
    event !== "COMMENT" &&
    event !== "APPROVE" &&
    event !== "REQUEST_CHANGES"
  ) {
    throw badRequest("event must be COMMENT, APPROVE or REQUEST_CHANGES")
  }
  const body = text(input.body, "body")
  const comments = Array.isArray(input.comments) ? input.comments : []
  if (comments.length > MAX_REVIEW_COMMENTS) {
    throw badRequest(`At most ${MAX_REVIEW_COMMENTS} comments in one review`)
  }
  if (event !== "APPROVE" && !body.trim() && comments.length === 0) {
    throw badRequest("A review needs a text or a line comment")
  }
  const payload = {
    event,
    body,
    comments: comments.map(reviewComment),
  }
  const review = await ghJson<{
    id?: number
    state?: string
    html_url?: string
  }>(
    cwd,
    [
      "api",
      "--method",
      "POST",
      `repos/{owner}/{repo}/pulls/${number}/reviews`,
      "--input",
      "-",
    ],
    { input: JSON.stringify(payload) }
  )
  clearBranchPrCache()
  return {
    id: review.id ?? 0,
    state: review.state ?? "",
    url: review.html_url ?? "",
  }
}

export async function replyToThread(cwd: string, id: unknown, body: unknown) {
  const data = await graphql<{
    addPullRequestReviewThreadReply?: {
      comment?: { id?: string; url?: string }
    }
  }>(
    cwd,
    `
      mutation ($thread: ID!, $body: String!) {
        addPullRequestReviewThreadReply(
          input: { pullRequestReviewThreadId: $thread, body: $body }
        ) {
          comment {
            id
            url
          }
        }
      }
    `,
    { thread: threadId(id), body: text(body, "reply", { required: true }) },
    { owner: false }
  )
  return { id: data.addPullRequestReviewThreadReply?.comment?.id ?? "" }
}

export async function setThreadResolved(
  cwd: string,
  id: unknown,
  resolved: unknown
) {
  const name =
    resolved === false ? "unresolveReviewThread" : "resolveReviewThread"
  const data = await graphql<
    Record<string, { thread?: { isResolved?: boolean } } | undefined>
  >(
    cwd,
    `mutation($thread: ID!) { ${name}(input: { threadId: $thread }) { thread { isResolved } } }`,
    { thread: threadId(id) },
    { owner: false }
  )
  clearBranchPrCache()
  return { isResolved: Boolean(data[name]?.thread?.isResolved) }
}

export async function commentPr(cwd: string, number: number, body: unknown) {
  const output = await gh(
    cwd,
    ["pr", "comment", String(number), "--body-file", "-"],
    { input: text(body, "comment", { required: true }) }
  )
  return { url: output.trim().split("\n").pop() ?? "" }
}

// ---------------------------------------------------------------------------
// Merge

export type MergeMethod = "squash" | "merge" | "rebase"

export type MergeInfo = {
  allowed: Array<MergeMethod>
  defaultMethod: MergeMethod
  state: string
  isDraft: boolean
  mergeable: string
  mergeStateStatus: string
  /** True when GitHub lets the viewer merge past the rules. */
  canAdmin: boolean
  squashTitle: string
  squashBody: string
  title: string
  headRefName: string
  headRefOid: string
  isCrossRepository: boolean
  defaultBranch: string
}

const METHODS: Record<string, MergeMethod> = {
  SQUASH: "squash",
  MERGE: "merge",
  REBASE: "rebase",
}

export async function mergeInfo(
  cwd: string,
  number: number
): Promise<MergeInfo> {
  const data = await graphql<{
    repository?: {
      mergeCommitAllowed?: boolean
      squashMergeAllowed?: boolean
      rebaseMergeAllowed?: boolean
      viewerDefaultMergeMethod?: string
      defaultBranchRef?: { name?: string } | null
      pullRequest?: {
        state?: string
        isDraft?: boolean
        mergeable?: string
        mergeStateStatus?: string
        viewerCanMergeAsAdmin?: boolean
        title?: string
        headRefName?: string
        headRefOid?: string
        isCrossRepository?: boolean
        viewerMergeHeadlineText?: string
        viewerMergeBodyText?: string
      } | null
    }
  }>(
    cwd,
    `
      query ($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          mergeCommitAllowed
          squashMergeAllowed
          rebaseMergeAllowed
          viewerDefaultMergeMethod
          defaultBranchRef {
            name
          }
          pullRequest(number: $number) {
            state
            isDraft
            mergeable
            mergeStateStatus
            viewerCanMergeAsAdmin
            title
            headRefName
            headRefOid
            isCrossRepository
            viewerMergeHeadlineText(mergeType: SQUASH)
            viewerMergeBodyText(mergeType: SQUASH)
          }
        }
      }
    `,
    { number }
  )
  const repo = data.repository
  const pr = repo?.pullRequest
  if (!repo || !pr) throw badRequest(`No pull request #${number}`)
  const allowed: Array<MergeMethod> = []
  if (repo.squashMergeAllowed) allowed.push("squash")
  if (repo.mergeCommitAllowed) allowed.push("merge")
  if (repo.rebaseMergeAllowed) allowed.push("rebase")
  const preferred = METHODS[repo.viewerDefaultMergeMethod ?? ""]
  return {
    allowed,
    defaultMethod:
      preferred && allowed.includes(preferred)
        ? preferred
        : (allowed[0] ?? "merge"),
    state: pr.state ?? "",
    isDraft: Boolean(pr.isDraft),
    mergeable: pr.mergeable ?? "UNKNOWN",
    mergeStateStatus: pr.mergeStateStatus ?? "UNKNOWN",
    canAdmin: Boolean(pr.viewerCanMergeAsAdmin),
    squashTitle: pr.viewerMergeHeadlineText ?? "",
    squashBody: pr.viewerMergeBodyText ?? "",
    title: pr.title ?? "",
    headRefName: pr.headRefName ?? "",
    headRefOid: pr.headRefOid ?? "",
    isCrossRepository: Boolean(pr.isCrossRepository),
    defaultBranch: repo.defaultBranchRef?.name ?? "",
  }
}

/** The `gh pr merge` arguments; checked before anything runs. */
export function mergeArgs(
  number: number,
  input: {
    method?: unknown
    admin?: unknown
    subject?: unknown
    body?: unknown
  },
  allowed: Array<MergeMethod>
) {
  const method = input.method
  if (method !== "squash" && method !== "merge" && method !== "rebase") {
    throw badRequest("method must be squash, merge or rebase")
  }
  if (!allowed.includes(method)) {
    throw badRequest(`The repository does not allow ${method} merges`)
  }
  const args = ["pr", "merge", String(number), `--${method}`]
  if (method !== "rebase") {
    const subject = text(input.subject, "subject").trim()
    if (subject) args.push("--subject", subject)
    const body = text(input.body, "body")
    if (typeof input.body === "string") args.push("--body", body)
  }
  if (input.admin === true) args.push("--admin")
  return args
}

export async function mergePr(
  cwd: string,
  number: number,
  input: {
    method?: unknown
    admin?: unknown
    subject?: unknown
    body?: unknown
  }
) {
  const info = await mergeInfo(cwd, number)
  if (info.state !== "OPEN") throw badRequest(`#${number} is not open`)
  if (input.admin === true && !info.canAdmin) {
    throw badRequest("You cannot merge this pull request as an admin")
  }
  await gh(cwd, mergeArgs(number, input, info.allowed), { timeoutMs: 120_000 })
  clearBranchPrCache()
  const after = await mergeInfo(cwd, number).catch(() => undefined)
  return { state: after?.state ?? "", merged: after?.state === "MERGED" }
}

// ---------------------------------------------------------------------------
// Clean-up after a merge

export type BranchWorktree = {
  path: string
  /** The checkout of the repository itself; it is never removed. */
  main: boolean
  dirty: boolean
}

export type CleanupInfo = {
  /** The main checkout; the clean-up runs there, as a worktree can go. */
  root: string
  branch: string
  state: string
  isCrossRepository: boolean
  defaultBranch: string
  headRefOid: string
  remoteBranch: { exists: boolean; matchesPr: boolean }
  localBranch: {
    exists: boolean
    /** Commits on the local branch that are not in the pull request. */
    unpushed: number
    /** True when the count is not known (the PR head could not be read). */
    unknown: boolean
  }
  worktrees: Array<BranchWorktree>
}

async function worktreesOn(root: string, branch: string) {
  const output = await gitOr(root, ["worktree", "list", "--porcelain"])
  const result: Array<BranchWorktree> = []
  let first = true
  for (const block of output.split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const ref = /^branch (.+)$/m.exec(block)?.[1]
    if (path && ref === `refs/heads/${branch}`) {
      const dirty = (await gitOr(path, ["status", "--porcelain"], "?")) !== ""
      result.push({ path, main: first, dirty })
    }
    if (path) first = false
  }
  return result
}

export async function cleanupInfo(
  cwd: string,
  number: number
): Promise<CleanupInfo> {
  const info = await mergeInfo(cwd, number)
  const branch = info.headRefName
  const root = (await repoRoot(cwd)) ?? cwd
  // The PR head, so the local branch can be compared to it. It stays on
  // GitHub after a merge and after the branch is deleted.
  await gitOr(root, ["fetch", "--quiet", "origin", `pull/${number}/head`])
  const known =
    info.headRefOid !== "" &&
    (await gitOr(root, ["cat-file", "-t", info.headRefOid])) === "commit"
  const localExists =
    branch !== "" &&
    (await gitOr(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ])) !== ""
  const unpushed =
    localExists && known
      ? Number(
          await gitOr(
            root,
            [
              "rev-list",
              "--count",
              `refs/heads/${branch}`,
              `^${info.headRefOid}`,
            ],
            "0"
          )
        )
      : 0
  let remote = { exists: false, matchesPr: false }
  if (!info.isCrossRepository && branch) {
    try {
      const ref = await ghJson<{ object?: { sha?: string } }>(cwd, [
        "api",
        `repos/{owner}/{repo}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`,
      ])
      remote = { exists: true, matchesPr: ref.object?.sha === info.headRefOid }
    } catch {
      remote = { exists: false, matchesPr: false }
    }
  }
  return {
    root,
    branch,
    state: info.state,
    isCrossRepository: info.isCrossRepository,
    defaultBranch: info.defaultBranch,
    headRefOid: info.headRefOid,
    remoteBranch: remote,
    localBranch: {
      exists: localExists,
      unpushed,
      unknown: localExists && !known,
    },
    worktrees: localExists ? await worktreesOn(root, branch) : [],
  }
}

export type CleanupStep = {
  step: "agent" | "worktree" | "local-branch" | "remote-branch"
  target: string
  ok: boolean
  skipped?: boolean
  message: string
}

/** Why the local work on the branch must stay, or empty when it can go. */
export function localWorkReason(info: CleanupInfo) {
  if (info.localBranch.unknown) {
    return "the pull request head could not be read, so unpushed commits are not known"
  }
  if (info.localBranch.unpushed > 0) {
    const count = info.localBranch.unpushed
    return `${info.branch} has ${count} commit${count === 1 ? "" : "s"} that ${count === 1 ? "is" : "are"} not in the pull request`
  }
  return ""
}

/**
 * Remove the worktrees and the local branch (when `removeLocal`), and the
 * remote branch (when `deleteRemote`). Each step reports; a step that is
 * not safe is skipped with the reason. The agents on the branch are
 * archived before this, by the route.
 */
export async function cleanupBranch(
  info: CleanupInfo,
  options: { removeLocal: boolean; deleteRemote: boolean }
) {
  const steps: Array<CleanupStep> = []
  // Not `cwd`: it can be a worktree that this clean-up removes.
  const root = info.root
  const branch = info.branch
  if (info.state !== "MERGED") {
    throw badRequest("Clean up only after the pull request is merged")
  }
  const keepLocal = localWorkReason(info)
  if (options.removeLocal && info.localBranch.exists) {
    let inUse = false
    for (const worktree of await worktreesOn(root, branch)) {
      if (worktree.main) {
        inUse = true
        steps.push({
          step: "worktree",
          target: worktree.path,
          ok: false,
          skipped: true,
          message: `The main checkout is on ${branch}. Switch it to another branch first.`,
        })
        continue
      }
      const reason = worktree.dirty ? "it has uncommitted changes" : keepLocal
      if (reason) {
        inUse = true
        steps.push({
          step: "worktree",
          target: worktree.path,
          ok: false,
          skipped: true,
          message: `Kept the worktree: ${reason}.`,
        })
        continue
      }
      try {
        await git(root, ["worktree", "remove", worktree.path], 120_000)
        steps.push({
          step: "worktree",
          target: worktree.path,
          ok: true,
          message: "Removed the worktree.",
        })
      } catch (error) {
        inUse = true
        steps.push({
          step: "worktree",
          target: worktree.path,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (keepLocal || inUse) {
      steps.push({
        step: "local-branch",
        target: branch,
        ok: false,
        skipped: true,
        message: `Kept the local branch: ${keepLocal || "a worktree still uses it"}.`,
      })
    } else {
      try {
        await git(root, ["branch", "-D", branch])
        steps.push({
          step: "local-branch",
          target: branch,
          ok: true,
          message: "Deleted the local branch.",
        })
      } catch (error) {
        steps.push({
          step: "local-branch",
          target: branch,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  if (options.deleteRemote) {
    const reason = info.isCrossRepository
      ? "the branch is in a fork"
      : branch === info.defaultBranch
        ? "it is the default branch"
        : !info.remoteBranch.exists
          ? "it is gone already"
          : !info.remoteBranch.matchesPr
            ? "it has commits that are not in the pull request"
            : ""
    if (reason) {
      steps.push({
        step: "remote-branch",
        target: branch,
        ok: !info.remoteBranch.exists,
        skipped: true,
        message: `Did not delete the remote branch: ${reason}.`,
      })
    } else {
      try {
        await gh(root, [
          "api",
          "--method",
          "DELETE",
          `repos/{owner}/{repo}/git/refs/heads/${branch}`,
        ])
        steps.push({
          step: "remote-branch",
          target: branch,
          ok: true,
          message: "Deleted the remote branch.",
        })
      } catch (error) {
        steps.push({
          step: "remote-branch",
          target: branch,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  clearBranchPrCache()
  return steps
}

// ---------------------------------------------------------------------------
// A worktree on the branch of a pull request, for a new agent

/**
 * Make a worktree on the head branch of a pull request: fetch the head
 * (also from a fork), make the worktree, and let `gh pr checkout` set up
 * the branch, so a push goes to the right place.
 */
export async function prWorktree(
  project: string,
  number: number,
  options: { dataDir: string; copy?: readonly string[] }
) {
  const info = await mergeInfo(project, number)
  if (!info.headRefName) throw badRequest(`No pull request #${number}`)
  const root = (await repoRoot(project)) ?? project
  try {
    await git(
      root,
      ["fetch", "--quiet", "origin", `pull/${number}/head`],
      120_000
    )
  } catch (error) {
    // GitHub makes pull/<n>/head a moment after the pull request; a branch
    // of this repository is there at once.
    if (info.isCrossRepository) throw error
    await git(root, ["fetch", "--quiet", "origin", info.headRefName], 120_000)
  }
  const sha = await git(root, ["rev-parse", "FETCH_HEAD"])
  const local =
    info.isCrossRepository || info.headRefName === info.defaultBranch
      ? `pr-${number}-${info.headRefName}`.replace(/[^A-Za-z0-9._/-]+/g, "-")
      : info.headRefName
  const created = await createWorktree(project, {
    dataDir: options.dataDir,
    ...(options.copy ? { copy: options.copy } : {}),
    name: `pr-${number}`,
    branch: branchName(local),
    base: sha,
  })
  const checkout = await runCommand(
    ["gh", "pr", "checkout", String(number), "--branch", local],
    {
      cwd: created.path,
      timeoutMs: 120_000,
      env: { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    }
  )
  const note =
    checkout.code === 0
      ? ""
      : `gh pr checkout failed: ${(checkout.stderr || checkout.stdout).trim()}`
  return { ...created, note, title: info.title }
}

export { discardWorktree }
