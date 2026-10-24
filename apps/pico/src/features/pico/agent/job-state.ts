import * as React from "react"

import { openJobTerminal } from "@/features/pico/agent/events"
import { useSessionExtensions } from "@/features/pico/agent/session-extensions"
import { jobFocusSeen, rememberJobFocusSeen } from "@/lib/pico/storage"
import { useMachineId } from "@/lib/pico/machine-context"

/** A background job, as the server's `jobs` state gives it. */
export type SessionJob = {
  id: string
  name: string
  command: string
  status: "running" | "exited" | "stopped" | "lost" | "failed"
  exitCode?: number
  startedAt: number
  endedAt?: number
  /** The job waits for input. */
  waiting?: { since: number; prompt: string; secret: boolean }
  /** The agent asked the user to type into the job. */
  focus?: { prompt: string; at: number }
}

/** The background jobs of a session (the 20 newest), when they are loaded. */
export function useSessionJobs(
  viewerContextId: string,
  sessionId: string | undefined
) {
  const query = useSessionExtensions(viewerContextId, sessionId)
  const jobs = query.data?.jobs
  return {
    loaded: query.isSuccess,
    jobs: Array.isArray(jobs) ? (jobs as Array<SessionJob>) : [],
  }
}

/**
 * The one line that tells the user what a job needs, if anything. A wait
 * that Pico only guesses from a prompt-like line is `quiet`: the client shows
 * it, but does not call the user.
 */
export function jobPrompt(job: SessionJob | undefined) {
  if (!job || job.status !== "running") return undefined
  if (job.focus)
    return { text: job.focus.prompt, secret: job.waiting?.secret, quiet: false }
  if (job.waiting?.secret)
    return {
      text: job.waiting.prompt
        ? `Waits for input: ${job.waiting.prompt}`
        : "Waits for input",
      secret: true,
      quiet: false,
    }
  if (job.waiting)
    return {
      text: job.waiting.prompt
        ? `May wait for input: ${job.waiting.prompt}`
        : "May wait for input",
      secret: false,
      quiet: true,
    }
  return undefined
}

/**
 * Open the terminal tab of a job when the agent asks for the user
 * (`job_focus`). Each device does this one time for each request, when it
 * shows the session.
 */
export function JobFocusWatcher({
  sessionId,
  viewerContextId,
}: {
  sessionId: string | undefined
  viewerContextId: string
}) {
  const machineId = useMachineId()
  const { jobs } = useSessionJobs(viewerContextId, sessionId)
  React.useEffect(() => {
    for (const job of jobs) {
      if (job.status !== "running" || !job.focus) continue
      if (jobFocusSeen(machineId, job.id, job.focus.at)) continue
      rememberJobFocusSeen(machineId, job.id, job.focus.at)
      openJobTerminal(job.id)
    }
  }, [jobs, machineId])
  return null
}
