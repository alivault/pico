import * as React from "react"
import { ArrowLeftIcon, CheckIcon, GitBranchIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import {
  formatGitRelativeDateCompact,
  gitChangesQueryOptions,
  gitLocalBranchesForRender,
  gitLocalBranchTrackClass,
  gitLocalBranchTrackText,
  gitRemoteBranchParts,
  invalidateGitQueries,
} from "@/features/pico/right-sidebar-git-data"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  GitScopedProps,
  GitStatusValue,
} from "@/features/pico/right-sidebar-types"
import type {
  GitActionResponse,
  GitLocalBranch,
  GitRemoteBranch,
} from "@/lib/pico/api"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

type GitBranchDialogStage = "browse" | "create"

type GitBranchDialogState = {
  query: string
  stage: GitBranchDialogStage
  selectedValue: string
  createBranchName: string
}

type GitBranchDialogAction =
  | { type: "reset" }
  | { type: "set-query"; query: string }
  | { type: "set-stage"; stage: GitBranchDialogStage }
  | { type: "set-selected-value"; selectedValue: string }
  | { type: "set-create-branch-name"; createBranchName: string }

const initialGitBranchDialogState = {
  query: "",
  stage: "browse",
  selectedValue: "",
  createBranchName: "",
} satisfies GitBranchDialogState

function gitBranchDialogReducer(
  state: GitBranchDialogState,
  action: GitBranchDialogAction
): GitBranchDialogState {
  switch (action.type) {
    case "reset":
      return initialGitBranchDialogState
    case "set-query":
      return { ...state, query: action.query }
    case "set-stage":
      return { ...state, stage: action.stage }
    case "set-selected-value":
      return { ...state, selectedValue: action.selectedValue }
    case "set-create-branch-name":
      return { ...state, createBranchName: action.createBranchName }
  }
}

function GitBranchDialogKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

type GitCheckoutBranchPayload = {
  branch: string
  create?: boolean
  startPoint?: string
  track?: boolean
}

function getInitialBranchSelection({
  localBranches,
  remoteBranches,
}: {
  localBranches: GitLocalBranch[]
  remoteBranches: GitRemoteBranch[]
}) {
  const currentBranch = localBranches.find((branch) => branch.current)
  if (currentBranch) return `local:${currentBranch.name}`
  if (localBranches[0]) return `local:${localBranches[0].name}`
  if (remoteBranches[0]) return `remote:${remoteBranches[0].name}`
  return "action:create"
}

type GitBranchBrowseProps = {
  query: string
  selectedValue: string
  localBranches: GitLocalBranch[]
  remoteBranches: GitRemoteBranch[]
  localBranchNames: Set<string>
  branchesPending: boolean
  checkoutPending: boolean
  isMobile: boolean
  onQueryChange: (query: string) => void
  onSelectedValueChange: (selectedValue: string) => void
  onCreateStage: () => void
  onSwitchLocalBranch: (branch: GitLocalBranch) => void
  onSwitchRemoteBranch: (branch: GitRemoteBranch) => void
}

function GitBranchBrowse({
  query,
  selectedValue,
  localBranches,
  remoteBranches,
  localBranchNames,
  branchesPending,
  checkoutPending,
  isMobile,
  onQueryChange,
  onSelectedValueChange,
  onCreateStage,
  onSwitchLocalBranch,
  onSwitchRemoteBranch,
}: GitBranchBrowseProps) {
  return (
    <Command
      shouldFilter
      loop
      value={selectedValue}
      onValueChange={onSelectedValueChange}
      onKeyDown={(event) => {
        if (matchesShortcutEvent(event.nativeEvent, "Control+N")) {
          event.preventDefault()
          onCreateStage()
        }
      }}
      className="min-h-0 flex-1"
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        placeholder="Search branches"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,28rem)]">
        <CommandEmpty>
          {branchesPending ? "Loading branches…" : "No branches found."}
        </CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            value="action:create"
            keywords={["new", "create", "branch"]}
            onSelect={onCreateStage}
          >
            <GitBranchIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">Create new branch…</span>
            <CommandShortcut>
              {formatShortcutLabel("Control+N")}
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <GitBranchLocalGroup
          branches={localBranches}
          branchesPending={branchesPending}
          checkoutPending={checkoutPending}
          onSwitchBranch={onSwitchLocalBranch}
        />
        <GitBranchRemoteGroup
          branches={remoteBranches}
          localBranchNames={localBranchNames}
          checkoutPending={checkoutPending}
          onSwitchBranch={onSwitchRemoteBranch}
        />
      </CommandList>
      {isMobile ? null : <GitBranchBrowseShortcuts />}
    </Command>
  )
}

type GitBranchLocalGroupProps = {
  branches: GitLocalBranch[]
  branchesPending: boolean
  checkoutPending: boolean
  onSwitchBranch: (branch: GitLocalBranch) => void
}

function GitBranchLocalGroup({
  branches,
  branchesPending,
  checkoutPending,
  onSwitchBranch,
}: GitBranchLocalGroupProps) {
  return (
    <CommandGroup heading={`Local branches · ${branches.length}`}>
      {branchesPending && branches.length === 0 ? (
        <CommandItem value="loading:branches" disabled>
          <Spinner className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Loading branches…</span>
        </CommandItem>
      ) : null}
      {branches.map((branch) => {
        const trackText = gitLocalBranchTrackText(branch)
        const relativeDateText = branch.current
          ? "current"
          : formatGitRelativeDateCompact(branch.relativeDate)
        const title =
          [branch.name, branch.upstream, branch.subject]
            .filter(Boolean)
            .join(" · ") || branch.name

        return (
          <CommandItem
            key={branch.name}
            value={`local:${branch.name}`}
            keywords={[
              branch.name,
              branch.upstream ?? "",
              branch.subject ?? "",
            ]}
            disabled={checkoutPending}
            onSelect={() => onSwitchBranch(branch)}
            className="items-start py-2"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {branch.current ? (
                <CheckIcon className="size-3.5 text-emerald-500" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1" title={title}>
              <div className="truncate font-mono text-[13px] font-medium">
                {branch.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {[branch.upstream, branch.subject]
                  .filter(Boolean)
                  .join(" · ") || "Local branch"}
              </div>
            </div>
            <CommandShortcut
              className={cn(
                "shrink-0 tracking-normal normal-case",
                trackText && gitLocalBranchTrackClass(branch, trackText)
              )}
            >
              {trackText || relativeDateText}
            </CommandShortcut>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

type GitBranchRemoteGroupProps = {
  branches: GitRemoteBranch[]
  localBranchNames: Set<string>
  checkoutPending: boolean
  onSwitchBranch: (branch: GitRemoteBranch) => void
}

function GitBranchRemoteGroup({
  branches,
  localBranchNames,
  checkoutPending,
  onSwitchBranch,
}: GitBranchRemoteGroupProps) {
  return (
    <CommandGroup heading={`Remote branches · ${branches.length}`}>
      {branches.map((branch) => {
        const parts = gitRemoteBranchParts(branch.name)
        const localName = parts.branch || branch.name
        const localExists = localBranchNames.has(localName)

        return (
          <CommandItem
            key={branch.name}
            value={`remote:${branch.name}`}
            keywords={[branch.name, localName, branch.subject ?? ""]}
            disabled={checkoutPending}
            onSelect={() => onSwitchBranch(branch)}
            className="items-start py-2"
          >
            <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1" title={branch.name}>
              <div className="truncate font-mono text-[13px] font-medium">
                {parts.remote ? (
                  <span className="text-muted-foreground/70">
                    {parts.remote}/
                  </span>
                ) : null}
                {parts.branch || branch.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {branch.subject || "Remote branch"}
              </div>
            </div>
            <CommandShortcut className="shrink-0 tracking-normal normal-case">
              {localExists ? "Switch" : "Track"}
            </CommandShortcut>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

function GitBranchBrowseShortcuts() {
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
      <span className="inline-flex items-center gap-1">
        <GitBranchDialogKbd>Enter</GitBranchDialogKbd> Switch
      </span>
      <span className="inline-flex items-center gap-1">
        <GitBranchDialogKbd>
          {formatShortcutLabel("Control+N")}
        </GitBranchDialogKbd>{" "}
        New branch
      </span>
      <span className="inline-flex items-center gap-1">
        <GitBranchDialogKbd>Esc</GitBranchDialogKbd> Close
      </span>
    </div>
  )
}

type GitBranchCreateProps = {
  createBranchName: string
  checkoutPending: boolean
  isMobile: boolean
  onBranchNameChange: (branchName: string) => void
  onBrowseStage: () => void
  onCreateBranch: () => void
}

function GitBranchCreate({
  createBranchName,
  checkoutPending,
  isMobile,
  onBranchNameChange,
  onBrowseStage,
  onCreateBranch,
}: GitBranchCreateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBrowseStage}
          aria-label="Back to branches"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Create branch</div>
          <div className="truncate text-xs text-muted-foreground">
            From the current HEAD
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-2 p-3">
        <Input
          value={createBranchName}
          onChange={(event) => onBranchNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              onBrowseStage()
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            onCreateBranch()
          }}
          placeholder="branch-name"
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          disabled={!createBranchName.trim() || checkoutPending}
          onClick={onCreateBranch}
        >
          {checkoutPending ? <Spinner /> : null}
          Create
        </Button>
      </div>
      {isMobile ? null : <GitBranchCreateShortcuts />}
    </div>
  )
}

function GitBranchCreateShortcuts() {
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
      <span className="inline-flex items-center gap-1">
        <GitBranchDialogKbd>Enter</GitBranchDialogKbd> Create
      </span>
      <span className="inline-flex items-center gap-1">
        <GitBranchDialogKbd>Esc</GitBranchDialogKbd> Back
      </span>
    </div>
  )
}

function GitBranchDialogBody({
  stage,
  createBranchName,
  checkoutPending,
  isMobile,
  browseProps,
  onBranchNameChange,
  onBrowseStage,
  onCreateBranch,
}: {
  stage: GitBranchDialogStage
  createBranchName: string
  checkoutPending: boolean
  isMobile: boolean
  browseProps: GitBranchBrowseProps
  onBranchNameChange: (branchName: string) => void
  onBrowseStage: () => void
  onCreateBranch: () => void
}) {
  if (stage === "create") {
    return (
      <GitBranchCreate
        createBranchName={createBranchName}
        checkoutPending={checkoutPending}
        isMobile={isMobile}
        onBranchNameChange={onBranchNameChange}
        onBrowseStage={onBrowseStage}
        onCreateBranch={onCreateBranch}
      />
    )
  }

  return <GitBranchBrowse {...browseProps} />
}

export function GitBranchDialog({
  viewerContextId,
  cwd,
  active,
  gitStatus,
  open,
  onOpenChange,
}: GitScopedProps & {
  gitStatus: GitStatusValue | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const normalizedCwd = normalizeCwd(cwd)
  const [dialogState, dispatch] = React.useReducer(
    gitBranchDialogReducer,
    initialGitBranchDialogState
  )
  const branchesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "branches",
    }),
    enabled: Boolean(open && active && viewerContextId && normalizedCwd),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const branchData = branchesQuery.data
  const localBranches = gitLocalBranchesForRender(
    branchData?.localBranches,
    gitStatus
  )
  const remoteBranches = (branchData?.remoteBranches ?? []).filter(
    (branch) => !branch.name.endsWith("/HEAD")
  )
  const localBranchNames = new Set(localBranches.map((branch) => branch.name))
  const selectedValue =
    dialogState.selectedValue ||
    getInitialBranchSelection({ localBranches, remoteBranches })

  React.useEffect(() => {
    if (!open) dispatch({ type: "reset" })
  }, [open])

  const checkoutMutation = useMutation({
    mutationFn: async (payload: GitCheckoutBranchPayload) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: normalizedCwd, ...payload }),
        }
      ),
    onSuccess: async (_response, payload) => {
      await invalidateGitQueries({
        queryClient,
        viewerContextId,
        cwd: normalizedCwd,
      })
      onOpenChange(false)
      toast.success(
        payload.create
          ? `Created and switched to ${payload.branch}`
          : `Switched to ${payload.branch}`
      )
    },
    onError: (error, payload) => {
      toast.error(
        getErrorMessage(
          error,
          payload.create ? "Failed to create branch" : "Failed to switch branch"
        )
      )
    },
  })

  const switchLocalBranch = (branch: GitLocalBranch) => {
    if (branch.current || checkoutMutation.isPending) return
    checkoutMutation.mutate({ branch: branch.name })
  }

  const switchRemoteBranch = (branch: GitRemoteBranch) => {
    if (checkoutMutation.isPending) return

    const parts = gitRemoteBranchParts(branch.name)
    const localName = parts.branch || branch.name
    if (localBranchNames.has(localName)) {
      checkoutMutation.mutate({ branch: localName })
      return
    }

    checkoutMutation.mutate({
      branch: localName,
      create: true,
      startPoint: branch.name,
      track: true,
    })
  }

  const createBranch = () => {
    const branch = dialogState.createBranchName.trim()
    if (!branch || checkoutMutation.isPending) return
    checkoutMutation.mutate({ branch, create: true })
  }

  const branchDialogBody = (
    <GitBranchDialogBody
      stage={dialogState.stage}
      createBranchName={dialogState.createBranchName}
      checkoutPending={checkoutMutation.isPending}
      isMobile={isMobile}
      browseProps={{
        query: dialogState.query,
        selectedValue,
        localBranches,
        remoteBranches,
        localBranchNames,
        branchesPending: branchesQuery.isPending,
        checkoutPending: checkoutMutation.isPending,
        isMobile,
        onQueryChange: (query) => dispatch({ type: "set-query", query }),
        onSelectedValueChange: (nextSelectedValue) =>
          dispatch({
            type: "set-selected-value",
            selectedValue: nextSelectedValue,
          }),
        onCreateStage: () => dispatch({ type: "set-stage", stage: "create" }),
        onSwitchLocalBranch: switchLocalBranch,
        onSwitchRemoteBranch: switchRemoteBranch,
      }}
      onBranchNameChange={(createBranchName) =>
        dispatch({ type: "set-create-branch-name", createBranchName })
      }
      onBrowseStage={() => dispatch({ type: "set-stage", stage: "browse" })}
      onCreateBranch={createBranch}
    />
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Branches</DrawerTitle>
            <DrawerDescription>
              Switch branches or create a new branch.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {branchDialogBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Branches"
      description="Switch branches or create a new branch."
      className="sm:max-w-2xl"
      initialFocus
    >
      {branchDialogBody}
    </CommandDialog>
  )
}
