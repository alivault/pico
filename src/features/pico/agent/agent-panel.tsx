import * as React from "react"
import { BotIcon } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import {
  useSessionExtensions,
  type SessionExtensionState,
} from "@/features/pico/agent/session-extensions"

/**
 * The Agent panel: what the agent of the selected session keeps besides its
 * transcript. Each feature registers a section that reads its part of the
 * session's extension state.
 */
export type AgentSectionProps = {
  state: SessionExtensionState
  viewerContextId: string
  sessionId: string
  cwd?: string
}

export type AgentSection = {
  key: string
  title: string
  order: number
  /** Whether the section has something to show. */
  visible(state: SessionExtensionState): boolean
  Component: React.ComponentType<AgentSectionProps>
}

const sections = new Map<string, AgentSection>()

export function registerAgentSection(section: AgentSection) {
  sections.set(section.key, section)
}

export function AgentPanel({
  active,
  cwd,
  sessionId,
  viewerContextId,
}: {
  active: boolean
  cwd?: string
  sessionId?: string
  viewerContextId: string
}) {
  const query = useSessionExtensions(viewerContextId, sessionId, active)
  const state = query.data
  const visible = state
    ? [...sections.values()]
        .filter((section) => section.visible(state))
        .sort((left, right) => left.order - right.order)
    : []

  if (!sessionId) {
    return (
      <AgentPanelEmpty text="Start a session to see its tasks, jobs, and helpers here." />
    )
  }
  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading…
      </div>
    )
  }
  if (query.isError) {
    return <AgentPanelEmpty text={query.error.message} />
  }
  if (visible.length === 0 || !state) {
    return (
      <AgentPanelEmpty text="The agent has no plans, timers, jobs, or child sessions yet." />
    )
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="space-y-5 p-3">
        {visible.map((section) => (
          <section key={section.key} className="space-y-2">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {section.title}
            </h3>
            <section.Component
              cwd={cwd}
              sessionId={sessionId}
              state={state}
              viewerContextId={viewerContextId}
            />
          </section>
        ))}
      </div>
    </div>
  )
}

function AgentPanelEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <BotIcon className="size-5" />
      <p className="max-w-64">{text}</p>
    </div>
  )
}
