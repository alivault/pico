import { CornerLeftUpIcon, GitForkIcon } from "lucide-react"

import { TitleTooltip } from "@/components/ui/tooltip"
import { emitPicoEvent } from "@/features/pico/agent/events"
import { useSessionExtensions } from "@/features/pico/agent/session-extensions"

type SessionInfo = {
  parent?: { id: string; title: string }
  worktree?: { path: string; branch: string }
}

/** The parent session and the worktree branch, for the session header. */
export function SessionLineage({
  sessionId,
  viewerContextId,
}: {
  sessionId?: string
  viewerContextId: string
}) {
  const query = useSessionExtensions(viewerContextId, sessionId)
  const info = query.data?.session as SessionInfo | undefined
  if (!info) return null
  const parent = info.parent
  return (
    <>
      {parent ? (
        <TitleTooltip title={`Open the parent session, ${parent.title}`}>
          <button
            type="button"
            className="inline-flex max-w-40 min-w-0 items-center gap-0.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() =>
              emitPicoEvent("pico:open-session", { sessionId: parent.id })
            }
          >
            <CornerLeftUpIcon className="size-3 shrink-0" />
            <span className="truncate">{parent.title}</span>
          </button>
        </TitleTooltip>
      ) : null}
      {info.worktree ? (
        <TitleTooltip title={`Own worktree: ${info.worktree.path}`}>
          <span className="inline-flex max-w-40 min-w-0 items-center gap-0.5 text-xs text-muted-foreground">
            <GitForkIcon className="size-3 shrink-0" />
            <span className="truncate">{info.worktree.branch}</span>
          </span>
        </TitleTooltip>
      ) : null}
    </>
  )
}
