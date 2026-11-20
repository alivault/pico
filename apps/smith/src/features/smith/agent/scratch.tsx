import * as React from "react"
import { NotebookTextIcon } from "lucide-react"

import { TitleTooltip } from "@/components/ui/tooltip"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { TextDialog } from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
} from "@/features/pico/tool-renderers/registry"

type ScratchEntry = {
  id: string
  name: string
  bytes: number
  lines: number
  createdAt: number
  source?: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ScratchSection({
  agentId,
  state,
  viewerContextId,
}: {
  agentId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const entries = (state.scratch as Array<ScratchEntry> | undefined) ?? []
  const [open, setOpen] = React.useState<ScratchEntry | null>(null)
  return (
    <>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <TitleTooltip
              title={`${entry.lines} lines${entry.source ? ` from ${entry.source}` : ""}`}
            >
              <button
                type="button"
                aria-label={`Show ${entry.name}`}
                className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => setOpen(entry)}
              >
                <NotebookTextIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(entry.bytes)}
                </span>
              </button>
            </TitleTooltip>
          </li>
        ))}
      </ul>
      {open ? (
        <TextDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(null)
          }}
          title={open.name}
          path="/api/agent/scratch"
          searchParams={{ id: open.id }}
          agentId={agentId}
          viewerContextId={viewerContextId}
        />
      ) : null}
    </>
  )
}

registerAgentSection({
  key: "scratch",
  title: "Scratchpad",
  order: 60,
  defaultOpen: false,
  visible: (state) => Array.isArray(state.scratch) && state.scratch.length > 0,
  summary(state) {
    const count = (state.scratch as Array<unknown> | undefined)?.length ?? 0
    return `${count} ${count === 1 ? "entry" : "entries"}`
  },
  Component: ScratchSection,
})

registerToolRenderer("scratch_put", {
  summary(block) {
    const details = toolDetails<ScratchEntry>(block)
    const name = toolArgs(block).name
    return [details.id, typeof name === "string" ? name : ""]
      .filter(Boolean)
      .join(" · ")
  },
})

registerToolRenderer("scratch_get", {
  summary(block) {
    const args = toolArgs(block)
    return [
      typeof args.id === "string" ? args.id : "",
      typeof args.grep === "string" ? `grep ${args.grep}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  },
})
