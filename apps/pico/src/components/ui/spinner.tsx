import { LoaderCircleIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

type SpinnerSize = "xs" | "sm" | "md"

type SpinnerProps = Omit<React.ComponentProps<"svg">, "size"> & {
  size?: SpinnerSize
}

// Even sizes, so the icon sits on whole pixels when a box centers it.
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
    <LoaderCircleIcon
      role="status"
      aria-label={ariaLabel}
      className={cn(
        "pointer-events-none shrink-0 animate-spin text-primary motion-reduce:animate-none",
        SPINNER_SIZE_CLASS_NAMES[size],
        className
      )}
      {...props}
    />
  )
}

export { Spinner }
