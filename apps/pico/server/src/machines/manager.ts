/**
 * The machines of a hub: one connection state machine for each enabled
 * profile in `machines.json`.
 *
 *   connecting → online      SSH, forward, and manifest are good
 *   connecting → attention   auth, host key, stopped server, or old version
 *   connecting → offline     network error
 *   online     → offline     the probe fails two times, or the stream closes
 *   offline    → connecting  after a backoff (1 s … 2 min)
 *   attention  → connecting  every 30 s, on `reconnect`, or on a file change
 *
 * Background reconnects never ask for input, install, or start a server.
 * A slow or offline machine has no effect on the other machines: each
 * connection has its own timers, requests, and errors.
 */
import { request as httpRequest, type IncomingMessage } from "node:http"
import { connect as netConnect, type Socket } from "node:net"

import {
  findProfile,
  machineDir,
  readCache,
  readProfiles,
  watchProfiles,
  writeCache,
  writeProfiles,
  type MachineCache,
  type MachineProfile,
} from "./profiles.ts"
import {
  cacheFromDiscovery,
  discover,
  firstUrl,
  HUB_FEATURE,
  isAuthFailure,
  MIN_API_CONTRACT_VERSION,
  remoteStatus,
  type ConnectionProblem,
} from "./remote.ts"
import { SshTransport } from "./ssh.ts"
import { TransportError, type MachineTransport } from "./transport.ts"

export type MachineState =
  | "connecting"
  | "online"
  | "offline"
  | "attention"
  | "disabled"

/** One agent in a machine summary. */
export type AgentStatusSummary = {
  id: string
  title: string
  cwd: string
  /** The sidebar project of the agent. */
  project: string
  busy: boolean
  needsInput: boolean
  /** What an idle agent waits on: timers, watches, or jobs. */
  waiting?: string
  /** Nobody has read the last turn yet. Read state is the same for all clients. */
  unread?: boolean
  /**
   * The viewer contexts that did not see the last turn yet. Only from servers
   * before global read state.
   */
  unreadBy?: string[]
  parent?: string
  lastMessageAt?: number
  lastUserMessageAt?: number
}

/** What a server tells a hub about its agents. */
export type MachineSummary = {
  hostname: string
  version: string
  projects: string[]
  agents: AgentStatusSummary[]
}

export type MachineInfo = {
  id: string
  label: string
  target: string
  dataDir: string | null
  enabled: boolean
  state: MachineState
  /** When the machine got this state. */
  since: number
  problem?: ConnectionProblem
  /** When the next automatic attempt starts. */
  retryAt?: number
  version?: string
  features?: string[]
  /** The last known agents; kept while the machine is offline. */
  summary?: MachineSummary
}

/** An event of a remote machine that the hub acts on, for example a push. */
export type RemoteEvent = {
  machine: MachineInfo
  payload: { type: string; [key: string]: unknown }
}

export type TransportFactory = (profile: MachineProfile) => MachineTransport

/** Seconds between attempts after network errors. */
export const BACKOFF_SECONDS = [1, 2, 5, 15, 30, 60, 120]
/** A connection must stay online this long before fast retries start again. */
export const STABLE_MS = 60_000
export const ATTENTION_RETRY_MS = 30_000
export const PROBE_IDLE_MS = 20_000
export const PROBE_TIMEOUT_MS = 5_000

export type ManagerTimers = {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realTimers: ManagerTimers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms)
    handle.unref()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

/** The backoff delay after `failures` network failures in a row. */
export function backoffMs(failures: number) {
  return BACKOFF_SECONDS[Math.min(failures, BACKOFF_SECONDS.length - 1)]! * 1000
}

export class MachineError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

class ProblemError extends Error {
  readonly problem: ConnectionProblem
  constructor(problem: ConnectionProblem) {
    super(problem.message)
    this.problem = problem
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseSummary(value: unknown): MachineSummary | undefined {
  if (!isRecord(value) || !Array.isArray(value.agents)) return undefined
  return {
    hostname: typeof value.hostname === "string" ? value.hostname : "",
    version: typeof value.version === "string" ? value.version : "",
    projects: Array.isArray(value.projects)
      ? value.projects.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
    agents: value.agents.flatMap((entry): AgentStatusSummary[] => {
      if (!isRecord(entry) || typeof entry.id !== "string") return []
      return [
        {
          id: entry.id,
          title: typeof entry.title === "string" ? entry.title : entry.id,
          cwd: typeof entry.cwd === "string" ? entry.cwd : "",
          project:
            typeof entry.project === "string"
              ? entry.project
              : typeof entry.cwd === "string"
                ? entry.cwd
                : "",
          busy: entry.busy === true,
          needsInput: entry.needsInput === true,
          ...(typeof entry.waiting === "string" && entry.waiting
            ? { waiting: entry.waiting }
            : {}),
          ...(entry.unread === true ? { unread: true } : {}),
          ...(Array.isArray(entry.unreadBy)
            ? {
                unreadBy: entry.unreadBy.filter(
                  (id): id is string => typeof id === "string"
                ),
              }
            : {}),
          ...(typeof entry.parent === "string" ? { parent: entry.parent } : {}),
          ...(typeof entry.lastMessageAt === "number"
            ? { lastMessageAt: entry.lastMessageAt }
            : {}),
          ...(typeof entry.lastUserMessageAt === "number"
            ? { lastUserMessageAt: entry.lastUserMessageAt }
            : {}),
        },
      ]
    }),
  }
}

/** Split an SSE byte stream into events; comments count as data too. */
export class SseParser {
  #buffer = ""
  readonly #onEvent: (data: string) => void
  constructor(onEvent: (data: string) => void) {
    this.#onEvent = onEvent
  }
  push(chunk: string) {
    this.#buffer += chunk
    for (;;) {
      const end = /\r?\n\r?\n/.exec(this.#buffer)
      if (!end) return
      const block = this.#buffer.slice(0, end.index)
      this.#buffer = this.#buffer.slice(end.index + end[0].length)
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
      if (data) this.#onEvent(data)
    }
  }
}

export class MachineConnection {
  profile: MachineProfile
  readonly #dir: string
  readonly #transport: MachineTransport
  readonly #timers: ManagerTimers
  readonly #changed: () => void
  readonly #remoteEvent: (payload: RemoteEvent["payload"]) => void
  #state: MachineState = "connecting"
  #since: number
  #problem: ConnectionProblem | undefined
  #retryAt: number | undefined
  #version: string | undefined
  #features: string[] | undefined
  #summary: MachineSummary | undefined
  #failures = 0
  #onlineSince: number | undefined
  #lastDataAt = 0
  #probeFailures = 0
  #timer: unknown
  #probeTimer: unknown
  #attempt: AbortController | undefined
  #stream: IncomingMessage | undefined
  #closed = false

  constructor(options: {
    profile: MachineProfile
    machinesDir: string
    transport: MachineTransport
    timers: ManagerTimers
    changed: () => void
    remoteEvent: (payload: RemoteEvent["payload"]) => void
  }) {
    this.profile = options.profile
    this.#dir = machineDir(options.machinesDir, options.profile.id)
    this.#transport = options.transport
    this.#timers = options.timers
    this.#changed = options.changed
    this.#remoteEvent = options.remoteEvent
    this.#since = options.timers.now()
    this.#summary = undefined
  }

  get state() {
    return this.#state
  }

  get online() {
    return this.#state === "online"
  }

  info(): MachineInfo {
    return {
      id: this.profile.id,
      label: this.profile.label,
      target: this.profile.target,
      dataDir: this.profile.dataDir,
      enabled: this.profile.enabled,
      state: this.#state,
      since: this.#since,
      ...(this.#problem ? { problem: this.#problem } : {}),
      ...(this.#retryAt ? { retryAt: this.#retryAt } : {}),
      ...(this.#version ? { version: this.#version } : {}),
      ...(this.#features ? { features: this.#features } : {}),
      ...(this.#summary ? { summary: this.#summary } : {}),
    }
  }

  #setState(state: MachineState, problem?: ConnectionProblem) {
    const changed =
      state !== this.#state ||
      JSON.stringify(problem) !== JSON.stringify(this.#problem)
    if (state !== this.#state) this.#since = this.#timers.now()
    this.#state = state
    this.#problem = problem
    if (changed) this.#changed()
  }

  start() {
    if (this.#closed) return
    if (!this.profile.enabled) {
      this.#setState("disabled")
      return
    }
    this.#schedule(0)
  }

  /** Try now: after `pico-app machine reconnect`, or from the UI. */
  retryNow() {
    if (this.#closed || !this.profile.enabled) return
    if (this.#state === "online" || this.#attempt) return
    this.#failures = 0
    this.#schedule(0)
  }

  #schedule(ms: number) {
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer)
    this.#retryAt = ms > 0 ? this.#timers.now() + ms : undefined
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = undefined
      this.#retryAt = undefined
      void this.#connect()
    }, ms)
    if (ms > 0) this.#changed()
  }

  async #connect() {
    if (this.#closed || this.#attempt) return
    const attempt = new AbortController()
    this.#attempt = attempt
    this.#setState("connecting", this.#problem)
    try {
      await this.#transport.connect(attempt.signal)
      let cache = readCache(this.#dir)
      if (!cache.picoPath || !cache.nodeDir) {
        cache = cacheFromDiscovery(
          await discover(this.#transport, attempt.signal),
          cache
        )
        writeCache(this.#dir, cache)
      }
      const status = await this.#status(cache, attempt.signal)
      if (attempt.signal.aborted) return
      if (!status)
        throw new ProblemError({
          kind: "stopped",
          message: `Pico is not running on ${this.profile.label}.`,
        })
      await this.#transport.attach(status.port)
      writeCache(this.#dir, {
        ...readCache(this.#dir),
        port: status.port,
        version: status.version,
      })
      const manifest = (await this.request("GET", "/api/client/manifest", {
        timeoutMs: 10_000,
        allowOffline: true,
      })) as {
        version?: string
        apiContractVersion?: number
        capabilities?: { features?: string[] }
      }
      const features = manifest.capabilities?.features ?? []
      this.#version = manifest.version
      this.#features = features
      if (
        (manifest.apiContractVersion ?? 0) < MIN_API_CONTRACT_VERSION ||
        !features.includes(HUB_FEATURE)
      )
        throw new ProblemError({
          kind: "update",
          message: `Update Pico on ${this.profile.label} (it has ${manifest.version ?? "an old version"}).`,
        })
      const summary = parseSummary(
        await this.request("GET", "/api/machine/summary", {
          timeoutMs: 10_000,
          allowOffline: true,
        })
      )
      if (summary) this.#summary = summary
      await this.#openStream(attempt.signal)
      if (attempt.signal.aborted) return
      this.#onlineSince = this.#timers.now()
      this.#lastDataAt = this.#timers.now()
      this.#probeFailures = 0
      this.#setState("online")
      this.#scheduleProbe()
    } catch (error) {
      if (attempt.signal.aborted || this.#closed) return
      this.#failed(error)
    } finally {
      if (this.#attempt === attempt) this.#attempt = undefined
    }
  }

  async #status(cache: MachineCache, signal: AbortSignal) {
    try {
      return await remoteStatus(this.#transport, cache, this.profile, signal)
    } catch (error) {
      // The remote node or pico-app moved: search again one time.
      if (!(error instanceof TransportError) || error.code !== 127) throw error
      const found = cacheFromDiscovery(
        await discover(this.#transport, signal),
        cache
      )
      writeCache(this.#dir, found)
      if (!found.picoPath || !found.nodeDir)
        throw new ProblemError({
          kind: "setup",
          message: `pico-app or node 22.19+ was not found on ${this.profile.label}.`,
        })
      return remoteStatus(this.#transport, found, this.profile, signal)
    }
  }

  #failed(error: unknown) {
    this.#teardown()
    const problem = this.#classify(error)
    const now = this.#timers.now()
    if (this.#onlineSince !== undefined && now - this.#onlineSince >= STABLE_MS)
      this.#failures = 0
    this.#onlineSince = undefined
    if (problem.kind === "error") {
      const delay = backoffMs(this.#failures)
      this.#failures += 1
      this.#setState("offline", problem)
      this.#schedule(delay)
    } else {
      this.#setState("attention", problem)
      this.#schedule(ATTENTION_RETRY_MS)
    }
  }

  #classify(error: unknown): ConnectionProblem {
    if (error instanceof ProblemError) return error.problem
    const reconnect = `pico-app machine reconnect ${this.profile.label}`
    if (error instanceof TransportError) {
      const text = `${error.message}\n${error.stderr}`
      const url = firstUrl(text)
      if (error.code === 127 && /ssh command/.test(error.message))
        return { kind: "setup", message: error.message }
      if (error.code === 255 && isAuthFailure(text))
        return {
          kind: "auth",
          message: `SSH needs your input for ${this.profile.label}. Run: ${reconnect}`,
          ...(error.stderr ? { detail: error.stderr } : {}),
          ...(url ? { url } : {}),
        }
      return {
        kind: "error",
        message: error.message,
        ...(error.stderr ? { detail: error.stderr } : {}),
      }
    }
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    }
  }

  #teardown() {
    this.#attempt?.abort()
    this.#attempt = undefined
    if (this.#probeTimer !== undefined)
      this.#timers.clearTimeout(this.#probeTimer)
    this.#probeTimer = undefined
    const stream = this.#stream
    this.#stream = undefined
    stream?.destroy()
  }

  /** The connection broke. Keep the summary and try again later. */
  #lost(message: string) {
    if (this.#closed || this.#state !== "online") return
    this.#failed(new Error(message))
  }

  #scheduleProbe() {
    this.#probeTimer = this.#timers.setTimeout(() => {
      this.#probeTimer = undefined
      void this.#probe()
    }, 5000)
  }

  async #probe() {
    if (this.#state !== "online") return
    if (this.#timers.now() - this.#lastDataAt >= PROBE_IDLE_MS) {
      try {
        await this.request("GET", "/api/system/health", {
          timeoutMs: PROBE_TIMEOUT_MS,
        })
        this.#probeFailures = 0
      } catch {
        this.#probeFailures += 1
        if (this.#probeFailures >= 2) {
          this.#lost(`${this.profile.label} does not answer`)
          return
        }
      }
    }
    if (this.#state === "online") this.#scheduleProbe()
  }

  /** Data came from the remote server. */
  activity() {
    this.#lastDataAt = this.#timers.now()
  }

  #openStream(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const request = httpRequest({
        ...this.#transport.endpoint(),
        agent: this.#transport.agent(),
        method: "GET",
        path: "/api/machine/events",
        headers: { host: "127.0.0.1", accept: "text/event-stream" },
      })
      const abort = () => request.destroy(new Error("Aborted"))
      signal.addEventListener("abort", abort, { once: true })
      request.once("error", (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      })
      request.once("response", (response) => {
        signal.removeEventListener("abort", abort)
        if (response.statusCode !== 200) {
          response.resume()
          reject(
            new Error(`The machine event stream failed: ${response.statusCode}`)
          )
          return
        }
        this.#stream = response
        response.setEncoding("utf8")
        const parser = new SseParser((data) => this.#onStreamEvent(data))
        response.on("data", (chunk: string) => {
          this.activity()
          parser.push(chunk)
        })
        const closed = () => {
          if (this.#stream !== response) return
          this.#stream = undefined
          this.#lost(`The connection to ${this.profile.label} closed`)
        }
        response.once("end", closed)
        response.once("close", closed)
        response.once("error", closed)
        resolve()
      })
      request.end()
    })
  }

  #onStreamEvent(data: string) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(payload) || typeof payload.type !== "string") return
    if (payload.type === "machine_summary") {
      const summary = parseSummary(payload.summary)
      if (summary) {
        this.#summary = summary
        this.#changed()
      }
      return
    }
    this.#remoteEvent(payload as RemoteEvent["payload"])
  }

  /**
   * A JSON request to the remote server. It fails at once when the machine
   * is not online; it never retries.
   */
  request(
    method: string,
    path: string,
    options: { body?: unknown; timeoutMs?: number; allowOffline?: boolean } = {}
  ): Promise<unknown> {
    if (!options.allowOffline && this.#state !== "online")
      return Promise.reject(
        new MachineError(503, `${this.profile.label} is ${this.#state}`)
      )
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body)
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          ...this.#transport.endpoint(),
          agent: this.#transport.agent(),
          method,
          path,
          headers: {
            host: "127.0.0.1",
            accept: "application/json",
            ...(body
              ? {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(body),
                }
              : {}),
          },
          timeout: options.timeoutMs ?? 30_000,
        },
        (response) => {
          let text = ""
          response.setEncoding("utf8")
          response.on("data", (chunk: string) => {
            text += chunk
          })
          response.once("end", () => {
            this.activity()
            let data: unknown
            try {
              data = text ? JSON.parse(text) : {}
            } catch {
              reject(
                new MachineError(
                  502,
                  `${this.profile.label} sent a bad answer to ${path}`
                )
              )
              return
            }
            const status = response.statusCode ?? 502
            if (status >= 400 || (isRecord(data) && data.ok === false)) {
              reject(
                new MachineError(
                  status >= 400 ? status : 502,
                  isRecord(data) && typeof data.error === "string"
                    ? data.error
                    : `${path} failed with ${status}`
                )
              )
              return
            }
            resolve(data)
          })
          response.once("error", reject)
        }
      )
      request.once("timeout", () =>
        request.destroy(
          new MachineError(504, `${this.profile.label} did not answer in time`)
        )
      )
      request.once("error", reject)
      request.end(body)
    })
  }

  /** The endpoint for the proxy. Throws when the machine is not online. */
  endpoint() {
    if (this.#state !== "online")
      throw new MachineError(503, `${this.profile.label} is ${this.#state}`)
    return {
      endpoint: this.#transport.endpoint(),
      agent: this.#transport.agent(),
    }
  }

  /** A raw socket to the remote server, for WebSocket upgrades. */
  socket(): Socket {
    const endpoint = this.endpoint().endpoint
    return "socketPath" in endpoint
      ? netConnect(endpoint.socketPath)
      : netConnect(endpoint.port, endpoint.host)
  }

  /** Apply a changed profile. A new target or data directory reconnects. */
  update(profile: MachineProfile) {
    const previous = this.profile
    this.profile = profile
    if (previous.enabled !== profile.enabled) {
      if (profile.enabled) {
        this.#failures = 0
        this.#schedule(0)
      } else void this.disable()
      return
    }
    if (
      previous.target !== profile.target ||
      previous.dataDir !== profile.dataDir
    )
      return "replace" as const
    if (this.#state === "attention") this.retryNow()
    if (previous.label !== profile.label) this.#changed()
    return undefined
  }

  async disable() {
    this.#teardown()
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer)
    this.#timer = undefined
    this.#retryAt = undefined
    this.#setState("disabled")
    await this.#transport.close({ exit: true }).catch(() => undefined)
  }

  /** Stop. `exit` also stops the SSH master (remove or disable). */
  async close(options: { exit?: boolean } = {}) {
    this.#closed = true
    this.#teardown()
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer)
    this.#timer = undefined
    await this.#transport.close(options).catch(() => undefined)
  }
}

export type MachineManagerOptions = {
  machinesFile: string
  machinesDir: string
  transport?: TransportFactory
  timers?: ManagerTimers
  /** Watch the file for changes; tests turn it off. */
  watch?: boolean
}

export class MachineManager {
  readonly #options: MachineManagerOptions
  readonly #timers: ManagerTimers
  readonly #connections = new Map<string, MachineConnection>()
  readonly #listeners = new Set<() => void>()
  readonly #remoteListeners = new Set<(event: RemoteEvent) => void>()
  #fileError: string | undefined
  #unwatch: (() => void) | undefined
  #closed = false

  constructor(options: MachineManagerOptions) {
    this.#options = options
    this.#timers = options.timers ?? realTimers
  }

  start() {
    this.reload()
    if (this.#options.watch !== false)
      this.#unwatch = watchProfiles(this.#options.machinesFile, () =>
        this.reload()
      )
  }

  /** A notice when `machines.json` is bad. The connections stay as they are. */
  get fileError() {
    return this.#fileError
  }

  #transport(profile: MachineProfile) {
    return (
      this.#options.transport?.(profile) ??
      new SshTransport({ profile, machinesDir: this.#options.machinesDir })
    )
  }

  #create(profile: MachineProfile) {
    const connection: MachineConnection = new MachineConnection({
      profile,
      machinesDir: this.#options.machinesDir,
      transport: this.#transport(profile),
      timers: this.#timers,
      changed: () => this.#emit(),
      remoteEvent: (payload) => {
        for (const listener of this.#remoteListeners) {
          try {
            listener({ machine: connection.info(), payload })
          } catch (error) {
            console.error("[pico] machine event listener failed:", error)
          }
        }
      },
    })
    this.#connections.set(profile.id, connection)
    connection.start()
    return connection
  }

  /** Read `machines.json` again and apply the changes. */
  reload() {
    if (this.#closed) return
    let profiles: MachineProfile[]
    try {
      profiles = readProfiles(this.#options.machinesFile)
    } catch (error) {
      const message = `machines.json is not valid: ${error instanceof Error ? error.message : String(error)}`
      if (message !== this.#fileError) {
        this.#fileError = message
        console.warn(`[pico] ${message}`)
        this.#emit()
      }
      return
    }
    this.#fileError = undefined
    const wanted = new Map(profiles.map((profile) => [profile.id, profile]))
    for (const [id, connection] of this.#connections) {
      if (!wanted.has(id)) {
        this.#connections.delete(id)
        void connection.close({ exit: true })
      }
    }
    for (const profile of profiles) {
      const existing = this.#connections.get(profile.id)
      if (!existing) {
        this.#create(profile)
        continue
      }
      if (JSON.stringify(existing.profile) === JSON.stringify(profile)) continue
      if (existing.update(profile) === "replace") {
        void existing.close({ exit: true })
        this.#create(profile)
      }
    }
    this.#emit()
  }

  list(): MachineInfo[] {
    return [...this.#connections.values()].map((connection) =>
      connection.info()
    )
  }

  /** A connection by ID or label. */
  find(idOrLabel: string) {
    const direct = this.#connections.get(idOrLabel)
    if (direct) return direct
    const wanted = idOrLabel.trim().toLowerCase()
    return [...this.#connections.values()].find(
      (connection) => connection.profile.label.toLowerCase() === wanted
    )
  }

  get(id: string) {
    return this.#connections.get(id)
  }

  /** Change the profiles file; the watcher and `reload` apply it. */
  edit(change: (profiles: MachineProfile[]) => MachineProfile[]) {
    const profiles = readProfiles(this.#options.machinesFile)
    writeProfiles(this.#options.machinesFile, change(profiles))
    this.reload()
  }

  setEnabled(idOrLabel: string, enabled: boolean) {
    this.edit((profiles) => {
      const profile = findProfile(profiles, idOrLabel)
      if (!profile) throw new MachineError(404, `Unknown machine: ${idOrLabel}`)
      profile.enabled = enabled
      return profiles
    })
  }

  rename(idOrLabel: string, label: string) {
    const trimmed = label.trim()
    if (!trimmed) throw new MachineError(400, "The label is empty")
    this.edit((profiles) => {
      const profile = findProfile(profiles, idOrLabel)
      if (!profile) throw new MachineError(404, `Unknown machine: ${idOrLabel}`)
      profile.label = trimmed.slice(0, 64)
      return profiles
    })
  }

  remove(idOrLabel: string) {
    this.edit((profiles) => {
      const profile = findProfile(profiles, idOrLabel)
      if (!profile) throw new MachineError(404, `Unknown machine: ${idOrLabel}`)
      return profiles.filter((entry) => entry.id !== profile.id)
    })
  }

  retry(idOrLabel: string) {
    const connection = this.find(idOrLabel)
    if (!connection)
      throw new MachineError(404, `Unknown machine: ${idOrLabel}`)
    connection.retryNow()
  }

  /** Call after any change of a machine's state or summary. */
  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  onRemoteEvent(listener: (event: RemoteEvent) => void) {
    this.#remoteListeners.add(listener)
    return () => {
      this.#remoteListeners.delete(listener)
    }
  }

  #emit() {
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch (error) {
        console.error("[pico] machine listener failed:", error)
      }
    }
  }

  async close() {
    this.#closed = true
    this.#unwatch?.()
    const connections = [...this.#connections.values()]
    this.#connections.clear()
    // Keep the SSH masters: a restarted hub connects again at once.
    await Promise.all(connections.map((connection) => connection.close()))
  }
}
