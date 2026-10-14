import * as React from "react"
import { BotIcon, CircleAlertIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
  /** A short count or status next to the title, such as "2 of 5 done". */
  summary?(state: SessionExtensionState): string | undefined
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
      <AgentPanelEmpty
        title="No session"
        text="Start a session to see its plan, questions, jobs, and helpers here."
      />
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
  if (query.isError || !state) {
    return (
      <AgentPanelEmpty
        icon={<CircleAlertIcon />}
        title="Could not load the agent state"
        text={query.error?.message ?? "Try again in a moment."}
      />
    )
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="space-y-6 p-3">
        {visible.map((section) => {
          const summary = section.summary?.(state)
          return (
            <section
              key={section.key}
              aria-labelledby={`agent-section-${section.key}`}
              className="space-y-2"
            >
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3
                  id={`agent-section-${section.key}`}
                  className="text-sm font-semibold"
                >
                  {section.title}
                </h3>
                {summary ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {summary}
                  </span>
                ) : null}
              </div>
              <section.Component
                cwd={cwd}
                sessionId={sessionId}
                state={state}
                viewerContextId={viewerContextId}
              />
            </section>
          )
        })}
        {visible.length <= 1 ? (
          <p className="px-1 text-xs text-muted-foreground">
            The agent&apos;s plan, questions, timers, jobs, child sessions, and
            memory show here when it uses them.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function AgentPanelEmpty({
  icon = <BotIcon />,
  text,
  title,
}: {
  icon?: React.ReactNode
  text: string
  title: string
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
