import * as React from "react"

import type { ForkMessage } from "@/features/pi-web/app-shell-dialog-types"
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>
            Update the display name shown in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          placeholder="Session name"
        />
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

  React.useEffect(() => {
    if (!open && forkQuery) {
      setForkQuery("")
    }
  }, [open, forkQuery])

  const filteredForkMessages = (forkMessages ?? []).filter((message) =>
    message.text.toLowerCase().includes(forkQuery.trim().toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fork session</DialogTitle>
          <DialogDescription>
            Search earlier user prompts and branch from a specific point.
          </DialogDescription>
        </DialogHeader>
        {forkLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Loading fork points…
          </div>
        ) : (
          <Command shouldFilter={false} className="rounded-lg border">
            <CommandInput
              autoFocus
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
        )}
      </DialogContent>
    </Dialog>
  )
}
