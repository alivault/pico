import * as React from "react"

import { relativeTime } from "@/lib/pi-web"

const RELATIVE_TIME_FIRST_MINUTE_MS = 60 * 1000
const RELATIVE_TIME_FIRST_MINUTE_REFRESH_MS = 1000
const RELATIVE_TIME_DEFAULT_REFRESH_MS = 2000

export function relativeTimeRefreshDelay(timestamp: number) {
  const ageMs = Math.abs(Date.now() - timestamp)
  return ageMs < RELATIVE_TIME_FIRST_MINUTE_MS
    ? RELATIVE_TIME_FIRST_MINUTE_REFRESH_MS
    : RELATIVE_TIME_DEFAULT_REFRESH_MS
}

export function useRelativeTimeTicker(timestamp: number | undefined) {
  const [, refresh] = React.useReducer((tick: number) => tick + 1, 0)

  React.useEffect(() => {
    if (timestamp === undefined || Number.isNaN(timestamp)) return

    let timeoutId: number | undefined
    let cancelled = false

    const schedule = () => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return

        refresh()
        schedule()
      }, relativeTimeRefreshDelay(timestamp))
    }

    schedule()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [refresh, timestamp])
}

export function RelativeTime({
  className,
  prefix,
  value,
}: {
  value: string
  prefix?: React.ReactNode
  className?: string
}) {
  const timestamp = new Date(value).getTime()
  useRelativeTimeTicker(Number.isNaN(timestamp) ? undefined : timestamp)

  const label = relativeTime(value)
  if (!label) return null

  return (
    <span className={className}>
      {prefix}
      {label}
    </span>
  )
}
