"use client"

import * as React from "react"
import {
  FolderTreeIcon,
  GitBranchIcon,
  MessagesSquareIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  type CompletionItem,
  type DirectoryResolveResponse,
  type GitStatusResponse,
  type GitStatusSummary,
  isApiErrorResponse,
  type PathCompletionsResponse,
} from "@/lib/pi-web-api"

const rewriteMilestones = [
  {
    title: "Native TanStack Start shell",
    description:
      "The legacy embedded UI is gone. This route is now a TypeScript/React shell built with the new stack.",
  },
  {
    title: "Shared TS server foundations",
    description:
      "SDK loading, session naming, git helpers, path completion helpers, and JSON response utilities are being ported natively.",
  },
  {
    title: "Feature parity in progress",
    description:
      "Next up: live session runtime, SSE sync, composer flows, tree/fork flows, and the session sidebar.",
  },
]

const rewriteTracks = [
  {
    icon: MessagesSquareIcon,
    title: "Conversation runtime",
    description:
      "Viewer context, session switching, SSE replay, prompt submission, queue/steer, and abort flows.",
  },
  {
    icon: FolderTreeIcon,
    title: "Sidebar + session management",
    description:
      "Directory grouping, drafts, rename/delete, search, tree, fork, and settings dialogs.",
  },
  {
    icon: GitBranchIcon,
    title: "Git + workspace helpers",
    description:
      "Native directory resolution, path/file completions, git status, and git changes endpoints.",
  },
]

type WorkspacePreviewState = {
  loading: boolean
  cwd?: string
  gitInline?: string
  gitTitle?: string
  pathPreview: Array<CompletionItem>
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  return (await response.json()) as T
}

function formatGitStatusInline(status?: GitStatusSummary | null) {
  if (!status) return "No git repo detected"
  return (
    status.inline || status.label || status.branch || "Git status available"
  )
}

export function PiWebAppShell({ sessionId }: { sessionId?: string }) {
  const isMountedRef = React.useRef(true)
  const [workspacePreview, setWorkspacePreview] =
    React.useState<WorkspacePreviewState>({
      loading: true,
      pathPreview: [],
    })

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadWorkspacePreview = React.useCallback(async () => {
    setWorkspacePreview((current) => ({ ...current, loading: true }))

    try {
      const [directoryResponse, gitStatusResponse, pathResponse] =
        await Promise.all([
          fetchJson<DirectoryResolveResponse>("/api/directory/resolve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: "." }),
          }),
          fetchJson<GitStatusResponse>("/api/git-status?cwd=."),
          fetchJson<PathCompletionsResponse>("/api/path-completions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prefix: "./" }),
          }),
        ])

      if (isApiErrorResponse(directoryResponse)) {
        throw new Error(directoryResponse.error)
      }
      if (isApiErrorResponse(gitStatusResponse)) {
        throw new Error(gitStatusResponse.error)
      }
      if (isApiErrorResponse(pathResponse)) {
        throw new Error(pathResponse.error)
      }

      if (!isMountedRef.current) return

      setWorkspacePreview({
        loading: false,
        cwd: directoryResponse.path,
        gitInline: formatGitStatusInline(gitStatusResponse.gitStatus),
        gitTitle: gitStatusResponse.gitStatus?.title,
        pathPreview: pathResponse.items.slice(0, 4),
      })
    } catch (error) {
      if (!isMountedRef.current) return

      const message =
        error instanceof Error
          ? error.message
          : "Failed to load workspace preview"
      setWorkspacePreview({
        loading: false,
        pathPreview: [],
      })
      toast.error(message)
    }
  }, [])

  React.useEffect(() => {
    void loadWorkspacePreview()
  }, [loadWorkspacePreview])

  return (
    <div className="min-h-svh bg-background">
      <div className="grid min-h-svh lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-border/70 bg-card/60 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-border/70 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs text-muted-foreground">
                    <SparklesIcon className="size-3.5" />
                    TanStack Start rewrite
                  </div>
                  <h1 className="text-xl font-semibold tracking-tight">
                    Pi to Go
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Native TypeScript rebuild of pi-web with shadcn, base-ui,
                    Tailwind v4, and Vite+.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    toast.info(
                      "Sonner is wired and ready for app notifications."
                    )
                  }}
                >
                  Test toast
                </Button>
              </div>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="space-y-2">
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Session search
                </div>
                <Input placeholder="Search sessions (native rewrite in progress)" />
              </div>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Current focus</CardTitle>
                  <CardDescription>
                    The rewrite is now using the old repo as reference only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Legacy copied JS/CSS/backend files are out of this repo.
                  </p>
                  <p>
                    The next milestone is a native session runtime and
                    SSE-backed UI state.
                  </p>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Workspace preview</CardTitle>
                  <CardDescription>
                    Live data loaded from the new native endpoints.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {workspacePreview.loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Spinner />
                      Loading workspace details…
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Directory
                        </div>
                        <div className="mt-1 text-sm break-all">
                          {workspacePreview.cwd || "Unavailable"}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Git
                        </div>
                        <div
                          className="mt-1 text-sm"
                          title={workspacePreview.gitTitle}
                        >
                          {workspacePreview.gitInline || "Unavailable"}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Path suggestions
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {workspacePreview.pathPreview.length > 0 ? (
                            workspacePreview.pathPreview.map((item) => (
                              <span
                                key={item.value}
                                className="rounded-full border px-2 py-1 text-xs text-muted-foreground"
                              >
                                {item.label}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              No suggestions returned.
                            </span>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadWorkspacePreview()}
                  >
                    Refresh preview
                  </Button>
                </CardContent>
              </Card>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-5 pb-5">
              <div className="space-y-3">
                {rewriteMilestones.map((milestone) => (
                  <Card key={milestone.title} size="sm">
                    <CardHeader>
                      <CardTitle>{milestone.title}</CardTitle>
                      <CardDescription>{milestone.description}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="border-b border-border/70 px-6 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Workspace
                </div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Native frontend shell
                </h2>
                <p className="text-sm text-muted-foreground">
                  Building feature parity without vendoring the old browser app.
                </p>
              </div>

              <div className="rounded-full border px-3 py-1 text-sm text-muted-foreground">
                {sessionId
                  ? `Selected session: ${sessionId}`
                  : "No session selected"}
              </div>
            </div>
          </div>

          <div className="p-6">
            <Tabs defaultValue="session" className="gap-6">
              <TabsList variant="line">
                <TabsTrigger value="session">Session</TabsTrigger>
                <TabsTrigger value="git">Git</TabsTrigger>
              </TabsList>

              <TabsContent value="session" className="space-y-6">
                <Card>
                  <CardContent className="pt-4">
                    <Empty className="border border-dashed border-border bg-card/70">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <MessagesSquareIcon />
                        </EmptyMedia>
                        <EmptyTitle>
                          Conversation UI rewrite underway
                        </EmptyTitle>
                        <EmptyDescription>
                          This shell is the first native screen. The next passes
                          will connect live sessions, streaming messages, tools,
                          thinking blocks, and composer controls.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent className="sm:flex-row sm:justify-center">
                        <Button
                          onClick={() => {
                            toast.success("Using Sonner for rewrite toasts.")
                          }}
                        >
                          Confirm toast system
                        </Button>
                        <Button variant="outline">Session runtime next</Button>
                      </EmptyContent>
                    </Empty>
                  </CardContent>
                </Card>

                <div className="grid gap-4 xl:grid-cols-3">
                  {rewriteTracks.map((track) => {
                    const Icon = track.icon
                    return (
                      <Card key={track.title}>
                        <CardHeader>
                          <div className="mb-2 inline-flex size-9 items-center justify-center rounded-lg border bg-muted/60">
                            <Icon className="size-4" />
                          </div>
                          <CardTitle>{track.title}</CardTitle>
                          <CardDescription>{track.description}</CardDescription>
                        </CardHeader>
                      </Card>
                    )
                  })}
                </div>
              </TabsContent>

              <TabsContent value="git">
                <Card>
                  <CardHeader>
                    <CardTitle>Git view placeholder</CardTitle>
                    <CardDescription>
                      Native git status and changes endpoints are being ported
                      so this tab can match pi-web behavior without legacy code.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Current shell preview uses the native git status route
                    already; the full changes UI is next.
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  )
}
