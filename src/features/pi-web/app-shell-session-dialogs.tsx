import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ForkMessage } from "@/features/pi-web/app-shell-dialog-types"
import type {
  ForkSessionResponse,
  ForkableMessagesResponse,
  SessionListEntry,
} from "@/lib/pi-web-api"
import { Button } from "@/components/ui/button"
import {
  Command,
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
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { piWebQueryKeys } from "@/features/pi-web/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"

type ForkableMessagesData = Extract<ForkableMessagesResponse, { ok: true }>

type RenameSessionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRenameSession: () => void
}

export function RenameSessionDialog({
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
  openStateRef?: React.MutableRefObject<boolean>
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

export function DeleteSessionsDialog({
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

type DeleteSessionsDialogControllerProps = {
  ref?: React.Ref<DeleteSessionsDialogHandle>
  openStateRef?: React.MutableRefObject<boolean>
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

export function ForkSessionDialog({
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

  const forkDialogBody = forkLoading ? (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Spinner /> Loading fork points…
    </div>
  ) : (
    <Command shouldFilter={false} className="rounded-lg border">
      <CommandInput
        autoFocus={!isMobile}
        value={forkQuery}
        onValueChange={setForkQuery}
        placeholder="Search fork points"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-[60vh]">
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
      </CommandList>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Fork session</DrawerTitle>
            <DrawerDescription>
              Search earlier user prompts and branch from a specific point.
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {forkDialogBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fork session</DialogTitle>
          <DialogDescription>
            Search earlier user prompts and branch from a specific point.
          </DialogDescription>
        </DialogHeader>
        {forkDialogBody}
      </DialogContent>
    </Dialog>
  )
}
export type ForkSessionDialogHandle = {
  open: () => Promise<void> | void
  close: () => void
  isOpen: () => boolean
}

type ForkSessionDialogControllerProps = {
  ref?: React.Ref<ForkSessionDialogHandle>
  openStateRef?: React.MutableRefObject<boolean>
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
  const queryKey = piWebQueryKeys.forkableMessages(
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
