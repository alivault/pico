import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import type { ModelOption, SessionState } from "@/lib/pico"

import { Button } from "@/components/ui/button"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  ComposerContextUsageIndicator,
  type ComposerContextUsageStore,
} from "@/features/pico/composer-context-usage-indicator"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"

function thinkingLabel(level: string) {
  switch (level) {
    case "off":
      return "Off"
    case "minimal":
      return "Minimal"
    case "low":
      return "Low"
    case "medium":
      return "Medium"
    case "high":
      return "High"
    case "xhigh":
      return "Extra High"
    default:
      return level
  }
}

function currentModelValue(model?: ModelOption) {
  return model ? `${model.provider}/${model.id}` : ""
}

type ComposerPickerSessionStore = PicoStore<SessionState>

type ModelPickerState = {
  availableModels: Array<ModelOption>
  model?: ModelOption
}

type ThinkingPickerState = {
  availableThinkingLevels: Array<string>
  thinkingLevel: string
}

type ComposerPickersProps = {
  activeSessionId?: string
  modelPickerOpen: boolean
  onModelPickerOpenChange: (open: boolean) => void
  thinkingPickerOpen: boolean
  onThinkingPickerOpenChange: (open: boolean) => void
  modelQuery: string
  onModelQueryChange: (value: string) => void
  contextUsageStore: ComposerContextUsageStore
  sessionStore: ComposerPickerSessionStore
  disabled?: boolean
  viewerContextId: string
  onSelectModel: (value: string) => void
  onSelectThinkingLevel: (level: string) => void
}

function sameModelPickerState(left: ModelPickerState, right: ModelPickerState) {
  return (
    left.model === right.model && left.availableModels === right.availableModels
  )
}

function sameThinkingPickerState(
  left: ThinkingPickerState,
  right: ThinkingPickerState
) {
  return (
    left.thinkingLevel === right.thinkingLevel &&
    left.availableThinkingLevels === right.availableThinkingLevels
  )
}

function useModelPickerState(store: ComposerPickerSessionStore) {
  return useSelector(
    store,
    (source) => ({
      availableModels: source.availableModels,
      model: source.model,
    }),
    { compare: sameModelPickerState }
  )
}

function useThinkingPickerState(store: ComposerPickerSessionStore) {
  return useSelector(
    store,
    (source) => ({
      availableThinkingLevels: source.availableThinkingLevels,
      thinkingLevel: source.thinkingLevel,
    }),
    { compare: sameThinkingPickerState }
  )
}

const ComposerModelPicker = React.memo(function ComposerModelPicker({
  disabled,
  modelQuery,
  onModelQueryChange,
  onOpenChange,
  onSelectModel,
  open,
  sessionStore,
}: {
  disabled: boolean
  modelQuery: string
  onModelQueryChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSelectModel: (value: string) => void
  open: boolean
  sessionStore: ComposerPickerSessionStore
}) {
  const { availableModels, model } = useModelPickerState(sessionStore)
  const filteredModels = (() => {
    const normalizedQuery = modelQuery.trim().toLowerCase()
    const modelOptions =
      availableModels.length > 0 ? availableModels : model ? [model] : []
    const nextModels = modelOptions.toSorted(
      (left, right) =>
        (left.provider || "").localeCompare(right.provider || "") ||
        (left.name || left.id).localeCompare(right.name || right.id)
    )

    if (!normalizedQuery) return nextModels

    return nextModels.filter((entry) => {
      const haystack =
        `${entry.provider || ""} ${entry.name || ""} ${entry.id}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  })()

  const groupedModels = (() => {
    const groups = new Map<string, Array<ModelOption>>()
    for (const entry of filteredModels) {
      const provider = entry.provider || "Models"
      const current = groups.get(provider) ?? []
      current.push(entry)
      groups.set(provider, current)
    }
    return [...groups.entries()]
  })()

  const modelLabel = model?.name || "Select model"

  return (
    <Popover open={!disabled && open} onOpenChange={onOpenChange}>
      <TitleTooltip title="Model" kbd={formatShortcutLabel("Control+M")}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="max-w-full"
              disabled={disabled}
            />
          }
        >
          <span className="truncate">{modelLabel}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
      </TitleTooltip>
      <PopoverContent className="w-88 p-0" side="top" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={modelQuery}
            onValueChange={onModelQueryChange}
            placeholder="Search models"
          />
          <CommandList>
            <CommandEmpty>No models match your search.</CommandEmpty>
            {groupedModels.map(([provider, items]) => (
              <CommandGroup key={provider} heading={provider}>
                {items.map((entry) => {
                  const value = `${entry.provider}/${entry.id}`
                  const active = value === currentModelValue(model)
                  return (
                    <CommandItem
                      key={value}
                      value={`${entry.provider || ""} ${entry.name || entry.id} ${entry.id}`}
                      onSelect={() => {
                        if (disabled) return
                        onSelectModel(value)
                        onOpenChange(false)
                      }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">
                          {entry.name || entry.id}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.provider}/{entry.id}
                        </span>
                      </div>
                      {active ? <CheckIcon /> : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})

const ComposerContextUsageIndicatorHost = React.memo(
  function ComposerContextUsageIndicatorHost({
    activeSessionId,
    contextUsageStore,
    disabled,
    sessionStore,
    viewerContextId,
  }: {
    activeSessionId?: string
    contextUsageStore: ComposerContextUsageStore
    disabled: boolean
    sessionStore: ComposerPickerSessionStore
    viewerContextId: string
  }) {
    const isDraft = useSelector(
      sessionStore,
      (sessionState) => sessionState.draft
    )
    const modelProvider = useSelector(
      sessionStore,
      (sessionState) => sessionState.model?.provider
    )

    if (isDraft) return null

    return (
      <ComposerContextUsageIndicator
        activeSessionId={activeSessionId}
        contextUsageStore={contextUsageStore}
        disabled={disabled}
        modelProvider={modelProvider}
        viewerContextId={viewerContextId}
      />
    )
  }
)

const ComposerThinkingPicker = React.memo(function ComposerThinkingPicker({
  disabled,
  onOpenChange,
  onSelectThinkingLevel,
  open,
  sessionStore,
}: {
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onSelectThinkingLevel: (level: string) => void
  open: boolean
  sessionStore: ComposerPickerSessionStore
}) {
  const { availableThinkingLevels, thinkingLevel } =
    useThinkingPickerState(sessionStore)

  const currentThinkingLabel = thinkingLabel(thinkingLevel)

  return (
    <Popover open={!disabled && open} onOpenChange={onOpenChange}>
      <TitleTooltip
        title="Reasoning"
        kbd={`${formatShortcutLabel("Control+R")} / ${formatShortcutLabel("Control+Shift+R")}`}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="max-w-full"
              disabled={disabled}
            />
          }
        >
          <span className="truncate">{currentThinkingLabel}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
      </TitleTooltip>
      <PopoverContent className="w-64 p-0" side="top" align="start">
        <Command>
          <CommandList>
            <CommandGroup heading="Reasoning">
              {availableThinkingLevels.map((level) => (
                <CommandItem
                  key={level}
                  value={level}
                  onSelect={() => {
                    if (disabled) return
                    onSelectThinkingLevel(level)
                    onOpenChange(false)
                  }}
                >
                  <span className="flex-1">{thinkingLabel(level)}</span>
                  {thinkingLevel === level ? <CheckIcon /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})

export const ComposerPickers = React.memo(function ComposerPickers({
  activeSessionId,
  modelPickerOpen,
  onModelPickerOpenChange,
  thinkingPickerOpen,
  onThinkingPickerOpenChange,
  modelQuery,
  onModelQueryChange,
  contextUsageStore,
  sessionStore,
  disabled = false,
  viewerContextId,
  onSelectModel,
  onSelectThinkingLevel,
}: ComposerPickersProps) {
  const handleModelPickerOpenChange = (open: boolean) => {
    if (disabled && open) return
    onModelPickerOpenChange(open)
  }

  const handleThinkingPickerOpenChange = (open: boolean) => {
    if (disabled && open) return
    onThinkingPickerOpenChange(open)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-b-[18px] bg-muted/15 p-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ComposerModelPicker
          disabled={disabled}
          modelQuery={modelQuery}
          onModelQueryChange={onModelQueryChange}
          onOpenChange={handleModelPickerOpenChange}
          onSelectModel={onSelectModel}
          open={modelPickerOpen}
          sessionStore={sessionStore}
        />

        <ComposerThinkingPicker
          disabled={disabled}
          onOpenChange={handleThinkingPickerOpenChange}
          onSelectThinkingLevel={onSelectThinkingLevel}
          open={thinkingPickerOpen}
          sessionStore={sessionStore}
        />
      </div>

      <ComposerContextUsageIndicatorHost
        activeSessionId={activeSessionId}
        contextUsageStore={contextUsageStore}
        disabled={disabled}
        sessionStore={sessionStore}
        viewerContextId={viewerContextId}
      />
    </div>
  )
})
