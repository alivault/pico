import { cn } from "@/lib/utils"

/**
 * A state symbol as an emoji, the same as in the window title: ❓ the agent
 * waits for the user, ⏳ it waits on a job, a timer, or a watch.
 */
export function StatusEmoji({
  children,
  label,
  className,
}: {
  children: string
  /** Without a label, the emoji is decoration (the parent names it). */
  label?: string
  className?: string
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-flex items-center justify-center text-[13px] leading-none select-none",
        className
      )}
    >
      {children}
    </span>
  )
}
