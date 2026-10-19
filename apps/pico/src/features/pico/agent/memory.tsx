import * as React from "react"
import { PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  registerAgentSection,
  type AgentSectionProps,
} from "@/features/pico/agent/agent-panel"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import { errorText, IconAction } from "@/features/pico/agent/shared"
import { REVEAL_ON_HOVER } from "@/features/pico/agent/todo"
import {
  registerToolRenderer,
  toolArgs,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type Fact = {
  id: string
  text: string
  tags?: Array<string>
  source: "agent" | "user"
  updatedAt: number
}

type MemoryState = { project: string; facts: Array<Fact>; global: Array<Fact> }
type Scope = "project" | "global"

function scopeDescription(scope: Scope) {
  return scope === "global"
    ? "The agent sees this fact in every project."
    : "The agent sees this fact in every session of this project."
}

function FactDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialText,
  initialScope,
  chooseScope = false,
  tags,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  submitLabel: string
  initialText: string
  initialScope: Scope
  chooseScope?: boolean
  tags?: Array<string>
  onSubmit: (text: string, scope: Scope) => void
}) {
  const [text, setText] = React.useState(initialText)
  const [scope, setScope] = React.useState(initialScope)
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setText(initialText)
      setScope(initialScope)
    }
  }
  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const next = text.trim()
            if (!next) return
            onSubmit(next, scope)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {scopeDescription(scope)}
              {tags?.length ? ` Tags: ${tags.join(", ")}.` : null}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            aria-label="Fact"
            placeholder="A fact that stays true, such as a command or a convention"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          {chooseScope ? (
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as Scope)}
            >
              <SelectTrigger
                className="w-40"
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
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FactRow({
  fact,
  scope,
  onChange,
}: {
  fact: Fact
  scope: Scope
  onChange: (body: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = React.useState(false)
  return (
    <li className="group/row flex items-start gap-1 rounded-md px-1 py-0.5 text-sm hover:bg-muted/50">
      <button
        type="button"
        className="line-clamp-2 min-w-0 flex-1 rounded-sm py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setEditing(true)}
      >
        {fact.text}
      </button>
      <IconAction
        label="Remove fact"
        icon={<XIcon />}
        tone="destructive"
        className={cn("shrink-0", REVEAL_ON_HOVER)}
        onClick={() => onChange({ op: "remove", id: fact.id })}
      />
      <FactDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit fact"
        submitLabel="Save"
        initialText={fact.text}
        initialScope={scope}
        tags={fact.tags}
        onSubmit={(text) => {
          if (text !== fact.text) onChange({ op: "update", id: fact.id, text })
        }}
      />
    </li>
  )
}

function FactList({
  facts,
  scope,
  onChange,
}: {
  facts: Array<Fact>
  scope: Scope
  onChange: (body: Record<string, unknown>) => void
}) {
  return (
    <ul className="space-y-0.5">
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} scope={scope} onChange={onChange} />
      ))}
    </ul>
  )
}

function useMemoryChange(viewerContextId: string, sessionId: string) {
  const machineId = useMachineId()
  return (scope: Scope) => (body: Record<string, unknown>) => {
    void postSessionJson(
      machineId,
      viewerContextId,
      sessionId,
      "/api/session/memory",
      { ...body, scope }
    ).catch((error: unknown) => toast.error(errorText(error)))
  }
}

const SCOPE_HEADING = "w-fit px-1 pt-1 text-xs text-muted-foreground"

function MemorySection({
  sessionId,
  state,
  viewerContextId,
}: AgentSectionProps) {
  const memory = state.memory as MemoryState | undefined
  const change = useMemoryChange(viewerContextId, sessionId)
  if (!memory) return null
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <TitleTooltip title={memory.project}>
          <div className={SCOPE_HEADING}>This project</div>
        </TitleTooltip>
        {memory.facts.length ? (
          <FactList
            facts={memory.facts}
            scope="project"
            onChange={change("project")}
          />
        ) : (
          <p className="px-1 text-xs text-muted-foreground">
            No facts yet. The agent saves facts here that stay true, such as
            commands and conventions.
          </p>
        )}
      </div>
      {memory.global.length ? (
        <div className="space-y-0.5">
          <div className={SCOPE_HEADING}>All projects</div>
          <FactList
            facts={memory.global}
            scope="global"
            onChange={change("global")}
          />
        </div>
      ) : null}
    </div>
  )
}

function MemoryActions({ sessionId, viewerContextId }: AgentSectionProps) {
  const change = useMemoryChange(viewerContextId, sessionId)
  const [adding, setAdding] = React.useState(false)
  return (
    <>
      <IconAction
        label="Add fact"
        icon={<PlusIcon />}
        onClick={() => setAdding(true)}
      />
      <FactDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add fact"
        submitLabel="Add"
        initialText=""
        initialScope="project"
        chooseScope
        onSubmit={(text, scope) => change(scope)({ op: "add", text })}
      />
    </>
  )
}

registerAgentSection({
  key: "memory",
  title: "Memory",
  order: 50,
  defaultOpen: false,
  visible: (state) => Boolean(state.memory),
  summary(state) {
    const memory = state.memory as MemoryState | undefined
    const count = (memory?.facts.length ?? 0) + (memory?.global.length ?? 0)
    return count ? `${count} ${count === 1 ? "fact" : "facts"}` : undefined
  },
  Actions: MemoryActions,
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
