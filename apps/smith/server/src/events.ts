/**
 * Ordered server events with a bounded replay window, so a reconnecting
 * EventSource gets what it missed. Event IDs grow across restarts: they start
 * from the clock, so a client never mistakes an old ID for a newer one.
 */

const MAX_REPLAY_EVENTS = 512

export type ServerEventPayload = { type: string; [key: string]: unknown }

export type ServerEvent = {
  readonly sequence: number
  /** Only for this viewer context; absent goes to every context. */
  readonly contextId?: string
  /** The public agent the event is about. */
  readonly agentId?: string
  readonly payload: ServerEventPayload
}

type Listener = (event: ServerEvent) => void

export class EventHub {
  readonly #events: ServerEvent[] = []
  readonly #listeners = new Set<Listener>()
  readonly firstSequence: number
  #sequence: number

  constructor() {
    this.firstSequence = Date.now() * 1000
    this.#sequence = this.firstSequence
  }

  get currentSequence() {
    return this.#sequence
  }

  push(
    payload: ServerEventPayload,
    target: { contextId?: string; agentId?: string } = {}
  ) {
    this.#sequence += 1
    const event: ServerEvent = {
      sequence: this.#sequence,
      ...(target.contextId ? { contextId: target.contextId } : {}),
      ...(target.agentId ? { agentId: target.agentId } : {}),
      payload,
    }
    if (payload.type === "state_sync") {
      // Only the newest state of an agent matters for replay.
      for (let index = this.#events.length - 1; index >= 0; index -= 1) {
        const old = this.#events[index]!
        if (
          old.payload.type === "state_sync" &&
          old.contextId === event.contextId &&
          old.agentId === event.agentId
        ) {
          this.#events.splice(index, 1)
        }
      }
    }
    this.#events.push(event)
    if (this.#events.length > MAX_REPLAY_EVENTS) {
      this.#events.splice(0, this.#events.length - MAX_REPLAY_EVENTS)
    }
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error("[pico] event listener failed:", error)
      }
    }
    return event
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Events after `sequence`, or undefined when the replay window no longer
   * covers it. IDs from before this process started return an empty list:
   * the bootstrap state sync covers them.
   */
  eventsAfter(sequence: number): ServerEvent[] | undefined {
    if (sequence < this.firstSequence) return []
    const first = this.#events[0]?.sequence
    if (first !== undefined && sequence + 1 < first) return undefined
    return this.#events.filter((event) => event.sequence > sequence)
  }
}

/** Events that belong to the selected agent only. */
const SELECTED_AGENT_EVENTS = new Set([
  "state_sync",
  "conversation_delta",
  "user_message",
  "extension_ui_request",
  "extension_error",
])

export function eventMatches(
  event: ServerEvent,
  contextId: string,
  agentId: string | undefined
) {
  if (event.contextId && event.contextId !== contextId) return false
  if (event.agentId && SELECTED_AGENT_EVENTS.has(event.payload.type)) {
    return event.agentId === agentId
  }
  return true
}
