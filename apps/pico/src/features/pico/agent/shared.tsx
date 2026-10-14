import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { cn } from "@/lib/utils"

/**
 * An icon-only action with a tooltip and an accessible name. The default size
 * gives a 28 px hit target, the smallest that the Apple HIG suggests for
 * controls on a Mac.
 */
export function IconAction({
  className,
  disabled,
  icon,
  label,
  onClick,
  size = "icon-sm",
  tone = "default",
}: {
  className?: string
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  size?: "icon-xs" | "icon-sm"
  tone?: "default" | "destructive"
}) {
  return (
    <TitleTooltip title={label}>
      <Button
        type="button"
        size={size}
        variant="ghost"
        aria-label={label}
        disabled={disabled}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          tone === "destructive" && "hover:text-destructive",
          className
        )}
        onClick={onClick}
      >
        {icon}
      </Button>
    </TitleTooltip>
  )
}

/** A short hint that clarifies a control, with a tooltip on hover. */
export function HintText({
  children,
  hint,
  className,
}: {
  children: React.ReactNode
  hint?: string
  className?: string
}) {
  const text = (
    <span className={cn("min-w-0 truncate", className)}>{children}</span>
  )
  return hint ? <TitleTooltip title={hint}>{text}</TitleTooltip> : text
}

/** "in 5m", "3h ago": a short time relative to now. */
export function relativeTime(time: number | undefined, now = Date.now()) {
  if (!time) return ""
  const delta = time - now
  const abs = Math.abs(delta)
  const unit =
    abs < 60_000
      ? `${Math.max(1, Math.round(abs / 1000))}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 172_800_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`
  return delta >= 0 ? `in ${unit}` : `${unit} ago`
}

/** Re-render every `ms`, for times relative to now. */
export function useNow(ms = 15_000) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** A dialog that shows text from a session route, with a refresh button. */
export function TextDialog({
  open,
  onOpenChange,
  title,
  path,
  searchParams,
  sessionId,
  viewerContextId,
  refreshMs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  path: string
  searchParams: Record<string, string | number>
  sessionId: string
  viewerContextId: string
  refreshMs?: number
}) {
  const query = useQuery({
    queryKey: [
      "pico",
      "text-dialog",
      viewerContextId,
      sessionId,
      path,
      searchParams,
    ],
    queryFn: () =>
      fetchJson<{ text: string }>(
        buildRequestUrl(path, {
          contextId: viewerContextId,
          sessionId,
          searchParams,
        })
      ),
    enabled: open,
    refetchInterval: open ? refreshMs : false,
  })
  const preRef = React.useRef<HTMLPreElement>(null)
  React.useEffect(() => {
    const element = preRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [query.data?.text])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{title}</span>
            <IconAction
              label="Refresh"
              icon={
                query.isFetching ? <Spinner size="xs" /> : <RefreshCwIcon />
              }
              onClick={() => void query.refetch()}
            />
          </DialogTitle>
        </DialogHeader>
        <pre
          ref={preRef}
          className="max-h-[60vh] min-h-24 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap"
        >
          {query.isError
            ? errorText(query.error)
            : (query.data?.text ?? "Loading…") || "(empty)"}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Finished items under a "Show N finished" line, closed at first, so active
 * items stay at the top of a section.
 */
export function FinishedGroup({
  children,
  count,
}: {
  children: React.ReactNode
  count: number
}) {
  if (count === 0) return null
  return (
    <Collapsible className="group/finished">
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-ml-1 text-muted-foreground"
          />
        }
      >
        <ChevronRightIcon className="transition-transform group-data-[open]/finished:rotate-90" />
        {count} finished
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}
