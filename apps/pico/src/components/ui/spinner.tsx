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

type SpinnerSize = "xs" | "sm" | "md"

type SpinnerProps = Omit<React.ComponentProps<"span">, "size"> & {
  size?: SpinnerSize
}

const SPINNER_SIZE_CLASS_NAMES = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
} as const satisfies Record<SpinnerSize, string>

function Spinner({
  className,
  size = "sm",
  "aria-label": ariaLabel = "Loading",
  ...props
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      data-pico-spinner-size={size}
      className={cn(
        "pico-spinner pointer-events-none inline-flex shrink-0 items-center justify-center font-mono leading-none text-primary select-none",
        SPINNER_SIZE_CLASS_NAMES[size],
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
