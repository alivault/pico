import { useQuery } from "@tanstack/react-query"

import { Badge } from "@/components/ui/badge"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  formatHeaderGitStatusText,
  getGitChangedFileCount,
  gitStatusQueryOptions,
  selectGitStatusSummary,
} from "@/features/pico/right-sidebar-git-data"
import { normalizeCwd } from "@/features/pico/right-sidebar-shared"
import { useMachineId } from "@/lib/pico/machine-context"

export function GitTabStatusText({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const machineId = useMachineId()
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({
      machineId,
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: (data) =>
      data.gitStatus === null ? null : getGitChangedFileCount(data.gitStatus),
    notifyOnChangeProps: ["data"],
  })
  const count = statusQuery.data

  // Not a git repository: the panel shows the project files.
  if (count === null) return <span>Files</span>

  const label = count ? plural(count, "changed file") : "No changes"

  return (
    <>
      Changes
      {count ? (
        <span
          role="img"
          aria-label={label}
          title={label}
          className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </>
  )
}

const headerGitLinkClassName =
  "rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/**
 * The branch and the git state of the header, for example
 * "main · 4 changes · ↑2 ↓1". The changes open the Review tab, and the
 * commits ahead and behind open the History tab.
 */
export function HeaderGitStatusText({
  viewerContextId,
  cwd,
  className,
  onOpenTab,
}: {
  viewerContextId: string
  cwd?: string
  className?: string
  onOpenTab: (tab: "review" | "history") => void
}) {
  const machineId = useMachineId()
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({
      machineId,
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const gitStatus = statusQuery.data
  if (!gitStatus) return null
  const label = gitStatus.label || formatHeaderGitStatusText(gitStatus)
  if (!label) return null
  const changed = gitStatus.changedFileCount
  const { ahead, behind } = gitStatus
  const commitsTitle = [
    ahead > 0 ? `${plural(ahead, "commit")} ahead` : "",
    behind > 0 ? `${plural(behind, "commit")} behind` : "",
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground ${className ?? ""}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {changed > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <TitleTooltip
            title={`${plural(changed, "changed file")}. Open the review.`}
          >
            <button
              type="button"
              className={`shrink-0 ${headerGitLinkClassName}`}
              onClick={() => onOpenTab("review")}
            >
              {plural(changed, "change")}
            </button>
          </TitleTooltip>
        </>
      ) : null}
      {commitsTitle ? (
        <>
          <span aria-hidden="true">·</span>
          <TitleTooltip title={`${commitsTitle}. Open the history.`}>
            <button
              type="button"
              className={`shrink-0 tabular-nums ${headerGitLinkClassName}`}
              onClick={() => onOpenTab("history")}
            >
              {[ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""]
                .filter(Boolean)
                .join(" ")}
            </button>
          </TitleTooltip>
        </>
      ) : null}
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
  const machineId = useMachineId()
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({
      machineId,
      viewerContextId,
      cwd: normalizedCwd,
    }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })

  if (!statusQuery.data?.label) return null

  return <Badge variant="outline">{statusQuery.data.label}</Badge>
}
