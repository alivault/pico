import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"

import type { AgentState } from "@/lib/pico"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  ContextUsageBars,
  ContextUsageQuotaDetails,
  ContextUsageRings,
  ContextUsageWindowDetails,
  useContextUsageView,
  type ComposerContextUsageStore,
} from "@/features/pico/context-usage"
import { useMachineReadOnly } from "@/features/pico/machine-store"
import { picoQueryKeys } from "@/features/pico/query-keys"

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

/**
 * The context ring of the composer, with the 5h and weekly usage rings when
 * the provider tells them. Its menu shows the usage details. It is not shown
 * when the agent has no usage yet.
 */
export const ComposerContextUsage = React.memo(function ComposerContextUsage({
  activeAgentId,
  agentStore,
  contextUsageStore,
  viewerContextId,
}: {
  activeAgentId?: string
  agentStore: PicoStore<AgentState>
  contextUsageStore: ComposerContextUsageStore
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const machineReadOnly = useMachineReadOnly()
  const modelProvider = useSelector(
    agentStore,
    (state) => state.model?.provider
  )
  const view = useContextUsageView({
    activeAgentId,
    contextUsageStore,
    disabled: machineReadOnly,
    modelProvider,
    viewerContextId,
  })
  if (!view) return null

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // The session and weekly usage change with each request, so the
        // menu gets them again when it opens.
        if (open)
          void queryClient.invalidateQueries({
            queryKey: picoQueryKeys.providerUsageAll(),
          })
      }}
    >
      <TitleTooltip
        title={
          view.percent == null
            ? "Context usage"
            : `${view.displayPercent} of the context used`
        }
        // The labeled bars say the same, so the tooltip shows only for the
        // rings, where the row has no room for the bars.
        openWhen={(trigger) => {
          const bars = trigger.querySelector("[data-usage-bars]")
          return !bars || getComputedStyle(bars).display === "none"
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              // Labeled bars when the row below the composer has room,
              // rings when it does not (see its container in the composer).
              className="h-7 shrink-0 cursor-pointer px-0 @[34rem]/composer-controls:px-2"
              aria-label={view.ariaLabel}
            />
          }
        >
          <ContextUsageRings
            view={view}
            className="size-7 @[34rem]/composer-controls:hidden"
          />
          <ContextUsageBars
            view={view}
            className="hidden @[34rem]/composer-controls:flex"
          />
        </DropdownMenuTrigger>
      </TitleTooltip>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuItem
          className="block"
          onClick={() =>
            emitPicoEvent("pico:open-agent-settings", {
              page: "agent-context",
            })
          }
        >
          <ContextUsageWindowDetails view={view} />
        </DropdownMenuItem>
        <ContextUsageQuotaDetails view={view} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
