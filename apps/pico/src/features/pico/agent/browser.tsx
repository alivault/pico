/**
 * Tool renderers of the browser, and of the removed preview and notify tools
 * for earlier transcripts.
 */
import * as React from "react"
import { GlobeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { QuestionCardView } from "@/features/pico/agent/ask"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { ShowContent } from "@/features/pico/tool-renderers/show"

/** The handoffs that opened the Browser tab, so each opens it one time. */
const openedHandoffs = new Set<string>()

function openBrowserTab() {
  emitPicoEvent("pico:open-sidebar-tab", { tab: "browser" })
}

/**
 * A handoff: the agent waits until the user used its browser, for example
 * to log in. The card opens the Browser tab one time when it starts.
 */
function BrowserCard({ block, fallback }: ToolRendererProps) {
  const args = toolArgs(block)
  const handoff = args.action === "handoff"
  const details = toolDetails<{ questionId: string; status: string }>(block)
  const questionId = details.questionId ?? block.callId ?? ""
  const waiting = handoff && block.running && details.status !== "answered"
  React.useEffect(() => {
    if (!waiting || !questionId || openedHandoffs.has(questionId)) return
    openedHandoffs.add(questionId)
    openBrowserTab()
  }, [questionId, waiting])
  if (!handoff) return <>{fallback}</>
  return (
    <QuestionCardView
      block={block}
      icon={<GlobeIcon className="size-4" />}
      title={waiting ? "The agent needs you in its browser" : "Browser handoff"}
      question={{
        id: questionId,
        prompt: typeof args.text === "string" ? args.text : "",
        kind: "choice",
        options: [{ label: "Done" }, { label: "I can't do it" }],
        allowOther: true,
      }}
      actions={
        <Button size="sm" variant="outline" onClick={openBrowserTab}>
          <GlobeIcon />
          Open the browser
        </Button>
      }
    />
  )
}

function ImageResult({ block }: ToolRendererProps) {
  const details = toolDetails<{ kind: "image"; title?: string; data: string }>(
    block
  )
  // The header shows the images of the result, also when the card is closed.
  if (!details.data || (block.images?.length ?? 0) > 0)
    return <pre className="text-xs whitespace-pre-wrap">{block.output}</pre>
  return (
    <ShowContent
      details={{ kind: "image", data: details.data, title: details.title }}
    />
  )
}

for (const name of ["preview_screenshot", "browser_screenshot"]) {
  registerToolRenderer(name, {
    summary: (block) => {
      const title = toolDetails<{ title?: string }>(block).title
      return title ?? ""
    },
    Body: ImageResult,
    showImages: true,
  })
}

// The removed preview tools, in earlier transcripts.
registerToolRenderer("preview_url", {
  summary: (block) => {
    const args = toolArgs(block)
    return typeof args.url === "string"
      ? args.url
      : typeof args.port === "number"
        ? `port ${args.port}`
        : ""
  },
})

registerToolRenderer("preview", {
  summary: (block) => {
    const args = toolArgs(block)
    const title = toolDetails<{ title?: string }>(block).title
    return [typeof args.action === "string" ? args.action : "", title ?? ""]
      .filter(Boolean)
      .join(" · ")
  },
  Body: ImageResult,
  showImages: true,
})

function browserActSummary(args: Record<string, unknown>) {
  const target =
    typeof args.ref === "number"
      ? `[${args.ref}]`
      : typeof args.selector === "string"
        ? args.selector
        : typeof args.text === "string"
          ? `"${args.text}"`
          : ""
  const value = typeof args.value === "string" ? ` ${args.value}` : ""
  return `${typeof args.action === "string" ? args.action : ""} ${target}${value}`.trim()
}

registerToolRenderer("browser", {
  Card: BrowserCard,
  summary: (block) => {
    const args = toolArgs(block)
    const action = typeof args.action === "string" ? args.action : ""
    if (action === "open" && typeof args.url === "string")
      return `open ${args.url}`
    if (action === "screenshot")
      return `screenshot ${toolDetails<{ title?: string }>(block).title ?? ""}`.trim()
    if (action === "eval" || action === "tabs" || action === "snapshot")
      return action
    if (action === "handoff")
      return `handoff ${typeof args.text === "string" ? args.text : ""}`.trim()
    if (action === "switch_tab" || action === "close_tab")
      return `${action} ${typeof args.id === "string" ? args.id : ""}`.trim()
    return browserActSummary(args)
  },
  Body: ImageResult,
  showImages: true,
})

// The old browser tools, in earlier transcripts.
registerToolRenderer("browser_open", {
  summary: (block) => {
    const url = toolArgs(block).url
    return typeof url === "string" ? url : ""
  },
})

registerToolRenderer("browser_act", {
  summary: (block) => browserActSummary(toolArgs(block)),
})

// The removed notify tool, in earlier transcripts.
registerToolRenderer("notify", {
  summary: (block) => {
    const title = toolArgs(block).title
    return typeof title === "string" ? title : ""
  },
})
