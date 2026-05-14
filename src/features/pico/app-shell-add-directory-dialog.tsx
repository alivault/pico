import * as React from "react"
import { AsyncDebouncer } from "@tanstack/pacer"

import type { CompletionItem } from "@/lib/pico/api"

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
import { Kbd } from "@/components/ui/kbd"
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
  prefix?: React.ReactNode
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
  return <Kbd>{children}</Kbd>
}

type PathCompletionLoader = (prefix: string) => Promise<Array<CompletionItem>>
type DirectorySearchLoader = (query: string) => Promise<Array<CompletionItem>>

function pathCompletionCommandValue(item: CompletionItem, index: number) {
  return `path-completion:${index}:${item.value}`
}

function directorySearchCommandValue(item: CompletionItem, index: number) {
  return `directory-search:${index}:${item.value}`
}

function directoryInputLooksLikePath(value: string) {
  const input = value.trim()
  return (
    input.startsWith("~") ||
    input.startsWith(".") ||
    input.startsWith("/") ||
    input.includes("/") ||
    input.includes("\\")
  )
}

function directoryCompletionInputValue(item: CompletionItem) {
  const displayPath = formatDirectoryDisplayPath(item.value)
  return displayPath.endsWith("/") ? displayPath : `${displayPath}/`
}

export type AppShellAddDirectoryDialogHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

type AddDirectoryDialogState = {
  pathCompletionItems: Array<CompletionItem>
  pathCompletionLoading: boolean
  directorySearchItems: Array<CompletionItem>
  directorySearchLoading: boolean
  selectedCommandValue: string
}

type AddDirectoryDialogAction =
  | { type: "pathCompletionsStarted" }
  | { type: "pathCompletionsFinished"; items: Array<CompletionItem> }
  | { type: "pathCompletionsReset" }
  | { type: "directorySearchStarted" }
  | { type: "directorySearchFinished"; items: Array<CompletionItem> }
  | { type: "directorySearchReset" }
  | { type: "selectedCommandValueChanged"; value: string }

const initialAddDirectoryDialogState: AddDirectoryDialogState = {
  pathCompletionItems: [],
  pathCompletionLoading: false,
  directorySearchItems: [],
  directorySearchLoading: false,
  selectedCommandValue: "",
}

function addDirectoryDialogReducer(
  state: AddDirectoryDialogState,
  action: AddDirectoryDialogAction
): AddDirectoryDialogState {
  switch (action.type) {
    case "pathCompletionsStarted":
      return {
        ...state,
        pathCompletionLoading: true,
        pathCompletionItems: [],
      }
    case "pathCompletionsFinished":
      return {
        ...state,
        pathCompletionLoading: false,
        pathCompletionItems: action.items,
      }
    case "pathCompletionsReset":
      if (
        !state.pathCompletionLoading &&
        state.pathCompletionItems.length === 0
      ) {
        return state
      }

      return {
        ...state,
        pathCompletionLoading: false,
        pathCompletionItems: [],
      }
    case "directorySearchStarted":
      return {
        ...state,
        directorySearchLoading: true,
        directorySearchItems: [],
      }
    case "directorySearchFinished":
      return {
        ...state,
        directorySearchLoading: false,
        directorySearchItems: action.items,
      }
    case "directorySearchReset":
      if (
        !state.directorySearchLoading &&
        state.directorySearchItems.length === 0
      ) {
        return state
      }

      return {
        ...state,
        directorySearchLoading: false,
        directorySearchItems: [],
      }
    case "selectedCommandValueChanged":
      return state.selectedCommandValue === action.value
        ? state
        : { ...state, selectedCommandValue: action.value }
    default:
      return state
  }
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
  useForNewSession?: boolean
  useForMoveSession?: boolean
  onAddDirectoryPath: (path: string) => void
  onRequestPathCompletions?: (prefix: string) => Promise<Array<CompletionItem>>
  onSearchDirectories?: (query: string) => Promise<Array<CompletionItem>>
}

function AppShellAddDirectoryDialog({
  open,
  onOpenChange,
  directoryInput,
  onDirectoryInputChange,
  openedDirectories,
  currentDirectory,
  recentDirectories,
  knownDirectories,
  useForNewSession = false,
  useForMoveSession = false,
  onAddDirectoryPath,
  onRequestPathCompletions,
  onSearchDirectories,
}: AppShellAddDirectoryDialogProps) {
  const isMobile = useIsMobile()
  const directoryInputRef = React.useRef(directoryInput)
  const pathCompletionRequestIdRef = React.useRef(0)
  const directorySearchRequestIdRef = React.useRef(0)
  const requestPathCompletionsRef = React.useRef(onRequestPathCompletions)
  const searchDirectoriesRef = React.useRef(onSearchDirectories)
  const [state, dispatch] = React.useReducer(
    addDirectoryDialogReducer,
    initialAddDirectoryDialogState
  )
  const {
    pathCompletionItems,
    pathCompletionLoading,
    directorySearchItems,
    directorySearchLoading,
    selectedCommandValue,
  } = state
  directoryInputRef.current = directoryInput
  requestPathCompletionsRef.current = onRequestPathCompletions
  searchDirectoriesRef.current = onSearchDirectories
  const pathCompletionDebouncerRef =
    React.useRef<AsyncDebouncer<PathCompletionLoader> | null>(null)
  if (!pathCompletionDebouncerRef.current) {
    pathCompletionDebouncerRef.current =
      new AsyncDebouncer<PathCompletionLoader>(
        async (prefix) => {
          const requestPathCompletions = requestPathCompletionsRef.current
          if (!requestPathCompletions) return []
          return await requestPathCompletions(prefix)
        },
        {
          key: "pico.add-directory.path-completions",
          wait: 80,
        }
      )
  }
  const pathCompletionDebouncer = pathCompletionDebouncerRef.current
  const directorySearchDebouncerRef =
    React.useRef<AsyncDebouncer<DirectorySearchLoader> | null>(null)
  if (!directorySearchDebouncerRef.current) {
    directorySearchDebouncerRef.current =
      new AsyncDebouncer<DirectorySearchLoader>(
        async (query) => {
          const searchDirectories = searchDirectoriesRef.current
          if (!searchDirectories) return []
          return await searchDirectories(query)
        },
        {
          key: "pico.add-directory.directory-search",
          wait: 120,
        }
      )
  }
  const directorySearchDebouncer = directorySearchDebouncerRef.current
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
  const recentMatching = recentDirectories.filter(
    (directoryPath) =>
      !openedSet.has(directoryPath) &&
      directoryMatchesQuery(directoryPath, directoryQuery)
  )
  const knownMatching = knownDirectories.filter(
    (directoryPath) =>
      !openedSet.has(directoryPath) &&
      directoryPath !== currentDirectory &&
      !recentSet.has(directoryPath) &&
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
  const hasDirectoryMatches =
    openedMatching.length > 0 ||
    currentMatching.length > 0 ||
    recentMatching.length > 0 ||
    knownMatching.length > 0
  const queryLooksLikePath = directoryInputLooksLikePath(directoryQuery)
  const shouldShowPathCompletions = Boolean(
    directoryQuery &&
    onRequestPathCompletions &&
    !hasDirectoryMatches &&
    queryLooksLikePath
  )
  const shouldShowDirectorySearch = Boolean(
    directoryQuery &&
    onSearchDirectories &&
    !hasDirectoryMatches &&
    !queryLooksLikePath
  )
  const hasPathCompletionResults =
    shouldShowPathCompletions &&
    (pathCompletionLoading || pathCompletionItems.length > 0)
  const hasDirectorySearchResults =
    shouldShowDirectorySearch &&
    (directorySearchLoading || directorySearchItems.length > 0)
  const hasDirectoryResults =
    Boolean(manualPath) ||
    hasDirectoryMatches ||
    hasPathCompletionResults ||
    hasDirectorySearchResults
  const addPathDescription = useForMoveSession
    ? "Resolve and move this session to this directory."
    : useForNewSession
      ? "Add to sidebar and use for this new session."
      : "Resolve and add this path to the sidebar."
  const openedDescription = useForMoveSession
    ? "Move this session here."
    : useForNewSession
      ? "Use for this new session."
      : "Expand and show it in the sidebar."
  const currentDescription = useForMoveSession
    ? "Move this session to the current Pico working directory."
    : useForNewSession
      ? "Use the current Pico working directory for this new session."
      : "Use the current Pico working directory."
  const addKnownDescription = useForMoveSession
    ? "Move this session here."
    : useForNewSession
      ? "Add to sidebar and use for this new session."
      : ""
  const manualGroupHeading = useForMoveSession ? "Move to path" : "Add path"
  const manualPathPrefix = useForMoveSession ? "Move to" : "Add"
  const dialogTitle = useForMoveSession ? "Move session" : "Add directory"
  const dialogDescription = useForMoveSession
    ? "Search recent and known directories or paste any path to move this session."
    : "Search recent and known directories or add a new path to the sidebar."

  React.useEffect(() => {
    if (!shouldShowPathCompletions) {
      pathCompletionRequestIdRef.current += 1
      pathCompletionDebouncer.cancel()
      dispatch({ type: "pathCompletionsReset" })
      return
    }

    const requestedPrefix = directoryQuery
    const requestId = pathCompletionRequestIdRef.current + 1
    pathCompletionRequestIdRef.current = requestId
    dispatch({ type: "pathCompletionsStarted" })

    const load = async () => {
      try {
        const completions =
          await pathCompletionDebouncer.maybeExecute(requestedPrefix)
        if (
          requestId !== pathCompletionRequestIdRef.current ||
          directoryInputRef.current.trim() !== requestedPrefix
        ) {
          return
        }

        dispatch({
          type: "pathCompletionsFinished",
          items: (completions ?? []).filter(
            (item) => item.isDirectory && item.value.trim() !== requestedPrefix
          ),
        })
      } catch {
        if (requestId === pathCompletionRequestIdRef.current) {
          dispatch({ type: "pathCompletionsReset" })
        }
      }
    }

    void load()
  }, [directoryQuery, pathCompletionDebouncer, shouldShowPathCompletions])

  React.useEffect(() => {
    if (!shouldShowDirectorySearch) {
      directorySearchRequestIdRef.current += 1
      directorySearchDebouncer.cancel()
      dispatch({ type: "directorySearchReset" })
      return
    }

    const requestedQuery = directoryQuery
    const requestId = directorySearchRequestIdRef.current + 1
    directorySearchRequestIdRef.current = requestId
    dispatch({ type: "directorySearchStarted" })

    const load = async () => {
      try {
        const completions =
          await directorySearchDebouncer.maybeExecute(requestedQuery)
        if (
          requestId !== directorySearchRequestIdRef.current ||
          directoryInputRef.current.trim() !== requestedQuery
        ) {
          return
        }

        dispatch({
          type: "directorySearchFinished",
          items: (completions ?? []).filter((item) => item.isDirectory),
        })
      } catch {
        if (requestId === directorySearchRequestIdRef.current) {
          dispatch({ type: "directorySearchReset" })
        }
      }
    }

    void load()
  }, [directoryQuery, directorySearchDebouncer, shouldShowDirectorySearch])

  React.useEffect(
    () => () => {
      pathCompletionDebouncer.cancel()
      pathCompletionDebouncer.abort()
      directorySearchDebouncer.cancel()
      directorySearchDebouncer.abort()
    },
    [directorySearchDebouncer, pathCompletionDebouncer]
  )

  const commandValues = [
    ...pathCompletionItems.map(pathCompletionCommandValue),
    ...directorySearchItems.map(directorySearchCommandValue),
    ...(manualPath ? [`add ${manualPath}`] : []),
    ...openedMatching.map((directoryPath) => `opened ${directoryPath}`),
    ...currentMatching.map((directoryPath) => `current ${directoryPath}`),
    ...recentMatching.map((directoryPath) => `recent ${directoryPath}`),
    ...knownMatching.map((directoryPath) => `known ${directoryPath}`),
  ]

  React.useEffect(() => {
    if (selectedCommandValue && commandValues.includes(selectedCommandValue)) {
      return
    }

    dispatch({
      type: "selectedCommandValueChanged",
      value: commandValues[0] || "",
    })
  }, [commandValues, selectedCommandValue])

  const selectedPathCompletionItem = pathCompletionItems.find(
    (item, index) =>
      pathCompletionCommandValue(item, index) === selectedCommandValue
  )
  const selectedDirectorySearchItem = directorySearchItems.find(
    (item, index) =>
      directorySearchCommandValue(item, index) === selectedCommandValue
  )

  const applyDirectoryCompletion = (completion: CompletionItem) => {
    onDirectoryInputChange(completion.value)
    return true
  }

  const applyDirectorySearchCompletion = (completion: CompletionItem) => {
    onDirectoryInputChange(directoryCompletionInputValue(completion))
    return true
  }

  const completeDirectoryInput = async () => {
    const visiblePathCompletion = selectedPathCompletionItem
    if (visiblePathCompletion) {
      return applyDirectoryCompletion(visiblePathCompletion)
    }

    const visibleDirectorySearchItem = selectedDirectorySearchItem
    if (visibleDirectorySearchItem) {
      return applyDirectorySearchCompletion(visibleDirectorySearchItem)
    }

    const currentInput = directoryInputRef.current.trim()
    if (!currentInput) return false

    if (!directoryInputLooksLikePath(currentInput) && onSearchDirectories) {
      const requestId = directorySearchRequestIdRef.current + 1
      directorySearchRequestIdRef.current = requestId

      try {
        const completions = await onSearchDirectories(currentInput)
        if (
          requestId !== directorySearchRequestIdRef.current ||
          directoryInputRef.current.trim() !== currentInput
        ) {
          return true
        }

        const completion = completions.find((item) => item.isDirectory)
        if (!completion) return false

        return applyDirectorySearchCompletion(completion)
      } catch {
        return false
      }
    }

    if (!onRequestPathCompletions) return false

    const requestId = pathCompletionRequestIdRef.current + 1
    pathCompletionRequestIdRef.current = requestId

    try {
      const completions = await onRequestPathCompletions(currentInput)
      if (
        requestId !== pathCompletionRequestIdRef.current ||
        directoryInputRef.current.trim() !== currentInput
      ) {
        return true
      }

      const completion = completions.find(
        (item) => item.isDirectory && item.value.trim() !== currentInput
      )
      if (!completion) return false

      return applyDirectoryCompletion(completion)
    } catch {
      return false
    }
  }

  const handleDirectoryInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (
      event.key !== "Tab" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (!onRequestPathCompletions && !onSearchDirectories) ||
      !directoryInput.trim()
    ) {
      return
    }

    event.preventDefault()
    void completeDirectoryInput()
  }

  const directoryPicker = (
    <Command
      shouldFilter={false}
      loop
      value={selectedCommandValue}
      onValueChange={(value) => {
        dispatch({ type: "selectedCommandValueChanged", value })
      }}
      className="min-h-0 flex-1 rounded-lg"
    >
      <CommandInput
        value={directoryInput}
        onValueChange={onDirectoryInputChange}
        onKeyDown={handleDirectoryInputKeyDown}
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
        {shouldShowPathCompletions &&
        (pathCompletionLoading || pathCompletionItems.length > 0) ? (
          <CommandGroup heading="Path completions">
            {pathCompletionLoading && pathCompletionItems.length === 0 ? (
              <CommandItem value="path-completion:loading" disabled>
                Loading directories…
              </CommandItem>
            ) : null}
            {pathCompletionItems.map((completion, index) => (
              <CommandItem
                key={`path-completion:${completion.value}`}
                value={pathCompletionCommandValue(completion, index)}
                onSelect={() => onAddDirectoryPath(completion.value)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <DirectoryPathLabel path={completion.value} />
                  <span className="truncate text-xs text-muted-foreground">
                    Press Tab to complete this path instead.
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {shouldShowDirectorySearch &&
        (directorySearchLoading || directorySearchItems.length > 0) ? (
          <CommandGroup heading="Matching folders">
            {directorySearchLoading && directorySearchItems.length === 0 ? (
              <CommandItem value="directory-search:loading" disabled>
                Searching directories…
              </CommandItem>
            ) : null}
            {directorySearchItems.map((completion, index) => (
              <CommandItem
                key={`directory-search:${completion.value}`}
                value={directorySearchCommandValue(completion, index)}
                onSelect={() => onAddDirectoryPath(completion.value)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <DirectoryPathLabel path={completion.value} />
                  <span className="truncate text-xs text-muted-foreground">
                    {completion.description || "Found on disk"}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {manualPath ? (
          <CommandGroup heading={manualGroupHeading}>
            <CommandItem
              value={`add ${manualPath}`}
              onSelect={() => onAddDirectoryPath(manualPath)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <DirectoryPathLabel
                  path={manualPath}
                  prefix={<>{manualPathPrefix}&nbsp;</>}
                />
                <span className="truncate text-xs text-muted-foreground">
                  {addPathDescription}
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
                    {openedDescription}
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
                    {currentDescription}
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
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <DirectoryPathLabel path={directoryPath} />
                  {addKnownDescription ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {addKnownDescription}
                    </span>
                  ) : null}
                </div>
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
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <DirectoryPathLabel path={directoryPath} />
                  {addKnownDescription ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {addKnownDescription}
                    </span>
                  ) : null}
                </div>
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
        {onRequestPathCompletions || onSearchDirectories ? (
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Tab</FooterKbd> Complete
          </span>
        ) : null}
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
            <DrawerTitle>{dialogTitle}</DrawerTitle>
            <DrawerDescription>{dialogDescription}</DrawerDescription>
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
      title={dialogTitle}
      description={dialogDescription}
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
  useForNewSession?: boolean
  useForMoveSession?: boolean
  onAddDirectoryPath: (
    path: string
  ) => Promise<boolean | string> | boolean | string | void
  onRequestPathCompletions?: (prefix: string) => Promise<Array<CompletionItem>>
  onSearchDirectories?: (query: string) => Promise<Array<CompletionItem>>
}

export function AppShellAddDirectoryDialogController({
  ref,
  openStateRef,
  openedDirectories,
  currentDirectory,
  recentDirectories,
  knownDirectories,
  useForNewSession,
  useForMoveSession,
  onAddDirectoryPath,
  onRequestPathCompletions,
  onSearchDirectories,
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
      useForNewSession={useForNewSession}
      useForMoveSession={useForMoveSession}
      onAddDirectoryPath={(path) => {
        void addDirectoryPath(path)
      }}
      onRequestPathCompletions={onRequestPathCompletions}
      onSearchDirectories={onSearchDirectories}
    />
  )
}
