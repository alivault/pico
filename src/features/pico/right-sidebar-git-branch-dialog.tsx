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

function GitBranchDialogKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

type GitCheckoutBranchPayload = {
  branch: string
  create?: boolean
  startPoint?: string
  track?: boolean
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
  const [query, setQuery] = React.useState("")
  const [stage, setStage] = React.useState<GitBranchDialogStage>("browse")
  const [selectedValue, setSelectedValue] = React.useState("")
  const [createBranchName, setCreateBranchName] = React.useState("")
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

  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setStage("browse")
      setSelectedValue("")
      setCreateBranchName("")
    }
  }, [open])

  React.useEffect(() => {
    if (!open || selectedValue) return

    const currentBranch = localBranches.find((branch) => branch.current)
    setSelectedValue(
      currentBranch
        ? `local:${currentBranch.name}`
        : localBranches[0]
          ? `local:${localBranches[0].name}`
          : remoteBranches[0]
            ? `remote:${remoteBranches[0].name}`
            : "action:create"
    )
  }, [localBranches, open, remoteBranches, selectedValue])

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
    const branch = createBranchName.trim()
    if (!branch || checkoutMutation.isPending) return
    checkoutMutation.mutate({ branch, create: true })
  }

  const browseBody = (
    <Command
      shouldFilter
      loop
      value={selectedValue}
      onValueChange={setSelectedValue}
      onKeyDown={(event) => {
        if (matchesShortcutEvent(event.nativeEvent, "Control+N")) {
          event.preventDefault()
          setStage("create")
        }
      }}
      className="min-h-0 flex-1"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search branches"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,28rem)]">
        <CommandEmpty>
          {branchesQuery.isPending ? "Loading branches…" : "No branches found."}
        </CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            value="action:create"
            keywords={["new", "create", "branch"]}
            onSelect={() => {
              setStage("create")
            }}
          >
            <GitBranchIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">Create new branch…</span>
            <CommandShortcut>
              {formatShortcutLabel("Control+N")}
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={`Local branches · ${localBranches.length}`}>
          {branchesQuery.isPending && localBranches.length === 0 ? (
            <CommandItem value="loading:branches" disabled>
              <Spinner className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Loading branches…</span>
            </CommandItem>
          ) : null}
          {localBranches.map((branch) => {
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
                disabled={checkoutMutation.isPending}
                onSelect={() => switchLocalBranch(branch)}
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
        <CommandGroup heading={`Remote branches · ${remoteBranches.length}`}>
          {remoteBranches.map((branch) => {
            const parts = gitRemoteBranchParts(branch.name)
            const localName = parts.branch || branch.name
            const localExists = localBranchNames.has(localName)

            return (
              <CommandItem
                key={branch.name}
                value={`remote:${branch.name}`}
                keywords={[branch.name, localName, branch.subject ?? ""]}
                disabled={checkoutMutation.isPending}
                onSelect={() => switchRemoteBranch(branch)}
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
      </CommandList>
      {isMobile ? null : (
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
      )}
    </Command>
  )

  const createBody = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setStage("browse")}
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
          onChange={(event) => setCreateBranchName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setStage("browse")
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            createBranch()
          }}
          placeholder="branch-name"
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          disabled={!createBranchName.trim() || checkoutMutation.isPending}
          onClick={createBranch}
        >
          {checkoutMutation.isPending ? <Spinner /> : null}
          Create
        </Button>
      </div>
      {isMobile ? null : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>Enter</GitBranchDialogKbd> Create
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranchDialogKbd>Esc</GitBranchDialogKbd> Back
          </span>
        </div>
      )}
    </div>
  )

  const branchDialogBody = stage === "create" ? createBody : browseBody

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
