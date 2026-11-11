/**
 * The data of the Issues tab: the queries, the cache of issue lists and
 * pages, the writes (they show at once, before GitHub answers), and the
 * actions that the buttons and menus share.
 */
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { copyRightSidebarTextToClipboard } from "@/features/pico/right-sidebar-git-data"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { getErrorMessage } from "@/features/pico/right-sidebar-shared"
import type {
  GhIssue,
  GhIssueComment,
  GhIssueCommentResponse,
  GhIssueCreateResponse,
  GhIssueLabelsResponse,
  GhIssueStateResponse,
  GhIssueResponse,
  GhIssueSummary,
  GhIssuesResponse,
  GhLabel,
  GhLabelsResponse,
  GhRepo,
  GhRepoResponse,
} from "@/lib/pico/api"
import { useMachineId } from "@/lib/pico/machine-context"
import { queueMachineAction } from "@/lib/pico/machine"
import { toast } from "@/lib/pico/toast"

export type IssueState = "open" | "closed" | "all"
export type GhRepoData = Extract<GhRepoResponse, { ok: true }>
export type GhIssuesData = Extract<GhIssuesResponse, { ok: true }>
export type GhLabelsData = Extract<GhLabelsResponse, { ok: true }>
export type GhIssueData = Extract<GhIssueResponse, { ok: true }>
export type GhIssueCreateData = Extract<GhIssueCreateResponse, { ok: true }>
export type GhIssueStateData = Extract<GhIssueStateResponse, { ok: true }>
export type GhIssueCommentData = Extract<GhIssueCommentResponse, { ok: true }>
export type GhIssueLabelsData = Extract<GhIssueLabelsResponse, { ok: true }>
export type AvailableRepo = Extract<GhRepo, { available: true }>

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

/** The prompt for an agent that works on an issue. */
export function issueAgentPrompt(repo: AvailableRepo, issue: GhIssue) {
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

export function issueReference(repo: AvailableRepo, issue: GhIssueSummary) {
  return `GitHub issue ${repo.nameWithOwner}#${issue.number}: ${issue.title} (${issue.url})`
}

/** A comment that is sent, but GitHub has not answered yet. */
export type ShownComment = GhIssueComment & { pending?: boolean }
export type CachedIssue = Omit<GhIssue, "comments"> & {
  comments: Array<ShownComment>
}
type QuerySnapshot = Array<[ReadonlyArray<unknown>, unknown]>

const SUMMARY_KEYS = [
  "number",
  "title",
  "state",
  "stateReason",
  "labels",
  "author",
  "commentCount",
  "createdAt",
  "updatedAt",
  "url",
] as const

function issueSummary(issue: GhIssueSummary): GhIssueSummary {
  const summary = {} as Record<string, unknown>
  for (const key of SUMMARY_KEYS) {
    if (issue[key] !== undefined) summary[key] = issue[key]
  }
  return summary as GhIssueSummary
}

/**
 * The issue caches of a project: one list for each filter, and one entry for
 * each opened issue. A change goes into all of them at once, so the panel
 * shows it before GitHub answers.
 */
export function useIssueCache(viewerContextId: string, cwd: string) {
  const queryClient = useQueryClient()
  const prefix = picoQueryKeys.ghIssues(viewerContextId, cwd)
  const queries = () =>
    queryClient.getQueryCache().findAll({ queryKey: prefix })

  const find = (number: number): GhIssueSummary | undefined => {
    const detail = queryClient.getQueryData<CachedIssue>(
      picoQueryKeys.ghIssue(viewerContextId, cwd, number)
    )
    if (detail) return detail
    for (const query of queries()) {
      const data = query.state.data
      if (!Array.isArray(data)) continue
      const found = (data as Array<GhIssueSummary>).find(
        (item) => item.number === number
      )
      if (found) return found
    }
    return undefined
  }

  /** Put the new data of an issue in its entry and in every list. */
  const apply = (
    issue: GhIssueSummary & Partial<Omit<CachedIssue, keyof GhIssueSummary>>
  ) => {
    queryClient.setQueryData<CachedIssue>(
      picoQueryKeys.ghIssue(viewerContextId, cwd, issue.number),
      (current) =>
        current
          ? {
              ...current,
              ...issue,
              comments: issue.comments ?? current.comments,
            }
          : issue.body !== undefined
            ? {
                body: "",
                assignees: [],
                ...issue,
                comments: issue.comments ?? [],
              }
            : undefined
    )
    const summary = issueSummary(issue)
    for (const query of queries()) {
      const key = query.queryKey
      if (key[4] !== "list" || !Array.isArray(query.state.data)) continue
      const [state, label, search] = key.slice(5) as [string, string, string]
      const list = query.state.data as Array<GhIssueSummary>
      const index = list.findIndex((item) => item.number === issue.number)
      // A search runs on GitHub; only change the issues that it found.
      if (search) {
        if (index < 0) continue
        queryClient.setQueryData(key, list.with(index, summary))
        continue
      }
      const belongs =
        (state === "all" || state === issue.state.toLowerCase()) &&
        (!label || issue.labels.some((item) => item.name === label))
      let next = list
      if (!belongs) {
        if (index >= 0) next = list.toSpliced(index, 1)
      } else if (index >= 0) {
        next = list.with(index, summary)
      } else {
        // The lists are newest first.
        const at = list.findIndex((item) => item.number < issue.number)
        next = list.toSpliced(at < 0 ? list.length : at, 0, summary)
      }
      if (next !== list) queryClient.setQueryData(key, next)
    }
  }

  const changeComments = (
    number: number,
    change: (comments: Array<ShownComment>) => Array<ShownComment>
  ) => {
    queryClient.setQueryData<CachedIssue>(
      picoQueryKeys.ghIssue(viewerContextId, cwd, number),
      (current) =>
        current ? { ...current, comments: change(current.comments) } : current
    )
  }

  /** Stop loads that could overwrite a change, and keep the old data. */
  const begin = async (): Promise<QuerySnapshot> => {
    await queryClient.cancelQueries({ queryKey: prefix })
    return queryClient.getQueriesData({ queryKey: prefix })
  }
  const rollBack = (snapshot: QuerySnapshot | undefined) => {
    for (const [key, data] of snapshot ?? [])
      queryClient.setQueryData(key, data)
  }

  return { find, apply, changeComments, begin, rollBack }
}

export function useIssueMutations({
  viewerContextId,
  cwd,
  viewerLogin,
}: {
  viewerContextId: string
  cwd: string
  viewerLogin: string
}) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const cache = useIssueCache(viewerContextId, cwd)
  const prefix = picoQueryKeys.ghIssues(viewerContextId, cwd)
  const mutationKey = ["pico", "gh-issue-write", viewerContextId, cwd]
  // Writes of a project run one after the other, in the order of the
  // clicks: two writes at the same time can reach GitHub in the other order
  // (add, then remove, a label). The panel shows each change at once.
  const scope = { id: `gh-issue-write:${viewerContextId}:${cwd}` }
  const post = <T>(path: string, body: Record<string, unknown>) =>
    fetchJson<T>(
      buildRequestUrl(path, { machineId, contextId: viewerContextId }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, ...body }),
      }
    )
  // The answers have the new data. Load the lists again only after the last
  // write, so that an older answer does not undo a newer change; the lists
  // can have more changes from other people.
  const onSettled = () => {
    if (queryClient.isMutating({ mutationKey }) > 1) return
    void queryClient.invalidateQueries({
      queryKey: prefix,
      predicate: (query) => query.queryKey[4] === "list",
    })
  }
  const onError = (
    error: unknown,
    _input: unknown,
    snapshot: QuerySnapshot | undefined
  ) => {
    cache.rollBack(snapshot)
    void queryClient.invalidateQueries({ queryKey: prefix })
    toast.error(getErrorMessage(error, "The GitHub request failed"))
  }

  return {
    create: useMutation({
      mutationKey,
      scope,
      mutationFn: (input: {
        title: string
        body: string
        labels: Array<string>
      }) => post<GhIssueCreateData>("/api/gh-issue/create", input),
      onSuccess: (data) => cache.apply({ ...data.issue, comments: [] }),
      onSettled,
      onError: (error) => onError(error, undefined, undefined),
    }),
    comment: useMutation({
      mutationKey,
      scope,
      mutationFn: (input: {
        number: number
        body: string
        pendingId: string
      }) =>
        post<GhIssueCommentData>("/api/gh-issue/comment", {
          number: input.number,
          body: input.body,
        }),
      onMutate: async (input) => {
        const snapshot = await cache.begin()
        const issue = cache.find(input.number)
        if (issue)
          cache.apply({ ...issue, commentCount: issue.commentCount + 1 })
        cache.changeComments(input.number, (comments) => [
          ...comments,
          {
            id: input.pendingId,
            author: viewerLogin,
            body: input.body,
            createdAt: new Date().toISOString(),
            url: "",
            pending: true,
          },
        ])
        return snapshot
      },
      onSuccess: (data, input) =>
        cache.changeComments(input.number, (comments) =>
          comments.map((item) =>
            item.id === input.pendingId ? data.comment : item
          )
        ),
      onSettled,
      onError,
    }),
    setState: useMutation({
      mutationKey,
      scope,
      mutationFn: (input: {
        number: number
        state: "open" | "closed"
        reason?: "completed" | "not planned"
      }) => post<GhIssueStateData>("/api/gh-issue/state", input),
      onMutate: async (input) => {
        const snapshot = await cache.begin()
        const issue = cache.find(input.number)
        if (issue) {
          cache.apply({
            ...issue,
            state: input.state === "open" ? "OPEN" : "CLOSED",
            stateReason:
              input.state === "open"
                ? "REOPENED"
                : input.reason === "not planned"
                  ? "NOT_PLANNED"
                  : "COMPLETED",
          })
        }
        return snapshot
      },
      onSuccess: (data, input) => {
        // Take only the state: a label write can still be on its way.
        const issue = cache.find(input.number) ?? data.issue
        cache.apply({
          ...issue,
          state: data.issue.state,
          stateReason: data.issue.stateReason,
          updatedAt: data.issue.updatedAt,
        })
      },
      onSettled,
      onError,
    }),
    editLabels: useMutation({
      mutationKey,
      scope,
      mutationFn: (input: {
        number: number
        add: Array<GhLabel>
        remove: Array<string>
      }) =>
        post<GhIssueLabelsData>("/api/gh-issue/labels", {
          number: input.number,
          addLabels: input.add.map((label) => label.name),
          removeLabels: input.remove,
        }),
      onMutate: async (input) => {
        const snapshot = await cache.begin()
        const issue = cache.find(input.number)
        if (issue) {
          const names = new Set([
            ...input.remove,
            ...input.add.map((label) => label.name),
          ])
          cache.apply({
            ...issue,
            labels: [
              ...issue.labels.filter((label) => !names.has(label.name)),
              ...input.add,
            ].sort((a, b) => a.name.localeCompare(b.name)),
          })
        }
        return snapshot
      },
      onSuccess: (data, input) => {
        const issue = cache.find(input.number)
        // Only the last write knows all the labels.
        if (
          issue &&
          data.labels &&
          queryClient.isMutating({ mutationKey }) <= 1
        )
          cache.apply({ ...issue, labels: data.labels })
      },
      onSettled,
      onError,
    }),
  }
}

export function useGitHubLabels(
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

export function issueQueryOptions({
  machineId,
  viewerContextId,
  cwd,
  number,
}: {
  machineId: string
  viewerContextId: string
  cwd: string
  number: number
}) {
  return {
    queryKey: picoQueryKeys.ghIssue(viewerContextId, cwd, number),
    queryFn: async (): Promise<CachedIssue> =>
      (
        await fetchJson<GhIssueData>(
          buildRequestUrl(
            `/api/gh-issue?cwd=${encodeURIComponent(cwd)}&number=${number}`,
            { machineId, contextId: viewerContextId }
          )
        )
      ).issue,
    staleTime: ISSUES_STALE_MS,
  }
}

/** What the issue page, its buttons, and the context menu of a row can do. */
export function useIssueActions({
  viewerContextId,
  cwd,
  repo,
  labels,
  mutations,
}: {
  viewerContextId: string
  cwd: string
  /** Absent until the repository is known; the actions wait for it. */
  repo: AvailableRepo | undefined
  labels: Array<GhLabel>
  mutations: ReturnType<typeof useIssueMutations>
}) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const name = repo?.nameWithOwner ?? ""
  const copy = async (text: string, what: string) => {
    try {
      await copyRightSidebarTextToClipboard(text)
      toast.success(`Copied the ${what}`)
    } catch (error) {
      toast.error(getErrorMessage(error, `Could not copy the ${what}`))
    }
  }
  return {
    /** A new agent with the issue as its prompt; loads the body when needed. */
    startAgent: async (issue: GhIssueSummary) => {
      if (!repo) return
      let full: CachedIssue
      try {
        full = await queryClient.fetchQuery(
          issueQueryOptions({
            machineId,
            viewerContextId,
            cwd,
            number: issue.number,
          })
        )
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load the issue"))
        return
      }
      queueMachineAction(machineId, {
        type: "new-agent",
        project: cwd,
        draft: { text: issueAgentPrompt(repo, full), images: [] },
      })
    },
    addToPrompt: (issue: GhIssueSummary) => {
      if (!repo) return
      queueMachineAction(machineId, {
        type: "insert-prompt",
        text: issueReference(repo, issue),
      })
    },
    close: (number: number, reason: "completed" | "not planned") =>
      mutations.setState.mutate({ number, state: "closed", reason }),
    reopen: (number: number) =>
      mutations.setState.mutate({ number, state: "open" }),
    toggleLabel: (issue: GhIssueSummary, name: string) => {
      const has = issue.labels.some((label) => label.name === name)
      const added = labels.find((label) => label.name === name)
      mutations.editLabels.mutate({
        number: issue.number,
        add: has || !added ? [] : [added],
        remove: has ? [name] : [],
      })
    },
    copyLink: (issue: GhIssueSummary) => void copy(issue.url, "link"),
    copyReference: (issue: GhIssueSummary) =>
      void copy(`${name}#${issue.number}`, "reference"),
  }
}

export type IssueActions = ReturnType<typeof useIssueActions>

/** The issues of one filter. Keeps the old list while a new filter loads. */
export function useIssueList({
  viewerContextId,
  cwd,
  state,
  label,
  search,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  state: IssueState
  label: string
  search: string
  enabled: boolean
}) {
  const machineId = useMachineId()
  return useQuery({
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
    enabled: Boolean(enabled && viewerContextId && cwd),
    staleTime: ISSUES_STALE_MS,
    placeholderData: (previous) => previous,
  })
}

/**
 * One issue with its body and comments. While they load, the title, state
 * and labels come from a list.
 */
export function useIssue({
  viewerContextId,
  cwd,
  number,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  number: number
  enabled: boolean
}) {
  const machineId = useMachineId()
  const cache = useIssueCache(viewerContextId, cwd)
  return useQuery<CachedIssue>({
    ...issueQueryOptions({ machineId, viewerContextId, cwd, number }),
    enabled: Boolean(enabled && viewerContextId && cwd),
    placeholderData: () => {
      const summary = cache.find(number)
      return summary
        ? { ...summary, body: "", assignees: [], comments: [] }
        : undefined
    },
  })
}

/** True while a write of the project waits for GitHub. */
export function useIssueSaving(viewerContextId: string, cwd: string) {
  return (
    useIsMutating({
      mutationKey: ["pico", "gh-issue-write", viewerContextId, cwd],
    }) > 0
  )
}
