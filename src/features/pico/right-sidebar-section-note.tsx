import * as React from "react"

import { cn } from "@/lib/utils"

export function GitSectionNote({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode
  tone?: "muted" | "destructive"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center gap-2 text-sm leading-6",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}
