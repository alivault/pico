import * as React from "react"

import type { SessionState } from "@/lib/pi-web"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const contextUsageNumberFormatter = new Intl.NumberFormat("en-US")
const CONTEXT_USAGE_CIRCLE_CENTER = 14
const CONTEXT_USAGE_CIRCLE_RADIUS = 10.5

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
  if (percent >= 90) return "var(--destructive)"
  if (percent >= 80) return "var(--warning)"
  return "var(--primary)"
}

type ComposerContextUsageQuotaSnapshot = {
  label: string
  used: number | null
  limit: number | null
  percent: number | null
  timeLeft: string | null
}

type ComposerContextUsageSnapshot = {
  contextWindow: number
  tokens: number | null
  percent: number
  roundedPercent: number
  fiveHourUsage: ComposerContextUsageQuotaSnapshot | null
  weeklyUsage: ComposerContextUsageQuotaSnapshot | null
}

type ContextUsageRecord = NonNullable<SessionState["contextUsage"]>

export type ComposerContextUsageStore = {
  getSnapshot: () => SessionState["contextUsage"]
  subscribe: (listener: () => void) => () => void
}

const emptyContextUsageStore: ComposerContextUsageStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

type ProviderUsageWindow = {
  label: string
  usedPercent: number
  resetsIn?: string
}

type ComposerContextUsageIndicatorProps = {
  contextUsageStore?: ComposerContextUsageStore
  disabled?: boolean
  modelProvider?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function getFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function getNumberProperty(
  record: Record<string, unknown>,
  keys: Array<string>
) {
  for (const key of keys) {
    const value = getFiniteNumber(record[key])
    if (value != null) return value
  }
  return null
}

function getStringProperty(
  record: Record<string, unknown>,
  keys: Array<string>
) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return null
}

function getRecordProperty(
  record: Record<string, unknown>,
  keys: Array<string>
) {
  for (const key of keys) {
    const value = record[key]
    if (isRecord(value)) return value
  }
  return null
}

function formatContextUsageDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function getTimestampMilliseconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== "string" || !value.trim()) return null

  const numericValue = Number(value)
  if (Number.isFinite(numericValue)) {
    return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue
  }

  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function getContextUsageQuotaTimeLeft(
  source: Record<string, unknown>,
  timeLeftKeys: Array<string>,
  resetAtKeys: Array<string>
) {
  const explicitTimeLeft = getStringProperty(source, timeLeftKeys)
  if (explicitTimeLeft) return explicitTimeLeft

  const resetAtValue = resetAtKeys
    .map((key) => getTimestampMilliseconds(source[key]))
    .find((value) => value != null)
  if (resetAtValue == null) return null

  const remainingMs = resetAtValue - Date.now()
  if (remainingMs <= 0) return "0m"
  return formatContextUsageDuration(remainingMs)
}

function getContextUsageQuotaSnapshot(
  contextUsage: ContextUsageRecord,
  label: string,
  recordKeys: Array<string>,
  usedKeys: Array<string>,
  limitKeys: Array<string>,
  percentKeys: Array<string>,
  timeLeftKeys: Array<string>,
  resetAtKeys: Array<string>
): ComposerContextUsageQuotaSnapshot | null {
  const quotaRecord = getRecordProperty(contextUsage, recordKeys)
  const source = quotaRecord ?? contextUsage
  const used = getNumberProperty(source, usedKeys)
  const limit = getNumberProperty(source, limitKeys)
  const rawPercent = getNumberProperty(source, percentKeys)
  const percent =
    rawPercent ??
    (used != null && limit != null && limit > 0 ? (used / limit) * 100 : null)

  const timeLeft = getContextUsageQuotaTimeLeft(
    source,
    timeLeftKeys,
    resetAtKeys
  )

  if (used == null && limit == null && percent == null && timeLeft == null) {
    return null
  }

  return {
    label,
    used,
    limit,
    percent: percent == null ? null : Math.max(0, Math.min(100, percent)),
    timeLeft,
  }
}

function getComposerContextUsageSnapshot(
  contextUsage: SessionState["contextUsage"]
): ComposerContextUsageSnapshot | undefined {
  if (!contextUsage?.contextWindow) return undefined

  const tokens =
    typeof contextUsage.tokens === "number" ? contextUsage.tokens : null
  const rawPercent =
    typeof contextUsage.percent === "number"
      ? contextUsage.percent
      : tokens != null && contextUsage.contextWindow > 0
        ? (tokens / contextUsage.contextWindow) * 100
        : null

  if (rawPercent == null) return undefined

  const percent = Math.max(0, Math.min(100, rawPercent))
  const roundedPercent = Math.max(0, Math.min(100, Math.round(percent)))

  const fiveHourUsage = getContextUsageQuotaSnapshot(
    contextUsage,
    "5h usage",
    ["fiveHourUsage", "fiveHour", "usage5h", "5h", "fiveHourLimit"],
    ["used", "tokens", "usage", "fiveHourUsed", "fiveHourTokens", "usage5h"],
    ["limit", "total", "max", "fiveHourLimit", "limit5h"],
    ["percent", "percentage", "fiveHourPercent", "percent5h"],
    ["timeLeft", "remaining", "fiveHourTimeLeft", "timeLeft5h"],
    ["resetAt", "resetsAt", "expiresAt", "fiveHourResetAt", "resetAt5h"]
  )
  const weeklyUsage = getContextUsageQuotaSnapshot(
    contextUsage,
    "Weekly usage",
    ["weeklyUsage", "weekly", "usageWeekly", "week", "weeklyLimit"],
    ["used", "tokens", "usage", "weeklyUsed", "weeklyTokens", "usageWeekly"],
    ["limit", "total", "max", "weeklyLimit", "limitWeekly"],
    ["percent", "percentage", "weeklyPercent", "percentWeekly"],
    ["timeLeft", "remaining", "weeklyTimeLeft", "timeLeftWeekly"],
    ["resetAt", "resetsAt", "expiresAt", "weeklyResetAt", "resetAtWeekly"]
  )

  return {
    contextWindow: contextUsage.contextWindow,
    tokens,
    percent: roundedPercent,
    roundedPercent,
    fiveHourUsage,
    weeklyUsage,
  }
}

function sameContextUsageQuotaSnapshot(
  left: ComposerContextUsageQuotaSnapshot | null | undefined,
  right: ComposerContextUsageQuotaSnapshot | null | undefined
) {
  return (
    left?.label === right?.label &&
    left?.used === right?.used &&
    left?.limit === right?.limit &&
    left?.percent === right?.percent &&
    left?.timeLeft === right?.timeLeft
  )
}

function sameComposerContextUsageSnapshot(
  left: ComposerContextUsageSnapshot | undefined,
  right: ComposerContextUsageSnapshot | undefined
) {
  return (
    left?.contextWindow === right?.contextWindow &&
    left?.roundedPercent === right?.roundedPercent &&
    sameContextUsageQuotaSnapshot(left?.fiveHourUsage, right?.fiveHourUsage) &&
    sameContextUsageQuotaSnapshot(left?.weeklyUsage, right?.weeklyUsage)
  )
}

function useComposerContextUsageSnapshot(
  contextUsageStore: ComposerContextUsageStore
) {
  const snapshotRef = React.useRef<ComposerContextUsageSnapshot | undefined>(
    undefined
  )

  return React.useSyncExternalStore(
    contextUsageStore.subscribe,
    () => {
      const nextSnapshot = getComposerContextUsageSnapshot(
        contextUsageStore.getSnapshot()
      )
      if (sameComposerContextUsageSnapshot(snapshotRef.current, nextSnapshot)) {
        return snapshotRef.current
      }
      snapshotRef.current = nextSnapshot
      return nextSnapshot
    },
    () => undefined
  )
}

function formatContextUsageQuotaPercent(value: number | null) {
  return value == null ? null : `${formatContextUsagePercent(value)}%`
}

function formatContextUsageQuotaValue(value: number | null) {
  return value == null ? null : formatContextUsageCompactNumber(value)
}

function TooltipUsageProgress({ percent }: { percent: number }) {
  const clampedPercent = Math.max(0, Math.min(100, percent))

  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/15">
      <div
        className="h-full rounded-full"
        style={{
          width: `${clampedPercent}%`,
          backgroundColor: contextUsageStroke(clampedPercent),
        }}
      />
    </div>
  )
}

function ContextUsageQuotaTooltipLine({
  quota,
}: {
  quota: ComposerContextUsageQuotaSnapshot
}) {
  const percent = formatContextUsageQuotaPercent(quota.percent)
  const used = formatContextUsageQuotaValue(quota.used)
  const limit = formatContextUsageQuotaValue(quota.limit)
  const value =
    used != null && limit != null
      ? `${used} / ${limit}`
      : (used ?? limit ?? "Available")
  return (
    <div className="rounded-lg bg-background/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-6">
        <span className="font-medium text-background/80">{quota.label}</span>
        <span className="font-semibold text-background">
          {percent ? `${percent} ` : null}
          {value}
        </span>
      </div>
      {quota.percent != null ? (
        <TooltipUsageProgress percent={quota.percent} />
      ) : null}
      {quota.timeLeft ? (
        <div className="mt-1 text-xs text-background/50">
          Resets in {quota.timeLeft}
        </div>
      ) : null}
    </div>
  )
}

function ProviderUsageTooltipLine({ window }: { window: ProviderUsageWindow }) {
  const percent = `${formatContextUsagePercent(window.usedPercent)}%`

  return (
    <div className="rounded-lg bg-background/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-6">
        <span className="font-medium text-background/80">
          {window.label === "Week" ? "Weekly usage" : `${window.label} usage`}
        </span>
        <span className="font-semibold text-background">{percent}</span>
      </div>
      <TooltipUsageProgress percent={window.usedPercent} />
      {window.resetsIn ? (
        <div className="mt-1 text-xs text-background/50">
          Resets in {window.resetsIn}
        </div>
      ) : null}
    </div>
  )
}

export function ComposerContextUsageIndicator({
  contextUsageStore = emptyContextUsageStore,
  disabled = false,
  modelProvider,
}: ComposerContextUsageIndicatorProps) {
  const contextUsage = useComposerContextUsageSnapshot(contextUsageStore)
  const [providerUsageWindows, setProviderUsageWindows] = React.useState<
    Array<ProviderUsageWindow>
  >([])

  React.useEffect(() => {
    if (!modelProvider) {
      setProviderUsageWindows([])
      return
    }

    let cancelled = false
    const url = `/api/provider-usage?provider=${encodeURIComponent(modelProvider)}`

    fetch(url)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const windows = Array.isArray(data?.usage?.windows)
          ? data.usage.windows
          : []
        setProviderUsageWindows(windows)
      })
      .catch(() => {
        if (!cancelled) setProviderUsageWindows([])
      })

    return () => {
      cancelled = true
    }
  }, [modelProvider])

  if (disabled) return null
  if (!contextUsage) return null

  const {
    contextWindow,
    fiveHourUsage,
    percent,
    roundedPercent,
    tokens,
    weeklyUsage,
  } = contextUsage
  const displayPercent = `${formatContextUsagePercent(roundedPercent)}%`
  const compactContextWindow = formatContextUsageCompactNumber(contextWindow)
  const compactTokens =
    tokens == null ? null : formatContextUsageCompactNumber(tokens)
  const tooltipAriaLabel =
    tokens == null
      ? `Context window. ${displayPercent} used. ${compactContextWindow} tokens available.`
      : `Context window. ${displayPercent} used. ${compactTokens} / ${compactContextWindow} tokens used.`

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="relative ml-auto shrink-0"
      aria-label={tooltipAriaLabel}
    >
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx={CONTEXT_USAGE_CIRCLE_CENTER}
          cy={CONTEXT_USAGE_CIRCLE_CENTER}
          r={CONTEXT_USAGE_CIRCLE_RADIUS}
          stroke="var(--border)"
          strokeWidth="3"
          strokeOpacity="0.9"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={CONTEXT_USAGE_CIRCLE_CENTER}
          cy={CONTEXT_USAGE_CIRCLE_CENTER}
          r={CONTEXT_USAGE_CIRCLE_RADIUS}
          pathLength={100}
          stroke={contextUsageStroke(percent)}
          strokeWidth="3"
          strokeDasharray={`${percent.toFixed(1)} 100`}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="origin-center -rotate-90"
        />
      </svg>
    </Button>
  )
  const content = (
    <>
      <div className="rounded-lg bg-background/5 px-2.5 py-2">
        <div className="flex items-center justify-between gap-6">
          <span className="font-medium text-background/80">Context window</span>
          <span className="font-semibold text-background">
            {displayPercent}
          </span>
        </div>
        <TooltipUsageProgress percent={percent} />
        <div className="mt-1 text-xs text-background/50">
          {compactTokens == null
            ? `${compactContextWindow} token window`
            : `${compactTokens} / ${compactContextWindow} tokens used`}
        </div>
      </div>
      {providerUsageWindows.length > 0 ? (
        providerUsageWindows.map((window) => (
          <ProviderUsageTooltipLine key={window.label} window={window} />
        ))
      ) : (
        <>
          {fiveHourUsage ? (
            <ContextUsageQuotaTooltipLine quota={fiveHourUsage} />
          ) : null}
          {weeklyUsage ? (
            <ContextUsageQuotaTooltipLine quota={weeklyUsage} />
          ) : null}
        </>
      )}
    </>
  )

  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 max-w-none items-stretch gap-2 rounded-xl bg-foreground px-3 py-3 text-sm text-background"
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}
