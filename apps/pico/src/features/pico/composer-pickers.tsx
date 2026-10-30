import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import type { ModelOption, AgentState } from "@/lib/pico"

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
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import { ProfilePicker } from "@/features/pico/agent/profiles"
import { modelLabel } from "@/features/pico/model-label"
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

/**
 * The first word and its space (as "Claude ") when every name starts with it,
 * or "". One name alone keeps its full text.
 */
function sharedFirstWord(names: Array<string>) {
  if (names.length < 2) return ""
  const prefix = `${names[0]!.split(" ")[0]} `
  return names.every(
    (name) => name.startsWith(prefix) && name.length > prefix.length
  )
    ? prefix
    : ""
}

function withoutPrefix(name: string, prefix: string) {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name
}

type ComposerPickerAgentStore = PicoStore<AgentState>

type ModelPickerState = {
  availableModels: Array<ModelOption>
  model?: ModelOption
}

type ThinkingPickerState = {
  availableThinkingLevels: Array<string>
  thinkingLevel: string
}

type ComposerPickersProps = {
  activeAgentId?: string
  modelPickerOpen: boolean
  onModelPickerOpenChange: (open: boolean) => void
  thinkingPickerOpen: boolean
  onThinkingPickerOpenChange: (open: boolean) => void
  modelQuery: string
  onModelQueryChange: (value: string) => void
  contextUsageStore: ComposerContextUsageStore
  agentStore: ComposerPickerAgentStore
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

function useModelPickerState(store: ComposerPickerAgentStore) {
  return useSelector(
    store,
    (source) => ({
      availableModels: source.availableModels,
      model: source.model,
    }),
    { compare: sameModelPickerState }
  )
}

function useThinkingPickerState(store: ComposerPickerAgentStore) {
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
  agentStore,
}: {
  disabled: boolean
  modelQuery: string
  onModelQueryChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSelectModel: (value: string) => void
  open: boolean
  agentStore: ComposerPickerAgentStore
}) {
  const { availableModels, model } = useModelPickerState(agentStore)
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

  // The family word that all models of a provider share, from all models so
  // that the names do not change while the user types.
  const familyPrefixes = (() => {
    const names = new Map<string, Array<string>>()
    for (const entry of availableModels) {
      const provider = entry.provider || "Models"
      names.set(provider, [
        ...(names.get(provider) ?? []),
        entry.name || entry.id,
      ])
    }
    return new Map(
      [...names].map(([provider, list]) => [provider, sharedFirstWord(list)])
    )
  })()

  const selectedModelLabel = withoutPrefix(
    modelLabel(model, availableModels),
    familyPrefixes.get(model?.provider || "Models") ?? ""
  )

  return (
    <Popover open={!disabled && open} onOpenChange={onOpenChange}>
      <TitleTooltip title="Model" kbd={formatShortcutLabel(appShortcut("M"))}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="max-w-full"
              disabled={disabled}
            />
          }
        >
          <span className="truncate">{selectedModelLabel}</span>
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
                          {withoutPrefix(
                            entry.name || entry.id,
                            familyPrefixes.get(provider) ?? ""
                          )}
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
    activeAgentId,
    contextUsageStore,
    disabled,
    agentStore,
    viewerContextId,
  }: {
    activeAgentId?: string
    contextUsageStore: ComposerContextUsageStore
    disabled: boolean
    agentStore: ComposerPickerAgentStore
    viewerContextId: string
  }) {
    const modelProvider = useSelector(
      agentStore,
      (agentState) => agentState.model?.provider
    )

    return (
      <ComposerContextUsageIndicator
        activeAgentId={activeAgentId}
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
  agentStore,
}: {
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onSelectThinkingLevel: (level: string) => void
  open: boolean
  agentStore: ComposerPickerAgentStore
}) {
  const { availableThinkingLevels, thinkingLevel } =
    useThinkingPickerState(agentStore)

  const currentThinkingLabel = thinkingLabel(thinkingLevel)

  return (
    <Popover open={!disabled && open} onOpenChange={onOpenChange}>
      <TitleTooltip
        title="Reasoning"
        kbd={`${formatShortcutLabel(appShortcut("R"))} / ${formatShortcutLabel(appShortcut("Shift+R"))}`}
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

/** The tool profile of a running agent. A draft has its own picker. */
function AgentProfilePicker({
  agentStore,
  viewerContextId,
}: {
  agentStore: ComposerPickerAgentStore
  viewerContextId: string
}) {
  const draft = useSelector(agentStore, (state) => state.draft)
  const agentId = useSelector(agentStore, (state) => state.agentId)
  const cwd = useSelector(agentStore, (state) => state.cwd)
  if (draft || !agentId) return null
  return (
    <ProfilePicker
      cwd={cwd}
      agentId={agentId}
      viewerContextId={viewerContextId}
    />
  )
}

export const ComposerPickers = React.memo(function ComposerPickers({
  activeAgentId,
  modelPickerOpen,
  onModelPickerOpenChange,
  thinkingPickerOpen,
  onThinkingPickerOpenChange,
  modelQuery,
  onModelQueryChange,
  contextUsageStore,
  agentStore,
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
          agentStore={agentStore}
        />

        <ComposerThinkingPicker
          disabled={disabled}
          onOpenChange={handleThinkingPickerOpenChange}
          onSelectThinkingLevel={onSelectThinkingLevel}
          open={thinkingPickerOpen}
          agentStore={agentStore}
        />

        {/* On mobile, the agent menu has the tool profile. */}
        <div className="hidden md:contents">
          <AgentProfilePicker
            agentStore={agentStore}
            viewerContextId={viewerContextId}
          />
        </div>
      </div>

      <ComposerContextUsageIndicatorHost
        activeAgentId={activeAgentId}
        contextUsageStore={contextUsageStore}
        disabled={disabled}
        agentStore={agentStore}
        viewerContextId={viewerContextId}
      />
    </div>
  )
})
