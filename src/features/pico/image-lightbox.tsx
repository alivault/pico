"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ImageLightboxProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageSrc: string | null
  imageAlt: string
  title: string
  description?: string
  emptyState?: React.ReactNode
  className?: string
}

type Point = {
  x: number
  y: number
}

type Transform = {
  scale: number
  x: number
  y: number
}

type GestureState =
  | {
      type: "pan"
      pointerId: number
      startPoint: Point
      startTransform: Transform
    }
  | {
      type: "pinch"
      startDistance: number
      startMidpoint: Point
      startTransform: Transform
    }

const minScale = 1
const maxScale = 5
const initialTransform = { scale: 1, x: 0, y: 0 } satisfies Transform

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getDistance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getMidpoint(first: Point, second: Point) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export function ImageLightbox({
  open,
  onOpenChange,
  imageSrc,
  imageAlt,
  title,
  description,
  emptyState,
  className,
}: ImageLightboxProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const activePointersRef = React.useRef(new Map<number, Point>())
  const clickStartedOnBackdropRef = React.useRef(false)
  const gestureRef = React.useRef<GestureState | null>(null)
  const transformRef = React.useRef<Transform>(initialTransform)
  const [transform, setTransform] = React.useState<Transform>(initialTransform)

  React.useEffect(() => {
    activePointersRef.current.clear()
    gestureRef.current = null
    transformRef.current = initialTransform
    setTransform(initialTransform)
  }, [imageSrc, open])

  function getPointFromEvent(
    event:
      | React.MouseEvent<HTMLDivElement>
      | React.PointerEvent<HTMLDivElement>
      | React.WheelEvent<HTMLDivElement>
  ) {
    return { x: event.clientX, y: event.clientY }
  }

  function getPointRelativeToCenter(point: Point) {
    const container = containerRef.current
    if (!container) return point

    const rect = container.getBoundingClientRect()
    return {
      x: point.x - rect.left - rect.width / 2,
      y: point.y - rect.top - rect.height / 2,
    }
  }

  function clampTransform(nextTransform: Transform) {
    const nextScale = clamp(nextTransform.scale, minScale, maxScale)

    if (nextScale <= minScale) return initialTransform

    const container = containerRef.current
    const image = imageRef.current

    if (!container || !image) {
      return {
        scale: nextScale,
        x: nextTransform.x,
        y: nextTransform.y,
      }
    }

    const maxX = Math.max(
      0,
      (image.offsetWidth * nextScale - container.clientWidth) / 2
    )
    const maxY = Math.max(
      0,
      (image.offsetHeight * nextScale - container.clientHeight) / 2
    )

    return {
      scale: nextScale,
      x: clamp(nextTransform.x, -maxX, maxX),
      y: clamp(nextTransform.y, -maxY, maxY),
    }
  }

  function updateTransform(nextTransform: Transform) {
    const clampedTransform = clampTransform(nextTransform)
    transformRef.current = clampedTransform
    setTransform(clampedTransform)
  }

  function zoomAroundPoint(nextScale: number, screenPoint: Point) {
    const currentTransform = transformRef.current
    const relativePoint = getPointRelativeToCenter(screenPoint)
    const clampedScale = clamp(nextScale, minScale, maxScale)

    if (clampedScale <= minScale) {
      updateTransform(initialTransform)
      return
    }

    const imagePoint = {
      x: (relativePoint.x - currentTransform.x) / currentTransform.scale,
      y: (relativePoint.y - currentTransform.y) / currentTransform.scale,
    }

    updateTransform({
      scale: clampedScale,
      x: relativePoint.x - imagePoint.x * clampedScale,
      y: relativePoint.y - imagePoint.y * clampedScale,
    })
  }

  function startPinchGesture() {
    const pointers = [...activePointersRef.current.values()]
    const firstPointer = pointers[0]
    const secondPointer = pointers[1]

    if (!firstPointer || !secondPointer) return

    gestureRef.current = {
      type: "pinch",
      startDistance: getDistance(firstPointer, secondPointer),
      startMidpoint: getMidpoint(firstPointer, secondPointer),
      startTransform: transformRef.current,
    }
  }

  function startPanGesture(pointerId: number, point: Point) {
    gestureRef.current = {
      type: "pan",
      pointerId,
      startPoint: point,
      startTransform: transformRef.current,
    }
  }

  function finishPointer(pointerId: number) {
    activePointersRef.current.delete(pointerId)

    const remainingPointers = [...activePointersRef.current.entries()]
    const remainingPointer = remainingPointers[0]

    if (activePointersRef.current.size >= 2) {
      startPinchGesture()
    } else if (remainingPointer) {
      startPanGesture(remainingPointer[0], remainingPointer[1])
    } else {
      gestureRef.current = null
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    clickStartedOnBackdropRef.current = event.target === event.currentTarget

    if (!imageSrc) return

    event.currentTarget.setPointerCapture(event.pointerId)

    const point = getPointFromEvent(event)
    activePointersRef.current.set(event.pointerId, point)

    if (activePointersRef.current.size >= 2) {
      startPinchGesture()
    } else {
      startPanGesture(event.pointerId, point)
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!activePointersRef.current.has(event.pointerId)) return

    const point = getPointFromEvent(event)
    activePointersRef.current.set(event.pointerId, point)

    const gesture = gestureRef.current
    const pointers = [...activePointersRef.current.values()]

    if (gesture?.type === "pinch" && pointers.length >= 2) {
      const firstPointer = pointers[0]
      const secondPointer = pointers[1]

      if (!firstPointer || !secondPointer || gesture.startDistance <= 0) return

      const nextDistance = getDistance(firstPointer, secondPointer)
      const nextMidpoint = getMidpoint(firstPointer, secondPointer)
      const nextScale =
        gesture.startTransform.scale * (nextDistance / gesture.startDistance)
      const startRelativeMidpoint = getPointRelativeToCenter(
        gesture.startMidpoint
      )
      const nextRelativeMidpoint = getPointRelativeToCenter(nextMidpoint)
      const imagePoint = {
        x:
          (startRelativeMidpoint.x - gesture.startTransform.x) /
          gesture.startTransform.scale,
        y:
          (startRelativeMidpoint.y - gesture.startTransform.y) /
          gesture.startTransform.scale,
      }
      const clampedScale = clamp(nextScale, minScale, maxScale)

      updateTransform({
        scale: clampedScale,
        x: nextRelativeMidpoint.x - imagePoint.x * clampedScale,
        y: nextRelativeMidpoint.y - imagePoint.y * clampedScale,
      })
      return
    }

    if (gesture?.type === "pan" && gesture.pointerId === event.pointerId) {
      updateTransform({
        scale: gesture.startTransform.scale,
        x: gesture.startTransform.x + point.x - gesture.startPoint.x,
        y: gesture.startTransform.y + point.y - gesture.startPoint.y,
      })
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!imageSrc) return

    event.preventDefault()
    const scaleDelta = Math.exp(-event.deltaY * 0.0015)
    zoomAroundPoint(
      transformRef.current.scale * scaleDelta,
      getPointFromEvent(event)
    )
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!imageSrc) return

    if (transformRef.current.scale > minScale) {
      updateTransform(initialTransform)
    } else {
      zoomAroundPoint(2, getPointFromEvent(event))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "top-0 left-0 h-dvh max-h-dvh w-dvw max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-h-dvh sm:max-w-none dark:ring-0",
          className
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
        ) : null}

        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="border border-white/15 bg-black/55 text-white hover:bg-black/80 hover:text-white"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <div
          ref={containerRef}
          className="flex h-full w-full touch-none items-center justify-center overflow-hidden p-4"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event.pointerId)}
          onPointerCancel={(event) => finishPointer(event.pointerId)}
          onLostPointerCapture={(event) => finishPointer(event.pointerId)}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          onClick={(event) => {
            if (
              clickStartedOnBackdropRef.current &&
              event.target === event.currentTarget
            ) {
              onOpenChange(false)
            }

            clickStartedOnBackdropRef.current = false
          }}
        >
          {imageSrc ? (
            <img
              ref={imageRef}
              src={imageSrc}
              alt={imageAlt}
              draggable={false}
              className="block max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing"
              style={{
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              }}
            />
          ) : (
            <div className="rounded-3xl border border-dashed border-border/70 bg-background/95 px-6 py-10 text-sm text-muted-foreground">
              {emptyState || "Unable to load the image preview."}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
