import * as React from "react"
import { ChevronRightIcon, NotebookTextIcon } from "lucide-react"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
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
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const entries = (state.scratch as Array<ScratchEntry> | undefined) ?? []
  const [open, setOpen] = React.useState<ScratchEntry | null>(null)
  return (
    <>
      <ItemGroup className="gap-1">
        {entries.map((entry) => (
          <Item
            key={entry.id}
            size="sm"
            className="py-1.5 hover:bg-muted/60"
            render={
              <button
                type="button"
                aria-label={`Show ${entry.name}`}
                onClick={() => setOpen(entry)}
              />
            }
          >
            <ItemMedia variant="icon">
              <NotebookTextIcon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="block truncate">{entry.name}</ItemTitle>
              <ItemDescription className="tabular-nums">
                {entry.lines} lines · {formatBytes(entry.bytes)}
                {entry.source ? ` · from ${entry.source}` : ""}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {open ? (
        <TextDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(null)
          }}
          title={open.name}
          path="/api/session/scratch"
          searchParams={{ id: open.id }}
          sessionId={sessionId}
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
