import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  formatDisplayPath,
  formatFolderName,
  useLatestRef,
  useStableEvent,
} from "@/features/pico/app-shell-common"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  ComposerPanel,
  type ComposerPanelHandle,
} from "@/features/pico/composer-panel"
import type { ComposerContextUsageStore } from "@/features/pico/composer-context-usage-indicator"
import { picoQueryKeys } from "@/features/pico/query-keys"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type {
  AppShellComposerActions,
  AppShellComposerSnapshot,
} from "@/features/pico/app-shell-composer-state"
import type { SessionState, StreamingBehavior } from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"
import type {
  FileCompletionsResponse,
  GitActionResponse,
  GitChangesResponse,
  GitLocalBranch,
  GitStatusResponse,
  PathCompletionsResponse,
} from "@/lib/pico/api"

type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>

function useAppShellComposerSnapshot(
  store: PicoStore<AppShellComposerSnapshot>
) {
  return useSelector(store)
}

function gitStatusQueryOptions({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitStatusData>(
        buildRequestUrl(`/api/git-status?cwd=${encodeURIComponent(cwd)}`, {
          contextId: viewerContextId,
        })
      ),
    staleTime: 30_000,
    gcTime: 600_000,
  }
}

function gitBranchesQueryOptions({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(
          `/api/git-changes?cwd=${encodeURIComponent(cwd)}&gitScope=branches`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: 30_000,
    gcTime: 600_000,
  }
}

function currentBranchLabel(value: {
  branch?: string
  detached: boolean
  revision?: string
}) {
  if (value.detached)
    return value.revision ? `detached ${value.revision}` : "detached"
  return value.branch?.trim() || ""
}

function localBranchTrackText(branch: GitLocalBranch) {
  if (!branch.upstream) return ""
  if (branch.upstreamGone) return "gone"
  const ahead = Number.isInteger(branch.ahead) ? branch.ahead : 0
  const behind = Number.isInteger(branch.behind) ? branch.behind : 0
  if (ahead > 0 && behind > 0) return `ahead ${ahead}, behind ${behind}`
  if (ahead > 0) return `ahead ${ahead}`
  if (behind > 0) return `behind ${behind}`
  return "synced"
}

type NewSessionComposerBranchCheckoutPayload = {
  branch: string
  create?: boolean
}

export function NewSessionComposerSelectors({
  cwd,
  defaultNewSessionDirectory,
  directoryOptions,
  onCreateSession,
  onOpenAddDirectoryDialog,
  viewerContextId,
}: {
  cwd?: string
  defaultNewSessionDirectory: string
  directoryOptions: Array<{ path: string; label: string }>
  onCreateSession: (cwdOverride?: string) => void
  onOpenAddDirectoryDialog: () => void
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const [createBranchOpen, setCreateBranchOpen] = React.useState(false)
  const [createBranchName, setCreateBranchName] = React.useState("")
  const selectedDirectory = cwd?.trim() || defaultNewSessionDirectory.trim()
  const directoryMenuOptions = (() => {
    const seen = new Set<string>()
    const options: Array<{ path: string; label: string }> = []
    const pushOption = (path: string, label: string) => {
      const normalizedPath = path.trim()
      if (!normalizedPath || seen.has(normalizedPath)) return
      seen.add(normalizedPath)
      options.push({ path: normalizedPath, label })
    }

    pushOption(selectedDirectory, "Selected directory")
    for (const option of directoryOptions) {
      pushOption(option.path, option.label)
    }
    return options
  })()
  const selectedDirectoryLabel =
    formatFolderName(selectedDirectory) || "Select directory"
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions({ cwd: selectedDirectory, viewerContextId }),
    enabled: Boolean(selectedDirectory && viewerContextId),
    select: (data) => data.gitStatus,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const gitStatus = gitStatusQuery.data
  const branchLabel = gitStatus ? currentBranchLabel(gitStatus) : ""
  const branchQuery = useQuery({
    ...gitBranchesQueryOptions({ cwd: selectedDirectory, viewerContextId }),
    enabled: Boolean(selectedDirectory && viewerContextId && gitStatus),
    select: (data) => data.localBranches,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const localBranches = branchQuery.data || []
  const checkoutBranchMutation = useMutation({
    mutationFn: async (payload: NewSessionComposerBranchCheckoutPayload) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: selectedDirectory, ...payload }),
        }
      ),
    onSuccess: (_result, payload) => {
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitBranches(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFiles(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitCommits(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectFileTree(
          viewerContextId,
          selectedDirectory
        ),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFileReviews(
          viewerContextId,
          selectedDirectory
        ),
      })
      setCreateBranchOpen(false)
      setCreateBranchName("")
      toast.success(
        payload.create
          ? `Created and switched to ${payload.branch}`
          : `Switched to ${payload.branch}`
      )
    },
    onError: (error, payload) => {
      toast.error(
        error instanceof Error
          ? error.message
          : payload.create
            ? "Failed to create branch"
            : "Failed to switch branch"
      )
    },
  })

  const createBranch = () => {
    const branch = createBranchName.trim()
    if (!branch || checkoutBranchMutation.isPending) return
    checkoutBranchMutation.mutate({ branch, create: true })
  }

  return (
    <div className="flex min-w-0 items-center justify-start gap-1.5 text-muted-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label="Select new session directory"
            />
          }
        >
          <FolderIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{selectedDirectoryLabel}</span>
          <ChevronDownIcon className="size-5 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {directoryMenuOptions.map((option) => (
            <DropdownMenuItem
              key={option.path}
              onClick={() => onCreateSession(option.path)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {option.label}
                </span>
                <span className="truncate">
                  {formatDisplayPath(option.path)}
                </span>
              </div>
              {option.path === selectedDirectory ? (
                <CheckIcon className="ml-2 size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenAddDirectoryDialog}>
            <FolderPlusIcon className="size-4 shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span>Add directory…</span>
              <span className="truncate text-xs text-muted-foreground">
                Search or paste a path for this new session.
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {gitStatus && branchLabel ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                aria-label="Select git branch"
                disabled={checkoutBranchMutation.isPending}
              />
            }
          >
            <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{branchLabel}</span>
            {checkoutBranchMutation.isPending ? (
              <Spinner size="md" className="shrink-0" />
            ) : (
              <ChevronDownIcon className="size-5 shrink-0" aria-hidden="true" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <DropdownMenuItem
              disabled={checkoutBranchMutation.isPending}
              onClick={() => setCreateBranchOpen(true)}
            >
              <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>Create branch…</span>
                <span className="truncate text-xs text-muted-foreground">
                  Create and switch from the current HEAD.
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {branchQuery.isPending ? (
              <DropdownMenuItem disabled>
                <Spinner />
                Loading branches…
              </DropdownMenuItem>
            ) : localBranches.length > 0 ? (
              localBranches.map((branch) => {
                const trackText = localBranchTrackText(branch)
                return (
                  <DropdownMenuItem
                    key={branch.name}
                    disabled={checkoutBranchMutation.isPending}
                    onClick={() => {
                      if (branch.current) return
                      checkoutBranchMutation.mutate({ branch: branch.name })
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{branch.name}</span>
                      {trackText || branch.subject ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {[trackText, branch.subject]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    {branch.current ? (
                      <CheckIcon className="ml-2 size-4 shrink-0" />
                    ) : null}
                  </DropdownMenuItem>
                )
              })
            ) : (
              <DropdownMenuItem disabled>No local branches.</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog
        open={createBranchOpen}
        onOpenChange={(open) => {
          setCreateBranchOpen(open)
          if (!open) setCreateBranchName("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              Create a branch in {formatFolderName(selectedDirectory)} and
              switch to it for the new session.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" action={createBranch}>
            <Input
              value={createBranchName}
              onChange={(event) => setCreateBranchName(event.target.value)}
              placeholder="branch-name"
              disabled={checkoutBranchMutation.isPending}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateBranchOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !createBranchName.trim() || checkoutBranchMutation.isPending
                }
              >
                {checkoutBranchMutation.isPending ? <Spinner /> : null}
                Create branch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const AppShellComposerController = React.memo(
  function AppShellComposerController({
    actionsRef,
    composerPanelRef,
    contextUsageStore,
    displaySettingsStore,
    fileInputRef,
    sessionStore,
    store,
    topContent,
  }: {
    actionsRef: React.RefObject<AppShellComposerActions>
    composerPanelRef: React.RefObject<ComposerPanelHandle | null>
    contextUsageStore: ComposerContextUsageStore
    displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
    fileInputRef: React.RefObject<HTMLInputElement | null>
    sessionStore: PicoStore<SessionState>
    store: PicoStore<AppShellComposerSnapshot>
    topContent?: React.ReactNode
  }) {
    const snapshot = useAppShellComposerSnapshot(store)
    const centerMessages = useSelector(
      displaySettingsStore,
      (settings) => settings.centerMessages
    )
    const snapshotRef = useLatestRef(snapshot)

    const onComposerTextChange = useStableEvent((value: string) => {
      if (snapshotRef.current.disabled) return
      actionsRef.current.syncComposerDraft(value)
    })
    const onPickImages = useStableEvent(
      (files: FileList | Array<File> | null) => {
        if (snapshotRef.current.disabled) return
        void actionsRef.current.onPickImages(files)
      }
    )
    const onRemoveComposerImage = useStableEvent((index: number) => {
      if (snapshotRef.current.disabled) return
      actionsRef.current.onRemoveComposerImage(index)
    })
    const onSubmitPrompt = useStableEvent(
      (streamingBehavior?: StreamingBehavior) => {
        if (snapshotRef.current.disabled) return
        void actionsRef.current.submitPrompt(streamingBehavior)
      }
    )
    const onAbort = useStableEvent(() => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.abortSession()
    })
    const onEditPendingMessage = useStableEvent(
      (pendingId: string, text: string) => {
        if (snapshotRef.current.disabled) return
        if (actionsRef.current.editPendingDraftFollowUp(pendingId, text)) return
        void actionsRef.current.editPendingMessage(pendingId, text)
      }
    )
    const onRemovePendingMessage = useStableEvent((pendingId: string) => {
      if (snapshotRef.current.disabled) return
      if (actionsRef.current.removePendingDraftFollowUp(pendingId)) return
      void actionsRef.current.removePendingMessage(pendingId)
    })
    const onReorderPending = useStableEvent(
      (pendingId: string, direction: -1 | 1) => {
        if (snapshotRef.current.disabled) return
        if (
          actionsRef.current.reorderPendingDraftFollowUp(pendingId, direction)
        ) {
          return
        }
        void actionsRef.current.reorderPending(pendingId, direction)
      }
    )
    const onStartPendingQueue = useStableEvent(() => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.startPendingQueue()
    })
    const onRunBuiltinSlashCommand = useStableEvent(
      (name: string, args: string) => {
        if (snapshotRef.current.disabled) return
        void actionsRef.current.runBuiltinSlashCommand(name, args)
      }
    )
    const onSelectModel = useStableEvent((value: string) => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.setModel(value)
    })
    const onSelectThinkingLevel = useStableEvent((level: string) => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.setThinkingLevel(level)
    })
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      const currentSnapshot = snapshotRef.current
      if (currentSnapshot.disabled) return []

      const response = await fetchJson<PathCompletionsResponse>(
        buildRequestUrl("/api/path-completions", {
          contextId: currentSnapshot.viewerContextId,
          sessionId: currentSnapshot.activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefix }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })
    const requestFileCompletions = useStableEvent(
      async (query: string, isQuotedPrefix: boolean) => {
        const currentSnapshot = snapshotRef.current
        if (currentSnapshot.disabled) return []

        const response = await fetchJson<FileCompletionsResponse>(
          buildRequestUrl("/api/file-completions", {
            contextId: currentSnapshot.viewerContextId,
            sessionId: currentSnapshot.activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query, isQuotedPrefix }),
          }
        )
        return isApiErrorResponse(response) ? [] : response.items
      }
    )

    return (
      <ComposerPanel
        ref={composerPanelRef}
        activeSessionId={snapshot.activeSessionId}
        currentPendingMessages={snapshot.currentPendingMessages}
        composerDiffLineComments={snapshot.composerDiffLineComments}
        composerImages={snapshot.composerImages}
        composerText={snapshot.composerText}
        composerSkill={snapshot.composerSkill}
        composerSyncNonce={snapshot.composerSyncNonce}
        canStartPendingQueue={snapshot.canStartPendingQueue}
        centerMessages={centerMessages}
        contextUsageStore={contextUsageStore}
        displaySettingsStore={displaySettingsStore}
        sessionStore={sessionStore}
        isSubmitting={snapshot.isSubmitting}
        isCompacting={snapshot.isCompacting}
        isStreaming={snapshot.isStreaming}
        awaitingFirstTurn={snapshot.awaitingFirstTurn}
        disabled={snapshot.disabled}
        flush={Boolean(topContent)}
        topContent={topContent}
        viewerContextId={snapshot.viewerContextId}
        fileInputRef={fileInputRef}
        onComposerTextChange={onComposerTextChange}
        onPickImages={onPickImages}
        onRemoveComposerDiffLineComment={
          actionsRef.current.removeDiffLineComment
        }
        onRemoveComposerImage={onRemoveComposerImage}
        onSubmitPrompt={onSubmitPrompt}
        onAbort={onAbort}
        onEditPendingMessage={onEditPendingMessage}
        onRemovePendingMessage={onRemovePendingMessage}
        onReorderPending={onReorderPending}
        onStartPendingQueue={onStartPendingQueue}
        onRunBuiltinSlashCommand={onRunBuiltinSlashCommand}
        onSelectModel={onSelectModel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        requestPathCompletions={requestPathCompletions}
        requestFileCompletions={requestFileCompletions}
      />
    )
  }
)
