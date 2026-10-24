/**
 * Memory of processes and their children, for the resource view and for
 * memory pressure. `ps` works on Linux and macOS; on Linux, a job in its own
 * systemd scope reads the exact number from its cgroup.
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"

export type ProcessRow = {
  pid: number
  ppid: number
  /** Resident memory in bytes. */
  rss: number
  command: string
}

function run(file: string, args: string[]) {
  return new Promise<string>((resolve) => {
    execFile(
      file,
      args,
      { timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? "" : stdout)
    )
  })
}

/** All processes of the machine; empty when `ps` is not there. */
export async function processTable() {
  const table = new Map<number, ProcessRow>()
  if (process.platform === "win32") return table
  const output = await run("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="])
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    table.set(pid, {
      pid,
      ppid: Number(match[2]),
      rss: Number(match[3]) * 1024,
      command: match[4]!.trim(),
    })
  }
  return table
}

/** A process and all its descendants. */
export function treeOf(table: Map<number, ProcessRow>, root: number) {
  const children = new Map<number, number[]>()
  for (const row of table.values()) {
    const list = children.get(row.ppid) ?? []
    list.push(row.pid)
    children.set(row.ppid, list)
  }
  const result: number[] = []
  const stack = [root]
  const seen = new Set<number>()
  while (stack.length > 0) {
    const pid = stack.pop()!
    if (seen.has(pid) || !table.has(pid)) continue
    seen.add(pid)
    result.push(pid)
    stack.push(...(children.get(pid) ?? []))
  }
  return result
}

export function treeRss(table: Map<number, ProcessRow>, root: number) {
  return treeOf(table, root).reduce(
    (sum, pid) => sum + (table.get(pid)?.rss ?? 0),
    0
  )
}

/**
 * The memory of the systemd scope of a process, when it is in one of Pico's
 * job scopes (Linux, cgroup v2); undefined otherwise.
 */
export async function scopeMemory(pid: number) {
  if (process.platform !== "linux") return undefined
  try {
    const cgroup = (await readFile(`/proc/${pid}/cgroup`, "utf8"))
      .trim()
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3)
    if (!cgroup || !/\/pico-job-[^/]+\.scope$/.test(cgroup)) return undefined
    const value = await readFile(
      `/sys/fs/cgroup${cgroup}/memory.current`,
      "utf8"
    )
    return Number(value.trim()) || undefined
  } catch {
    return undefined
  }
}

/** The foreground process group of the terminal of a process. */
export async function foregroundGroup(pid: number) {
  if (process.platform === "win32") return undefined
  const value = Number(
    (await run("ps", ["-o", "tpgid=", "-p", String(pid)])).trim()
  )
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Memory pressure of the machine (Linux PSI): averages over 10 s, in %. */
export async function memoryPressure() {
  if (process.platform !== "linux") return undefined
  try {
    const text = await readFile("/proc/pressure/memory", "utf8")
    const value = (kind: string) =>
      Number(new RegExp(`^${kind} avg10=([\\d.]+)`, "m").exec(text)?.[1] ?? 0)
    return { some: value("some"), full: value("full") }
  } catch {
    return undefined
  }
}
