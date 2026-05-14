import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ForkMessage } from "@/features/pico/app-shell-dialog-types"
import type {
  DeleteOldDirectorySessionsResponse,
  ForkSessionResponse,
  ForkableMessagesResponse,
  SessionListEntry,
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
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"

type ForkableMessagesData = Extract<ForkableMessagesResponse, { ok: true }>
type DeleteOldDirectorySessionsData = Extract<
  DeleteOldDirectorySessionsResponse,
  { ok: true }
>

function FooterKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

type RenameSessionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRenameSession: () => void
}

function RenameSessionDialog({
  open,
  onOpenChange,
  renameValue,
  onRenameValueChange,
  onRenameSession,
}: RenameSessionDialogProps) {
  const isMobile = useIsMobile()
  const renameInput = (
    <Input
      value={renameValue}
      onChange={(event) => onRenameValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return
        event.preventDefault()
        onRenameSession()
      }}
      placeholder="Session name"
    />
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Rename session</DrawerTitle>
            <DrawerDescription>
              Update the display name shown in the sidebar.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">{renameInput}</div>
          <DrawerFooter className="border-t border-border/70">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onRenameSession}>Save</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>
            Update the display name shown in the sidebar.
          </DialogDescription>
        </DialogHeader>
        {renameInput}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onRenameSession}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type RenameSessionDialogHandle = {
  open: (target: { path: string; title: string }) => void
  openForEntry: (entry: SessionListEntry) => void
  close: () => void
  isOpen: () => boolean
}

type RenameSessionDialogControllerProps = {
  ref?: React.Ref<RenameSessionDialogHandle>
  openStateRef?: React.RefObject<boolean>
  onRenameSession: (
    path: string,
    name: string
  ) => Promise<boolean> | boolean | void
}

export function RenameSessionDialogController({
  ref,
  openStateRef,
  onRenameSession,
}: RenameSessionDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState("")
  const targetPathRef = React.useRef("")
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  const openTarget = (target: { path: string; title: string }) => {
    const nextPath = target.path.trim()
    if (!nextPath) return

    targetPathRef.current = nextPath
    setRenameValue(target.title)
    setOpenState(true)
  }

  const submitRename = async () => {
    const success = await onRenameSession(targetPathRef.current, renameValue)
    if (success === false) return

    setOpenState(false)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: openTarget,
      openForEntry: (entry) => {
        if (!entry.path) return
        openTarget({ path: entry.path, title: entry.title || "" })
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [renameValue]
  )

  return (
    <RenameSessionDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpenState(nextOpen)
      }}
      renameValue={renameValue}
      onRenameValueChange={setRenameValue}
      onRenameSession={() => {
        void submitRename()
      }}
    />
  )
}

type DeleteSessionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onDeleteSession: () => void
}

function DeleteSessionsDialog({
  open,
  onOpenChange,
  title,
  description,
  onDeleteSession,
}: DeleteSessionsDialogProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="border-t border-border/70">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDeleteSession}>
              Delete
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDeleteSession}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type DeleteSessionsDialogHandle = {
  open: (targets: Array<SessionListEntry>) => void
  close: () => void
  isOpen: () => boolean
}

type DeleteOldDirectorySessionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  directory: string
  daysValue: string
  preview: DeleteOldDirectorySessionsData | null
  previewLoading: boolean
  deleteLoading: boolean
  onDaysValueChange: (value: string) => void
  onPreview: () => void
  onDelete: () => void
}

function DeleteOldDirectorySessionsDialog({
  open,
  onOpenChange,
  directory,
  daysValue,
  preview,
  previewLoading,
  deleteLoading,
  onDaysValueChange,
  onPreview,
  onDelete,
}: DeleteOldDirectorySessionsDialogProps) {
  const isMobile = useIsMobile()
  const matchCount = preview?.matchingSessions.length ?? 0
  const canDelete = Boolean(preview) && matchCount > 0 && !deleteLoading
  const daysInput = (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="old-session-days">
        Older than days
      </label>
      <Input
        id="old-session-days"
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
            {matchCount} session{matchCount === 1 ? "" : "s"} will be deleted.
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto text-muted-foreground">
            {preview.matchingSessions.slice(0, 20).map((session) => (
              <div key={session.path || session.id} className="truncate">
                {session.title}
              </div>
            ))}
            {matchCount > 20 ? <div>…and {matchCount - 20} more</div> : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">No old sessions found.</p>
      )}
    </div>
  ) : null
  const body = (
    <div className="space-y-4">
      <p className="text-sm break-all text-muted-foreground">{directory}</p>
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
        Delete
      </Button>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete old sessions</DrawerTitle>
            <DrawerDescription>
              Preview and delete inactive sessions in this directory.
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
          <DialogTitle>Delete old sessions</DialogTitle>
          <DialogDescription>
            Preview and delete inactive sessions in this directory.
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type DeleteOldDirectorySessionsDialogHandle = {
  open: (directory: string) => void
  close: () => void
  isOpen: () => boolean
}

type DeleteOldDirectorySessionsDialogControllerProps = {
  ref?: React.Ref<DeleteOldDirectorySessionsDialogHandle>
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
}

export function DeleteOldDirectorySessionsDialogController({
  ref,
  openStateRef,
  viewerContextId,
}: DeleteOldDirectorySessionsDialogControllerProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [directory, setDirectory] = React.useState("")
  const [daysValue, setDaysValue] = React.useState("30")
  const [preview, setPreview] =
    React.useState<DeleteOldDirectorySessionsData | null>(null)
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
      return await fetchJson<DeleteOldDirectorySessionsData>(
        buildRequestUrl("/api/directory-sessions/cleanup", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            directory,
            olderThanMs: olderThanMs(),
            dryRun,
          }),
        }
      )
    },
  })

  const previewCleanup = async () => {
    try {
      setPreview(await cleanupMutation.mutateAsync(true))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to preview sessions"
      )
    }
  }

  const deleteCleanup = async () => {
    try {
      const result = await cleanupMutation.mutateAsync(false)
      setPreview(result)
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.directorySessionsIndex(
          viewerContextId,
          directory
        ),
      })
      toast.success(
        `Deleted ${result.deletedSessionIds.length} old session${
          result.deletedSessionIds.length === 1 ? "" : "s"
        }`
      )
      setOpenState(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete sessions"
      )
    }
  }

  const openDirectory = (nextDirectory: string) => {
    const normalizedDirectory = nextDirectory.trim()
    if (!normalizedDirectory) return
    setDirectory(normalizedDirectory)
    setDaysValue("30")
    setPreview(null)
    setOpenState(true)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: openDirectory,
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    [daysValue, directory, viewerContextId]
  )

  return (
    <DeleteOldDirectorySessionsDialog
      open={open}
      onOpenChange={setOpenState}
      directory={directory}
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

type DeleteSessionsDialogControllerProps = {
  ref?: React.Ref<DeleteSessionsDialogHandle>
  openStateRef?: React.RefObject<boolean>
  onDeleteSession: (
    targets: Array<SessionListEntry>
  ) => Promise<boolean> | boolean | void
}

function normalizeDeleteTargets(targets: Array<SessionListEntry>) {
  const nextTargets: Array<SessionListEntry> = []
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

export function DeleteSessionsDialogController({
  ref,
  openStateRef,
  onDeleteSession,
}: DeleteSessionsDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const [targets, setTargets] = React.useState<Array<SessionListEntry>>([])
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setTargets([])
    }
  }

  const openTargets = (nextTargets: Array<SessionListEntry>) => {
    const normalizedTargets = normalizeDeleteTargets(nextTargets)
    if (normalizedTargets.length === 0) return

    setTargets(normalizedTargets)
    setOpenState(true)
  }

  const submitDelete = async () => {
    const success = await onDeleteSession(targets)
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

  const title = targets.length === 1 ? "Delete session" : "Delete sessions"
  const description =
    targets.length === 1
      ? `Delete "${targets[0]?.title || "New session"}" from disk?`
      : `Delete ${targets.length} selected sessions from disk?`

  return (
    <DeleteSessionsDialog
      open={open}
      onOpenChange={setOpenState}
      title={title}
      description={description}
      onDeleteSession={() => {
        void submitDelete()
      }}
    />
  )
}

type ForkSessionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  forkLoading: boolean
  forkMessages: Array<ForkMessage> | null
  onForkFromMessage: (entryId: string) => void
}

function ForkSessionDialog({
  open,
  onOpenChange,
  forkLoading,
  forkMessages,
  onForkFromMessage,
}: ForkSessionDialogProps) {
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
            <DrawerTitle>Fork session</DrawerTitle>
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
      title="Fork session"
      description="Search earlier user prompts and branch from a specific point."
      className="sm:max-w-2xl"
      initialFocus
    >
      {forkDialogBody}
    </CommandDialog>
  )
}
export type ForkSessionDialogHandle = {
  open: () => Promise<void> | void
  close: () => void
  isOpen: () => boolean
}

type ForkSessionDialogControllerProps = {
  ref?: React.Ref<ForkSessionDialogHandle>
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
  sessionScopeKey: string
  sessionId?: string
}

export function ForkSessionDialogController({
  ref,
  openStateRef,
  viewerContextId,
  sessionScopeKey,
  sessionId,
}: ForkSessionDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)
  const queryClient = useQueryClient()
  const queryKey = picoQueryKeys.forkableMessages(
    viewerContextId,
    sessionScopeKey
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
        buildRequestUrl("/api/session/fork", {
          contextId: viewerContextId,
          sessionId,
        })
      ),
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
    enabled: Boolean(viewerContextId && open && sessionScopeKey),
  })

  const forkFromMessageMutation = useMutation({
    mutationFn: async (entryId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<ForkSessionResponse>(
        buildRequestUrl("/api/session/fork", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId }),
        }
      )
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
      toast.success("Forked session")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fork session"
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
    <ForkSessionDialog
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
