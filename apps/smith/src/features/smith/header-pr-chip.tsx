/**
 * The pull request of the agent's branch in the agent header, for example
 * "#123 · ✗ CI · 2 threads". A click opens it in the GitHub tab.
 */
import { MessageSquareIcon } from "lucide-react"

import { TitleTooltip } from "@/components/ui/tooltip"
import { useGitHubLive, useWake, WakeMenu } from "@/features/smith/github-live"
import { ChecksIcon, PrStateIcon } from "@/features/smith/right-sidebar-prs"
import {
  checksTitle,
  openGitHubPullRequest,
  useCurrentBranchPr,
} from "@/features/smith/right-sidebar-prs-data"
import { normalizeCwd } from "@/features/smith/right-sidebar-shared"
import type { GhBranchPr } from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { cn } from "@/lib/utils"

const REVIEW_TEXT: Record<string, string> = {
  APPROVED: "Approved.",
  CHANGES_REQUESTED: "Changes requested.",
  REVIEW_REQUIRED: "Review required.",
}

function chipTitle(pr: GhBranchPr) {
  const state =
    pr.state === "MERGED"
      ? "merged"
      : pr.state === "CLOSED"
        ? "closed"
        : pr.isDraft
          ? "draft"
          : "open"
  return [
    `Pull request #${pr.number} (${state}): ${pr.title}.`,
    `${checksTitle(pr.checks)}.`,
    REVIEW_TEXT[pr.reviewDecision] ?? "",
    pr.unresolvedThreads > 0
      ? `${pr.unresolvedThreads} unresolved thread${pr.unresolvedThreads === 1 ? "" : "s"}.`
      : "",
    "Open it in the GitHub tab.",
  ]
    .filter(Boolean)
    .join(" ")
}

export function HeaderPrChip({
  viewerContextId,
  cwd,
  worktreeBranch,
  agentId,
  className,
}: {
  viewerContextId: string
  /** The agent of the header, for the wake bell; absent for a draft. */
  agentId?: string
  cwd?: string
  /** The branch of the agent's own worktree; else the branch of `cwd`. */
  worktreeBranch?: string
  className?: string
}) {
  const machineId = useMachineId()
  const normalizedCwd = normalizeCwd(cwd)
  const pr =
    useCurrentBranchPr({
      viewerContextId,
      cwd: normalizedCwd,
      worktreeBranch,
    }).pr ?? undefined
  useGitHubLive({
    viewerContextId,
    cwd: normalizedCwd,
    enabled: Boolean(pr && pr.state === "OPEN"),
  })
  const wake = useWake({
    viewerContextId,
    agentId,
    enabled: Boolean(pr && pr.state === "OPEN"),
  })
  if (!pr) return null
  const failed = pr.checks.state === "failure"
  const wakeOn =
    wake.data?.number === pr.number &&
    (wake.data.events.ci || wake.data.events.comments || wake.data.events.state)
  return (
    <span
      className={cn(
        "group/pr-chip inline-flex shrink-0 items-center gap-1",
        className
      )}
    >
      <TitleTooltip title={chipTitle(pr)}>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-sm text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
          onClick={() => openGitHubPullRequest(machineId, pr.number)}
        >
          <PrStateIcon pr={pr} className="size-3" />
          <span className="tabular-nums">#{pr.number}</span>
          {pr.state === "OPEN" && pr.checks.state !== "none" ? (
            <>
              <span aria-hidden="true">·</span>
              <ChecksIcon checks={pr.checks} className="size-3" />
              <span className={cn(failed && "text-red-600 dark:text-red-400")}>
                CI
              </span>
            </>
          ) : null}
          {pr.state === "OPEN" && pr.unresolvedThreads > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <MessageSquareIcon className="size-3" />
              <span className="tabular-nums">
                {pr.unresolvedThreads} thread
                {pr.unresolvedThreads === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
        </button>
      </TitleTooltip>
      {agentId && pr.state === "OPEN" ? (
        <WakeMenu
          viewerContextId={viewerContextId}
          agentId={agentId}
          number={pr.number}
          // Off: only on hover or focus, so the header stays calm.
          className={cn(
            !wakeOn &&
              "opacity-0 group-hover/pr-chip:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
          )}
        />
      ) : null}
    </span>
  )
}
