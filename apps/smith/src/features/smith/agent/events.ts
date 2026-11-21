import * as React from "react"

/**
 * Small window events that connect parts of the client that do not share
 * state: the event stream, tool cards, the Agent panel, and the app shell.
 */
export type SmithEventMap = {
  /** An agent's Agent panel state changed on the server. */
  "smith:agent-extensions": { agentId: string; kind?: string }
  /** Select an agent, for example a subagent. */
  "smith:open-agent": { agentId: string }
  /**
   * An agent started or opened a dev server: the Preview can show it. The
   * address is saved already; the shell of the machine may open the tab.
   */
  "smith:preview-available": {
    machineId: string
    agentId: string
    cwd: string
    port: number
    path: string
    /** The user asked for it, as with a click on a job: show it always. */
    open?: boolean
  }
  /** Show a right sidebar tab. */
  "smith:open-sidebar-tab": { tab: "agent" | "review" | "browser" | "issues" }
  /** Open a pull request in the GitHub tab (see `right-sidebar-prs-data.ts`). */
  "smith:open-github-pr": { machineId: string; number: number }
  /** Show a background job in the terminal panel. */
  "smith:open-job-terminal": { jobId: string }
  /** Another device changed the shared sidebar layout in local storage. */
  "smith:sidebar-state": {
    machineId: string
    changed: Array<"projects" | "pinnedAgentKeys" | "collapsedProjects">
  }
  /** Open a page of agent settings in the settings dialog. */
  "smith:open-agent-settings": { page?: string }
  /** Collapse or expand all project groups of a machine in the sidebar. */
  "smith:collapse-projects": { machineId: string; collapsed: boolean }
  /** Open the machines dialog. */
  "smith:open-machines": Record<string, never>
  /** Ask to remove a machine from the hub. */
  "smith:remove-machine": { machineId: string }
  /** Open the dialog that imports cookies from the user's browser. */
  "smith:open-cookie-import": { machineId: string }
  /** Open the resources dialog of the shown machine. */
  "smith:open-resources": Record<string, never>
  /**
   * Open the archived agents dialog of the shown machine. With `jobs`, it
   * shows only agents with running jobs; with `project`, only that project.
   */
  "smith:open-archived-agents": { project?: string; jobs?: boolean }
}

export function emitSmithEvent<K extends keyof SmithEventMap>(
  name: K,
  detail: SmithEventMap[K]
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
  emitSmithEvent("smith:open-job-terminal", { jobId })
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

export function useSmithEvent<K extends keyof SmithEventMap>(
  name: K,
  handler: (detail: SmithEventMap[K]) => void
) {
  const onEvent = React.useEffectEvent(handler)
  React.useEffect(() => {
    const listener = (event: Event) => {
      onEvent((event as CustomEvent<SmithEventMap[K]>).detail)
    }
    window.addEventListener(name, listener)
    return () => window.removeEventListener(name, listener)
  }, [name])
}
