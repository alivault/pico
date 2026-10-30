/**
 * What an agent waits on when its turn ended: running jobs that report their
 * exit. The agent goes on when one of them ends, so the agent is not done.
 */
import type { JobsState } from "./jobs.ts"

/** A label such as `2 jobs (build, test)`, or undefined. */
export function waitingLabel(jobs: JobsState | undefined) {
  const running = Object.values(jobs?.items ?? {}).filter(
    (job) => job.status === "running" && job.notifyOnExit
  )
  if (running.length === 0) return undefined
  return `${running.length === 1 ? "a job" : `${running.length} jobs`} (${running.map((job) => job.name).join(", ")})`
}
