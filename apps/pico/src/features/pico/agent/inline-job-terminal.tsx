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
export default function InlineJobTerminal({
  jobId,
  hidden = false,
  inputRef,
}: {
  jobId: string
  /** Keep the terminal connected but do not show it. */
  hidden?: boolean
  inputRef?: React.Ref<((data: string) => boolean) | null>
}) {
  const { viewerContextId, agentId } = useToolRenderContext()
  const [active, setActive] = React.useState(false)
  const [status, setStatus] = React.useState<TerminalStatus>({
    type: "idle",
  })
  // Hide the terminal with a clip, not with `display: none`: xterm.js
  // measures its cells when it opens, and in an element without a size it
  // shows nothing, also after the element shows again.
  return (
    <div className={cn(hidden && "invisible h-0 overflow-hidden")}>
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
          agentId={agentId}
          tabId={`job:${jobId}`}
          viewerContextId={viewerContextId}
          inputRef={inputRef}
        />
        {status.type === "error" ? (
          <div className="absolute inset-x-0 bottom-0 z-20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {status.message}
          </div>
        ) : null}
      </div>
    </div>
  )
}
