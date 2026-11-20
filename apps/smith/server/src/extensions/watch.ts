/**
 * The `watch` extension: a durable poll for a condition.
 *
 * A watch is a background task owned by the conversation. It checks a
 * command, a URL, a file, or the CI checks of a pull request at an interval,
 * and sends its message to the agent when the condition is true, or when it
 * times out. The message has the output of the last check. Each check is a
 * checkpoint, so a watch continues after a server restart.
 *
 * The `smith.timers` document (`timers.ts`) lists the watches.
 */
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

import Type from "typebox"
import {
  defineExtension,
  defineTask,
  defineTool,
} from "@earendil-works/pi-durable"

import { subagentCommandRefusal } from "../core/coding-tools.ts"
import type { HostBridge } from "./host.ts"
import {
  cancelTimer,
  listTimers,
  MAX_PENDING,
  pendingCount,
  TimersDoc,
  updateTimer,
  type TimerItem,
  type TimersState,
} from "./timers.ts"
import {
  clip,
  cwdOf,
  deniedAction,
  errorResult,
  formatDuration,
  json,
  notifyAgent,
  parseDuration,
  runCommand,
  tail,
  textResult,
} from "./util.ts"

export type WatchKind = "command" | "url" | "file" | "pr_checks"

export type WatchCheck = {
  kind: WatchKind
  command?: string
  url?: string
  path?: string
  /** Pull request number, URL, or branch, for `pr_checks`; absent uses the current branch. */
  pr?: string
  /**
   * When the watch fires. command: success (exit 0; default), failure,
   * match, change. url: status (default 200), match, change. file: exists
   * (default), missing, change, match. pr_checks: done (default), success,
   * failure. A pattern without until means match.
   */
  until?: string
  /** A regular expression for `match`. */
  pattern?: string
  /** url: the HTTP status for `status`. */
  status?: number
}

type WatchInput = {
  message: string
  label: string
  check: WatchCheck
  cwd: string
  intervalMs: number
  timeoutAt: number
}

type WatchCheckpoint =
  | {
      phase: "check"
      nextAt: number
      attempt: number
      /** The first fingerprint, for `change`. */
      baseline?: string
    }
  | {
      phase: "fire"
      reason: "met" | "timeout"
      output: string
      attempt: number
    }

export type CheckResult = { met: boolean; output: string; fingerprint: string }

const OUTPUT_LIMIT = 4000
export const MIN_INTERVAL_MS = 5_000
const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000
const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

const UNTIL: Record<WatchKind, readonly string[]> = {
  command: ["success", "failure", "match", "change"],
  url: ["status", "match", "change"],
  file: ["exists", "missing", "change", "match"],
  pr_checks: ["done", "success", "failure"],
}

/** The condition of a check, with its default. */
export function untilOf(check: WatchCheck) {
  if (check.until) return check.until
  if (check.pattern && check.kind !== "pr_checks") return "match"
  return UNTIL[check.kind][0]!
}

function fingerprint(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

/** Run one check. `baseline` is the first fingerprint, for `change`. */
export async function runCheck(
  check: WatchCheck,
  cwd: string,
  baseline: string | undefined,
  signal?: AbortSignal
): Promise<CheckResult> {
  const pattern = check.pattern ? new RegExp(check.pattern, "m") : undefined
  const until = untilOf(check)
  switch (check.kind) {
    case "command": {
      if (!check.command) throw new Error("A command watch needs command")
      const result = await runCommand(check.command, {
        cwd,
        timeoutMs: 120_000,
        ...(signal ? { signal } : {}),
      })
      const output = tail(`${result.stdout}${result.stderr}`.trim(), 60)
      const print = fingerprint(`${result.code}\n${output}`)
      const met =
        until === "failure"
          ? result.code !== 0
          : until === "match"
            ? Boolean(pattern?.test(output))
            : until === "change"
              ? baseline !== undefined && print !== baseline
              : result.code === 0
      return {
        met,
        output: clip(
          `exit ${result.timedOut ? "(timed out)" : result.code}\n${output}`,
          OUTPUT_LIMIT
        ),
        fingerprint: print,
      }
    }
    case "url": {
      if (!check.url) throw new Error("A url watch needs url")
      let status = 0
      let body = ""
      try {
        const response = await fetch(check.url, {
          signal: AbortSignal.any([
            AbortSignal.timeout(30_000),
            ...(signal ? [signal] : []),
          ]),
          redirect: "follow",
        })
        status = response.status
        body = (await response.text()).slice(0, 500_000)
      } catch (error) {
        body = error instanceof Error ? error.message : String(error)
      }
      const print = fingerprint(`${status}\n${body}`)
      const met =
        until === "match"
          ? Boolean(pattern?.test(body))
          : until === "change"
            ? baseline !== undefined && print !== baseline
            : status === (check.status ?? 200)
      return {
        met,
        output: clip(
          `HTTP ${status || "unreachable"}\n${body.slice(0, 1500)}`,
          OUTPUT_LIMIT
        ),
        fingerprint: print,
      }
    }
    case "file": {
      if (!check.path) throw new Error("A file watch needs path")
      const path = isAbsolute(check.path)
        ? check.path
        : resolve(cwd, check.path)
      const info = await stat(path).catch(() => undefined)
      const content =
        info?.isFile() && info.size < 5_000_000
          ? await readFile(path, "utf8").catch(() => "")
          : ""
      const print = info
        ? fingerprint(`${info.size}:${info.mtimeMs}:${fingerprint(content)}`)
        : "missing"
      const met =
        until === "missing"
          ? !info
          : until === "match"
            ? Boolean(pattern?.test(content))
            : until === "change"
              ? baseline !== undefined && print !== baseline
              : Boolean(info)
      return {
        met,
        output: info
          ? `${path}: ${info.size} bytes, modified ${new Date(info.mtimeMs).toISOString()}${until === "match" ? `\n${tail(content, 20)}` : ""}`
          : `${path}: missing`,
        fingerprint: print,
      }
    }
    case "pr_checks": {
      const result = await runCommand(
        [
          "gh",
          "pr",
          "checks",
          ...(check.pr ? [check.pr] : []),
          "--json",
          "name,state,bucket,link",
        ],
        { cwd, timeoutMs: 60_000, ...(signal ? { signal } : {}) }
      )
      if (result.code !== 0 && !result.stdout.trim().startsWith("[")) {
        throw new Error(
          `gh pr checks failed: ${(result.stderr || result.stdout).trim()}`
        )
      }
      const checks = JSON.parse(result.stdout || "[]") as CheckRun[]
      const counts = summarizeChecks(checks)
      const met =
        until === "failure"
          ? counts.failed > 0
          : until === "success"
            ? counts.done && counts.failed === 0
            : counts.done
      const summary = [
        `${counts.total} checks: ${counts.passed} passed, ${counts.failed} failed, ${counts.pending} pending`,
        ...counts.failures.map(
          (item) => `FAILED ${item.name}${item.link ? ` ${item.link}` : ""}`
        ),
      ].join("\n")
      return {
        met,
        output: clip(summary, OUTPUT_LIMIT),
        fingerprint: fingerprint(summary),
      }
    }
  }
}

export function describeCheck(check: WatchCheck) {
  const until = untilOf(check)
  const condition =
    until === "match"
      ? `matches /${check.pattern ?? ""}/`
      : until === "status"
        ? `HTTP ${check.status ?? 200}`
        : until
  switch (check.kind) {
    case "command":
      return `\`${check.command}\` until ${condition}`
    case "url":
      return `${check.url} until ${condition}`
    case "file":
      return `${check.path} until ${condition}`
    case "pr_checks":
      return `CI of ${check.pr ? `PR ${check.pr}` : "the current branch"} until ${condition}`
  }
}

/** The message that a watch sends when it fires or times out. */
export function watchMessage(
  id: string,
  input: Pick<WatchInput, "message" | "label" | "check">,
  reason: "met" | "timeout",
  attempts: number,
  output: string
) {
  return [
    reason === "met"
      ? `[Watch] ${input.message}`
      : `[Watch timed out] ${input.label}: the condition did not come true.`,
    `(watch ${id}: ${describeCheck(input.check)}, ${attempts} check(s))`,
    "Last check:",
    output,
  ].join("\n")
}

function createWatchTask(host: HostBridge) {
  return defineTask<WatchInput, WatchCheckpoint, { attempts: number }>({
    name: "smith.watch",
    version: 1,
    initial: () => ({ phase: "check", nextAt: 0, attempt: 0 }),
    phases: {
      check: async (task, runtime, context) => {
        const checkpoint = task.state.checkpoint
        if (checkpoint.nextAt > runtime.now())
          return runtime.sleepUntil(checkpoint.nextAt, checkpoint, context)
        const input = task.input
        let result: CheckResult
        try {
          result = await runCheck(
            input.check,
            input.cwd,
            checkpoint.baseline,
            runtime.signal
          )
        } catch (error) {
          if (runtime.signal.aborted) throw error
          result = {
            met: false,
            output: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
            fingerprint: "error",
          }
        }
        const now = runtime.now()
        const attempt = checkpoint.attempt + 1
        const timedOut = !result.met && now >= input.timeoutAt
        const nextAt = Math.min(now + input.intervalMs, input.timeoutAt)
        await runtime.commit(async (tx) => {
          await updateTimer(tx, task.conversationId, String(task.id), {
            runs: attempt,
            lastAt: now,
            lastOutput: result.output.slice(0, 1000),
            ...(result.met || timedOut ? {} : { nextAt }),
          })
          if (result.met || timedOut) {
            return {
              status: "running",
              checkpoint: {
                phase: "fire",
                reason: result.met ? "met" : "timeout",
                output: result.output,
                attempt,
              },
            }
          }
          return {
            status: "sleeping",
            until: nextAt,
            checkpoint: {
              phase: "check",
              nextAt,
              attempt,
              baseline: checkpoint.baseline ?? result.fingerprint,
            },
          }
        }, context)
      },
      fire: async (task, runtime, context) => {
        const { reason, output, attempt } = task.state.checkpoint
        await notifyAgent(
          host,
          (id) => runtime.conversation(id, context),
          task.conversationId,
          watchMessage(String(task.id), task.input, reason, attempt, output),
          `watch:${task.id}`,
          context
        )
        const now = runtime.now()
        await runtime.commit(async (tx) => {
          await updateTimer(tx, task.conversationId, String(task.id), {
            status: reason === "met" ? "done" : "failed",
            endedAt: now,
            nextAt: undefined,
          })
          return {
            status: "terminal",
            outcome: { status: "completed", result: { attempts: attempt } },
          }
        }, context)
      },
    },
    abort: async (task, runtime, context) => {
      await runtime.commit(async (tx) => {
        await updateTimer(tx, task.conversationId, String(task.id), {
          status: "cancelled",
          endedAt: runtime.now(),
          nextAt: undefined,
        })
        return {
          status: "terminal",
          outcome: { status: "aborted", reason: "cancelled" },
        }
      }, context)
    },
  })
}

/** One CI check of a pull request, from `gh pr checks --json`. */
export type CheckRun = {
  name: string
  state: string
  bucket?: string
  link?: string
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

export function createWatchExtension(host: HostBridge) {
  const WatchTask = createWatchTask(host)

  const watchTool = defineTool({
    name: "watch",
    description: [
      "Wait for a condition without blocking: Smith checks it at an interval in the background and sends you `message`, with the output of the last check, when it is true. When it stays false until timeout, you get a timed-out message. It survives a server restart.",
      "Use watch instead of sleep, a polling loop in bash, or waiting in a tool call. Set it, then end your turn or do other work; the message starts a new turn.",
      "Kinds: command (until exit 0; until failure, change, or match with pattern on the output), url (until HTTP status, default 200; or match with pattern on the body, or change), file (until it exists; or missing, change, match), pr_checks (the GitHub checks of a PR through gh: until done, success, or failure; pr is a number, URL, or branch, default the current branch).",
      "Examples: wait for an npm version to appear: watch { kind: 'url', url: 'https://registry.npmjs.org/<package>/<version>', message: 'Version is published' }. After git push: watch { kind: 'pr_checks', message: 'CI finished; fix failures' }. A deploy: watch { kind: 'url', url, pattern: 'v1.2.3' }.",
      "interval: default 30s, at least 5s. timeout: default 1h, at most 7d. action list shows your watches with their last check; action cancel stops watch `id`.",
      "Until a watch fires, you show as waiting, not done.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([
          Type.Literal("create"),
          Type.Literal("list"),
          Type.Literal("cancel"),
        ])
      ),
      kind: Type.Optional(
        Type.Union([
          Type.Literal("command"),
          Type.Literal("url"),
          Type.Literal("file"),
          Type.Literal("pr_checks"),
        ])
      ),
      message: Type.Optional(
        Type.String({ description: "create: what you get when it fires" })
      ),
      command: Type.Optional(
        Type.String({ description: "command: a shell command" })
      ),
      url: Type.Optional(Type.String({ description: "url: the address" })),
      path: Type.Optional(
        Type.String({ description: "file: a path, relative to your cwd" })
      ),
      pr: Type.Optional(
        Type.String({ description: "pr_checks: PR number, URL, or branch" })
      ),
      until: Type.Optional(
        Type.String({
          description:
            "The condition: command success|failure|match|change, url status|match|change, file exists|missing|change|match, pr_checks done|success|failure",
        })
      ),
      pattern: Type.Optional(
        Type.String({ description: "A regular expression, for match" })
      ),
      status: Type.Optional(
        Type.Number({ description: "url: the HTTP status (default 200)" })
      ),
      interval: Type.Optional(
        Type.String({ description: "Time between checks (default 30s)" })
      ),
      timeout: Type.Optional(
        Type.String({ description: "When to give up (default 1h, max 7d)" })
      ),
      label: Type.Optional(Type.String({ description: "A short name" })),
      id: Type.Optional(Type.String({ description: "cancel: the watch id" })),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const action = args.action ?? "create"
      if (action === "list")
        return textResult(await listTimers(api, "watch", context))
      if (action === "cancel") {
        if (!args.id) return errorResult("cancel needs id.")
        const services = await host.ready(context.abortSignal)
        return cancelTimer(services.harness, api, "watch", args.id, context)
      }
      const message = args.message?.trim()
      if (!message) return errorResult("create needs message.")
      if (!args.kind) return errorResult("create needs kind.")
      const check: WatchCheck = json({
        kind: args.kind,
        ...(args.command ? { command: args.command } : {}),
        ...(args.url ? { url: args.url } : {}),
        ...(args.path ? { path: args.path } : {}),
        ...(args.pr ? { pr: args.pr } : {}),
        ...(args.until ? { until: args.until } : {}),
        ...(args.pattern ? { pattern: args.pattern } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
      })
      const required = { command: "command", url: "url", file: "path" } as const
      const field = required[check.kind as keyof typeof required]
      if (field && !check[field])
        return errorResult(`A ${check.kind} watch needs ${field}.`)
      const until = untilOf(check)
      if (!UNTIL[check.kind].includes(until))
        return errorResult(
          `until for ${check.kind} is one of: ${UNTIL[check.kind].join(", ")}.`
        )
      if (until === "match" && !check.pattern)
        return errorResult("until match needs pattern.")
      if (check.pattern) {
        try {
          new RegExp(check.pattern)
        } catch (error) {
          return errorResult(
            `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      if (check.url && !/^https?:\/\//i.test(check.url))
        return errorResult("url must start with http:// or https://.")
      const intervalArg = args.interval ? parseDuration(args.interval) : 0
      if (intervalArg === undefined)
        return errorResult(`Not a duration: ${args.interval}`)
      const timeoutArg = args.timeout ? parseDuration(args.timeout) : 0
      if (timeoutArg === undefined)
        return errorResult(`Not a duration: ${args.timeout}`)
      const intervalMs = Math.max(
        MIN_INTERVAL_MS,
        intervalArg || DEFAULT_INTERVAL_MS
      )
      const timeoutMs = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(intervalMs, timeoutArg || DEFAULT_TIMEOUT_MS)
      )
      const cwd = await cwdOf(api, context)
      // A command watch runs a shell command: the same limits as bash.
      if (check.kind === "command" && check.command) {
        const denied = deniedAction(host, api.conversationId, "watch.command")
        if (denied) return denied
        const refusal = await subagentCommandRefusal(
          host,
          api.conversationId,
          check.command,
          cwd
        )
        if (refusal)
          return errorResult(
            `${refusal}. Ask your parent agent: end your turn with a message that starts with "Question:".`
          )
      }
      const now = api.now()
      const label = (args.label?.trim() || describeCheck(check)).slice(0, 160)
      const input: WatchInput = {
        message,
        label,
        check,
        cwd,
        intervalMs,
        timeoutAt: now + timeoutMs,
      }
      const id = await api.commit(async (tx) => {
        const draft = (await tx.doc(
          TimersDoc,
          api.conversationId
        )) as unknown as TimersState
        const existing = draft.byCall[api.callId]
        if (existing) return existing
        if (pendingCount(draft) >= MAX_PENDING) return undefined
        const taskId = String(
          await tx.createTask(WatchTask, input, {
            ownership: { kind: "conversation" },
            conversationId: api.conversationId,
            background: true,
          })
        )
        draft.byCall[api.callId] = taskId
        draft.items[taskId] = json({
          id: taskId,
          kind: "watch",
          label,
          message,
          status: "pending",
          createdAt: now,
          nextAt: now,
          every: formatDuration(intervalMs),
          timeoutAt: now + timeoutMs,
          runs: 0,
        }) as TimerItem
        return taskId
      }, context)
      if (!id)
        return errorResult(
          `You have ${MAX_PENDING} pending timers and watches. Cancel one first.`
        )
      return textResult(
        `Watch ${id} checks ${describeCheck(check)} every ${formatDuration(intervalMs)}, for up to ${formatDuration(timeoutMs)}. End your turn or do other work; the message starts a new turn.`,
        { details: { id, kind: check.kind } }
      )
    },
  })

  return defineExtension({
    name: "watch",
    tools: [watchTool],
    tasks: [WatchTask],
  })
}
