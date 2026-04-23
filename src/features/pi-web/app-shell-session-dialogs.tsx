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
import { useIsMobile } from "@/hooks/use-mobile"

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
