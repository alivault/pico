import * as React from "react"
import { FileTextIcon } from "lucide-react"

import { TitleTooltip } from "@/components/ui/tooltip"
import {
  registerAgentSection,
  type AgentSectionProps,
} from "@/features/pico/agent/agent-panel"
import { TextDialog } from "@/features/pico/agent/shared"

/** The context files (AGENTS.md) that the agent of the session loads. */
type Instructions = { cwd: string; files: Array<{ path: string }> }

function instructionsOf(state: Record<string, unknown>) {
  const value = state.instructions as Instructions | undefined
  return value && Array.isArray(value.files) ? value : undefined
}

/** A short label: the path from the session folder, or the full path. */
function labelOf(path: string, cwd: string) {
  const root = cwd.replace(/\/+$/, "")
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  return path.replace(/^\/home\/[^/]+(?=\/)|^\/Users\/[^/]+(?=\/)/, "~")
}

function InstructionsSection({
  sessionId,
  state,
  viewerContextId,
}: AgentSectionProps) {
  const instructions = instructionsOf(state)
  const [open, setOpen] = React.useState<string | null>(null)
  if (!instructions) return null
  return (
    <>
      <ul className="space-y-0.5">
        {instructions.files.map(({ path }) => (
          <li key={path}>
            <TitleTooltip title={path}>
              <button
                type="button"
                aria-label={`Show ${path}`}
                className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => setOpen(path)}
              >
                <FileTextIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">
                  {labelOf(path, instructions.cwd)}
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
          title={labelOf(open, instructions.cwd)}
          path="/api/session/instructions"
          searchParams={{ path: open }}
          sessionId={sessionId}
          viewerContextId={viewerContextId}
          scrollToEnd={false}
        />
      ) : null}
    </>
  )
}

registerAgentSection({
  key: "instructions",
  title: "Instructions",
  order: 70,
  defaultOpen: false,
  visible: (state) => (instructionsOf(state)?.files.length ?? 0) > 0,
  summary(state) {
    const count = instructionsOf(state)?.files.length ?? 0
    return `${count} ${count === 1 ? "file" : "files"}`
  },
  Component: InstructionsSection,
})
