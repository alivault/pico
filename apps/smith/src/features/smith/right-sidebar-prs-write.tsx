/**
 * The write parts of a pull request in the GitHub tab: hand it to an
 * agent, reply to and resolve threads, the comment box and the review bar,
 * and the merge dialog with the clean-up after the merge.
 */
import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  FileDiffIcon,
  GitMergeIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  SearchCheckIcon,
  WrenchIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { WakeMenu } from "@/features/smith/github-live"
import {
  useHandOff,
  usePrPost,
  type HandOffKind,
  type ReviewDraftApi,
} from "@/features/smith/right-sidebar-prs-actions"
import type { ShownPr } from "@/features/smith/right-sidebar-prs-data"
import { GitSectionNote } from "@/features/smith/right-sidebar-section-note"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import type { BranchAgent } from "@/features/smith/sidebar-store-context"
import type {
  GhCleanupInfoResponse,
  GhCleanupResponse,
  GhCleanupStep,
  GhMergeInfoResponse,
  GhMergeMethod,
  GhMergeResponse,
  GhPrThread,
  GhWriteResponse,
} from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"
import { cn } from "@/lib/utils"

type Scope = { viewerContextId: string; cwd: string }

// ---------------------------------------------------------------------------
// Hand to an agent

export function HandOffBar({
  viewerContextId,
  cwd,
  pr,
  agent,
}: Scope & { pr: ShownPr; agent?: BranchAgent }) {
  const handOff = useHandOff(viewerContextId, cwd)
  const [askOpen, setAskOpen] = React.useState(false)
  const [question, setQuestion] = React.useState("")
  const failed = pr.checkRuns.filter(
    (check) => check.bucket === "fail" || check.bucket === "cancel"
  ).length
  const unresolved = pr.threads.filter((thread) => !thread.isResolved).length
  const target = agent
    ? `Sends it to ${agent.title}, the agent on ${pr.headRefName}.`
    : `Starts an agent in a new worktree on ${pr.headRefName}.`
  const send = (kind: HandOffKind, extra: { question?: string } = {}) =>
    handOff.mutate({
      pr,
      kind,
      ...extra,
      ...(agent ? { agentId: agent.id } : {}),
    })
  const pending = handOff.isPending ? handOff.variables?.kind : undefined
  const button = (
    kind: HandOffKind,
    label: string,
    icon: React.ReactNode,
    title: string
  ) => (
    <TitleTooltip title={`${title} ${target}`}>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={handOff.isPending}
        onClick={() => (kind === "ask" ? setAskOpen(true) : send(kind))}
      >
        {pending === kind ? <Spinner size="xs" /> : icon}
        {label}
      </Button>
    </TitleTooltip>
  )
  if (pr.state !== "OPEN") return null
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {failed > 0
          ? button(
              "fix-ci",
              "Fix CI",
              <WrenchIcon />,
              `Send the ${failed} failed check${failed === 1 ? "" : "s"} with their logs.`
            )
          : null}
        {unresolved > 0
          ? button(
              "address",
              `Address comments (${unresolved})`,
              <MessageSquareIcon />,
              "Send the unresolved threads."
            )
          : null}
        {button(
          "review",
          "Review",
          <SearchCheckIcon />,
          "Ask for a review with proposed line comments."
        )}
        {button(
          "ask",
          "Ask…",
          <MessageCircleQuestionIcon />,
          "Ask about this pull request."
        )}
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <BotIcon className="size-3" />
        {agent ? `To ${agent.title}` : "To a new agent in a new worktree"}
        {agent ? (
          <WakeMenu
            viewerContextId={viewerContextId}
            agentId={agent.id}
            number={pr.number}
            label
            className="ml-1 text-[11px] before:mr-1 before:content-['·']"
          />
        ) : null}
      </span>
      <Dialog
        open={askOpen}
        focusPromptOnClose={false}
        onOpenChange={setAskOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!question.trim()) return
              send("ask", { question })
              setQuestion("")
              setAskOpen(false)
            }}
          >
            <DialogHeader>
              <DialogTitle>Ask About #{pr.number}</DialogTitle>
              <DialogDescription>{target}</DialogDescription>
            </DialogHeader>
            <Textarea
              autoFocus
              rows={5}
              placeholder="What do you want to know or change?"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAskOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!question.trim()}>
                Send
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Threads

export function ThreadActions({
  viewerContextId,
  cwd,
  thread,
}: Scope & { thread: GhPrThread }) {
  const { post, refresh } = usePrPost(viewerContextId, cwd)
  const [reply, setReply] = React.useState("")
  const replyMutation = useMutation({
    mutationFn: (body: string) =>
      post<GhWriteResponse>("/api/gh-pr/thread-reply", {
        threadId: thread.id,
        body,
      }),
    onSuccess: () => {
      setReply("")
      void refresh()
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not send the reply")),
  })
  const resolveMutation = useMutation({
    mutationFn: (resolved: boolean) =>
      post<GhWriteResponse>("/api/gh-pr/thread-resolve", {
        threadId: thread.id,
        resolved,
      }),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not change the thread")),
  })
  const send = () => {
    const body = reply.trim()
    if (body) replyMutation.mutate(body)
  }
  return (
    <div className="grid gap-1.5 pt-1">
      <div className="flex items-end gap-1.5">
        <Textarea
          aria-label="Reply"
          placeholder="Reply"
          rows={1}
          value={reply}
          disabled={replyMutation.isPending}
          className="field-sizing-content max-h-32 min-h-8 resize-none py-1.5 text-xs"
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              send()
            }
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          aria-label="Send the reply (⌘Enter)"
          disabled={!reply.trim() || replyMutation.isPending}
          onClick={send}
        >
          {replyMutation.isPending ? <Spinner size="xs" /> : <ArrowUpIcon />}
        </Button>
      </div>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="justify-self-start"
        disabled={resolveMutation.isPending}
        onClick={() => resolveMutation.mutate(!thread.isResolved)}
      >
        {resolveMutation.isPending ? (
          <Spinner size="xs" />
        ) : thread.isResolved ? (
          <CircleMinusIcon />
        ) : (
          <CircleCheckIcon />
        )}
        {thread.isResolved ? "Unresolve" : "Resolve"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comment box and review bar

const REVIEW_EVENTS = [
  { event: "COMMENT", label: "Comment", icon: <MessageSquareIcon /> },
  { event: "APPROVE", label: "Approve", icon: <CheckIcon /> },
  {
    event: "REQUEST_CHANGES",
    label: "Request changes",
    icon: <FileDiffIcon />,
  },
] as const

export function PrFooter({
  viewerContextId,
  cwd,
  pr,
  review,
  buttonClassName,
}: Scope & {
  pr: ShownPr
  review: ReviewDraftApi
  buttonClassName?: string
}) {
  const { post, refresh } = usePrPost(viewerContextId, cwd)
  const [comment, setComment] = React.useState("")
  const [reviewing, setReviewing] = React.useState(false)
  const count = review.draft.comments.length
  const reviewMode = reviewing || count > 0
  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      post<GhWriteResponse>("/api/gh-pr/comment", { number: pr.number, body }),
    onSuccess: () => void refresh(),
    onError: (error, body) => {
      setComment((current) => current || body)
      toast.error(getErrorMessage(error, "Could not send the comment"))
    },
  })
  const reviewMutation = useMutation({
    mutationFn: (event: (typeof REVIEW_EVENTS)[number]["event"]) =>
      post<GhWriteResponse>("/api/gh-pr/review", {
        number: pr.number,
        event,
        body: review.draft.body,
        comments: review.draft.comments.map((item) => ({
          path: item.path,
          line: item.line,
          side: item.side,
          ...(item.startLine ? { startLine: item.startLine } : {}),
          body: item.body,
        })),
      }),
    onSuccess: () => {
      review.clear()
      setReviewing(false)
      toast.success("Sent the review")
      void refresh()
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not send the review")),
  })
  if (pr.partial) return null
  if (reviewMode) {
    return (
      <div className="grid shrink-0 gap-2 border-t border-border/60 bg-background px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">Review</span>
          <span className="text-muted-foreground">
            {count === 0
              ? "Click a line number in Files changed to comment on it."
              : `${count} line comment${count === 1 ? "" : "s"}`}
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="ml-auto"
            disabled={reviewMutation.isPending}
            onClick={() => {
              review.clear()
              setReviewing(false)
            }}
          >
            Discard
          </Button>
        </div>
        <Textarea
          aria-label="Review summary"
          placeholder="Summary (optional for an approval)"
          rows={2}
          value={review.draft.body}
          disabled={reviewMutation.isPending}
          className="field-sizing-content max-h-40 min-h-9 resize-none text-sm"
          onChange={(event) => review.setBody(event.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-1.5">
          {REVIEW_EVENTS.map((item) => (
            <Button
              key={item.event}
              type="button"
              size="sm"
              variant={item.event === "COMMENT" ? "outline" : "default"}
              className={cn(
                buttonClassName,
                item.event === "REQUEST_CHANGES" &&
                  "bg-red-600 text-white hover:bg-red-600/90"
              )}
              disabled={
                reviewMutation.isPending ||
                (item.event !== "APPROVE" &&
                  !review.draft.body.trim() &&
                  count === 0)
              }
              onClick={() => reviewMutation.mutate(item.event)}
            >
              {reviewMutation.isPending &&
              reviewMutation.variables === item.event ? (
                <Spinner />
              ) : (
                item.icon
              )}
              {item.label}
            </Button>
          ))}
        </div>
      </div>
    )
  }
  const sendComment = () => {
    const body = comment.trim()
    if (!body) return
    setComment("")
    commentMutation.mutate(body)
  }
  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t border-border/60 bg-background px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        sendComment()
      }}
    >
      <Textarea
        data-pr-comment-input
        aria-label="Comment"
        placeholder="Comment"
        rows={1}
        value={comment}
        className="field-sizing-content max-h-40 min-h-9 resize-none rounded-[18px] px-3.5 py-2"
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            sendComment()
          }
        }}
      />
      <TitleTooltip title="Start a review">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("shrink-0", buttonClassName)}
          onClick={() => setReviewing(true)}
        >
          Review…
        </Button>
      </TitleTooltip>
      <Button
        type="submit"
        size="icon"
        aria-label="Send the comment (⌘Enter)"
        className={cn("shrink-0 rounded-full", buttonClassName ?? "size-9")}
        disabled={!comment.trim() || commentMutation.isPending}
      >
        {commentMutation.isPending ? <Spinner /> : <ArrowUpIcon />}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Merge and clean-up

const METHOD_TITLES: Record<GhMergeMethod, string> = {
  squash: "Squash",
  merge: "Merge commit",
  rebase: "Rebase",
}

const BLOCKED_TEXT: Record<string, string> = {
  BLOCKED: "GitHub blocks the merge: a review or a required check is missing.",
  BEHIND: "The branch is behind the base branch.",
  DIRTY: "The branch has conflicts with the base branch.",
  UNSTABLE: "Some checks failed. You can still merge.",
  DRAFT: "The pull request is a draft.",
  UNKNOWN: "GitHub is still checking if the branch can merge.",
}

function useGet<T>(
  viewerContextId: string,
  path: string,
  params: Record<string, string>,
  enabled: boolean
) {
  const machineId = useMachineId()
  const search = new URLSearchParams(params).toString()
  return useQuery({
    queryKey: ["smith", "gh-pr-dialog", viewerContextId, path, search],
    queryFn: () =>
      fetchJson<T>(
        buildRequestUrl(`${path}?${search}`, {
          machineId,
          contextId: viewerContextId,
        })
      ),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

function StepIcon({ step }: { step: GhCleanupStep }) {
  if (step.ok && !step.skipped)
    return <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-500" />
  if (step.skipped)
    return (
      <CircleMinusIcon className="size-3.5 shrink-0 text-muted-foreground" />
    )
  return <CircleXIcon className="size-3.5 shrink-0 text-red-500" />
}

function CleanupStep({
  viewerContextId,
  cwd,
  number,
  onDone,
}: Scope & { number: number; onDone: () => void }) {
  const { post, refresh } = usePrPost(viewerContextId, cwd)
  const infoQuery = useGet<Extract<GhCleanupInfoResponse, { ok: true }>>(
    viewerContextId,
    "/api/gh-pr/cleanup-info",
    { cwd, number: String(number) },
    true
  )
  const [deleteRemote, setDeleteRemote] = React.useState(true)
  const [removeLocal, setRemoveLocal] = React.useState(true)
  const [archive, setArchive] = React.useState<Set<string> | null>(null)
  const data = infoQuery.data
  const archived =
    archive ?? new Set((data?.agents ?? []).map((agent) => agent.id))
  const cleanup = useMutation({
    mutationFn: () =>
      post<Extract<GhCleanupResponse, { ok: true }>>("/api/gh-pr/cleanup", {
        number,
        deleteRemoteBranch: deleteRemote,
        removeWorktree: removeLocal,
        archiveAgents: [...archived],
      }),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast.error(getErrorMessage(error, "The clean-up failed")),
  })
  if (infoQuery.isPending)
    return (
      <GitSectionNote>
        <Spinner /> Looking at the branch…
      </GitSectionNote>
    )
  if (infoQuery.error || !data)
    return (
      <GitSectionNote tone="destructive">
        {getErrorMessage(infoQuery.error, "Could not read the branch")}
      </GitSectionNote>
    )
  const { info } = data
  if (cleanup.data) {
    return (
      <div className="grid gap-3">
        <ul className="grid gap-1.5 text-sm">
          {cleanup.data.steps.length === 0 ? (
            <li className="text-muted-foreground">Nothing to clean up.</li>
          ) : null}
          {cleanup.data.steps.map((step, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="pt-0.5">
                <StepIcon step={step} />
              </span>
              <span className="min-w-0">
                {step.message}{" "}
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {step.target}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </div>
    )
  }
  const remoteNote = info.isCrossRepository
    ? "The branch is in a fork."
    : !info.remoteBranch.exists
      ? "It is gone already."
      : !info.remoteBranch.matchesPr
        ? "It has commits that are not in the pull request; it stays."
        : `Deletes ${info.branch} on GitHub.`
  const localWorktrees = info.worktrees.filter((worktree) => !worktree.main)
  return (
    <div className="grid gap-3">
      <Field orientation="horizontal">
        <Checkbox
          id="cleanup-remote"
          checked={deleteRemote && info.remoteBranch.matchesPr}
          disabled={!info.remoteBranch.exists || !info.remoteBranch.matchesPr}
          onCheckedChange={(checked) => setDeleteRemote(checked)}
        />
        <FieldContent>
          <FieldLabel htmlFor="cleanup-remote">
            Delete the remote branch
          </FieldLabel>
          <FieldDescription>{remoteNote}</FieldDescription>
        </FieldContent>
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id="cleanup-local"
          checked={removeLocal && !data.keepLocalReason}
          disabled={!info.localBranch.exists || Boolean(data.keepLocalReason)}
          onCheckedChange={(checked) => setRemoveLocal(checked)}
        />
        <FieldContent>
          <FieldLabel htmlFor="cleanup-local">
            Remove the local worktree and branch
          </FieldLabel>
          <FieldDescription>
            {!info.localBranch.exists
              ? "There is no local branch."
              : data.keepLocalReason
                ? `They stay: ${data.keepLocalReason}.`
                : localWorktrees.length > 0
                  ? `${localWorktrees.length} worktree${localWorktrees.length === 1 ? "" : "s"}, then the branch ${info.branch}. A worktree with uncommitted changes stays.`
                  : `The branch ${info.branch}.`}
          </FieldDescription>
        </FieldContent>
      </Field>
      {data.keepLocalReason ? (
        <GitSectionNote tone="destructive">
          {data.keepLocalReason}. Push or move those commits first.
        </GitSectionNote>
      ) : null}
      {data.agents.map((agent) => (
        <Field key={agent.id} orientation="horizontal">
          <Checkbox
            id={`cleanup-agent-${agent.id}`}
            checked={archived.has(agent.id)}
            disabled={agent.busy}
            onCheckedChange={(checked) => {
              const next = new Set(archived)
              if (checked) next.add(agent.id)
              else next.delete(agent.id)
              setArchive(next)
            }}
          />
          <FieldContent>
            <FieldLabel htmlFor={`cleanup-agent-${agent.id}`}>
              Archive the agent {agent.title}
            </FieldLabel>
            <FieldDescription>
              {agent.busy
                ? "It is working; it stays."
                : "You can restore it from Archived agents."}
            </FieldDescription>
          </FieldContent>
        </Field>
      ))}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Skip
        </Button>
        <Button
          type="button"
          disabled={cleanup.isPending}
          onClick={() => cleanup.mutate()}
        >
          {cleanup.isPending ? <Spinner /> : null}
          Clean Up
        </Button>
      </DialogFooter>
    </div>
  )
}

export function MergeDialog({
  viewerContextId,
  cwd,
  pr,
  open,
  startAt,
  onOpenChange,
}: Scope & {
  pr: ShownPr
  open: boolean
  /** "cleanup" for a pull request that is merged already. */
  startAt: "merge" | "cleanup"
  onOpenChange: (open: boolean) => void
}) {
  const { post, refresh } = usePrPost(viewerContextId, cwd)
  const [stage, setStage] = React.useState<"merge" | "cleanup">(startAt)
  const [method, setMethod] = React.useState<GhMergeMethod | null>(null)
  const [subject, setSubject] = React.useState<string | null>(null)
  const [body, setBody] = React.useState<string | null>(null)
  const [admin, setAdmin] = React.useState(false)
  const [confirmAdmin, setConfirmAdmin] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setStage(startAt)
    setMethod(null)
    setSubject(null)
    setBody(null)
    setAdmin(false)
    setConfirmAdmin(false)
  }, [open, startAt])
  const infoQuery = useGet<Extract<GhMergeInfoResponse, { ok: true }>>(
    viewerContextId,
    "/api/gh-pr/merge-info",
    { cwd, number: String(pr.number) },
    open && stage === "merge"
  )
  const info = infoQuery.data?.info
  const chosen = method ?? info?.defaultMethod ?? "squash"
  const merge = useMutation({
    mutationFn: () =>
      post<Extract<GhMergeResponse, { ok: true }>>("/api/gh-pr/merge", {
        number: pr.number,
        method: chosen,
        ...(chosen === "squash"
          ? {
              subject: subject ?? info?.squashTitle ?? "",
              body: body ?? info?.squashBody ?? "",
            }
          : {}),
        ...(admin ? { admin: true } : {}),
      }),
    onSuccess: (data) => {
      void refresh()
      if (data.merged) {
        toast.success(`Merged #${pr.number}`)
        setStage("cleanup")
      } else {
        toast.success(
          `GitHub took the merge of #${pr.number}; it is ${data.state.toLowerCase() || "pending"}`
        )
        onOpenChange(false)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error, "The merge failed")),
  })
  const blocked = info ? BLOCKED_TEXT[info.mergeStateStatus] : undefined
  const needsAdmin = info?.mergeStateStatus === "BLOCKED" && info.canAdmin
  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {stage === "merge"
              ? `Merge #${pr.number}`
              : `Clean Up #${pr.number}`}
          </DialogTitle>
          <DialogDescription className="truncate">{pr.title}</DialogDescription>
        </DialogHeader>
        {stage === "cleanup" ? (
          <CleanupStep
            viewerContextId={viewerContextId}
            cwd={cwd}
            number={pr.number}
            onDone={() => onOpenChange(false)}
          />
        ) : infoQuery.isPending ? (
          <GitSectionNote>
            <Spinner /> Asking GitHub…
          </GitSectionNote>
        ) : infoQuery.error || !info ? (
          <GitSectionNote tone="destructive">
            {getErrorMessage(infoQuery.error, "Could not read the merge state")}
          </GitSectionNote>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (admin && !confirmAdmin) {
                setConfirmAdmin(true)
                return
              }
              merge.mutate()
            }}
          >
            <ToggleGroup
              variant="outline"
              size="sm"
              className="w-full"
              value={[chosen]}
              onValueChange={(values) => {
                const value = values[0] as GhMergeMethod | undefined
                if (value) setMethod(value)
              }}
            >
              {(["squash", "merge", "rebase"] as const).map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="flex-1"
                  disabled={!info.allowed.includes(value)}
                  title={
                    info.allowed.includes(value)
                      ? undefined
                      : "The repository does not allow this method"
                  }
                >
                  {METHOD_TITLES[value]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {chosen === "squash" ? (
              <>
                <Input
                  aria-label="Commit title"
                  value={subject ?? info.squashTitle}
                  onChange={(event) => setSubject(event.target.value)}
                />
                <Textarea
                  aria-label="Commit message"
                  rows={5}
                  placeholder="Commit message"
                  value={body ?? info.squashBody}
                  onChange={(event) => setBody(event.target.value)}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {chosen === "rebase"
                  ? "Puts the commits of the branch on top of the base branch."
                  : "Adds a merge commit to the base branch."}
              </p>
            )}
            {info.isDraft ? (
              <GitSectionNote tone="destructive">
                The pull request is a draft. Mark it ready on GitHub first.
              </GitSectionNote>
            ) : blocked ? (
              <GitSectionNote
                tone={
                  info.mergeStateStatus === "UNSTABLE"
                    ? undefined
                    : "destructive"
                }
              >
                {blocked}
              </GitSectionNote>
            ) : null}
            {needsAdmin ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="merge-admin"
                  checked={admin}
                  onCheckedChange={(checked) => {
                    setAdmin(checked)
                    setConfirmAdmin(false)
                  }}
                />
                <FieldContent>
                  <FieldLabel htmlFor="merge-admin">
                    Merge with admin override
                  </FieldLabel>
                  <FieldDescription>
                    Skips the branch rules that block the merge.
                  </FieldDescription>
                </FieldContent>
              </Field>
            ) : null}
            {confirmAdmin ? (
              <GitSectionNote tone="destructive">
                This merges past the rules of the repository. Click again to
                confirm.
              </GitSectionNote>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={admin ? "destructive" : "default"}
                disabled={
                  merge.isPending ||
                  info.isDraft ||
                  info.state !== "OPEN" ||
                  !info.allowed.includes(chosen) ||
                  (info.mergeStateStatus === "BLOCKED" && !admin) ||
                  info.mergeStateStatus === "DIRTY"
                }
              >
                {merge.isPending ? <Spinner /> : <GitMergeIcon />}
                {confirmAdmin
                  ? "Confirm Admin Merge"
                  : admin
                    ? "Merge as Admin"
                    : METHOD_TITLES[chosen] === "Merge commit"
                      ? "Merge"
                      : `${METHOD_TITLES[chosen]} and Merge`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
