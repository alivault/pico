import { CornerLeftUpIcon, GitForkIcon } from "lucide-react"

import { TitleTooltip } from "@/components/ui/tooltip"
import { emitPicoEvent } from "@/features/pico/agent/events"
import { useSessionExtensions } from "@/features/pico/agent/session-extensions"

type SessionInfo = {
  parent?: { id: string; title: string }
  worktree?: { path: string; branch: string }
}

export function useSessionInfo(viewerContextId: string, sessionId?: string) {
  const query = useSessionExtensions(viewerContextId, sessionId)
  return query.data?.session as SessionInfo | undefined
}

/**
 * Compact markers for the parent session and the worktree, for the session
 * header. They are icons only; the tooltips hold the full text, because the
 * header already shows the branch name.
 */
export function SessionLineage({
  sessionId,
  viewerContextId,
}: {
  sessionId?: string
  viewerContextId: string
}) {
  const info = useSessionInfo(viewerContextId, sessionId)
  if (!info) return null
  const parent = info.parent
  return (
    <>
      {parent ? (
        <TitleTooltip title={`Open the parent session, ${parent.title}`}>
          <button
            type="button"
            aria-label={`Open the parent session, ${parent.title}`}
            className="inline-flex shrink-0 items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() =>
              emitPicoEvent("pico:open-session", { sessionId: parent.id })
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
