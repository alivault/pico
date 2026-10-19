import * as React from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListChecksIcon,
  BrushCleaningIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  registerAgentSection,
  type AgentSectionProps,
} from "@/features/pico/agent/agent-panel"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  postSessionJson,
  useSessionExtensions,
} from "@/features/pico/agent/session-extensions"
import { errorText, IconAction } from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolDetails,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

export type TodoStatus = "pending" | "active" | "done" | "blocked"
export type TodoItem = {
  id: string
  text: string
  status: TodoStatus
  note?: string
}

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: "To do",
  active: "In progress",
  done: "Done",
  blocked: "Blocked",
}

/** Hidden until hover or focus, except on touch screens. */
export const REVEAL_ON_HOVER =
  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"

function StatusIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case "done":
      return <CircleCheckIcon className="size-4 text-emerald-600" />
    case "active":
      return <CircleDotIcon className="size-4 text-amber-500" />
    case "blocked":
      return <CircleAlertIcon className="size-4 text-destructive" />
    default:
      return <CircleIcon className="size-4 text-muted-foreground" />
  }
}

function StatusMenu({
  item,
  onChange,
}: {
  item: TodoItem
  onChange: (change: Record<string, unknown>) => void
}) {
  return (
    <DropdownMenu>
      <TitleTooltip title={`${STATUS_LABEL[item.status]}. Change status`}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Status: ${STATUS_LABEL[item.status]}`}
              className="-my-1"
            />
          }
        >
          <StatusIcon status={item.status} />
        </DropdownMenuTrigger>
      </TitleTooltip>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuRadioGroup
          value={item.status}
          onValueChange={(status) =>
            onChange({ op: "update", id: item.id, status })
          }
        >
          {(Object.keys(STATUS_LABEL) as Array<TodoStatus>).map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              <StatusIcon status={status} />
              {STATUS_LABEL[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TodoList({
  items,
  onChange,
}: {
  items: Array<TodoItem>
  onChange?: (change: Record<string, unknown>) => void
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li
          key={item.id}
          className="group/row flex items-start gap-1.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50"
        >
          {onChange ? (
            <StatusMenu item={item} onChange={onChange} />
          ) : (
            <span
              className="mt-0.5 shrink-0"
              aria-label={STATUS_LABEL[item.status]}
            >
              <StatusIcon status={item.status} />
            </span>
          )}
          <span className={cn("min-w-0 flex-1", onChange && "pt-0.5")}>
            <span
              className={cn(
                item.status === "done" && "text-muted-foreground line-through",
                item.status === "active" && "font-medium"
              )}
            >
              {item.text}
            </span>
            {item.note ? (
              <span className="block text-xs text-muted-foreground">
                {item.note}
              </span>
            ) : null}
          </span>
          {onChange ? (
            <IconAction
              label="Remove item"
              icon={<XIcon />}
              tone="destructive"
              className={cn("-my-1", REVEAL_ON_HOVER)}
              onClick={() => onChange({ op: "remove", id: item.id })}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function todoItemsFrom(state: Record<string, unknown>) {
  const todo = state.todo as { items?: Array<TodoItem> } | undefined
  return todo?.items ?? []
}

function useTodoChange(viewerContextId: string, sessionId: string) {
  const machineId = useMachineId()
  return (body: Record<string, unknown>) => {
    void postSessionJson(
      machineId,
      viewerContextId,
      sessionId,
      "/api/session/todo",
      body
    ).catch((error: unknown) => toast.error(errorText(error)))
  }
}

function TodoSection({ sessionId, state, viewerContextId }: AgentSectionProps) {
  const items = todoItemsFrom(state)
  const [text, setText] = React.useState("")
  const change = useTodoChange(viewerContextId, sessionId)
  return (
    <div className="space-y-0.5">
      <TodoList items={items} onChange={change} />
      <form
        className="flex items-center gap-1.5 rounded-md px-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (!text.trim()) return
          change({ op: "add", text })
          setText("")
        }}
      >
        <PlusIcon
          aria-hidden="true"
          className="mx-1.5 size-4 shrink-0 text-muted-foreground"
        />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="New item"
          aria-label="New plan item"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </form>
    </div>
  )
}

function TodoActions({ sessionId, state, viewerContextId }: AgentSectionProps) {
  const change = useTodoChange(viewerContextId, sessionId)
  const done = todoItemsFrom(state).filter(
    (item) => item.status === "done"
  ).length
  if (done === 0) return null
  return (
    <IconAction
      label="Remove done items"
      icon={<BrushCleaningIcon />}
      onClick={() => change({ op: "clear", scope: "done" })}
    />
  )
}

/** A compact progress line above the composer while the plan has open items. */
export function TodoProgressChip({
  sessionId,
  viewerContextId,
}: {
  sessionId?: string
  viewerContextId: string
}) {
  const query = useSessionExtensions(viewerContextId, sessionId)
  const items = query.data ? todoItemsFrom(query.data) : []
  if (items.length === 0) return null
  const done = items.filter((item) => item.status === "done").length
  if (done === items.length) return null
  const active = items.find((item) => item.status === "active")
  return (
    <TitleTooltip title="Show the plan in the Agent panel">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mb-1.5 h-7 max-w-full rounded-full bg-background/90 px-3 text-xs font-normal text-muted-foreground shadow-sm backdrop-blur"
        onClick={() => emitPicoEvent("pico:open-sidebar-tab", { tab: "agent" })}
      >
        <ListChecksIcon className="shrink-0" />
        <span className="shrink-0 tabular-nums">
          {done} of {items.length}
        </span>
        {active ? <span className="truncate">· {active.text}</span> : null}
      </Button>
    </TitleTooltip>
  )
}

registerAgentSection({
  key: "todo",
  title: "Plan",
  order: 10,
  visible: (state) => todoItemsFrom(state).length > 0,
  summary(state) {
    const items = todoItemsFrom(state)
    const done = items.filter((item) => item.status === "done").length
    return `${done} of ${items.length} done`
  },
  Actions: TodoActions,
  Component: TodoSection,
})

registerToolRenderer("todo", {
  summary(block) {
    const items = toolDetails<{ items: Array<TodoItem> }>(block).items
    if (!items) return undefined
    const done = items.filter((item) => item.status === "done").length
    const active = items.find((item) => item.status === "active")
    return `${done} of ${items.length} done${active ? ` · ${active.text}` : ""}`
  },
  Body({ block }) {
    const items = toolDetails<{ items: Array<TodoItem> }>(block).items ?? []
    if (items.length === 0)
      return (
        <div className="text-sm text-muted-foreground">
          {block.output || "The plan is empty."}
        </div>
      )
    return <TodoList items={items} />
  },
})
