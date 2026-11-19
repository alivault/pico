import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import type { AgentState } from "@/lib/pico"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import { shortModelLabel, thinkingLabel } from "@/features/pico/model-label"
import {
  shallow,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"

/** The model and reasoning buttons of the composer. */
export const ComposerModelControls = React.memo(function ComposerModelControls({
  agentStore,
  disabled,
  onOpenModelDialog,
  onSelectThinkingLevel,
}: {
  agentStore: PicoStore<AgentState>
  disabled: boolean
  onOpenModelDialog: () => void
  onSelectThinkingLevel: (level: string) => void
}) {
  const { label, thinkingLevel, availableThinkingLevels } = useSelector(
    agentStore,
    (state) => ({
      label: shortModelLabel(state.model, state.availableModels),
      thinkingLevel: state.thinkingLevel,
      availableThinkingLevels: state.availableThinkingLevels,
    }),
    { compare: shallow }
  )

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <TitleTooltip title="Model" kbd={formatShortcutLabel(appShortcut("M"))}>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="max-w-40 min-w-0 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label={`Model: ${label}`}
          disabled={disabled}
          onClick={onOpenModelDialog}
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </TitleTooltip>

      {availableThinkingLevels.length > 0 ? (
        <DropdownMenu>
          <TitleTooltip
            title="Reasoning"
            kbd={`${formatShortcutLabel(appShortcut("R"))} / ${formatShortcutLabel(appShortcut("Shift+R"))}`}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label={`Reasoning: ${thinkingLabel(thinkingLevel)}`}
                  disabled={disabled}
                />
              }
            >
              <span className="truncate">{thinkingLabel(thinkingLevel)}</span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
          </TitleTooltip>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={thinkingLevel}
                onValueChange={(level: string) => {
                  if (disabled) return
                  onSelectThinkingLevel(level)
                }}
              >
                {availableThinkingLevels.map((level) => (
                  <DropdownMenuRadioItem key={level} value={level}>
                    {thinkingLabel(level)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
})
