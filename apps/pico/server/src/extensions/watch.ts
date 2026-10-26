/**
 * The `watch` extension: a durable poll for a condition.
 *
 * A watch is a background task: it checks a command, a URL, a file, or the CI
 * checks of a pull request at an interval, and sends a steer input when
 * the condition is true, or when it times out. Each check is a checkpoint, so
 * a watch continues after a server restart.
 */
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

import type { Context } from "@earendil-works/chord"
import {
  defineExtension,
  defineTask,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"
import {
  TimersDoc,
  updateTimer,
  type TimerItem,
  type TimersState,
} from "./schedule.ts"
import {
  clip,
  cwdOf,
  errorResult,
  formatDuration,
  json,
  notifyAgent,
  parseDuration,
  runCommand,
  tail,
  textResult,
} from "./util.ts"

export type WatchCheck = {
  type: "command" | "url" | "file" | "ci"
  command?: string
  url?: string
  path?: string
  /** Pull request number, URL, or branch, for `ci`; absent uses the current branch. */
  pr?: string
  /**
   * When the watch fires. command: success (exit 0, default), failure,
   * match, change. url: status (default 200), match, change, up, down.
   * file: change (default), exists, missing, match. ci: done (default),
   * success, failure.
   */
  until?: string
  pattern?: string
  status?: number
}

type WatchInput = {
  message: string
  label: string
  check: WatchCheck
  cwd: string
  intervalMs: number
  timeoutAt?: number
}

type WatchCheckpoint =
  | {
      phase: "check"
      nextAt: number
      attempt: number
      baseline?: string
      lastOutput?: string
    }
  | {
      phase: "fire"
      reason: "met" | "timeout"
      output: string
      attempt: number
    }

export type CheckResult = { met: boolean; output: string; fingerprint: string }

const OUTPUT_LIMIT = 4000

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
  switch (check.type) {
    case "command": {
      if (!check.command) throw new Error("A command check needs command")
      const result = await runCommand(check.command, {
        cwd,
        timeoutMs: 120_000,
        ...(signal ? { signal } : {}),
      })
      const output = tail(`${result.stdout}${result.stderr}`.trim(), 60)
      const print = fingerprint(`${result.code}\n${output}`)
      const until = check.until ?? "success"
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
        output: clip(`exit ${result.code}\n${output}`, OUTPUT_LIMIT),
        fingerprint: print,
      }
    }
    case "url": {
      if (!check.url) throw new Error("A url check needs url")
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
        body = (await response.text()).slice(0, 200_000)
      } catch (error) {
        body = error instanceof Error ? error.message : String(error)
      }
      const until = check.until ?? "status"
      const print = fingerprint(`${status}\n${body}`)
      const met =
        until === "match"
          ? Boolean(pattern?.test(body))
          : until === "change"
            ? baseline !== undefined && print !== baseline
            : until === "up"
              ? status >= 200 && status < 400
              : until === "down"
                ? status === 0 || status >= 500
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
      if (!check.path) throw new Error("A file check needs path")
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
      const until = check.until ?? "change"
      const met =
        until === "exists"
          ? Boolean(info)
          : until === "missing"
            ? !info
            : until === "match"
              ? Boolean(pattern?.test(content))
              : baseline !== undefined && print !== baseline
      return {
        met,
        output: info
          ? `${path}: ${info.size} bytes, modified ${new Date(info.mtimeMs).toISOString()}${until === "match" ? `\n${tail(content, 20)}` : ""}`
          : `${path}: missing`,
        fingerprint: print,
      }
    }
    case "ci": {
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
      const until = check.until ?? "done"
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

function describeCheck(check: WatchCheck) {
  switch (check.type) {
    case "command":
      return `\`${check.command}\` until ${check.until ?? "success"}`
    case "url":
      return `${check.url} until ${check.until ?? `HTTP ${check.status ?? 200}`}`
    case "file":
      return `${check.path} until ${check.until ?? "change"}`
    case "ci":
      return `CI of ${check.pr ? `PR ${check.pr}` : "the current branch"} until ${check.until ?? "done"}`
  }
}

function createWatchTask(host: HostBridge) {
  return defineTask<WatchInput, WatchCheckpoint, { attempts: number }>({
    name: "pico.watch",
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
          result = {
            met: false,
            output: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
            fingerprint: "error",
          }
        }
        const now = runtime.now()
        const attempt = checkpoint.attempt + 1
        const timedOut =
          !result.met && input.timeoutAt !== undefined && now >= input.timeoutAt
        await runtime.commit(async (tx) => {
          await updateTimer(tx, task.conversationId, String(task.id), {
            runs: attempt,
            lastAt: now,
            lastOutput: result.output.slice(0, 1000),
            ...(result.met || timedOut
              ? {}
              : { nextAt: now + input.intervalMs }),
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
            until: now + input.intervalMs,
            checkpoint: {
              phase: "check",
              nextAt: now + input.intervalMs,
              attempt,
              baseline: checkpoint.baseline ?? result.fingerprint,
              lastOutput: result.output.slice(0, 1000),
            },
          }
        }, context)
      },
      fire: async (task, runtime, context) => {
        const { reason, output, attempt } = task.state.checkpoint
        const input = task.input
        const text = [
          reason === "met"
            ? `[Watch] ${input.message}`
            : `[Watch timed out] ${input.label}: the condition did not come true.`,
          `(watch ${task.id}: ${describeCheck(input.check)}, ${attempt} check(s))`,
          "Last check:",
          output,
        ].join("\n")
        await notifyAgent(
          host,
          (id) => runtime.conversation(id, context),
          task.conversationId,
          text,
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
  workflow?: string
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

const MIN_INTERVAL_MS = 15_000

export function createWatchExtension(host: HostBridge) {
  const WatchTask = createWatchTask(host)

  /** The watch action of the schedule tool. */
  const startWatch = async (
    args: {
      message: string
      check: WatchCheck
      interval?: string | undefined
      timeout?: string | undefined
      label?: string | undefined
    },
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      const check = args.check
      const intervalMs = Math.max(
        MIN_INTERVAL_MS,
        parseDuration(args.interval ?? "1m") ?? 60_000
      )
      const timeoutMs = parseDuration(args.timeout ?? "24h")
      if (timeoutMs === undefined)
        return errorResult(`Not a duration: ${args.timeout}`)
      if (check.pattern) {
        try {
          new RegExp(check.pattern)
        } catch (error) {
          return errorResult(
            `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      const required = { command: "command", url: "url", file: "path" } as const
      const field = required[check.type as keyof typeof required]
      if (field && !check[field])
        return errorResult(`A ${check.type} check needs ${field}`)
      const now = Date.now()
      const cwd = await cwdOf(api, context)
      const label = (args.label ?? describeCheck(check)).slice(0, 160)
      const input: WatchInput = {
        message: args.message,
        label,
        check: json(check),
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
          message: args.message,
          status: "pending",
          createdAt: now,
          nextAt: now,
          every: formatDuration(intervalMs),
          runs: 0,
        }) as TimerItem
        return taskId
      }, context)
      return textResult(
        `Watch ${id} checks ${describeCheck(check)} every ${formatDuration(intervalMs)}, for up to ${formatDuration(timeoutMs)}. You get a message when it fires.`,
        { details: { id } }
      )
    }
  }

  return {
    start: startWatch,
    lastChecks,
    extension: defineExtension({ name: "watch", tasks: [WatchTask] }),
  }
}

export type WatchExtension = ReturnType<typeof createWatchExtension>

/** The last check of each open watch, for the list action. */
async function lastChecks(
  api: Pick<ToolExecutionApi, "snapshot" | "conversationId">,
  context: Context
) {
  const state = await api.snapshot(TimersDoc, api.conversationId, context)
  return Object.values(state?.items ?? {})
    .filter(
      (item) =>
        item.kind === "watch" && item.status === "pending" && item.lastOutput
    )
    .map((item) => `\n${item.id} last check:\n${item.lastOutput}`)
    .join("")
}
