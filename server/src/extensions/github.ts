/**
 * The `github` extension: pull requests, issues, and CI through the `gh`
 * command. Pico stores no GitHub token; `gh auth login` does.
 */
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"

import {
  clip,
  cwdOf,
  errorResult,
  runCommand,
  tail,
  textResult,
} from "./util.ts"

const LOG_LIMIT = 30_000

export type CheckRun = {
  name: string
  state: string
  bucket?: string
  link?: string
  workflow?: string
}

/** Run `gh`; throws with a clear message when it is missing or fails. */
export async function gh(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; allowFailure?: boolean; input?: string } = {}
) {
  const result = await runCommand(["gh", ...args], {
    cwd,
    timeoutMs: options.timeoutMs ?? 120_000,
    env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    ...(options.input !== undefined ? { input: options.input } : {}),
  })
  if (result.code === null && /ENOENT/.test(result.stderr))
    throw new Error(
      "The GitHub CLI (gh) is not installed. Install it and run `gh auth login`."
    )
  if (result.code !== 0 && !options.allowFailure) {
    const message = (result.stderr || result.stdout).trim()
    throw new Error(
      /auth login|not logged/i.test(message)
        ? "gh is not signed in. Run `gh auth login` in a terminal."
        : message || `gh ${args.slice(0, 2).join(" ")} failed`
    )
  }
  return result
}

export function summarizeChecks(checks: CheckRun[]) {
  const pending = checks.filter(
    (check) =>
      check.bucket === "pending" ||
      /PENDING|QUEUED|IN_PROGRESS|WAITING/i.test(check.state)
  )
  const failed = checks.filter(
    (check) =>
      check.bucket === "fail" ||
      check.bucket === "cancel" ||
      /FAIL|ERROR|CANCEL|TIMED_OUT/i.test(check.state)
  )
  const passed = checks.length - pending.length - failed.length
  return {
    total: checks.length,
    passed,
    failed: failed.length,
    pending: pending.length,
    done: checks.length > 0 && pending.length === 0,
    failures: failed.map((check) => ({
      name: check.name,
      ...(check.link ? { link: check.link } : {}),
    })),
  }
}

async function run(
  api: ToolExecutionApi,
  context: Context,
  work: (cwd: string) => Promise<ReturnType<typeof textResult>>
) {
  try {
    return await work(await cwdOf(api, context))
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}

type PrView = {
  number: number
  title: string
  state: string
  isDraft: boolean
  author?: { login?: string }
  headRefName: string
  baseRefName: string
  url: string
  reviewDecision: string
  mergeable: string
  additions: number
  deletions: number
  changedFiles: number
  body?: string
}

const PR_FIELDS =
  "number,title,state,isDraft,author,headRefName,baseRefName,url,reviewDecision,mergeable,additions,deletions,changedFiles,body"

export function createGithubExtension() {
  const prTool = defineTool({
    name: "gh_pr",
    description: [
      "Work with GitHub pull requests through gh.",
      "action: view (default: the PR of the current branch), list, create (title, body, base, draft), checkout, comment (body), merge (method: squash, merge, rebase), diff.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(
        ["view", "list", "create", "checkout", "comment", "merge", "diff"].map(
          (action) => Type.Literal(action)
        )
      ),
      pr: Type.Optional(Type.String({ description: "Number, URL, or branch" })),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      base: Type.Optional(Type.String()),
      draft: Type.Optional(Type.Boolean()),
      method: Type.Optional(
        Type.Union([
          Type.Literal("squash"),
          Type.Literal("merge"),
          Type.Literal("rebase"),
        ])
      ),
      state: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(args, api, context) {
      const memoKey = `pr-${String(args.action)}`
      if (["create", "comment", "merge"].includes(args.action)) {
        const done = await api.memo<string>(memoKey, context)
        if (done) return textResult(done)
      }
      return run(api, context, async (cwd) => {
        const target = args.pr ? [args.pr] : []
        switch (args.action) {
          case "view": {
            const result = await gh(cwd, [
              "pr",
              "view",
              ...target,
              "--json",
              PR_FIELDS,
            ])
            const pr = JSON.parse(result.stdout) as PrView
            return textResult(
              [
                `#${pr.number} ${pr.title} [${pr.state}${pr.isDraft ? ", draft" : ""}]`,
                `${pr.headRefName} → ${pr.baseRefName} by ${pr.author?.login ?? "?"}`,
                pr.url,
                `Review: ${pr.reviewDecision || "none"} · mergeable: ${pr.mergeable} · +${pr.additions} -${pr.deletions} in ${pr.changedFiles} files`,
                "",
                clip(pr.body ?? "", 8000),
              ].join("\n"),
              { details: pr as never }
            )
          }
          case "list": {
            const result = await gh(cwd, [
              "pr",
              "list",
              "--state",
              args.state ?? "open",
              "--limit",
              String(Math.min(100, args.limit ?? 20)),
              "--json",
              "number,title,headRefName,author,isDraft,updatedAt",
            ])
            const prs = JSON.parse(result.stdout) as Array<{
              number: number
              title: string
              headRefName: string
              isDraft: boolean
              author?: { login?: string }
            }>
            return textResult(
              prs.length
                ? prs
                    .map(
                      (pr) =>
                        `#${pr.number} ${pr.title} (${pr.headRefName}, ${pr.author?.login ?? "?"}${pr.isDraft ? ", draft" : ""})`
                    )
                    .join("\n")
                : "No pull requests."
            )
          }
          case "create": {
            if (!args.title) return errorResult("create needs a title")
            const result = await gh(cwd, [
              "pr",
              "create",
              "--title",
              args.title,
              "--body",
              args.body ?? "",
              ...(args.base ? ["--base", args.base] : []),
              ...(args.draft ? ["--draft"] : []),
            ])
            const text = `Created ${result.stdout.trim()}`
            await api.memo(memoKey, text, context)
            return textResult(text)
          }
          case "checkout": {
            if (!args.pr) return errorResult("checkout needs pr")
            await gh(cwd, ["pr", "checkout", args.pr])
            return textResult(`Checked out PR ${args.pr}.`)
          }
          case "comment": {
            if (!args.body) return errorResult("comment needs a body")
            const result = await gh(cwd, [
              "pr",
              "comment",
              ...target,
              "--body",
              args.body,
            ])
            const text = `Commented: ${result.stdout.trim()}`
            await api.memo(memoKey, text, context)
            return textResult(text)
          }
          case "merge": {
            const result = await gh(cwd, [
              "pr",
              "merge",
              ...target,
              `--${args.method ?? "squash"}`,
            ])
            const text = (result.stdout + result.stderr).trim() || "Merged."
            await api.memo(memoKey, text, context)
            return textResult(text)
          }
          case "diff": {
            const result = await gh(cwd, [
              "pr",
              "diff",
              ...target,
              "--color",
              "never",
            ])
            return textResult(clip(result.stdout, 40_000), {
              details: { patch: result.stdout.slice(0, 300_000) },
            })
          }
          default:
            return errorResult(`Unknown action ${String(args.action)}`)
        }
      })
    },
  })

  const issueTool = defineTool({
    name: "gh_issue",
    description:
      "Work with GitHub issues through gh. action: view (number), list (state, labels), create (title, body, labels), comment (number, body).",
    parameters: Type.Object({
      action: Type.Union(
        ["view", "list", "create", "comment"].map((action) =>
          Type.Literal(action)
        )
      ),
      number: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      labels: Type.Optional(Type.Array(Type.String())),
      state: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(args, api, context) {
      const memoKey = `issue-${String(args.action)}`
      if (args.action === "create" || args.action === "comment") {
        const done = await api.memo<string>(memoKey, context)
        if (done) return textResult(done)
      }
      return run(api, context, async (cwd) => {
        switch (args.action) {
          case "view": {
            if (!args.number) return errorResult("view needs a number")
            const result = await gh(cwd, [
              "issue",
              "view",
              args.number,
              "--json",
              "number,title,state,author,labels,body,comments,url",
            ])
            const issue = JSON.parse(result.stdout) as {
              number: number
              title: string
              state: string
              url: string
              body: string
              labels: Array<{ name: string }>
              comments: Array<{ author?: { login?: string }; body: string }>
            }
            return textResult(
              [
                `#${issue.number} ${issue.title} [${issue.state}] ${issue.labels.map((label) => label.name).join(", ")}`,
                issue.url,
                "",
                clip(issue.body, 8000),
                ...issue.comments
                  .slice(-10)
                  .map(
                    (comment) =>
                      `\n— ${comment.author?.login ?? "?"}: ${clip(comment.body, 2000)}`
                  ),
              ].join("\n")
            )
          }
          case "list": {
            const result = await gh(cwd, [
              "issue",
              "list",
              "--state",
              args.state ?? "open",
              "--limit",
              String(Math.min(100, args.limit ?? 20)),
              ...(args.labels?.length
                ? ["--label", args.labels.join(",")]
                : []),
              "--json",
              "number,title,labels",
            ])
            const issues = JSON.parse(result.stdout) as Array<{
              number: number
              title: string
              labels: Array<{ name: string }>
            }>
            return textResult(
              issues.length
                ? issues
                    .map(
                      (issue) =>
                        `#${issue.number} ${issue.title}${issue.labels.length ? ` [${issue.labels.map((label) => label.name).join(", ")}]` : ""}`
                    )
                    .join("\n")
                : "No issues."
            )
          }
          case "create": {
            if (!args.title) return errorResult("create needs a title")
            const result = await gh(cwd, [
              "issue",
              "create",
              "--title",
              args.title,
              "--body",
              args.body ?? "",
              ...(args.labels?.length
                ? ["--label", args.labels.join(",")]
                : []),
            ])
            const text = `Created ${result.stdout.trim()}`
            await api.memo(memoKey, text, context)
            return textResult(text)
          }
          case "comment": {
            if (!args.number || !args.body)
              return errorResult("comment needs a number and a body")
            const result = await gh(cwd, [
              "issue",
              "comment",
              args.number,
              "--body",
              args.body,
            ])
            const text = `Commented: ${result.stdout.trim()}`
            await api.memo(memoKey, text, context)
            return textResult(text)
          }
          default:
            return errorResult(`Unknown action ${String(args.action)}`)
        }
      })
    },
  })

  const checksTool = defineTool({
    name: "gh_checks",
    description:
      "Show the CI checks of a pull request (default: the PR of the current branch): passed, failed, and pending, with links to failures.",
    parameters: Type.Object({ pr: Type.Optional(Type.String()) }),
    replay: "safe",
    execute: (args, api, context) =>
      run(api, context, async (cwd) => {
        const result = await gh(
          cwd,
          [
            "pr",
            "checks",
            ...(args.pr ? [args.pr] : []),
            "--json",
            "name,state,bucket,link,workflow",
          ],
          { allowFailure: true }
        )
        if (!result.stdout.trim().startsWith("["))
          throw new Error(
            (result.stderr || result.stdout).trim() || "gh pr checks failed"
          )
        const checks = JSON.parse(result.stdout) as CheckRun[]
        const summary = summarizeChecks(checks)
        return textResult(
          [
            `${summary.total} checks: ${summary.passed} passed, ${summary.failed} failed, ${summary.pending} pending${summary.done ? " (done)" : ""}`,
            ...checks.map(
              (check) =>
                `${check.bucket ?? check.state} ${check.workflow ? `${check.workflow} / ` : ""}${check.name}${check.link && check.bucket === "fail" ? ` ${check.link}` : ""}`
            ),
          ].join("\n"),
          { details: { ...summary, checks } as never }
        )
      }),
  })

  const runLogTool = defineTool({
    name: "gh_run_log",
    description:
      "Read the log of a GitHub Actions run, by default only the failed steps. Give run_id, or pr to use the newest failed run of that PR's branch (default: the current branch).",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String()),
      pr: Type.Optional(Type.String()),
      failed_only: Type.Optional(Type.Boolean()),
      grep: Type.Optional(Type.String()),
    }),
    replay: "safe",
    execute: (args, api, context) =>
      run(api, context, async (cwd) => {
        let runId = args.run_id
        if (!runId) {
          let branch: string | undefined
          if (args.pr) {
            const pr = await gh(cwd, [
              "pr",
              "view",
              args.pr,
              "--json",
              "headRefName",
            ])
            branch = (JSON.parse(pr.stdout) as { headRefName: string })
              .headRefName
          } else {
            const head = await runCommand(["git", "branch", "--show-current"], {
              cwd,
            })
            branch = head.stdout.trim() || undefined
          }
          const runs = await gh(cwd, [
            "run",
            "list",
            ...(branch ? ["--branch", branch] : []),
            "--limit",
            "10",
            "--json",
            "databaseId,conclusion,status,name,createdAt",
          ])
          const list = JSON.parse(runs.stdout) as Array<{
            databaseId: number
            conclusion: string
            status: string
            name: string
          }>
          const chosen =
            list.find((item) => item.conclusion === "failure") ?? list[0]
          if (!chosen) return errorResult("No workflow runs found.")
          runId = String(chosen.databaseId)
        }
        const failedOnly = args.failed_only ?? true
        const result = await gh(
          cwd,
          ["run", "view", runId, failedOnly ? "--log-failed" : "--log"],
          { timeoutMs: 180_000 }
        )
        let log = result.stdout
        if (args.grep) {
          let pattern: RegExp
          try {
            pattern = new RegExp(args.grep, "i")
          } catch {
            return errorResult(`Invalid grep pattern: ${args.grep}`)
          }
          log = log
            .split("\n")
            .filter((line) => pattern.test(line))
            .join("\n")
        }
        const lines = log.split("\n").length
        return textResult(
          `Run ${runId}${failedOnly ? " (failed steps)" : ""}, ${lines} lines${log.length > LOG_LIMIT ? `, last ${LOG_LIMIT} characters` : ""}:\n${log.length > LOG_LIMIT ? tail(log.slice(-LOG_LIMIT), 100_000) : log}`
        )
      }),
  })

  return defineExtension({
    name: "github",
    tools: [prTool, issueTool, checksTool, runLogTool],
  })
}
