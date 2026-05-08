import * as React from "react"

import { cn } from "@/lib/utils"

const BRAILLE_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const

function Spinner({
  className,
  "aria-label": ariaLabel = "Loading",
  ...props
}: React.ComponentProps<"span">) {
  const [frameIndex, setFrameIndex] = React.useState(0)

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % BRAILLE_SPINNER_FRAMES.length)
    }, 80)

    return () => window.clearInterval(intervalId)
  }, [])

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={cn(
        "pointer-events-none inline-flex size-4 shrink-0 items-center justify-center font-mono leading-none text-current select-none",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="leading-none">
        {BRAILLE_SPINNER_FRAMES[frameIndex]}
      </span>
    </span>
  )
}

export { Spinner }
