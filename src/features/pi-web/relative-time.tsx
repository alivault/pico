import * as React from "react"

import { relativeTime } from "@/lib/pi-web"

const RELATIVE_TIME_FIRST_MINUTE_MS = 60 * 1000
const RELATIVE_TIME_FIRST_MINUTE_REFRESH_MS = 1000
const RELATIVE_TIME_MINUTE_REFRESH_MS = 60 * 1000

export function relativeTimeRefreshDelay(timestamp: number) {
  const ageMs = Math.abs(Date.now() - timestamp)
  if (ageMs < RELATIVE_TIME_FIRST_MINUTE_MS) {
    return RELATIVE_TIME_FIRST_MINUTE_REFRESH_MS
  }

  const nextMinuteDelay =
    RELATIVE_TIME_MINUTE_REFRESH_MS - (ageMs % RELATIVE_TIME_MINUTE_REFRESH_MS)
  return nextMinuteDelay === RELATIVE_TIME_MINUTE_REFRESH_MS
    ? RELATIVE_TIME_MINUTE_REFRESH_MS
    : nextMinuteDelay
}

export function useRelativeTimeTicker(timestamp: number | undefined) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (timestamp === undefined || Number.isNaN(timestamp)) return

    let timeoutId: number | undefined
    let cancelled = false

    const schedule = () => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return

        setNow(Date.now())
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
  }, [timestamp])

  return now
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
  const now = useRelativeTimeTicker(
    Number.isNaN(timestamp) ? undefined : timestamp
  )

  const label = relativeTime(value, now)
  if (!label) return null

  return (
    <span className={className}>
      {prefix}
      {label}
    </span>
  )
}
