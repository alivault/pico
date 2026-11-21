/**
 * The data of the pull requests in the GitHub tab: the list, one pull
 * request with its checks, reviews and threads, its diff, the log of a
 * failed check, and the pull request of each branch (for the agent header).
 * Read only in this step.
 */
import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { emitSmithEvent, useSmithEvent } from "@/features/smith/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useMachineFeature } from "@/features/smith/machine-store"
import { smithQueryKeys } from "@/features/smith/query-keys"
import type {
  GhBranchPrsResponse,
  GhCheckSummary,
  GhPr,
  GhPrCheckLogResponse,
  GhPrDiffResponse,
  GhPrResponse,
  GhPrSummary,
  GhPrsResponse,
} from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"

export type PrFilter = "mine" | "review" | "open"
type GhPrsData = Extract<GhPrsResponse, { ok: true }>
type GhPrData = Extract<GhPrResponse, { ok: true }>
type GhPrDiffData = Extract<GhPrDiffResponse, { ok: true }>
type GhPrCheckLogData = Extract<GhPrCheckLogResponse, { ok: true }>
type GhBranchPrsData = Extract<GhBranchPrsResponse, { ok: true }>

const PRS_STALE_MS = 30_000
const BRANCH_PRS_REFRESH_MS = 60_000
/** With live refresh, the server sends `github_changed`; this is a fallback. */
const BRANCH_PRS_LIVE_REFRESH_MS = 5 * 60_000

function useGet() {
  const machineId = useMachineId()
  return <T>(viewerContextId: string, path: string, params: URLSearchParams) =>
    fetchJson<T>(
      buildRequestUrl(`${path}?${params.toString()}`, {
        machineId,
        contextId: viewerContextId,
      })
    )
}

/** The open pull requests of one filter. Keeps the old list while a new one loads. */
export function usePrList({
  viewerContextId,
  cwd,
  filter,
  search,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  filter: PrFilter
  search: string
  enabled: boolean
}) {
  const get = useGet()
  return useQuery({
    queryKey: smithQueryKeys.ghPrList(viewerContextId, cwd, filter, search),
    queryFn: async () => {
      const params = new URLSearchParams({ cwd, filter })
      if (search) params.set("search", search)
      return (await get<GhPrsData>(viewerContextId, "/api/gh-prs", params)).prs
    },
    enabled: Boolean(enabled && viewerContextId && cwd),
    staleTime: PRS_STALE_MS,
    placeholderData: (previous) => previous,
  })
}

/** A pull request from a list, while the full one loads. */
function findListedPr(
  queryClient: ReturnType<typeof useQueryClient>,
  viewerContextId: string,
  cwd: string,
  number: number
) {
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: smithQueryKeys.ghPrs(viewerContextId, cwd),
  })) {
    const data = query.state.data
    if (query.queryKey[4] !== "list" || !Array.isArray(data)) continue
    const found = (data as Array<GhPrSummary>).find(
      (item) => item.number === number
    )
    if (found) return found
  }
  return undefined
}

export type ShownPr = GhPr & { partial?: boolean }

export function usePr({
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
  const get = useGet()
  const queryClient = useQueryClient()
  return useQuery<ShownPr>({
    queryKey: smithQueryKeys.ghPr(viewerContextId, cwd, number),
    queryFn: async () =>
      (
        await get<GhPrData>(
          viewerContextId,
          "/api/gh-pr",
          new URLSearchParams({ cwd, number: String(number) })
        )
      ).pr,
    enabled: Boolean(enabled && viewerContextId && cwd),
    staleTime: PRS_STALE_MS,
    placeholderData: () => {
      const summary = findListedPr(queryClient, viewerContextId, cwd, number)
      return summary
        ? {
            ...summary,
            partial: true,
            body: "",
            createdAt: "",
            mergeStateStatus: "",
            headRepositoryOwner: "",
            headRepository: "",
            isCrossRepository: false,
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            reviews: [],
            comments: [],
            checkRuns: [],
            threads: [],
            files: [],
          }
        : undefined
    },
  })
}

export function usePrDiff({
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
  const get = useGet()
  return useQuery({
    queryKey: smithQueryKeys.ghPrDiff(viewerContextId, cwd, number),
    queryFn: () =>
      get<GhPrDiffData>(
        viewerContextId,
        "/api/gh-pr/diff",
        new URLSearchParams({ cwd, number: String(number) })
      ),
    enabled: Boolean(enabled && viewerContextId && cwd),
    staleTime: PRS_STALE_MS,
  })
}

/** The query of a check log; the hand-off loads logs with it too. */
export function checkLogQueryOptions({
  machineId,
  viewerContextId,
  cwd,
  number,
  check,
}: {
  machineId: string
  viewerContextId: string
  cwd: string
  number: number
  /** The job ID of an Actions check, or its name. */
  check: string
}) {
  return {
    queryKey: smithQueryKeys.ghPrCheckLog(viewerContextId, cwd, number, check),
    queryFn: async () =>
      (
        await fetchJson<GhPrCheckLogData>(
          buildRequestUrl(
            `/api/gh-pr/check-log?${new URLSearchParams({ cwd, number: String(number), check }).toString()}`,
            { machineId, contextId: viewerContextId }
          )
        )
      ).check,
    // A log of a finished job does not change.
    staleTime: Infinity,
    retry: false,
  }
}

export function useCheckLog({
  viewerContextId,
  cwd,
  number,
  check,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  number: number
  check: string
  enabled: boolean
}) {
  const machineId = useMachineId()
  return useQuery({
    ...checkLogQueryOptions({ machineId, viewerContextId, cwd, number, check }),
    enabled: Boolean(enabled && viewerContextId && cwd && check),
  })
}

/**
 * The pull request of each branch, for the agent header. One request for
 * all branches; the server keeps the answer 30 s. It loads again after a
 * git change or a `github_changed` event (see `use-app-shell-agent-sync.ts`),
 * and every 5 minutes (every minute on a server without live refresh).
 */
export function useBranchPrs({
  viewerContextId,
  cwd,
  branches,
  enabled,
}: {
  viewerContextId: string
  cwd: string
  branches: Array<string>
  enabled: boolean
}) {
  const get = useGet()
  const live = useMachineFeature("github-live")
  const key = [...new Set(branches)].sort().join(",")
  return useQuery({
    queryKey: smithQueryKeys.ghBranchPrs(viewerContextId, cwd, key),
    queryFn: async () =>
      (
        await get<GhBranchPrsData>(
          viewerContextId,
          "/api/gh-branch-prs",
          new URLSearchParams({ cwd, branches: key })
        )
      ).prs,
    enabled: Boolean(enabled && viewerContextId && cwd && key),
    staleTime: PRS_STALE_MS,
    refetchInterval: live ? BRANCH_PRS_LIVE_REFRESH_MS : BRANCH_PRS_REFRESH_MS,
    retry: false,
  })
}

export function checksTitle(checks: GhCheckSummary) {
  const parts = [
    checks.failed ? `${checks.failed} failed` : "",
    checks.pending ? `${checks.pending} pending` : "",
    checks.passed ? `${checks.passed} passed` : "",
    checks.skipped ? `${checks.skipped} skipped` : "",
  ].filter(Boolean)
  return parts.length > 0 ? `Checks: ${parts.join(", ")}` : "No checks"
}

// ---------------------------------------------------------------------------
// Open a pull request in the GitHub tab from elsewhere (the agent header)

let pendingOpenPr: { machineId: string; number: number; at: number } | null =
  null
/** A request that no shown tab took in this time is old. */
const OPEN_PR_TTL_MS = 10_000

/**
 * Show the GitHub tab with a pull request. The tab may mount or show after
 * this call, so the request also waits until a shown tab takes it.
 */
export function openGitHubPullRequest(machineId: string, number: number) {
  pendingOpenPr = { machineId, number, at: Date.now() }
  emitSmithEvent("smith:open-sidebar-tab", { tab: "issues" })
  emitSmithEvent("smith:open-github-pr", { machineId, number })
}

/**
 * The pull request that the GitHub tab must open, with a new value per
 * request. Only effects take a request: a tab in a hidden Activity (a
 * closed sidebar, another tab) renders but runs no effects, and a render
 * can be thrown away. Effects run again each time the tab shows.
 */
export function useRequestedPr() {
  const machineId = useMachineId()
  const [requested, setRequested] = React.useState<{
    number: number
    at: number
  } | null>(null)
  const take = React.useCallback(() => {
    const pending = pendingOpenPr
    if (!pending || pending.machineId !== machineId) return
    // Read the fields before the reset: the minifier inlines `pending` as
    // `pendingOpenPr`.
    const { number, at } = pending
    pendingOpenPr = null
    if (Date.now() - at > OPEN_PR_TTL_MS) return
    setRequested({ number, at })
  }, [machineId])
  React.useEffect(() => {
    take()
  }, [take])
  useSmithEvent("smith:open-github-pr", (detail) => {
    if (detail.machineId === machineId) take()
  })
  return requested
}
