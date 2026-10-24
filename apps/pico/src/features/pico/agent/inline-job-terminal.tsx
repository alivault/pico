import * as React from "react"

import {
  TerminalTabPane,
  type TerminalStatus,
} from "@/features/pico/terminal-panel"
import { useToolRenderContext } from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"

/**
 * A job's live terminal in its tool call in the chat (`job_start` with
 * `interactive`). It takes keys while the user works in it.
 */
export default function InlineJobTerminal({ jobId }: { jobId: string }) {
  const { viewerContextId, sessionId } = useToolRenderContext()
  const [active, setActive] = React.useState(false)
  const [status, setStatus] = React.useState<TerminalStatus>({
    type: "idle",
  })
  return (
    <div
      className={cn(
        "relative h-56 overflow-hidden rounded-md border bg-background",
        active ? "border-ring" : "border-border/70"
      )}
      data-inline-job-terminal={jobId}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setActive(false)
      }}
    >
      <TerminalTabPane
        active={active}
        cwd="job"
        onStatusChange={(_tabId, next) => setStatus(next)}
        onTerminalIdChange={() => undefined}
        selected
        sessionId={sessionId}
        tabId={`job:${jobId}`}
        viewerContextId={viewerContextId}
      />
      {status.type === "error" ? (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {status.message}
        </div>
      ) : null}
    </div>
  )
}
