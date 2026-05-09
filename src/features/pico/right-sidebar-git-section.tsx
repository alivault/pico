import * as React from "react"

import { cn } from "@/lib/utils"

type GitSectionProps = {
  title: string
  meta?: string
  controls?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}

export function GitSection({
  title,
  meta,
  controls,
  className,
  bodyClassName,
  children,
}: GitSectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card/50",
        className
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
            {title}
          </div>
          {meta ? (
            <div className="min-w-0 truncate text-xs text-muted-foreground/80">
              {meta}
            </div>
          ) : null}
        </div>
        {controls ? <div className="shrink-0">{controls}</div> : null}
      </div>
      <div className={cn("grid gap-2 px-3 py-2.5", bodyClassName)}>
        {children}
      </div>
    </section>
  )
}
