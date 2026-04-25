import * as React from "react"

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
import { useIsMobile } from "@/hooks/use-mobile"

function directoryMatchesQuery(directoryPath: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return directoryPath.toLowerCase().includes(normalizedQuery)
}

function directoryDialogHasExactMatch(
  directoryPaths: Array<string>,
  normalizedQuery: string
) {
  if (!normalizedQuery) return false
  return directoryPaths.some(
    (directoryPath) => directoryPath.trim().toLowerCase() === normalizedQuery
  )
}

export type AppShellAddDirectoryDialogHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

type AppShellAddDirectoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  directoryInput: string
  onDirectoryInputChange: (value: string) => void
  openedDirectories: Array<string>
  currentDirectory?: string
  recentDirectories: Array<string>
  knownDirectories: Array<string>
  onAddDirectory: () => void
  onAddDirectoryPath: (path: string) => void
}

export function AppShellAddDirectoryDialog({
  open,
  onOpenChange,
  directoryInput,
  onDirectoryInputChange,
  openedDirectories,
  currentDirectory,
  recentDirectories,
  knownDirectories,
  onAddDirectory,
  onAddDirectoryPath,
}: AppShellAddDirectoryDialogProps) {
  const isMobile = useIsMobile()
  const directoryQuery = directoryInput.trim()
  const normalizedDirectoryQuery = directoryQuery.toLowerCase()
  const openedSet = new Set(openedDirectories)
  const recentSet = new Set(recentDirectories)
  const openedMatching = directoryQuery
    ? openedDirectories.filter((directoryPath) =>
        directoryMatchesQuery(directoryPath, directoryQuery)
      )
    : []
  const currentMatching =
    currentDirectory &&
    !openedSet.has(currentDirectory) &&
    directoryMatchesQuery(currentDirectory, directoryQuery)
      ? [currentDirectory]
      : []
  const recentMatching = recentDirectories
    .filter((directoryPath) => !openedSet.has(directoryPath))
    .filter((directoryPath) =>
      directoryMatchesQuery(directoryPath, directoryQuery)
    )
  const knownMatching = knownDirectories
    .filter((directoryPath) => !openedSet.has(directoryPath))
    .filter((directoryPath) => directoryPath !== currentDirectory)
    .filter((directoryPath) => !recentSet.has(directoryPath))
    .filter((directoryPath) =>
      directoryMatchesQuery(directoryPath, directoryQuery)
    )
  const manualPath =
    directoryQuery &&
    !directoryDialogHasExactMatch(
      [...openedDirectories, ...recentDirectories, ...knownDirectories],
      normalizedDirectoryQuery
    )
      ? directoryQuery
      : ""
  const hasDirectoryResults =
    Boolean(manualPath) ||
    openedMatching.length > 0 ||
    currentMatching.length > 0 ||
    recentMatching.length > 0 ||
    knownMatching.length > 0

  const directoryPicker = (
    <Command shouldFilter={false} className="rounded-lg border">
      <CommandInput
        autoFocus={!isMobile}
        value={directoryInput}
        onValueChange={onDirectoryInputChange}
        placeholder="Search or paste a path"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-[50vh]">
        {!hasDirectoryResults ? (
          <CommandEmpty>
            {directoryQuery
              ? "No directories found. Press Add to use the typed path."
              : "No recent or discovered directories yet."}
          </CommandEmpty>
        ) : null}
        {manualPath ? (
          <CommandGroup heading="Add path">
            <CommandItem
              value={`add ${manualPath}`}
              onSelect={() => onAddDirectoryPath(manualPath)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">Add {manualPath}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Resolve and add this path to the sidebar.
                </span>
              </div>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {openedMatching.length > 0 ? (
          <CommandGroup heading="Already added">
            {openedMatching.map((directoryPath) => (
              <CommandItem
                key={`opened:${directoryPath}`}
                value={`opened ${directoryPath}`}
                onSelect={() => onAddDirectoryPath(directoryPath)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{directoryPath}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Expand and show it in the sidebar.
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {currentMatching.length > 0 ? (
          <CommandGroup heading="Current directory">
            {currentMatching.map((directoryPath) => (
              <CommandItem
                key={`current:${directoryPath}`}
                value={`current ${directoryPath}`}
                onSelect={() => onAddDirectoryPath(directoryPath)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{directoryPath}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Use the current Pi working directory.
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {recentMatching.length > 0 ? (
          <CommandGroup heading="Recent directories">
            {recentMatching.map((directoryPath) => (
              <CommandItem
                key={`recent:${directoryPath}`}
                value={`recent ${directoryPath}`}
                onSelect={() => onAddDirectoryPath(directoryPath)}
              >
                <span className="truncate">{directoryPath}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {knownMatching.length > 0 ? (
          <CommandGroup
            heading={
              directoryQuery ? "Matching directories" : "Known directories"
            }
          >
            {knownMatching.map((directoryPath) => (
              <CommandItem
                key={`known:${directoryPath}`}
                value={`known ${directoryPath}`}
                onSelect={() => onAddDirectoryPath(directoryPath)}
              >
                <span className="truncate">{directoryPath}</span>
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
            <DrawerTitle>Add directory</DrawerTitle>
            <DrawerDescription>
              Search recent and known directories or add a new path to the
              sidebar.
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            {directoryPicker}
          </div>
          <DrawerFooter className="border-t border-border/70">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onAddDirectory} disabled={!directoryQuery}>
              Add
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add directory</DialogTitle>
          <DialogDescription>
            Search recent and known directories or add a new path to the
            sidebar.
          </DialogDescription>
        </DialogHeader>
        {directoryPicker}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onAddDirectory} disabled={!directoryQuery}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
type AppShellAddDirectoryDialogControllerProps = {
  ref?: React.Ref<AppShellAddDirectoryDialogHandle>
  openStateRef?: React.MutableRefObject<boolean>
  openedDirectories: Array<string>
  currentDirectory?: string
  recentDirectories: Array<string>
  knownDirectories: Array<string>
  onAddDirectoryPath: (path: string) => Promise<boolean> | boolean | void
}

export function AppShellAddDirectoryDialogController({
  ref,
  openStateRef,
  openedDirectories,
  currentDirectory,
  recentDirectories,
  knownDirectories,
  onAddDirectoryPath,
}: AppShellAddDirectoryDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const [directoryInput, setDirectoryInput] = React.useState("")
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  const addDirectoryPath = async (path: string) => {
    const success = await onAddDirectoryPath(path)
    if (success === false) return

    setDirectoryInput("")
    setOpenState(false)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setDirectoryInput("")
        setOpenState(true)
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    []
  )

  return (
    <AppShellAddDirectoryDialog
      open={open}
      onOpenChange={setOpenState}
      directoryInput={directoryInput}
      onDirectoryInputChange={setDirectoryInput}
      openedDirectories={openedDirectories}
      currentDirectory={currentDirectory}
      recentDirectories={recentDirectories}
      knownDirectories={knownDirectories}
      onAddDirectory={() => {
        void addDirectoryPath(directoryInput)
      }}
      onAddDirectoryPath={(path) => {
        void addDirectoryPath(path)
      }}
    />
  )
}
