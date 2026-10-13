import * as React from "react"
import { PencilIcon, PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import { errorText } from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
} from "@/features/pico/tool-renderers/registry"

type Fact = {
  id: string
  text: string
  tags?: Array<string>
  source: "agent" | "user"
  updatedAt: number
}

type MemoryState = { project: string; facts: Array<Fact>; global: Array<Fact> }

function FactList({
  facts,
  onChange,
}: {
  facts: Array<Fact>
  onChange: (body: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const [text, setText] = React.useState("")
  return (
    <ul className="space-y-1">
      {facts.map((fact) => (
        <li
          key={fact.id}
          className="group/fact flex items-start gap-1.5 rounded-md px-1 py-0.5 text-sm hover:bg-muted/50"
        >
          {editing === fact.id ? (
            <form
              className="flex-1"
              onSubmit={(event) => {
                event.preventDefault()
                if (text.trim()) onChange({ op: "update", id: fact.id, text })
                setEditing(null)
              }}
            >
              <Input
                autoFocus
                className="h-7 text-xs"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onBlur={() => setEditing(null)}
              />
            </form>
          ) : (
            <span className="min-w-0 flex-1">
              {fact.text}
              {fact.tags?.length ? (
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {fact.tags.join(", ")}
                </span>
              ) : null}
            </span>
          )}
          <span className="flex shrink-0 opacity-0 group-hover/fact:opacity-100">
            <button
              type="button"
              title="Edit"
              onClick={() => {
                setText(fact.text)
                setEditing(fact.id)
              }}
            >
              <PencilIcon className="size-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              title="Remove"
              className="ml-1"
              onClick={() => onChange({ op: "remove", id: fact.id })}
            >
              <XIcon className="size-3.5 text-muted-foreground" />
            </button>
          </span>
        </li>
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
  const [scope, setScope] = React.useState<"project" | "global">("project")
  if (!memory) return null
  const change =
    (target: "project" | "global") => (body: Record<string, unknown>) => {
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
        <div className="text-xs text-muted-foreground" title={memory.project}>
          Project: {projectName}
        </div>
        {memory.facts.length ? (
          <FactList facts={memory.facts} onChange={change("project")} />
        ) : (
          <div className="text-xs text-muted-foreground">No facts yet.</div>
        )}
      </div>
      {memory.global.length ? (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">All projects</div>
          <FactList facts={memory.global} onChange={change("global")} />
        </div>
      ) : null}
      <form
        className="flex gap-1"
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
          placeholder="Add a fact"
          className="h-7 text-xs"
        />
        <select
          className="h-7 rounded-md border bg-background px-1 text-xs"
          value={scope}
          onChange={(event) => setScope(event.target.value as "project")}
          aria-label="Memory scope"
        >
          <option value="project">Project</option>
          <option value="global">All</option>
        </select>
        <Button type="submit" size="icon-sm" variant="ghost" title="Add">
          <PlusIcon />
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
