import * as React from "react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

function ShortcutFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "hidden flex-wrap items-center gap-1 border-t border-border/70 px-2 py-1.5 text-xs text-muted-foreground md:flex",
        className
      )}
      {...props}
    />
  )
}

type ShortcutButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size"
> & {
  kbd: React.ReactNode
}

function ShortcutButton({
  kbd,
  children,
  className,
  type = "button",
  ...props
}: ShortcutButtonProps) {
  return (
    <Button
      type={type}
      variant="ghost"
      size="xs"
      className={cn("gap-1.5 text-muted-foreground", className)}
      {...props}
    >
      {children}
      <Kbd>{kbd}</Kbd>
    </Button>
  )
}

export { ShortcutButton, ShortcutFooter }
