"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

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

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
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
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs text-secondary-foreground has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded **:data-[slot=kbd]:border **:data-[slot=kbd]:border-secondary-foreground/20 **:data-[slot=kbd]:bg-secondary-foreground/10 **:data-[slot=kbd]:px-1.5 **:data-[slot=kbd]:py-0.5 **:data-[slot=kbd]:text-xs **:data-[slot=kbd]:font-medium **:data-[slot=kbd]:text-secondary-foreground/60 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
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
}: {
  title: React.ReactNode
  children: React.ReactElement
  kbd?: React.ReactNode
  rows?: Array<{ title: React.ReactNode; kbd?: React.ReactNode }>
} & Pick<
  React.ComponentProps<typeof TooltipContent>,
  "align" | "className" | "side" | "sideOffset"
>) {
  if (!title) return children

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
      >
        {rows ? (
          <span className="flex flex-col gap-1">
            {rows.map((row, index) => (
              <span
                key={index}
                className="flex items-center justify-between gap-3"
              >
                <span>{row.title}</span>
                {row.kbd ? <kbd data-slot="kbd">{row.kbd}</kbd> : null}
              </span>
            ))}
          </span>
        ) : (
          <>
            <span>{title}</span>
            {kbd ? <kbd data-slot="kbd">{kbd}</kbd> : null}
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
