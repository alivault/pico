import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  ServerIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

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
import {
  formatDisplayPath,
  formatFolderName,
  useLatestRef,
  useStableEvent,
} from "@/features/pico/app-shell-common"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import type { PendingQueueSaveRow } from "@/features/pico/pending-queue"
import {
  useMachineReadOnly,
  useMachines,
  type MachineInfo,
} from "@/features/pico/machine-store"
import { useHasMachineGroups } from "@/features/pico/machines"
import { openMachine } from "@/lib/pico/machine"
import { NewAgentWorktreeToggle } from "@/features/pico/agent/worktree-toggle"
import { ProfilePicker } from "@/features/pico/agent/profiles"
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
import type { AgentState, StreamingBehavior } from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"
import type {
  FileCompletionsResponse,
  GitActionResponse,
  GitChangesResponse,
  GitLocalBranch,
  GitStatusResponse,
  PathCompletionsResponse,
} from "@/lib/pico/api"
import { useMachineId } from "@/lib/pico/machine-context"

type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>

function useAppShellComposerSnapshot(
  store: PicoStore<AppShellComposerSnapshot>
) {
  return useSelector(store)
}

function gitStatusQueryOptions({
  machineId,
  cwd,
  viewerContextId,
}: {
  machineId: string
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitStatusData>(
        buildRequestUrl(`/api/git-status?cwd=${encodeURIComponent(cwd)}`, {
          machineId,
          contextId: viewerContextId,
        })
      ),
    staleTime: 30_000,
    gcTime: 600_000,
  }
}

function gitBranchesQueryOptions({
  machineId,
  cwd,
  viewerContextId,
}: {
  machineId: string
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(
          `/api/git-changes?cwd=${encodeURIComponent(cwd)}&gitScope=branches`,
          { machineId, contextId: viewerContextId }
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

/**
 * The projects of another machine in the new-agent project picker.
 * A choice opens that machine and starts the agent there; the prompt
 * draft goes with it.
 */
function OtherMachineProjectGroup({
  machine,
  onSelect,
}: {
  machine: MachineInfo
  onSelect: (project: string) => void
}) {
  const online = machine.state === "online"
  const projects = machine.summary?.projects ?? []
  return (
    <DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <ServerIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{machine.label}</span>
        {online ? null : (
          <span className="ml-auto text-xs font-normal">Offline</span>
        )}
      </DropdownMenuLabel>
      {projects.map((project) => (
        <DropdownMenuItem
          key={project}
          disabled={!online}
          onClick={() => onSelect(project)}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate">{formatFolderName(project)}</span>
            <span className="truncate text-xs text-muted-foreground">
              {project}
            </span>
          </div>
        </DropdownMenuItem>
      ))}
      {online ? (
        <DropdownMenuItem
          onClick={() =>
            openMachine(machine.id, { action: { type: "add-project" } })
          }
        >
          <FolderPlusIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>Add project on {machine.label}…</span>
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuGroup>
  )
}

type NewAgentComposerBranchCheckoutPayload = {
  branch: string
  create?: boolean
}

export function NewAgentComposerSelectors({
  cwd,
  defaultNewAgentProject,
  projectOptions,
  onCreateAgent,
  onMoveDraftToMachine,
  onOpenAddProjectDialog,
  viewerContextId,
}: {
  cwd?: string
  defaultNewAgentProject: string
  projectOptions: Array<{ path: string; label: string }>
  onCreateAgent: (cwdOverride?: string) => void
  /** Start the agent on another machine, with the prompt draft. */
  onMoveDraftToMachine: (machineId: string, project: string) => void
  onOpenAddProjectDialog: () => void
  viewerContextId: string
}) {
  const machineId = useMachineId()
  const { machines } = useMachines()
  const hasMachineGroups = useHasMachineGroups()
  const thisMachine = machines.find((machine) => machine.id === machineId)
  const otherMachines = hasMachineGroups
    ? machines.filter((machine) => machine.id !== machineId && machine.enabled)
    : []
  const queryClient = useQueryClient()
  const [createBranchOpen, setCreateBranchOpen] = React.useState(false)
  const [createBranchName, setCreateBranchName] = React.useState("")
  const selectedProject = cwd?.trim() || defaultNewAgentProject.trim()
  const projectMenuOptions = (() => {
    const seen = new Set<string>()
    const options: Array<{ path: string; label: string }> = []
    const pushOption = (path: string, label: string) => {
      const normalizedPath = path.trim()
      if (!normalizedPath || seen.has(normalizedPath)) return
      seen.add(normalizedPath)
      options.push({ path: normalizedPath, label })
    }

    pushOption(selectedProject, "Selected project")
    for (const option of projectOptions) {
      pushOption(option.path, option.label)
    }
    return options
  })()
  const selectedProjectLabel =
    formatFolderName(selectedProject) || "Select project"
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions({
      machineId,
      cwd: selectedProject,
      viewerContextId,
    }),
    enabled: Boolean(selectedProject && viewerContextId),
    select: (data) => data.gitStatus,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const gitStatus = gitStatusQuery.data
  const branchLabel = gitStatus ? currentBranchLabel(gitStatus) : ""
  const branchQuery = useQuery({
    ...gitBranchesQueryOptions({
      machineId,
      cwd: selectedProject,
      viewerContextId,
    }),
    enabled: Boolean(selectedProject && viewerContextId && gitStatus),
    select: (data) => data.localBranches,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const localBranches = branchQuery.data || []
  const checkoutBranchMutation = useMutation({
    mutationFn: async (payload: NewAgentComposerBranchCheckoutPayload) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: selectedProject, ...payload }),
        }
      ),
    onSuccess: (_result, payload) => {
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, selectedProject),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitBranches(viewerContextId, selectedProject),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFiles(viewerContextId, selectedProject),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitCommits(viewerContextId, selectedProject),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectFileTree(
          viewerContextId,
          selectedProject
        ),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFileReviews(
          viewerContextId,
          selectedProject
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
    <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 text-muted-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label="Select the project of the new agent"
            />
          }
        >
          <FolderIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{selectedProjectLabel}</span>
          <ChevronDownIcon className="size-5 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuGroup>
            {hasMachineGroups ? (
              <DropdownMenuLabel>
                {thisMachine?.label ?? "This machine"}
              </DropdownMenuLabel>
            ) : null}
            {projectMenuOptions.map((option) => (
              <DropdownMenuItem
                key={option.path}
                onClick={() => onCreateAgent(option.path)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    {option.label}
                  </span>
                  <span className="truncate">
                    {formatDisplayPath(option.path)}
                  </span>
                </div>
                {option.path === selectedProject ? (
                  <CheckIcon className="ml-2 size-4 shrink-0" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenAddProjectDialog}>
              <FolderPlusIcon className="size-4 shrink-0" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>Add project…</span>
                <span className="truncate text-xs text-muted-foreground">
                  Search or paste a path for this new agent.
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {otherMachines.map((machine) => (
            <OtherMachineProjectGroup
              key={machine.id}
              machine={machine}
              onSelect={(project) => onMoveDraftToMachine(machine.id, project)}
            />
          ))}
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

      {gitStatus ? (
        <NewAgentWorktreeToggle
          cwd={selectedProject}
          viewerContextId={viewerContextId}
        />
      ) : null}

      <ProfilePicker cwd={selectedProject} viewerContextId={viewerContextId} />

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
              Create a branch in {formatFolderName(selectedProject)} and switch
              to it for the new agent.
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
    agentStore,
    store,
    topContent,
  }: {
    actionsRef: React.RefObject<AppShellComposerActions>
    composerPanelRef: React.RefObject<ComposerPanelHandle | null>
    contextUsageStore: ComposerContextUsageStore
    displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
    fileInputRef: React.RefObject<HTMLInputElement | null>
    agentStore: PicoStore<AgentState>
    store: PicoStore<AppShellComposerSnapshot>
    topContent?: React.ReactNode
  }) {
    const machineId = useMachineId()
    const snapshot = useAppShellComposerSnapshot(store)
    // An offline machine is read-only until it is back.
    const machineReadOnly = useMachineReadOnly()
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
      void actionsRef.current.abortAgent()
    })
    const onSavePendingQueue = useStableEvent(
      (
        rows: Array<PendingQueueSaveRow>,
        removedPendingIds: Array<string>,
        resume: boolean
      ) => {
        if (snapshotRef.current.disabled) return
        const serverRows = actionsRef.current.savePendingDraftFollowUps(rows)
        void actionsRef.current.savePendingQueue(
          serverRows,
          removedPendingIds,
          resume
        )
      }
    )
    const onHoldPendingQueue = useStableEvent(async () => {
      if (snapshotRef.current.disabled) return null
      return await actionsRef.current.holdPendingQueue()
    })
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
          machineId,
          contextId: currentSnapshot.viewerContextId,
          agentId: currentSnapshot.activeAgentId,
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
            machineId,
            contextId: currentSnapshot.viewerContextId,
            agentId: currentSnapshot.activeAgentId,
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
        activeAgentId={snapshot.activeAgentId}
        currentPendingMessages={snapshot.currentPendingMessages}
        composerLineComments={snapshot.composerLineComments}
        composerImages={snapshot.composerImages}
        composerText={snapshot.composerText}
        composerSkill={snapshot.composerSkill}
        composerSyncNonce={snapshot.composerSyncNonce}
        canStartPendingQueue={snapshot.canStartPendingQueue}
        centerMessages={centerMessages}
        contextUsageStore={contextUsageStore}
        displaySettingsStore={displaySettingsStore}
        agentStore={agentStore}
        isSubmitting={snapshot.isSubmitting}
        isCompacting={snapshot.isCompacting}
        isStreaming={snapshot.isStreaming}
        awaitingFirstTurn={snapshot.awaitingFirstTurn}
        disabled={snapshot.disabled || machineReadOnly}
        flush={Boolean(topContent)}
        topContent={topContent}
        viewerContextId={snapshot.viewerContextId}
        fileInputRef={fileInputRef}
        onComposerTextChange={onComposerTextChange}
        onPickImages={onPickImages}
        onRemoveComposerLineComment={actionsRef.current.removeLineComment}
        onRemoveComposerImage={onRemoveComposerImage}
        onSubmitPrompt={onSubmitPrompt}
        onAbort={onAbort}
        onSavePendingQueue={onSavePendingQueue}
        onHoldPendingQueue={onHoldPendingQueue}
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
