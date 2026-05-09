import * as React from "react"
import { DownloadIcon, GitCommitIcon, UploadIcon } from "lucide-react"
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { showGitPushSuccessToast } from "@/features/pico/git-toast-utils"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { GitCommitDialog } from "@/features/pico/right-sidebar-git-commit-dialog"
import {
  formatGitWorkingTreeSummary,
  formatHeaderGitStatusText,
  gitChangesQueryOptions,
  gitStatusHasDiverged,
  gitStatusQueryOptions,
  invalidateGitQueries,
  selectGitFiles,
  selectGitStatusSummary,
} from "@/features/pico/right-sidebar-git-data"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type { GitRemoteAction } from "@/features/pico/right-sidebar-types"
import type { GitActionResponse } from "@/lib/pico/api"
import { useIsMobile } from "@/hooks/use-mobile"

export function GitTabStatusText({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: (data) =>
      data.gitStatus === null
        ? "Files"
        : formatGitWorkingTreeSummary(data.gitStatus) || "Changes",
    notifyOnChangeProps: ["data"],
  })
  const text = statusQuery.data || "Changes"

  return <span className="max-w-48 truncate">{text}</span>
}

export function HeaderGitStatusText({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const text = formatHeaderGitStatusText(statusQuery.data)

  if (!text) return null

  return (
    <span
      className="inline-flex items-center text-xs text-muted-foreground"
      title={statusQuery.data?.title || text}
    >
      <span>{text}</span>
    </span>
  )
}

export function HeaderGitActions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const queryClient = useQueryClient()
  const normalizedCwd = normalizeCwd(cwd)
  const isMobile = useIsMobile()
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const gitStatus = statusQuery.data
  const hasRepository = Boolean(gitStatus)
  const canCommit = Boolean(
    viewerContextId && normalizedCwd && gitStatus?.dirty
  )
  const canPush = Boolean(
    viewerContextId &&
    normalizedCwd &&
    hasRepository &&
    !gitStatus?.detached &&
    (gitStatus?.ahead || 0) > 0
  )
  const canForcePush =
    Boolean(viewerContextId && normalizedCwd) && gitStatusHasDiverged(gitStatus)
  const canPull = Boolean(
    viewerContextId &&
    normalizedCwd &&
    hasRepository &&
    !gitStatus?.detached &&
    (gitStatus?.behind || 0) > 0
  )
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(canCommit),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : []

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
  const showMobilePush =
    isMobile && !canCommit && canPush && (!gitActionBusy || pushing)
  const showPush = !isMobile && canPush && (!gitActionBusy || pushing)
  const showForcePush =
    !isMobile && canForcePush && (!gitActionBusy || forcePushing)
  const showPull = !isMobile && canPull && (!gitActionBusy || pulling)
  const showActions =
    canCommit || showMobilePush || showPush || showForcePush || showPull

  if (!showActions && !commitDialogOpen) return null

  return (
    <>
      {showActions ? (
        <div className="flex items-center gap-1">
          {canCommit ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Commit changes"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon />
              </Button>
            </TitleTooltip>
          ) : null}
          {canCommit ? (
            <TitleTooltip title="Commit" kbd={formatShortcutLabel("Control+C")}>
              <Button
                variant="ghost"
                className="hidden md:inline-flex"
                onClick={() => {
                  setCommitDialogOpen(true)
                }}
              >
                <GitCommitIcon /> Commit…
              </Button>
            </TitleTooltip>
          ) : null}
          {showMobilePush ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Push changes"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("push")
                }}
              >
                {pushing ? <Spinner /> : <UploadIcon />}
              </Button>
            </TitleTooltip>
          ) : null}
          {showPush ? (
            <TitleTooltip title="Push" kbd={formatShortcutLabel("Control+P")}>
              <Button
                variant="ghost"
                className="hidden md:inline-flex"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("push")
                }}
              >
                {pushing ? <Spinner /> : <UploadIcon />} Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showForcePush ? (
            <TitleTooltip
              title="Force push"
              kbd={formatShortcutLabel("Control+Shift+P")}
            >
              <Button
                variant="ghost"
                className="hidden md:inline-flex"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("force-push")
                }}
              >
                {forcePushing ? <Spinner /> : <UploadIcon />} Force Push
              </Button>
            </TitleTooltip>
          ) : null}
          {showPull ? (
            <TitleTooltip title="Pull" kbd={formatShortcutLabel("Alt+P")}>
              <Button
                variant="ghost"
                className="hidden md:inline-flex"
                disabled={gitActionBusy}
                onClick={() => {
                  gitActionMutation.mutate("pull")
                }}
              >
                {pulling ? <Spinner /> : <DownloadIcon />} Pull
              </Button>
            </TitleTooltip>
          ) : null}
        </div>
      ) : null}
      <GitCommitDialog
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        files={files}
        gitStatus={gitStatus}
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
      />
    </>
  )
}

export function DraftGitStatusBadge({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })

  if (!statusQuery.data?.label) return null

  return <Badge variant="outline">{statusQuery.data.label}</Badge>
}
