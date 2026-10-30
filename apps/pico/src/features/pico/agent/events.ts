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
  "pico:open-sidebar-tab": { tab: "agent" | "review" }
  /** Show a background job in the terminal panel. */
  "pico:open-job-terminal": { jobId: string }
  /** Another device changed the shared sidebar layout in local storage. */
  "pico:sidebar-state": {
    machineId: string
    changed: Array<"projects" | "pinnedAgentKeys" | "collapsedProjects">
  }
  /** Open the agent settings dialog. */
  "pico:open-agent-settings": Record<string, never>
  /** Open the machines dialog. */
  "pico:open-machines": Record<string, never>
  /** Open the resources dialog of the shown machine. */
  "pico:open-resources": Record<string, never>
}

export function emitPicoEvent<K extends keyof PicoEventMap>(
  name: K,
  detail: PicoEventMap[K]
) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

const pendingJobTerminals: Array<string> = []

/**
 * Show a job in the terminal panel. The panel may mount after this call, so
 * the request also waits in a queue that the panel reads when it mounts.
 */
export function openJobTerminal(jobId: string) {
  if (!pendingJobTerminals.includes(jobId)) pendingJobTerminals.push(jobId)
  emitPicoEvent("pico:open-job-terminal", { jobId })
}

export function takePendingJobTerminals() {
  return pendingJobTerminals.splice(0)
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
