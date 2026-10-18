import { useQuery } from "@tanstack/react-query"

import { Badge } from "@/components/ui/badge"
import {
  formatGitWorkingTreeSummary,
  formatHeaderGitStatusText,
  gitStatusQueryOptions,
  selectGitStatusSummary,
} from "@/features/pico/right-sidebar-git-data"
import { normalizeCwd } from "@/features/pico/right-sidebar-shared"

export function GitTabStatusText({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: (data) =>
      data.gitStatus === null
        ? "Files"
        : formatGitWorkingTreeSummary(data.gitStatus) || "Changes",
    notifyOnChangeProps: ["data"],
  })
  const text = statusQuery.data || "Changes"

  return <span className="max-w-48 truncate">{text}</span>
}

export function HeaderGitStatusText({
  viewerContextId,
  cwd,
  className,
}: {
  viewerContextId: string
  cwd?: string
  className?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const text = formatHeaderGitStatusText(statusQuery.data)

  if (!text) return null

  return (
    <span
      className={`inline-flex items-center text-xs text-muted-foreground ${className ?? ""}`}
      title={statusQuery.data?.title || text}
    >
      <span className="truncate">{text}</span>
    </span>
  )
}

export function DraftGitStatusBadge({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })

  if (!statusQuery.data?.label) return null

  return <Badge variant="outline">{statusQuery.data.label}</Badge>
}
