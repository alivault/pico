/**
 * What a session waits on when its turn ended: pending timers and watches,
 * and running jobs that report their exit. The agent goes on when one of
 * them fires, so the session is not done.
 */
import type { JobsState } from "./jobs.ts"
import type { TimersState } from "./schedule.ts"

/** A label such as `a watch (deploy) and a job (build)`, or undefined. */
export function waitingLabel(
  timers: TimersState | undefined,
  jobs: JobsState | undefined
) {
  const parts: string[] = []
  const pending = Object.values(timers?.items ?? {}).filter(
    (item) => item.status === "pending"
  )
  for (const kind of ["timer", "watch"] as const) {
    const items = pending.filter((item) => item.kind === kind)
    if (items.length > 0)
      parts.push(
        `${items.length === 1 ? `a ${kind}` : `${items.length} ${kind === "watch" ? "watches" : "timers"}`} (${items.map((item) => item.label).join(", ")})`
      )
  }
  const running = Object.values(jobs?.items ?? {}).filter(
    (job) => job.status === "running" && job.notifyOnExit
  )
  if (running.length > 0)
    parts.push(
      `${running.length === 1 ? "a job" : `${running.length} jobs`} (${running.map((job) => job.name).join(", ")})`
    )
  return parts.length > 0 ? parts.join(" and ") : undefined
}
