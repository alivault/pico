/**
 * Containment of background jobs.
 *
 * On Linux with a systemd user manager, each job runs in its own transient
 * scope (`systemd-run --user --scope`): its memory is counted exactly, it
 * gets memory limits, and a stop reaches every process it started, also
 * ones that left its process group. Elsewhere, a stop signals the job's
 * process group (the pty makes the job the leader of its own group).
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { totalmem } from "node:os"

export type ScopeLimits = { memoryHigh?: string; memoryMax?: string }

/** The default limits, as parts of the machine's memory: generous. */
const DEFAULT_HIGH = 0.6
const DEFAULT_MAX = 0.85

let available: Promise<boolean> | undefined

function systemdRun() {
  for (const path of ["/usr/bin/systemd-run", "/bin/systemd-run"])
    if (existsSync(path)) return path
  return undefined
}

/** Whether jobs can get their own scope here (checked one time). */
export function jobScopesAvailable() {
  if (process.env.PICO_JOB_SCOPES === "0" || process.platform !== "linux")
    return Promise.resolve(false)
  const run = systemdRun()
  if (!run) return Promise.resolve(false)
  available ??= new Promise((resolve) => {
    execFile(
      run,
      ["--user", "--scope", "--quiet", "--collect", "true"],
      { timeout: 5000 },
      (error) => resolve(!error)
    )
  })
  return available
}

/** A size setting: "" for the default, "off", or a systemd size ("4G", "50%"). */
export function validSize(value: string) {
  return (
    value === "" ||
    value === "off" ||
    /^\d+(?:\.\d+)?[KMGT]?$|^\d{1,3}%$/i.test(value)
  )
}

function resolveSize(value: string, share: number) {
  if (value === "off") return undefined
  if (value) return value
  return String(Math.floor(totalmem() * share))
}

export function scopeLimits(settings: {
  jobMemoryHigh: string
  jobMemoryMax: string
}): ScopeLimits {
  const high = resolveSize(settings.jobMemoryHigh, DEFAULT_HIGH)
  const max = resolveSize(settings.jobMemoryMax, DEFAULT_MAX)
  return {
    ...(high ? { memoryHigh: high } : {}),
    ...(max ? { memoryMax: max } : {}),
  }
}

export function jobUnit(jobId: string) {
  return `pico-job-${jobId}`
}

/** A command line that runs `file args` in the job's own scope. */
export function wrapInScope(
  jobId: string,
  file: string,
  args: string[],
  limits: ScopeLimits
) {
  const run = systemdRun() ?? "systemd-run"
  return {
    file: run,
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${jobUnit(jobId)}`,
      ...(limits.memoryHigh ? ["-p", `MemoryHigh=${limits.memoryHigh}`] : []),
      ...(limits.memoryMax ? ["-p", `MemoryMax=${limits.memoryMax}`] : []),
      "--",
      file,
      ...args,
    ],
  }
}

/** Stop a job's scope: every process in it ends (used for lost jobs). */
export async function stopScope(jobId: string) {
  if (!(await jobScopesAvailable())) return
  await new Promise<void>((resolve) => {
    execFile(
      "systemctl",
      ["--user", "stop", `${jobUnit(jobId)}.scope`],
      { timeout: 10_000 },
      () => resolve()
    )
  })
}

/** Send a signal to every process of a job's scope. */
export function killScope(jobId: string, signal: string) {
  return new Promise<void>((resolve) => {
    execFile(
      "systemctl",
      ["--user", "kill", `--signal=${signal}`, `${jobUnit(jobId)}.scope`],
      { timeout: 5000 },
      () => resolve()
    )
  })
}
