/**
 * The `jobs` extension: long commands that run in the background.
 *
 * `job_start` returns at once. The command runs in a shared pseudo-terminal
 * (see `Terminals.spawnJob`), so the user can open it live in the terminal
 * panel. Output also goes to `<data>/jobs/<id>.log` for `job_output`.
 *
 * A process cannot survive a server restart, but its record can: the
 * `pico.jobs` document keeps each job, and a session-wide index lists the
 * running ones. At startup, jobs in the index without a process become
 * `lost`, and their session gets one message about it.
 */

import { utimesSync } from "node:fs"
import { readdir, stat, unlink } from "node:fs/promises"
import { join } from "node:path"

import type { Context } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type ConversationId,
  type DocumentReader,
  type Harness,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"

import { childCommandRefusal } from "../core/coding-tools.ts"
import {
  deleteJobLog,
  jobLogParts,
  JobLogWriter,
  plainLine,
  readLogTailLines,
  readLogTailRaw,
  scanLogLines,
} from "../services/job-log.ts"
import { InputWaitWatcher, readTerminalMode } from "../services/input-wait.ts"
import { KEY_NAMES, keyBytes } from "../services/terminal-keys.ts"
import { loginShell } from "../services/terminal.ts"
import {
  conversationOf,
  sessionIdOf,
  type HostBridge,
  type HostServices,
} from "./host.ts"
import {
  clip,
  cwdOf,
  errorResult,
  formatDuration,
  json,
  registerState,
  textResult,
} from "./util.ts"

export { jobLogPath, plainText } from "../services/job-log.ts"

export type Job = {
  id: string
  name: string
  command: string
  cwd: string
  status: "running" | "exited" | "stopped" | "lost" | "failed"
  exitCode?: number
  signal?: number
  startedAt: number
  endedAt?: number
  notifyOnExit: boolean
  pid?: number
  /** The job waits for input (see `services/input-wait.ts`). */
  waiting?: { since: number; prompt: string; secret: boolean }
  /** The agent asked the user to type into the job (`terminal` focus). */
  focus?: {
    prompt: string
    at: number
    /** The job shows in its tool call in the chat, not in a terminal tab. */
    inline?: boolean
  }
  /** The tool call that started the job. */
  callId?: string
}

/**
 * A running job that needs the user now: it waits for a secret (echo off),
 * or the agent asked for the user.
 */
export function jobNeedingUser(state: JobsState | null | undefined) {
  for (const job of Object.values(state?.items ?? {})) {
    if (job.status !== "running") continue
    if (job.focus)
      return { jobId: job.id, name: job.name, prompt: job.focus.prompt }
    // A prompt-like line is a guess: only the agent hears of it.
    if (job.waiting?.secret)
      return {
        jobId: job.id,
        name: job.name,
        prompt: job.waiting.prompt || "The job waits for input.",
      }
  }
  return undefined
}

export type JobsState = { items: Record<string, Job> }

export const JobsDoc = defineDoc<JobsState>({
  kind: "pico.jobs",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {} }),
})

/** Running jobs of every session, so a restart can find the lost ones. */
export const JobIndexDoc = defineDoc<{ running: Record<string, number> }>({
  kind: "pico.jobs.index",
  checkpointWhen: () => false,
  version: 1,
  scope: "session",
  initial: () => ({ running: {} }),
})

const MAX_RUNNING_PER_SESSION = 8
const KEEP_FINISHED = 30
/** Job logs older than this go at startup (see `deleteOldJobLogs`). */
const OLD_LOG_MS = 7 * 24 * 60 * 60 * 1000

/** How long a wait waits for an exit after a match. */
const EXIT_SETTLE_MS = 1000

/** Plain-text lines that `job_output` and `job_status` show at most. */
const MAX_TAIL_LINES = 1000

/** The last plain-text lines of a job log (all of a short log). */
export async function readJobLog(
  dataDir: string,
  jobId: string,
  lines = MAX_TAIL_LINES
) {
  return readLogTailLines(jobLogParts(dataDir, jobId), lines).join("\n")
}

function describeJob(job: Job, now = Date.now()) {
  const runtime = formatDuration((job.endedAt ?? now) - job.startedAt)
  const state =
    job.status === "running"
      ? `running for ${runtime}`
      : job.status === "exited"
        ? `exited with code ${job.exitCode} after ${runtime}`
        : `${job.status} after ${runtime}`
  const waiting =
    job.status === "running" && job.waiting
      ? `, waits for input${job.waiting.secret ? " (echo off)" : ""}: ${clip(job.waiting.prompt, 200)}`
      : ""
  return `${job.id} (${job.name}) ${state}${waiting}: ${job.command}`
}

function describeWait(job: Job, result: WaitResult) {
  switch (result.type) {
    case "match": {
      const found = result.earlier
        ? `Found in earlier output${result.number ? ` (line ${result.number})` : ""}: ${result.line}`
        : `Matched new output: ${result.line}`
      return result.exit
        ? `${found}\nThen the job exited with code ${result.exit.exitCode}.`
        : found
    }
    case "waiting":
      return `The job waits for input${result.secret ? " with echo off (a password or secret: only the user can type it)" : ""}. Last line: ${result.prompt || "(empty)"}\n${result.secret ? "Use the terminal tool's focus action to bring the user to it." : "Read it with the terminal tool: you may answer with send_text or send_keys, or use focus when the answer is the user's."}`
    case "exit":
      return `The job exited with code ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ""}.`
    case "ended":
      return job.status === "exited"
        ? `The job exited with code ${job.exitCode}.`
        : `The job does not run (${job.status}).`
    case "timeout":
      return job.waiting
        ? `Timed out. The job still waits for input: ${job.waiting.prompt || "(empty)"}`
        : "Timed out. The job still runs."
    case "aborted":
      return "The wait was stopped."
  }
}

async function changeJob(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  jobId: string,
  change: Partial<Job>,
  context: Context,
  dataDir?: string
) {
  const pruned: string[] = []
  await harness.commit(async (tx) => {
    pruned.length = 0
    const draft = (await tx.doc(
      JobsDoc,
      conversationId
    )) as unknown as JobsState
    const job = draft.items[jobId]
    if (job) Object.assign(job, json(change))
    if (job && change.status && change.status !== "running") {
      delete job.waiting
      delete job.focus
    }
    if (change.status && change.status !== "running") {
      const index = await tx.doc(JobIndexDoc)
      delete index.running[jobId]
      const finished = Object.values(draft.items)
        .filter((item) => item.status !== "running")
        .sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0))
      for (const old of finished.slice(
        0,
        Math.max(0, finished.length - KEEP_FINISHED)
      )) {
        delete draft.items[old.id]
        pruned.push(old.id)
      }
    }
  }, context)
  // A job without a record has no use for its log.
  if (dataDir) {
    for (const id of pruned) deleteJobLog(dataDir, id)
    // The age rule of `deleteOldJobLogs` counts from the end of the job.
    if (change.status && change.status !== "running")
      touchJobLog(dataDir, jobId)
  }
}

/** Change a job record in place; nothing when it is gone or finished. */
async function editRunningJob(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  jobId: string,
  edit: (job: Job) => void,
  context: Context
) {
  await harness.commit(async (tx) => {
    const draft = (await tx.doc(
      JobsDoc,
      conversationId
    )) as unknown as JobsState
    const job = draft.items[jobId]
    if (job?.status === "running") edit(job)
  }, context)
}

/** Send a steer to the session of a conversation, or its replacement (see `notifyAgent`). */
async function notifySession(
  services: HostServices,
  conversationId: ConversationId,
  text: string,
  requestId: string
) {
  const current =
    services.sessions.current(sessionIdOf(conversationId)) ??
    sessionIdOf(conversationId)
  const conversation = await services.harness.conversation(
    conversationOf(current),
    BACKGROUND_CONTEXT
  )
  await conversation?.submit(
    { type: "input", content: text, requestId, whenBusy: "steer" },
    BACKGROUND_CONTEXT
  )
}

/** Set the time of a job's log to now. */
function touchJobLog(dataDir: string, jobId: string) {
  const now = new Date()
  for (const path of jobLogParts(dataDir, jobId)) {
    try {
      utimesSync(path, now, now)
    } catch {
      // Gone.
    }
  }
}

/**
 * Delete job logs that did not change for `OLD_LOG_MS`, except the logs of
 * running jobs. This removes logs of pruned records from before Pico deleted
 * them, and of deleted conversations. The end of a job sets its log's time,
 * so a job that ended in that time keeps its log.
 */
export async function deleteOldJobLogs(
  dataDir: string,
  running: ReadonlySet<string>,
  now = Date.now()
) {
  let names: string[]
  try {
    names = await readdir(join(dataDir, "jobs"))
  } catch {
    return 0
  }
  let deleted = 0
  for (const name of names) {
    const match = /^([a-z0-9]+)(?:\.1)?\.log$/i.exec(name)
    if (!match || running.has(match[1]!)) continue
    const path = join(dataDir, "jobs", name)
    try {
      if (now - (await stat(path)).mtimeMs < OLD_LOG_MS) continue
      await unlink(path)
      deleted += 1
    } catch {
      // Gone already.
    }
  }
  return deleted
}

type WaitEvent =
  | { type: "line"; line: string }
  | { type: "waiting"; prompt: string; secret: boolean }
  | { type: "exit"; exitCode: number; signal?: number }

/** Takes an event; true when it reported a waiting or exit event to the agent. */
type Waiter = (event: WaitEvent) => boolean

export type WaitResult =
  | {
      type: "match"
      line: string
      number?: number
      earlier?: boolean
      /** The job exited right after the match. */
      exit?: { exitCode: number }
    }
  | { type: "waiting"; prompt: string; secret: boolean }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "ended" }
  | { type: "timeout" }
  | { type: "aborted" }

type LiveJob = {
  job: Job
  conversationId: ConversationId
  watcher?: InputWaitWatcher
  waiters: Set<Waiter>
  /** The open line of output, for waiters. */
  partial: string
  /** Counts the times the job started to wait, for request IDs. */
  episode: number
  /** The last wait that the agent was told of. */
  reported?: number
  device?: string
  /** Calls for each output chunk, for `settle`. */
  outputListeners: Set<() => void>
  focused?: boolean
}

/** The jobs that run in this process, with their open log files. */
class JobRunner {
  readonly #host: HostBridge
  readonly #dataDir: string
  readonly #exits = new Map<
    string,
    Promise<{ exitCode: number; signal?: number }>
  >()
  readonly #live = new Map<string, LiveJob>()

  constructor(host: HostBridge, dataDir: string) {
    this.#host = host
    this.#dataDir = dataDir
  }

  async start(
    services: HostServices,
    conversationId: ConversationId,
    job: Job
  ) {
    const log = new JobLogWriter(this.#dataDir, job.id)
    let resolveExit!: (exit: { exitCode: number; signal?: number }) => void
    this.#exits.set(
      job.id,
      new Promise((resolve) => {
        resolveExit = resolve
      })
    )
    const live: LiveJob = {
      job,
      conversationId,
      waiters: new Set(),
      partial: "",
      episode: 0,
      outputListeners: new Set(),
    }
    this.#live.set(job.id, live)
    const spawned = services.terminals.spawnJob(job.id, job.command, job.cwd, {
      label: job.name,
      onOutput: (data) => {
        log.write(data)
        live.watcher?.output(data)
        this.#matchOutput(live, data)
        for (const listener of live.outputListeners) listener()
      },
      onInput: (data) => {
        live.watcher?.input(data)
        // Enter in the terminal answers a focus request.
        if (/[\r\n]/.test(data) && live.focused) {
          live.focused = false
          void editRunningJob(
            services.harness,
            conversationId,
            job.id,
            (draft) => {
              delete draft.focus
            },
            BACKGROUND_CONTEXT
          ).catch(() => undefined)
        }
      },
      onExit: (exit) => {
        log.end()
        live.watcher?.stop()
        this.#live.delete(job.id)
        // The log has all the output: viewers read it from there.
        services.terminals.releaseJobOutput(job.id, (maxBytes) =>
          readLogTailRaw(jobLogParts(this.#dataDir, job.id), maxBytes)
        )
        let reported = false
        for (const waiter of live.waiters)
          if (waiter({ type: "exit", ...exit })) reported = true
        resolveExit(exit)
        void this.#finished(services, conversationId, job, exit, reported)
      },
    })
    if (spawned.device) live.device = spawned.device
    live.watcher = new InputWaitWatcher(spawned.device, {
      waiting: (prompt, secret) =>
        void this.#waiting(services, live, prompt, secret),
      resumed: () => {
        void editRunningJob(
          services.harness,
          conversationId,
          job.id,
          (draft) => {
            delete draft.waiting
          },
          BACKGROUND_CONTEXT
        ).catch(() => undefined)
      },
      ignored: (prompt, secret) => {
        if (!job.notifyOnExit) return
        void notifySession(
          services,
          conversationId,
          [
            `[Job input not taken] The user pressed Enter in ${job.name} (job ${job.id}), but the job shows no new output after a few seconds and still waits for input${secret ? " (echo is off: a password or secret)" : ""}.`,
            `Last line: ${clip(prompt, 300) || "(empty)"}`,
          ].join("\n"),
          `job:${job.id}:ignored:${Date.now()}`
        ).catch(() => undefined)
      },
    })
    return spawned
  }

  /** The job started to wait for input: record it, and tell the agent once. */
  async #waiting(
    services: HostServices,
    live: LiveJob,
    prompt: string,
    secret: boolean
  ) {
    const { job, conversationId } = live
    live.episode += 1
    let reported = false
    for (const waiter of live.waiters)
      if (waiter({ type: "waiting", prompt, secret })) reported = true
    if (reported || job.notifyOnExit) live.reported = live.episode
    try {
      await editRunningJob(
        services.harness,
        conversationId,
        job.id,
        (draft) => {
          draft.waiting = { since: Date.now(), prompt, secret }
        },
        BACKGROUND_CONTEXT
      )
      if (reported || !job.notifyOnExit) return
      await notifySession(
        services,
        conversationId,
        [
          `[Job waits for input] ${job.name} (job ${job.id}) waits for input${secret ? " with echo off: a password or secret, so only the user can type it" : ""}.`,
          `Last line: ${clip(prompt, 300) || "(empty)"}`,
          secret
            ? "Use the terminal tool: focus to bring the user to it, then wait for the result. Or stop it with job_stop."
            : "Read it with the terminal tool (read). Answer with send_text or send_keys, or use focus when the answer is the user's.",
        ].join("\n"),
        `job:${job.id}:waiting:${live.episode}`
      )
    } catch (error) {
      console.warn(`[pico] could not record that job ${job.id} waits:`, error)
    }
  }

  /** Give new output lines to the waiters of a job. */
  #matchOutput(live: LiveJob, data: string) {
    if (live.waiters.size === 0) {
      live.partial = ""
      return
    }
    const parts = (live.partial + data).split("\n")
    live.partial = (parts.pop() ?? "").slice(-4096)
    const lines = parts.map((line) => plainLine(line))
    // A prompt has no line break yet: test the open line too.
    const open = plainLine(live.partial)
    if (open.trim()) lines.push(open)
    for (const line of lines)
      for (const waiter of live.waiters) waiter({ type: "line", line })
  }

  /**
   * Wait until a line of output matches, the job waits for input, or it
   * exits. Existing output is searched first.
   */
  async waitFor(
    jobId: string,
    options: {
      match?: (line: string) => boolean
      timeoutMs: number
      signal?: AbortSignal
      newOnly?: boolean
    }
  ): Promise<WaitResult> {
    const live = this.#live.get(jobId)
    let resolveResult!: (result: WaitResult) => void
    const result = new Promise<WaitResult>((resolve) => {
      resolveResult = resolve
    })
    let done = false
    const finish = (value: WaitResult) => {
      if (done) return false
      done = true
      resolveResult(value)
      return true
    }
    const waiter: Waiter = (event) => {
      if (event.type === "line") {
        if (options.match?.(event.line))
          finish({ type: "match", line: event.line })
        return false
      }
      if (event.type === "waiting")
        return finish({
          type: "waiting",
          prompt: event.prompt,
          secret: event.secret,
        })
      return finish({
        type: "exit",
        exitCode: event.exitCode,
        ...(event.signal ? { signal: event.signal } : {}),
      })
    }
    // Listen first, so no output falls between the search and the wait.
    live?.waiters.add(waiter)
    try {
      if (options.match && !options.newOnly) {
        let found: { line: string; number: number } | undefined
        await scanLogLines(
          jobLogParts(this.#dataDir, jobId),
          (line, number) => {
            if (!options.match!(line)) return
            found = { line, number }
            return false
          }
        )
        if (found) finish({ type: "match", ...found, earlier: true })
      }
      if (!live) return done ? await result : { type: "ended" }
      // A wait ends this call at once, unless the agent knows of it and
      // waits for what the user's input brings: a pattern, or a focus
      // request that is open.
      const waiting = live.watcher?.waiting
      const known =
        live.reported === live.episode && (options.match || live.focused)
      if (waiting && !known) {
        live.reported = live.episode
        finish({ type: "waiting", ...waiting })
      }
      const timer = setTimeout(
        () => finish({ type: "timeout" }),
        options.timeoutMs
      )
      timer.unref()
      const onAbort = () => finish({ type: "aborted" })
      options.signal?.addEventListener("abort", onAbort, { once: true })
      try {
        const value = await result
        if (value.type !== "match" || !this.#live.has(jobId)) return value
        // A job often exits right after the line the agent waits for: take
        // the exit into this result, so no exit message follows.
        const exit = await new Promise<WaitResult | undefined>((resolve) => {
          const settle = setTimeout(() => {
            live.waiters.delete(onExit)
            resolve(undefined)
          }, EXIT_SETTLE_MS)
          const onExit: Waiter = (event) => {
            if (event.type !== "exit") return false
            clearTimeout(settle)
            live.waiters.delete(onExit)
            resolve(event)
            return true
          }
          live.waiters.add(onExit)
        })
        return exit?.type === "exit"
          ? { ...value, exit: { exitCode: exit.exitCode } }
          : value
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", onAbort)
      }
    } finally {
      live?.waiters.delete(waiter)
    }
  }

  /**
   * Wait until a job's output settles after input: `quietMs` without output,
   * at most `maxMs`.
   */
  settle(jobId: string, quietMs = 300, maxMs = 3000) {
    const live = this.#live.get(jobId)
    if (!live) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let quiet: NodeJS.Timeout
      const done = () => {
        clearTimeout(quiet)
        clearTimeout(limit)
        live.outputListeners.delete(onOutput)
        resolve()
      }
      // Give the program a moment to answer before the first quiet check.
      quiet = setTimeout(done, quietMs * 2)
      const limit = setTimeout(done, maxMs)
      const onOutput = () => {
        clearTimeout(quiet)
        quiet = setTimeout(done, quietMs)
      }
      live.outputListeners.add(onOutput)
    })
  }

  /** The device of a running job's terminal, to read its mode. */
  device(jobId: string) {
    return this.#live.get(jobId)?.device
  }

  /** Whether a job runs in this process. */
  running(jobId: string) {
    return this.#live.has(jobId)
  }

  /** Mark that the agent asked the user to type into a job. */
  markFocused(jobId: string) {
    const live = this.#live.get(jobId)
    if (live) live.focused = true
  }

  /** Wait up to `ms` for a job to exit; undefined when it still runs. */
  async waitForExit(jobId: string, ms: number, signal?: AbortSignal) {
    const exit = this.#exits.get(jobId)
    if (!exit) return undefined
    let timer: NodeJS.Timeout | undefined
    let onAbort: (() => void) | undefined
    try {
      return await Promise.race([
        exit,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), ms)
          timer.unref()
          onAbort = () => resolve(undefined)
          signal?.addEventListener("abort", onAbort, { once: true })
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (onAbort) signal?.removeEventListener("abort", onAbort)
    }
  }

  async #finished(
    services: HostServices,
    conversationId: ConversationId,
    job: Job,
    exit: { exitCode: number; signal?: number },
    reported = false
  ) {
    this.#exits.delete(job.id)
    // The server stops this job as it shuts down: leave the record running,
    // so the next start reports it as lost.
    if (this.#host.stopping) return
    const stopped = this.#stopping.has(job.id)
    this.#stopping.delete(job.id)
    try {
      await changeJob(
        services.harness,
        conversationId,
        job.id,
        {
          status: stopped ? "stopped" : "exited",
          exitCode: exit.exitCode,
          ...(exit.signal ? { signal: exit.signal } : {}),
          endedAt: Date.now(),
        },
        BACKGROUND_CONTEXT,
        this.#dataDir
      )
      // A wait that saw the exit told the agent already.
      if (job.notifyOnExit && !stopped && !reported) {
        const output = await readJobLog(this.#dataDir, job.id, 40)
        await notifySession(
          services,
          conversationId,
          [
            `[Job ${exit.exitCode === 0 ? "finished" : "failed"}] ${job.name} exited with code ${exit.exitCode} after ${formatDuration(Date.now() - job.startedAt)}.`,
            `(job ${job.id}: ${job.command})`,
            "Last output:",
            clip(output, 4000) || "(no output)",
          ].join("\n"),
          `job:${job.id}:exit`
        )
      }
    } catch (error) {
      console.warn(`[pico] could not record the end of job ${job.id}:`, error)
    }
  }

  readonly #stopping = new Set<string>()

  /** The end of the plain-text log of a job. */
  log(jobId: string, lines?: number) {
    return readJobLog(this.#dataDir, jobId, lines)
  }

  stop(services: Pick<HostServices, "terminals">, jobId: string) {
    this.#stopping.add(jobId)
    const stopped = services.terminals.stopJob(jobId)
    if (!stopped) this.#stopping.delete(jobId)
    return stopped
  }

  /** At startup: running jobs of an earlier process are lost. */
  async recover(services: HostServices) {
    const index = await services.harness.snapshot(
      JobIndexDoc,
      BACKGROUND_CONTEXT
    )
    await deleteOldJobLogs(
      this.#dataDir,
      new Set(Object.keys(index?.running ?? {}))
    ).catch((error: unknown) =>
      console.warn("[pico] could not delete old job logs:", error)
    )
    for (const [jobId, conversationNumber] of Object.entries(
      index?.running ?? {}
    )) {
      if (services.terminals.jobRunning(jobId)) continue
      const conversationId = conversationNumber as unknown as ConversationId
      const jobs = await services.harness.snapshot(
        JobsDoc,
        conversationId,
        BACKGROUND_CONTEXT
      )
      const job = jobs?.items[jobId]
      await changeJob(
        services.harness,
        conversationId,
        jobId,
        { status: "lost", endedAt: Date.now() },
        BACKGROUND_CONTEXT,
        this.#dataDir
      )
      if (job?.notifyOnExit) {
        await notifySession(
          services,
          conversationId,
          [
            `[Job lost] ${job.name} stopped because the Pico server restarted. Its output is in job_output ${jobId}.`,
            `(job ${jobId}: ${job.command})`,
          ].join("\n"),
          `job:${jobId}:lost`
        ).catch(() => undefined)
      }
    }
  }
}

/** Stop a job of a conversation, for the web client. */
export async function stopJob(
  services: Pick<HostServices, "terminals" | "harness">,
  runner: {
    stop(services: Pick<HostServices, "terminals">, jobId: string): boolean
  },
  reader: DocumentReader,
  conversationId: ConversationId,
  jobId: string,
  context: Context
) {
  const jobs = await reader.snapshot(JobsDoc, conversationId, context)
  const job = jobs?.items[jobId]
  if (!job) return { ok: false as const, error: `No job with id ${jobId}` }
  if (job.status !== "running")
    return { ok: false as const, error: `Job ${jobId} is ${job.status}` }
  if (!runner.stop(services, jobId)) {
    await changeJob(
      services.harness,
      conversationId,
      jobId,
      { status: "lost", endedAt: Date.now() },
      context
    )
  }
  return { ok: true as const }
}

registerState({
  key: "jobs",
  kinds: ["pico.jobs"],
  async read(reader, conversationId, context) {
    const state = await reader.snapshot(JobsDoc, conversationId, context)
    const items = Object.values(state?.items ?? {}).sort(
      (left, right) => right.startedAt - left.startedAt
    )
    return items.length > 0 ? json(items.slice(0, 20)) : undefined
  },
})

export type JobsExtension = ReturnType<typeof createJobsExtension>

export function createJobsExtension(host: HostBridge, dataDir: string) {
  const runner = new JobRunner(host, dataDir)
  host.onReady((services) => runner.recover(services))

  const jobFor = async (
    api: {
      snapshot: DocumentReader["snapshot"]
      conversationId: ConversationId
    },
    id: string,
    context: Context
  ) => {
    const jobs = await api.snapshot(JobsDoc, api.conversationId, context)
    return jobs?.items[id.trim()]
  }

  /** Refuse a call that brings in the user from a child session. */
  const childRefusal = (
    services: HostServices,
    conversationId: ConversationId
  ) => {
    const id = sessionIdOf(conversationId)
    if (!services.sessions.has(id)) return undefined
    const meta = services.sessions.meta(id)
    if (!meta.parent || meta.limits?.add?.includes("ask_user")) return undefined
    return 'A child session cannot call the user. Ask your parent session: end your turn with a message that starts with "Question:".'
  }

  /**
   * Start a job: the one implementation behind job_start and the terminal
   * tool's open action.
   */
  const startJob = async (
    api: ToolExecutionApi,
    context: Context,
    input: {
      command: string
      cwd?: string | undefined
      name?: string | undefined
      notifyOnExit: boolean
      waitMs: number
      interactive?: { prompt: string } | undefined
    }
  ) => {
    const services = await host.ready(context.abortSignal)
    if (input.interactive) {
      const refusal = childRefusal(services, api.conversationId)
      if (refusal) return { error: refusal }
    }
    const jobs = await api.snapshot(JobsDoc, api.conversationId, context)
    const running = Object.values(jobs?.items ?? {}).filter(
      (job) => job.status === "running"
    )
    if (running.length >= MAX_RUNNING_PER_SESSION)
      return {
        error: `This session already runs ${running.length} jobs. Stop one first.`,
      }
    const cwd = input.cwd?.trim() || (await cwdOf(api, context))
    const refusal = await childCommandRefusal(
      host,
      api.conversationId,
      input.command,
      cwd
    )
    if (refusal)
      return {
        error: `${refusal}. Ask your parent session: end your turn with a message that starts with "Question:".`,
      }
    const id = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const job: Job = {
      id,
      name: (input.name ?? input.command).trim().slice(0, 80),
      command: input.command,
      cwd,
      status: "running",
      startedAt: Date.now(),
      notifyOnExit: input.notifyOnExit,
      callId: api.callId,
      ...(input.interactive
        ? {
            focus: {
              prompt: input.interactive.prompt,
              at: Date.now(),
              inline: true,
            },
          }
        : {}),
    }
    await api.commit(async (tx) => {
      const draft = (await tx.doc(
        JobsDoc,
        api.conversationId
      )) as unknown as JobsState
      draft.items[id] = json(job)
      const index = await tx.doc(JobIndexDoc)
      index.running[id] = Number(api.conversationId)
    }, context)
    let pid: number
    try {
      pid = (await runner.start(services, api.conversationId, job)).pid
    } catch (error) {
      await changeJob(
        services.harness,
        api.conversationId,
        id,
        { status: "failed", endedAt: Date.now() },
        context,
        dataDir
      )
      return { error: error instanceof Error ? error.message : String(error) }
    }
    if (input.interactive) runner.markFocused(id)
    const exit = input.interactive
      ? await runner.waitForExit(id, 2_147_483_647, context.abortSignal)
      : await runner.waitForExit(id, input.waitMs)
    const output = await readJobLog(dataDir, id, input.interactive ? 40 : 30)
    const header = input.interactive
      ? exit
        ? `Job ${id} (${job.name}) exited with code ${exit.exitCode}.`
        : `The wait for job ${id} stopped. The job still runs.`
      : exit
        ? `Job ${id} exited at once with code ${exit.exitCode}.`
        : `Job ${id} is running (pid ${pid}).`
    return {
      id,
      job,
      pid,
      text: [
        header,
        output ? `Output${exit ? "" : " so far"}:\n${clip(output, 3000)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    }
  }

  const startTool = defineTool({
    name: "job_start",
    executionMode: "sequential",
    description: [
      "Start a long command in the background and return at once: dev servers, watchers, long builds or test runs.",
      "The user can watch it live in the terminal panel. Read its output with job_output, check it with job_status, and stop it with job_stop. Use the terminal tool to read its screen, wait for output, type into it, or bring in the user.",
      "With notify_on_exit (default true), you get a message with the exit code and the last output when it ends, also while you are busy (at your next turn boundary).",
      "With interactive, the command shows as a live terminal in the chat, where the user types (a login, a password, a choice that is the user's), and the call returns when the command exits. Give a short prompt for the user.",
    ].join(" "),
    parameters: Type.Object({
      command: Type.String(),
      cwd: Type.Optional(Type.String()),
      name: Type.Optional(Type.String({ description: "A short label" })),
      notify_on_exit: Type.Optional(Type.Boolean()),
      wait_ms: Type.Optional(
        Type.Number({
          description:
            "Wait this long for early output or failure (default 2000, max 30000)",
        })
      ),
      interactive: Type.Optional(Type.Boolean()),
      prompt: Type.Optional(
        Type.String({
          description:
            'With interactive: one short line for the user, for example "Log in to asahi"',
        })
      ),
    }),
    async execute(args, api, context) {
      const started = await startJob(api, context, {
        command: args.command,
        cwd: args.cwd,
        name: args.name,
        // An interactive call returns with the exit: no message after it.
        notifyOnExit: args.interactive ? false : (args.notify_on_exit ?? true),
        waitMs: Math.min(30_000, Math.max(0, args.wait_ms ?? 2000)),
        ...(args.interactive
          ? {
              interactive: {
                prompt:
                  args.prompt?.trim().slice(0, 200) || "Type in this terminal",
              },
            }
          : {}),
      })
      if ("error" in started) return errorResult(started.error ?? "")
      return textResult(started.text, {
        details: {
          id: started.id,
          pid: started.pid,
          command: started.job.command,
          ...(args.interactive ? { interactive: true } : {}),
        },
      })
    },
  })

  const statusTool = defineTool({
    name: "job_status",
    description:
      "Show background jobs of this session: all of them, or one by id with its last output lines.",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }),
    replay: "safe",
    async execute(args, api, context) {
      if (args.id) {
        const job = await jobFor(api, args.id, context)
        if (!job) return errorResult(`No job with id ${args.id}`)
        const output = await readJobLog(dataDir, job.id, 20)
        return textResult(
          `${describeJob(job)}${output ? `\nLast output:\n${clip(output, 3000)}` : ""}`
        )
      }
      const jobs = await api.snapshot(JobsDoc, api.conversationId, context)
      const items = Object.values(jobs?.items ?? {}).sort(
        (left, right) => left.startedAt - right.startedAt
      )
      return textResult(
        items.length > 0
          ? items.map((job) => describeJob(job)).join("\n")
          : "No jobs."
      )
    },
  })

  const outputTool = defineTool({
    name: "job_output",
    description:
      "Read the output of a background job: the last lines (tail, default 80), a line range (from_line), or only lines that match grep.",
    parameters: Type.Object({
      id: Type.String(),
      tail: Type.Optional(Type.Number()),
      from_line: Type.Optional(Type.Number()),
      grep: Type.Optional(Type.String()),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const job = await jobFor(api, args.id, context)
      if (!job) return errorResult(`No job with id ${args.id}`)
      const parts = jobLogParts(dataDir, job.id)
      let selected: string[]
      let note: string
      if (args.grep) {
        let pattern: RegExp
        try {
          pattern = new RegExp(args.grep, "i")
        } catch {
          return errorResult(`Invalid grep pattern: ${args.grep}`)
        }
        const matches: string[] = []
        let count = 0
        await scanLogLines(parts, (line, number) => {
          if (!pattern.test(line)) return
          count += 1
          matches.push(`${number}: ${line}`)
          if (matches.length > 200) matches.shift()
        })
        selected = matches
        note =
          count > matches.length
            ? `${count} matching lines, the last ${matches.length} shown`
            : `${count} matching line(s)`
      } else if (args.from_line !== undefined) {
        const start = Math.max(1, Math.floor(args.from_line))
        selected = []
        const total = await scanLogLines(parts, (line, number) => {
          if (number >= start && selected.length < 400) selected.push(line)
        })
        note = `lines ${start}-${start + selected.length - 1} of ${total}`
      } else {
        const count = Math.min(MAX_TAIL_LINES, Math.max(1, args.tail ?? 80))
        selected = readLogTailLines(parts, count)
        note = `last ${selected.length} lines`
      }
      return textResult(
        `${describeJob(job)}\n(${note})\n${clip(selected.join("\n"), 30_000)}`
      )
    },
  })

  const stopTool = defineTool({
    name: "job_stop",
    executionMode: "sequential",
    description: "Stop a background job (SIGTERM, then SIGKILL).",
    parameters: Type.Object({ id: Type.String() }),
    async execute(args, api, context) {
      const result = await stopJob(
        await host.ready(context.abortSignal),
        runner,
        api,
        api.conversationId,
        args.id.trim(),
        context
      )
      return result.ok
        ? textResult(`Stopping job ${args.id}.`)
        : errorResult(result.error)
    },
  })

  /** Wait for a job: the wait action of the terminal tool. */
  const waitJob = async (
    job: Job,
    args: {
      pattern?: string | undefined
      regex?: boolean | undefined
      new_only?: boolean | undefined
      timeout_ms?: number | undefined
    },
    context: Context
  ) => {
    let match: ((line: string) => boolean) | undefined
    if (args.pattern) {
      const pattern = args.pattern
      if (args.regex) {
        let expression: RegExp
        try {
          expression = new RegExp(pattern, "i")
        } catch {
          return errorResult(`Invalid pattern: ${pattern}`)
        }
        match = (line) => expression.test(line)
      } else match = (line) => line.includes(pattern)
    }
    const timeoutMs = Math.min(
      1_800_000,
      Math.max(0, args.timeout_ms ?? 60_000)
    )
    const result = await runner.waitFor(job.id, {
      ...(match ? { match } : {}),
      timeoutMs,
      ...(context.abortSignal ? { signal: context.abortSignal } : {}),
      ...(args.new_only ? { newOnly: true } : {}),
    })
    const output = await readJobLog(dataDir, job.id, 15)
    return textResult(
      [
        describeWait(job, result),
        output ? `Last output:\n${clip(output, 3000)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      { details: { id: job.id, result: result.type } }
    )
  }

  /** Bring the user to a job's terminal: the focus action. */
  const focusJob = async (
    api: ToolExecutionApi,
    job: Job,
    prompt: string,
    context: Context
  ) => {
    const services = await host.ready(context.abortSignal)
    const refusal = childRefusal(services, api.conversationId)
    if (refusal) return { error: refusal }
    if (job.status !== "running" || !runner.running(job.id))
      return { error: `Job ${job.id} does not run (${job.status}).` }
    const text = prompt.trim().slice(0, 200) || "Type in the terminal"
    await editRunningJob(
      api,
      api.conversationId,
      job.id,
      (draft) => {
        draft.focus = { prompt: text, at: Date.now() }
      },
      context
    )
    runner.markFocused(job.id)
    return {
      text: `Asked the user to type in the terminal of ${job.name}: "${text}". Pico shows the tab when the user opens this session, and sends a notification. Use the wait action to see the result.`,
    }
  }

  /** Refuse input when the terminal hides what is typed: only the user types secrets. */
  const secretRefusal = async (job: Job) => {
    const mode = await readTerminalMode(runner.device(job.id))
    if ((mode && !mode.echo && mode.icanon) || job.waiting?.secret)
      return "The terminal hides what is typed (echo is off): it asks for a password or secret. Only the user may type it: use the focus action."
    return undefined
  }

  const describeScreen = (
    label: string,
    view: Awaited<ReturnType<HostServices["terminals"]["readText"]>>
  ) => {
    const lines = view.lines.join("\n")
    const notes = [
      view.exited ? `exited with code ${view.exited.exitCode}` : "",
      "alternate" in view && view.alternate ? "full-screen program" : "",
      "cursor" in view && view.cursor
        ? `cursor at row ${view.cursor.row + 1}, column ${view.cursor.col + 1}`
        : "",
    ].filter(Boolean)
    return `${label}${notes.length ? ` (${notes.join(", ")})` : ""}:\n${clip(lines, 20_000) || "(empty)"}`
  }

  const terminalTool = defineTool({
    name: "terminal",
    description: [
      "Use terminals: your jobs (from job_start or open) and the user's terminal tabs of this session.",
      'Actions: list; open (a shell, or `command`, in a new terminal; it is a job); read (source visible: the screen now, for full-screen programs; recent: the last `lines` with scrollback); wait (until a line matches `pattern`, the job waits for input, or exits); send_text (type `text`, with `enter` to press Enter); send_keys (`keys`, for example ["up", "enter"] or ["ctrl+c"]); focus (bring the user to the terminal with `prompt`, only when the user is needed: a password, a login, a choice that is the user\'s); close (remove a finished job and its log).',
      "send_text and send_keys refuse when the terminal hides input: a secret is for the user. You can read the user's terminals, but not type in them.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(
        [
          "list",
          "open",
          "read",
          "wait",
          "send_text",
          "send_keys",
          "focus",
          "close",
        ].map((name) => Type.Literal(name))
      ),
      id: Type.Optional(
        Type.String({ description: "A job ID, or a user terminal ID (u-…)" })
      ),
      label: Type.Optional(Type.String({ description: "open: a short name" })),
      command: Type.Optional(
        Type.String({ description: "open: the command (default: a shell)" })
      ),
      cwd: Type.Optional(Type.String()),
      source: Type.Optional(
        Type.Union([Type.Literal("visible"), Type.Literal("recent")])
      ),
      lines: Type.Optional(
        Type.Number({ description: "read recent: lines (default 60)" })
      ),
      pattern: Type.Optional(Type.String()),
      regex: Type.Optional(Type.Boolean()),
      new_only: Type.Optional(Type.Boolean()),
      timeout_ms: Type.Optional(
        Type.Number({ description: "wait: default 60000, max 1800000" })
      ),
      text: Type.Optional(Type.String()),
      enter: Type.Optional(Type.Boolean()),
      keys: Type.Optional(
        Type.Array(Type.String(), { description: KEY_NAMES })
      ),
      prompt: Type.Optional(
        Type.String({
          description:
            'focus: one short line for the user, for example "Type your password for asahi"',
        })
      ),
      focus: Type.Optional(
        Type.Boolean({
          description:
            "open: bring the user to it at once (default false; only when the user is needed)",
        })
      ),
    }),
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const sessionId = sessionIdOf(api.conversationId)
      const shells = () => services.terminals.sessionShells(sessionId)
      const userShell = (id: string) =>
        id.startsWith("u-")
          ? shells().find((shell) => shell.id.startsWith(id.slice(2)))
          : undefined

      if (args.action === "list") {
        const jobs = await api.snapshot(JobsDoc, api.conversationId, context)
        const items = Object.values(jobs?.items ?? {})
          .sort((left, right) => right.startedAt - left.startedAt)
          .slice(0, 15)
        const lines = [
          ...items.map((job) => describeJob(job)),
          ...shells().map(
            (shell) =>
              `u-${shell.id.slice(0, 8)} (the user's ${shell.shell} tab in ${shell.cwd}) ${shell.exited ? `exited with code ${shell.exited.exitCode}` : "running"}; read only`
          ),
        ]
        return textResult(lines.length ? lines.join("\n") : "No terminals.")
      }

      if (args.action === "open") {
        const shell = !args.command?.trim()
        const label = args.label?.trim() || (shell ? "Shell" : undefined)
        const started = await startJob(api, context, {
          command: shell
            ? `exec '${loginShell().replace(/'/g, "'\\''")}' -l`
            : args.command!,
          cwd: args.cwd,
          name: label,
          notifyOnExit: !shell,
          waitMs: 1000,
        })
        if ("error" in started) return errorResult(started.error ?? "")
        let text = started.text
        if (args.focus) {
          const focused = await focusJob(
            api,
            started.job,
            args.prompt ?? `Use the terminal "${started.job.name}"`,
            context
          )
          text += `\n${"error" in focused ? focused.error : focused.text}`
        }
        return textResult(text, {
          details: { id: started.id, pid: started.pid },
        })
      }

      const id = args.id?.trim()
      if (!id) return errorResult("Give the terminal id (see the list action).")
      const shell = userShell(id)

      if (args.action === "read") {
        const source = args.source ?? "visible"
        const lines = Math.min(1000, Math.max(1, args.lines ?? 60))
        if (shell) {
          const view = await services.terminals.readText(
            shell.id,
            source,
            lines
          )
          return textResult(
            describeScreen(`The user's terminal ${id}, ${source}`, view)
          )
        }
        const job = await jobFor(api, id, context)
        if (!job) return errorResult(`No terminal with id ${id}`)
        const terminalId = services.terminals.jobTerminalId(job.id)
        if (!terminalId) {
          const output = await readJobLog(dataDir, job.id, lines)
          return textResult(
            `${describeJob(job)}\nThe end of its log:\n${clip(output, 20_000) || "(empty)"}`
          )
        }
        const view = await services.terminals.readText(
          terminalId,
          source,
          lines
        )
        return textResult(
          describeScreen(`${job.name} (${job.id}), ${source}`, view)
        )
      }

      if (shell)
        return errorResult(
          "That is the user's terminal: you can read it, but not wait on it, type in it, or close it. Open your own with the open action."
        )
      const job = await jobFor(api, id, context)
      if (!job) return errorResult(`No terminal with id ${id}`)

      if (args.action === "wait") return waitJob(job, args, context)
      if (args.action === "focus") {
        const focused = await focusJob(
          api,
          job,
          args.prompt ?? `Use the terminal "${job.name}"`,
          context
        )
        return "error" in focused
          ? errorResult(focused.error ?? "")
          : textResult(focused.text)
      }
      if (args.action === "close") {
        if (job.status === "running")
          return errorResult(
            `${job.name} (${job.id}) still runs. Stop it with job_stop first.`
          )
        await api.commit(async (tx) => {
          const draft = (await tx.doc(
            JobsDoc,
            api.conversationId
          )) as unknown as JobsState
          delete draft.items[job.id]
        }, context)
        deleteJobLog(dataDir, job.id)
        return textResult(`Closed ${job.name} (${job.id}) and deleted its log.`)
      }

      // send_text and send_keys
      const terminalId = services.terminals.jobTerminalId(job.id)
      if (job.status !== "running" || !terminalId || !runner.running(job.id))
        return errorResult(`${job.name} (${job.id}) does not run.`)
      let data: string
      if (args.action === "send_text") {
        if (args.text === undefined) return errorResult("Give the text.")
        data = args.text + (args.enter ? "\r" : "")
      } else {
        const keys = args.keys ?? []
        if (keys.length === 0) return errorResult("Give the keys.")
        const bytes = keys.map((key) => keyBytes(key))
        const unknown = keys.filter((_, index) => bytes[index] === undefined)
        if (unknown.length > 0)
          return errorResult(
            `Unknown keys: ${unknown.join(", ")}. Known: ${KEY_NAMES}.`
          )
        data = bytes.join("")
      }
      const secret = await secretRefusal(job)
      if (secret) return errorResult(secret)
      const settled = runner.settle(job.id)
      services.terminals.writeForAgent(terminalId, data)
      await settled
      const view = await services.terminals.readText(terminalId, "visible", 0)
      return textResult(
        describeScreen(`Sent. ${job.name} (${job.id}) now shows`, view)
      )
    },
  })

  return {
    runner,
    extension: defineExtension({
      name: "jobs",
      tools: [startTool, statusTool, outputTool, stopTool, terminalTool],
    }),
  }
}
