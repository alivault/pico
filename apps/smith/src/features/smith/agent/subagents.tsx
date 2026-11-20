import type * as React from "react"
import {
  GitForkIcon,
  HourglassIcon,
  MessageCircleQuestionIcon,
  SquareIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "@/lib/smith/toast"

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
} from "@/features/smith/agent/agent-panel"
import { emitSmithEvent } from "@/features/smith/agent/events"
import {
  FADE_UNDER_ACTIONS,
  REVEAL_ON_HOVER,
} from "@/features/smith/agent/todo"
import {
  postAgentJson,
  useAgentExtensions,
} from "@/features/smith/agent/agent-extensions"
import {
  errorText,
  IconAction,
  relativeTime,
  useNow,
} from "@/features/smith/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  useToolRenderContext,
  type ToolRendererProps,
} from "@/features/smith/tool-renderers/registry"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/smith/machine-context"

export type Subagent = {
  id: string
  title: string
  cwd: string
  busy: boolean
  needsInput: boolean
  /** Its turn ended on a job, and it goes on when the job ends. */
  waiting?: string
  worktreeBranch?: string
  messageCount: number
  lastMessagePreview?: string
  lastMessageAt?: number
}

function stopAgent(
  machineId: string,
  viewerContextId: string,
  agentId: string
) {
  void postAgentJson(
    machineId,
    viewerContextId,
    agentId,
    "/api/abort",
    {}
  ).catch((error: unknown) => toast.error(errorText(error)))
}

function SubagentStatus({ subagent }: { subagent: Subagent }) {
  if (subagent.needsInput)
    return (
      <MessageCircleQuestionIcon
        className="size-4 shrink-0 text-red-500"
        aria-label="Waiting for you"
      />
    )
  if (subagent.busy) return <Spinner size="xs" aria-label="Working" />
  // The same hourglass as the agent's row in the left sidebar.
  if (subagent.waiting)
    return (
      <HourglassIcon
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-label={`Waiting on ${subagent.waiting}`}
      />
    )
  // Done uses the blue dot of the left sidebar. Green is for jobs.
  const done = Boolean(subagent.lastMessageAt)
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        done ? "bg-primary" : "bg-muted-foreground/40"
      )}
      aria-label={done ? "Done" : "Idle"}
    />
  )
}

function subagentStatusText(subagent: Subagent, now: number) {
  if (subagent.needsInput) return "Waiting for your answer"
  if (subagent.busy) return "Working"
  if (subagent.waiting) return `Waiting on ${subagent.waiting}`
  return subagent.lastMessageAt
    ? `Done ${relativeTime(subagent.lastMessageAt, now)}`
    : "Idle"
}

function SubagentRow({
  subagent,
  now,
  viewerContextId,
}: {
  subagent: Subagent
  now: number
  viewerContextId: string
}) {
  const machineId = useMachineId()
  return (
    <Item
      size="sm"
      className="group/row relative items-start p-0 hover:bg-muted/50"
    >
      <button
        type="button"
        aria-label={`Open ${subagent.title}`}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() =>
          emitSmithEvent("smith:open-agent", { agentId: subagent.id })
        }
      >
        <span className="mt-1 flex size-4 shrink-0 items-center justify-center">
          <SubagentStatus subagent={subagent} />
        </span>
        <ItemContent
          className={cn("min-w-0", subagent.busy && FADE_UNDER_ACTIONS)}
          style={
            subagent.busy
              ? ({ "--actions-width": "1.75rem" } as React.CSSProperties)
              : undefined
          }
        >
          <ItemTitle className="block truncate">{subagent.title}</ItemTitle>
          <ItemDescription className="truncate">
            {subagentStatusText(subagent, now)}
          </ItemDescription>
          {subagent.worktreeBranch ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <GitForkIcon
                className="size-3 shrink-0"
                aria-label="Worktree branch"
              />
              <span className="truncate">{subagent.worktreeBranch}</span>
            </span>
          ) : null}
        </ItemContent>
      </button>
      {subagent.busy ? (
        <ItemActions
          className={cn(
            "absolute top-0.5 right-1 group-focus-within/row:opacity-100",
            REVEAL_ON_HOVER
          )}
        >
          <IconAction
            label="Stop the subagent"
            icon={<SquareIcon />}
            tone="destructive"
            onClick={() => stopAgent(machineId, viewerContextId, subagent.id)}
          />
        </ItemActions>
      ) : null}
    </Item>
  )
}

function subagentsFrom(state: Record<string, unknown>) {
  return (state.subagents as Array<Subagent> | undefined) ?? []
}

function SubagentsSection({ state, viewerContextId }: AgentSectionProps) {
  const now = useNow()
  return (
    <ItemGroup className="gap-0.5">
      {subagentsFrom(state).map((subagent) => (
        <SubagentRow
          key={subagent.id}
          subagent={subagent}
          now={now}
          viewerContextId={viewerContextId}
        />
      ))}
    </ItemGroup>
  )
}

function SubagentsActions({ state, viewerContextId }: AgentSectionProps) {
  const machineId = useMachineId()
  const busy = subagentsFrom(state).filter((subagent) => subagent.busy)
  if (busy.length < 2) return null
  return (
    <IconAction
      label={`Stop all ${busy.length} subagents`}
      icon={<SquareIcon />}
      tone="destructive"
      onClick={() => {
        for (const subagent of busy)
          stopAgent(machineId, viewerContextId, subagent.id)
      }}
    />
  )
}

registerAgentSection({
  // Stored name (the open state of the section): do not change.
  key: "children",
  title: "Subagents",
  order: 40,
  summary(state) {
    const subagents = subagentsFrom(state)
    const working = subagents.filter((subagent) => subagent.busy).length
    const waiting = subagents.filter(
      (subagent) => !subagent.busy && subagent.waiting
    ).length
    return (
      [working ? `${working} working` : "", waiting ? `${waiting} waiting` : ""]
        .filter(Boolean)
        .join(", ") || undefined
    )
  },
  visible: (state) =>
    Array.isArray(state.subagents) && state.subagents.length > 0,
  busy: (state) =>
    subagentsFrom(state).some(
      (subagent) =>
        subagent.busy || subagent.needsInput || Boolean(subagent.waiting)
    ),
  Actions: SubagentsActions,
  Component: SubagentsSection,
})

type SpawnDetails = {
  agentId: string
  title?: string
  status?: "running" | "done"
  worktree?: { branch: string; path: string }
}

function SpawnCard({ block }: ToolRendererProps) {
  const { viewerContextId, agentId } = useToolRenderContext()
  const details = toolDetails<SpawnDetails>(block)
  const args = toolArgs(block)
  const query = useAgentExtensions(viewerContextId, agentId)
  const live = (query.data?.subagents as Array<Subagent> | undefined)?.find(
    (subagent) => subagent.id === details.agentId
  )
  const title =
    live?.title ??
    details.title ??
    (typeof args.name === "string" ? args.name : undefined) ??
    "Subagent"
  const goal = typeof args.goal === "string" ? args.goal : ""
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2">
        <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {live ? (
          <SubagentStatus subagent={live} />
        ) : block.running ? (
          <Spinner size="xs" />
        ) : null}
        {details.agentId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              emitSmithEvent("smith:open-agent", {
                agentId: details.agentId!,
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

registerToolRenderer("spawn_subagent", { Card: SpawnCard })

registerToolRenderer("agents", {
  summary(block) {
    const args = toolArgs(block)
    const action = typeof args.action === "string" ? args.action : ""
    if (action === "send") {
      // The send action shows its target and message, as the old
      // send_to_session tool did.
      const id = typeof args.id === "string" ? args.id : ""
      const message = typeof args.message === "string" ? args.message : ""
      return [action, id, message].filter(Boolean).join(" · ")
    }
    if (action === "unsend") {
      // The text that the call took out of the queue, or the item ID.
      const id = typeof args.id === "string" ? args.id : ""
      const removed = toolDetails<{ removed: string }>(block).removed
      const item = typeof args.item === "string" ? args.item : ""
      return [action, id, typeof removed === "string" ? removed : item]
        .filter(Boolean)
        .join(" · ")
    }
    const ids = Array.isArray(args.ids)
      ? args.ids.join(", ")
      : typeof args.id === "string"
        ? args.id
        : typeof args.scope === "string"
          ? args.scope
          : ""
    return [action, ids, args.any === true ? "any" : ""]
      .filter(Boolean)
      .join(" · ")
  },
})
