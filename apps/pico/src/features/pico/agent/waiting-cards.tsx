import * as React from "react"
import { MessageCircleQuestionIcon, SquareTerminalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The cards in the conversation that wait for the user (a question, or an
 * interactive terminal), with whether each one is in view. The chip above
 * the composer uses this to lead the user back to a card that scrolled out
 * of view.
 */
export type WaitingCardKind = "question" | "terminal"

type WaitingCard = {
  element: HTMLElement
  inView: boolean
  kind: WaitingCardKind
}

const waitingCards = new Map<string, WaitingCard>()
const waitingCardListeners = new Set<() => void>()

function notifyWaitingCards() {
  for (const listener of waitingCardListeners) listener()
}

function subscribeWaitingCards(listener: () => void) {
  waitingCardListeners.add(listener)
  return () => {
    waitingCardListeners.delete(listener)
  }
}

export function waitingCardKey(
  viewerContextId: string,
  agentId: string | undefined,
  id: string
) {
  return `${waitingCardPrefix(viewerContextId, agentId)}${id}`
}

function waitingCardPrefix(viewerContextId: string, agentId?: string) {
  return `${viewerContextId}\n${agentId ?? ""}\n`
}

/** Track a card while it waits for the user; give `undefined` when it does not. */
export function useTrackWaitingCard(
  key: string | undefined,
  kind: WaitingCardKind
) {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (!key || !element) return
    const entry: WaitingCard = { element, inView: true, kind }
    waitingCards.set(key, entry)
    notifyWaitingCards()
    const observer = new IntersectionObserver(([record]) => {
      if (!record) return
      entry.inView = record.isIntersecting
      notifyWaitingCards()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (waitingCards.get(key) === entry) waitingCards.delete(key)
      notifyWaitingCards()
    }
  }, [key, element, kind])
  return setElement
}

function offscreenWaitingCard(prefix: string) {
  for (const [key, card] of waitingCards) {
    if (key.startsWith(prefix) && !card.inView) return card
  }
  return null
}

const CHIP_TEXT: Record<WaitingCardKind, string> = {
  question: "The agent waits for your answer",
  terminal: "A terminal waits for you",
}

/**
 * Shows above the composer when a card that waits for the user is out of
 * view. A click scrolls to the card and focuses its first field.
 */
export function WaitingCardChip({
  agentId,
  viewerContextId,
}: {
  agentId?: string
  viewerContextId: string
}) {
  const prefix = waitingCardPrefix(viewerContextId, agentId)
  const card = React.useSyncExternalStore(subscribeWaitingCards, () =>
    offscreenWaitingCard(prefix)
  )
  if (!card) return null
  const { element } = card
  const show = () => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    // The message scroller follows the output or stays anchored to the last
    // message, and scrolls back on the next resize. A wheel event is its
    // signal that the reader scrolls, so it stops before we scroll.
    element
      .closest("[data-slot='message-scroller-viewport']")
      ?.dispatchEvent(new WheelEvent("wheel", { bubbles: true }))
    element.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    })
    // For a terminal, this is xterm's input textarea.
    element
      .querySelector<HTMLElement>("input, textarea, button:not([disabled])")
      ?.focus({ preventScroll: true })
  }
  const Icon =
    card.kind === "terminal" ? SquareTerminalIcon : MessageCircleQuestionIcon
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mb-1.5 h-7 max-w-full rounded-full border-primary/40 bg-background/90 px-3 text-xs font-normal text-primary shadow-sm backdrop-blur hover:text-primary"
      onClick={show}
    >
      <Icon className="shrink-0" />
      <span className="truncate">{CHIP_TEXT[card.kind]}</span>
    </Button>
  )
}
