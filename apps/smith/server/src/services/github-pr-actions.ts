/**
 * Quick actions on a GitHub pull request, through `gh`: run failed checks
 * again, update the branch, ready or draft, assignees, reviewers and
 * labels, close or reopen, and check out the branch in the project.
 */
import { badRequest } from "../http.ts"
import { runCommand } from "../extensions/util.ts"
import { gh } from "./github.ts"
import { clearBranchPrCache, graphql, prChecks } from "./github-prs.ts"
import { branchName, mergeInfo } from "./github-pr-writes.ts"
import { repoRoot } from "./worktree.ts"

const MAX_PEOPLE = 20
const MAX_LABELS = 50

// ---------------------------------------------------------------------------
// Input checks

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const TEAM = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

function list(value: unknown, name: string, max: number) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw badRequest(`${name} must be a list`)
  if (value.length > max) throw badRequest(`Too many ${name}`)
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim())
      throw badRequest(`Each of ${name} must be a text`)
    return item.trim()
  })
}

/** Logins (and `@me`); teams (`org/team`) only for reviewers. */
export function people(
  value: unknown,
  name: string,
  options: { teams?: boolean } = {}
) {
  const result = list(value, name, MAX_PEOPLE)
  for (const login of result) {
    if (login === "@me") continue
    if (LOGIN.test(login)) continue
    if (options.teams && TEAM.test(login)) continue
    throw badRequest(`Not a GitHub login: ${login}`)
  }
  return result
}

/** Label names. `gh` splits its flag values at commas, so a comma cannot pass. */
export function labelNames(value: unknown, name: string) {
  const result = list(value, name, MAX_LABELS)
  for (const label of result) {
    if (label.length > 100) throw badRequest(`Label too long: ${label}`)
    if (label.includes(",")) throw badRequest(`A label with a comma: ${label}`)
  }
  return result
}

async function git(cwd: string, args: Array<string>, timeoutMs = 60_000) {
  const result = await runCommand(["git", ...args], { cwd, timeoutMs })
  if (result.code !== 0)
    throw badRequest(
      (result.stderr || result.stdout).trim() || `git ${args[0]} failed`
    )
  return result.stdout.trim()
}

// ---------------------------------------------------------------------------
// Checks

export type RerunResult = {
  /** Actions runs that run their failed jobs again. */
  rerun: Array<string>
  /** Failed checks of other providers: only a link. */
  links: Array<{ name: string; link: string }>
  errors: Array<string>
}

const FAILED_BUCKETS = new Set(["fail", "cancel"])

export async function rerunFailed(
  cwd: string,
  number: number
): Promise<RerunResult> {
  const checks = await prChecks(cwd, number)
  const failed = checks.filter((check) => FAILED_BUCKETS.has(check.bucket))
  if (failed.length === 0) throw badRequest("No failed checks")
  const runs = [
    ...new Set(failed.flatMap((check) => (check.runId ? [check.runId] : []))),
  ]
  const links = failed
    .filter((check) => !check.runId)
    .map((check) => ({ name: check.name, link: check.link }))
  const rerun: Array<string> = []
  const errors: Array<string> = []
  for (const runId of runs) {
    try {
      await gh(cwd, ["run", "rerun", runId, "--failed"])
      rerun.push(runId)
    } catch (error) {
      errors.push(
        `Run ${runId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  if (rerun.length === 0 && errors.length > 0)
    throw badRequest(errors.join("\n"))
  return { rerun, links, errors }
}

// ---------------------------------------------------------------------------
// Branch and state

export async function updateBranch(
  cwd: string,
  number: number,
  rebase: boolean
) {
  const args = ["pr", "update-branch", String(number)]
  if (rebase) {
    const info = await mergeInfo(cwd, number)
    if (!info.allowed.includes("rebase"))
      throw badRequest("This repository does not allow rebase")
    args.push("--rebase")
  }
  await gh(cwd, args)
  clearBranchPrCache()
}

export async function setDraft(cwd: string, number: number, draft: boolean) {
  const args = ["pr", "ready", String(number)]
  if (draft) args.push("--undo")
  await gh(cwd, args)
  clearBranchPrCache()
}

export async function setOpen(cwd: string, number: number, open: boolean) {
  await gh(cwd, ["pr", open ? "reopen" : "close", String(number)])
  clearBranchPrCache()
}

export type PrEdit = {
  addAssignees?: unknown
  removeAssignees?: unknown
  addReviewers?: unknown
  removeReviewers?: unknown
  addLabels?: unknown
  removeLabels?: unknown
}

/** The `gh pr edit` flags of an edit; throws on bad input or no change. */
export function editArgs(number: number, edit: PrEdit) {
  const parts: Array<[string, Array<string>]> = [
    ["--add-assignee", people(edit.addAssignees, "assignees")],
    ["--remove-assignee", people(edit.removeAssignees, "assignees")],
    ["--add-reviewer", people(edit.addReviewers, "reviewers", { teams: true })],
    [
      "--remove-reviewer",
      people(edit.removeReviewers, "reviewers", { teams: true }),
    ],
    ["--add-label", labelNames(edit.addLabels, "labels")],
    ["--remove-label", labelNames(edit.removeLabels, "labels")],
  ]
  const args = ["pr", "edit", String(number)]
  for (const [flag, values] of parts)
    if (values.length > 0) args.push(flag, values.join(","))
  if (args.length === 3) throw badRequest("Nothing to change")
  return args
}

export async function editPr(cwd: string, number: number, edit: PrEdit) {
  await gh(cwd, editArgs(number, edit))
  clearBranchPrCache()
}

// ---------------------------------------------------------------------------
// People for the pickers

export type PrPeople = {
  viewer: string
  /** Users who can be assigned, the most likely first. */
  assignable: Array<{ login: string; name: string }>
  /** Reviewers that GitHub suggests for this pull request. */
  suggested: Array<{ login: string; name: string }>
}

export async function prPeople(cwd: string, number: number): Promise<PrPeople> {
  type User = { login?: string; name?: string | null }
  const data = await graphql<{
    viewer?: { login?: string }
    repository?: {
      assignableUsers?: { nodes?: Array<User> }
      pullRequest?: {
        suggestedReviewers?: Array<{ reviewer?: User }>
      } | null
    }
  }>(
    cwd,
    `
      query ($owner: String!, $repo: String!, $number: Int!) {
        viewer {
          login
        }
        repository(owner: $owner, name: $repo) {
          assignableUsers(first: 100) {
            nodes {
              login
              name
            }
          }
          pullRequest(number: $number) {
            suggestedReviewers {
              reviewer {
                login
                name
              }
            }
          }
        }
      }
    `,
    { number }
  )
  const user = (value: User | undefined) => ({
    login: value?.login ?? "",
    name: value?.name ?? "",
  })
  return {
    viewer: data.viewer?.login ?? "",
    assignable: (data.repository?.assignableUsers?.nodes ?? [])
      .map(user)
      .filter((item) => item.login),
    suggested: (data.repository?.pullRequest?.suggestedReviewers ?? [])
      .map((item) => user(item.reviewer))
      .filter((item) => item.login),
  }
}

// ---------------------------------------------------------------------------
// Check out in the project

export type CheckoutInfo = {
  root: string
  /** The branch the main checkout is on. */
  current: string
  /** The local branch for the pull request. */
  branch: string
  /** True when the main checkout has uncommitted changes to tracked files. */
  dirty: boolean
  /** A worktree that has the branch checked out (not the main checkout). */
  worktree: string
}

async function worktreeOf(root: string, branch: string) {
  const output = await git(root, ["worktree", "list", "--porcelain"])
  let path = ""
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9)
    else if (line === `branch refs/heads/${branch}`) return path
  }
  return ""
}

export async function checkoutInfo(
  cwd: string,
  number: number
): Promise<CheckoutInfo> {
  const info = await mergeInfo(cwd, number)
  if (!info.headRefName) throw badRequest(`No pull request #${number}`)
  const root = (await repoRoot(cwd)) ?? cwd
  const branch =
    info.isCrossRepository || info.headRefName === info.defaultBranch
      ? `pr-${number}-${info.headRefName}`.replace(/[^A-Za-z0-9._/-]+/g, "-")
      : info.headRefName
  const [current, status, worktree] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain", "--untracked-files=no"]),
    worktreeOf(root, branch),
  ])
  return {
    root,
    current,
    branch: branchName(branch),
    dirty: status !== "",
    worktree: worktree === root ? "" : worktree,
  }
}

/** Switch the main checkout to the branch of the pull request. */
export async function checkoutPr(cwd: string, number: number) {
  const info = await checkoutInfo(cwd, number)
  if (info.dirty)
    throw badRequest(
      "The project has uncommitted changes. Commit or stash them, or use a worktree."
    )
  if (info.worktree)
    throw badRequest(`${info.branch} is checked out in ${info.worktree}`)
  const result = await runCommand(
    ["gh", "pr", "checkout", String(number), "--branch", info.branch],
    {
      cwd: info.root,
      timeoutMs: 120_000,
      env: { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    }
  )
  if (result.code !== 0)
    throw badRequest(
      (result.stderr || result.stdout).trim() || "gh pr checkout failed"
    )
  return { root: info.root, branch: info.branch }
}
