import * as React from "react"
import {
  ArrowBigUpIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronUpIcon,
  CommandIcon,
  OptionIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

type ShortcutModifier = "command" | "control" | "option" | "shift"

type ShortcutArrow = "down" | "left" | "right" | "up"

type ShortcutToken =
  | { type: "modifier"; modifier: ShortcutModifier; label: string }
  | { type: "arrow"; arrow: ShortcutArrow; label: string }
  | { type: "separator"; value: "/" }
  | { type: "text"; value: string }

const modifierTokenPattern =
  /(Shift|Control|Ctrl|Command|Cmd|Meta|Alt|Option|⇧|⌃|⌘|⌥|↑|↓|←|→|\s+|\/|\+)/gi

const modifierLabels: Record<ShortcutModifier, string> = {
  command: "Command",
  control: "Control",
  option: "Option",
  shift: "Shift",
}

const arrowLabels: Record<ShortcutArrow, string> = {
  down: "Arrow down",
  left: "Arrow left",
  right: "Arrow right",
  up: "Arrow up",
}

function getShortcutModifier(value: string): ShortcutModifier | null {
  const normalized = value.toLowerCase()

  if (value === "⌘" || normalized === "command") return "command"
  if (normalized === "cmd" || normalized === "meta") return "command"
  if (value === "⌃" || normalized === "control") return "control"
  if (normalized === "ctrl") return "control"
  if (value === "⌥" || normalized === "option") return "option"
  if (normalized === "alt") return "option"
  if (value === "⇧" || normalized === "shift") return "shift"

  return null
}

function getShortcutArrow(value: string): ShortcutArrow | null {
  if (value === "↑") return "up"
  if (value === "↓") return "down"
  if (value === "←") return "left"
  if (value === "→") return "right"

  return null
}

function tokenizeShortcut(value: string) {
  const rawTokens = value
    .split(modifierTokenPattern)
    .filter((token) => token.length > 0)

  const shortcutTokens: ShortcutToken[] = []

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index]!
    const modifier = getShortcutModifier(token)
    const arrow = getShortcutArrow(token)

    if (modifier) {
      shortcutTokens.push({
        type: "modifier",
        modifier,
        label: modifierLabels[modifier],
      })
      continue
    }

    if (arrow) {
      shortcutTokens.push({
        type: "arrow",
        arrow,
        label: arrowLabels[arrow],
      })
      continue
    }

    if (token === "/") {
      shortcutTokens.push({ type: "separator", value: token })
      continue
    }

    if (token === "+") {
      const previousModifier = getShortcutModifier(rawTokens[index - 1] ?? "")
      const nextModifier = getShortcutModifier(rawTokens[index + 1] ?? "")
      if (previousModifier || nextModifier) continue
    }

    if (token.trim().length === 0) continue

    shortcutTokens.push({ type: "text", value: token })
  }

  return shortcutTokens
}

function ShortcutModifierIcon({ modifier }: { modifier: ShortcutModifier }) {
  const className = "size-[10px] shrink-0 stroke-[2.4]"

  if (modifier === "shift") {
    return <ArrowBigUpIcon aria-hidden="true" className={className} />
  }

  if (modifier === "control") {
    return <ChevronUpIcon aria-hidden="true" className={className} />
  }

  if (modifier === "command") {
    return <CommandIcon aria-hidden="true" className={className} />
  }

  return <OptionIcon aria-hidden="true" className={className} />
}

function ShortcutArrowIcon({ arrow }: { arrow: ShortcutArrow }) {
  const className = "size-[10px] shrink-0 stroke-[2.4]"

  if (arrow === "up") {
    return <ArrowUpIcon aria-hidden="true" className={className} />
  }

  if (arrow === "down") {
    return <ArrowDownIcon aria-hidden="true" className={className} />
  }

  if (arrow === "left") {
    return <ArrowLeftIcon aria-hidden="true" className={className} />
  }

  return <ArrowRightIcon aria-hidden="true" className={className} />
}

function ShortcutText({ value }: { value: string }) {
  const tokens = tokenizeShortcut(value)

  if (tokens.length === 0) return null

  return tokens.map((token, index) => {
    if (token.type === "modifier") {
      return (
        <React.Fragment key={`${token.modifier}-${index}`}>
          <ShortcutModifierIcon modifier={token.modifier} />
          <span className="sr-only">{token.label}</span>
        </React.Fragment>
      )
    }

    if (token.type === "arrow") {
      return (
        <React.Fragment key={`${token.arrow}-${index}`}>
          <ShortcutArrowIcon arrow={token.arrow} />
          <span className="sr-only">{token.label}</span>
        </React.Fragment>
      )
    }

    if (token.type === "separator") {
      return (
        <span key={`separator-${index}`} aria-hidden="true" className="mx-0.5">
          {token.value}
        </span>
      )
    }

    return <span key={`text-${index}`}>{token.value}</span>
  })
}

function KeyboardShortcutContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 align-middle leading-none",
        className
      )}
    >
      {React.Children.map(children, (child) => {
        if (typeof child === "string" || typeof child === "number") {
          return <ShortcutText value={String(child)} />
        }

        return child
      })}
    </span>
  )
}

function Kbd({ className, children, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground data-[active=true]:border-primary/40 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <KeyboardShortcutContent>{children}</KeyboardShortcutContent>
    </kbd>
  )
}

export { Kbd, KeyboardShortcutContent }
