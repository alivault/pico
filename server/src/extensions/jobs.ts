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
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs"
import { readFile } from "node:fs/promises"
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
} from "@earendil-works/pi-durable"

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
  tail,
  textResult,
} from "./util.ts"

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
}

export type JobsState = { items: Record<string, Job> }

export const JobsDoc = defineDoc<JobsState>({
  kind: "pico.jobs",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {} }),
})

/** Running jobs of every session, so a restart can find the lost ones. */
export const JobIndexDoc = defineDoc<{ running: Record<string, number> }>({
  kind: "pico.jobs.index",
  version: 1,
  scope: "session",
  initial: () => ({ running: {} }),
})

const MAX_RUNNING_PER_SESSION = 8
const KEEP_FINISHED = 30
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI = new RegExp(
  [
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}[@-Z\\\\-_]`,
  ].join("|"),
  "g"
)

/** Terminal output as plain text: no escape codes, carriage returns applied. */
export function plainText(output: string) {
  return output
    .replace(ANSI, "")
    .split("\n")
    .map((line) => {
      const parts = line.replace(/\r$/, "").split("\r")
      return parts[parts.length - 1] ?? ""
    })
    .join("\n")
}

export function jobLogPath(dataDir: string, jobId: string) {
  return join(dataDir, "jobs", `${jobId}.log`)
}

export async function readJobLog(dataDir: string, jobId: string) {
  if (!/^[a-z0-9]+$/i.test(jobId)) throw new Error("Invalid job id")
  try {
    return plainText(await readFile(jobLogPath(dataDir, jobId), "utf8"))
  } catch {
    return ""
  }
}

function describeJob(job: Job, now = Date.now()) {
  const runtime = formatDuration((job.endedAt ?? now) - job.startedAt)
  const state =
    job.status === "running"
      ? `running for ${runtime}`
      : job.status === "exited"
        ? `exited with code ${job.exitCode} after ${runtime}`
        : `${job.status} after ${runtime}`
  return `${job.id} (${job.name}) ${state}: ${job.command}`
}

async function changeJob(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  jobId: string,
  change: Partial<Job>,
  context: Context
) {
  await harness.commit(async (tx) => {
    const draft = (await tx.doc(
      JobsDoc,
      conversationId
    )) as unknown as JobsState
    const job = draft.items[jobId]
    if (job) Object.assign(job, json(change))
    if (change.status && change.status !== "running") {
      const index = await tx.doc(JobIndexDoc)
      delete index.running[jobId]
      const finished = Object.values(draft.items)
        .filter((item) => item.status !== "running")
        .sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0))
      for (const old of finished.slice(
        0,
        Math.max(0, finished.length - KEEP_FINISHED)
      ))
        delete draft.items[old.id]
    }
  }, context)
}

/** Send a follow-up to the session of a conversation, or its replacement. */
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
    { type: "input", content: text, requestId, whenBusy: "followUp" },
    BACKGROUND_CONTEXT
  )
}

/** The jobs that run in this process, with their open log files. */
class JobRunner {
  readonly #dataDir: string
  readonly #logs = new Map<string, WriteStream>()
  readonly #exits = new Map<
    string,
    Promise<{ exitCode: number; signal?: number }>
  >()

  constructor(dataDir: string) {
    this.#dataDir = dataDir
  }

  async start(
    services: HostServices,
    conversationId: ConversationId,
    job: Job
  ) {
    mkdirSync(join(this.#dataDir, "jobs"), { recursive: true })
    const log = createWriteStream(jobLogPath(this.#dataDir, job.id), {
      flags: "a",
    })
    this.#logs.set(job.id, log)
    let resolveExit!: (exit: { exitCode: number; signal?: number }) => void
    this.#exits.set(
      job.id,
      new Promise((resolve) => {
        resolveExit = resolve
      })
    )
    const spawned = services.terminals.spawnJob(job.id, job.command, job.cwd, {
      onOutput: (data) => log.write(data),
      onExit: (exit) => {
        log.end()
        this.#logs.delete(job.id)
        resolveExit(exit)
        void this.#finished(services, conversationId, job, exit)
      },
    })
    return spawned
  }

  /** Wait up to `ms` for a job to exit; undefined when it still runs. */
  async waitForExit(jobId: string, ms: number) {
    const exit = this.#exits.get(jobId)
    if (!exit) return undefined
    return Promise.race([
      exit,
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), ms).unref()
      ),
    ])
  }

  async #finished(
    services: HostServices,
    conversationId: ConversationId,
    job: Job,
    exit: { exitCode: number; signal?: number }
  ) {
    this.#exits.delete(job.id)
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
        BACKGROUND_CONTEXT
      )
      if (job.notifyOnExit && !stopped) {
        const output = tail(
          (await readJobLog(this.#dataDir, job.id)).trimEnd(),
          40
        )
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

  /** The plain-text log of a job. */
  log(jobId: string) {
    return readJobLog(this.#dataDir, jobId)
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
        BACKGROUND_CONTEXT
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
  const runner = new JobRunner(dataDir)
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

  const startTool = defineTool({
    name: "job_start",
    description: [
      "Start a long command in the background and return at once: dev servers, watchers, long builds or test runs.",
      "The user can watch it live in the terminal panel. Read its output with job_output, check it with job_status, and stop it with job_stop.",
      "With notify_on_exit (default true), you get a message with the exit code and the last output when it ends.",
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
    }),
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      const jobs = await api.snapshot(JobsDoc, api.conversationId, context)
      const running = Object.values(jobs?.items ?? {}).filter(
        (job) => job.status === "running"
      )
      if (running.length >= MAX_RUNNING_PER_SESSION)
        return errorResult(
          `This session already runs ${running.length} jobs. Stop one first.`
        )
      const cwd = args.cwd?.trim() || (await cwdOf(api, context))
      const id = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const job: Job = {
        id,
        name: (args.name ?? args.command).trim().slice(0, 80),
        command: args.command,
        cwd,
        status: "running",
        startedAt: Date.now(),
        notifyOnExit: args.notify_on_exit ?? true,
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
          context
        )
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const waitMs = Math.min(30_000, Math.max(0, args.wait_ms ?? 2000))
      const exit = await runner.waitForExit(id, waitMs)
      const output = tail((await readJobLog(dataDir, id)).trimEnd(), 30)
      const header = exit
        ? `Job ${id} exited at once with code ${exit.exitCode}.`
        : `Job ${id} is running (pid ${pid}).`
      return textResult(
        [header, output ? `Output so far:\n${clip(output, 3000)}` : ""]
          .filter(Boolean)
          .join("\n"),
        { details: { id, pid, command: job.command } }
      )
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
        const output = tail((await readJobLog(dataDir, job.id)).trimEnd(), 20)
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
      const lines = (await readJobLog(dataDir, job.id)).trimEnd().split("\n")
      let selected: string[]
      let note: string
      if (args.grep) {
        let pattern: RegExp
        try {
          pattern = new RegExp(args.grep, "i")
        } catch {
          return errorResult(`Invalid grep pattern: ${args.grep}`)
        }
        selected = lines
          .map((line, index) => `${index + 1}: ${line}`)
          .filter((line) => pattern.test(line))
          .slice(-200)
        note = `${selected.length} matching line(s)`
      } else if (args.from_line !== undefined) {
        const start = Math.max(1, Math.floor(args.from_line))
        selected = lines.slice(start - 1, start - 1 + 400)
        note = `lines ${start}-${start + selected.length - 1} of ${lines.length}`
      } else {
        const count = Math.min(1000, Math.max(1, args.tail ?? 80))
        selected = lines.slice(-count)
        note = `last ${selected.length} of ${lines.length} lines`
      }
      return textResult(
        `${describeJob(job)}\n(${note})\n${clip(selected.join("\n"), 30_000)}`
      )
    },
  })

  const stopTool = defineTool({
    name: "job_stop",
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

  return {
    runner,
    extension: defineExtension({
      name: "jobs",
      tools: [startTool, statusTool, outputTool, stopTool],
    }),
  }
}
