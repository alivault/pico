/**
 * The pull request of the current branch at the top of the Changes tab:
 * its state, CI, threads and review, with the hand-offs (Fix CI, Address
 * comments), Merge, and a link to GitHub. Without a pull request, the
 * Create PR row takes its place. Nothing shows when the folder is not a
 * GitHub repository, `gh` cannot read it, or the server is older.
 *
 * The header chip and this card share `useCurrentBranchPr`. The full pull
 * request (failed checks, threads, mergeable) loads with `usePr`, the query
 * of the GitHub tab, so the hand-offs and the merge dialog are the same.
 */
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CircleXIcon,
  ExternalLinkIcon,
  GitMergeIcon,
  MessageSquareIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { TitleTooltip } from "@/components/ui/tooltip"
import { CreatePrButton } from "@/features/smith/create-pr-dialog"
import { useGitHubLive } from "@/features/smith/github-live"
import { useMachineFeature } from "@/features/smith/machine-store"
import { gitStatusQueryOptions } from "@/features/smith/right-sidebar-git-data"
import {
  ChecksIcon,
  ReviewChip,
  StatePill,
} from "@/features/smith/right-sidebar-prs"
import { useHandOffAgent } from "@/features/smith/right-sidebar-prs-actions"
import {
  checksTitle,
  openGitHubPullRequest,
  useCurrentBranchPr,
  usePr,
} from "@/features/smith/right-sidebar-prs-data"
import {
  HandOffBar,
  MergeDialog,
} from "@/features/smith/right-sidebar-prs-write"
import { normalizeCwd } from "@/features/smith/right-sidebar-shared"
import { useBranchAgents } from "@/features/smith/sidebar-store-context"
import { useIsMobile } from "@/hooks/use-mobile"
import type { GhCheckSummary } from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { cn } from "@/lib/utils"

/** The most failed checks that the card names. */
const SHOWN_FAILED_CHECKS = 3

function ChecksText({ checks }: { checks: GhCheckSummary }) {
  if (checks.state === "none") return null
  const parts = [
    checks.failed ? `${checks.failed} failed` : "",
    checks.pending ? `${checks.pending} pending` : "",
    checks.passed ? `${checks.passed} passed` : "",
  ].filter(Boolean)
  return (
    <TitleTooltip title={checksTitle(checks)}>
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1",
          checks.state === "failure" && "text-red-600 dark:text-red-400"
        )}
      >
        <ChecksIcon checks={checks} className="size-3 shrink-0" />
        <span className="truncate tabular-nums">
          CI {parts.join(", ") || "skipped"}
        </span>
      </span>
    </TitleTooltip>
  )
}

export function ChangesPrCard({
  viewerContextId,
  cwd,
  active,
}: {
  viewerContextId: string
  cwd: string
  active: boolean
}) {
  const machineId = useMachineId()
  const isMobile = useIsMobile()
  const normalizedCwd = normalizeCwd(cwd)
  const writesAvailable = useMachineFeature("github-pr-writes")
  const current = useCurrentBranchPr({
    viewerContextId,
    cwd: normalizedCwd,
    enabled: active,
  })
  const { branch, repo } = current
  const summary = current.pr
  const ahead =
    useQuery({
      ...gitStatusQueryOptions({
        machineId,
        viewerContextId,
        cwd: normalizedCwd,
      }),
      enabled: Boolean(active && viewerContextId && normalizedCwd),
      select: (data) => data.gitStatus?.ahead ?? 0,
      notifyOnChangeProps: ["data"],
    }).data ?? 0
  // Live while the card shows, also without a pull request: an agent can
  // create one.
  useGitHubLive({
    viewerContextId,
    cwd: normalizedCwd,
    enabled: Boolean(active && repo && branch),
  })
  const fullQuery = usePr({
    viewerContextId,
    cwd: normalizedCwd,
    number: summary?.number ?? 0,
    enabled: Boolean(active && summary && summary.state !== "CLOSED"),
  })
  const full =
    fullQuery.data &&
    !fullQuery.data.partial &&
    fullQuery.data.number === summary?.number
      ? fullQuery.data
      : undefined
  // A server without live refresh loads the summary each minute: load the
  // full pull request too when the summary changes.
  const signature = summary
    ? [
        summary.number,
        summary.state,
        summary.isDraft,
        summary.reviewDecision,
        summary.unresolvedThreads,
        JSON.stringify(summary.checks),
      ].join(":")
    : ""
  const lastSignature = React.useRef(signature)
  const refetchFull = React.useEffectEvent(() => {
    if (full && !fullQuery.isFetching) void fullQuery.refetch()
  })
  React.useEffect(() => {
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    refetchFull()
  }, [signature])
  const agents = useBranchAgents(normalizedCwd)
  const handOffAgent = useHandOffAgent({
    viewerContextId,
    cwd: normalizedCwd,
    pr: full,
    enabled: active && writesAvailable,
  })
  const [mergeOpen, setMergeOpen] = React.useState(false)

  if (!active || !repo || summary === undefined) return null
  if (summary === null) {
    return (
      <CreatePrButton
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
        branch={branch}
        ahead={ahead}
      />
    )
  }

  const open = summary.state === "OPEN"
  // The full pull request, when it has loaded, so that the counts match the
  // buttons.
  const shown = full
    ? {
        checks: full.checks,
        reviewDecision: full.reviewDecision,
        unresolvedThreads: full.threads.filter((thread) => !thread.isResolved)
          .length,
      }
    : summary
  const canWrite = writesAvailable && repo.viewerCanWrite
  const failedChecks = open
    ? (full?.checkRuns ?? []).filter(
        (check) => check.bucket === "fail" || check.bucket === "cancel"
      )
    : []
  const canMerge = Boolean(
    canWrite &&
    full?.state === "OPEN" &&
    !full.isDraft &&
    full.mergeable === "MERGEABLE"
  )
  const canCleanUp = Boolean(canWrite && full?.state === "MERGED")
  const agent = handOffAgent ?? agents.get(summary.headRefName)
  const buttonSize = isMobile ? "sm" : "xs"
  const mergeButton =
    canMerge || canCleanUp ? (
      <TitleTooltip
        title={
          canMerge
            ? "Merge the pull request, then clean up the branch"
            : "Delete the branch and its worktree"
        }
      >
        <Button
          type="button"
          size={buttonSize}
          variant={canMerge ? "default" : "outline"}
          onClick={() => setMergeOpen(true)}
        >
          <GitMergeIcon />
          {canMerge ? "Merge…" : "Clean Up…"}
        </Button>
      </TitleTooltip>
    ) : null
  // A merged pull request that still shows has all commits of the branch
  // (`closedPrIsCurrent`), so a new one has nothing to show.
  const createButton =
    summary.state === "CLOSED" ? (
      <CreatePrButton
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
        branch={branch}
        ahead={ahead}
        layout="inline"
      />
    ) : null

  return (
    <section
      aria-label={`Pull request #${summary.number}`}
      className="grid min-w-0 gap-1.5 rounded-lg border border-border/70 px-2 py-1.5 text-xs"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <TitleTooltip title="Open it in the GitHub tab">
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => openGitHubPullRequest(machineId, summary.number)}
          >
            <span className="text-muted-foreground tabular-nums">
              #{summary.number}
            </span>{" "}
            <span className="font-medium">{summary.title}</span>
          </button>
        </TitleTooltip>
        {summary.url ? (
          <TitleTooltip title="Open on GitHub">
            <Button
              type="button"
              size={isMobile ? "icon-sm" : "icon-xs"}
              variant="ghost"
              aria-label="Open on GitHub"
              className="-my-1 shrink-0 text-muted-foreground"
              render={<a href={summary.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
            </Button>
          </TitleTooltip>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <StatePill pr={summary} />
        {open ? <ChecksText checks={shown.checks} /> : null}
        {open && shown.unresolvedThreads > 0 ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquareIcon className="size-3" />
            {shown.unresolvedThreads} thread
            {shown.unresolvedThreads === 1 ? "" : "s"}
          </span>
        ) : null}
        {open ? <ReviewChip decision={shown.reviewDecision} /> : null}
      </div>
      {failedChecks.length > 0 ? (
        <ul className="grid min-w-0 gap-0.5 text-[11px] text-muted-foreground">
          {failedChecks.slice(0, SHOWN_FAILED_CHECKS).map((check) => (
            <li key={`${check.name}:${check.jobId ?? ""}`} className="min-w-0">
              <a
                href={check.link || summary.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <CircleXIcon className="size-3 shrink-0 text-red-500" />
                <span className="truncate">{check.name}</span>
              </a>
            </li>
          ))}
          {failedChecks.length > SHOWN_FAILED_CHECKS ? (
            <li className="pl-4">
              {failedChecks.length - SHOWN_FAILED_CHECKS} more
            </li>
          ) : null}
        </ul>
      ) : null}
      {open &&
      full &&
      writesAvailable &&
      (failedChecks.length > 0 ||
        full.threads.some((thread) => !thread.isResolved) ||
        mergeButton) ? (
        <HandOffBar
          viewerContextId={viewerContextId}
          cwd={normalizedCwd}
          pr={full}
          agent={agent}
          kinds={["fix-ci", "address"]}
          compact
          buttonSize={buttonSize}
        >
          {mergeButton}
        </HandOffBar>
      ) : mergeButton || createButton ? (
        <div className="flex flex-wrap items-center gap-1 empty:hidden">
          {mergeButton}
          {createButton}
        </div>
      ) : null}
      {full && canWrite ? (
        <MergeDialog
          viewerContextId={viewerContextId}
          cwd={normalizedCwd}
          pr={full}
          open={mergeOpen}
          startAt={full.state === "MERGED" ? "cleanup" : "merge"}
          onOpenChange={setMergeOpen}
        />
      ) : null}
    </section>
  )
}
