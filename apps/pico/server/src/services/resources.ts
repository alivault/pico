/**
 * What uses memory on this machine for Pico: the server, the pty-host, each
 * running job (with all its child processes), and the agent browser. The
 * machine API serves it (`/api/resources`), so a hub can show remote machines
 * too.
 *
 * `MemoryPressure` watches the kernel's pressure numbers (Linux) and frees
 * what Pico can give back without harm. It never stops a job.
 */
import { freemem, totalmem } from "node:os"

import type { BrowserManager } from "./browser.ts"
import type { Notifier } from "./notify.ts"
import {
  memoryPressure,
  processTable,
  scopeMemory,
  treeOf,
  treeRss,
} from "./process-tree.ts"
import type { Terminals } from "./terminal.ts"

type LiveJobs = () => Array<{
  id: string
  name: string
  command: string
  startedAt: number
  sessionId: string
}>

export type ResourceDeps = {
  terminals: Pick<Terminals, "jobPid" | "stats" | "trimMemory">
  jobs: () => Array<{
    id: string
    name: string
    command: string
    startedAt: number
    sessionId: string
  }>
  browser?: BrowserManager | undefined
}

export type JobResource = {
  id: string
  name: string
  command: string
  sessionId: string
  startedAt: number
  pid?: number
  /** The memory of the job and every process it started, in bytes. */
  memory?: number
  /** The number comes from the job's own scope (exact). */
  scoped: boolean
  processes: number
}

export async function jobResources(deps: {
  terminals: Pick<Terminals, "jobPid">
  jobs: LiveJobs
}) {
  const table = await processTable()
  const jobs: JobResource[] = []
  for (const job of deps.jobs()) {
    const pid = deps.terminals.jobPid(job.id)
    const scoped = pid ? await scopeMemory(pid) : undefined
    const tree = pid ? treeOf(table, pid) : []
    jobs.push({
      ...job,
      ...(pid ? { pid } : {}),
      ...(scoped !== undefined
        ? { memory: scoped }
        : pid && tree.length
          ? { memory: treeRss(table, pid) }
          : {}),
      scoped: scoped !== undefined,
      processes: tree.length,
    })
  }
  return { table, jobs: jobs.sort((a, b) => (b.memory ?? 0) - (a.memory ?? 0)) }
}

export async function collectResources(deps: ResourceDeps) {
  const { table, jobs } = await jobResources(deps)
  const usage = process.memoryUsage()
  const terminals = await deps.terminals.stats()
  const browserTree = [...table.values()]
    .filter(
      (row) =>
        row.ppid === process.pid && /chrom|headless_shell/i.test(row.command)
    )
    .reduce((sum, row) => sum + treeRss(table, row.pid), 0)
  return {
    machine: {
      total: totalmem(),
      free: freemem(),
      pressure: await memoryPressure(),
    },
    server: {
      pid: process.pid,
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      uptime: Math.round(process.uptime()),
    },
    ptyHost: terminals.host
      ? {
          pid: terminals.host.pid,
          rss: table.get(terminals.host.pid)?.rss ?? terminals.host.rss,
        }
      : undefined,
    terminals: {
      backend: terminals.backend,
      ...(terminals.fallback ? { fallback: terminals.fallback } : {}),
      shells: terminals.shells,
      jobs: terminals.jobs,
      exited: terminals.exited,
      screens: terminals.screens,
      backlogBytes: terminals.backlogBytes,
    },
    jobs,
    browser: deps.browser
      ? { ...deps.browser.stats, rss: browserTree }
      : undefined,
  }
}

export type Resources = Awaited<ReturnType<typeof collectResources>>

const CHECK_MS = 10_000
/** Pressure starts when tasks wait for memory this share of the time. */
const SOME_HIGH = 20
const FULL_HIGH = 5
/** And ends below this. */
const SOME_LOW = 5
const NOTIFY_EVERY_MS = 30 * 60 * 1000

export function formatBytes(bytes: number | undefined) {
  if (bytes === undefined) return "?"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export type PressureDeps = ResourceDeps & {
  dropTranscripts: () => number
  notifier?: Notifier | undefined
  sessionLink: (sessionId: string) => string
}

/** Watches memory pressure and frees what Pico can give back. */
export class MemoryPressure {
  readonly #deps: PressureDeps
  readonly #read: typeof memoryPressure
  #timer: NodeJS.Timeout | undefined
  #active = false
  #notifiedAt = 0

  constructor(
    deps: PressureDeps,
    read: typeof memoryPressure = memoryPressure
  ) {
    this.#deps = deps
    this.#read = read
  }

  start() {
    if (process.platform !== "linux") return
    this.#timer = setInterval(() => void this.check(), CHECK_MS)
    this.#timer.unref()
  }

  stop() {
    clearInterval(this.#timer)
  }

  /** One check; returns what it did, for tests. */
  async check() {
    const pressure = await this.#read()
    if (!pressure) return undefined
    const high = pressure.some >= SOME_HIGH || pressure.full >= FULL_HIGH
    if (!high) {
      if (pressure.some < SOME_LOW) this.#active = false
      return undefined
    }
    if (this.#active) return undefined
    this.#active = true
    return this.relieve()
  }

  /** Free idle things, then tell the user which jobs use the most. */
  async relieve() {
    const freed = {
      browserContexts: 0,
      terminals: this.#deps.terminals.trimMemory(),
      transcripts: this.#deps.dropTranscripts(),
    }
    if (this.#deps.browser) {
      const before = this.#deps.browser.stats.contexts
      await this.#deps.browser.closeIdle(Date.now(), 60_000)
      freed.browserContexts = before - this.#deps.browser.stats.contexts
    }
    const { jobs } = await jobResources(this.#deps)
    const heavy = jobs.filter((job) => job.memory !== undefined).slice(0, 3)
    let notified = false
    if (
      heavy.length > 0 &&
      this.#deps.notifier &&
      Date.now() - this.#notifiedAt > NOTIFY_EVERY_MS
    ) {
      this.#notifiedAt = Date.now()
      notified = true
      await this.#deps.notifier
        .send({
          title: "Pico: the machine is low on memory",
          body: `Jobs that use the most: ${heavy
            .map((job) => `${job.name} (${formatBytes(job.memory)})`)
            .join(", ")}. Pico does not stop them.`,
          url: this.#deps.sessionLink(heavy[0]!.sessionId),
          tag: "memory-pressure",
          level: "warning",
        })
        .catch(() => undefined)
    }
    return { freed, heavy, notified }
  }
}
