/**
 * The writes of the pull requests in the GitHub tab: hand a pull request
 * to an agent, the draft review with its line comments (kept in this
 * browser until it is sent), and a POST helper that loads the pull request
 * again after a write.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { emitSmithEvent } from "@/features/smith/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import {
  checkLogQueryOptions,
  type ShownPr,
} from "@/features/smith/right-sidebar-prs-data"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import type { GhCheckLog, GhHandOffResponse } from "@/lib/smith/api"
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/lib/smith"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"

/** The most failed checks whose logs go into a Fix CI prompt. */
const MAX_LOGS = 5

// ---------------------------------------------------------------------------
// Writes

/** POST to a pull request route; then load the pull request and lists again. */
export function usePrPost(viewerContextId: string, cwd: string) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const post = React.useCallback(
    <T>(path: string, body: Record<string, unknown>) =>
      fetchJson<T>(
        buildRequestUrl(path, { machineId, contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, ...body }),
        }
      ),
    [machineId, viewerContextId, cwd]
  )
  const refresh = React.useCallback(
    async () =>
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["smith", "gh-prs", viewerContextId, cwd],
        }),
        queryClient.invalidateQueries({
          queryKey: ["smith", "gh-branch-prs", viewerContextId],
        }),
      ]),
    [queryClient, viewerContextId, cwd]
  )
  return { post, refresh, machineId }
}

// ---------------------------------------------------------------------------
// Hand to an agent

export type HandOffKind = "fix-ci" | "address" | "review" | "ask"

function header(pr: ShownPr) {
  return [
    `GitHub pull request #${pr.number}: ${pr.title}`,
    pr.url,
    `Branch: ${pr.headRefName} → ${pr.baseRefName}`,
  ].join("\n")
}

export function fixCiPrompt(
  pr: ShownPr,
  logs: Map<string, GhCheckLog | string>
) {
  const failed = pr.checkRuns.filter(
    (check) => check.bucket === "fail" || check.bucket === "cancel"
  )
  const parts = failed.map((check) => {
    const log = logs.get(check.name)
    const title = `### ${check.name}${check.workflow ? ` (${check.workflow})` : ""}`
    const body =
      typeof log === "string"
        ? `(The log could not be loaded: ${log})`
        : log?.kind === "actions" && log.log
          ? `The end of the failed steps:\n\`\`\`\n${log.log}\n\`\`\``
          : "(No log here. Open the link for the details.)"
    return [title, check.link, body].filter(Boolean).join("\n")
  })
  return [
    `Fix the failing CI of ${header(pr)}`,
    "",
    `Failed checks (${failed.length}):`,
    "",
    parts.join("\n\n"),
    "",
    "Find the cause, fix it, and run the same checks here if you can. Then commit and push to the branch, and tell me what you changed.",
  ].join("\n")
}

function hunkTail(hunk: string) {
  return hunk
    .split("\n")
    .filter((line) => !line.startsWith("@@"))
    .slice(-6)
    .join("\n")
}

export function addressCommentsPrompt(pr: ShownPr) {
  const threads = pr.threads.filter((thread) => !thread.isResolved)
  const parts = threads.map((thread) => {
    const place =
      thread.line === null ? thread.path : `${thread.path}:${thread.line}`
    const hunk = thread.diffHunk
      ? `\`\`\`diff\n${hunkTail(thread.diffHunk)}\n\`\`\``
      : ""
    const comments = thread.comments
      .map((comment) => `- ${comment.author}: ${comment.body}`)
      .join("\n")
    return [
      `### ${place}${thread.isOutdated ? " (outdated)" : ""}`,
      hunk,
      comments,
    ]
      .filter(Boolean)
      .join("\n")
  })
  return [
    `Address the unresolved review comments of ${header(pr)}`,
    "",
    `Unresolved threads (${threads.length}):`,
    "",
    parts.join("\n\n"),
    "",
    "For each thread, change the code, or tell me why not. Commit and push to the branch. Do not resolve the threads or reply on GitHub; tell me what you did for each thread.",
  ].join("\n")
}

export function reviewPrompt(pr: ShownPr) {
  return [
    `Review ${header(pr)}`,
    "",
    `Read the description with \`gh pr view ${pr.number}\` and the diff with \`gh pr diff ${pr.number}\`.`,
    "Write your findings, the most important first: bugs, risks, missing tests, then smaller points.",
    "Then propose line comments, each as `path:line` and the comment text.",
    "Do not post anything to GitHub and do not change the code.",
  ].join("\n")
}

export function askPrompt(pr: ShownPr, question: string) {
  return [
    `About ${header(pr)}`,
    `(Read it with \`gh pr view ${pr.number}\` and \`gh pr diff ${pr.number}\`.)`,
    "",
    question.trim(),
  ].join("\n")
}

/**
 * The agent that a hand-off goes to: the server looks at worktrees and at
 * the branches that agent folders have checked out.
 */
export function useHandOffAgent({
  viewerContextId,
  cwd,
  pr,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  pr: ShownPr | undefined
  enabled: boolean
}) {
  const machineId = useMachineId()
  const branches = pr
    ? [pr.headRefName, `pr-${pr.number}-${pr.headRefName}`].join(",")
    : ""
  const query = useQuery({
    queryKey: ["smith", "gh-branch-agents", viewerContextId, cwd, branches],
    queryFn: async () =>
      (
        await fetchJson<{
          ok: true
          agents: Array<{ id: string; title: string }>
        }>(
          buildRequestUrl(
            `/api/gh-branch-agents?${new URLSearchParams({ cwd, branches }).toString()}`,
            { machineId, contextId: viewerContextId }
          )
        )
      ).agents,
    enabled: Boolean(enabled && pr && pr.state === "OPEN"),
    staleTime: 30_000,
    retry: false,
  })
  return query.data?.[0]
}

/**
 * Send a pull request to the agent on its branch, or start an agent in a
 * new worktree on the branch. Then open that agent.
 */
export function useHandOff(viewerContextId: string, cwd: string) {
  const { post, machineId } = usePrPost(viewerContextId, cwd)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      pr: ShownPr
      kind: HandOffKind
      question?: string
      agentId?: string
    }) => {
      const { pr, kind } = input
      let message: string
      if (kind === "fix-ci") {
        const logs = new Map<string, GhCheckLog | string>()
        const failed = pr.checkRuns
          .filter((check) => check.bucket === "fail" && check.jobId)
          .slice(0, MAX_LOGS)
        await Promise.all(
          failed.map(async (check) => {
            try {
              logs.set(
                check.name,
                await queryClient.fetchQuery(
                  checkLogQueryOptions({
                    machineId,
                    viewerContextId,
                    cwd,
                    number: pr.number,
                    check: check.jobId ?? check.name,
                  })
                )
              )
            } catch (error) {
              logs.set(check.name, getErrorMessage(error, "unknown error"))
            }
          })
        )
        message = fixCiPrompt(pr, logs)
      } else if (kind === "address") {
        message = addressCommentsPrompt(pr)
      } else if (kind === "review") {
        message = reviewPrompt(pr)
      } else {
        message = askPrompt(pr, input.question ?? "")
      }
      return await post<Extract<GhHandOffResponse, { ok: true }>>(
        "/api/gh-pr/hand-off",
        {
          number: pr.number,
          message,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        }
      )
    },
    onSuccess: (data) => {
      toast.success(
        data.created
          ? "Started an agent in a new worktree"
          : data.queued
            ? "Queued for the agent"
            : "Sent to the agent"
      )
      if (data.note) toast.warning(data.note)
      emitSmithEvent("smith:open-agent", { agentId: data.agentId })
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not hand the PR to an agent")),
  })
}

// ---------------------------------------------------------------------------
// The draft review

export type DraftComment = {
  id: string
  path: string
  line: number
  side: "LEFT" | "RIGHT"
  startLine?: number
  body: string
}

export type ReviewDraft = { body: string; comments: Array<DraftComment> }

const EMPTY_DRAFT: ReviewDraft = { body: "", comments: [] }
const draftListeners = new Set<() => void>()

function readDraft(key: string): ReviewDraft {
  try {
    const raw = safeLocalStorageGetItem(key)
    if (!raw) return EMPTY_DRAFT
    const value = JSON.parse(raw) as Partial<ReviewDraft>
    return {
      body: typeof value.body === "string" ? value.body : "",
      comments: Array.isArray(value.comments) ? value.comments : [],
    }
  } catch {
    return EMPTY_DRAFT
  }
}

/**
 * The review of a pull request that is not sent yet: its text and line
 * comments. It stays in this browser (local storage) until it is sent or
 * discarded, also after a reload.
 */
export function useReviewDraft(cwd: string, number: number) {
  const machineId = useMachineId()
  const key = `smith.github.reviewDraft:${machineId}:${cwd}:${number}`
  const cache = React.useRef<{ raw: string | null; value: ReviewDraft }>({
    raw: null,
    value: EMPTY_DRAFT,
  })
  const draft = React.useSyncExternalStore(
    (listener) => {
      draftListeners.add(listener)
      return () => draftListeners.delete(listener)
    },
    () => {
      const raw = safeLocalStorageGetItem(key)
      if (raw !== cache.current.raw) {
        cache.current = { raw, value: readDraft(key) }
      }
      return cache.current.value
    }
  )
  const update = React.useCallback(
    (change: (current: ReviewDraft) => ReviewDraft) => {
      const next = change(readDraft(key))
      safeLocalStorageSetItem(
        key,
        next.body || next.comments.length > 0 ? JSON.stringify(next) : ""
      )
      for (const listener of draftListeners) listener()
    },
    [key]
  )
  return {
    draft,
    setBody: (body: string) => update((current) => ({ ...current, body })),
    addComment: (comment: Omit<DraftComment, "id">) =>
      update((current) => ({
        ...current,
        comments: [
          ...current.comments,
          { ...comment, id: `${Date.now()}:${current.comments.length}` },
        ],
      })),
    removeComment: (id: string) =>
      update((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== id),
      })),
    clear: () => update(() => EMPTY_DRAFT),
  }
}

export type ReviewDraftApi = ReturnType<typeof useReviewDraft>
