import * as React from "react"

import { cn } from "@/lib/utils"

function Spinner({
  className,
  "aria-label": ariaLabel = "Loading",
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={cn(
        "pointer-events-none inline-flex size-4 shrink-0 items-center justify-center font-mono leading-none text-primary select-none",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="pico-spinner-braille leading-none" />
    </span>
  )
}

export { Spinner }
