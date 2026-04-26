import * as React from "react"

import type { SessionState } from "@/lib/pi-web"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const contextUsageNumberFormatter = new Intl.NumberFormat("en-US")
const CONTEXT_USAGE_OVAL_PATH = [
  "M 32 1.5",
  "H 50",
  "A 12.5 12.5 0 0 1 62.5 14",
  "A 12.5 12.5 0 0 1 50 26.5",
  "H 14",
  "A 12.5 12.5 0 0 1 1.5 14",
  "A 12.5 12.5 0 0 1 14 1.5",
  "H 32",
].join(" ")

function formatContextUsageNumber(value: number) {
  return contextUsageNumberFormatter.format(value)
}

function formatContextUsageCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`
  }
  return formatContextUsageNumber(value)
}

function formatContextUsagePercent(value: number) {
  return String(Math.round(value))
}

function contextUsageStroke(percent: number) {
  if (percent >= 80) return "var(--destructive)"
  if (percent >= 70) return "var(--warning)"
  return "var(--primary)"
}

export type ComposerContextUsageStore = {
  getSnapshot: () => SessionState["contextUsage"]
  subscribe: (listener: () => void) => () => void
}

const emptyContextUsageStore: ComposerContextUsageStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

type ComposerContextUsageIndicatorProps = {
  contextUsageStore?: ComposerContextUsageStore
  disabled?: boolean
}

export function ComposerContextUsageIndicator({
  contextUsageStore = emptyContextUsageStore,
  disabled = false,
}: ComposerContextUsageIndicatorProps) {
  const contextUsage = React.useSyncExternalStore(
    contextUsageStore.subscribe,
    contextUsageStore.getSnapshot,
    contextUsageStore.getSnapshot
  )

  if (disabled) return null
  if (!contextUsage?.contextWindow) return null

  const tokens =
    typeof contextUsage.tokens === "number" ? contextUsage.tokens : null
  const rawPercent =
    typeof contextUsage.percent === "number"
      ? contextUsage.percent
      : tokens != null && contextUsage.contextWindow > 0
        ? (tokens / contextUsage.contextWindow) * 100
        : null

  if (rawPercent == null) return null

  const percent = Math.max(0, Math.min(100, rawPercent))
  const roundedPercent = Math.max(0, Math.min(100, Math.round(percent)))
  const displayPercent = `${formatContextUsagePercent(roundedPercent)}%`
  const compactContextWindow = formatContextUsageCompactNumber(
    contextUsage.contextWindow
  )
  const compactTokens =
    tokens == null ? null : formatContextUsageCompactNumber(tokens)
  const tooltipAriaLabel =
    tokens == null
      ? `Context window. ${compactContextWindow} tokens available.`
      : `Context window. ${compactTokens} / ${compactContextWindow} tokens used.`

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="relative ml-auto inline-flex h-7 min-w-[56px] shrink-0 cursor-default items-center justify-center px-2.5 text-[11px] font-semibold tabular-nums"
            aria-label={tooltipAriaLabel}
            role="img"
          />
        }
      >
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 64 28"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <path
            d={CONTEXT_USAGE_OVAL_PATH}
            stroke="var(--border)"
            strokeWidth="3"
            strokeOpacity="0.9"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={CONTEXT_USAGE_OVAL_PATH}
            pathLength={100}
            stroke={contextUsageStroke(percent)}
            strokeWidth="3"
            strokeDasharray={`${percent.toFixed(1)} 100`}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <span className="relative">{displayPercent}</span>
      </TooltipTrigger>

      <TooltipContent
        side="top"
        align="end"
        sideOffset={8}
        className="max-w-none flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-sm"
      >
        <div className="text-xs font-medium text-background/70">
          Context window:
        </div>
        <div>
          {compactTokens == null
            ? `${compactContextWindow} token window`
            : `${compactTokens} / ${compactContextWindow} tokens used`}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
