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
import { picoQueryKeys } from "@/features/pico/query-keys"
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

type GitCommitDialogStage = "browse" | "message"
type GitCommitPendingRun = "commit" | "push" | "force-push" | null

type GitCommitDialogState = {
  message: string
  includeUnstaged: boolean
  generatedReason: string
  query: string
  selectedCommandId: string
  stage: GitCommitDialogStage
  pendingRun: GitCommitPendingRun
  generating: boolean
}

type GitCommitDialogAction =
  | { type: "reset-transient" }
  | { type: "set-query"; query: string }
  | { type: "set-selected-command-id"; selectedCommandId: string }
  | { type: "set-stage"; stage: GitCommitDialogStage }
  | { type: "set-message"; message: string; generatedReason?: string }
  | { type: "set-include-unstaged"; includeUnstaged: boolean }
  | { type: "set-pending-run"; pendingRun: GitCommitPendingRun }
  | { type: "set-generating"; generating: boolean }
  | { type: "apply-generated-message"; generated: GitCommitMessageData }
  | { type: "clear-message" }

const initialGitCommitDialogState = {
  message: "",
  includeUnstaged: true,
  generatedReason: "",
  query: "",
  selectedCommandId: "commit",
  stage: "browse",
  pendingRun: null,
  generating: false,
} satisfies GitCommitDialogState

function gitCommitDialogReducer(
  state: GitCommitDialogState,
  action: GitCommitDialogAction
): GitCommitDialogState {
  switch (action.type) {
    case "reset-transient":
      return { ...state, query: "", stage: "browse" }
    case "set-query":
      return { ...state, query: action.query }
    case "set-selected-command-id":
      return { ...state, selectedCommandId: action.selectedCommandId }
    case "set-stage":
      return { ...state, stage: action.stage }
    case "set-message":
      return {
        ...state,
        message: action.message,
        generatedReason: action.generatedReason ?? state.generatedReason,
      }
    case "set-include-unstaged":
      return { ...state, includeUnstaged: action.includeUnstaged }
    case "set-pending-run":
      return { ...state, pendingRun: action.pendingRun }
    case "set-generating":
      return { ...state, generating: action.generating }
    case "apply-generated-message":
      return {
        ...state,
        message: action.generated.message,
        generatedReason: action.generated.reason || "",
      }
    case "clear-message":
      return { ...state, message: "", generatedReason: "" }
  }
}

type GitCommitCommand = {
  id: string
  title: string
  description: string
  keywords: Array<string>
  valueLabel?: string
  disabled?: boolean
  onSelect: () => void | Promise<void>
}

type GitCommitCommandGroup = {
  heading: string
  commands: Array<GitCommitCommand>
}

function gitCommitCommandKeywords(command: GitCommitCommand) {
  return [
    command.title,
    command.description,
    command.valueLabel ?? "",
    ...command.keywords,
  ]
}

function gitCommitCommandIcon(
  commandId: string,
  pendingRun: GitCommitPendingRun
) {
  if (commandId === "commit") {
    return pendingRun === "commit" ? <Spinner /> : <GitCommitIcon />
  }

  if (commandId === "commit-push") {
    return pendingRun === "push" ? <Spinner /> : <UploadIcon />
  }

  if (commandId === "commit-force-push") {
    return pendingRun === "force-push" ? <Spinner /> : <UploadIcon />
  }

  return null
}

type GitCommitBrowseProps = {
  query: string
  selectedCommandId: string
  branchName: string
  fileSummary: string
  lineSummary: string
  commandGroups: Array<GitCommitCommandGroup>
  pendingRun: GitCommitPendingRun
  onQueryChange: (query: string) => void
  onSelectedCommandIdChange: (selectedCommandId: string) => void
  onContinueCommit: () => void
}

function GitCommitBrowse({
  query,
  selectedCommandId,
  branchName,
  fileSummary,
  lineSummary,
  commandGroups,
  pendingRun,
  onQueryChange,
  onSelectedCommandIdChange,
  onContinueCommit,
}: GitCommitBrowseProps) {
  const [addedLines = "", removedLines = ""] = lineSummary.split(" ")

  return (
    <Command
      shouldFilter
      loop
      value={selectedCommandId}
      onValueChange={onSelectedCommandIdChange}
      onKeyDown={(event) => {
        if (matchesShortcutEvent(event.nativeEvent, "Control+Enter")) {
          event.preventDefault()
          onContinueCommit()
        }
      }}
      className="min-h-0 flex-1 rounded-none md:rounded-xl"
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        placeholder="Search commit actions"
        className="text-base md:text-sm"
      />
      <GitCommitSummary
        branchName={branchName}
        fileSummary={fileSummary}
        addedLines={addedLines}
        removedLines={removedLines}
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(50vh,24rem)]">
        <CommandEmpty>No commit actions found.</CommandEmpty>
        {commandGroups.map((group) => (
          <GitCommitCommandGroupView
            key={group.heading}
            group={group}
            pendingRun={pendingRun}
          />
        ))}
      </CommandList>
      <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
        Use ↑/↓ to select, Enter to run, Esc to close. Press{" "}
        {formatShortcutLabel("Control+Enter")} to continue.
      </div>
    </Command>
  )
}

function GitCommitSummary({
  branchName,
  fileSummary,
  addedLines,
  removedLines,
}: {
  branchName: string
  fileSummary: string
  addedLines: string
  removedLines: string
}) {
  return (
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
            {addedLines || removedLines ? (
              <span>
                <span className="text-emerald-500">{addedLines}</span>{" "}
                <span className="text-red-500">{removedLines}</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function GitCommitCommandGroupView({
  group,
  pendingRun,
}: {
  group: GitCommitCommandGroup
  pendingRun: GitCommitPendingRun
}) {
  return (
    <CommandGroup heading={group.heading}>
      {group.commands.map((command) => (
        <CommandItem
          key={command.id}
          value={command.id}
          keywords={gitCommitCommandKeywords(command)}
          disabled={command.disabled}
          onSelect={() => {
            void Promise.resolve(command.onSelect()).catch((error: unknown) => {
              toast.error(getErrorMessage(error, "Failed to run commit action"))
            })
          }}
          className="items-start py-2"
        >
          {gitCommitCommandIcon(command.id, pendingRun)}
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
  )
}

type GitCommitMessageEditorProps = {
  message: string
  generatedReason: string
  busy: boolean
  generating: boolean
  canGenerate: boolean
  onMessageChange: (message: string) => void
  onGenerateCommitMessage: () => void
  onContinueCommit: () => void
  onReturnToCommitActions: () => void
}

function GitCommitMessageEditor({
  message,
  generatedReason,
  busy,
  generating,
  canGenerate,
  onMessageChange,
  onGenerateCommitMessage,
  onContinueCommit,
  onReturnToCommitActions,
}: GitCommitMessageEditorProps) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return

        event.preventDefault()
        event.stopPropagation()
        onReturnToCommitActions()
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onReturnToCommitActions}
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
          disabled={busy || !canGenerate}
          onClick={onGenerateCommitMessage}
        >
          {generating ? <Spinner /> : <WandSparklesIcon />}
          Generate
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <Textarea
          id="git-commit-message"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              onReturnToCommitActions()
              return
            }

            if (matchesShortcutEvent(event.nativeEvent, "Control+G")) {
              event.preventDefault()
              event.stopPropagation()
              onGenerateCommitMessage()
              return
            }

            if (matchesShortcutEvent(event.nativeEvent, "Control+Enter")) {
              event.preventDefault()
              event.stopPropagation()
              onContinueCommit()
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
}

function GitCommitDialogBody({
  stage,
  browseProps,
  messageEditorProps,
}: {
  stage: GitCommitDialogStage
  browseProps: GitCommitBrowseProps
  messageEditorProps: GitCommitMessageEditorProps
}) {
  if (stage === "message") {
    return <GitCommitMessageEditor {...messageEditorProps} />
  }

  return <GitCommitBrowse {...browseProps} />
}

function getGitCommitCommandGroups({
  message,
  includeUnstaged,
  busy,
  files,
  canForcePush,
  onContinueCommit,
  onOpenCommitMessage,
  onIncludeUnstagedChange,
}: {
  message: string
  includeUnstaged: boolean
  busy: boolean
  files: Array<GitChangeFile>
  canForcePush: boolean
  onContinueCommit: (push: boolean, forcePush?: boolean) => void
  onOpenCommitMessage: () => void
  onIncludeUnstagedChange: (includeUnstaged: boolean) => void
}): Array<GitCommitCommandGroup> {
  const trimmedMessage = message.trim()
  const noFiles = files.length === 0

  return [
    {
      heading: "Run",
      commands: [
        {
          id: "commit",
          title: "Commit",
          description: trimmedMessage
            ? "Commit with the current message."
            : "Generate a message automatically, then commit.",
          keywords: ["continue", "run", "save", "stage", "git"],
          valueLabel: "Commit",
          disabled: busy || noFiles,
          onSelect: () => onContinueCommit(false),
        },
        {
          id: "commit-push",
          title: "Commit and push",
          description: trimmedMessage
            ? "Commit with the current message, then push."
            : "Generate a message automatically, then commit and push.",
          keywords: ["continue", "run", "save", "stage", "git", "push"],
          valueLabel: "Push",
          disabled: busy || noFiles,
          onSelect: () => onContinueCommit(true),
        },
        ...(canForcePush
          ? [
              {
                id: "commit-force-push",
                title: "Commit and force push",
                description: trimmedMessage
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
                disabled: busy || noFiles,
                onSelect: () => onContinueCommit(true, true),
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
          description: trimmedMessage
            ? trimmedMessage
            : "Leave it blank to autogenerate before committing.",
          keywords: ["message", "subject", "body", "focus", "edit"],
          valueLabel: trimmedMessage ? "Custom" : "Blank",
          disabled: busy,
          onSelect: onOpenCommitMessage,
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
          onSelect: () => onIncludeUnstagedChange(!includeUnstaged),
        },
      ],
    },
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
  const [state, dispatch] = React.useReducer(
    gitCommitDialogReducer,
    initialGitCommitDialogState
  )
  const blockNextCloseRef = React.useRef(false)
  const fileSummary = `${files.length} file${files.length === 1 ? "" : "s"}`
  const lineSummary = gitFilesLineSummary(files)
  const branchName = gitStatus?.detached
    ? `Detached ${gitStatus.revision || "HEAD"}`
    : gitStatus?.branch || "Unknown branch"
  const canForcePush = gitStatusHasDiverged(gitStatus)

  const applyGeneratedMessage = (generated: GitCommitMessageData) => {
    dispatch({ type: "apply-generated-message", generated })
    if (generated.source !== "ai" && generated.reason) {
      toast.info(`Using heuristic message: ${generated.reason}`)
    }
  }

  const requestGeneratedCommitMessage = async () =>
    await fetchJson<GitCommitMessageData>(
      buildRequestUrl("/api/git-commit-message", {
        contextId: viewerContextId,
      }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      }
    )

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
            includeUnstaged: state.includeUnstaged,
          }),
        }
      ),
    onSuccess: async (_response, variables) => {
      dispatch({ type: "clear-message" })
      onOpenChange(false)
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      })
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
      dispatch({ type: "set-pending-run", pendingRun: null })
    },
  })

  const committing = commitMutation.isPending
  const busy = committing || state.generating

  React.useEffect(() => {
    if (!open) dispatch({ type: "reset-transient" })
  }, [open])

  const generateCommitMessage = () => {
    if (busy || !cwd || files.length === 0) return

    dispatch({ type: "set-generating", generating: true })
    void requestGeneratedCommitMessage()
      .then(applyGeneratedMessage)
      .catch((error: unknown) => {
        toast.error(getErrorMessage(error, "Failed to generate commit message"))
      })
      .finally(() => {
        dispatch({ type: "set-generating", generating: false })
      })
  }

  const continueCommit = async (push: boolean, forcePush = false) => {
    if (busy || files.length === 0) return

    dispatch({
      type: "set-pending-run",
      pendingRun: forcePush ? "force-push" : push ? "push" : "commit",
    })

    let commitMessage = state.message.trim()
    if (!commitMessage) {
      try {
        dispatch({ type: "set-generating", generating: true })
        const generated = await requestGeneratedCommitMessage()
        commitMessage = generated.message.trim()
        applyGeneratedMessage(generated)
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to generate commit message"))
        dispatch({ type: "set-pending-run", pendingRun: null })
        return
      } finally {
        dispatch({ type: "set-generating", generating: false })
      }
    }

    if (!commitMessage) {
      dispatch({ type: "set-pending-run", pendingRun: null })
      return
    }
    commitMutation.mutate({
      push,
      forcePush,
      commitMessage,
    })
  }

  const openCommitMessage = () => {
    dispatch({ type: "set-query", query: "" })
    dispatch({ type: "set-stage", stage: "message" })
  }

  const returnToCommitActions = () => {
    blockNextCloseRef.current = true
    dispatch({ type: "set-stage", stage: "browse" })
  }

  const commandGroups = getGitCommitCommandGroups({
    message: state.message,
    includeUnstaged: state.includeUnstaged,
    busy,
    files,
    canForcePush,
    onContinueCommit: (push, forcePush) => {
      void continueCommit(push, forcePush)
    },
    onOpenCommitMessage: openCommitMessage,
    onIncludeUnstagedChange: (includeUnstaged) =>
      dispatch({ type: "set-include-unstaged", includeUnstaged }),
  })

  const body = (
    <GitCommitDialogBody
      stage={state.stage}
      browseProps={{
        query: state.query,
        selectedCommandId: state.selectedCommandId,
        branchName,
        fileSummary,
        lineSummary,
        commandGroups,
        pendingRun: state.pendingRun,
        onQueryChange: (query) => dispatch({ type: "set-query", query }),
        onSelectedCommandIdChange: (selectedCommandId) =>
          dispatch({ type: "set-selected-command-id", selectedCommandId }),
        onContinueCommit: () => {
          void continueCommit(false)
        },
      }}
      messageEditorProps={{
        message: state.message,
        generatedReason: state.generatedReason,
        busy,
        generating: state.generating,
        canGenerate: Boolean(cwd && files.length > 0),
        onMessageChange: (message) =>
          dispatch({ type: "set-message", message, generatedReason: "" }),
        onGenerateCommitMessage: generateCommitMessage,
        onContinueCommit: () => {
          void continueCommit(false)
        },
        onReturnToCommitActions: returnToCommitActions,
      }}
    />
  )

  const handleSurfaceOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (state.stage === "message" || blockNextCloseRef.current)) {
      blockNextCloseRef.current = false
      dispatch({ type: "set-stage", stage: "browse" })
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

export function GitCommitDialogController({
  viewerContextId,
  cwd,
  openStateRef,
  ref,
}: {
  viewerContextId: string
  cwd?: string
  openStateRef: React.RefObject<boolean>
  ref?: React.Ref<GitCommitDialogControllerHandle>
}) {
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
}
