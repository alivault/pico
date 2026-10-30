/**
 * Tool renderers of the removed schedule and watch tools, for earlier
 * transcripts.
 */
import {
  registerToolRenderer,
  toolArgs,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"

function watchSummary(block: ToolRendererProps["block"]) {
  const args = toolArgs(block)
  const check = (args.check ?? {}) as Record<string, unknown>
  const target = [check.command, check.url, check.path, check.pr].find(
    (value) => typeof value === "string"
  ) as string | undefined
  return [
    typeof check.type === "string" ? check.type : "",
    target,
    typeof check.until === "string" ? `until ${check.until}` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

registerToolRenderer("schedule", {
  summary(block) {
    const args = toolArgs(block)
    // One tool for timers, watches, list, and cancel.
    if (args.action === "list") return "list"
    if (args.action === "cancel")
      return `cancel ${typeof args.id === "string" ? args.id : ""}`.trim()
    if (args.action === "watch" || args.check) return watchSummary(block)
    const when =
      typeof args.in === "string"
        ? `in ${args.in}`
        : typeof args.at === "string"
          ? `at ${args.at}`
          : typeof args.every === "string"
            ? `every ${args.every}`
            : typeof args.cron === "string"
              ? `cron ${args.cron}`
              : ""
    const label =
      typeof args.label === "string"
        ? args.label
        : typeof args.message === "string"
          ? args.message
          : ""
    return [when, label].filter(Boolean).join(" · ")
  },
})

// Calls of the old watch tool in earlier transcripts.
registerToolRenderer("watch", { summary: watchSummary })
