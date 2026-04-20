"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderTreeIcon,
  GitBranchIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  SplitIcon,
  Trash2Icon,
  WaypointsIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  buildItemsFromSync,
  clampSidebarDirectories,
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  createContextId,
  createInitialSessionState,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  filterFlatTree,
  flattenTree,
  getSessionTitle,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  normalizePromptImage,
  normalizeStoredDirectoryList,
  previewUrlForImage,
  readStoredCollapsedDirectories,
  readStoredSidebarDirectories,
  relativeTime,
  safeLocalStorageSetItem,
  type ConversationItem,
  type PromptImage,
  type SessionState,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
} from "@/lib/pi-web"
import {
  type DeleteSessionResponse,
  type DirectoryResolveResponse,
  type DirectorySessionsIndexResponse,
  type ExtensionUiEvent,
  type ForkableMessagesResponse,
  type ForkSessionResponse,
  type GitChangesResponse,
  type GitStatusResponse,
  isApiErrorResponse,
  isSessionsEvent,
  isStateSyncEvent,
  type NavigateSessionTreeResponse,
  type PendingMessageRemoveResponse,
  type PendingMessagesResponse,
  type PiWebServerEvent,
  type PromptResponse,
  type RenameSessionResponse,
  type SessionListEntry,
  type SessionTreeResponse,
  type SessionsEvent,
  type SimpleOkResponse,
  type UiRequestResponse,
} from "@/lib/pi-web-api"

function buildRequestUrl(
  path: string,
  {
    contextId,
    sessionId,
  }: {
    contextId: string
    sessionId?: string
  }
) {
  const url = new URL(path, window.location.origin)
  url.searchParams.set("context", contextId)
  if (sessionId) {
    url.searchParams.set("session", sessionId)
  }
  return url.toString()
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)

  if (!response.ok) {
    const message = isApiErrorResponse(data)
      ? data.error
      : `${response.status} ${response.statusText}`
    throw new Error(message)
  }

  if (isApiErrorResponse(data)) {
    throw new Error(data.error)
  }

  return data
}

async function readFileAsPromptImage(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const data = window.btoa(binary)
  return {
    type: "image",
    mimeType: file.type || "image/png",
    data,
    previewUrl: previewUrlForImage({
      mimeType: file.type || "image/png",
      data,
    }),
  } satisfies PromptImage
}

function updateStateFromSync(
  previous: SessionState,
  sync: Parameters<typeof buildItemsFromSync>[0]
) {
  const { items } = buildItemsFromSync(sync)
  return {
    ...previous,
    connected: true,
    replaying: false,
    streaming: Boolean(sync.streaming),
    draft: Boolean(sync.draft),
    items,
    sessionId: sync.sessionId,
    sessionKey: sync.sessionKey,
    sessionName: sync.sessionName,
    firstMessage: sync.firstMessage || "",
    sessionFile: sync.sessionFile,
    cwd: sync.cwd,
    modified: sync.modified,
    model: sync.model,
    thinkingLevel: sync.thinkingLevel || previous.thinkingLevel,
    availableThinkingLevels:
      sync.availableThinkingLevels || previous.availableThinkingLevels,
    availableModels: sync.availableModels || previous.availableModels,
    availableSkills: sync.availableSkills || previous.availableSkills,
    hideThinkingBlock:
      typeof sync.hideThinkingBlock === "boolean"
        ? sync.hideThinkingBlock
        : previous.hideThinkingBlock,
    contextUsage: sync.contextUsage,
    uiState: sync.uiState || previous.uiState,
  } satisfies SessionState
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:bg-muted prose-code:rounded prose-code:bg-muted/70 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.9em] prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function promptImageKey(image: Pick<PromptImage, "previewUrl" | "data">) {
  return `${image.previewUrl}:${image.data.slice(0, 24)}`
}

function assistantBlockKey(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  switch (block.type) {
    case "text":
      return `text:${block.text}`
    case "thinking":
      return `thinking:${block.text}`
    case "tool":
      return `tool:${block.callId || block.name || "tool"}:${block.output}`
    case "compaction":
      return `compaction:${block.tokensBefore}:${block.summary}`
    default:
      return "block"
  }
}

function conversationItemSignature(item: ConversationItem) {
  if (item.kind === "user") {
    return `user:${item.pendingId || ""}:${item.text}:${item.images
      .map((image) => promptImageKey(image))
      .join(",")}:${item.streamingBehavior || ""}:${item.queued ? "1" : "0"}`
  }

  return `assistant:${item.blocks.map((block) => assistantBlockKey(block)).join("|")}:${
    item.streaming ? "1" : "0"
  }`
}

function UserMessageCard({
  item,
}: {
  item: Extract<ConversationItem, { kind: "user" }>
}) {
  return (
    <div className="ml-auto w-full max-w-3xl rounded-xl border bg-primary/5 p-4">
      {item.images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {item.images.map((image) => (
            <img
              key={promptImageKey(image)}
              src={image.previewUrl}
              alt="Prompt upload"
              className="h-28 rounded-lg border object-cover"
            />
          ))}
        </div>
      )}
      {item.text ? (
        <MarkdownBlock text={item.text} />
      ) : (
        <div className="text-sm text-muted-foreground">Image prompt</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.queued && <Badge variant="outline">Queued</Badge>}
        {item.streamingBehavior && (
          <Badge variant="outline">
            {item.streamingBehavior === "steer" ? "Steer" : "Follow-up"}
          </Badge>
        )}
      </div>
    </div>
  )
}

function AssistantMessageCard({
  item,
  hideThinking,
  hiddenThinkingLabel,
}: {
  item: Extract<ConversationItem, { kind: "assistant" }>
  hideThinking: boolean
  hiddenThinkingLabel?: string
}) {
  return (
    <div className="w-full max-w-3xl rounded-xl border bg-card p-4">
      <div className="space-y-4">
        {(() => {
          const counts = new Map<string, number>()
          return item.blocks.map((block) => {
            const baseKey = assistantBlockKey(block)
            const count = (counts.get(baseKey) ?? 0) + 1
            counts.set(baseKey, count)
            const key = `${baseKey}:${count}`

            if (block.type === "text") {
              return <MarkdownBlock key={key} text={block.text} />
            }

            if (block.type === "thinking") {
              if (hideThinking) {
                return (
                  <div
                    key={key}
                    className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                  >
                    {hiddenThinkingLabel || "Thinking hidden"}
                  </div>
                )
              }

              return (
                <div key={key} className="rounded-lg border bg-muted/40 p-3">
                  <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Thinking
                  </div>
                  <MarkdownBlock text={block.text} />
                </div>
              )
            }

            if (block.type === "tool") {
              return (
                <div
                  key={key}
                  className="rounded-lg border bg-muted/30 p-3 text-sm"
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <Badge variant="outline">Tool</Badge>
                    <span>{block.name || "tool"}</span>
                    {block.running && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Spinner /> Running
                      </span>
                    )}
                    {block.isError && (
                      <Badge variant="destructive">Error</Badge>
                    )}
                  </div>
                  {block.args !== undefined && (
                    <pre className="overflow-x-auto rounded-md bg-background p-2 text-xs">
                      {JSON.stringify(block.args, null, 2)}
                    </pre>
                  )}
                  {block.output && (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-xs whitespace-pre-wrap">
                      {block.output}
                    </pre>
                  )}
                </div>
              )
            }

            if (block.type === "compaction") {
              return (
                <div
                  key={key}
                  className="rounded-lg border bg-muted/30 p-3 text-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline">Compaction</Badge>
                    <span className="text-muted-foreground">
                      {block.tokensBefore.toLocaleString()} tokens before
                    </span>
                  </div>
                  <MarkdownBlock text={block.summary} />
                </div>
              )
            }

            return null
          })
        })()}
      </div>
      {item.streaming && (
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Streaming…
        </div>
      )}
    </div>
  )
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "destructive"}>
      {connected ? "Connected" : "Disconnected"}
    </Badge>
  )
}

export function PiWebAppShell({
  sessionId,
  onSelectSession,
}: {
  sessionId?: string
  onSelectSession?: (sessionId?: string) => void
}) {
  const [viewerContextId, setViewerContextId] = React.useState("")
  const [sessionState, setSessionState] = React.useState<SessionState>(
    createInitialSessionState()
  )
  const [sessionsEvent, setSessionsEvent] =
    React.useState<SessionsEvent | null>(null)
  const [directoryIndexes, setDirectoryIndexes] = React.useState<
    Record<string, Array<SessionListEntry>>
  >({})
  const [directoryIndexLoading, setDirectoryIndexLoading] = React.useState<
    Record<string, boolean>
  >({})
  const [sidebarDirectories, setSidebarDirectories] = React.useState<
    Array<string>
  >([])
  const [collapsedDirectories, setCollapsedDirectories] = React.useState<
    Record<string, boolean>
  >({})
  const [directoryRenderCounts, setDirectoryRenderCounts] = React.useState<
    Record<string, number>
  >({})
  const [sessionSearch, setSessionSearch] = React.useState("")
  const [currentTab, setCurrentTab] = React.useState("session")
  const [composerText, setComposerText] = React.useState("")
  const [composerImages, setComposerImages] = React.useState<
    Array<PromptImage>
  >([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingMessages, setPendingMessages] = React.useState<
    Array<{
      pendingId: string
      text: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
    }>
  >([])
  const [gitStatus, setGitStatus] = React.useState<GitStatusResponse | null>(
    null
  )
  const [gitChanges, setGitChanges] = React.useState<GitChangesResponse | null>(
    null
  )
  const [gitLoading, setGitLoading] = React.useState(false)
  const [addDirectoryOpen, setAddDirectoryOpen] = React.useState(false)
  const [directoryInput, setDirectoryInput] = React.useState("")
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState("")
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [forkOpen, setForkOpen] = React.useState(false)
  const [forkMessages, setForkMessages] = React.useState<Array<{
    entryId: string
    text: string
  }> | null>(null)
  const [forkLoading, setForkLoading] = React.useState(false)
  const [treeOpen, setTreeOpen] = React.useState(false)
  const [treeLoading, setTreeLoading] = React.useState(false)
  const [treeData, setTreeData] = React.useState<SessionTreeResponse | null>(
    null
  )
  const [treeQuery, setTreeQuery] = React.useState("")
  const [selectedTreeNodeId, setSelectedTreeNodeId] = React.useState<
    string | null
  >(null)
  const [selectedTreeNodeLabel, setSelectedTreeNodeLabel] = React.useState("")
  const [pendingUiRequest, setPendingUiRequest] =
    React.useState<ExtensionUiEvent | null>(null)
  const [pendingUiValue, setPendingUiValue] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const lastStreamingRef = React.useRef(false)
  const lastSyncedEditorTextRef = React.useRef("")
  const loadedDirectoryRevisionRef = React.useRef<Record<string, string>>({})

  const activeSessionId = sessionState.sessionId || sessionId
  const directoryStates = sessionsEvent?.directoryStates || []
  const directoryStateByPath = React.useMemo(
    () => new Map(directoryStates.map((state) => [state.path, state])),
    [directoryStates]
  )

  React.useEffect(() => {
    const storedContext = window.localStorage.getItem(
      VIEWER_CONTEXT_STORAGE_KEY
    )
    const nextContext = storedContext?.trim() || createContextId()
    safeLocalStorageSetItem(VIEWER_CONTEXT_STORAGE_KEY, nextContext)
    setViewerContextId(nextContext)

    const storedDirectories = readStoredSidebarDirectories()
    const nextDirectories = normalizeStoredDirectoryList(
      storedDirectories.directories
    )
    setSidebarDirectories(nextDirectories)
    setCollapsedDirectories(readStoredCollapsedDirectories())
  }, [])

  React.useEffect(() => {
    if (!sessionsEvent?.directories) return
    setSidebarDirectories((current) => {
      const next = clampSidebarDirectories(
        current.length > 0 ? current : (sessionsEvent.directories ?? []),
        sessionState.cwd
      )
      if (JSON.stringify(current) === JSON.stringify(next)) {
        return current
      }
      safeLocalStorageSetItem(
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }, [sessionsEvent?.directories, sessionState.cwd])

  React.useEffect(() => {
    if (!viewerContextId) return

    const source = new EventSource(
      buildRequestUrl("/events", {
        contextId: viewerContextId,
        sessionId,
      })
    )

    source.onopen = () => {
      setSessionState((current) => ({ ...current, connected: true }))
    }

    source.onerror = () => {
      setSessionState((current) => ({ ...current, connected: false }))
    }

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as PiWebServerEvent

      if (isStateSyncEvent(payload)) {
        setSessionState((current) => updateStateFromSync(current, payload))
        setPendingMessages(
          Array.isArray(payload.pendingUserMessages)
            ? payload.pendingUserMessages.map((message) => ({
                pendingId:
                  typeof message?.pendingId === "string"
                    ? message.pendingId
                    : "",
                text: typeof message?.text === "string" ? message.text : "",
                images: Array.isArray(message?.images)
                  ? message.images
                      .map((image: unknown) => normalizePromptImage(image))
                      .filter(
                        (image: PromptImage | null): image is PromptImage =>
                          Boolean(image)
                      )
                  : [],
                streamingBehavior:
                  message?.streamingBehavior === "steer" ? "steer" : "followUp",
              }))
            : []
        )
        return
      }

      if (isSessionsEvent(payload)) {
        setSessionsEvent(payload)
        return
      }

      if (payload.type === "request_error") {
        toast.error(payload.error || "Request failed")
        return
      }

      if (payload.type === "extension_error") {
        toast.error(payload.error || "Extension error")
        return
      }

      if (payload.type === "extension_ui_request") {
        if (payload.method === "notify") {
          const notifyMessage = payload.message || "Notification"
          if (payload.notifyType === "success") toast.success(notifyMessage)
          else if (payload.notifyType === "warning")
            toast.warning(notifyMessage)
          else if (payload.notifyType === "error") toast.error(notifyMessage)
          else toast.info(notifyMessage)
          return
        }

        setPendingUiRequest(payload)
        setPendingUiValue(payload.prefill || "")
        return
      }
    }

    return () => {
      source.close()
    }
  }, [viewerContextId, sessionId])

  React.useEffect(() => {
    if (sessionState.sessionId && sessionState.sessionId !== sessionId) {
      onSelectSession?.(sessionState.sessionId)
    }
  }, [onSelectSession, sessionId, sessionState.sessionId])

  React.useEffect(() => {
    const nextEditorText = sessionState.uiState.editorText || ""
    if (nextEditorText !== lastSyncedEditorTextRef.current) {
      setComposerText(nextEditorText)
      lastSyncedEditorTextRef.current = nextEditorText
    }
  }, [sessionState.uiState.editorText])

  React.useEffect(() => {
    if (lastStreamingRef.current && !sessionState.streaming) {
      toast.success("Session finished")
    }
    lastStreamingRef.current = sessionState.streaming
  }, [sessionState.streaming])

  React.useEffect(() => {
    const itemCount = sessionState.items.length
    const streaming = sessionState.streaming
    void itemCount
    void streaming
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [sessionState.items.length, sessionState.streaming])

  const loadDirectoryIndex = React.useCallback(
    async (directory: string, revision?: string) => {
      if (!viewerContextId) return

      setDirectoryIndexLoading((current) => {
        if (current[directory]) {
          return current
        }

        return { ...current, [directory]: true }
      })

      try {
        const response = await fetchJson<DirectorySessionsIndexResponse>(
          buildRequestUrl(
            `/api/directory-sessions-index?directory=${encodeURIComponent(
              directory
            )}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          )
        )

        if (isApiErrorResponse(response)) {
          throw new Error(response.error)
        }

        loadedDirectoryRevisionRef.current[directory] =
          revision || `loaded:${response.sessions.length}`

        setDirectoryIndexes((current) => ({
          ...current,
          [directory]: response.sessions,
        }))
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Failed to load sessions for ${directory}`
        )
      } finally {
        setDirectoryIndexLoading((current) => {
          if (!current[directory]) {
            return current
          }

          return {
            ...current,
            [directory]: false,
          }
        })
      }
    },
    [activeSessionId, viewerContextId]
  )

  React.useEffect(() => {
    if (!viewerContextId || sidebarDirectories.length === 0) return

    for (const directory of sidebarDirectories) {
      const state = directoryStateByPath.get(directory)
      const currentSessions = directoryIndexes[directory]
      const isLoading = Boolean(directoryIndexLoading[directory])
      const loadedRevision = loadedDirectoryRevisionRef.current[directory]
      const needsInitialLoad = currentSessions === undefined
      const needsRevisionRefresh =
        typeof state?.revision === "string" && state.revision !== loadedRevision

      if (!isLoading && (needsInitialLoad || needsRevisionRefresh)) {
        void loadDirectoryIndex(directory, state?.revision)
      }
    }
  }, [
    directoryIndexes,
    directoryIndexLoading,
    directoryStateByPath,
    loadDirectoryIndex,
    sidebarDirectories,
    viewerContextId,
  ])

  const refreshGit = React.useCallback(async () => {
    if (!viewerContextId || !sessionState.cwd) return
    setGitLoading(true)
    try {
      const [nextStatus, nextChanges] = await Promise.all([
        fetchJson<GitStatusResponse>(
          buildRequestUrl(
            `/api/git-status?cwd=${encodeURIComponent(sessionState.cwd)}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          )
        ),
        fetchJson<GitChangesResponse>(
          buildRequestUrl(
            `/api/git-changes?cwd=${encodeURIComponent(sessionState.cwd)}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          )
        ),
      ])
      setGitStatus(nextStatus)
      setGitChanges(nextChanges)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load git view"
      )
    } finally {
      setGitLoading(false)
    }
  }, [activeSessionId, sessionState.cwd, viewerContextId])

  React.useEffect(() => {
    if (currentTab === "git") {
      void refreshGit()
    }
  }, [currentTab, refreshGit])

  const visibleDirectories = React.useMemo(
    () => clampSidebarDirectories(sidebarDirectories, sessionState.cwd),
    [sessionState.cwd, sidebarDirectories]
  )

  const filteredDirectorySessions = React.useMemo(() => {
    const query = sessionSearch.trim().toLowerCase()
    return Object.fromEntries(
      visibleDirectories.map((directory) => {
        const sessions = directoryIndexes[directory] || []
        const filtered = query
          ? sessions.filter((entry) => {
              const haystack = [entry.title, entry.name, entry.path]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
              return haystack.includes(query)
            })
          : sessions
        return [directory, filtered]
      })
    ) as Record<string, Array<SessionListEntry>>
  }, [directoryIndexes, sessionSearch, visibleDirectories])

  const openAddDirectoryDialog = React.useCallback(() => {
    setDirectoryInput("")
    setAddDirectoryOpen(true)
  }, [])

  const loadMoreDirectorySessions = React.useCallback((directory: string) => {
    setDirectoryRenderCounts((current) => ({
      ...current,
      [directory]:
        (current[directory] ?? INITIAL_DIRECTORY_SESSION_RENDER_COUNT) +
        DIRECTORY_SESSION_LOAD_MORE_COUNT,
    }))
  }, [])

  const addDirectory = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      const response = await fetchJson<DirectoryResolveResponse>(
        buildRequestUrl("/api/directory/resolve", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: directoryInput }),
        }
      )
      if (isApiErrorResponse(response)) {
        throw new Error(response.error)
      }
      setSidebarDirectories((current) => {
        const next = normalizeStoredDirectoryList([...current, response.path])
        safeLocalStorageSetItem(
          SIDEBAR_DIRECTORIES_STORAGE_KEY,
          JSON.stringify(next)
        )
        return next
      })
      setAddDirectoryOpen(false)
      void loadDirectoryIndex(response.path)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add directory"
      )
    }
  }, [activeSessionId, directoryInput, loadDirectoryIndex, viewerContextId])

  const toggleDirectory = React.useCallback((directory: string) => {
    setCollapsedDirectories((current) => {
      const next = {
        ...current,
        [directory]: !current[directory],
      }
      safeLocalStorageSetItem(
        COLLAPSED_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }, [])

  const createSession = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/session/new", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: sessionState.cwd }),
        }
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create session"
      )
    }
  }, [activeSessionId, sessionState.cwd, viewerContextId])

  const submitPrompt = React.useCallback(
    async (streamingBehavior?: "steer" | "followUp") => {
      if (!viewerContextId) return
      if (!composerText.trim() && composerImages.length === 0) return

      setIsSubmitting(true)
      try {
        const response = await fetchJson<PromptResponse>(
          buildRequestUrl("/api/prompt", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: composerText,
              images: composerImages,
              streamingBehavior,
            }),
          }
        )
        if (isApiErrorResponse(response)) {
          throw new Error(response.error)
        }
        setComposerText("")
        setComposerImages([])
        lastSyncedEditorTextRef.current = ""
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to submit prompt"
        )
      } finally {
        setIsSubmitting(false)
      }
    },
    [activeSessionId, composerImages, composerText, viewerContextId]
  )

  const onPickImages = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const nextImages = await Promise.all(
      [...files].slice(0, 8).map((file) => readFileAsPromptImage(file))
    )
    setComposerImages((current) => [...current, ...nextImages].slice(0, 8))
  }, [])

  const removePendingMessage = React.useCallback(
    async (pendingId: string) => {
      if (!viewerContextId) return
      try {
        await fetchJson<PendingMessageRemoveResponse>(
          buildRequestUrl("/api/pending-message/remove", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pendingId }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to remove pending prompt"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const currentPendingMessages = pendingMessages

  const reorderPending = React.useCallback(
    async (pendingId: string, direction: -1 | 1) => {
      if (!viewerContextId) return
      const next = [...pendingMessages]
      const index = next.findIndex((entry) => entry.pendingId === pendingId)
      if (index === -1) return
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= next.length) return
      const [item] = next.splice(index, 1)
      if (!item) return
      next.splice(targetIndex, 0, item)
      try {
        await fetchJson<PendingMessagesResponse>(
          buildRequestUrl("/api/pending-messages/reorder", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pendingMessages: next }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to reorder pending prompts"
        )
      }
    },
    [activeSessionId, pendingMessages, viewerContextId]
  )

  const setModel = React.useCallback(
    async (value: string) => {
      if (!viewerContextId) return
      const [provider, modelId] = value.split("/")
      if (!provider || !modelId) return
      try {
        await fetchJson(
          buildRequestUrl("/api/model", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider, modelId }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update model"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const setThinkingLevel = React.useCallback(
    async (level: string) => {
      if (!viewerContextId) return
      try {
        await fetchJson(
          buildRequestUrl("/api/thinking", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ level }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update thinking level"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const toggleHideThinking = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await fetchJson(
        buildRequestUrl("/api/settings/hide-thinking", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hide: !sessionState.hideThinkingBlock }),
        }
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update thinking visibility"
      )
    }
  }, [activeSessionId, sessionState.hideThinkingBlock, viewerContextId])

  const runCompact = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await fetchJson(
        buildRequestUrl("/api/slash-command", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "compact", args: "" }),
        }
      )
      toast.success("Started compaction")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to compact session"
      )
    }
  }, [activeSessionId, viewerContextId])

  const openTreeDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setTreeOpen(true)
    setTreeLoading(true)
    try {
      const response = await fetchJson<SessionTreeResponse>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        })
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setTreeData(response)
      setSelectedTreeNodeId(response.leafId)
      const flat = flattenTree(response.tree)
      const selected = flat.find((entry) => entry.id === response.leafId)
      setSelectedTreeNodeLabel(selected?.label || "")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load tree"
      )
      setTreeOpen(false)
    } finally {
      setTreeLoading(false)
    }
  }, [activeSessionId, viewerContextId])

  const saveTreeLabel = React.useCallback(async () => {
    if (!viewerContextId || !selectedTreeNodeId) return
    try {
      const response = await fetchJson<SessionTreeResponse>(
        buildRequestUrl("/api/session/tree/label", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entryId: selectedTreeNodeId,
            label: selectedTreeNodeLabel,
          }),
        }
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setTreeData(response)
      toast.success("Saved tree label")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save label"
      )
    }
  }, [
    activeSessionId,
    selectedTreeNodeId,
    selectedTreeNodeLabel,
    viewerContextId,
  ])

  const navigateTreeNode = React.useCallback(
    async (targetId: string) => {
      if (!viewerContextId) return
      try {
        const response = await fetchJson<NavigateSessionTreeResponse>(
          buildRequestUrl("/api/session/tree", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetId }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
        if (!response.cancelled) {
          setTreeOpen(false)
          toast.success("Moved session tree cursor")
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to navigate tree"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const openForkDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setForkOpen(true)
    setForkLoading(true)
    try {
      const response = await fetchJson<ForkableMessagesResponse>(
        buildRequestUrl("/api/session/fork", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        })
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setForkMessages(response.messages)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load forks"
      )
      setForkOpen(false)
    } finally {
      setForkLoading(false)
    }
  }, [activeSessionId, viewerContextId])

  const forkFromMessage = React.useCallback(
    async (entryId: string) => {
      if (!viewerContextId) return
      try {
        const response = await fetchJson<ForkSessionResponse>(
          buildRequestUrl("/api/session/fork", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entryId }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
        setForkOpen(false)
        toast.success("Forked session")
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to fork session"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const renameSession = React.useCallback(async () => {
    if (!viewerContextId || !sessionState.sessionFile) return
    try {
      const response = await fetchJson<RenameSessionResponse>(
        buildRequestUrl("/api/session/rename", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: sessionState.sessionFile,
            name: renameValue,
          }),
        }
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setRenameOpen(false)
      toast.success("Renamed session")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename session"
      )
    }
  }, [activeSessionId, renameValue, sessionState.sessionFile, viewerContextId])

  const deleteSession = React.useCallback(async () => {
    if (!viewerContextId || !sessionState.sessionFile) return
    try {
      const response = await fetchJson<DeleteSessionResponse>(
        buildRequestUrl("/api/session/delete", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: sessionState.sessionFile }),
        }
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setDeleteOpen(false)
      toast.success("Deleted session")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete session"
      )
    }
  }, [activeSessionId, sessionState.sessionFile, viewerContextId])

  const resolveUiRequest = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!viewerContextId || !pendingUiRequest) return
      try {
        await fetchJson<UiRequestResponse>(
          buildRequestUrl(
            `/api/ui/${encodeURIComponent(pendingUiRequest.id)}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        )
        setPendingUiRequest(null)
        setPendingUiValue("")
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to resolve UI request"
        )
      }
    },
    [activeSessionId, pendingUiRequest, viewerContextId]
  )

  const flatTree = React.useMemo(() => {
    return treeData && !isApiErrorResponse(treeData)
      ? filterFlatTree(flattenTree(treeData.tree), treeQuery)
      : []
  }, [treeData, treeQuery])

  const currentSessionTitle = getSessionTitle({
    title:
      sessionState.sessionName || sessionState.firstMessage || "New session",
    name: sessionState.sessionName,
  })

  return (
    <div className="min-h-svh bg-background">
      <div className="grid min-h-svh lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-border/70 bg-card/50 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-border/70 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs text-muted-foreground">
                    <SparklesIcon className="size-3.5" />
                    Native Pi to Go
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">
                      Pi to Go
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      TanStack Start + shadcn rebuild of pi-web.
                    </p>
                  </div>
                </div>
                <ConnectionBadge connected={sessionState.connected} />
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={createSession}>
                  <PlusIcon /> New
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openAddDirectoryDialog}
                >
                  <FolderIcon /> Add dir
                </Button>
              </div>
              <div className="mt-4">
                <Input
                  value={sessionSearch}
                  onChange={(event) => setSessionSearch(event.target.value)}
                  placeholder="Search sessions"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-4 py-4">
              <div className="space-y-3">
                {visibleDirectories.map((directory) => {
                  const sessions = filteredDirectorySessions[directory] || []
                  const directoryState = directoryStateByPath.get(directory)
                  const collapsed = Boolean(collapsedDirectories[directory])
                  const searchActive = sessionSearch.trim().length > 0
                  const visibleCount = searchActive
                    ? sessions.length
                    : Math.min(
                        sessions.length,
                        directoryRenderCounts[directory] ??
                          INITIAL_DIRECTORY_SESSION_RENDER_COUNT
                      )
                  const visibleSessions = sessions.slice(0, visibleCount)
                  const hasMoreSessions = visibleCount < sessions.length

                  return (
                    <Card key={directory} size="sm">
                      <CardHeader className="pb-2">
                        <button
                          type="button"
                          className="flex items-center justify-between gap-3 text-left"
                          onClick={() => toggleDirectory(directory)}
                        >
                          <div className="min-w-0">
                            <CardTitle className="truncate text-sm">
                              {directory}
                            </CardTitle>
                            <CardDescription>
                              {directoryState?.totalCount ?? sessions.length}{" "}
                              sessions
                            </CardDescription>
                          </div>
                          {collapsed ? (
                            <ChevronRightIcon />
                          ) : (
                            <ChevronDownIcon />
                          )}
                        </button>
                      </CardHeader>
                      {!collapsed && (
                        <CardContent className="space-y-2">
                          {directoryIndexLoading[directory] ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Spinner /> Loading sessions…
                            </div>
                          ) : sessions.length > 0 ? (
                            <>
                              {visibleSessions.map((entry) => {
                                const isActive =
                                  activeSessionId &&
                                  entry.id === activeSessionId
                                return (
                                  <button
                                    key={`${directory}-${entry.id || entry.path || entry.title}`}
                                    type="button"
                                    onClick={() => onSelectSession?.(entry.id)}
                                    className={[
                                      "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                                      isActive
                                        ? "border-primary bg-primary/10"
                                        : "hover:bg-muted/50",
                                    ].join(" ")}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">
                                          {entry.title}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          {relativeTime(entry.modified)}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {entry.streaming && (
                                          <Badge variant="outline">Live</Badge>
                                        )}
                                        {entry.unread && (
                                          <span className="size-2 rounded-full bg-primary" />
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                )
                              })}
                              {hasMoreSessions ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full"
                                  onClick={() =>
                                    loadMoreDirectorySessions(directory)
                                  }
                                >
                                  Show{" "}
                                  {Math.min(
                                    DIRECTORY_SESSION_LOAD_MORE_COUNT,
                                    sessions.length - visibleCount
                                  )}{" "}
                                  more
                                </Button>
                              ) : null}
                            </>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              {searchActive
                                ? "No matching sessions."
                                : "No sessions yet."}
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </aside>

        <main className="flex min-h-svh min-w-0 flex-col">
          <div className="border-b border-border/70 px-6 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {currentSessionTitle}
                  </h2>
                  {sessionState.draft && <Badge variant="outline">Draft</Badge>}
                  {sessionState.streaming && (
                    <Badge variant="outline">Streaming</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {sessionState.cwd && <span>{sessionState.cwd}</span>}
                  {sessionState.modified && (
                    <span>• {relativeTime(sessionState.modified)}</span>
                  )}
                  {sessionState.contextUsage?.percent != null && (
                    <span>
                      • Context {Math.round(sessionState.contextUsage.percent)}%
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={runCompact}>
                  <SparklesIcon /> Compact
                </Button>
                <Button size="sm" variant="outline" onClick={openTreeDialog}>
                  <WaypointsIcon /> Tree
                </Button>
                <Button size="sm" variant="outline" onClick={openForkDialog}>
                  <SplitIcon /> Fork
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!sessionState.sessionFile}
                  onClick={() => {
                    setRenameValue(
                      sessionState.sessionName || currentSessionTitle
                    )
                    setRenameOpen(true)
                  }}
                >
                  <PencilIcon /> Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!sessionState.sessionFile}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2Icon /> Delete
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Model</CardTitle>
                </CardHeader>
                <CardContent>
                  <select
                    className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                    value={
                      sessionState.model
                        ? `${sessionState.model.provider}/${sessionState.model.id}`
                        : ""
                    }
                    onChange={(event) => void setModel(event.target.value)}
                  >
                    {sessionState.availableModels.map((model) => (
                      <option
                        key={`${model.provider}/${model.id}`}
                        value={`${model.provider}/${model.id}`}
                      >
                        {model.provider}/{model.name || model.id}
                      </option>
                    ))}
                  </select>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Thinking</CardTitle>
                </CardHeader>
                <CardContent>
                  <select
                    className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                    value={sessionState.thinkingLevel}
                    onChange={(event) =>
                      void setThinkingLevel(event.target.value)
                    }
                  >
                    {sessionState.availableThinkingLevels.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Thinking blocks</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleHideThinking}
                  >
                    {sessionState.hideThinkingBlock ? "Show" : "Hide"} thinking
                  </Button>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Skills</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {sessionState.availableSkills.length} available
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Connection</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ConnectionBadge connected={sessionState.connected} />
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="min-h-0 flex-1 p-6">
            <Tabs
              value={currentTab}
              onValueChange={setCurrentTab}
              className="flex h-full min-h-0 flex-col gap-6"
            >
              <TabsList variant="line">
                <TabsTrigger value="session">Session</TabsTrigger>
                <TabsTrigger value="git">Git</TabsTrigger>
              </TabsList>

              <TabsContent
                value="session"
                className="flex min-h-0 flex-1 flex-col gap-4"
              >
                <Card className="min-h-0 flex-1">
                  <CardContent className="flex h-full min-h-0 flex-col gap-4 pt-4">
                    <ScrollArea className="min-h-0 flex-1 pr-4">
                      {sessionState.items.length > 0 ? (
                        <div className="space-y-4">
                          {(() => {
                            const counts = new Map<string, number>()
                            return sessionState.items.map((item) => {
                              const baseKey = conversationItemSignature(item)
                              const count = (counts.get(baseKey) ?? 0) + 1
                              counts.set(baseKey, count)
                              const key = `${baseKey}:${count}`

                              return item.kind === "user" ? (
                                <div key={key} className="flex justify-end">
                                  <UserMessageCard item={item} />
                                </div>
                              ) : (
                                <div key={key} className="flex justify-start">
                                  <AssistantMessageCard
                                    item={item}
                                    hideThinking={
                                      sessionState.hideThinkingBlock
                                    }
                                    hiddenThinkingLabel={
                                      sessionState.uiState
                                        .hiddenThinkingLabel ||
                                      sessionState.hiddenThinkingPreview
                                    }
                                  />
                                </div>
                              )
                            })
                          })()}
                          <div ref={bottomRef} />
                        </div>
                      ) : (
                        <Empty className="border border-dashed bg-card/60">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <SparklesIcon />
                            </EmptyMedia>
                            <EmptyTitle>Start a new conversation</EmptyTitle>
                            <EmptyDescription>
                              This is the native Pi to Go session view backed by
                              the new TypeScript runtime.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button onClick={createSession}>New session</Button>
                          </EmptyContent>
                        </Empty>
                      )}
                    </ScrollArea>

                    {currentPendingMessages &&
                      currentPendingMessages.length > 0 && (
                        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                          <div className="text-sm font-medium">
                            Pending prompts
                          </div>
                          <div className="space-y-2">
                            {currentPendingMessages.map((message, index) => (
                              <div
                                key={message.pendingId}
                                className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
                              >
                                <Badge variant="outline">
                                  {message.streamingBehavior === "steer"
                                    ? "Steer"
                                    : "Follow-up"}
                                </Badge>
                                <div className="min-w-0 flex-1 truncate text-sm">
                                  {message.pendingId}
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={index === 0}
                                  onClick={() =>
                                    void reorderPending(message.pendingId, -1)
                                  }
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={
                                    index === currentPendingMessages.length - 1
                                  }
                                  onClick={() =>
                                    void reorderPending(message.pendingId, 1)
                                  }
                                >
                                  ↓
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void removePendingMessage(message.pendingId)
                                  }
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    <Card>
                      <CardContent className="space-y-3 pt-4">
                        {composerImages.length > 0 && (
                          <div className="flex flex-wrap gap-3">
                            {composerImages.map((image, index) => (
                              <div
                                key={promptImageKey(image)}
                                className="relative"
                              >
                                <img
                                  src={image.previewUrl}
                                  alt="Attachment preview"
                                  className="h-24 rounded-lg border object-cover"
                                />
                                <button
                                  type="button"
                                  className="absolute top-1 right-1 rounded-full bg-background/90 px-2 py-1 text-xs shadow"
                                  onClick={() =>
                                    setComposerImages((current) =>
                                      current.filter(
                                        (_, imageIndex) => imageIndex !== index
                                      )
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <Textarea
                          value={composerText}
                          onChange={(event) =>
                            setComposerText(event.target.value)
                          }
                          placeholder={
                            sessionState.streaming
                              ? "Write a steer or follow-up message…"
                              : "Ask Pi to Go anything…"
                          }
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.shiftKey &&
                              !event.metaKey &&
                              !event.ctrlKey
                            ) {
                              event.preventDefault()
                              void submitPrompt(
                                sessionState.streaming ? "steer" : undefined
                              )
                            }
                          }}
                        />

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(event) =>
                            void onPickImages(event.target.files)
                          }
                        />

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              <ImagePlusIcon /> Add images
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={createSession}
                            >
                              <PlusIcon /> New session
                            </Button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {sessionState.streaming && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isSubmitting}
                                  onClick={() => void submitPrompt("followUp")}
                                >
                                  Queue follow-up
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isSubmitting}
                                  onClick={() => void submitPrompt("steer")}
                                >
                                  Steer now
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await fetchJson<SimpleOkResponse>(
                                        buildRequestUrl("/api/abort", {
                                          contextId: viewerContextId,
                                          sessionId: activeSessionId,
                                        }),
                                        {
                                          method: "POST",
                                        }
                                      )
                                    } catch (error) {
                                      toast.error(
                                        error instanceof Error
                                          ? error.message
                                          : "Failed to abort session"
                                      )
                                    }
                                  }}
                                >
                                  Abort
                                </Button>
                              </>
                            )}
                            <Button
                              disabled={
                                isSubmitting ||
                                (!composerText.trim() &&
                                  composerImages.length === 0)
                              }
                              onClick={() =>
                                void submitPrompt(
                                  sessionState.streaming ? "steer" : undefined
                                )
                              }
                            >
                              {isSubmitting ? (
                                <LoaderCircleIcon className="animate-spin" />
                              ) : (
                                <SendIcon />
                              )}
                              Send
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="git" className="space-y-4">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshGit()}
                  >
                    <RefreshCwIcon /> Refresh
                  </Button>
                </div>
                <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <Card>
                    <CardHeader>
                      <CardTitle>Repository status</CardTitle>
                      <CardDescription>
                        {sessionState.cwd || "No cwd"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {gitLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Spinner /> Loading git details…
                        </div>
                      ) : isApiErrorResponse(gitStatus) ? (
                        <div className="text-destructive">
                          {gitStatus.error}
                        </div>
                      ) : gitStatus?.gitStatus ? (
                        <>
                          <div className="flex items-center gap-2">
                            <GitBranchIcon className="size-4" />
                            <span>{gitStatus.gitStatus.label}</span>
                          </div>
                          <div className="text-muted-foreground">
                            {gitStatus.gitStatus.title}
                          </div>
                        </>
                      ) : (
                        <div className="text-muted-foreground">
                          No git repository detected.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Changes</CardTitle>
                      <CardDescription>
                        Native git inspection powered by the new backend.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      {gitLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Spinner /> Loading changes…
                        </div>
                      ) : isApiErrorResponse(gitChanges) ? (
                        <div className="text-destructive">
                          {gitChanges.error}
                        </div>
                      ) : gitChanges?.files && gitChanges.files.length > 0 ? (
                        <div className="space-y-2">
                          {gitChanges.files.map((file) => (
                            <div
                              key={`${file.status}:${file.path}`}
                              className="rounded-lg border px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 truncate font-medium">
                                  {file.path}
                                </div>
                                <Badge variant="outline">{file.status}</Badge>
                              </div>
                              {(file.linesAdded != null ||
                                file.linesDeleted != null) && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  +{file.linesAdded ?? 0} / -
                                  {file.linesDeleted ?? 0}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          Working tree is clean.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      <Dialog open={addDirectoryOpen} onOpenChange={setAddDirectoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add directory</DialogTitle>
            <DialogDescription>
              Add another project directory to the sidebar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={directoryInput}
            onChange={(event) => setDirectoryInput(event.target.value)}
            placeholder="~/code/project"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDirectoryOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={() => void addDirectory()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              Update the display name shown in the sidebar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="Session name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void renameSession()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session</DialogTitle>
            <DialogDescription>
              This deletes the session file from disk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteSession()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={forkOpen} onOpenChange={setForkOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fork session</DialogTitle>
            <DialogDescription>
              Start a new draft from one of the earlier user prompts.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-2">
              {forkLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner /> Loading fork points…
                </div>
              ) : forkMessages && forkMessages.length > 0 ? (
                forkMessages.map((message) => (
                  <button
                    key={message.entryId}
                    type="button"
                    className="w-full rounded-lg border px-3 py-2 text-left hover:bg-muted/50"
                    onClick={() => void forkFromMessage(message.entryId)}
                  >
                    <div className="line-clamp-3 text-sm">{message.text}</div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">
                  No forkable prompts found.
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={treeOpen} onOpenChange={setTreeOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Session tree</DialogTitle>
            <DialogDescription>
              Navigate branches and edit labels from the native tree UI.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
              <Input
                value={treeQuery}
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="Filter tree"
              />
              <ScrollArea className="h-[55vh] rounded-lg border p-3">
                {treeLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Spinner /> Loading tree…
                  </div>
                ) : flatTree.length > 0 ? (
                  <div className="space-y-1">
                    {flatTree.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          setSelectedTreeNodeId(node.id)
                          setSelectedTreeNodeLabel(node.label || "")
                        }}
                        className={[
                          "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50",
                          selectedTreeNodeId === node.id ? "bg-muted" : "",
                        ].join(" ")}
                        style={{ paddingLeft: `${node.depth * 16 + 12}px` }}
                      >
                        <FolderTreeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {node.label || node.role || node.type}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {node.text}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No tree entries found.
                  </div>
                )}
              </ScrollArea>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Selected entry</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedTreeNodeId || "Nothing selected"}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Label</div>
                <Input
                  value={selectedTreeNodeLabel}
                  onChange={(event) =>
                    setSelectedTreeNodeLabel(event.target.value)
                  }
                  placeholder="Optional label"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  disabled={!selectedTreeNodeId}
                  onClick={() =>
                    selectedTreeNodeId &&
                    void navigateTreeNode(selectedTreeNodeId)
                  }
                >
                  Jump here
                </Button>
                <Button
                  variant="outline"
                  disabled={!selectedTreeNodeId}
                  onClick={() => void saveTreeLabel()}
                >
                  Save label
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingUiRequest)}
        onOpenChange={(open) => {
          if (!open && pendingUiRequest) {
            void resolveUiRequest({ cancelled: true })
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingUiRequest?.title || "Pi request"}</DialogTitle>
            {pendingUiRequest?.message && (
              <DialogDescription>{pendingUiRequest.message}</DialogDescription>
            )}
          </DialogHeader>
          {(pendingUiRequest?.method === "input" ||
            pendingUiRequest?.method === "editor") &&
            (pendingUiRequest.method === "editor" ? (
              <Textarea
                value={pendingUiValue}
                onChange={(event) => setPendingUiValue(event.target.value)}
                placeholder={pendingUiRequest.placeholder}
              />
            ) : (
              <Input
                value={pendingUiValue}
                onChange={(event) => setPendingUiValue(event.target.value)}
                placeholder={pendingUiRequest.placeholder}
              />
            ))}
          {pendingUiRequest?.method === "select" && (
            <div className="space-y-2">
              {pendingUiRequest.options?.map((option) => {
                const value = typeof option === "string" ? option : option.value
                const label =
                  typeof option === "string"
                    ? option
                    : option.label || option.value
                return (
                  <Button
                    key={value}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => void resolveUiRequest({ value })}
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void resolveUiRequest({ cancelled: true })}
            >
              Cancel
            </Button>
            {pendingUiRequest?.method === "confirm" && (
              <Button
                onClick={() => void resolveUiRequest({ confirmed: true })}
              >
                Confirm
              </Button>
            )}
            {(pendingUiRequest?.method === "input" ||
              pendingUiRequest?.method === "editor") && (
              <Button
                onClick={() => void resolveUiRequest({ value: pendingUiValue })}
              >
                Submit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
