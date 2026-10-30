/**
 * Tool renderers of the browser, and of the removed preview and notify tools
 * for earlier transcripts.
 */
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { ShowContent } from "@/features/pico/tool-renderers/show"

function ImageResult({ block }: ToolRendererProps) {
  const details = toolDetails<{ kind: "image"; title?: string; data: string }>(
    block
  )
  if (!details.data)
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
  summary: (block) => {
    const args = toolArgs(block)
    const action = typeof args.action === "string" ? args.action : ""
    if (action === "open" && typeof args.url === "string")
      return `open ${args.url}`
    if (action === "screenshot")
      return `screenshot ${toolDetails<{ title?: string }>(block).title ?? ""}`.trim()
    if (action === "eval" || action === "tabs" || action === "snapshot")
      return action
    if (action === "switch_tab" || action === "close_tab")
      return `${action} ${typeof args.id === "string" ? args.id : ""}`.trim()
    return browserActSummary(args)
  },
  Body: ImageResult,
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
