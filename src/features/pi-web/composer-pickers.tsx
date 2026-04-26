import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import type { ModelOption, SessionState } from "@/lib/pi-web"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ComposerContextUsageIndicator } from "@/features/pi-web/composer-context-usage-indicator"

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

type ComposerPickersProps = {
  modelPickerOpen: boolean
  onModelPickerOpenChange: (open: boolean) => void
  thinkingPickerOpen: boolean
  onThinkingPickerOpenChange: (open: boolean) => void
  modelQuery: string
  onModelQueryChange: (value: string) => void
  availableModels: Array<ModelOption>
  model?: ModelOption
  thinkingLevel: string
  availableThinkingLevels: Array<string>
  contextUsage?: SessionState["contextUsage"]
  disabled?: boolean
  onSelectModel: (value: string) => void
  onSelectThinkingLevel: (level: string) => void
}

export const ComposerPickers = React.memo(function ComposerPickers({
  modelPickerOpen,
  onModelPickerOpenChange,
  thinkingPickerOpen,
  onThinkingPickerOpenChange,
  modelQuery,
  onModelQueryChange,
  availableModels,
  model,
  thinkingLevel,
  availableThinkingLevels,
  contextUsage,
  disabled = false,
  onSelectModel,
  onSelectThinkingLevel,
}: ComposerPickersProps) {
  const filteredModels = (() => {
    const normalizedQuery = modelQuery.trim().toLowerCase()
    const modelOptions =
      availableModels.length > 0 ? availableModels : model ? [model] : []
    const nextModels = [...modelOptions].sort(
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

  const handleModelPickerOpenChange = (open: boolean) => {
    if (disabled && open) return
    onModelPickerOpenChange(open)
  }

  const handleThinkingPickerOpenChange = (open: boolean) => {
    if (disabled && open) return
    onThinkingPickerOpenChange(open)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-b-[18px] bg-muted/15 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Popover
          open={!disabled && modelPickerOpen}
          onOpenChange={handleModelPickerOpenChange}
        >
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="max-w-full"
                disabled={disabled}
              />
            }
          >
            <span className="truncate">{model?.name || "Select model"}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </PopoverTrigger>
          <PopoverContent className="w-88 p-1" side="top" align="start">
            <div className="p-1 pb-0">
              <input
                value={modelQuery}
                onChange={(event) => onModelQueryChange(event.target.value)}
                placeholder="Search models"
                className="h-8 w-full rounded-lg border border-input/30 bg-input/30 px-3 text-sm outline-hidden"
              />
            </div>
            <div className="no-scrollbar max-h-72 overflow-x-hidden overflow-y-auto p-1">
              {groupedModels.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No models match your search.
                </div>
              ) : null}
              {groupedModels.map(([provider, items]) => (
                <div key={provider} className="overflow-hidden p-1">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {provider}
                  </div>
                  {items.map((entry) => {
                    const value = `${entry.provider}/${entry.id}`
                    const active = value === currentModelValue(model)
                    return (
                      <button
                        key={value}
                        type="button"
                        className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-muted hover:text-foreground"
                        onClick={() => {
                          if (disabled) return
                          onSelectModel(value)
                          onModelPickerOpenChange(false)
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
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover
          open={!disabled && thinkingPickerOpen}
          onOpenChange={handleThinkingPickerOpenChange}
        >
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="max-w-full"
                disabled={disabled}
              />
            }
          >
            <span className="truncate">{thinkingLabel(thinkingLevel)}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </PopoverTrigger>
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
                        onThinkingPickerOpenChange(false)
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
      </div>

      <ComposerContextUsageIndicator contextUsage={contextUsage} />
    </div>
  )
})
