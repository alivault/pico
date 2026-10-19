import {
  ChevronRightIcon,
  GitForkIcon,
  MessageCircleQuestionIcon,
  SquareIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import {
  registerAgentSection,
  type AgentSectionProps,
} from "@/features/pico/agent/agent-panel"
import { emitPicoEvent } from "@/features/pico/agent/events"
import { REVEAL_ON_HOVER } from "@/features/pico/agent/todo"
import {
  postSessionJson,
  useSessionExtensions,
} from "@/features/pico/agent/session-extensions"
import {
  errorText,
  IconAction,
  relativeTime,
  useNow,
} from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  useToolRenderContext,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

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

function stopSession(
  machineId: string,
  viewerContextId: string,
  sessionId: string
) {
  void postSessionJson(
    machineId,
    viewerContextId,
    sessionId,
    "/api/abort",
    {}
  ).catch((error: unknown) => toast.error(errorText(error)))
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
  return (
    <span
      className="size-2 shrink-0 rounded-full bg-emerald-500"
      aria-label="Idle"
    />
  )
}

function childStatusText(child: ChildSession, now: number) {
  if (child.needsInput) return "Waiting for your answer"
  if (child.busy) return "Working"
  return child.lastMessageAt
    ? `Done ${relativeTime(child.lastMessageAt, now)}`
    : "Idle"
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
  const machineId = useMachineId()
  return (
    <Item
      size="sm"
      className="group/row items-start gap-1 p-0 hover:bg-muted/50"
    >
      <button
        type="button"
        aria-label={`Open ${child.title}`}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() =>
          emitPicoEvent("pico:open-session", { sessionId: child.id })
        }
      >
        <span className="mt-1 flex size-4 shrink-0 items-center justify-center">
          <ChildStatus child={child} />
        </span>
        <ItemContent className="min-w-0">
          <ItemTitle className="block truncate">{child.title}</ItemTitle>
          <ItemDescription className="truncate">
            {childStatusText(child, now)}
          </ItemDescription>
          {child.worktreeBranch ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <GitForkIcon
                className="size-3 shrink-0"
                aria-label="Worktree branch"
              />
              <span className="truncate">{child.worktreeBranch}</span>
            </span>
          ) : null}
        </ItemContent>
        <ChevronRightIcon
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground",
            REVEAL_ON_HOVER
          )}
          aria-hidden="true"
        />
      </button>
      {child.busy ? (
        <ItemActions className={cn("self-center pr-1", REVEAL_ON_HOVER)}>
          <IconAction
            label="Stop the child session"
            icon={<SquareIcon />}
            tone="destructive"
            onClick={() => stopSession(machineId, viewerContextId, child.id)}
          />
        </ItemActions>
      ) : null}
    </Item>
  )
}

function childrenFrom(state: Record<string, unknown>) {
  return (state.children as Array<ChildSession> | undefined) ?? []
}

function ChildrenSection({ state, viewerContextId }: AgentSectionProps) {
  const now = useNow()
  return (
    <ItemGroup className="gap-0.5">
      {childrenFrom(state).map((child) => (
        <ChildRow
          key={child.id}
          child={child}
          now={now}
          viewerContextId={viewerContextId}
        />
      ))}
    </ItemGroup>
  )
}

function ChildrenActions({ state, viewerContextId }: AgentSectionProps) {
  const machineId = useMachineId()
  const busy = childrenFrom(state).filter((child) => child.busy)
  if (busy.length < 2) return null
  return (
    <IconAction
      label={`Stop all ${busy.length} child sessions`}
      icon={<SquareIcon />}
      tone="destructive"
      onClick={() => {
        for (const child of busy)
          stopSession(machineId, viewerContextId, child.id)
      }}
    />
  )
}

registerAgentSection({
  key: "children",
  title: "Child sessions",
  order: 40,
  summary(state) {
    const children = childrenFrom(state)
    const working = children.filter((child) => child.busy).length
    return working ? `${working} working` : undefined
  },
  visible: (state) =>
    Array.isArray(state.children) && state.children.length > 0,
  busy: (state) =>
    childrenFrom(state).some((child) => child.busy || child.needsInput),
  Actions: ChildrenActions,
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
            size="sm"
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
