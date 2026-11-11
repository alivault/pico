/**
 * GitHub issues of a project, through the `gh` command on this machine. `gh`
 * finds the repository from the git remote of `cwd` and uses its own login,
 * so Pico keeps no token.
 */
import { execFile } from "node:child_process"

import { badRequest } from "../http.ts"

const OUTPUT_LIMIT = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_LIST_LIMIT = 200

export type GhLabel = { name: string; color: string; description?: string }

export type GhIssueSummary = {
  number: number
  title: string
  state: "OPEN" | "CLOSED"
  stateReason?: string
  labels: Array<GhLabel>
  author: string
  commentCount: number
  createdAt: string
  updatedAt: string
  url: string
}

export type GhIssueComment = {
  id: string
  author: string
  body: string
  createdAt: string
  url: string
}

export type GhIssue = GhIssueSummary & {
  body: string
  assignees: Array<string>
  comments: Array<GhIssueComment>
}

export type GhRepo =
  | {
      available: true
      nameWithOwner: string
      url: string
      viewerCanWrite: boolean
    }
  | { available: false; reason: string }

class GhError extends Error {
  readonly missing: boolean
  constructor(message: string, missing = false) {
    super(message)
    this.missing = missing
  }
}

function run(cwd: string, args: Array<string>, input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      "gh",
      args,
      {
        cwd,
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: OUTPUT_LIMIT,
        encoding: "utf8",
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          NO_COLOR: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(String(stdout ?? ""))
          return
        }
        const code = (error as { code?: unknown }).code
        if (code === "ENOENT") {
          reject(new GhError("The GitHub CLI (gh) is not installed", true))
          return
        }
        const timedOut = (error as { killed?: boolean }).killed
        reject(
          new GhError(
            timedOut
              ? "gh command timed out"
              : String(stderr ?? "").trim() ||
                  error.message ||
                  "gh command failed"
          )
        )
      }
    )
    // Close stdin, so that gh never waits for input.
    child.stdin?.end(input ?? "")
  })
}

async function gh(cwd: string, args: Array<string>, input?: string) {
  try {
    return await run(cwd, args, input)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : String(error))
  }
}

async function ghJson<T>(cwd: string, args: Array<string>) {
  const output = await gh(cwd, args)
  try {
    return JSON.parse(output) as T
  } catch {
    throw badRequest("gh returned output that is not JSON")
  }
}

/** The repository from the git remote of `cwd`, or why there is none. */
export async function repo(cwd: string): Promise<GhRepo> {
  try {
    const output = await run(cwd, [
      "repo",
      "view",
      "--json",
      "nameWithOwner,url,hasIssuesEnabled,viewerPermission",
    ])
    const data = JSON.parse(output) as {
      nameWithOwner?: string
      url?: string
      hasIssuesEnabled?: boolean
      viewerPermission?: string
    }
    if (!data.nameWithOwner) {
      return { available: false, reason: "No GitHub repository" }
    }
    if (data.hasIssuesEnabled === false) {
      return { available: false, reason: "Issues are off for this repository" }
    }
    return {
      available: true,
      nameWithOwner: data.nameWithOwner,
      url: data.url ?? `https://github.com/${data.nameWithOwner}`,
      viewerCanWrite: ["ADMIN", "MAINTAIN", "WRITE", "TRIAGE"].includes(
        data.viewerPermission ?? ""
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof GhError && error.missing) {
      return { available: false, reason: message }
    }
    if (/auth login|not logged/i.test(message)) {
      return {
        available: false,
        reason: "gh is not logged in. Run `gh auth login`.",
      }
    }
    if (
      /no git remotes|not a git repository|none of the git remotes/i.test(
        message
      )
    ) {
      return { available: false, reason: "No GitHub repository" }
    }
    return { available: false, reason: message }
  }
}

type RawLabel = { name?: string; color?: string; description?: string }
type RawIssue = {
  number: number
  title?: string
  state?: string
  stateReason?: string
  labels?: Array<RawLabel>
  author?: { login?: string }
  comments?: Array<{
    id?: string
    author?: { login?: string }
    body?: string
    createdAt?: string
    url?: string
  }>
  assignees?: Array<{ login?: string }>
  body?: string
  createdAt?: string
  updatedAt?: string
  url?: string
}

function label(raw: RawLabel): GhLabel {
  return {
    name: raw.name ?? "",
    color: raw.color ?? "cccccc",
    ...(raw.description ? { description: raw.description } : {}),
  }
}

function summary(raw: RawIssue): GhIssueSummary {
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
    ...(raw.stateReason ? { stateReason: raw.stateReason } : {}),
    labels: (raw.labels ?? []).map(label),
    author: raw.author?.login ?? "",
    commentCount: raw.comments?.length ?? 0,
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
    url: raw.url ?? "",
  }
}

const SUMMARY_FIELDS =
  "number,title,state,stateReason,labels,author,comments,createdAt,updatedAt,url"

export async function listIssues(
  cwd: string,
  options: {
    state?: string
    label?: string
    search?: string
    limit?: number
  }
) {
  const state = ["open", "closed", "all"].includes(options.state ?? "")
    ? (options.state as string)
    : "open"
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.floor(options.limit ?? 100))
  )
  const args = [
    "issue",
    "list",
    "--state",
    state,
    "--limit",
    String(limit),
    "--json",
    SUMMARY_FIELDS,
  ]
  if (options.label) args.push("--label", options.label)
  if (options.search) args.push("--search", options.search)
  const raw = await ghJson<Array<RawIssue>>(cwd, args)
  return raw.map(summary)
}

export async function listLabels(cwd: string) {
  const raw = await ghJson<Array<RawLabel>>(cwd, [
    "label",
    "list",
    "--limit",
    "200",
    "--json",
    "name,color,description",
  ])
  return raw.map(label).sort((a, b) => a.name.localeCompare(b.name))
}

export function issueNumber(value: unknown) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest("A valid issue number is required")
  }
  return number
}

export async function viewIssue(cwd: string, number: number): Promise<GhIssue> {
  const raw = await ghJson<RawIssue>(cwd, [
    "issue",
    "view",
    String(number),
    "--json",
    `${SUMMARY_FIELDS},body,assignees`,
  ])
  return {
    ...summary(raw),
    body: raw.body ?? "",
    assignees: (raw.assignees ?? []).flatMap((assignee) =>
      assignee.login ? [assignee.login] : []
    ),
    comments: (raw.comments ?? []).map((comment, index) => ({
      id: comment.id ?? String(index),
      author: comment.author?.login ?? "",
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? "",
      url: comment.url ?? "",
    })),
  }
}

function cleanLabels(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : []
  )
}

/** Make an issue. Returns its number and URL. */
export async function createIssue(
  cwd: string,
  input: { title?: unknown; body?: unknown; labels?: unknown }
) {
  const title = typeof input.title === "string" ? input.title.trim() : ""
  if (!title) throw badRequest("A title is required")
  const body = typeof input.body === "string" ? input.body : ""
  const args = ["issue", "create", "--title", title, "--body-file", "-"]
  for (const name of cleanLabels(input.labels)) args.push("--label", name)
  const output = await gh(cwd, args, body)
  const url = output.trim().split("\n").pop() ?? ""
  const number = Number(url.match(/\/issues\/(\d+)/)?.[1])
  return { number: Number.isInteger(number) ? number : undefined, url }
}

export async function commentIssue(cwd: string, number: number, body: unknown) {
  const text = typeof body === "string" ? body : ""
  if (!text.trim()) throw badRequest("A comment is required")
  const output = await gh(
    cwd,
    ["issue", "comment", String(number), "--body-file", "-"],
    text
  )
  return { url: output.trim().split("\n").pop() ?? "" }
}

export async function setIssueState(
  cwd: string,
  number: number,
  state: unknown,
  reason?: unknown
) {
  if (state === "closed") {
    const args = ["issue", "close", String(number)]
    if (reason === "not planned" || reason === "completed")
      args.push("--reason", reason)
    await gh(cwd, args)
    return
  }
  if (state === "open") {
    await gh(cwd, ["issue", "reopen", String(number)])
    return
  }
  throw badRequest("state must be open or closed")
}

export async function editIssueLabels(
  cwd: string,
  number: number,
  add: unknown,
  remove: unknown
) {
  const args = ["issue", "edit", String(number)]
  for (const name of cleanLabels(add)) args.push("--add-label", name)
  for (const name of cleanLabels(remove)) args.push("--remove-label", name)
  if (args.length === 3) return
  await gh(cwd, args)
}
