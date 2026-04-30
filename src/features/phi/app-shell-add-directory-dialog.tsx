import * as React from "react"

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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"

function formatDirectoryDisplayPath(value: string) {
  const path = value.trim()
  if (!path) return value

  const displayPath = path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")

  return displayPath === "~" ? "~/" : displayPath
}

function normalizeDirectorySearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
}

function directoryMatchesQuery(directoryPath: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const displayPath = formatDirectoryDisplayPath(directoryPath)
  const normalizedSearchQuery = normalizeDirectorySearchText(query)

  return (
    directoryPath.toLowerCase().includes(normalizedQuery) ||
    displayPath.toLowerCase().includes(normalizedQuery) ||
    normalizeDirectorySearchText(directoryPath).includes(
      normalizedSearchQuery
    ) ||
    normalizeDirectorySearchText(displayPath).includes(normalizedSearchQuery)
  )
}

function directoryDialogHasExactMatch(
  directoryPaths: Array<string>,
  normalizedQuery: string
) {
  if (!normalizedQuery) return false
  return directoryPaths.some((directoryPath) => {
    const normalizedPath = directoryPath.trim().toLowerCase()
    const normalizedDisplayPath = formatDirectoryDisplayPath(directoryPath)
      .trim()
      .toLowerCase()

    return (
      normalizedPath === normalizedQuery ||
      normalizedDisplayPath === normalizedQuery
    )
  })
}

function splitDisplayPath(value: string) {
  if (!value) return { leading: "", trailing: "" }

  const trimmed = value.replace(/[\\/]+$/, "")
  if (!trimmed) {
    return { leading: "", trailing: value }
  }

  const suffix = value.slice(trimmed.length)
  const separatorIndex = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\")
  )

  if (separatorIndex < 0 || separatorIndex === trimmed.length - 1) {
    return { leading: "", trailing: `${trimmed}${suffix}` }
  }

  return {
    leading: trimmed.slice(0, separatorIndex + 1),
    trailing: `${trimmed.slice(separatorIndex + 1)}${suffix}`,
  }
}

function DirectoryPathLabel({
  path,
  prefix,
}: {
  path: string
  prefix?: string
}) {
  const displayPath = formatDirectoryDisplayPath(path)
  const { leading, trailing } = splitDisplayPath(displayPath)

  return (
    <span className="flex min-w-0 items-center text-foreground">
      {prefix ? <span className="shrink-0 font-medium">{prefix}</span> : null}
      {leading ? (
        <span className="truncate text-muted-foreground">{leading}</span>
      ) : null}
      <span className="shrink-0 font-medium">{trailing || displayPath}</span>
    </span>
  )
}

function FooterKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
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
    <Command shouldFilter={false} loop className="min-h-0 flex-1 rounded-lg">
      <CommandInput
        autoFocus={!isMobile}
        value={directoryInput}
        onValueChange={onDirectoryInputChange}
        placeholder="Search or paste a path"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        {!hasDirectoryResults ? (
          <CommandEmpty>
            {directoryQuery
              ? "No directories found. Type or paste a path to add it."
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
                <DirectoryPathLabel path={manualPath} prefix="Add " />
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
                  <DirectoryPathLabel path={directoryPath} />
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
                  <DirectoryPathLabel path={directoryPath} />
                  <span className="truncate text-xs text-muted-foreground">
                    Use the current Phi working directory.
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
                <DirectoryPathLabel path={directoryPath} />
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
                <DirectoryPathLabel path={directoryPath} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
        <span className="inline-flex items-center gap-1">
          <FooterKbd>↑↓</FooterKbd> Navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <FooterKbd>Enter</FooterKbd> Select
        </span>
        <span className="inline-flex items-center gap-1">
          <FooterKbd>Esc</FooterKbd> Close
        </span>
      </div>
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {directoryPicker}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add directory"
      description="Search recent and known directories or add a new path to the sidebar."
      className="sm:max-w-2xl"
      initialFocus
    >
      {directoryPicker}
    </CommandDialog>
  )
}
type AppShellAddDirectoryDialogControllerProps = {
  ref?: React.Ref<AppShellAddDirectoryDialogHandle>
  openStateRef?: React.RefObject<boolean>
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
      onAddDirectoryPath={(path) => {
        void addDirectoryPath(path)
      }}
    />
  )
}
