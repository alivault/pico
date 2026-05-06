import type * as React from "react"

export function setDerivedScrollState<T>(
  setState: React.Dispatch<React.SetStateAction<T>>,
  nextState: T
) {
  setState((current) => (Object.is(current, nextState) ? current : nextState))
}

export function hasScrolledContent(scrollElement: HTMLElement | null) {
  return Boolean(scrollElement && scrollElement.scrollTop > 0)
}

export function getStuckScrollTriggerValue({
  getValue,
  scrollElement,
  selector,
}: {
  getValue: (element: HTMLElement) => string
  scrollElement: HTMLElement | null
  selector: string
}) {
  if (!scrollElement || scrollElement.scrollTop <= 0) return ""

  const containerTop = scrollElement.getBoundingClientRect().top
  const triggers = Array.from(
    scrollElement.querySelectorAll<HTMLElement>(selector)
  )

  for (const trigger of triggers) {
    const rect = trigger.getBoundingClientRect()
    if (rect.top <= containerTop + 1 && rect.bottom > containerTop + 1) {
      return getValue(trigger)
    }
  }

  return ""
}
