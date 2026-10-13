import { CornerLeftUpIcon, GitForkIcon } from "lucide-react"

import { emitPicoEvent } from "@/features/pico/agent/events"
import { useSessionExtensions } from "@/features/pico/agent/session-extensions"

type SessionInfo = {
  parent?: { id: string; title: string }
  worktree?: { path: string; branch: string }
}

/** "From <parent>" and the worktree branch, for the session header. */
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
  return (
    <>
      {info.parent ? (
        <button
          type="button"
          className="inline-flex max-w-40 min-w-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          title={`Spawned by ${info.parent.title}`}
          onClick={() =>
            emitPicoEvent("pico:open-session", { sessionId: info.parent!.id })
          }
        >
          <CornerLeftUpIcon className="size-3 shrink-0" />
          <span className="truncate">{info.parent.title}</span>
        </button>
      ) : null}
      {info.worktree ? (
        <span
          className="inline-flex max-w-40 min-w-0 items-center gap-0.5 text-xs text-muted-foreground"
          title={`Worktree: ${info.worktree.path}`}
        >
          <GitForkIcon className="size-3 shrink-0" />
          <span className="truncate">{info.worktree.branch}</span>
        </span>
      ) : null}
    </>
  )
}
