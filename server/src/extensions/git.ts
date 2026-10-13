/**
 * The `git` extension: structured git tools.
 *
 * The output for the model is short and regular; `details` carries file
 * lists and patches, so the web client can show a diff view. Tools that
 * change the repository tell clients to refresh their git panels.
 */
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"
import {
  clip,
  cwdOf,
  errorResult,
  runCommand,
  textResult,
  type CommandResult,
} from "./util.ts"

const MAX_PATCH_FOR_MODEL = 40_000
const MAX_PATCH_FOR_UI = 300_000

export type GitFile = {
  path: string
  previousPath?: string
  /** Status in the index (staged) and the worktree, as `git status` letters. */
  index: string
  worktree: string
}

export type GitStatus = {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  files: GitFile[]
}

async function git(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; allowFailure?: boolean } = {}
): Promise<CommandResult> {
  const result = await runCommand(["git", ...args], {
    cwd,
    timeoutMs: options.timeoutMs ?? 60_000,
    env: { GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
  })
  if (result.code !== 0 && !options.allowFailure)
    throw new Error(
      (result.stderr || result.stdout).trim() || `git ${args[0]} failed`
    )
  return result
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string): GitStatus {
  const status: GitStatus = { ahead: 0, behind: 0, files: [] }
  const records = output.split("\0")
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    if (!record) continue
    if (record.startsWith("# branch.head ")) {
      const head = record.slice(14)
      if (head !== "(detached)") status.branch = head
    } else if (record.startsWith("# branch.upstream ")) {
      status.upstream = record.slice(18)
    } else if (record.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      status.ahead = Number(match?.[1] ?? 0)
      status.behind = Number(match?.[2] ?? 0)
    } else if (record.startsWith("1 ")) {
      const parts = record.split(" ")
      const xy = parts[1] ?? ".."
      status.files.push({
        path: parts.slice(8).join(" "),
        index: xy[0]!,
        worktree: xy[1]!,
      })
    } else if (record.startsWith("2 ")) {
      const parts = record.split(" ")
      const xy = parts[1] ?? ".."
      status.files.push({
        path: parts.slice(9).join(" "),
        previousPath: records[index + 1] ?? "",
        index: xy[0]!,
        worktree: xy[1]!,
      })
      index += 1
    } else if (record.startsWith("u ")) {
      const parts = record.split(" ")
      status.files.push({
        path: parts.slice(10).join(" "),
        index: "U",
        worktree: "U",
      })
    } else if (record.startsWith("? ")) {
      status.files.push({ path: record.slice(2), index: "?", worktree: "?" })
    }
  }
  return status
}

export async function gitStatus(cwd: string) {
  const result = await git(cwd, ["status", "--porcelain=v2", "--branch", "-z"])
  return parseStatus(result.stdout)
}

function formatStatus(status: GitStatus) {
  const staged = status.files.filter(
    (file) => file.index !== "." && file.index !== "?"
  )
  const unstaged = status.files.filter(
    (file) => file.worktree !== "." && file.worktree !== "?"
  )
  const untracked = status.files.filter((file) => file.index === "?")
  const list = (files: GitFile[], column: "index" | "worktree") =>
    files
      .slice(0, 200)
      .map(
        (file) =>
          `  ${file[column] === "?" ? "?" : file[column]} ${file.previousPath ? `${file.previousPath} -> ` : ""}${file.path}`
      )
      .join("\n")
  return [
    `Branch: ${status.branch ?? "(detached HEAD)"}${status.upstream ? ` → ${status.upstream} (ahead ${status.ahead}, behind ${status.behind})` : " (no upstream)"}`,
    status.files.length === 0 ? "Clean: no changes." : "",
    staged.length ? `Staged (${staged.length}):\n${list(staged, "index")}` : "",
    unstaged.length
      ? `Not staged (${unstaged.length}):\n${list(unstaged, "worktree")}`
      : "",
    untracked.length
      ? `Untracked (${untracked.length}):\n${untracked
          .slice(0, 200)
          .map((file) => `  ${file.path}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export function createGitExtension(host: HostBridge) {
  const changed = (cwd: string) =>
    host.current?.events.push({
      type: "git_changed",
      cwd,
      changedAt: Date.now(),
      scopes: ["status", "files", "refs"],
    })

  const inRepo = async (
    api: ToolExecutionApi,
    context: Context,
    run: (cwd: string) => Promise<ReturnType<typeof textResult>>
  ) => {
    const cwd = await cwdOf(api, context)
    try {
      return await run(cwd)
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  const statusTool = defineTool({
    name: "git_status",
    description:
      "Show the git branch, its upstream, and the staged, unstaged, and untracked files.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: (_args, api, context) =>
      inRepo(api, context, async (cwd) => {
        const status = await gitStatus(cwd)
        return textResult(formatStatus(status), { details: status as never })
      }),
  })

  const diffTool = defineTool({
    name: "git_diff",
    description:
      "Show a unified diff: unstaged changes (default), staged changes, or the changes against a ref (for example main or HEAD~3). Limit it to paths. stat gives only a summary.",
    parameters: Type.Object({
      paths: Type.Optional(Type.Array(Type.String())),
      staged: Type.Optional(Type.Boolean()),
      ref: Type.Optional(Type.String()),
      stat: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    execute: (args, api, context) =>
      inRepo(api, context, async (cwd) => {
        const base = [
          "diff",
          "--no-color",
          "--no-ext-diff",
          ...(args.staged ? ["--cached"] : []),
          ...(args.ref ? [args.ref] : []),
        ]
        const paths = args.paths?.length ? ["--", ...args.paths] : []
        const stat = (
          await git(cwd, [...base, "--stat", ...paths])
        ).stdout.trim()
        if (args.stat)
          return textResult(stat || "No differences.", {
            details: { stat },
          })
        const patch = (await git(cwd, [...base, ...paths])).stdout
        if (!patch.trim()) return textResult("No differences.")
        return textResult(`${stat}\n\n${clip(patch, MAX_PATCH_FOR_MODEL)}`, {
          details: {
            stat,
            patch: patch.slice(0, MAX_PATCH_FOR_UI),
            truncated: patch.length > MAX_PATCH_FOR_UI,
          },
        })
      }),
  })

  const logTool = defineTool({
    name: "git_log",
    description: "Show recent commits: hash, author, age, and subject.",
    parameters: Type.Object({
      n: Type.Optional(Type.Number()),
      ref: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
    }),
    replay: "safe",
    execute: (args, api, context) =>
      inRepo(api, context, async (cwd) => {
        const count = Math.min(200, Math.max(1, args.n ?? 20))
        const result = await git(cwd, [
          "log",
          `-n${count}`,
          "--format=%h\t%an\t%ar\t%s",
          ...(args.ref ? [args.ref] : []),
          ...(args.path ? ["--", args.path] : []),
        ])
        const commits = result.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash = "", author = "", age = "", ...subject] =
              line.split("\t")
            return { hash, author, age, subject: subject.join("\t") }
          })
        return textResult(
          commits.length
            ? commits
                .map(
                  (commit) =>
                    `${commit.hash} ${commit.subject} (${commit.author}, ${commit.age})`
                )
                .join("\n")
            : "No commits.",
          { details: { commits } }
        )
      }),
  })

  const commitTool = defineTool({
    name: "git_commit",
    description:
      "Commit changes. Give paths to stage and commit only those, all to stage every change (also untracked files), or neither to commit what is staged.",
    parameters: Type.Object({
      message: Type.String(),
      paths: Type.Optional(Type.Array(Type.String())),
      all: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const done = await api.memo<{ hash: string; summary: string }>(
        "commit",
        context
      )
      if (done)
        return textResult(`Committed ${done.hash}: ${done.summary}`, {
          details: done,
        })
      return inRepo(api, context, async (cwd) => {
        if (args.all) await git(cwd, ["add", "-A"])
        else if (args.paths?.length)
          await git(cwd, ["add", "--", ...args.paths])
        const result = await git(cwd, ["commit", "-m", args.message], {
          allowFailure: true,
        })
        if (result.code !== 0) {
          // A rerun after a crash finds its own commit already made.
          const head = (
            await git(cwd, ["log", "-1", "--format=%h\t%s"], {
              allowFailure: true,
            })
          ).stdout.trim()
          const [hash = "", subject = ""] = head.split("\t")
          if (subject === args.message.split("\n")[0]) {
            const summary = subject
            await api.memo("commit", { hash, summary }, context)
            return textResult(`Committed ${hash}: ${summary}`)
          }
          return errorResult(
            (result.stdout + result.stderr).trim() || "git commit failed"
          )
        }
        const hash = (
          await git(cwd, ["rev-parse", "--short", "HEAD"])
        ).stdout.trim()
        const summary = result.stdout.trim().split("\n").slice(-1)[0] ?? ""
        await api.memo("commit", { hash, summary }, context)
        changed(cwd)
        return textResult(
          `Committed ${hash}: ${args.message.split("\n")[0]}\n${summary}`,
          {
            details: { hash, summary },
          }
        )
      })
    },
  })

  const branchTool = defineTool({
    name: "git_branch",
    description:
      "List local branches (default), create a branch (optionally from base) and switch to it, or switch to an existing branch.",
    parameters: Type.Object({
      create: Type.Optional(Type.String()),
      base: Type.Optional(Type.String()),
      switch: Type.Optional(Type.String()),
    }),
    replay: "safe",
    execute: (args, api, context) =>
      inRepo(api, context, async (cwd) => {
        if (args.create) {
          const exists = await git(
            cwd,
            ["rev-parse", "--verify", "--quiet", `refs/heads/${args.create}`],
            { allowFailure: true }
          )
          if (exists.code === 0) await git(cwd, ["switch", args.create])
          else
            await git(cwd, [
              "switch",
              "-c",
              args.create,
              ...(args.base ? [args.base] : []),
            ])
          changed(cwd)
          return textResult(`On branch ${args.create}.`)
        }
        if (args.switch) {
          await git(cwd, ["switch", args.switch])
          changed(cwd)
          return textResult(`On branch ${args.switch}.`)
        }
        const result = await git(cwd, [
          "branch",
          "--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:relative)",
        ])
        return textResult(
          result.stdout
            .trim()
            .split("\n")
            .map((line) => {
              const [head, name, upstream, track, age] = line.split("\t")
              return `${head === "*" ? "*" : " "} ${name}${upstream ? ` → ${upstream} ${track}` : ""} (${age})`
            })
            .join("\n")
        )
      }),
  })

  const pushTool = defineTool({
    name: "git_push",
    description:
      "Push the current branch. A branch without an upstream is pushed to origin and tracks it. force uses --force-with-lease.",
    parameters: Type.Object({ force: Type.Optional(Type.Boolean()) }),
    replay: "safe",
    async execute(args, api, context) {
      const done = await api.memo<string>("push", context)
      if (done) return textResult(done)
      return inRepo(api, context, async (cwd) => {
        const status = await gitStatus(cwd)
        if (!status.branch)
          return errorResult("HEAD is detached; switch to a branch first.")
        const result = await git(
          cwd,
          [
            "push",
            ...(args.force ? ["--force-with-lease"] : []),
            ...(status.upstream ? [] : ["-u", "origin", status.branch]),
          ],
          { timeoutMs: 180_000 }
        )
        const text = `Pushed ${status.branch}.\n${(result.stderr + result.stdout).trim()}`
        await api.memo("push", text, context)
        changed(cwd)
        return textResult(text)
      })
    },
  })

  const pullTool = defineTool({
    name: "git_pull",
    description:
      "Pull the current branch from its upstream (fast-forward or rebase).",
    parameters: Type.Object({ rebase: Type.Optional(Type.Boolean()) }),
    execute: (args, api, context) =>
      inRepo(api, context, async (cwd) => {
        const result = await git(
          cwd,
          ["pull", args.rebase ? "--rebase" : "--ff-only"],
          { timeoutMs: 180_000 }
        )
        changed(cwd)
        return textResult(
          (result.stdout + result.stderr).trim() || "Up to date."
        )
      }),
  })

  return defineExtension({
    name: "git",
    tools: [
      statusTool,
      diffTool,
      logTool,
      commitTool,
      branchTool,
      pushTool,
      pullTool,
    ],
  })
}
