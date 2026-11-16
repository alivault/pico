import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"
import { resizeRailPrimaryInteractiveClass } from "@/components/ui/resize-rail"
import {
  getSidebarVerticalResizeCursor,
  installGlobalResizeCursor,
} from "@/hooks/use-sidebar-resize"
import { useSidebarMachines } from "@/features/pico/machines"
import {
  OtherMachineAgentSource,
  SplitAgentList,
} from "@/features/pico/sidebar"
import { MachineProvider } from "@/lib/pico/machine-context"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"
import { cn } from "@/lib/utils"

/**
 * The split layout of the sidebar ("Projects and agents"), as in Herdr:
 * the projects of all machines at the top, one list of the agents of all
 * machines at the bottom, and a divider between them. Each part scrolls.
 * A drag on the divider changes the part of the height that the projects
 * get; the window keeps it.
 */

// Stored name: do not change.
const SPLIT_RATIO_STORAGE_KEY = "pico-sidebar-split-ratio"
const DEFAULT_SPLIT_RATIO = 0.4
// The smallest height of each part, in pixels.
const MIN_PART_HEIGHT = 96

function readSplitRatio() {
  const value = Number(safeLocalStorageGetItem(SPLIT_RATIO_STORAGE_KEY))
  return Number.isFinite(value) && value > 0 && value < 1
    ? value
    : DEFAULT_SPLIT_RATIO
}

/** The height of the projects part, in the limits of the container. */
function clampTopHeight(height: number, containerHeight: number) {
  const min = Math.min(MIN_PART_HEIGHT, containerHeight / 2)
  return Math.min(containerHeight - min, Math.max(min, height))
}

export function SplitSidebarBody({
  shownMachineId,
  projects,
}: {
  shownMachineId: string
  /** The machine groups with their project rows. */
  projects: React.ReactNode
}) {
  const { isMobile } = useSidebar()
  const machines = useSidebarMachines(shownMachineId)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = React.useState(0)
  const [ratio, setRatio] = React.useState(readSplitRatio)
  const [cursor] = React.useState(getSidebarVerticalResizeCursor)

  // Measure the container, also when it shows after it was hidden (for
  // example in the mobile sheet).
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () =>
      setContainerHeight(container.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // On a phone, the parts keep the default heights: no drag.
  const usedRatio = isMobile ? DEFAULT_SPLIT_RATIO : ratio
  const topHeight =
    containerHeight > 0
      ? clampTopHeight(usedRatio * containerHeight, containerHeight)
      : undefined

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile || event.button !== 0 || !containerHeight) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = topHeight ?? usedRatio * containerHeight
    const height = containerHeight
    let latestRatio = startHeight / height
    const cleanupCursor = installGlobalResizeCursor(cursor)
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"

    const onPointerMove = (moveEvent: PointerEvent) => {
      const next = clampTopHeight(
        startHeight + moveEvent.clientY - startY,
        height
      )
      latestRatio = next / height
      setRatio(latestRatio)
    }
    const onPointerUp = () => {
      safeLocalStorageSetItem(SPLIT_RATIO_STORAGE_KEY, String(latestRatio))
      cleanupCursor()
      document.body.style.userSelect = previousUserSelect
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
      document.removeEventListener("pointercancel", onPointerUp)
    }
    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("pointercancel", onPointerUp)
  }

  const resetRatio = () => {
    setRatio(DEFAULT_SPLIT_RATIO)
    safeLocalStorageSetItem(
      SPLIT_RATIO_STORAGE_KEY,
      String(DEFAULT_SPLIT_RATIO)
    )
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div
        className="no-scrollbar min-h-0 shrink-0 overflow-auto"
        style={{ height: topHeight ?? `${usedRatio * 100}%` }}
      >
        {projects}
      </div>
      <div className="relative shrink-0 border-t border-sidebar-border/70">
        {isMobile ? null : (
          <div
            role="separator"
            aria-label="Resize projects and agents"
            aria-orientation="horizontal"
            title="Drag to resize. Double-click to reset."
            style={{ cursor }}
            className={cn(
              "absolute inset-x-0 top-0 z-10 h-2 -translate-y-1/2 touch-none bg-transparent after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-transparent",
              resizeRailPrimaryInteractiveClass
            )}
            onPointerDown={startResize}
            onDoubleClick={resetRatio}
          />
        )}
      </div>
      <SplitAgentList shownMachineId={shownMachineId} machines={machines} />
      {/* The agents of the other machines, from their summaries. */}
      {machines
        .filter((machine) => machine.id !== shownMachineId)
        .map((machine) => (
          <MachineProvider key={machine.id} machineId={machine.id}>
            <OtherMachineAgentSource machine={machine} />
          </MachineProvider>
        ))}
    </div>
  )
}
