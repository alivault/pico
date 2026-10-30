import { CornerLeftUpIcon, GitForkIcon } from "lucide-react"

import { TitleTooltip } from "@/components/ui/tooltip"
import { emitPicoEvent } from "@/features/pico/agent/events"
import { useAgentExtensions } from "@/features/pico/agent/agent-extensions"

type AgentInfo = {
  parent?: { id: string; title: string }
  worktree?: { path: string; branch: string }
}

export function useAgentInfo(viewerContextId: string, agentId?: string) {
  const query = useAgentExtensions(viewerContextId, agentId)
  return query.data?.agent as AgentInfo | undefined
}

/**
 * Compact markers for the parent agent and the worktree, for the agent
 * header. They are icons only; the tooltips hold the full text, because the
 * header already shows the branch name.
 */
export function AgentLineage({
  agentId,
  viewerContextId,
}: {
  agentId?: string
  viewerContextId: string
}) {
  const info = useAgentInfo(viewerContextId, agentId)
  if (!info) return null
  const parent = info.parent
  return (
    <>
      {parent ? (
        <TitleTooltip title={`Open the parent agent, ${parent.title}`}>
          <button
            type="button"
            aria-label={`Open the parent agent, ${parent.title}`}
            className="inline-flex shrink-0 items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() =>
              emitPicoEvent("pico:open-agent", { agentId: parent.id })
            }
          >
            <CornerLeftUpIcon className="size-3" />
          </button>
        </TitleTooltip>
      ) : null}
      {info.worktree ? (
        <TitleTooltip
          title={`Own worktree on ${info.worktree.branch}: ${info.worktree.path}`}
        >
          <span
            aria-label="Own worktree"
            className="inline-flex shrink-0 items-center text-muted-foreground"
          >
            <GitForkIcon className="size-3" />
          </span>
        </TitleTooltip>
      ) : null}
    </>
  )
}
