import * as React from "react"

import { cn } from "@/lib/utils"

const SPINNER_CELLS = [
  { id: "top-left", className: "pico-spinner-pixel-0" },
  { id: "top", className: "pico-spinner-pixel-1" },
  { id: "top-right", className: "pico-spinner-pixel-2" },
  { id: "right", className: "pico-spinner-pixel-5" },
  { id: "bottom-right", className: "pico-spinner-pixel-8" },
  { id: "bottom", className: "pico-spinner-pixel-7" },
  { id: "bottom-left", className: "pico-spinner-pixel-6" },
  { id: "left", className: "pico-spinner-pixel-3" },
] as const

type SpinnerPixelSize = "xs" | "sm" | "md"

function getSpinnerPixelSize(className?: string): SpinnerPixelSize {
  const classes = className?.split(/\s+/) ?? []

  if (classes.includes("size-3") || classes.includes("size-[11px]")) {
    return "xs"
  }

  if (classes.includes("size-3.5") || classes.includes("size-[14px]")) {
    return "sm"
  }

  return "md"
}

function Spinner({
  className,
  "aria-label": ariaLabel = "Loading",
  ...props
}: React.ComponentProps<"span">) {
  const pixelSize = getSpinnerPixelSize(className)

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      data-pico-spinner-size={pixelSize}
      className={cn(
        "pico-spinner pointer-events-none inline-flex size-[16px] shrink-0 items-center justify-center font-mono leading-none text-primary select-none",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="pico-spinner-pixels">
        {SPINNER_CELLS.map((cell) => (
          <span
            key={cell.id}
            className={cn("pico-spinner-pixel", cell.className)}
          />
        ))}
      </span>
    </span>
  )
}

export { Spinner }
