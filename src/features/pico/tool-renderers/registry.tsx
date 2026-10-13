import * as React from "react"

import type { ToolBlock } from "@/lib/pico"

/**
 * Renderers for tool results, by tool name.
 *
 * - `Card` replaces the whole tool card. It is always open, for tools whose
 *   result the user must see or act on (questions, diagrams, child sessions).
 * - `Body` replaces only the body of the collapsible tool card.
 * - `summary` replaces the one-line summary in the card header.
 */
export type ToolRenderer = {
  Card?: React.ComponentType<ToolRendererProps>
  Body?: React.ComponentType<ToolRendererProps>
  summary?: (block: ToolBlock) => string | undefined
}

export type ToolRendererProps = {
  block: ToolBlock
}

const renderers = new Map<string, ToolRenderer>()

export function registerToolRenderer(name: string, renderer: ToolRenderer) {
  renderers.set(name, renderer)
}

export function toolRenderer(name: string | undefined) {
  return name ? renderers.get(name) : undefined
}

/** The session that a conversation view shows, for tool renderers that call the server. */
export type ToolRenderContextValue = {
  viewerContextId: string
  sessionId?: string
  cwd?: string
}

export const ToolRenderContext = React.createContext<ToolRenderContextValue>({
  viewerContextId: "",
})

export function useToolRenderContext() {
  return React.useContext(ToolRenderContext)
}

/** Tool arguments as an object, also when they arrive as JSON text. */
export function toolArgs(block: ToolBlock): Record<string, unknown> {
  const args = block.args
  if (args && typeof args === "object") return args as Record<string, unknown>
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as unknown
      if (parsed && typeof parsed === "object")
        return parsed as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

export function toolDetails<T>(block: ToolBlock): Partial<T> {
  return block.details && typeof block.details === "object"
    ? (block.details as Partial<T>)
    : {}
}
