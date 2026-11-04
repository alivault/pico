/**
 * What an agent waits on when its turn ended: running jobs that it waits on
 * (`waitOnExit`). The agent goes on when one of them ends, so the agent is not
 * done. A job that only reports its exit (for example a dev server) does not
 * keep its agent waiting.
 */
import type { JobsState } from "./jobs.ts"

/** A label such as `2 jobs (build, test)`, or undefined. */
export function waitingLabel(jobs: JobsState | undefined) {
  const running = Object.values(jobs?.items ?? {}).filter(
    (job) => job.status === "running" && job.notifyOnExit && job.waitOnExit
  )
  if (running.length === 0) return undefined
  return `${running.length === 1 ? "a job" : `${running.length} jobs`} (${running.map((job) => job.name).join(", ")})`
}

/**
 * A job that the sidebar shows as a dot on the agent's row:
 * - `running`: the process runs.
 * - `input`: the process runs and waits for input.
 * - `failed`: the process ended with an error, and the agent did not hear of
 *   it (the job does not report its exit). The next turn of the agent clears
 *   it.
 */
export type AgentJob = {
  id: string
  name: string
  state: "running" | "input" | "failed"
  /** When a failed job ended. Clients use it to remember that they saw it. */
  endedAt?: number
}

/** The most dots that one agent row shows data for. */
const AGENT_JOBS_LIMIT = 10

/**
 * The jobs of an agent for the sidebar, oldest first, or undefined. A failure
 * that ended before `turnStartedAt` does not show: a new turn clears it.
 */
export function agentJobs(jobs: JobsState | undefined, turnStartedAt?: number) {
  const result: AgentJob[] = []
  const items = Object.values(jobs?.items ?? {}).sort(
    (left, right) => left.startedAt - right.startedAt
  )
  for (const job of items) {
    // An interactive shell is the user's terminal, not a process of the agent.
    if (job.shell) continue
    if (job.status === "running") {
      result.push({
        id: job.id,
        name: job.name,
        state: job.focus || job.waiting ? "input" : "running",
      })
    } else if (
      !job.notifyOnExit &&
      (job.status === "failed" ||
        job.status === "lost" ||
        (job.status === "exited" &&
          (job.exitCode !== 0 || job.signal !== undefined))) &&
      (turnStartedAt === undefined || (job.endedAt ?? 0) > turnStartedAt)
    ) {
      result.push({
        id: job.id,
        name: job.name,
        state: "failed",
        ...(job.endedAt ? { endedAt: job.endedAt } : {}),
      })
    }
  }
  return result.length ? result.slice(-AGENT_JOBS_LIMIT) : undefined
}

/** A short text that changes when the dots of an agent change. */
export function agentJobsSignature(jobs: AgentJob[] | undefined) {
  return (jobs ?? []).map((job) => `${job.id}:${job.state}`).join(",")
}
