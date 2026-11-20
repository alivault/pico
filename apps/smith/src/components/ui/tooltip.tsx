"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"
import { Kbd } from "@/components/ui/kbd"
import { usePortalContainer } from "@/components/ui/portal-container"

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

// Tooltips ignore the pointer, so they do not block the controls behind
// them. They close when the pointer leaves the trigger.
function Tooltip({
  disableHoverablePopup = true,
  ...props
}: TooltipPrimitive.Root.Props) {
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      disableHoverablePopup={disableHoverablePopup}
      {...props}
    />
  )
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  positionerClassName,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string
  }) {
  const portalContainer = usePortalContainer()
  return (
    <TooltipPrimitive.Portal container={portalContainer}>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className={cn("pointer-events-none isolate z-50", positionerClassName)}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 flex max-h-[min(24rem,calc(100vh-2rem))] max-w-[min(42rem,calc(100vw-2rem))] min-w-0 origin-(--transform-origin) items-center gap-1.5 overflow-x-hidden overflow-y-auto rounded-md bg-secondary px-3 py-1.5 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap text-secondary-foreground has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

function TitleTooltip({
  title,
  children,
  kbd,
  rows,
  side,
  align,
  sideOffset,
  className,
  positionerClassName,
  onlyWhenTruncated = false,
  openWhen,
}: {
  title: React.ReactNode
  children: React.ReactElement
  kbd?: React.ReactNode
  rows?: Array<{ title: React.ReactNode; kbd?: React.ReactNode }>
  /** Open only when the text of the trigger does not fit, so it is cut off. */
  onlyWhenTruncated?: boolean
  /** Open only when this returns true for the trigger element. */
  openWhen?: (trigger: HTMLElement) => boolean
} & Pick<
  React.ComponentProps<typeof TooltipContent>,
  "align" | "className" | "positionerClassName" | "side" | "sideOffset"
>) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [open, setOpen] = React.useState(false)
  if (!title) return children

  const truncatedProps =
    onlyWhenTruncated || openWhen
      ? {
          open,
          onOpenChange: (nextOpen: boolean) => {
            const trigger = triggerRef.current
            if (nextOpen && trigger) {
              if (
                onlyWhenTruncated &&
                trigger.scrollWidth <= trigger.clientWidth
              )
                return
              if (openWhen && !openWhen(trigger)) return
            }
            setOpen(nextOpen)
          },
        }
      : {}

  return (
    <Tooltip {...truncatedProps}>
      <TooltipTrigger ref={triggerRef} render={children} />
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
        positionerClassName={positionerClassName}
      >
        {rows ? (
          <span className="flex flex-col gap-1">
            {rows.map((row, rowOffset) => (
              <span
                key={`tooltip-row-${rowOffset}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="min-w-0">{row.title}</span>
                {row.kbd ? <Kbd data-slot="kbd">{row.kbd}</Kbd> : null}
              </span>
            ))}
          </span>
        ) : (
          <>
            <span className="min-w-0">{title}</span>
            {kbd ? <Kbd data-slot="kbd">{kbd}</Kbd> : null}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TitleTooltip,
}
