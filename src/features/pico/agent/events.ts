import * as React from "react"

/**
 * Small window events that connect parts of the client that do not share
 * state: the event stream, tool cards, the Agent panel, and the app shell.
 */
export type PicoEventMap = {
  /** A session's Agent panel state changed on the server. */
  "pico:session-extensions": { sessionId: string; kind?: string }
  /** Select a session, for example a child session. */
  "pico:open-session": { sessionId: string }
  /** Show a right sidebar tab. */
  "pico:open-sidebar-tab": { tab: "agent" | "preview" | "review" }
}

export function emitPicoEvent<K extends keyof PicoEventMap>(
  name: K,
  detail: PicoEventMap[K]
) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function usePicoEvent<K extends keyof PicoEventMap>(
  name: K,
  handler: (detail: PicoEventMap[K]) => void
) {
  const onEvent = React.useEffectEvent(handler)
  React.useEffect(() => {
    const listener = (event: Event) => {
      onEvent((event as CustomEvent<PicoEventMap[K]>).detail)
    }
    window.addEventListener(name, listener)
    return () => window.removeEventListener(name, listener)
  }, [name])
}
