import * as React from "react"

/**
 * Small window events that connect parts of the client that do not share
 * state: the event stream, tool cards, the Agent panel, and the app shell.
 */
export type PicoEventMap = {
  /** An agent's Agent panel state changed on the server. */
  "pico:agent-extensions": { agentId: string; kind?: string }
  /** Select an agent, for example a subagent. */
  "pico:open-agent": { agentId: string }
  /** Show a right sidebar tab. */
  "pico:open-sidebar-tab": { tab: "agent" | "review" | "browser" }
  /** Show a background job in the terminal panel. */
  "pico:open-job-terminal": { jobId: string }
  /** Another device changed the shared sidebar layout in local storage. */
  "pico:sidebar-state": {
    machineId: string
    changed: Array<"projects" | "pinnedAgentKeys" | "collapsedProjects">
  }
  /** Open a page of agent settings in the settings dialog. */
  "pico:open-agent-settings": { page?: string }
  /** Collapse or expand all project groups of a machine in the sidebar. */
  "pico:collapse-projects": { machineId: string; collapsed: boolean }
  /** Open the machines dialog. */
  "pico:open-machines": Record<string, never>
  /** Open the resources dialog of the shown machine. */
  "pico:open-resources": Record<string, never>
  /**
   * Open the archived agents dialog of the shown machine. With `jobs`, it
   * shows only agents with running jobs; with `project`, only that project.
   */
  "pico:open-archived-agents": { project?: string; jobs?: boolean }
}

export function emitPicoEvent<K extends keyof PicoEventMap>(
  name: K,
  detail: PicoEventMap[K]
) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

const pendingJobTerminals: Array<{ jobId: string; agentId?: string }> = []

/**
 * Show a job in the terminal panel. The panel may mount after this call, so
 * the request also waits in a queue that the panel reads when it mounts.
 * With `agentId`, only the panel of that agent shows the job: use it when
 * the call also selects the agent, so the panel of the agent before does
 * not take the request.
 */
export function openJobTerminal(jobId: string, agentId?: string) {
  if (!pendingJobTerminals.some((entry) => entry.jobId === jobId))
    pendingJobTerminals.push({ jobId, ...(agentId ? { agentId } : {}) })
  emitPicoEvent("pico:open-job-terminal", { jobId })
}

/** The queued jobs for the panel of an agent. Others stay in the queue. */
export function takePendingJobTerminals(agentId: string | undefined) {
  const taken: Array<string> = []
  for (let index = pendingJobTerminals.length - 1; index >= 0; index--) {
    const entry = pendingJobTerminals[index]
    if (entry.agentId && entry.agentId !== agentId) continue
    taken.unshift(entry.jobId)
    pendingJobTerminals.splice(index, 1)
  }
  return taken
}

export function usePicoEvent<K extends keyof PicoEventMap>(
  name: K,
  handler: (detail: PicoEventMap[K]) => void
) {
  const onEvent = React.useEffectEvent(handler)
  React.useEffect(() => {
    const listener = (event: Event) => {
      onEvent((event as CustomEvent<PicoEventMap[K]>).detail)
    }
    window.addEventListener(name, listener)
    return () => window.removeEventListener(name, listener)
  }, [name])
}
