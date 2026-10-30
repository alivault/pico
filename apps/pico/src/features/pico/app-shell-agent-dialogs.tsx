import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { WandSparklesIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import {
  appShortcut,
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import type { ForkMessage } from "@/features/pico/app-shell-dialog-types"
import type {
  DeleteOldProjectAgentsResponse,
  ForkAgentResponse,
  ForkableMessagesResponse,
  GenerateAgentNameResponse,
  AgentListEntry,
} from "@/lib/pico/api"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { ShortcutButton, ShortcutFooter } from "@/components/ui/shortcut-footer"
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMachineId } from "@/lib/pico/machine-context"

type ForkableMessagesData = Extract<ForkableMessagesResponse, { ok: true }>
type DeleteOldProjectAgentsData = Extract<
  DeleteOldProjectAgentsResponse,
  { ok: true }
>
type GenerateAgentNameData = Extract<GenerateAgentNameResponse, { ok: true }>

function FooterKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

type RenameAgentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  renameValue: string
  generatingName: boolean
  canGenerateName: boolean
  onRenameValueChange: (value: string) => void
  onGenerateAgentName: () => void
  onRenameAgent: () => void
}

function RenameAgentDialog({
  open,
  onOpenChange,
  renameValue,
  generatingName,
  canGenerateName,
  onRenameValueChange,
  onGenerateAgentName,
  onRenameAgent,
}: RenameAgentDialogProps) {
  const isMobile = useIsMobile()
  const renameInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return

    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  const renameInput = (
    <Input
      ref={renameInputRef}
      value={renameValue}
      onChange={(event) => onRenameValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onOpenChange(false)
          return
        }
        if (matchesShortcutEvent(event.nativeEvent, appShortcut("G"))) {
          event.preventDefault()
          event.stopPropagation()
          onGenerateAgentName()
          return
        }
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        onRenameAgent()
      }}
      placeholder="Agent name"
      className="min-w-0 flex-1"
    />
  )
  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Rename agent</div>
          <div className="truncate text-xs text-muted-foreground">
            Update the display name shown in the sidebar.
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center p-3">{renameInput}</div>
      {isMobile ? null : (
        <ShortcutFooter>
          <ShortcutButton
            kbd={formatShortcutLabel(appShortcut("G"))}
            disabled={generatingName || !canGenerateName}
            onClick={onGenerateAgentName}
          >
            {generatingName ? <Spinner /> : <WandSparklesIcon />}
            Generate
          </ShortcutButton>
          <ShortcutButton kbd="Enter" onClick={onRenameAgent}>
            Save
          </ShortcutButton>
          <ShortcutButton kbd="Esc" onClick={() => onOpenChange(false)}>
            Cancel
          </ShortcutButton>
        </ShortcutFooter>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Rename agent</DrawerTitle>
            <DrawerDescription>
              Update the display name shown in the sidebar.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {body}
          </div>
          <DrawerFooter className="border-t border-border/70">
            <Button
              variant="outline"
              disabled={generatingName || !canGenerateName}
              onClick={onGenerateAgentName}
            >
              {generatingName ? <Spinner /> : <WandSparklesIcon />}
              Generate
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onRenameAgent}>Save</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename agent"
      description="Update the display name shown in the sidebar."
      className="sm:max-w-md"
      initialFocus
    >
      {body}
    </CommandDialog>
  )
}

export type RenameAgentDialogHandle = {
  open: (target: {
    path: string
    title: string
    hasGeneratedName?: boolean
  }) => void
  openForEntry: (entry: AgentListEntry) => void
  close: () => void
  isOpen: () => boolean
}

type RenameAgentDialogControllerProps = {
  ref?: React.Ref<RenameAgentDialogHandle>
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
  onRenameAgent: (
    path: string,
    name: string
  ) => Promise<boolean> | boolean | void
}

export function RenameAgentDialogController({
  ref,
  openStateRef,
  viewerContextId,
  onRenameAgent,
}: RenameAgentDialogControllerProps) {
  const machineId = useMachineId()
  const [open, setOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState("")
  const [isGeneratingName, setIsGeneratingName] = React.useState(false)
  const [canGenerateName, setCanGenerateName] = React.useState(false)
  const targetPathRef = React.useRef("")
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  const openTarget = (target: {
    path: string
    title: string
    hasGeneratedName?: boolean
  }) => {
    const nextPath = target.path.trim()
    if (!nextPath) return

    targetPathRef.current = nextPath
    setRenameValue(target.title)
    setCanGenerateName(!target.hasGeneratedName)
    setOpenState(true)
  }

  const generateAgentName = async () => {
    if (
      !viewerContextId ||
      !targetPathRef.current ||
      isGeneratingName ||
      !canGenerateName
    ) {
      return
    }

    setIsGeneratingName(true)
    try {
      const response = await fetchJson<GenerateAgentNameData>(
        buildRequestUrl("/api/agent/name", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: targetPathRef.current }),
        }
      )
      setRenameValue(response.name)
      setCanGenerateName(false)
      if (response.source === "heuristic" && response.reason) {
        toast.info("Using heuristic agent name", {
          description: response.reason,
        })
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate agent name"
      )
    } finally {
      setIsGeneratingName(false)
    }
  }

  const submitRename = async () => {
    const success = await onRenameAgent(targetPathRef.current, renameValue)
    if (success === false) return

    setOpenState(false)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: openTarget,
      openForEntry: (entry) => {
        if (!entry.path) return
        openTarget({
          path: entry.path,
          title: entry.title || "",
          hasGeneratedName: Boolean(entry.name?.trim()),
        })
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [renameValue]
  )

  return (
    <RenameAgentDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpenState(nextOpen)
      }}
      renameValue={renameValue}
      generatingName={isGeneratingName}
      canGenerateName={
        canGenerateName && Boolean(viewerContextId && targetPathRef.current)
      }
      onRenameValueChange={setRenameValue}
      onGenerateAgentName={() => {
        void generateAgentName()
      }}
      onRenameAgent={() => {
        void submitRename()
      }}
    />
  )
}

type DeleteAgentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  targets: Array<AgentListEntry>
  onDeleteAgent: () => void
  removeWorktree: boolean
  onRemoveWorktreeChange: (remove: boolean) => void
}

function DeleteAgentsDialog({
  open,
  onOpenChange,
  title,
  description,
  targets,
  onDeleteAgent,
  removeWorktree,
  onRemoveWorktreeChange,
}: DeleteAgentsDialogProps) {
  const worktreeTargets = targets.filter((target) => target.worktreeBranch)
  const isMobile = useIsMobile()
  const deletePanelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open || isMobile) return

    const frame = window.requestAnimationFrame(() => {
      deletePanelRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [isMobile, open])

  React.useEffect(() => {
    if (!open || isMobile) return

    const handleDeleteKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onOpenChange(false)
        return
      }

      if (event.key !== "Enter" || event.isComposing) return
      if (event.target instanceof HTMLButtonElement) return
      event.preventDefault()
      event.stopPropagation()
      onDeleteAgent()
    }

    window.addEventListener("keydown", handleDeleteKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleDeleteKeyDown, true)
    }
  }, [isMobile, onDeleteAgent, onOpenChange, open])

  const previewTargets = targets.slice(0, 8)
  const remainingTargetCount = Math.max(
    0,
    targets.length - previewTargets.length
  )
  const body = (
    <div
      ref={deletePanelRef}
      role="presentation"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onOpenChange(false)
          return
        }
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return
        if (event.target instanceof HTMLButtonElement) return
        event.preventDefault()
        event.stopPropagation()
        onDeleteAgent()
      }}
    >
      <div className="border-b border-border/70 px-3 py-2">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <p className="text-sm text-muted-foreground">This cannot be undone.</p>
        {worktreeTargets.length > 0 ? (
          <Field orientation="horizontal">
            <Checkbox
              id="archive-remove-worktree"
              checked={removeWorktree}
              onCheckedChange={(checked) => onRemoveWorktreeChange(checked)}
            />
            <FieldContent>
              <FieldLabel htmlFor="archive-remove-worktree">
                Also remove{" "}
                {worktreeTargets.length === 1
                  ? `the worktree of branch ${worktreeTargets[0]?.worktreeBranch}`
                  : `${worktreeTargets.length} worktrees`}
              </FieldLabel>
              <FieldDescription>
                Pico removes a worktree only when it has no uncommitted changes.
                The branch stays.
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}
        {targets.length > 1 ? (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-sm">
            {previewTargets.map((target) => (
              <div key={target.path || target.id} className="truncate">
                {target.title || "New agent"}
              </div>
            ))}
            {remainingTargetCount > 0 ? (
              <div className="text-muted-foreground">
                …and {remainingTargetCount} more
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {isMobile ? null : (
        <ShortcutFooter>
          <ShortcutButton kbd="Enter" onClick={onDeleteAgent}>
            Archive
          </ShortcutButton>
          <ShortcutButton kbd="Esc" onClick={() => onOpenChange(false)}>
            Cancel
          </ShortcutButton>
        </ShortcutFooter>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90svh] overflow-hidden p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {body}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 border-t border-border/70 p-3 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDeleteAgent}>
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="sm:max-w-md"
      initialFocus
    >
      {body}
    </CommandDialog>
  )
}

export type DeleteAgentsDialogHandle = {
  open: (targets: Array<AgentListEntry>) => void
  close: () => void
  isOpen: () => boolean
}

type DeleteOldProjectAgentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: string
  daysValue: string
  preview: DeleteOldProjectAgentsData | null
  previewLoading: boolean
  deleteLoading: boolean
  onDaysValueChange: (value: string) => void
  onPreview: () => void
  onDelete: () => void
}

function DeleteOldProjectAgentsDialog({
  open,
  onOpenChange,
  project,
  daysValue,
  preview,
  previewLoading,
  deleteLoading,
  onDaysValueChange,
  onPreview,
  onDelete,
}: DeleteOldProjectAgentsDialogProps) {
  const isMobile = useIsMobile()
  const matchCount = preview?.matchingAgents.length ?? 0
  const canDelete = Boolean(preview) && matchCount > 0 && !deleteLoading
  const daysInput = (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="old-agent-days">
        Older than days
      </label>
      <Input
        id="old-agent-days"
        inputMode="numeric"
        value={daysValue}
        onChange={(event) => onDaysValueChange(event.target.value)}
        placeholder="30"
      />
    </div>
  )
  const previewBody = preview ? (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      {matchCount > 0 ? (
        <div className="space-y-2">
          <p className="font-medium">
            {matchCount} agent{matchCount === 1 ? "" : "s"} will be archived.
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto text-muted-foreground">
            {preview.matchingAgents.slice(0, 20).map((agent) => (
              <div key={agent.path || agent.id} className="truncate">
                {agent.title}
              </div>
            ))}
            {matchCount > 20 ? <div>…and {matchCount - 20} more</div> : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">No old agents found.</p>
      )}
    </div>
  ) : null
  const body = (
    <div className="space-y-4">
      <p className="text-sm break-all text-muted-foreground">{project}</p>
      {daysInput}
      {previewBody}
    </div>
  )
  const footer = (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={deleteLoading}
      >
        Cancel
      </Button>
      <Button variant="outline" onClick={onPreview} disabled={previewLoading}>
        {previewLoading ? <Spinner /> : null}
        Preview
      </Button>
      <Button variant="destructive" onClick={onDelete} disabled={!canDelete}>
        {deleteLoading ? <Spinner /> : null}
        Archive
      </Button>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Archive old agents</DrawerTitle>
            <DrawerDescription>
              Preview and archive inactive agents in this project.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">{body}</div>
          <DrawerFooter className="border-t border-border/70">
            {footer}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive old agents</DialogTitle>
          <DialogDescription>
            Preview and archive inactive agents in this project.
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type DeleteOldProjectAgentsDialogHandle = {
  open: (project: string) => void
  close: () => void
  isOpen: () => boolean
}

type DeleteOldProjectAgentsDialogControllerProps = {
  ref?: React.Ref<DeleteOldProjectAgentsDialogHandle>
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
}

export function DeleteOldProjectAgentsDialogController({
  ref,
  openStateRef,
  viewerContextId,
}: DeleteOldProjectAgentsDialogControllerProps) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [project, setProject] = React.useState("")
  const [daysValue, setDaysValue] = React.useState("30")
  const [preview, setPreview] =
    React.useState<DeleteOldProjectAgentsData | null>(null)
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setPreview(null)
    }
  }

  const olderThanMs = () => {
    const days = Number(daysValue)
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error("Enter a positive number of days")
    }
    return days * 24 * 60 * 60 * 1000
  }

  const cleanupMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      return await fetchJson<DeleteOldProjectAgentsData>(
        buildRequestUrl("/api/project-agents/cleanup", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project,
            olderThanMs: olderThanMs(),
            dryRun,
          }),
        }
      )
    },
    onSuccess: async (_response, dryRun) => {
      if (dryRun) return
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectAgentsIndex(viewerContextId, project),
      })
    },
  })

  const previewCleanup = async () => {
    try {
      setPreview(await cleanupMutation.mutateAsync(true))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to preview agents"
      )
    }
  }

  const deleteCleanup = async () => {
    try {
      const result = await cleanupMutation.mutateAsync(false)
      setPreview(result)
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectAgentsIndex(viewerContextId, project),
      })
      toast.success(
        `Archived ${result.deletedAgentIds.length} old agent${
          result.deletedAgentIds.length === 1 ? "" : "s"
        }`
      )
      setOpenState(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to archive agents"
      )
    }
  }

  const openProject = (nextProject: string) => {
    const normalizedProject = nextProject.trim()
    if (!normalizedProject) return
    setProject(normalizedProject)
    setDaysValue("30")
    setPreview(null)
    setOpenState(true)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: openProject,
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [daysValue, project, viewerContextId]
  )

  return (
    <DeleteOldProjectAgentsDialog
      open={open}
      onOpenChange={setOpenState}
      project={project}
      daysValue={daysValue}
      preview={preview}
      previewLoading={cleanupMutation.isPending && !preview}
      deleteLoading={cleanupMutation.isPending && Boolean(preview)}
      onDaysValueChange={(value) => {
        setDaysValue(value)
        setPreview(null)
      }}
      onPreview={() => {
        void previewCleanup()
      }}
      onDelete={() => {
        void deleteCleanup()
      }}
    />
  )
}

type DeleteAgentsDialogControllerProps = {
  ref?: React.Ref<DeleteAgentsDialogHandle>
  openStateRef?: React.RefObject<boolean>
  onDeleteAgent: (
    targets: Array<AgentListEntry>,
    options?: { removeWorktree?: boolean }
  ) => Promise<boolean> | boolean | void
}

function normalizeDeleteTargets(targets: Array<AgentListEntry>) {
  const nextTargets: Array<AgentListEntry> = []
  const seenKeys = new Set<string>()

  for (const target of targets) {
    if (!target.path) continue
    const key = `${target.path}:${target.id || ""}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    nextTargets.push(target)
  }

  return nextTargets
}

export function DeleteAgentsDialogController({
  ref,
  openStateRef,
  onDeleteAgent,
}: DeleteAgentsDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const [targets, setTargets] = React.useState<Array<AgentListEntry>>([])
  const [removeWorktree, setRemoveWorktree] = React.useState(false)
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setTargets([])
      setRemoveWorktree(false)
    }
  }

  const openTargets = (nextTargets: Array<AgentListEntry>) => {
    const normalizedTargets = normalizeDeleteTargets(nextTargets)
    if (normalizedTargets.length === 0) return

    setTargets(normalizedTargets)
    setOpenState(true)
  }

  const submitDelete = async () => {
    const success = await onDeleteAgent(targets, { removeWorktree })
    if (success === false) return

    setOpenState(false)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: openTargets,
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [targets]
  )

  const title = targets.length === 1 ? "Archive agent" : "Archive agents"
  const description =
    targets.length === 1
      ? `Archive "${targets[0]?.title || "New agent"}"? (History is kept.)`
      : `Archive ${targets.length} selected agents? (History is kept.)`

  return (
    <DeleteAgentsDialog
      open={open}
      onOpenChange={setOpenState}
      title={title}
      description={description}
      targets={targets}
      removeWorktree={removeWorktree}
      onRemoveWorktreeChange={setRemoveWorktree}
      onDeleteAgent={() => {
        void submitDelete()
      }}
    />
  )
}

type ForkAgentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  forkLoading: boolean
  forkMessages: Array<ForkMessage> | null
  onForkFromMessage: (entryId: string) => void
}

function ForkAgentDialog({
  open,
  onOpenChange,
  forkLoading,
  forkMessages,
  onForkFromMessage,
}: ForkAgentDialogProps) {
  const [forkQuery, setForkQuery] = React.useState("")
  const isMobile = useIsMobile()

  React.useEffect(() => {
    if (!open && forkQuery) {
      setForkQuery("")
    }
  }, [open, forkQuery])

  const filteredForkMessages = (forkMessages ?? []).filter((message) =>
    message.text.toLowerCase().includes(forkQuery.trim().toLowerCase())
  )

  const forkDialogBody = (
    <Command shouldFilter={false} loop className="min-h-0 flex-1 rounded-lg">
      <CommandInput
        value={forkQuery}
        onValueChange={setForkQuery}
        placeholder="Search fork points"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        {forkLoading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Spinner /> Loading fork points…
          </div>
        ) : (
          <>
            <CommandEmpty>
              {forkMessages && forkMessages.length > 0
                ? "No fork points match your search."
                : "No forkable prompts found."}
            </CommandEmpty>
            {filteredForkMessages.length > 0 ? (
              <CommandGroup heading="Fork points">
                {filteredForkMessages.map((message) => (
                  <CommandItem
                    key={message.entryId}
                    value={message.text}
                    onSelect={() => onForkFromMessage(message.entryId)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-3 text-sm whitespace-pre-wrap text-foreground">
                        {message.text}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </>
        )}
      </CommandList>
      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
        <span className="inline-flex items-center gap-1">
          <FooterKbd>↑↓</FooterKbd> Navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <FooterKbd>Enter</FooterKbd> Fork
        </span>
        <span className="inline-flex items-center gap-1">
          <FooterKbd>Esc</FooterKbd> Close
        </span>
      </div>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Fork conversation</DrawerTitle>
            <DrawerDescription>
              Search earlier user prompts and branch from a specific point.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {forkDialogBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Fork conversation"
      description="Search earlier user prompts and branch from a specific point."
      className="sm:max-w-2xl"
      initialFocus
    >
      {forkDialogBody}
    </CommandDialog>
  )
}
export type ForkAgentDialogHandle = {
  open: () => Promise<void> | void
  close: () => void
  isOpen: () => boolean
}

type ForkAgentDialogControllerProps = {
  ref?: React.Ref<ForkAgentDialogHandle>
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
  agentScopeKey: string
  agentId?: string
}

export function ForkAgentDialogController({
  ref,
  openStateRef,
  viewerContextId,
  agentScopeKey,
  agentId,
}: ForkAgentDialogControllerProps) {
  const machineId = useMachineId()
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)
  const queryClient = useQueryClient()
  const queryKey = picoQueryKeys.forkableMessages(
    viewerContextId,
    agentScopeKey
  )

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  const forkMessagesQuery = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<ForkableMessagesData>(
        buildRequestUrl("/api/agent/fork", {
          machineId,
          contextId: viewerContextId,
          agentId,
        })
      ),
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
    enabled: Boolean(viewerContextId && open && agentScopeKey),
  })

  const forkFromMessageMutation = useMutation({
    mutationFn: async (entryId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<ForkAgentResponse>(
        buildRequestUrl("/api/agent/fork", {
          machineId,
          contextId: viewerContextId,
          agentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey,
        exact: true,
        refetchType: "active",
      })
    },
  })

  const openDialog = async () => {
    if (!viewerContextId) return

    setOpenState(true)
    await queryClient.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "active",
    })
  }

  const forkFromMessage = async (entryId: string) => {
    if (!viewerContextId) return

    try {
      await forkFromMessageMutation.mutateAsync(entryId)
      setOpenState(false)
      toast.success("Forked the conversation")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to fork the conversation"
      )
    }
  }

  React.useEffect(() => {
    if (!open || !forkMessagesQuery.error) return

    toast.error(
      forkMessagesQuery.error instanceof Error
        ? forkMessagesQuery.error.message
        : "Failed to load fork points"
    )
    setOpenState(false)
  }, [forkMessagesQuery.error, forkMessagesQuery.errorUpdatedAt, open])

  React.useImperativeHandle(
    ref,
    () => ({
      open: openDialog,
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [queryKey, viewerContextId]
  )

  const forkLoading = Boolean(
    (forkMessagesQuery.isPending && !forkMessagesQuery.data) ||
    forkFromMessageMutation.isPending
  )

  return (
    <ForkAgentDialog
      open={open}
      onOpenChange={setOpenState}
      forkLoading={forkLoading}
      forkMessages={forkMessagesQuery.data?.messages ?? null}
      onForkFromMessage={(entryId) => {
        void forkFromMessage(entryId)
      }}
    />
  )
}
