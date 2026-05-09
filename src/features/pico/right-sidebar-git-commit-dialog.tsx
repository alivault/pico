import * as React from "react"
import {
  ArrowLeftIcon,
  GitBranchIcon,
  GitCommitIcon,
  UploadIcon,
  WandSparklesIcon,
} from "lucide-react"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import {
  gitChangesQueryOptions,
  gitFilesLineSummary,
  gitStatusHasDiverged,
  gitStatusQueryOptions,
  invalidateGitQueries,
  selectGitFiles,
  selectGitStatusSummary,
  type GitCommitMessageData,
} from "@/features/pico/right-sidebar-git-data"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  GitCommitDialogControllerHandle,
  GitStatusValue,
} from "@/features/pico/right-sidebar-types"
import type { GitChangeFile, GitCommitResponse } from "@/lib/pico/api"
import { useIsMobile } from "@/hooks/use-mobile"

type GitCommitCommand = {
  id: string
  title: string
  description: string
  keywords: Array<string>
  valueLabel?: string
  disabled?: boolean
  onSelect: () => void | Promise<void>
}

function gitCommitCommandKeywords(command: GitCommitCommand) {
  return [
    command.title,
    command.description,
    command.valueLabel ?? "",
    ...command.keywords,
  ]
}

export function GitCommitDialog({
  viewerContextId,
  cwd,
  files,
  gitStatus,
  open,
  onOpenChange,
}: {
  viewerContextId: string
  cwd: string
  files: Array<GitChangeFile>
  gitStatus: GitStatusValue | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [message, setMessage] = React.useState("")
  const [includeUnstaged, setIncludeUnstaged] = React.useState(true)
  const [generatedReason, setGeneratedReason] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [selectedCommandId, setSelectedCommandId] = React.useState("commit")
  const [stage, setStage] = React.useState<"browse" | "message">("browse")
  const [pendingRun, setPendingRun] = React.useState<
    "commit" | "push" | "force-push" | null
  >(null)
  const blockNextCloseRef = React.useRef(false)
  const fileSummary = `${files.length} file${files.length === 1 ? "" : "s"}`
  const lineSummary = gitFilesLineSummary(files)
  const branchName = gitStatus?.detached
    ? `Detached ${gitStatus.revision || "HEAD"}`
    : gitStatus?.branch || "Unknown branch"
  const canForcePush = gitStatusHasDiverged(gitStatus)

  const generateMutation = useMutation({
    mutationFn: async () =>
      await fetchJson<GitCommitMessageData>(
        buildRequestUrl("/api/git-commit-message", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ),
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to generate commit message"))
    },
  })

  const commitMutation = useMutation({
    mutationFn: async ({
      push,
      forcePush,
      commitMessage,
    }: {
      push: boolean
      forcePush: boolean
      commitMessage: string
    }) =>
      await fetchJson<GitCommitResponse>(
        buildRequestUrl("/api/git-commit", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd,
            message: commitMessage,
            push,
            forcePush,
            includeUnstaged,
          }),
        }
      ),
    onSuccess: async (_response, variables) => {
      setMessage("")
      setGeneratedReason("")
      onOpenChange(false)
      await invalidateGitQueries({ queryClient, viewerContextId, cwd })
      toast.success(
        variables.forcePush
          ? "Committed and force pushed changes"
          : variables.push
            ? "Committed and pushed changes"
            : "Committed changes",
        { description: variables.commitMessage }
      )
    },
    onError: (error, variables) => {
      toast.error(
        getErrorMessage(
          error,
          variables.forcePush
            ? "Failed to commit and force push changes"
            : variables.push
              ? "Failed to commit and push changes"
              : "Failed to commit changes"
        )
      )
    },
    onSettled: () => {
      setPendingRun(null)
    },
  })

  const committing = commitMutation.isPending
  const generating = generateMutation.isPending
  const busy = committing || generating

  React.useEffect(() => {
    if (!open) {
      if (query) setQuery("")
      setStage("browse")
    }
  }, [open, query])

  const applyGeneratedMessage = (generated: GitCommitMessageData) => {
    setMessage(generated.message)
    setGeneratedReason(generated.reason || "")
    if (generated.source !== "ai" && generated.reason) {
      toast.info(`Using heuristic message: ${generated.reason}`)
    }
  }

  const generateCommitMessage = () => {
    if (busy || !cwd || files.length === 0) return

    generateMutation.mutate(undefined, {
      onSuccess: applyGeneratedMessage,
    })
  }

  const continueCommit = async (push: boolean, forcePush = false) => {
    if (busy || files.length === 0) return

    setPendingRun(forcePush ? "force-push" : push ? "push" : "commit")

    let commitMessage = message.trim()
    if (!commitMessage) {
      try {
        const generated = await generateMutation.mutateAsync()
        commitMessage = generated.message.trim()
        applyGeneratedMessage(generated)
      } catch {
        setPendingRun(null)
        return
      }
    }

    if (!commitMessage) {
      setPendingRun(null)
      return
    }
    commitMutation.mutate({
      push,
      forcePush,
      commitMessage,
    })
  }

  const openCommitMessage = () => {
    setQuery("")
    setStage("message")
  }

  const returnToCommitActions = () => {
    blockNextCloseRef.current = true
    setStage("browse")
  }

  const commandGroups: Array<{
    heading: string
    commands: Array<GitCommitCommand>
  }> = [
    {
      heading: "Run",
      commands: [
        {
          id: "commit",
          title: "Commit",
          description: message.trim()
            ? "Commit with the current message."
            : "Generate a message automatically, then commit.",
          keywords: ["continue", "run", "save", "stage", "git"],
          valueLabel: "Commit",
          disabled: busy || files.length === 0,
          onSelect: () => continueCommit(false),
        },
        {
          id: "commit-push",
          title: "Commit and push",
          description: message.trim()
            ? "Commit with the current message, then push."
            : "Generate a message automatically, then commit and push.",
          keywords: ["continue", "run", "save", "stage", "git", "push"],
          valueLabel: "Push",
          disabled: busy || files.length === 0,
          onSelect: () => continueCommit(true),
        },
        ...(canForcePush
          ? [
              {
                id: "commit-force-push",
                title: "Commit and force push",
                description: message.trim()
                  ? "Commit with the current message, then force push with --force-with-lease."
                  : "Generate a message automatically, then commit and force push with --force-with-lease.",
                keywords: [
                  "continue",
                  "run",
                  "save",
                  "stage",
                  "git",
                  "push",
                  "force",
                  "lease",
                ],
                valueLabel: "Force push",
                disabled: busy || files.length === 0,
                onSelect: () => continueCommit(true, true),
              },
            ]
          : []),
      ],
    },
    {
      heading: "Message",
      commands: [
        {
          id: "edit-message",
          title: "Edit commit message",
          description: message.trim()
            ? message.trim()
            : "Leave it blank to autogenerate before committing.",
          keywords: ["message", "subject", "body", "focus", "edit"],
          valueLabel: message.trim() ? "Custom" : "Blank",
          disabled: busy,
          onSelect: openCommitMessage,
        },
      ],
    },
    {
      heading: "Options",
      commands: [
        {
          id: "include-unstaged",
          title: "Include unstaged changes",
          description: "Stage unstaged files before committing.",
          keywords: ["stage", "unstaged", "files", "working tree"],
          valueLabel: includeUnstaged ? "On" : "Off",
          disabled: busy,
          onSelect: () => setIncludeUnstaged(!includeUnstaged),
        },
      ],
    },
  ]

  const commandBrowseBody = (
    <Command
      shouldFilter
      loop
      value={selectedCommandId}
      onValueChange={setSelectedCommandId}
      onKeyDown={(event) => {
        if (matchesShortcutEvent(event.nativeEvent, "Control+Enter")) {
          event.preventDefault()
          void continueCommit(false)
        }
      }}
      className="min-h-0 flex-1 rounded-none md:rounded-xl"
    >
      <CommandInput
        autoFocus={!isMobile}
        value={query}
        onValueChange={setQuery}
        placeholder="Search commit actions"
        className="text-base md:text-sm"
      />
      <div className="grid gap-3 px-3 py-4 text-sm md:px-4">
        <div className="grid gap-3">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-4">
            <div className="font-semibold">Branch</div>
            <div className="flex min-w-0 items-center gap-3 text-muted-foreground">
              <GitBranchIcon className="size-5 shrink-0" />
              <span className="truncate font-medium text-foreground">
                {branchName}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-4">
            <div className="font-semibold">Changes</div>
            <div className="flex min-w-0 items-center gap-3 text-muted-foreground tabular-nums">
              <span className="shrink-0">{fileSummary}</span>
              {lineSummary ? (
                <span>
                  <span className="text-emerald-500">
                    {lineSummary.split(" ")[0]}
                  </span>{" "}
                  <span className="text-red-500">
                    {lineSummary.split(" ")[1]}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(50vh,24rem)]">
        <CommandEmpty>No commit actions found.</CommandEmpty>
        {commandGroups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.commands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                keywords={gitCommitCommandKeywords(command)}
                disabled={command.disabled}
                onSelect={() => {
                  void Promise.resolve(command.onSelect()).catch(
                    (error: unknown) => {
                      toast.error(
                        getErrorMessage(error, "Failed to run commit action")
                      )
                    }
                  )
                }}
                className="items-start py-2"
              >
                {command.id === "commit" ? (
                  pendingRun === "commit" ? (
                    <Spinner />
                  ) : (
                    <GitCommitIcon />
                  )
                ) : command.id === "commit-push" ? (
                  pendingRun === "push" ? (
                    <Spinner />
                  ) : (
                    <UploadIcon />
                  )
                ) : command.id === "commit-force-push" ? (
                  pendingRun === "force-push" ? (
                    <Spinner />
                  ) : (
                    <UploadIcon />
                  )
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{command.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </div>
                {command.valueLabel ? (
                  <CommandShortcut className="inline shrink-0 tracking-normal normal-case">
                    {command.valueLabel}
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
        Use ↑/↓ to select, Enter to run, Esc to close. Press{" "}
        {formatShortcutLabel("Control+Enter")} to continue.
      </div>
    </Command>
  )

  const commitMessageBody = (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return

        event.preventDefault()
        event.stopPropagation()
        returnToCommitActions()
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={returnToCommitActions}
          aria-label="Back to commit actions"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Commit message</div>
          <div className="truncate text-xs text-muted-foreground">
            Leave blank to autogenerate before committing.
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !cwd || files.length === 0}
          onClick={generateCommitMessage}
        >
          {generating ? <Spinner /> : <WandSparklesIcon />}
          Generate
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <Textarea
          autoFocus={!isMobile}
          id="git-commit-message"
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setGeneratedReason("")
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              returnToCommitActions()
              return
            }

            if (matchesShortcutEvent(event.nativeEvent, "Control+G")) {
              event.preventDefault()
              event.stopPropagation()
              generateCommitMessage()
              return
            }

            if (matchesShortcutEvent(event.nativeEvent, "Control+Enter")) {
              event.preventDefault()
              event.stopPropagation()
              void continueCommit(false)
            }
          }}
          placeholder="Leave blank to autogenerate a commit message"
          className="min-h-40 flex-1 resize-none rounded-xl bg-muted/20 px-4 py-3 text-base"
          disabled={busy}
        />
        {generatedReason ? (
          <p className="text-xs text-muted-foreground">
            AI message unavailable, using heuristic fallback: {generatedReason}
          </p>
        ) : null}
      </div>
      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
        <span>{formatShortcutLabel("Control+G")} Generate</span>
        <span>{formatShortcutLabel("Control+Enter")} Continue</span>
        <span>Esc Back</span>
      </div>
    </div>
  )

  const body = stage === "message" ? commitMessageBody : commandBrowseBody
  const handleSurfaceOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (stage === "message" || blockNextCloseRef.current)) {
      blockNextCloseRef.current = false
      setStage("browse")
      return
    }

    onOpenChange(nextOpen)
  }

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={handleSurfaceOpenChange}
        autoFocus={false}
      >
        <DrawerContent className="max-h-[92svh] overflow-hidden">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Commit your changes</DrawerTitle>
            <DrawerDescription>
              Stage and commit changes in this repository.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleSurfaceOpenChange}
      title="Commit your changes"
      description="Search commit actions, edit the message, and choose whether to push."
      className="sm:max-w-2xl"
      initialFocus
    >
      {body}
    </CommandDialog>
  )
}

export const GitCommitDialogController = React.forwardRef<
  GitCommitDialogControllerHandle,
  {
    viewerContextId: string
    cwd?: string
    openStateRef: React.RefObject<boolean>
  }
>(function GitCommitDialogControllerImpl(
  { viewerContextId, cwd, openStateRef },
  ref
) {
  const normalizedCwd = normalizeCwd(cwd)
  const [open, setOpen] = React.useState(false)
  const statusQuery = useQuery({
    ...gitStatusQueryOptions({ viewerContextId, cwd: normalizedCwd }),
    enabled: Boolean(open && viewerContextId && normalizedCwd),
    select: selectGitStatusSummary,
    notifyOnChangeProps: ["data"],
  })
  const filesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "files",
    }),
    enabled: Boolean(open && viewerContextId && normalizedCwd),
    select: selectGitFiles,
    notifyOnChangeProps: ["data"],
  })
  const files = Array.isArray(filesQuery.data) ? filesQuery.data : []

  const setDialogOpen = React.useCallback(
    (nextOpen: boolean) => {
      openStateRef.current = nextOpen
      setOpen(nextOpen)
    },
    [openStateRef]
  )

  React.useEffect(() => {
    openStateRef.current = open
  }, [open, openStateRef])

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!viewerContextId || !normalizedCwd) {
          toast.error("Open a session in a repository before committing.")
          return
        }

        setDialogOpen(true)
      },
      close: () => {
        setDialogOpen(false)
      },
      isOpen: () => openStateRef.current,
    }),
    [normalizedCwd, openStateRef, setDialogOpen, viewerContextId]
  )

  return (
    <GitCommitDialog
      viewerContextId={viewerContextId}
      cwd={normalizedCwd}
      files={files}
      gitStatus={statusQuery.data}
      open={open}
      onOpenChange={setDialogOpen}
    />
  )
})
