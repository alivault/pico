/**
 * Live GitHub pull requests: a poller for each repository that a client
 * looks at, or that has a wake subscription.
 *
 * - Live refresh: about every 60 s, one GraphQL query per repository reads
 *   the open pull requests (and the subscribed ones in more detail). When
 *   the answer changes, the server drops its branch PR cache and pushes a
 *   `github_changed` event; clients load their GitHub data again.
 * - Wake: an agent can subscribe to the pull request of its branch. When CI
 *   fails, a new review comment comes, or the pull request is merged or
 *   closed, the agent gets a follow-up prompt. The IDs of the checks and
 *   comments it saw are saved in `<data>/github-wakes.json`, before the
 *   prompt goes, so a restart does not wake it twice for the same event.
 *
 * Why a poller and not the durable `watch` tool: a watch fires one time and
 * belongs to one conversation. A wake subscription stays for the life of the
 * pull request, can fire many times, and shares one query per repository
 * with the live refresh of all clients.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { run } from "./github.ts"
import { clearBranchPrCache, graphql, logTail } from "./github-prs.ts"
import { repoRoot } from "./worktree.ts"

export const POLL_INTERVAL_MS = 60_000
const MAX_BACKOFF_MS = 15 * 60_000
/** A client counts as looking at a repository this long after it said so. */
export const VIEW_TTL_MS = 150_000
const TICK_MS = 5_000
const MAX_SEEN = 500
const MAX_LOGS = 3
const LOG_LINES = 60
const TEXT_LIMIT = 1_500
/** Below this many GraphQL points, wait for the reset. */
const RATE_LIMIT_FLOOR = 100

export type WakeEvents = { ci: boolean; comments: boolean; state: boolean }

export type WakeSub = {
  agentId: string
  /** The main checkout of the repository; the queries run there. */
  root: string
  /** The folder of the agent, for the `github_changed` event. */
  cwd: string
  number: number
  events: WakeEvents
  /** False until the first poll saw the pull request: then nothing wakes. */
  initialized: boolean
  seen: { checks: Array<string>; comments: Array<string> }
  state: string
  createdAt: number
}

type Store = { version: 1; subs: Record<string, WakeSub> }

export type WakeTarget = {
  /** True while the agent exists and is not archived. */
  alive: (agentId: string) => boolean
  /** True while the agent works; then a comment of the viewer is its own. */
  busy: (agentId: string) => boolean
  prompt: (agentId: string, message: string, requestId: string) => Promise<void>
}

type Hub = { push: (payload: { type: string; [key: string]: unknown }) => void }

type RepoState = {
  nextAt: number
  failures: number
  viewersUntil: number
  fingerprint: string
  polling: boolean
  /** The folders that clients asked about, for the `github_changed` event. */
  cwds: Set<string>
}

// ---------------------------------------------------------------------------
// The query

type RawCheck = {
  __typename?: string
  databaseId?: number
  name?: string
  conclusion?: string | null
  status?: string
  detailsUrl?: string
  context?: string
  state?: string
  targetUrl?: string
}

type RawComment = {
  databaseId?: number
  author?: { login?: string } | null
  body?: string
  url?: string
}

type RawSubPr = {
  number: number
  title?: string
  url?: string
  state?: string
  headRefOid?: string
  commits?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: { contexts?: { nodes?: Array<RawCheck> } } | null
      }
    }>
  }
  reviewThreads?: {
    nodes?: Array<{
      path?: string
      line?: number | null
      originalLine?: number | null
      comments?: { nodes?: Array<RawComment> }
    }>
  }
  comments?: { nodes?: Array<RawComment> }
  reviews?: { nodes?: Array<RawComment & { state?: string }> }
}

type RawAnswer = {
  viewer?: { login?: string }
  rateLimit?: { remaining?: number; resetAt?: string }
  repository?: {
    pullRequests?: {
      nodes?: Array<{
        number: number
        updatedAt?: string
        state?: string
        headRefOid?: string
        commits?: {
          nodes?: Array<{
            commit?: { statusCheckRollup?: { state?: string } | null }
          }>
        }
      }>
    }
  } & Record<string, unknown>
}

const SUB_FIELDS = `
  number title url state headRefOid
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { databaseId name conclusion status detailsUrl }
    ... on StatusContext { context state targetUrl }
  } } } } } }
  reviewThreads(last: 50) { nodes { path line originalLine comments(last: 20) { nodes { databaseId author { login } body url } } } }
  comments(last: 30) { nodes { databaseId author { login } body url } }
  reviews(last: 30) { nodes { databaseId state author { login } body url } }`

export function pollQuery(numbers: Array<number>) {
  const subs = numbers
    .map(
      (number) => `p${number}: pullRequest(number: ${number}) { ${SUB_FIELDS} }`
    )
    .join("\n    ")
  return `query($owner: String!, $repo: String!) {
  viewer { login }
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number updatedAt state headRefOid commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
    ${subs}
  }
}`
}

const FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
  "ERROR",
])

type FailedCheck = { key: string; name: string; link: string; jobId?: number }

export function failedChecks(pr: RawSubPr): Array<FailedCheck> {
  const nodes =
    pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  const result: Array<FailedCheck> = []
  for (const node of nodes) {
    if (node.__typename === "StatusContext") {
      if (FAILED.has(node.state ?? ""))
        result.push({
          key: `status:${node.context}:${pr.headRefOid ?? ""}:${node.state}`,
          name: node.context ?? "status",
          link: node.targetUrl ?? "",
        })
    } else if (
      node.status === "COMPLETED" &&
      FAILED.has(node.conclusion ?? "") &&
      node.databaseId
    ) {
      const actions = /\/actions\/runs\/\d+\/job\/\d+/.test(
        node.detailsUrl ?? ""
      )
      result.push({
        key: `run:${node.databaseId}`,
        name: node.name ?? "check",
        link: node.detailsUrl ?? "",
        ...(actions ? { jobId: node.databaseId } : {}),
      })
    }
  }
  return result
}

type NewComment = { key: string; place: string; author: string; body: string }

/** Review thread comments, PR comments and reviews with text. */
export function commentsOf(pr: RawSubPr): Array<NewComment> {
  const result: Array<NewComment> = []
  const add = (key: string, place: string, comment: RawComment) => {
    const author = comment.author?.login ?? ""
    if (!comment.databaseId) return
    result.push({ key, place, author, body: comment.body ?? "" })
  }
  for (const thread of pr.reviewThreads?.nodes ?? []) {
    const line = thread.line ?? thread.originalLine
    const place = line ? `${thread.path}:${line}` : (thread.path ?? "")
    for (const comment of thread.comments?.nodes ?? [])
      add(`c:${comment.databaseId}`, place, comment)
  }
  for (const comment of pr.comments?.nodes ?? [])
    add(`i:${comment.databaseId}`, "conversation", comment)
  for (const review of pr.reviews?.nodes ?? []) {
    if (!review.body?.trim() && review.state !== "CHANGES_REQUESTED") continue
    add(
      `r:${review.databaseId}`,
      `review (${(review.state ?? "").toLowerCase().replace("_", " ")})`,
      {
        ...review,
        body: review.body?.trim() || "Changes requested.",
      }
    )
  }
  return result
}

function clip(text: string, limit = TEXT_LIMIT) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function keep(list: Array<string>) {
  return list.slice(-MAX_SEEN)
}

// ---------------------------------------------------------------------------
// The watcher

export class GitHubWatcher {
  readonly #path: string
  readonly #hub: Hub
  readonly #target: WakeTarget
  readonly #now: () => number
  readonly #repos = new Map<string, RepoState>()
  #store: Store = { version: 1, subs: {} }
  #timer: NodeJS.Timeout | undefined
  #loaded: Promise<void> | undefined

  constructor(options: {
    dataDir: string
    hub: Hub
    target: WakeTarget
    now?: () => number
  }) {
    this.#path = join(options.dataDir, "github-wakes.json")
    this.#hub = options.hub
    this.#target = options.target
    this.#now = options.now ?? Date.now
  }

  async load() {
    this.#loaded ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(this.#path, "utf8")) as Store
        if (raw?.version === 1 && raw.subs) this.#store = raw
      } catch {
        // No file yet, or a broken one: start empty.
      }
    })()
    await this.#loaded
  }

  start() {
    this.#timer ??= setInterval(() => void this.tick(), TICK_MS)
    this.#timer.unref()
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  async #save() {
    await mkdir(dirname(this.#path), { recursive: true })
    const temp = `${this.#path}.tmp`
    await writeFile(temp, JSON.stringify(this.#store, null, 1))
    await rename(temp, this.#path)
  }

  #repo(root: string) {
    let repo = this.#repos.get(root)
    if (!repo) {
      repo = {
        nextAt: this.#now(),
        failures: 0,
        viewersUntil: 0,
        fingerprint: "",
        polling: false,
        cwds: new Set([root]),
      }
      this.#repos.set(root, repo)
    }
    return repo
  }

  /** A client looks at the GitHub data of `cwd`: poll its repository. */
  async viewing(cwd: string) {
    const root = (await repoRoot(cwd).catch(() => undefined)) ?? cwd
    const repo = this.#repo(root)
    const now = this.#now()
    // A client that comes back after a pause gets fresh data soon.
    if (repo.viewersUntil < now && repo.failures === 0)
      repo.nextAt = Math.min(repo.nextAt, now)
    repo.viewersUntil = now + VIEW_TTL_MS
    repo.cwds.add(cwd)
    return root
  }

  /** The state of the poller of a repository, for tests. */
  repoState(root: string) {
    const repo = this.#repos.get(root)
    return repo ? { nextAt: repo.nextAt, failures: repo.failures } : undefined
  }

  get(agentId: string) {
    const sub = this.#store.subs[agentId]
    return sub
      ? { number: sub.number, events: sub.events, initialized: sub.initialized }
      : null
  }

  /** Subscribe an agent to a pull request; all events off ends it. */
  async subscribe(input: {
    agentId: string
    cwd: string
    number: number
    events: WakeEvents
  }) {
    await this.load()
    const { agentId } = input
    if (!input.events.ci && !input.events.comments && !input.events.state) {
      delete this.#store.subs[agentId]
      await this.#save()
      return null
    }
    const root = (await repoRoot(input.cwd).catch(() => undefined)) ?? input.cwd
    const old = this.#store.subs[agentId]
    const same = old && old.number === input.number && old.root === root
    this.#store.subs[agentId] = same
      ? { ...old, cwd: input.cwd, events: input.events }
      : {
          agentId,
          root,
          cwd: input.cwd,
          number: input.number,
          events: input.events,
          initialized: false,
          seen: { checks: [], comments: [] },
          state: "OPEN",
          createdAt: this.#now(),
        }
    await this.#save()
    this.#repo(root).nextAt = this.#now()
    return this.get(agentId)
  }

  async unsubscribe(agentId: string) {
    await this.load()
    if (!this.#store.subs[agentId]) return
    delete this.#store.subs[agentId]
    await this.#save()
  }

  /** The repositories to poll now; also drops subscriptions of gone agents. */
  async #due() {
    const now = this.#now()
    let changed = false
    for (const [agentId, sub] of Object.entries(this.#store.subs)) {
      if (!this.#target.alive(agentId)) {
        delete this.#store.subs[agentId]
        changed = true
        continue
      }
      this.#repo(sub.root).cwds.add(sub.cwd)
    }
    if (changed) await this.#save()
    const roots: Array<string> = []
    for (const [root, repo] of this.#repos) {
      const subscribed = Object.values(this.#store.subs).some(
        (sub) => sub.root === root
      )
      if (!subscribed && repo.viewersUntil < now) continue
      if (repo.polling || repo.nextAt > now) continue
      roots.push(root)
    }
    return roots
  }

  /** One pass: poll each repository that is due. */
  async tick() {
    await this.load()
    await Promise.all((await this.#due()).map((root) => this.poll(root)))
  }

  async poll(root: string) {
    const repo = this.#repo(root)
    repo.polling = true
    const subs = Object.values(this.#store.subs).filter(
      (sub) => sub.root === root
    )
    const numbers = [...new Set(subs.map((sub) => sub.number))]
    try {
      const data = await graphql<RawAnswer>(root, pollQuery(numbers), {})
      repo.failures = 0
      repo.nextAt = this.#now() + POLL_INTERVAL_MS
      const remaining = data.rateLimit?.remaining
      const resetAt = Date.parse(data.rateLimit?.resetAt ?? "")
      if (remaining !== undefined && remaining < RATE_LIMIT_FLOOR && resetAt)
        repo.nextAt = Math.max(repo.nextAt, resetAt)
      this.#noteChange(root, repo, data)
      for (const sub of subs) {
        const pr = data.repository?.[`p${sub.number}`] as
          | RawSubPr
          | null
          | undefined
        if (pr) await this.#evaluate(sub, pr, data.viewer?.login ?? "")
      }
    } catch (error) {
      repo.failures += 1
      repo.nextAt =
        this.#now() +
        Math.min(POLL_INTERVAL_MS * 2 ** repo.failures, MAX_BACKOFF_MS)
      if (repo.failures <= 1)
        console.warn(
          `[smith] GitHub poll of ${root} failed: ${error instanceof Error ? error.message : String(error)}`
        )
    } finally {
      repo.polling = false
    }
  }

  /** Tell clients when the pull requests of a repository changed. */
  #noteChange(root: string, repo: RepoState, data: RawAnswer) {
    const list = (data.repository?.pullRequests?.nodes ?? []).map((pr) =>
      [
        pr.number,
        pr.updatedAt,
        pr.headRefOid,
        pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? "",
      ].join(":")
    )
    const subs = Object.keys(data.repository ?? {})
      .filter((key) => /^p\d+$/.test(key))
      .sort()
      .map((key) => {
        const pr = data.repository?.[key] as RawSubPr | null
        if (!pr) return key
        return [
          key,
          pr.state,
          failedChecks(pr)
            .map((check) => check.key)
            .join(","),
          commentsOf(pr)
            .map((comment) => comment.key)
            .join(","),
        ].join(":")
      })
    const fingerprint = createHash("sha256")
      .update([...list, ...subs].join("\n"))
      .digest("hex")
    const previous = repo.fingerprint
    repo.fingerprint = fingerprint
    if (!previous || previous === fingerprint) return
    clearBranchPrCache()
    this.#hub.push({
      type: "github_changed",
      root,
      cwds: [...repo.cwds],
      changedAt: this.#now(),
    })
  }

  async #evaluate(sub: WakeSub, pr: RawSubPr, viewer: string) {
    const failed = failedChecks(pr)
    const comments = commentsOf(pr)
    const state = pr.state ?? "OPEN"
    const current = this.#store.subs[sub.agentId]
    if (!current || current !== sub) return
    if (!sub.initialized) {
      sub.initialized = true
      sub.seen = {
        checks: keep(failed.map((check) => check.key)),
        comments: keep(comments.map((comment) => comment.key)),
      }
      sub.state = state
      await this.#save()
      return
    }
    const seenChecks = new Set(sub.seen.checks)
    const seenComments = new Set(sub.seen.comments)
    const newFailed = failed.filter((check) => !seenChecks.has(check.key))
    const newComments = comments.filter(
      (comment) => !seenComments.has(comment.key)
    )
    const ended = sub.state === "OPEN" && state !== "OPEN"
    sub.seen = {
      checks: keep([
        ...sub.seen.checks,
        ...newFailed.map((check) => check.key),
      ]),
      comments: keep([
        ...sub.seen.comments,
        ...newComments.map((comment) => comment.key),
      ]),
    }
    sub.state = state
    const wakeFailed = sub.events.ci ? newFailed : []
    // The agent posts with the login of the user. A comment of that login
    // that comes while the agent works is likely its own: it does not wake.
    const busy = this.#target.busy(sub.agentId)
    const wakeComments = sub.events.comments
      ? newComments.filter((comment) => !(busy && comment.author === viewer))
      : []
    const wakeEnded = sub.events.state && ended
    if (ended) delete this.#store.subs[sub.agentId]
    // Save first: a crash after this point loses a wake, never doubles it.
    await this.#save()
    if (wakeFailed.length === 0 && wakeComments.length === 0 && !wakeEnded)
      return
    const message = await this.#message(pr, sub.root, {
      failed: wakeFailed,
      comments: wakeComments,
      ended: wakeEnded ? state : "",
    })
    const keys = [
      ...wakeFailed.map((check) => check.key),
      ...wakeComments.map((comment) => comment.key),
      wakeEnded ? `state:${state}` : "",
    ].join(",")
    const requestId = `gh-wake:${sub.agentId}:${sub.number}:${createHash("sha256").update(keys).digest("hex").slice(0, 16)}`
    try {
      await this.#target.prompt(sub.agentId, message, requestId)
    } catch (error) {
      console.warn(
        `[smith] GitHub wake of ${sub.agentId} failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async #message(
    pr: RawSubPr,
    root: string,
    change: {
      failed: Array<FailedCheck>
      comments: Array<NewComment>
      ended: string
    }
  ) {
    const what = [
      change.failed.length > 0
        ? `CI failed (${change.failed.length} check${change.failed.length === 1 ? "" : "s"})`
        : "",
      change.comments.length > 0
        ? `${change.comments.length} new comment${change.comments.length === 1 ? "" : "s"}`
        : "",
      change.ended ? change.ended.toLowerCase() : "",
    ]
      .filter(Boolean)
      .join(", ")
    const parts = [
      `[GitHub PR #${pr.number}: ${what}] ${pr.title ?? ""}`,
      pr.url ?? "",
    ]
    if (change.failed.length > 0) {
      parts.push("", "Failed checks:")
      for (const [index, check] of change.failed.entries()) {
        parts.push(`### ${check.name}`, check.link)
        if (check.jobId && index < MAX_LOGS) {
          try {
            const output = await run(
              root,
              ["run", "view", "--job", String(check.jobId), "--log-failed"],
              { timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 }
            )
            const tail = logTail(output, LOG_LINES).log
            if (tail) parts.push("```", tail, "```")
          } catch {
            parts.push("(The log could not be loaded.)")
          }
        }
      }
    }
    if (change.comments.length > 0) {
      parts.push("", "New comments:")
      for (const comment of change.comments)
        parts.push(
          `- ${comment.place}, ${comment.author}: ${clip(comment.body)}`
        )
    }
    if (change.ended) {
      parts.push(
        "",
        `The pull request was ${change.ended.toLowerCase()}. The wake for it is off now.`
      )
    } else {
      parts.push(
        "",
        "Look at it and act if it is about your work. Do not reply on GitHub unless I asked you to."
      )
    }
    return parts.join("\n")
  }
}
