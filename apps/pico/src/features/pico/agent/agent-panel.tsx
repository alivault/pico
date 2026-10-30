import * as React from "react"
import { BotIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  useAgentExtensions,
  type AgentExtensionState,
} from "@/features/pico/agent/agent-extensions"
import {
  AGENT_SECTIONS_OPEN_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"

/**
 * The Agent panel: what the selected agent keeps besides its
 * transcript. Each feature registers a section that reads its part of the
 * agent's extension state.
 */
export type AgentSectionProps = {
  state: AgentExtensionState
  viewerContextId: string
  agentId: string
  cwd?: string
  /** Open a file of the agent folder in the Files tab. */
  onOpenFile?: (path: string) => void
}

export type AgentSection = {
  key: string
  title: string
  /** Live state comes first, reference material last. */
  order: number
  /** Whether the section starts open. The user's choice is remembered. */
  defaultOpen?: boolean
  /** Whether the section has something to show. */
  visible(state: AgentExtensionState): boolean
  /** Whether the agent has live work here, such as a running job. */
  busy?(state: AgentExtensionState): boolean
  /** A short count or status next to the title, such as "2 of 5 done". */
  summary?(state: AgentExtensionState): string | undefined
  /** Small controls at the right of the header, such as an add button. */
  Actions?: React.ComponentType<AgentSectionProps>
  Component: React.ComponentType<AgentSectionProps>
}

const sections = new Map<string, AgentSection>()

export function registerAgentSection(section: AgentSection) {
  sections.set(section.key, section)
}

/** Whether an agent has live work in any section. */
export function useAgentBusy(viewerContextId: string, agentId?: string) {
  const query = useAgentExtensions(viewerContextId, agentId)
  const state = query.data
  if (!state || !agentId) return false
  for (const section of sections.values()) {
    if (section.visible(state) && section.busy?.(state)) return true
  }
  return false
}

function readOpenSections(): Record<string, boolean> {
  try {
    const value = JSON.parse(
      safeLocalStorageGetItem(AGENT_SECTIONS_OPEN_STORAGE_KEY) ?? "{}"
    ) as unknown
    return value && typeof value === "object"
      ? (value as Record<string, boolean>)
      : {}
  } catch {
    return {}
  }
}

/** Which sections are open, with the user's choices kept across reloads. */
function useOpenSections() {
  const [stored, setStored] = React.useState(readOpenSections)
  const isOpen = (section: AgentSection) =>
    stored[section.key] ?? section.defaultOpen ?? true
  React.useEffect(() => {
    safeLocalStorageSetItem(
      AGENT_SECTIONS_OPEN_STORAGE_KEY,
      JSON.stringify(stored)
    )
  }, [stored])
  const setOpen = (key: string, open: boolean) => {
    setStored((current) => ({ ...current, [key]: open }))
  }
  return { isOpen, setOpen }
}

export function AgentPanel({
  active,
  cwd,
  onOpenFile,
  agentId,
  viewerContextId,
}: {
  active: boolean
  cwd?: string
  onOpenFile?: (path: string) => void
  agentId?: string
  viewerContextId: string
}) {
  const query = useAgentExtensions(viewerContextId, agentId, active)
  const { isOpen, setOpen } = useOpenSections()
  const state = query.data
  const visible = state
    ? [...sections.values()]
        .filter((section) => section.visible(state))
        .sort((left, right) => left.order - right.order)
    : []

  if (!agentId) {
    return (
      <AgentPanelEmpty
        title="No agent"
        text="Start an agent to see its plan, jobs, and helpers here."
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
  if (visible.length === 0) {
    return (
      <AgentPanelEmpty
        title="Nothing here yet"
        text="The agent's plan, jobs, and subagents show here when it uses them."
      />
    )
  }

  const props: AgentSectionProps = {
    cwd,
    onOpenFile,
    agentId,
    state,
    viewerContextId,
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {visible.map((section) => (
        <AgentSectionView
          key={section.key}
          open={isOpen(section)}
          onOpenChange={(open) => setOpen(section.key, open)}
          section={section}
          sectionProps={props}
        />
      ))}
    </div>
  )
}

function AgentSectionView({
  onOpenChange,
  open,
  section,
  sectionProps,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  section: AgentSection
  sectionProps: AgentSectionProps
}) {
  const summary = section.summary?.(sectionProps.state)
  const { Actions, Component } = section
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="group/section border-b border-border/70"
      render={<section aria-labelledby={`agent-section-${section.key}`} />}
    >
      <div className="flex min-h-10 items-center gap-2 pr-2 pl-1.5">
        <h3 className="min-w-0 flex-1">
          <CollapsibleTrigger
            id={`agent-section-${section.key}`}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 pr-1 pl-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[open]/section:rotate-90 motion-reduce:transition-none"
            />
            <span className="shrink-0 text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
              {section.title}
            </span>
            {summary ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground/80 tabular-nums">
                {summary}
              </span>
            ) : null}
          </CollapsibleTrigger>
        </h3>
        {Actions ? (
          <div className="flex shrink-0 items-center">
            <Actions {...sectionProps} />
          </div>
        ) : null}
      </div>
      <CollapsibleContent className="px-2 pb-3">
        <Component {...sectionProps} />
      </CollapsibleContent>
    </Collapsible>
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
