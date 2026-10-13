import * as React from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListChecksIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  postSessionJson,
  useSessionExtensions,
} from "@/features/pico/agent/session-extensions"
import {
  registerToolRenderer,
  toolDetails,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"

export type TodoStatus = "pending" | "active" | "done" | "blocked"
export type TodoItem = {
  id: string
  text: string
  status: TodoStatus
  note?: string
}

const NEXT_STATUS: Record<TodoStatus, TodoStatus> = {
  pending: "active",
  active: "done",
  done: "pending",
  blocked: "pending",
}

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

export function TodoList({
  items,
  onChange,
}: {
  items: Array<TodoItem>
  onChange?: (change: Record<string, unknown>) => void
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="group/todo flex items-start gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted/50"
        >
          <button
            type="button"
            className="mt-0.5 shrink-0 disabled:cursor-default"
            disabled={!onChange}
            title={onChange ? "Change status" : item.status}
            onClick={() =>
              onChange?.({
                op: "update",
                id: item.id,
                status: NEXT_STATUS[item.status],
              })
            }
          >
            <StatusIcon status={item.status} />
          </button>
          <span className="min-w-0 flex-1">
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
            <button
              type="button"
              title="Remove"
              className="mt-0.5 shrink-0 opacity-0 group-hover/todo:opacity-100"
              onClick={() => onChange({ op: "remove", id: item.id })}
            >
              <XIcon className="size-3.5 text-muted-foreground" />
            </button>
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

function TodoSection({
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const items = todoItemsFrom(state)
  const [text, setText] = React.useState("")
  const change = (body: Record<string, unknown>) => {
    void postSessionJson(
      viewerContextId,
      sessionId,
      "/api/session/todo",
      body
    ).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error))
    )
  }
  const done = items.filter((item) => item.status === "done").length
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {done} of {items.length} done
      </div>
      <TodoList items={items} onChange={change} />
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (!text.trim()) return
          change({ op: "add", text })
          setText("")
        }}
      >
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add an item"
          className="h-7 text-xs"
        />
        <Button type="submit" size="icon-sm" variant="ghost" title="Add">
          <PlusIcon />
        </Button>
        {done > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => change({ op: "clear", scope: "done" })}
          >
            Clear done
          </Button>
        ) : null}
      </form>
    </div>
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
    <button
      type="button"
      className="mx-auto mb-1.5 flex max-w-full items-center gap-2 rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
      onClick={() => emitPicoEvent("pico:open-sidebar-tab", { tab: "agent" })}
    >
      <ListChecksIcon className="size-3.5 shrink-0" />
      <span className="shrink-0 tabular-nums">
        {done}/{items.length}
      </span>
      {active ? <span className="truncate">{active.text}</span> : null}
    </button>
  )
}

registerAgentSection({
  key: "todo",
  title: "Plan",
  order: 20,
  visible: (state) => todoItemsFrom(state).length > 0,
  Component: TodoSection,
})

registerToolRenderer("todo", {
  summary(block) {
    const items = toolDetails<{ items: Array<TodoItem> }>(block).items
    if (!items) return undefined
    const done = items.filter((item) => item.status === "done").length
    const active = items.find((item) => item.status === "active")
    return `${done}/${items.length} done${active ? ` · ${active.text}` : ""}`
  },
  Body({ block }) {
    const items = toolDetails<{ items: Array<TodoItem> }>(block).items ?? []
    if (items.length === 0)
      return (
        <div className="text-sm text-muted-foreground">
          {block.output || "The todo list is empty."}
        </div>
      )
    return <TodoList items={items} />
  },
})
