import * as React from "react"
import {
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  RefreshCwIcon,
  TagIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { MarkdownBlock } from "@/features/pico/markdown-renderer"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import { getErrorMessage } from "@/features/pico/right-sidebar-shared"
import type {
  GhIssue,
  GhIssueCreateResponse,
  GhIssueResponse,
  GhIssueSummary,
  GhIssuesResponse,
  GhLabel,
  GhLabelsResponse,
  GhRepo,
  GhRepoResponse,
  SimpleOkResponse,
} from "@/lib/pico/api"
import { useMachineId } from "@/lib/pico/machine-context"
import { queueMachineAction } from "@/lib/pico/machine"
import { toast } from "@/lib/pico/toast"
import { cn } from "@/lib/utils"

type IssueState = "open" | "closed" | "all"
type GhRepoData = Extract<GhRepoResponse, { ok: true }>
type GhIssuesData = Extract<GhIssuesResponse, { ok: true }>
type GhLabelsData = Extract<GhLabelsResponse, { ok: true }>
type GhIssueData = Extract<GhIssueResponse, { ok: true }>
type GhIssueCreateData = Extract<GhIssueCreateResponse, { ok: true }>
type AvailableRepo = Extract<GhRepo, { available: true }>

const REPO_STALE_MS = 5 * 60_000
const ISSUES_STALE_MS = 30_000

/** Whether the project of `cwd` is a GitHub repository that `gh` can use. */
export function useGitHubRepo({
  viewerContextId,
  cwd,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  enabled: boolean
}) {
  const machineId = useMachineId()
  return useQuery({
    queryKey: picoQueryKeys.ghRepo(viewerContextId, cwd),
    queryFn: async () =>
      (
        await fetchJson<GhRepoData>(
          buildRequestUrl(`/api/gh-repo?cwd=${encodeURIComponent(cwd)}`, {
            machineId,
            contextId: viewerContextId,
          })
        )
      ).repo,
    enabled: Boolean(enabled && viewerContextId && cwd),
    staleTime: REPO_STALE_MS,
    retry: false,
  })
}

function formatAge(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ""
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(days / 365)}y`
}

function formatFullDate(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString() : ""
}

function LabelChip({ label }: { label: GhLabel }) {
  const color = /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : "#888"
  return (
    <span
      title={label.description || label.name}
      className="inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium text-foreground"
      style={{
        borderColor: `${color}99`,
        backgroundColor: `${color}26`,
      }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  )
}

function IssueStateIcon({
  issue,
  className,
}: {
  issue: Pick<GhIssueSummary, "state" | "stateReason">
  className?: string
}) {
  if (issue.state === "OPEN") {
    return (
      <CircleDotIcon
        aria-label="Open"
        className={cn("size-4 shrink-0 text-emerald-500", className)}
      />
    )
  }
  if (issue.stateReason === "NOT_PLANNED") {
    return (
      <CircleSlashIcon
        aria-label="Closed as not planned"
        className={cn("size-4 shrink-0 text-muted-foreground", className)}
      />
    )
  }
  return (
    <CircleCheckIcon
      aria-label="Closed"
      className={cn("size-4 shrink-0 text-violet-500", className)}
    />
  )
}

/** The prompt for an agent that works on an issue. */
function issueAgentPrompt(repo: AvailableRepo, issue: GhIssue) {
  const body = issue.body.trim()
  return [
    `Work on GitHub issue ${repo.nameWithOwner}#${issue.number}: ${issue.title}`,
    issue.url,
    body ? `\n${body}` : "",
    issue.comments.length > 0
      ? `\nThe issue has comments (${issue.comments.length}). Read them with \`gh issue view ${issue.number} --comments\`.`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function issueReference(repo: AvailableRepo, issue: GhIssueSummary) {
  return `GitHub issue ${repo.nameWithOwner}#${issue.number}: ${issue.title} (${issue.url})`
}

function useIssueMutations({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const post = <T,>(path: string, body: Record<string, unknown>) =>
    fetchJson<T>(
      buildRequestUrl(path, { machineId, contextId: viewerContextId }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, ...body }),
      }
    )
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: picoQueryKeys.ghIssues(viewerContextId, cwd),
    })
  const onError = (error: unknown) => {
    toast.error(getErrorMessage(error, "The GitHub request failed"))
  }
  return {
    create: useMutation({
      mutationFn: (input: {
        title: string
        body: string
        labels: Array<string>
      }) => post<GhIssueCreateData>("/api/gh-issue/create", input),
      onSettled: invalidate,
      onError,
    }),
    comment: useMutation({
      mutationFn: (input: { number: number; body: string }) =>
        post<SimpleOkResponse>("/api/gh-issue/comment", input),
      onSettled: invalidate,
      onError,
    }),
    setState: useMutation({
      mutationFn: (input: {
        number: number
        state: "open" | "closed"
        reason?: "completed" | "not planned"
      }) => post<SimpleOkResponse>("/api/gh-issue/state", input),
      onSettled: invalidate,
      onError,
    }),
    editLabels: useMutation({
      mutationFn: (input: {
        number: number
        addLabels: Array<string>
        removeLabels: Array<string>
      }) => post<SimpleOkResponse>("/api/gh-issue/labels", input),
      onSettled: invalidate,
      onError,
    }),
  }
}

function useGitHubLabels(
  viewerContextId: string,
  cwd: string,
  enabled: boolean
) {
  const machineId = useMachineId()
  return useQuery({
    queryKey: picoQueryKeys.ghLabels(viewerContextId, cwd),
    queryFn: async () =>
      (
        await fetchJson<GhLabelsData>(
          buildRequestUrl(`/api/gh-labels?cwd=${encodeURIComponent(cwd)}`, {
            machineId,
            contextId: viewerContextId,
          })
        )
      ).labels,
    enabled: Boolean(enabled && viewerContextId && cwd),
    staleTime: REPO_STALE_MS,
  })
}

function LabelPicker({
  labels,
  selected,
  onToggle,
  trigger,
  disabled,
}: {
  labels: Array<GhLabel>
  selected: Array<string>
  onToggle: (name: string) => void
  trigger: React.ReactElement
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} render={trigger} />
      <DropdownMenuContent align="start" className="max-h-80 min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Labels</DropdownMenuLabel>
          {labels.length === 0 ? (
            <DropdownMenuItem disabled>No labels</DropdownMenuItem>
          ) : null}
          {labels.map((label) => (
            <DropdownMenuItem
              key={label.name}
              closeOnClick={false}
              onClick={() => onToggle(label.name)}
            >
              <CheckIcon
                className={cn(
                  "size-3.5",
                  !selected.includes(label.name) && "invisible"
                )}
              />
              <LabelChip label={label} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NewIssueDialog({
  open,
  onOpenChange,
  labels,
  pending,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: Array<GhLabel>
  pending: boolean
  onCreate: (input: {
    title: string
    body: string
    labels: Array<string>
  }) => Promise<boolean>
}) {
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [selected, setSelected] = React.useState<Array<string>>([])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || pending) return
    if (await onCreate({ title: title.trim(), body, labels: selected })) {
      setTitle("")
      setBody("")
      setSelected([])
    }
  }
  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New issue</DialogTitle>
            <DialogDescription>
              Make an issue in the GitHub repository of this project.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            placeholder="Description (Markdown)"
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <LabelPicker
              labels={labels}
              selected={selected}
              onToggle={(name) =>
                setSelected((current) =>
                  current.includes(name)
                    ? current.filter((item) => item !== name)
                    : [...current, name]
                )
              }
              trigger={
                <Button type="button" size="sm" variant="outline">
                  <TagIcon data-icon="inline-start" />
                  Labels
                </Button>
              }
            />
            {labels
              .filter((label) => selected.includes(label.name))
              .map((label) => (
                <LabelChip key={label.name} label={label} />
              ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || pending}>
              {pending ? <Spinner /> : null}
              Create issue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function IssueRow({
  issue,
  onOpen,
}: {
  issue: GhIssueSummary
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-start gap-2 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
    >
      <IssueStateIcon issue={issue} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-sm leading-5 font-medium wrap-break-word">
          {issue.title}
        </span>
        {issue.labels.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {issue.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">#{issue.number}</span>
          <span aria-hidden="true">·</span>
          <span title={formatFullDate(issue.updatedAt)}>
            {formatAge(issue.updatedAt)}
          </span>
          {issue.author ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{issue.author}</span>
            </>
          ) : null}
          {issue.commentCount > 0 ? (
            <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
              <MessageSquareIcon className="size-3" />
              {issue.commentCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

function IssueDetail({
  viewerContextId,
  cwd,
  repo,
  number,
  active,
  labels,
  mutations,
  onBack,
}: {
  viewerContextId: string
  cwd: string
  repo: AvailableRepo
  number: number
  active: boolean
  labels: Array<GhLabel>
  mutations: ReturnType<typeof useIssueMutations>
  onBack: () => void
}) {
  const machineId = useMachineId()
  const [comment, setComment] = React.useState("")
  const issueQuery = useQuery({
    queryKey: picoQueryKeys.ghIssue(viewerContextId, cwd, number),
    queryFn: async () =>
      (
        await fetchJson<GhIssueData>(
          buildRequestUrl(
            `/api/gh-issue?cwd=${encodeURIComponent(cwd)}&number=${number}`,
            { machineId, contextId: viewerContextId }
          )
        )
      ).issue,
    enabled: Boolean(active && viewerContextId && cwd),
    staleTime: ISSUES_STALE_MS,
  })
  const issue = issueQuery.data
  const busy =
    mutations.setState.isPending ||
    mutations.comment.isPending ||
    mutations.editLabels.isPending

  const startAgent = () => {
    if (!issue) return
    queueMachineAction(machineId, {
      type: "new-agent",
      project: cwd,
      draft: { text: issueAgentPrompt(repo, issue), images: [] },
    })
  }
  const addToPrompt = () => {
    if (!issue) return
    queueMachineAction(machineId, {
      type: "insert-prompt",
      text: issueReference(repo, issue),
    })
  }
  const submitComment = (event: React.FormEvent) => {
    event.preventDefault()
    const body = comment.trim()
    if (!body) return
    mutations.comment.mutate(
      { number, body },
      { onSuccess: () => setComment("") }
    )
  }
  const toggleLabel = (name: string) => {
    if (!issue) return
    const has = issue.labels.some((label) => label.name === name)
    mutations.editLabels.mutate({
      number,
      addLabels: has ? [] : [name],
      removeLabels: has ? [name] : [],
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-border/70 px-1.5 py-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Back to issues"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {repo.nameWithOwner}#{number}
        </span>
        {issueQuery.isFetching || busy ? <Spinner size="xs" /> : null}
        <TitleTooltip title="Open on GitHub">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Open on GitHub"
            render={
              <a
                href={issue?.url || `${repo.url}/issues/${number}`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <ExternalLinkIcon />
          </Button>
        </TitleTooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {issueQuery.isPending && !issue ? (
          <GitSectionNote className="px-3 py-2.5">
            <Spinner /> Loading issue…
          </GitSectionNote>
        ) : issueQuery.error && !issue ? (
          <GitSectionNote tone="destructive" className="px-3 py-2.5">
            {getErrorMessage(issueQuery.error, "Failed to load the issue")}
          </GitSectionNote>
        ) : issue ? (
          <div className="grid gap-3 px-3 py-3">
            <div className="flex items-start gap-2">
              <IssueStateIcon issue={issue} className="mt-1" />
              <h2 className="min-w-0 flex-1 text-base leading-6 font-semibold wrap-break-word">
                {issue.title}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span>{issue.author}</span>
              <span aria-hidden="true">·</span>
              <span title={formatFullDate(issue.createdAt)}>
                opened {formatAge(issue.createdAt)} ago
              </span>
              {issue.assignees.length > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>assigned to {issue.assignees.join(", ")}</span>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {issue.labels.map((label) => (
                <LabelChip key={label.name} label={label} />
              ))}
              {repo.viewerCanWrite ? (
                <LabelPicker
                  labels={labels}
                  selected={issue.labels.map((label) => label.name)}
                  onToggle={toggleLabel}
                  disabled={busy}
                  trigger={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Edit labels"
                    >
                      <TagIcon />
                    </Button>
                  }
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" onClick={startAgent}>
                <BotIcon data-icon="inline-start" />
                Start agent
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addToPrompt}
              >
                <MessageSquarePlusIcon data-icon="inline-start" />
                Add to prompt
              </Button>
              {repo.viewerCanWrite ? (
                issue.state === "OPEN" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={busy}
                      render={
                        <Button type="button" size="sm" variant="outline">
                          <CircleCheckIcon data-icon="inline-start" />
                          Close
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() =>
                          mutations.setState.mutate({
                            number,
                            state: "closed",
                            reason: "completed",
                          })
                        }
                      >
                        <CircleCheckIcon className="text-violet-500" />
                        Close as completed
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          mutations.setState.mutate({
                            number,
                            state: "closed",
                            reason: "not planned",
                          })
                        }
                      >
                        <CircleSlashIcon />
                        Close as not planned
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      mutations.setState.mutate({ number, state: "open" })
                    }
                  >
                    <CircleDotIcon data-icon="inline-start" />
                    Reopen
                  </Button>
                )
              ) : null}
            </div>
            <div className="rounded-lg border border-border/70 px-3 py-2">
              {issue.body.trim() ? (
                <MarkdownBlock
                  className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
                  text={issue.body}
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No description.
                </p>
              )}
            </div>
            {issue.comments.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-border/70 px-3 py-2"
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {item.author}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span title={formatFullDate(item.createdAt)}>
                    {formatAge(item.createdAt)} ago
                  </span>
                </div>
                <MarkdownBlock
                  className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
                  text={item.body}
                />
              </div>
            ))}
            <form className="grid gap-2" onSubmit={submitComment}>
              <Textarea
                placeholder="Write a comment (Markdown)"
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                    submitComment(event)
                }}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!comment.trim() || mutations.comment.isPending}
                >
                  {mutations.comment.isPending ? <Spinner /> : null}
                  Comment
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function IssuesPanel({
  viewerContextId,
  cwd,
  active,
}: {
  viewerContextId: string
  cwd: string
  active: boolean
}) {
  const machineId = useMachineId()
  const repoQuery = useGitHubRepo({ viewerContextId, cwd, enabled: active })
  const repo = repoQuery.data?.available ? repoQuery.data : undefined
  const [state, setState] = React.useState<IssueState>("open")
  const [label, setLabel] = React.useState("")
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [openNumber, setOpenNumber] = React.useState<number | null>(null)
  const [newIssueOpen, setNewIssueOpen] = React.useState(false)
  const mutations = useIssueMutations({ viewerContextId, cwd })
  const labelsQuery = useGitHubLabels(
    viewerContextId,
    cwd,
    Boolean(active && repo)
  )
  const labels = labelsQuery.data ?? []

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  React.useEffect(() => {
    setOpenNumber(null)
    setLabel("")
    setSearchInput("")
    setSearch("")
  }, [cwd])

  const issuesQuery = useQuery({
    queryKey: picoQueryKeys.ghIssueList(
      viewerContextId,
      cwd,
      state,
      label,
      search
    ),
    queryFn: async () => {
      const params = new URLSearchParams({ cwd, state })
      if (label) params.set("label", label)
      if (search) params.set("search", search)
      return (
        await fetchJson<GhIssuesData>(
          buildRequestUrl(`/api/gh-issues?${params.toString()}`, {
            machineId,
            contextId: viewerContextId,
          })
        )
      ).issues
    },
    enabled: Boolean(active && repo && viewerContextId && cwd),
    staleTime: ISSUES_STALE_MS,
    placeholderData: (previous) => previous,
  })

  const createIssue = async (input: {
    title: string
    body: string
    labels: Array<string>
  }) => {
    try {
      const created = await mutations.create.mutateAsync(input)
      setNewIssueOpen(false)
      toast.success(
        created.number ? `Created issue #${created.number}` : "Created issue"
      )
      if (created.number) setOpenNumber(created.number)
      return true
    } catch {
      return false
    }
  }

  if (!cwd) {
    return (
      <GitSectionNote className="px-3 py-2.5">
        No directory selected.
      </GitSectionNote>
    )
  }
  if (repoQuery.isPending) {
    return (
      <GitSectionNote className="px-3 py-2.5">
        <Spinner /> Looking for the GitHub repository…
      </GitSectionNote>
    )
  }
  if (repoQuery.error || !repo) {
    return (
      <div className="grid gap-2 px-3 py-2.5">
        <GitSectionNote tone={repoQuery.error ? "destructive" : "muted"}>
          {repoQuery.error
            ? getErrorMessage(repoQuery.error, "GitHub is not available")
            : repoQuery.data && !repoQuery.data.available
              ? repoQuery.data.reason
              : "GitHub is not available"}
        </GitSectionNote>
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void repoQuery.refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (openNumber !== null) {
    return (
      <IssueDetail
        viewerContextId={viewerContextId}
        cwd={cwd}
        repo={repo}
        number={openNumber}
        active={active}
        labels={labels}
        mutations={mutations}
        onBack={() => setOpenNumber(null)}
      />
    )
  }

  const issues = issuesQuery.data
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-border/70 py-1 pr-1.5 pl-3">
        <a
          href={`${repo.url}/issues`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {repo.nameWithOwner}
        </a>
        {issuesQuery.isFetching ? <Spinner size="xs" /> : null}
        <TitleTooltip title="Refresh">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh issues"
            onClick={() => {
              void issuesQuery.refetch()
              void labelsQuery.refetch()
            }}
          >
            <RefreshCwIcon />
          </Button>
        </TitleTooltip>
        <TitleTooltip title="New issue">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="New issue"
            onClick={() => setNewIssueOpen(true)}
          >
            <PlusIcon />
          </Button>
        </TitleTooltip>
      </div>
      <div className="grid shrink-0 gap-2 border-b border-border/70 px-3 py-2">
        <Input
          type="search"
          placeholder="Search issues"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[state]}
            onValueChange={(values) => {
              const value = values[0]
              if (value === "open" || value === "closed" || value === "all")
                setState(value)
            }}
          >
            <ToggleGroupItem value="open">Open</ToggleGroupItem>
            <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" size="sm" variant="outline">
                  <TagIcon data-icon="inline-start" />
                  {label || "Label"}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="max-h-80 min-w-48">
              <DropdownMenuItem onClick={() => setLabel("")}>
                <CheckIcon className={cn("size-3.5", label && "invisible")} />
                All labels
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {labels.map((item) => (
                <DropdownMenuItem
                  key={item.name}
                  onClick={() => setLabel(item.name)}
                >
                  <CheckIcon
                    className={cn(
                      "size-3.5",
                      label !== item.name && "invisible"
                    )}
                  />
                  <LabelChip label={item} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {issuesQuery.isPending && !issues ? (
          <GitSectionNote className="px-3 py-2.5">
            <Spinner /> Loading issues…
          </GitSectionNote>
        ) : issuesQuery.error && !issues ? (
          <GitSectionNote tone="destructive" className="px-3 py-2.5">
            {getErrorMessage(issuesQuery.error, "Failed to load issues")}
          </GitSectionNote>
        ) : issues && issues.length > 0 ? (
          issues.map((issue) => (
            <IssueRow
              key={issue.number}
              issue={issue}
              onOpen={() => setOpenNumber(issue.number)}
            />
          ))
        ) : (
          <GitSectionNote className="px-3 py-2.5">No issues.</GitSectionNote>
        )}
      </div>
      <NewIssueDialog
        open={newIssueOpen}
        onOpenChange={setNewIssueOpen}
        labels={labels}
        pending={mutations.create.isPending}
        onCreate={createIssue}
      />
    </section>
  )
}
