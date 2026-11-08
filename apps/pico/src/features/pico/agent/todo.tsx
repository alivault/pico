import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListChecksIcon,
  BroomIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "@/lib/pico/toast"

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
import {
  agentExtensionsQueryKey,
  postAgentJson,
  useAgentExtensions,
  type AgentExtensionState,
} from "@/features/pico/agent/agent-extensions"
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

/**
 * Fades the right end of a row's text where hover actions overlay it. Set the
 * width of the actions in the `--actions-width` CSS variable.
 */
export const FADE_UNDER_ACTIONS =
  "group-focus-within/row:mask-[linear-gradient(to_left,transparent_var(--actions-width),black_calc(var(--actions-width)+1.75rem))] group-hover/row:mask-[linear-gradient(to_left,transparent_var(--actions-width),black_calc(var(--actions-width)+1.75rem))] [@media(hover:none)]:mask-[linear-gradient(to_left,transparent_var(--actions-width),black_calc(var(--actions-width)+1.75rem))]"

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
            <DropdownMenuRadioItem key={status} value={status} closeOnClick>
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
          className="group/row relative flex items-start gap-1.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50"
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
              style={
                onChange
                  ? ({ "--actions-width": "1.75rem" } as React.CSSProperties)
                  : undefined
              }
              className={cn(
                "block",
                onChange && FADE_UNDER_ACTIONS,
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
              className={cn(
                "absolute top-0 right-1 group-focus-within/row:opacity-100",
                REVEAL_ON_HOVER
              )}
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

/** The change applied on the client, as the server does it in `applyTodo`. */
function applyTodoChange(
  items: Array<TodoItem>,
  body: Record<string, unknown>
): Array<TodoItem> {
  switch (body.op) {
    case "add": {
      const text = typeof body.text === "string" ? body.text.trim() : ""
      if (!text) return items
      return [
        ...items,
        { id: `pending-${Date.now()}`, text, status: "pending" },
      ]
    }
    case "update": {
      const status = body.status as TodoStatus | undefined
      return items.map((item) => {
        if (item.id === body.id)
          return { ...item, ...(status ? { status } : {}) }
        if (status === "active" && item.status === "active")
          return { ...item, status: "pending" }
        return item
      })
    }
    case "remove":
      return items.filter((item) => item.id !== body.id)
    case "clear":
      return body.scope === "all"
        ? []
        : items.filter((item) => item.status !== "done")
    default:
      return items
  }
}

function withTodoItems(
  state: AgentExtensionState | undefined,
  items: Array<TodoItem>
): AgentExtensionState {
  const todo = (state?.todo ?? {}) as Record<string, unknown>
  return { ...state, todo: { ...todo, items } }
}

/** Sends a plan change, and shows it at once. A failed change rolls back. */
function useTodoChange(viewerContextId: string, agentId: string) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const queryKey = agentExtensionsQueryKey(viewerContextId, agentId)
  return (body: Record<string, unknown>) => {
    void queryClient.cancelQueries({ queryKey })
    queryClient.setQueryData<AgentExtensionState>(queryKey, (state) =>
      withTodoItems(state, applyTodoChange(todoItemsFrom(state ?? {}), body))
    )
    void postAgentJson<{ items: Array<TodoItem> }>(
      machineId,
      viewerContextId,
      agentId,
      "/api/agent/todo",
      body
    )
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => queryClient.invalidateQueries({ queryKey }))
  }
}

function TodoSection({ agentId, state, viewerContextId }: AgentSectionProps) {
  const items = todoItemsFrom(state)
  const [text, setText] = React.useState("")
  const change = useTodoChange(viewerContextId, agentId)
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

function TodoActions({ agentId, state, viewerContextId }: AgentSectionProps) {
  const change = useTodoChange(viewerContextId, agentId)
  const done = todoItemsFrom(state).filter(
    (item) => item.status === "done"
  ).length
  if (done === 0) return null
  return (
    <IconAction
      label="Remove done items"
      icon={<BroomIcon />}
      onClick={() => change({ op: "clear", scope: "done" })}
    />
  )
}

/** Plan progress for the Agent tab trigger while the plan has open items. */
export function TodoTabProgress({
  agentId,
  viewerContextId,
}: {
  agentId?: string
  viewerContextId: string
}) {
  const query = useAgentExtensions(viewerContextId, agentId)
  const items = query.data && agentId ? todoItemsFrom(query.data) : []
  if (items.length === 0) return null
  const done = items.filter((item) => item.status === "done").length
  if (done === items.length) return null
  const active = items.find((item) => item.status === "active")
  const label = `Plan: ${done} of ${items.length} done${active ? `. ${active.text}` : ""}`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground tabular-nums"
    >
      <ListChecksIcon aria-hidden="true" className="size-3.5" />
      {done}/{items.length}
    </span>
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
