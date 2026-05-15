import * as React from "react"
import {
  CheckIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  GitCommitIcon,
  UploadIcon,
} from "lucide-react"
import {
  useIsFetching,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { showGitPushSuccessToast } from "@/features/pico/git-toast-utils"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { GitBranchDialog } from "@/features/pico/right-sidebar-git-branch-dialog"
import { GitCommitDialog } from "@/features/pico/right-sidebar-git-commit-dialog"
import {
  gitChangesQueryOptions,
  gitStatusHasDiverged,
  gitStatusQueryOptions,
  invalidateGitQueries,
  selectGitFiles,
  selectGitStatusSummary,
} from "@/features/pico/right-sidebar-git-data"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import {
  formatDisplayPath,
  formatFolderName,
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  GitRemoteAction,
  GitScopedProps,
} from "@/features/pico/right-sidebar-types"
import type { GitActionResponse } from "@/lib/pico/api"

export function GitPanelErrorToasts({
  viewerContextId,
  cwd,
  active,
}: GitScopedProps) {
  const normalizedCwd = normalizeCwd(cwd)
  const enabled = Boolean(active && viewerContextId && normalizedCwd)
  const statusErrorQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })
  const filesErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })
  const branchesErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "branches",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })
  const commitsErrorQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
    }),
    enabled,
    notifyOnChangeProps: ["error", "errorUpdatedAt"],
  })

  React.useEffect(() => {
    if (!active) return

    const error =
      filesErrorQuery.error ||
      branchesErrorQuery.error ||
      commitsErrorQuery.error ||
      statusErrorQuery.error
    if (!error) return

    toast.error(getErrorMessage(error, "Failed to load git view"))
  }, [
    active,
    branchesErrorQuery.error,
    branchesErrorQuery.errorUpdatedAt,
    commitsErrorQuery.error,
    commitsErrorQuery.errorUpdatedAt,
    filesErrorQuery.error,
    filesErrorQuery.errorUpdatedAt,
    statusErrorQuery.error,
    statusErrorQuery.errorUpdatedAt,
  ])

  return null
}

function GitRepositorySummary({
  viewerContextId,
  cwd,
  active,
  onBranchClick,
}: GitScopedProps & {
  onBranchClick?: () => void
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const enabled = Boolean(active && viewerContextId && normalizedCwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled,
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })

  if (!normalizedCwd) {
    return <GitSectionNote>No directory selected.</GitSectionNote>
  }

  if (!viewerContextId) {
    return <GitSectionNote>Waiting for viewer context…</GitSectionNote>
  }

  if (statusQuery.isPending && typeof statusQuery.data === "undefined") {
    return (
      <GitSectionNote>
        <Spinner /> Loading repository status…
      </GitSectionNote>
    )
  }

  if (statusQuery.error) {
    return (
      <GitSectionNote tone="destructive">
        {getErrorMessage(statusQuery.error, "Failed to load repository status")}
      </GitSectionNote>
    )
  }

  const gitStatus = statusQuery.data
  if (!gitStatus) {
    return <GitSectionNote>No git repository detected.</GitSectionNote>
  }

  const branchLabel = gitStatus.detached
    ? `Detached HEAD${gitStatus.revision ? ` (${gitStatus.revision})` : ""}`
    : gitStatus.branch || gitStatus.label

  const folderName = formatFolderName(normalizedCwd)
  const synced = gitStatus.ahead === 0 && gitStatus.behind === 0
  const title = [formatDisplayPath(normalizedCwd), gitStatus.title]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-xs leading-5"
      title={title}
    >
      {synced ? (
        <CheckIcon className="size-3 shrink-0 text-emerald-500" />
      ) : null}
      {gitStatus.behind > 0 ? (
        <span className="shrink-0 font-medium text-sky-500 tabular-nums">
          ↓{gitStatus.behind}
        </span>
      ) : null}
      {gitStatus.ahead > 0 ? (
        <span className="shrink-0 font-medium text-amber-500 tabular-nums">
          ↑{gitStatus.ahead}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-medium">
        {folderName || "No cwd"}
      </span>
      {branchLabel ? (
        <>
          <span className="shrink-0 text-muted-foreground">→</span>
          {onBranchClick ? (
            <button
              type="button"
              aria-label="Switch branch"
              className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onBranchClick}
            >
              <span className="min-w-0 truncate">{branchLabel}</span>
              <ChevronsUpDownIcon className="size-3 shrink-0" />
            </button>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground">
              {branchLabel}
            </span>
          )}
        </>
      ) : null}
    </div>
  )
}

export function GitPanelToolbar({
  viewerContextId,
  cwd,
  active,
}: GitScopedProps) {
  const queryClient = useQueryClient()
  const normalizedCwd = normalizeCwd(cwd)
  const [branchDialogOpen, setBranchDialogOpen] = React.useState(false)
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const statusFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitStatus(viewerContextId, normalizedCwd),
    exact: true,
  })
  const filesFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitFiles(viewerContextId, normalizedCwd),
    exact: true,
  })
  const branchesFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitBranches(viewerContextId, normalizedCwd),
    exact: true,
  })
  const commitsFetchCount = useIsFetching({
    queryKey: picoQueryKeys.gitCommits(viewerContextId, normalizedCwd),
    exact: false,
  })
  const refreshing =
    statusFetchCount +
      filesFetchCount +
      branchesFetchCount +
      commitsFetchCount >
    0

  const gitStatus = statusQuery.data
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : []
  const hasRepository = Boolean(gitStatus)
  const hasChanges = Boolean(gitStatus?.dirty || files.length > 0)
  const canPush = Boolean(
    hasRepository && !gitStatus?.detached && (gitStatus?.ahead || 0) > 0
  )
  const canForcePush = gitStatusHasDiverged(gitStatus)
  const canPull = Boolean(
    hasRepository && !gitStatus?.detached && (gitStatus?.behind || 0) > 0
  )

  const gitActionMutation = useMutation({
    mutationFn: async (action: GitRemoteAction) => {
      const endpoint = action === "pull" ? "/api/git-pull" : "/api/git-push"
      return await fetchJson<GitActionResponse>(
        buildRequestUrl(endpoint, { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: normalizedCwd,
            force: action === "force-push",
          }),
        }
      )
    },
    onSuccess: async (response, action) => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, normalizedCwd),
        exact: true,
        refetchType: "active",
      })
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
      if (action !== "pull") {
        showGitPushSuccessToast({
          response,
          force: action === "force-push",
        })
      }
    },
    onError: (error, action) => {
      toast.error(
        getErrorMessage(
          error,
          action === "pull"
            ? "Failed to pull changes"
            : action === "force-push"
              ? "Failed to force push changes"
              : "Failed to push changes"
        )
      )
    },
  })

  const shortcutPushMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "push"
    ),
  })
  const shortcutForcePushMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "force-push"
    ),
  })
  const shortcutPullMutatingCount = useIsMutating({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      normalizedCwd,
      "pull"
    ),
  })
  const pushing =
    (gitActionMutation.isPending && gitActionMutation.variables === "push") ||
    shortcutPushMutatingCount > 0
  const forcePushing =
    (gitActionMutation.isPending &&
      gitActionMutation.variables === "force-push") ||
    shortcutForcePushMutatingCount > 0
  const pulling =
    (gitActionMutation.isPending && gitActionMutation.variables === "pull") ||
    shortcutPullMutatingCount > 0
  const gitActionBusy =
    gitActionMutation.isPending || pushing || forcePushing || pulling
  const showCommitAction = Boolean(
    viewerContextId && normalizedCwd && hasChanges
  )
  const showPushAction = Boolean(
    viewerContextId && normalizedCwd && canPush && (!gitActionBusy || pushing)
  )
  const showForcePushAction = Boolean(
    viewerContextId &&
    normalizedCwd &&
    canForcePush &&
    (!gitActionBusy || forcePushing)
  )
  const showPullAction = Boolean(
    viewerContextId && normalizedCwd && canPull && (!gitActionBusy || pulling)
  )
  const showActions =
    showCommitAction || showPushAction || showForcePushAction || showPullAction

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <GitRepositorySummary
          viewerContextId={viewerContextId}
          cwd={normalizedCwd}
          active={active}
          onBranchClick={() => {
            setBranchDialogOpen(true)
          }}
        />
        {active && refreshing ? (
          <Spinner className="size-3 shrink-0 text-primary" />
        ) : null}
      </div>

      {showActions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showCommitAction ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="outline"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon /> Commit…
              </Button>
            </TitleTooltip>
          ) : null}
          {showPushAction ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="outline"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("push")
                }}
              >
                {pushing ? <Spinner /> : <UploadIcon />}
                Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showForcePushAction ? (
            <TitleTooltip
              title="Force push"
              kbd={formatShortcutLabel("Control+Shift+P")}
            >
              <Button
                variant="outline"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("force-push")
                }}
              >
                {forcePushing ? <Spinner /> : <UploadIcon />}
                Force Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showPullAction ? (
            <TitleTooltip title="Pull" kbd={formatShortcutLabel("Alt+P")}>
              <Button
                variant="outline"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("pull")
                }}
              >
                {pulling ? <Spinner /> : <DownloadIcon />}
                Pull
              </Button>
            </TitleTooltip>
          ) : null}
        </div>
      ) : null}

      <GitBranchDialog
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        active={active}
        gitStatus={gitStatus}
        open={branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
      />
      <GitCommitDialog
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        files={files}
        gitStatus={gitStatus}
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
      />
    </div>
  )
}
