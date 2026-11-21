/**
 * GitHub pull requests of a project, through `gh` (read only). The runner,
 * the login and the error texts are those of the issues in `github.ts`.
 */
import { badRequest } from "../http.ts"
import {
  GhError,
  gh,
  ghJson,
  ghRequestError,
  parseJson,
  run,
  type GhLabel,
} from "./github.ts"

const MAX_LIST_LIMIT = 100
const DIFF_LIMIT = 5 * 1024 * 1024
const LOG_OUTPUT_LIMIT = 64 * 1024 * 1024
const LOG_TAIL_LINES = 200
const LOG_TIMEOUT_MS = 60_000
const BRANCH_CACHE_MS = 30_000
const MAX_BRANCHES = 30

// ---------------------------------------------------------------------------
// Types

export type GhCheckSummary = {
  state: "success" | "failure" | "pending" | "none"
  passed: number
  failed: number
  pending: number
  skipped: number
}

export type GhPrState = "OPEN" | "CLOSED" | "MERGED"

export type GhPrSummary = {
  number: number
  title: string
  state: GhPrState
  isDraft: boolean
  author: string
  headRefName: string
  baseRefName: string
  updatedAt: string
  url: string
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty. */
  reviewDecision: string
  /** MERGEABLE, CONFLICTING, or UNKNOWN. */
  mergeable: string
  checks: GhCheckSummary
  commentCount: number
  labels: Array<GhLabel>
}

export type GhPrCheck = {
  name: string
  /** pass, fail, pending, skipping, or cancel. */
  bucket: string
  state: string
  link: string
  workflow: string
  description: string
  startedAt: string
  completedAt: string
  /** For a GitHub Actions job: its run and job, for the log. */
  runId?: string
  jobId?: string
}

export type GhPrReview = {
  id: string
  author: string
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, or PENDING. */
  state: string
  body: string
  submittedAt: string
}

export type GhPrComment = {
  id: string
  author: string
  body: string
  createdAt: string
  url: string
}

export type GhPrThread = {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  startLine: number | null
  diffHunk: string
  comments: Array<GhPrComment>
}

export type GhPrFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

export type GhPr = GhPrSummary & {
  body: string
  createdAt: string
  mergeStateStatus: string
  headRepositoryOwner: string
  headRepository: string
  isCrossRepository: boolean
  additions: number
  deletions: number
  changedFiles: number
  reviews: Array<GhPrReview>
  comments: Array<GhPrComment>
  checks: GhCheckSummary
  checkRuns: Array<GhPrCheck>
  threads: Array<GhPrThread>
  files: Array<GhPrFile>
}

export type GhBranchPr = {
  number: number
  title: string
  state: GhPrState
  isDraft: boolean
  url: string
  headRefName: string
  baseRefName: string
  reviewDecision: string
  checks: GhCheckSummary
  unresolvedThreads: number
}

// ---------------------------------------------------------------------------
// Checks

type RawRollupItem = {
  __typename?: string
  status?: string
  conclusion?: string
  state?: string
}

const FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "ERROR",
])
const SKIPPED = new Set(["SKIPPED", "STALE", "NEUTRAL"])
const PASSED = new Set(["SUCCESS", "COMPLETED"])

type CheckKind = "passed" | "failed" | "pending" | "skipped"

/** A check run conclusion or state, or a commit status state. */
function checkKind(state: string): CheckKind {
  if (FAILED.has(state)) return "failed"
  if (SKIPPED.has(state)) return "skipped"
  if (PASSED.has(state)) return "passed"
  return "pending"
}

function checkSummary(counts: Record<CheckKind, number>): GhCheckSummary {
  const state =
    counts.failed > 0
      ? "failure"
      : counts.pending > 0
        ? "pending"
        : counts.passed + counts.skipped > 0
          ? "success"
          : "none"
  return { state, ...counts }
}

/** One state for a list of check runs and commit statuses. */
export function summarizeChecks(
  items: Array<RawRollupItem> | null | undefined
): GhCheckSummary {
  const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 }
  for (const item of items ?? []) {
    const isStatus =
      item.__typename === "StatusContext" ||
      (item.status === undefined && item.state !== undefined)
    if (isStatus) counts[checkKind(item.state ?? "")]++
    else if (item.status !== "COMPLETED") counts.pending++
    else counts[checkKind(item.conclusion || "COMPLETED")]++
  }
  return checkSummary(counts)
}

type RawCounts = Array<{ state?: string; count?: number }> | null | undefined

/** The same, from the counts of a GraphQL status check rollup. */
export function summarizeCheckCounts(
  checkRuns: RawCounts,
  statuses: RawCounts
): GhCheckSummary {
  const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 }
  for (const item of [...(checkRuns ?? []), ...(statuses ?? [])]) {
    if (item.count) counts[checkKind(item.state ?? "")] += item.count
  }
  return checkSummary(counts)
}

const ACTIONS_JOB = /\/actions\/runs\/(\d+)\/job\/(\d+)/

type RawCheck = {
  name?: string
  state?: string
  bucket?: string
  link?: string
  workflow?: string
  description?: string
  startedAt?: string
  completedAt?: string
}

const BUCKET_ORDER = ["fail", "cancel", "pending", "pass", "skipping"]

function check(raw: RawCheck): GhPrCheck {
  const link = raw.link ?? ""
  const job = ACTIONS_JOB.exec(link)
  return {
    name: raw.name ?? "",
    bucket: raw.bucket ?? "",
    state: raw.state ?? "",
    link,
    workflow: raw.workflow ?? "",
    description: raw.description ?? "",
    startedAt: raw.startedAt ?? "",
    completedAt: raw.completedAt ?? "",
    ...(job ? { runId: job[1], jobId: job[2] } : {}),
  }
}

/** The checks of a pull request, failed first. */
export async function prChecks(cwd: string, number: number) {
  let output: string
  try {
    output = await run(cwd, [
      "pr",
      "checks",
      String(number),
      "--json",
      "name,state,bucket,link,workflow,description,startedAt,completedAt",
    ])
  } catch (error) {
    // gh exits with 1 when a check failed and with 8 when one is pending;
    // the JSON is still there.
    if (error instanceof GhError && error.stdout.trim().startsWith("[")) {
      output = error.stdout
    } else if (/no checks reported/i.test(String(error))) {
      return []
    } else {
      throw ghRequestError(error)
    }
  }
  const order = (bucket: string) => {
    const index = BUCKET_ORDER.indexOf(bucket)
    return index < 0 ? BUCKET_ORDER.length : index
  }
  return parseJson<Array<RawCheck>>(output)
    .map(check)
    .sort(
      (a, b) =>
        order(a.bucket) - order(b.bucket) || a.name.localeCompare(b.name)
    )
}

// ---------------------------------------------------------------------------
// List and detail

type RawLabel = { name?: string; color?: string; description?: string }
type RawPr = {
  number: number
  title?: string
  state?: string
  isDraft?: boolean
  author?: { login?: string }
  headRefName?: string
  baseRefName?: string
  createdAt?: string
  updatedAt?: string
  url?: string
  reviewDecision?: string
  mergeable?: string
  mergeStateStatus?: string
  statusCheckRollup?: Array<RawRollupItem>
  comments?: Array<{
    id?: string
    author?: { login?: string }
    body?: string
    createdAt?: string
    url?: string
  }>
  labels?: Array<RawLabel>
  body?: string
  reviews?: Array<{
    id?: string
    author?: { login?: string }
    state?: string
    body?: string
    submittedAt?: string
  }>
  files?: Array<{
    path?: string
    additions?: number
    deletions?: number
    changeType?: string
  }>
  headRepositoryOwner?: { login?: string }
  headRepository?: { name?: string; nameWithOwner?: string }
  isCrossRepository?: boolean
  additions?: number
  deletions?: number
  changedFiles?: number
}

function prState(value: string | undefined): GhPrState {
  return value === "MERGED" ? "MERGED" : value === "CLOSED" ? "CLOSED" : "OPEN"
}

function summary(raw: RawPr): GhPrSummary {
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: prState(raw.state),
    isDraft: Boolean(raw.isDraft),
    author: raw.author?.login ?? "",
    headRefName: raw.headRefName ?? "",
    baseRefName: raw.baseRefName ?? "",
    updatedAt: raw.updatedAt ?? "",
    url: raw.url ?? "",
    reviewDecision: raw.reviewDecision ?? "",
    mergeable: raw.mergeable ?? "UNKNOWN",
    checks: summarizeChecks(raw.statusCheckRollup),
    commentCount: raw.comments?.length ?? 0,
    labels: (raw.labels ?? []).map((label) => ({
      name: label.name ?? "",
      color: label.color ?? "cccccc",
      ...(label.description ? { description: label.description } : {}),
    })),
  }
}

const LIST_FIELDS =
  "number,title,state,isDraft,author,headRefName,baseRefName,updatedAt,url,reviewDecision,mergeable,statusCheckRollup,comments,labels"

// The list asks GraphQL for the check counts: `gh pr list --json
// statusCheckRollup` loads each check and takes about 3 times as long.
const LIST_NODE_FIELDS = `
  number title state isDraft url headRefName baseRefName updatedAt reviewDecision mergeable
  author { login }
  labels(first: 20) { nodes { name color description } }
  comments { totalCount }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts {
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
          }
        }
      }
    }
  }`

type RawListPr = {
  number: number
  title?: string
  state?: string
  isDraft?: boolean
  url?: string
  headRefName?: string
  baseRefName?: string
  updatedAt?: string
  reviewDecision?: string | null
  mergeable?: string
  author?: { login?: string } | null
  labels?: { nodes?: Array<RawLabel> }
  comments?: { totalCount?: number }
  commits?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: {
          contexts?: {
            checkRunCountsByState?: RawCounts
            statusContextCountsByState?: RawCounts
          }
        } | null
      }
    }>
  }
}

function rollupCounts(raw: Pick<RawListPr, "commits">) {
  const contexts = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts
  return summarizeCheckCounts(
    contexts?.checkRunCountsByState,
    contexts?.statusContextCountsByState
  )
}

function listSummary(raw: RawListPr): GhPrSummary {
  return {
    ...summary({
      ...raw,
      reviewDecision: raw.reviewDecision ?? "",
      author: raw.author ?? undefined,
      labels: raw.labels?.nodes ?? [],
      comments: undefined,
      statusCheckRollup: undefined,
    }),
    checks: rollupCounts(raw),
    commentCount: raw.comments?.totalCount ?? 0,
  }
}

/** The owner and name of the repository of `cwd`, kept for 10 minutes. */
const repoNames = new Map<string, { at: number; name: Promise<string> }>()
export async function repoName(cwd: string) {
  const cached = repoNames.get(cwd)
  if (cached && Date.now() - cached.at < 10 * 60_000) return await cached.name
  const name = graphql<{ repository?: { nameWithOwner?: string } }>(
    cwd,
    "query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { nameWithOwner } }",
    {}
  ).then((data) => data.repository?.nameWithOwner ?? "")
  repoNames.set(cwd, { at: Date.now(), name })
  name.catch(() => repoNames.delete(cwd))
  return await name
}

export type PrFilter = "mine" | "review" | "open"

export async function listPrs(
  cwd: string,
  options: { filter?: string; limit?: number; search?: string }
) {
  const filter: PrFilter =
    options.filter === "mine" || options.filter === "review"
      ? options.filter
      : "open"
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.floor(options.limit ?? 50))
  )
  const terms = [
    filter === "mine" ? "author:@me" : "",
    filter === "review" ? "review-requested:@me" : "",
    options.search?.trim() ?? "",
  ].filter(Boolean)
  if (terms.length === 0) {
    // All open pull requests: the repository, not the search index, so a
    // new pull request shows at once.
    const data = await graphql<{
      repository?: { pullRequests?: { nodes?: Array<RawListPr> } }
    }>(
      cwd,
      `query($owner: String!, $repo: String!, $limit: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${LIST_NODE_FIELDS} }
    }
  }
}`,
      { limit }
    )
    return (data.repository?.pullRequests?.nodes ?? []).map(listSummary)
  }
  const name = await repoName(cwd)
  if (!name) throw badRequest("No GitHub repository")
  const data = await graphql<{ search?: { nodes?: Array<RawListPr | null> } }>(
    cwd,
    `query($q: String!, $limit: Int!) {
  search(query: $q, type: ISSUE, first: $limit) {
    nodes { ... on PullRequest { ${LIST_NODE_FIELDS} } }
  }
}`,
    {
      q: `repo:${name} is:pr is:open sort:updated-desc ${terms.join(" ")}`,
      limit,
    }
  )
  return (data.search?.nodes ?? [])
    .filter((node): node is RawListPr => Boolean(node?.number))
    .map(listSummary)
}

export function prNumber(value: unknown) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest("A valid pull request number is required")
  }
  return number
}

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine originalLine
          comments(first: 100) {
            nodes { id author { login } body createdAt url diffHunk }
          }
        }
      }
    }
  }
}`

type RawThread = {
  id?: string
  isResolved?: boolean
  isOutdated?: boolean
  path?: string
  line?: number | null
  startLine?: number | null
  originalLine?: number | null
  comments?: {
    nodes?: Array<{
      id?: string
      author?: { login?: string } | null
      body?: string
      createdAt?: string
      url?: string
      diffHunk?: string
    }>
  }
}

type GraphqlAnswer<T> = { data?: T; errors?: Array<{ message?: string }> }

/** A GraphQL query; `{owner}` and `{repo}` come from the git remote. */
export async function graphql<T>(
  cwd: string,
  query: string,
  fields: Record<string, string | number>,
  /** owner: false for a query without $owner and $repo (a mutation by ID). */
  options: { owner?: boolean } = {}
) {
  const args = ["api", "graphql"]
  if (options.owner !== false)
    args.push("-F", "owner={owner}", "-F", "repo={repo}")
  for (const [key, value] of Object.entries(fields)) {
    // -F makes numbers; -f keeps text, so a branch named "123" stays text.
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`)
  }
  args.push("-f", `query=${query}`)
  const answer = await ghJson<GraphqlAnswer<T>>(cwd, args)
  if (!answer.data) {
    throw badRequest(answer.errors?.[0]?.message ?? "GitHub GraphQL failed")
  }
  return answer.data
}

export async function prThreads(cwd: string, number: number) {
  const data = await graphql<{
    repository?: {
      pullRequest?: { reviewThreads?: { nodes?: Array<RawThread> } }
    }
  }>(cwd, THREADS_QUERY, { number })
  const nodes = data.repository?.pullRequest?.reviewThreads?.nodes ?? []
  return nodes.map((raw, index): GhPrThread => {
    const comments = raw.comments?.nodes ?? []
    return {
      id: raw.id ?? String(index),
      isResolved: Boolean(raw.isResolved),
      isOutdated: Boolean(raw.isOutdated),
      path: raw.path ?? "",
      line: raw.line ?? raw.originalLine ?? null,
      startLine: raw.startLine ?? null,
      diffHunk: comments[0]?.diffHunk ?? "",
      comments: comments.map((comment, commentIndex) => ({
        id: comment.id ?? String(commentIndex),
        author: comment.author?.login ?? "",
        body: comment.body ?? "",
        createdAt: comment.createdAt ?? "",
        url: comment.url ?? "",
      })),
    }
  })
}

const VIEW_FIELDS = `${LIST_FIELDS},createdAt,body,reviews,files,mergeStateStatus,headRepositoryOwner,headRepository,isCrossRepository,additions,deletions,changedFiles`

export async function viewPr(cwd: string, number: number): Promise<GhPr> {
  const [raw, checkRuns, threads] = await Promise.all([
    ghJson<RawPr>(cwd, ["pr", "view", String(number), "--json", VIEW_FIELDS]),
    prChecks(cwd, number),
    prThreads(cwd, number),
  ])
  return {
    ...summary(raw),
    body: raw.body ?? "",
    createdAt: raw.createdAt ?? "",
    mergeStateStatus: raw.mergeStateStatus ?? "UNKNOWN",
    headRepositoryOwner: raw.headRepositoryOwner?.login ?? "",
    headRepository: raw.headRepository?.name ?? "",
    isCrossRepository: Boolean(raw.isCrossRepository),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? raw.files?.length ?? 0,
    // A review without text only holds thread comments: the threads show
    // those.
    reviews: (raw.reviews ?? [])
      .filter((review) => review.state !== "COMMENTED" || review.body?.trim())
      .map((review, index) => ({
        id: review.id || String(index),
        author: review.author?.login ?? "",
        state: review.state ?? "",
        body: review.body ?? "",
        submittedAt: review.submittedAt ?? "",
      })),
    comments: (raw.comments ?? []).map((comment, index) => ({
      id: comment.id ?? String(index),
      author: comment.author?.login ?? "",
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? "",
      url: comment.url ?? "",
    })),
    checkRuns,
    threads,
    files: (raw.files ?? []).map((file) => ({
      path: file.path ?? "",
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      changeType: file.changeType ?? "",
    })),
  }
}

// ---------------------------------------------------------------------------
// Diff and check logs

/** Cut a patch at the last file that fits, so that it still parses. */
function cutPatch(text: string, limit: number) {
  const head = text.slice(0, limit)
  const lastFile = head.lastIndexOf("\ndiff --git ")
  return lastFile > 0 ? head.slice(0, lastFile + 1) : head
}

export async function prDiff(cwd: string, number: number) {
  let patch: string
  let truncated = false
  try {
    patch = await run(cwd, ["pr", "diff", String(number), "--color", "never"], {
      maxBuffer: DIFF_LIMIT,
      timeoutMs: 60_000,
    })
  } catch (error) {
    if (!(error instanceof GhError && error.overflow)) {
      throw ghRequestError(error)
    }
    patch = error.stdout
    truncated = true
  }
  if (patch.length > DIFF_LIMIT) truncated = true
  return {
    patch: truncated ? cutPatch(patch, DIFF_LIMIT) : patch,
    truncated,
    limit: DIFF_LIMIT,
  }
}

// A line of `gh run view --log` is "job<TAB>step<TAB>time text".
const LOG_PREFIX = /^[^\t]*\t[^\t]*\t/
const LOG_TIME = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/

/**
 * The end of a failed job log: up to the last error line, because steps
 * after it only clean up. Without the job and step columns and the times.
 */
export function logTail(text: string, maxLines = LOG_TAIL_LINES) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(LOG_PREFIX, "").replace(LOG_TIME, ""))
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop()
  let end = lines.length
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index].includes("##[error]")) {
      end = Math.min(lines.length, index + 3)
      break
    }
  }
  const start = Math.max(0, end - maxLines)
  return {
    log: lines.slice(start, end).join("\n"),
    truncated: start > 0,
  }
}

export type GhCheckLog =
  | {
      kind: "actions"
      name: string
      link: string
      runId: string
      jobId: string
      log: string
      truncated: boolean
    }
  | { kind: "link"; name: string; link: string }

export async function prCheckLog(
  cwd: string,
  number: number,
  checkName: string
): Promise<GhCheckLog> {
  const wanted = checkName.trim()
  if (!wanted) throw badRequest("check is required")
  const checks = await prChecks(cwd, number)
  const found =
    checks.find((item) => item.jobId === wanted) ??
    checks.find((item) => item.name === wanted)
  if (!found) throw badRequest(`No check named ${wanted}`)
  if (!found.runId || !found.jobId) {
    return { kind: "link", name: found.name, link: found.link }
  }
  const output = await gh(
    cwd,
    ["run", "view", "--job", found.jobId, "--log-failed"],
    { timeoutMs: LOG_TIMEOUT_MS, maxBuffer: LOG_OUTPUT_LIMIT }
  )
  return {
    kind: "actions",
    name: found.name,
    link: found.link,
    runId: found.runId,
    jobId: found.jobId,
    ...logTail(output),
  }
}

// ---------------------------------------------------------------------------
// Pull requests of branches, for the agent header

const BRANCH_PR_FIELDS = `
  number title state isDraft url headRefName baseRefName updatedAt reviewDecision
  isCrossRepository headRepositoryOwner { login }
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts {
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
          }
        }
      }
    }
  }`

type RawBranchPr = Pick<RawListPr, "commits"> & {
  number: number
  title?: string
  state?: string
  isDraft?: boolean
  url?: string
  headRefName?: string
  baseRefName?: string
  updatedAt?: string
  reviewDecision?: string | null
  isCrossRepository?: boolean
  headRepositoryOwner?: { login?: string } | null
  reviewThreads?: { nodes?: Array<{ isResolved?: boolean }> }
}

/**
 * The open pull request of a branch, or else the last updated one. A pull
 * request from a fork counts only when the fork is the viewer's: a fork of
 * someone else can have a branch with the same name.
 */
function pickBranchPr(
  nodes: Array<RawBranchPr>,
  viewer: string
): GhBranchPr | null {
  const own = nodes.filter(
    (node) =>
      !node.isCrossRepository ||
      (viewer !== "" && node.headRepositoryOwner?.login === viewer)
  )
  const raw =
    own.find((node) => node.state === "OPEN") ??
    [...own].sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
    )[0]
  if (!raw) return null
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: prState(raw.state),
    isDraft: Boolean(raw.isDraft),
    url: raw.url ?? "",
    headRefName: raw.headRefName ?? "",
    baseRefName: raw.baseRefName ?? "",
    reviewDecision: raw.reviewDecision ?? "",
    checks: rollupCounts(raw),
    unresolvedThreads: (raw.reviewThreads?.nodes ?? []).filter(
      (thread) => !thread.isResolved
    ).length,
  }
}

export function branchList(value: unknown) {
  const text = typeof value === "string" ? value : ""
  const branches = [
    ...new Set(
      text
        .split(",")
        .map((branch) => branch.trim())
        .filter(Boolean)
    ),
  ]
  if (branches.length === 0) throw badRequest("branches is required")
  if (branches.length > MAX_BRANCHES) {
    throw badRequest(`At most ${MAX_BRANCHES} branches`)
  }
  return branches.sort()
}

async function loadBranchPrs(cwd: string, branches: Array<string>) {
  const variables = branches.map((_, index) => `$b${index}: String!`)
  const fields = branches.map(
    (_, index) =>
      `b${index}: pullRequests(headRefName: $b${index}, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${BRANCH_PR_FIELDS} } }`
  )
  const query = `query($owner: String!, $repo: String!, ${variables.join(", ")}) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    ${fields.join("\n    ")}
  }
}`
  const values = Object.fromEntries(
    branches.map((branch, index) => [`b${index}`, branch])
  )
  const data = await graphql<{
    viewer?: { login?: string }
    repository?: Record<string, { nodes?: Array<RawBranchPr> }>
  }>(cwd, query, values)
  const viewer = data.viewer?.login ?? ""
  const result: Record<string, GhBranchPr | null> = {}
  branches.forEach((branch, index) => {
    result[branch] = pickBranchPr(
      data.repository?.[`b${index}`]?.nodes ?? [],
      viewer
    )
  })
  return result
}

const branchCache = new Map<
  string,
  { at: number; value: Promise<Record<string, GhBranchPr | null>> }
>()

/** The pull request of each branch; answers stay 30 s. */
export async function branchPrs(cwd: string, branches: Array<string>) {
  const key = `${cwd}\0${branches.join("\0")}`
  const now = Date.now()
  for (const [cached, entry] of branchCache) {
    if (now - entry.at > BRANCH_CACHE_MS) branchCache.delete(cached)
  }
  const cached = branchCache.get(key)
  if (cached) return await cached.value
  const value = loadBranchPrs(cwd, branches)
  branchCache.set(key, { at: now, value })
  // Keep no failure: the next call tries again.
  value.catch(() => branchCache.delete(key))
  return await value
}

export function clearBranchPrCache() {
  branchCache.clear()
}
