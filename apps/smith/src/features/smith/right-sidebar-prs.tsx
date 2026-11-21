/**
 * The pull requests of the GitHub tab (read only): a list with a filter,
 * and one pull request with its checks, reviews, threads and files. The
 * layout is that of the issues: a split view when the panel is wide. The
 * data is in `right-sidebar-prs-data.ts`.
 */
import * as React from "react"
import {
  parsePatchFiles,
  type AnnotationSide,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { emitSmithEvent } from "@/features/smith/agent/events"
import { LineCommentForm } from "@/features/smith/line-comment-form"
import { useMachineFeature } from "@/features/smith/machine-store"
import { MarkdownBlock } from "@/features/smith/markdown-renderer"
import { useGitHubLive } from "@/features/smith/github-live"
import {
  useHandOffAgent,
  useReviewDraft,
  type DraftComment,
  type ReviewDraftApi,
} from "@/features/smith/right-sidebar-prs-actions"
import {
  HandOffBar,
  MergeDialog,
  PrFooter,
  ThreadActions,
} from "@/features/smith/right-sidebar-prs-write"
import { copyRightSidebarTextToClipboard } from "@/features/smith/right-sidebar-git-data"
import {
  EmptyState,
  LabelDot,
  SPLIT_VIEW_MIN_WIDTH,
  ageText,
  formatAge,
  formatFullDate,
  useElementWidth,
  useToolbarButtonSize,
} from "@/features/smith/right-sidebar-issues"
import type { AvailableRepo } from "@/features/smith/right-sidebar-issues-data"
import {
  checksTitle,
  useCheckLog,
  usePr,
  usePrDiff,
  usePrList,
  type PrFilter,
  type ShownPr,
} from "@/features/smith/right-sidebar-prs-data"
import { GitSectionNote } from "@/features/smith/right-sidebar-section-note"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import {
  useBranchAgents,
  type BranchAgent,
} from "@/features/smith/sidebar-store-context"
import { useSmithDiffThemeOptions } from "@/features/smith/smith-diff-theme"
import { useIsMobile } from "@/hooks/use-mobile"
import type {
  GhCheckSummary,
  GhPrCheck,
  GhPrReview,
  GhPrSummary,
  GhPrThread,
} from "@/lib/smith/api"
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/lib/smith"
import { toast } from "@/lib/smith/toast"
import { cn } from "@/lib/utils"

const FILTER_STORAGE_KEY = "smith.github.prFilter"
/** A list of passed checks longer than this starts collapsed. */
const SHOWN_PASSED_CHECKS = 5
/** Files of a pull request with at most this many open their diff at once. */
const OPEN_FILES_AT_ONCE = 3
/** The font of the diffs in the Changes tab. */
const DIFF_STYLE = {
  "--diffs-font-family":
    'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
} as React.CSSProperties

// ---------------------------------------------------------------------------
// Small parts

export function PrStateIcon({
  pr,
  className,
}: {
  pr: Pick<GhPrSummary, "state" | "isDraft">
  className?: string
}) {
  if (pr.state === "MERGED")
    return (
      <GitMergeIcon
        aria-label="Merged"
        className={cn("size-4 shrink-0 text-violet-500", className)}
      />
    )
  if (pr.state === "CLOSED")
    return (
      <GitPullRequestClosedIcon
        aria-label="Closed"
        className={cn("size-4 shrink-0 text-red-500", className)}
      />
    )
  if (pr.isDraft)
    return (
      <GitPullRequestDraftIcon
        aria-label="Draft"
        className={cn("size-4 shrink-0 text-muted-foreground", className)}
      />
    )
  return (
    <GitPullRequestIcon
      aria-label="Open"
      className={cn("size-4 shrink-0 text-emerald-500", className)}
    />
  )
}

function prStateTitle(pr: Pick<GhPrSummary, "state" | "isDraft">) {
  if (pr.state === "MERGED") return "Merged"
  if (pr.state === "CLOSED") return "Closed"
  return pr.isDraft ? "Draft" : "Open"
}

function StatePill({ pr }: { pr: Pick<GhPrSummary, "state" | "isDraft"> }) {
  const title = prStateTitle(pr)
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold",
        title === "Merged"
          ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
          : title === "Closed"
            ? "bg-red-500/15 text-red-700 dark:text-red-300"
            : title === "Draft"
              ? "bg-muted text-muted-foreground"
              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      )}
    >
      <PrStateIcon pr={pr} className="size-3 text-current" />
      {title}
    </span>
  )
}

/** The CI state as one icon: ✓, ✗ or a clock. */
export function ChecksIcon({
  checks,
  className,
}: {
  checks: GhCheckSummary
  className?: string
}) {
  if (checks.state === "failure")
    return <CircleXIcon className={cn("size-3.5 text-red-500", className)} />
  if (checks.state === "pending")
    return <ClockIcon className={cn("size-3.5 text-amber-500", className)} />
  if (checks.state === "success")
    return (
      <CircleCheckIcon className={cn("size-3.5 text-emerald-500", className)} />
    )
  return null
}

function Chip({
  children,
  title,
  className,
}: {
  children: React.ReactNode
  title: string
  className?: string
}) {
  return (
    <TitleTooltip title={title}>
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-[11px] leading-none font-medium text-muted-foreground",
          className
        )}
      >
        {children}
      </span>
    </TitleTooltip>
  )
}

function ChecksChip({ checks }: { checks: GhCheckSummary }) {
  if (checks.state === "none") return null
  const count =
    checks.state === "failure"
      ? checks.failed
      : checks.state === "pending"
        ? checks.pending
        : checks.passed
  return (
    <Chip title={checksTitle(checks)} className="bg-transparent px-0.5">
      <ChecksIcon checks={checks} className="size-3" />
      <span className="tabular-nums">{count}</span>
    </Chip>
  )
}

const REVIEW_TITLES: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
}

function ReviewChip({ decision }: { decision: string }) {
  const title = REVIEW_TITLES[decision]
  if (!title) return null
  return (
    <Chip
      title={title}
      className={cn(
        decision === "APPROVED" &&
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        decision === "CHANGES_REQUESTED" &&
          "bg-red-500/15 text-red-700 dark:text-red-300"
      )}
    >
      {decision === "APPROVED" ? (
        <CheckIcon className="size-3" />
      ) : decision === "CHANGES_REQUESTED" ? (
        <FileDiffIcon className="size-3" />
      ) : (
        <CircleDashedIcon className="size-3" />
      )}
      {decision === "REVIEW_REQUIRED" ? "Review" : title}
    </Chip>
  )
}

function AgentChip({ agent }: { agent: BranchAgent }) {
  return (
    <TitleTooltip title={`Open the agent on this branch: ${agent.title}`}>
      <button
        type="button"
        className="inline-flex h-5 max-w-40 min-w-0 shrink items-center gap-1 rounded-full bg-primary/10 px-1.5 text-[11px] leading-none font-medium text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={(event) => {
          event.stopPropagation()
          emitSmithEvent("smith:open-agent", { agentId: agent.id })
        }}
      >
        <BotIcon className="size-3 shrink-0" />
        <span className="truncate">{agent.title}</span>
      </button>
    </TitleTooltip>
  )
}

function PrChips({ pr, agent }: { pr: GhPrSummary; agent?: BranchAgent }) {
  return (
    <>
      <ChecksChip checks={pr.checks} />
      <ReviewChip decision={pr.reviewDecision} />
      {pr.isDraft ? <Chip title="Draft">Draft</Chip> : null}
      {pr.mergeable === "CONFLICTING" ? (
        <Chip
          title="The branch has conflicts with the base branch"
          className="bg-amber-500/15 text-amber-700 dark:text-amber-300"
        >
          <TriangleAlertIcon className="size-3" />
          Conflicts
        </Chip>
      ) : null}
      {agent ? <AgentChip agent={agent} /> : null}
    </>
  )
}

function Section({
  title,
  count,
  defaultOpen = true,
  children,
  extra,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] border-t border-border/60">
      <div className="flex items-center gap-1 pt-2.5 pb-1">
        <button
          type="button"
          aria-expanded={open}
          className="-ml-1 inline-flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
          {title}
          {count !== undefined ? (
            <span className="font-normal tabular-nums">{count}</span>
          ) : null}
        </button>
        {extra}
      </div>
      {open ? (
        <div className="grid grid-cols-[minmax(0,1fr)] pb-3">{children}</div>
      ) : null}
    </section>
  )
}

async function copyText(text: string, what: string) {
  try {
    await copyRightSidebarTextToClipboard(text)
    toast.success(`Copied the ${what}`)
  } catch (error) {
    toast.error(getErrorMessage(error, `Could not copy the ${what}`))
  }
}

// ---------------------------------------------------------------------------
// The list

const FILTERS: Array<{ value: PrFilter; label: string; empty: string }> = [
  { value: "mine", label: "Mine", empty: "You have no open pull requests." },
  {
    value: "review",
    label: "Review",
    empty: "No pull requests ask for your review.",
  },
  { value: "open", label: "All open", empty: "No open pull requests." },
]

function readFilter(): PrFilter {
  const stored = safeLocalStorageGetItem(FILTER_STORAGE_KEY)
  return stored === "mine" || stored === "review" ? stored : "open"
}

function PrRow({
  pr,
  selected,
  agent,
  onOpen,
}: {
  pr: GhPrSummary
  selected: boolean
  agent?: BranchAgent
  onOpen: () => void
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 w-full min-w-0 items-start gap-0.5 rounded-lg pl-1",
        selected ? "bg-primary/10" : "hover:bg-muted/70"
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center pt-1">
        <PrStateIcon pr={pr} />
      </span>
      <div
        data-row-separator
        className="grid min-w-0 flex-1 gap-1 border-b border-border/60 py-2 pr-2.5 pl-1"
      >
        <button
          type="button"
          aria-current={selected || undefined}
          onClick={onOpen}
          className="grid min-w-0 gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-5 font-semibold wrap-break-word">
              {pr.title}
            </span>
            <span
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              title={formatFullDate(pr.updatedAt)}
            >
              {formatAge(pr.updatedAt)}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 tabular-nums">#{pr.number}</span>
            <span className="shrink-0">{pr.author}</span>
            <span
              className="min-w-0 truncate font-mono text-[11px]"
              title={`${pr.headRefName} → ${pr.baseRefName}`}
            >
              {pr.headRefName}
            </span>
            {pr.commentCount > 0 ? (
              <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 tabular-nums">
                <MessageSquareIcon className="size-3" />
                {pr.commentCount}
              </span>
            ) : null}
          </span>
        </button>
        <span className="flex min-w-0 flex-wrap items-center gap-1 empty:hidden">
          <PrChips pr={pr} agent={agent} />
          {pr.labels.map((label) => (
            <span
              key={label.name}
              className="text-[11px] text-muted-foreground"
            >
              <LabelDot label={label} />
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}

function PrList({
  repo,
  prs,
  loading,
  error,
  stale,
  filter,
  search,
  searchInput,
  selectedNumber,
  agents,
  onFilterChange,
  onSearchInputChange,
  onRefresh,
  onOpen,
}: {
  repo: AvailableRepo
  prs: Array<GhPrSummary> | undefined
  loading: boolean
  error: unknown
  stale: boolean
  filter: PrFilter
  search: string
  searchInput: string
  selectedNumber: number | null
  agents: Map<string, BranchAgent>
  onFilterChange: (filter: PrFilter) => void
  onSearchInputChange: (value: string) => void
  onRefresh: () => void
  onOpen: (number: number) => void
}) {
  const isMobile = useIsMobile()
  const buttonSize = useToolbarButtonSize()
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5">
        <InputGroup className={cn("h-8 flex-1", isMobile && "h-11")}>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            autoComplete="off"
            className="[&::-webkit-search-cancel-button]:appearance-none"
            aria-label="Search pull requests"
            placeholder="Search"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchInput) {
                event.stopPropagation()
                onSearchInputChange("")
              }
            }}
          />
          {searchInput ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear the search"
                onClick={() => onSearchInputChange("")}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : loading ? (
            <InputGroupAddon align="inline-end">
              <Spinner size="xs" />
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <TitleTooltip title="Refresh">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh"
            className={buttonSize}
            onClick={onRefresh}
          >
            <RefreshCwIcon />
          </Button>
        </TitleTooltip>
        <TitleTooltip title="Open on GitHub">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Open the pull requests on GitHub"
            className={buttonSize}
            render={
              <a href={`${repo.url}/pulls`} target="_blank" rel="noreferrer" />
            }
          >
            <ExternalLinkIcon />
          </Button>
        </TitleTooltip>
      </div>
      <div className="shrink-0 px-2 pb-1.5">
        <ToggleGroup
          variant="outline"
          size={isMobile ? "default" : "sm"}
          className="w-full"
          value={[filter]}
          onValueChange={(values) => {
            const value = values[0]
            if (value === "mine" || value === "review" || value === "open")
              onFilterChange(value)
          }}
        >
          {FILTERS.map((item) => (
            <ToggleGroupItem
              key={item.value}
              value={item.value}
              className="flex-1"
            >
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-1 pb-2 transition-opacity [&>*:last-child_[data-row-separator]]:border-transparent",
          stale && "opacity-50"
        )}
      >
        {loading && !prs ? (
          <GitSectionNote className="px-2 py-2">
            <Spinner /> Loading pull requests…
          </GitSectionNote>
        ) : error && !prs ? (
          <GitSectionNote tone="destructive" className="px-2 py-2">
            {getErrorMessage(error, "Failed to load pull requests")}
          </GitSectionNote>
        ) : prs && prs.length > 0 ? (
          prs.map((pr) => (
            <PrRow
              key={pr.number}
              pr={pr}
              selected={selectedNumber === pr.number}
              agent={agents.get(pr.headRefName)}
              onOpen={() => onOpen(pr.number)}
            />
          ))
        ) : (
          <EmptyState
            icon={search ? <SearchIcon /> : <GitPullRequestIcon />}
            title={search ? `No Results for “${search}”` : "No Pull Requests"}
            description={
              search
                ? "Check the spelling or try a new search."
                : FILTERS.find((item) => item.value === filter)?.empty
            }
          />
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Checks

function CheckIcon_({ check }: { check: GhPrCheck }) {
  const className = "size-3.5 shrink-0"
  switch (check.bucket) {
    case "fail":
      return <CircleXIcon className={cn(className, "text-red-500")} />
    case "cancel":
      return (
        <CircleMinusIcon className={cn(className, "text-muted-foreground")} />
      )
    case "pending":
      return <ClockIcon className={cn(className, "text-amber-500")} />
    case "skipping":
      return (
        <CircleDashedIcon className={cn(className, "text-muted-foreground")} />
      )
    default:
      return <CircleCheckIcon className={cn(className, "text-emerald-500")} />
  }
}

function CheckLog({
  viewerContextId,
  cwd,
  number,
  check,
}: {
  viewerContextId: string
  cwd: string
  number: number
  check: GhPrCheck
}) {
  const logQuery = useCheckLog({
    viewerContextId,
    cwd,
    number,
    check: check.jobId ?? check.name,
    enabled: true,
  })
  const data = logQuery.data
  // The error is at the end: show the end first.
  const scrollToEnd = React.useCallback((element: HTMLPreElement | null) => {
    if (element) element.scrollTop = element.scrollHeight
  }, [])
  if (logQuery.isPending)
    return (
      <GitSectionNote className="px-1 py-1.5">
        <Spinner /> Loading the log…
      </GitSectionNote>
    )
  if (logQuery.error)
    return (
      <GitSectionNote tone="destructive" className="px-1 py-1.5">
        {getErrorMessage(logQuery.error, "Failed to load the log")}
      </GitSectionNote>
    )
  if (!data || data.kind === "link")
    return (
      <GitSectionNote className="px-1 py-1.5">
        This check does not run on GitHub Actions. Open it for the details.
      </GitSectionNote>
    )
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="flex-1">
          {data.truncated ? "The end of the failed steps" : "The failed steps"}
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={!data.log}
          onClick={() => void copyText(data.log, "log")}
        >
          <CopyIcon data-icon="inline-start" />
          Copy
        </Button>
      </div>
      {data.log ? (
        <pre
          ref={scrollToEnd}
          className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-4 whitespace-pre"
        >
          {data.log}
        </pre>
      ) : (
        <GitSectionNote className="px-1 py-1">
          The log has no failed steps.
        </GitSectionNote>
      )}
    </div>
  )
}

function CheckRow({
  viewerContextId,
  cwd,
  number,
  check,
}: {
  viewerContextId: string
  cwd: string
  number: number
  check: GhPrCheck
}) {
  const failed = check.bucket === "fail"
  const [open, setOpen] = React.useState(false)
  const name = (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="truncate">{check.name}</span>
      {check.workflow ? (
        <span className="truncate text-[11px] text-muted-foreground">
          {check.workflow}
        </span>
      ) : null}
    </span>
  )
  return (
    <div className="grid gap-1 py-0.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {failed ? (
          <button
            type="button"
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setOpen(!open)}
          >
            {open ? (
              <ChevronDownIcon className="size-3 shrink-0" />
            ) : (
              <ChevronRightIcon className="size-3 shrink-0" />
            )}
            <CheckIcon_ check={check} />
            {name}
          </button>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <CheckIcon_ check={check} />
            {name}
          </>
        )}
        {check.link ? (
          <TitleTooltip title="Open the check">
            <a
              href={check.link}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open the check ${check.name}`}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3" />
            </a>
          </TitleTooltip>
        ) : null}
      </div>
      {failed && open ? (
        <div className="pl-[1.125rem]">
          <CheckLog
            viewerContextId={viewerContextId}
            cwd={cwd}
            number={number}
            check={check}
          />
        </div>
      ) : null}
    </div>
  )
}

function ChecksSection({
  viewerContextId,
  cwd,
  pr,
}: {
  viewerContextId: string
  cwd: string
  pr: ShownPr
}) {
  const [showAll, setShowAll] = React.useState(false)
  const runs = pr.checkRuns
  const important = runs.filter(
    (check) => check.bucket === "fail" || check.bucket === "pending"
  )
  const others = runs.filter((check) => !important.includes(check))
  const shownOthers =
    showAll || others.length <= SHOWN_PASSED_CHECKS ? others : []
  return (
    <Section
      title="Checks"
      count={runs.length}
      extra={
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <ChecksIcon checks={pr.checks} className="size-3" />
          {checksTitle(pr.checks).replace(/^Checks: /, "")}
        </span>
      }
    >
      {runs.length === 0 ? (
        <GitSectionNote className="px-1">No checks.</GitSectionNote>
      ) : (
        <>
          {[...important, ...shownOthers].map((check) => (
            <CheckRow
              key={`${check.name}:${check.link}`}
              viewerContextId={viewerContextId}
              cwd={cwd}
              number={pr.number}
              check={check}
            />
          ))}
          {others.length > shownOthers.length ? (
            <button
              type="button"
              className="justify-self-start rounded-sm px-1 py-0.5 text-xs text-primary hover:underline"
              onClick={() => setShowAll(true)}
            >
              Show {others.length} passed and skipped checks
            </button>
          ) : null}
        </>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Reviews, threads and comments

const REVIEW_STATE_TITLES: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "review dismissed",
  PENDING: "review pending",
}

function ReviewItem({ review }: { review: GhPrReview }) {
  return (
    <div className="grid gap-1 border-b border-border/60 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        {review.state === "APPROVED" ? (
          <CircleCheckIcon className="size-3.5 text-emerald-500" />
        ) : review.state === "CHANGES_REQUESTED" ? (
          <FileDiffIcon className="size-3.5 text-red-500" />
        ) : (
          <MessageSquareIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-semibold">{review.author}</span>
        <span className="text-muted-foreground">
          {REVIEW_STATE_TITLES[review.state] ?? review.state.toLowerCase()}
        </span>
        <span
          className="text-muted-foreground"
          title={formatFullDate(review.submittedAt)}
        >
          {ageText(review.submittedAt)}
        </span>
      </div>
      {review.body.trim() ? (
        <MarkdownBlock
          className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
          text={review.body}
        />
      ) : null}
    </div>
  )
}

function Comment({
  author,
  createdAt,
  body,
}: {
  author: string
  createdAt: string
  body: string
}) {
  return (
    <div className="grid gap-1 py-1.5">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-semibold">{author}</span>
        <span
          className="text-muted-foreground"
          title={formatFullDate(createdAt)}
        >
          {ageText(createdAt)}
        </span>
      </div>
      <MarkdownBlock
        className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
        text={body}
      />
    </div>
  )
}

/** The last lines of the diff hunk of a thread: the lines it is about. */
function HunkTail({ hunk }: { hunk: string }) {
  const lines = hunk.split("\n").filter((line) => !line.startsWith("@@"))
  const tail = lines.slice(-4)
  if (tail.length === 0) return null
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px] leading-4">
      {tail.map((line, index) => (
        <div
          key={index}
          className={cn(
            line.startsWith("+") && "text-emerald-700 dark:text-emerald-400",
            line.startsWith("-") && "text-red-700 dark:text-red-400"
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  )
}

function threadPlace(thread: GhPrThread) {
  if (thread.line === null) return thread.path
  return thread.startLine && thread.startLine !== thread.line
    ? `${thread.path}:${thread.startLine}-${thread.line}`
    : `${thread.path}:${thread.line}`
}

function ThreadItem({
  thread,
  scope,
}: {
  thread: GhPrThread
  /** Absent without write access: no reply and no resolve. */
  scope?: { viewerContextId: string; cwd: string }
}) {
  const [open, setOpen] = React.useState(!thread.isResolved)
  const first = thread.comments[0]
  return (
    <div
      className={cn(
        "grid gap-1 rounded-lg border px-2.5 py-2",
        thread.isResolved && "bg-muted/30"
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-sm text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate font-mono text-[11px]">
          {threadPlace(thread)}
        </span>
        {thread.isOutdated ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
            Outdated
          </span>
        ) : null}
        {thread.isResolved ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
            Resolved
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          {thread.comments.length}
        </span>
      </button>
      {open ? (
        <>
          {thread.diffHunk ? <HunkTail hunk={thread.diffHunk} /> : null}
          <div className="grid divide-y divide-border/60">
            {thread.comments.map((comment) => (
              <Comment key={comment.id} {...comment} />
            ))}
          </div>
          {scope ? <ThreadActions {...scope} thread={thread} /> : null}
        </>
      ) : first ? (
        <p className="truncate pl-[1.125rem] text-xs text-muted-foreground">
          {first.author}: {first.body}
        </p>
      ) : null}
    </div>
  )
}

function ThreadsSection({
  threads,
  scope,
}: {
  threads: Array<GhPrThread>
  scope?: { viewerContextId: string; cwd: string }
}) {
  const [showResolved, setShowResolved] = React.useState(false)
  const unresolved = threads.filter((thread) => !thread.isResolved)
  const resolved = threads.filter((thread) => thread.isResolved)
  return (
    <Section
      title="Threads"
      count={threads.length}
      extra={
        unresolved.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {unresolved.length} unresolved
          </span>
        ) : null
      }
    >
      {threads.length === 0 ? (
        <GitSectionNote className="px-1">No review threads.</GitSectionNote>
      ) : (
        <div className="grid gap-2">
          {unresolved.map((thread) => (
            <ThreadItem key={thread.id} thread={thread} scope={scope} />
          ))}
          {resolved.length > 0 ? (
            showResolved ? (
              resolved.map((thread) => (
                <ThreadItem key={thread.id} thread={thread} scope={scope} />
              ))
            ) : (
              <button
                type="button"
                className="justify-self-start rounded-sm px-1 py-0.5 text-xs text-primary hover:underline"
                onClick={() => setShowResolved(true)}
              >
                Show {resolved.length} resolved
              </button>
            )
          ) : null}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Files

function fileDiffsByPath(patch: string) {
  const byPath = new Map<string, FileDiffMetadata>()
  try {
    for (const parsed of parsePatchFiles(patch)) {
      for (const file of parsed.files) byPath.set(file.name, file)
    }
  } catch {
    // Not a patch that the viewer can read: the files show without diffs.
  }
  return byPath
}

type LineTarget = {
  path: string
  line: number
  startLine?: number
  side: AnnotationSide
}

type LineAnnotationData =
  | { kind: "draft"; comment: DraftComment; onRemove: () => void }
  | {
      kind: "pending"
      target: LineTarget
      onCancel: () => void
      onSubmit: (text: string) => void
    }

function LineAnnotation({
  annotation,
}: {
  annotation: DiffLineAnnotation<LineAnnotationData>
}) {
  const data = annotation.metadata
  if (!data) return null
  if (data.kind === "pending") {
    const { target } = data
    return (
      <LineCommentForm
        title={`Comment on ${target.path}:${target.startLine ? `${target.startLine}-` : ""}${target.line} (${target.side === "deletions" ? "old" : "new"})`}
        onCancel={data.onCancel}
        onSubmit={data.onSubmit}
      />
    )
  }
  return (
    <div className="my-1 ml-2 inline-flex max-w-[min(32rem,90%)] items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 py-0.5 pr-0.5 pl-2 font-sans text-[11px] text-amber-800 dark:text-amber-200">
      <MessageSquareIcon className="size-3 shrink-0" />
      <span className="truncate" title={data.comment.body}>
        {data.comment.body}
      </span>
      <button
        type="button"
        aria-label="Remove the draft comment"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-amber-500/20"
        onClick={data.onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

function FilesSection({
  viewerContextId,
  cwd,
  pr,
  active,
  review,
}: {
  viewerContextId: string
  cwd: string
  pr: ShownPr
  active: boolean
  /** The draft review; absent when line comments are off. */
  review?: ReviewDraftApi
}) {
  const themeOptions = useSmithDiffThemeOptions()
  const [target, setTarget] = React.useState<LineTarget | null>(null)
  const annotationsFor = (
    path: string
  ): Array<DiffLineAnnotation<LineAnnotationData>> => {
    const result: Array<DiffLineAnnotation<LineAnnotationData>> = (
      review?.draft.comments ?? []
    )
      .filter((comment) => comment.path === path)
      .map((comment) => ({
        lineNumber: comment.line,
        side: comment.side === "LEFT" ? "deletions" : "additions",
        metadata: {
          kind: "draft",
          comment,
          onRemove: () => review?.removeComment(comment.id),
        },
      }))
    if (target && target.path === path && review) {
      result.push({
        lineNumber: target.line,
        side: target.side,
        metadata: {
          kind: "pending",
          target,
          onCancel: () => setTarget(null),
          onSubmit: (text) => {
            review.addComment({
              path: target.path,
              line: target.line,
              side: target.side === "deletions" ? "LEFT" : "RIGHT",
              ...(target.startLine ? { startLine: target.startLine } : {}),
              body: text,
            })
            setTarget(null)
          },
        },
      })
    }
    return result
  }
  const [opened, setOpened] = React.useState<Set<string>>(
    () =>
      new Set(
        pr.files.length <= OPEN_FILES_AT_ONCE
          ? pr.files.map((file) => file.path)
          : []
      )
  )
  const diffQuery = usePrDiff({
    viewerContextId,
    cwd,
    number: pr.number,
    enabled: active && opened.size > 0,
  })
  const patch = diffQuery.data?.patch ?? ""
  const diffs = React.useMemo(() => fileDiffsByPath(patch), [patch])
  const toggle = (path: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const allOpen = pr.files.every((file) => opened.has(file.path))
  return (
    <Section
      title="Files changed"
      count={pr.changedFiles || pr.files.length}
      extra={
        <span className="inline-flex items-center gap-2 text-[11px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">
            +{pr.additions}
          </span>
          <span className="text-red-600 dark:text-red-400">
            −{pr.deletions}
          </span>
          {pr.files.length > 1 ? (
            <button
              type="button"
              className="rounded-sm text-primary hover:underline"
              onClick={() =>
                setOpened(
                  allOpen
                    ? new Set()
                    : new Set(pr.files.map((file) => file.path))
                )
              }
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          ) : null}
        </span>
      }
    >
      {diffQuery.data?.truncated ? (
        <GitSectionNote className="px-1 pb-1">
          The diff is larger than{" "}
          {Math.round(diffQuery.data.limit / 1024 / 1024)} MB: the last files
          show no diff. Open the pull request on GitHub for all of it.
        </GitSectionNote>
      ) : null}
      {diffQuery.error ? (
        <GitSectionNote tone="destructive" className="px-1 pb-1">
          {getErrorMessage(diffQuery.error, "Failed to load the diff")}
        </GitSectionNote>
      ) : null}
      <div className="grid gap-1.5">
        {pr.files.map((file) => {
          const open = opened.has(file.path)
          const fileDiff = diffs.get(file.path)
          return (
            <div
              key={file.path}
              className="overflow-hidden rounded-md border bg-background"
            >
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => toggle(file.path)}
              >
                {open ? (
                  <ChevronDownIcon className="size-3 shrink-0" />
                ) : (
                  <ChevronRightIcon className="size-3 shrink-0" />
                )}
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px]"
                  title={file.path}
                >
                  {file.path}
                </span>
                <span className="shrink-0 text-[11px] text-emerald-600 tabular-nums dark:text-emerald-400">
                  +{file.additions}
                </span>
                <span className="shrink-0 text-[11px] text-red-600 tabular-nums dark:text-red-400">
                  −{file.deletions}
                </span>
              </button>
              {open ? (
                <div className="border-t text-xs" style={DIFF_STYLE}>
                  {fileDiff ? (
                    <FileDiff<LineAnnotationData>
                      fileDiff={fileDiff}
                      disableWorkerPool
                      lineAnnotations={annotationsFor(file.path)}
                      renderAnnotation={(annotation) => (
                        <LineAnnotation annotation={annotation} />
                      )}
                      options={{
                        ...themeOptions,
                        diffStyle: "unified",
                        disableFileHeader: true,
                        lineDiffType: "word-alt",
                        maxLineDiffLength: 1000,
                        overflow: "wrap",
                        ...(review
                          ? {
                              enableGutterUtility: true,
                              onGutterUtilityClick: (
                                range: SelectedLineRange
                              ) => {
                                const start = Math.min(range.start, range.end)
                                const end = Math.max(range.start, range.end)
                                setTarget({
                                  path: file.path,
                                  line: end,
                                  ...(start < end ? { startLine: start } : {}),
                                  side: (range.endSide ||
                                    range.side ||
                                    "additions") as AnnotationSide,
                                })
                              },
                              onLineNumberClick: (props: {
                                lineNumber: number
                                annotationSide: AnnotationSide
                              }) => {
                                setTarget({
                                  path: file.path,
                                  line: props.lineNumber,
                                  side: props.annotationSide,
                                })
                              },
                            }
                          : {}),
                      }}
                    />
                  ) : diffQuery.isPending ? (
                    <GitSectionNote className="px-2 py-1.5">
                      <Spinner /> Loading the diff…
                    </GitSectionNote>
                  ) : (
                    <GitSectionNote className="px-2 py-1.5">
                      No line changes to show.
                    </GitSectionNote>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// The pull request

function PrDetail({
  viewerContextId,
  cwd,
  repo,
  number,
  active,
  agents,
  onBack,
}: {
  viewerContextId: string
  cwd: string
  repo: AvailableRepo
  number: number
  active: boolean
  agents: Map<string, BranchAgent>
  onBack?: () => void
}) {
  const buttonSize = useToolbarButtonSize()
  const writesAvailable = useMachineFeature("github-pr-writes")
  const prQuery = usePr({ viewerContextId, cwd, number, enabled: active })
  const pr = prQuery.data
  const review = useReviewDraft(cwd, number)
  const handOffAgent = useHandOffAgent({
    viewerContextId,
    cwd,
    pr: pr?.partial ? undefined : pr,
    enabled: active && writesAvailable,
  })
  const [mergeOpen, setMergeOpen] = React.useState(false)
  const scope = { viewerContextId, cwd }
  const canWrite = writesAvailable && repo.viewerCanWrite
  const canReview = writesAvailable && pr?.state === "OPEN"
  const agent = pr ? agents.get(pr.headRefName) : undefined
  const head =
    pr && pr.isCrossRepository && pr.headRepositoryOwner
      ? `${pr.headRepositoryOwner}:${pr.headRefName}`
      : pr?.headRefName
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("gap-0.5 px-1.5 text-primary", buttonSize && "h-11")}
            onClick={onBack}
          >
            <ChevronLeftIcon className="size-5" />
            Pull Requests
          </Button>
        ) : null}
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            !onBack && "pl-1.5"
          )}
        >
          #{number}
        </span>
        <span className="min-w-0 flex-1" />
        {prQuery.isFetching ? <Spinner size="xs" /> : null}
        {pr && !pr.partial && canWrite && pr.state !== "CLOSED" ? (
          <Button
            type="button"
            size="sm"
            variant={pr.state === "OPEN" ? "default" : "outline"}
            className={cn(buttonSize && "h-11")}
            onClick={() => setMergeOpen(true)}
          >
            <GitMergeIcon data-icon="inline-start" />
            {pr.state === "OPEN" ? "Merge…" : "Clean Up…"}
          </Button>
        ) : null}
        <TitleTooltip title="Refresh">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh"
            className={buttonSize}
            onClick={() => void prQuery.refetch()}
          >
            <RefreshCwIcon />
          </Button>
        </TitleTooltip>
        {pr?.url ? (
          <TitleTooltip title="Open on GitHub">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Open on GitHub"
              className={buttonSize}
              render={<a href={pr.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
            </Button>
          </TitleTooltip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {prQuery.isPending && !pr ? (
          <GitSectionNote className="px-4 py-3">
            <Spinner /> Loading the pull request…
          </GitSectionNote>
        ) : prQuery.error && !pr ? (
          <GitSectionNote tone="destructive" className="px-4 py-3">
            {getErrorMessage(prQuery.error, "Failed to load the pull request")}
          </GitSectionNote>
        ) : pr ? (
          <article className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pt-3 pb-4">
            <header className="grid gap-1.5">
              <h2 className="text-lg leading-6 font-semibold wrap-break-word">
                {pr.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <StatePill pr={pr} />
                <span>{pr.author}</span>
                <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px]">
                  <span className="truncate" title={head}>
                    {head}
                  </span>
                  <span aria-label="into">→</span>
                  <span className="truncate">{pr.baseRefName}</span>
                </span>
                {pr.createdAt ? (
                  <span title={formatFullDate(pr.createdAt)}>
                    opened {ageText(pr.createdAt)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <PrChips pr={pr} agent={agent} />
                {pr.isCrossRepository ? (
                  <Chip title={`From the fork ${pr.headRepositoryOwner}`}>
                    Fork
                  </Chip>
                ) : null}
                {pr.labels.map((label) => (
                  <span
                    key={label.name}
                    className="text-[11px] text-muted-foreground"
                  >
                    <LabelDot label={label} />
                  </span>
                ))}
              </div>
              {writesAvailable && !pr.partial ? (
                <HandOffBar {...scope} pr={pr} agent={handOffAgent ?? agent} />
              ) : null}
            </header>
            {pr.partial ? (
              <GitSectionNote>
                <Spinner /> Loading the details…
              </GitSectionNote>
            ) : (
              <>
                {pr.body.trim() ? (
                  <MarkdownBlock
                    className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
                    text={pr.body}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No description.
                  </p>
                )}
                <ChecksSection
                  viewerContextId={viewerContextId}
                  cwd={cwd}
                  pr={pr}
                />
                {pr.reviews.length > 0 ? (
                  <Section title="Reviews" count={pr.reviews.length}>
                    {pr.reviews.map((review) => (
                      <ReviewItem key={review.id} review={review} />
                    ))}
                  </Section>
                ) : null}
                <ThreadsSection
                  threads={pr.threads}
                  scope={writesAvailable ? scope : undefined}
                />
                {pr.comments.length > 0 ? (
                  <Section
                    title="Comments"
                    count={pr.comments.length}
                    defaultOpen={pr.comments.length <= 5}
                  >
                    <div className="grid divide-y divide-border/60">
                      {pr.comments.map((comment) => (
                        <Comment key={comment.id} {...comment} />
                      ))}
                    </div>
                  </Section>
                ) : null}
                <FilesSection
                  viewerContextId={viewerContextId}
                  cwd={cwd}
                  pr={pr}
                  active={active}
                  review={canReview ? review : undefined}
                />
              </>
            )}
          </article>
        ) : null}
      </div>
      {pr && canReview ? (
        <PrFooter
          {...scope}
          pr={pr}
          review={review}
          buttonClassName={buttonSize}
        />
      ) : null}
      {pr && canWrite ? (
        <MergeDialog
          {...scope}
          pr={pr}
          open={mergeOpen}
          startAt={pr.state === "MERGED" ? "cleanup" : "merge"}
          onOpenChange={setMergeOpen}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The panel

export function PrsPanel({
  viewerContextId,
  cwd,
  repo,
  active,
  requested,
}: {
  viewerContextId: string
  cwd: string
  repo: AvailableRepo
  active: boolean
  /** A pull request to open, from the agent header. */
  requested: { number: number; at: number } | null
}) {
  const [filter, setFilterState] = React.useState<PrFilter>(readFilter)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [openNumber, setOpenNumber] = React.useState<number | null>(
    requested?.number ?? null
  )
  const { ref: panelRef, width } = useElementWidth()
  const split = width >= SPLIT_VIEW_MIN_WIDTH
  const agents = useBranchAgents(cwd)
  useGitHubLive({ viewerContextId, cwd, enabled: active })
  const listQuery = usePrList({
    viewerContextId,
    cwd,
    filter,
    search,
    enabled: active,
  })

  React.useEffect(() => {
    if (requested) setOpenNumber(requested.number)
  }, [requested])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const setFilter = (value: PrFilter) => {
    setFilterState(value)
    safeLocalStorageSetItem(FILTER_STORAGE_KEY, value)
  }

  const list = (
    <PrList
      repo={repo}
      prs={listQuery.data}
      loading={listQuery.isFetching}
      error={listQuery.error}
      stale={listQuery.isPlaceholderData}
      filter={filter}
      search={search}
      searchInput={searchInput}
      selectedNumber={split ? openNumber : null}
      agents={agents}
      onFilterChange={setFilter}
      onSearchInputChange={setSearchInput}
      onRefresh={() => void listQuery.refetch()}
      onOpen={setOpenNumber}
    />
  )
  const detail =
    openNumber !== null ? (
      <PrDetail
        key={openNumber}
        viewerContextId={viewerContextId}
        cwd={cwd}
        repo={repo}
        number={openNumber}
        active={active}
        agents={agents}
        onBack={split ? undefined : () => setOpenNumber(null)}
      />
    ) : null

  return (
    <div ref={panelRef} className="h-full min-h-0">
      {split ? (
        <div className="flex h-full min-h-0">
          <div className="h-full w-[clamp(260px,38%,380px)] shrink-0 border-r border-border/60">
            {list}
          </div>
          <div className="h-full min-w-0 flex-1">
            {detail ?? (
              <EmptyState
                icon={<GitPullRequestIcon />}
                title="No Pull Request Selected"
                description="Choose a pull request in the list."
              />
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={cn("h-full", detail && "hidden")}>{list}</div>
          {detail}
        </>
      )}
    </div>
  )
}
