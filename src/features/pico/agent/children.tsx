import {
  ExternalLinkIcon,
  GitForkIcon,
  MessageCircleQuestionIcon,
  SquareIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  postSessionJson,
  useSessionExtensions,
} from "@/features/pico/agent/session-extensions"
import { errorText, relativeTime, useNow } from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  useToolRenderContext,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"

export type ChildSession = {
  id: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  worktreeBranch?: string
  messageCount: number
  lastMessagePreview?: string
  lastMessageAt?: number
}

function stopSession(viewerContextId: string, sessionId: string) {
  void postSessionJson(viewerContextId, sessionId, "/api/abort", {}).catch(
    (error: unknown) => toast.error(errorText(error))
  )
}

function ChildStatus({ child }: { child: ChildSession }) {
  if (child.needsInput)
    return (
      <MessageCircleQuestionIcon
        className="size-4 shrink-0 text-amber-500"
        aria-label="Waiting for you"
      />
    )
  if (child.busy) return <Spinner size="xs" aria-label="Working" />
  return <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
}

function ChildRow({
  child,
  now,
  viewerContextId,
}: {
  child: ChildSession
  now: number
  viewerContextId: string
}) {
  return (
    <li className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm">
      <span className="mt-1 flex size-4 items-center justify-center">
        <ChildStatus child={child} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{child.title}</div>
        <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {child.worktreeBranch ? (
            <>
              <GitForkIcon className="size-3 shrink-0" />
              <span className="truncate">{child.worktreeBranch}</span>
              <span>·</span>
            </>
          ) : null}
          <span>
            {child.needsInput
              ? "waiting for you"
              : child.busy
                ? "working"
                : `idle ${relativeTime(child.lastMessageAt, now)}`}
          </span>
        </div>
        {child.lastMessagePreview ? (
          <div className="line-clamp-2 text-xs text-muted-foreground">
            {child.lastMessagePreview}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          size="icon-xs"
          variant="ghost"
          title="Open"
          onClick={() =>
            emitPicoEvent("pico:open-session", { sessionId: child.id })
          }
        >
          <ExternalLinkIcon />
        </Button>
        {child.busy ? (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Stop"
            onClick={() => stopSession(viewerContextId, child.id)}
          >
            <SquareIcon />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function ChildrenSection({
  state,
  viewerContextId,
}: {
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const children = (state.children as Array<ChildSession> | undefined) ?? []
  const now = useNow()
  const busy = children.filter((child) => child.busy)
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {children.map((child) => (
          <ChildRow
            key={child.id}
            child={child}
            now={now}
            viewerContextId={viewerContextId}
          />
        ))}
      </ul>
      {busy.length > 1 ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            for (const child of busy) stopSession(viewerContextId, child.id)
          }}
        >
          <SquareIcon /> Stop all children
        </Button>
      ) : null}
    </div>
  )
}

registerAgentSection({
  key: "children",
  title: "Child sessions",
  order: 15,
  visible: (state) =>
    Array.isArray(state.children) && state.children.length > 0,
  Component: ChildrenSection,
})

type SpawnDetails = {
  sessionId: string
  title?: string
  status?: "running" | "done"
  worktree?: { branch: string; path: string }
}

function SpawnCard({ block }: ToolRendererProps) {
  const { viewerContextId, sessionId } = useToolRenderContext()
  const details = toolDetails<SpawnDetails>(block)
  const args = toolArgs(block)
  const query = useSessionExtensions(viewerContextId, sessionId)
  const live = (query.data?.children as Array<ChildSession> | undefined)?.find(
    (child) => child.id === details.sessionId
  )
  const title =
    live?.title ??
    details.title ??
    (typeof args.name === "string" ? args.name : undefined) ??
    "Child session"
  const goal = typeof args.goal === "string" ? args.goal : ""
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2">
        <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {live ? (
          <ChildStatus child={live} />
        ) : block.running ? (
          <Spinner size="xs" />
        ) : null}
        {details.sessionId ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              emitPicoEvent("pico:open-session", {
                sessionId: details.sessionId!,
              })
            }
          >
            Open
          </Button>
        ) : null}
      </div>
      {details.worktree ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <GitForkIcon className="size-3" /> {details.worktree.branch}
        </div>
      ) : null}
      {goal ? (
        <p className="line-clamp-3 text-xs text-muted-foreground">{goal}</p>
      ) : null}
      {block.isError ? (
        <pre className="text-xs whitespace-pre-wrap text-destructive">
          {block.output}
        </pre>
      ) : null}
    </div>
  )
}

registerToolRenderer("spawn_session", { Card: SpawnCard })

for (const name of [
  "send_to_session",
  "read_session",
  "stop_session",
  "wait_for_sessions",
]) {
  registerToolRenderer(name, {
    summary(block) {
      const args = toolArgs(block)
      if (Array.isArray(args.ids)) return args.ids.join(", ")
      const id = typeof args.id === "string" ? args.id : ""
      const message = typeof args.message === "string" ? args.message : ""
      return [id, message].filter(Boolean).join(" · ")
    },
  })
}
