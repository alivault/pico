import * as React from "react"
import { PencilIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TitleTooltip } from "@/components/ui/tooltip"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import { errorText, IconAction } from "@/features/pico/agent/shared"
import { REVEAL_ON_HOVER } from "@/features/pico/agent/todo"
import {
  registerToolRenderer,
  toolArgs,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"

type Fact = {
  id: string
  text: string
  tags?: Array<string>
  source: "agent" | "user"
  updatedAt: number
}

type MemoryState = { project: string; facts: Array<Fact>; global: Array<Fact> }
type Scope = "project" | "global"

function FactRow({
  fact,
  onChange,
}: {
  fact: Fact
  onChange: (body: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(fact.text)
  if (editing)
    return (
      <li>
        <form
          className="flex gap-1.5 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim() && text.trim() !== fact.text)
              onChange({ op: "update", id: fact.id, text })
            setEditing(false)
          }}
        >
          <Input
            autoFocus
            aria-label="Fact"
            className="h-8"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false)
            }}
          />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      </li>
    )
  return (
    <li className="group/row flex items-start gap-1 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
      <span className="min-w-0 flex-1 pt-0.5">
        {fact.text}
        {fact.tags?.length ? (
          <span className="text-xs text-muted-foreground">
            {" "}
            · {fact.tags.join(", ")}
          </span>
        ) : null}
      </span>
      <span className={cn("-my-1 flex shrink-0", REVEAL_ON_HOVER)}>
        <IconAction
          label="Edit fact"
          icon={<PencilIcon />}
          onClick={() => {
            setText(fact.text)
            setEditing(true)
          }}
        />
        <IconAction
          label="Remove fact"
          icon={<XIcon />}
          tone="destructive"
          onClick={() => onChange({ op: "remove", id: fact.id })}
        />
      </span>
    </li>
  )
}

function FactList({
  facts,
  onChange,
}: {
  facts: Array<Fact>
  onChange: (body: Record<string, unknown>) => void
}) {
  return (
    <ul className="space-y-0.5">
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} onChange={onChange} />
      ))}
    </ul>
  )
}

function MemorySection({
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const memory = state.memory as MemoryState | undefined
  const [text, setText] = React.useState("")
  const [scope, setScope] = React.useState<Scope>("project")
  if (!memory) return null
  const change = (target: Scope) => (body: Record<string, unknown>) => {
    void postSessionJson(viewerContextId, sessionId, "/api/session/memory", {
      ...body,
      scope: target,
    }).catch((error: unknown) => toast.error(errorText(error)))
  }
  const projectName =
    memory.project.split("/").filter(Boolean).at(-1) ?? memory.project
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <TitleTooltip title={memory.project}>
          <div className="w-fit px-1 text-xs font-medium text-muted-foreground">
            This project ({projectName})
          </div>
        </TitleTooltip>
        {memory.facts.length ? (
          <FactList facts={memory.facts} onChange={change("project")} />
        ) : (
          <p className="px-1 text-xs text-muted-foreground">
            No facts yet. The agent saves facts here that stay true, such as
            commands and conventions.
          </p>
        )}
      </div>
      {memory.global.length ? (
        <div className="space-y-1">
          <div className="px-1 text-xs font-medium text-muted-foreground">
            All projects
          </div>
          <FactList facts={memory.global} onChange={change("global")} />
        </div>
      ) : null}
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!text.trim()) return
          change(scope)({ op: "add", text })
          setText("")
        }}
      >
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="New fact"
          aria-label="New fact"
          className="h-8"
        />
        <Select
          value={scope}
          onValueChange={(value) => setScope(value as Scope)}
        >
          <SelectTrigger
            size="sm"
            className="w-32 shrink-0"
            aria-label="Where the fact applies"
          >
            <SelectValue>
              {(value: Scope) =>
                value === "global" ? "All projects" : "This project"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="project">This project</SelectItem>
            <SelectItem value="global">All projects</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!text.trim()}
        >
          Add
        </Button>
      </form>
    </div>
  )
}

registerAgentSection({
  key: "memory",
  title: "Memory",
  order: 50,
  visible: (state) => Boolean(state.memory),
  summary(state) {
    const memory = state.memory as MemoryState | undefined
    const count = (memory?.facts.length ?? 0) + (memory?.global.length ?? 0)
    return count ? `${count} ${count === 1 ? "fact" : "facts"}` : undefined
  },
  Component: MemorySection,
})

registerToolRenderer("memory", {
  summary(block) {
    const args = toolArgs(block)
    const op = typeof args.op === "string" ? args.op : ""
    const detail =
      typeof args.text === "string"
        ? args.text
        : typeof args.query === "string"
          ? args.query
          : typeof args.id === "string"
            ? args.id
            : ""
    return [op, detail].filter(Boolean).join(" · ")
  },
})
