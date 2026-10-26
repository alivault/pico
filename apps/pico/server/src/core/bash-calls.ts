/**
 * Running bash tool calls, and a watchdog that finds the ones that hang.
 *
 * The bash tool (see `coding-tools.ts`) registers each call here with its
 * command, its start time, and the time of its last output. Each call runs
 * with `PICO_TOOL_CALL=<marker>` in its environment, so the watchdog can find
 * its processes (Linux: `/proc/<pid>/environ`) and read their CPU time and
 * I/O.
 *
 * A call of a child session that runs longer than `STALL_MS` with no new
 * output, and whose processes use almost no CPU or I/O in the last check
 * interval, is reported one time to the parent session. It probably waits
 * for input (an editor or a prompt) or for something that does not come.
 */
import { readdir, readFile } from "node:fs/promises"

import type { HostBridge } from "../extensions/host.ts"

/** Time with no output before a call can count as stalled. */
export const STALL_MS = 10 * 60_000
/** How often the watchdog looks at the running calls. */
export const CHECK_MS = 60_000
/** Less CPU time (ms) than this in one check interval is "almost no CPU". */
const IDLE_CPU_MS = 500
/** Less I/O (bytes) than this in one check interval is "almost no I/O". */
const IDLE_IO_BYTES = 256 * 1024
/** Clock ticks per second of `/proc/<pid>/stat` (USER_HZ, 100 on Linux). */
const USER_HZ = 100

export type ProcessSample = {
  at: number
  /** CPU time (ms) and I/O bytes of each process, by PID. */
  processes: Map<number, { cpuMs: number; io: number; command: string }>
}

export type BashCall = {
  sessionId: string
  callId: string
  command: string
  marker: string
  startedAt: number
  lastOutputAt: number
  sample?: ProcessSample
  reported?: boolean
}

const calls = new Map<string, BashCall>()

function key(sessionId: string, callId: string) {
  return `${sessionId}\u0000${callId}`
}

/** Start to track a bash call. Returns the call; give it to `endBashCall`. */
export function startBashCall(input: {
  sessionId: string
  callId: string
  command: string
  now?: number
}): BashCall {
  const now = input.now ?? Date.now()
  const call: BashCall = {
    sessionId: input.sessionId,
    callId: input.callId,
    command: input.command,
    marker: `${input.sessionId}/${input.callId}/${now}`,
    startedAt: now,
    lastOutputAt: now,
  }
  calls.set(key(input.sessionId, input.callId), call)
  return call
}

export function endBashCall(call: BashCall) {
  const id = key(call.sessionId, call.callId)
  if (calls.get(id) === call) calls.delete(id)
}

/** The running bash call of a session with this call ID. */
export function bashCall(sessionId: string, callId: string) {
  return calls.get(key(sessionId, callId))
}

/** All running bash calls. */
export function bashCalls(): BashCall[] {
  return [...calls.values()]
}

/** A duration such as `45s`, `12 min`, or `1 h 51 min`. */
export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** The first line of a command, shortened for a status line. */
export function commandLine(command: string, max = 200) {
  const lines = command.trim().split("\n")
  const first = lines[0] ?? ""
  const text = lines.length > 1 ? `${first} …` : first
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

async function readProcess(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    const close = stat.lastIndexOf(")")
    const command = stat.slice(stat.indexOf("(") + 1, close)
    // Fields after the command, from field 3 (state): utime is field 14,
    // stime 15, cutime 16, cstime 17. cutime and cstime count children that
    // ended, so short-lived subprocesses count as activity.
    const fields = stat
      .slice(close + 2)
      .split(" ")
      .map((value) => Number(value))
    const ticks =
      (fields[11] ?? 0) +
      (fields[12] ?? 0) +
      (fields[13] ?? 0) +
      (fields[14] ?? 0)
    let io = 0
    try {
      const text = await readFile(`/proc/${pid}/io`, "utf8")
      for (const match of text.matchAll(/^(?:rchar|wchar): (\d+)$/gm))
        io += Number(match[1])
    } catch {
      // Not readable: count no I/O.
    }
    return { cpuMs: (ticks * 1000) / USER_HZ, io, command }
  } catch {
    return undefined
  }
}

/**
 * The processes of each marker, with their CPU time and I/O. Linux only;
 * undefined on other platforms.
 */
export async function sampleProcesses(
  markers: string[]
): Promise<Map<string, ProcessSample> | undefined> {
  if (process.platform !== "linux") return undefined
  const result = new Map<string, ProcessSample>()
  const wanted = new Map(
    markers.map((marker) => [`PICO_TOOL_CALL=${marker}`, marker])
  )
  for (const marker of markers)
    result.set(marker, { at: Date.now(), processes: new Map() })
  let names: string[]
  try {
    names = await readdir("/proc")
  } catch {
    return undefined
  }
  await Promise.all(
    names
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        const pid = Number(name)
        if (pid === process.pid) return
        let environ: string
        try {
          environ = await readFile(`/proc/${pid}/environ`, "utf8")
        } catch {
          return
        }
        for (const entry of environ.split("\0")) {
          const marker = wanted.get(entry)
          if (marker === undefined) continue
          const info = await readProcess(pid)
          if (info) result.get(marker)!.processes.set(pid, info)
          return
        }
      })
  )
  return result
}

/**
 * Whether the processes were almost idle from `before` to `after`. A process
 * that is new in `after` counts as activity.
 */
export function almostIdle(before: ProcessSample, after: ProcessSample) {
  let cpu = 0
  let io = 0
  for (const [pid, now] of after.processes) {
    const then = before.processes.get(pid)
    if (!then || then.command !== now.command) return false
    cpu += Math.max(0, now.cpuMs - then.cpuMs)
    io += Math.max(0, now.io - then.io)
  }
  return cpu < IDLE_CPU_MS && io < IDLE_IO_BYTES
}

/** The message to the parent about a call that seems to hang. */
export function stallMessage(input: {
  sessionId: string
  title?: string
  command: string
  ranMs: number
  silentMs: number
  pids: Array<{ pid: number; command: string }> | undefined
}) {
  const pids =
    input.pids === undefined
      ? "unknown (Pico reads processes only on Linux)"
      : input.pids.length === 0
        ? "none found"
        : input.pids.map((item) => `${item.pid} (${item.command})`).join(", ")
  return [
    `Session ${input.sessionId}${input.title ? ` (${input.title})` : ""} may hang: one bash call has run for ${formatDuration(input.ranMs)}, with no new output for ${formatDuration(input.silentMs)}${input.pids === undefined ? "" : " and almost no CPU or I/O"}.`,
    `Command: ${commandLine(input.command, 500)}`,
    `PIDs: ${pids}`,
    `It may wait for input (an editor or a prompt). To stop the call, stop the session (sessions action stop) or kill the PIDs, then tell the session what to do.`,
  ].join("\n")
}

/**
 * Look at the running calls one time: report the calls of child sessions
 * that seem to hang. Returns the reported calls.
 */
export async function checkBashCalls(
  host: HostBridge,
  options: {
    now?: number
    stallMs?: number
    sample?: typeof sampleProcesses
  } = {}
) {
  const services = host.current
  if (!services) return []
  const now = options.now ?? Date.now()
  const stallMs = options.stallMs ?? STALL_MS
  const sample = options.sample ?? sampleProcesses
  const candidates = bashCalls().filter((call) => {
    if (call.reported || !services.sessions.has(call.sessionId)) return false
    if (!services.sessions.meta(call.sessionId).parent) return false
    // Start to sample one interval early, so a sample is there to compare.
    return now - call.lastOutputAt >= stallMs - CHECK_MS
  })
  if (candidates.length === 0) return []
  const samples = await sample(candidates.map((call) => call.marker))
  const reported: BashCall[] = []
  for (const call of candidates) {
    const current = samples?.get(call.marker)
    const before = call.sample
    if (current) call.sample = current
    const silentMs = now - call.lastOutputAt
    if (silentMs < stallMs) continue
    if (current && (!before || !almostIdle(before, current))) continue
    const parent = services.sessions.meta(call.sessionId).parent
    if (!parent || !services.sessions.has(parent)) continue
    call.reported = true
    reported.push(call)
    const title = services.sessions
      .list({ parent })
      .find((item) => item.id === call.sessionId)?.title
    await services.sessions
      .followUp(
        parent,
        stallMessage({
          sessionId: call.sessionId,
          ...(title ? { title } : {}),
          command: call.command,
          ranMs: now - call.startedAt,
          silentMs,
          pids: current
            ? [...current.processes].map(([pid, info]) => ({
                pid,
                command: info.command,
              }))
            : undefined,
        }),
        `stall:${call.sessionId}:${call.callId}`
      )
      .catch((error: unknown) => {
        console.warn("[pico] could not report a stalled bash call:", error)
      })
  }
  return reported
}

let watchdog: NodeJS.Timeout | undefined

/** Check the running calls every `CHECK_MS` while there are any. */
export function ensureWatchdog(host: HostBridge) {
  if (watchdog) return
  let checking = false
  watchdog = setInterval(() => {
    if (calls.size === 0) {
      clearInterval(watchdog)
      watchdog = undefined
      return
    }
    if (checking) return
    checking = true
    void checkBashCalls(host).finally(() => {
      checking = false
    })
  }, CHECK_MS)
  watchdog.unref()
}
