import { CheckIcon, ChevronDownIcon } from "lucide-react"

import type { ModelOption, SessionState } from "@/lib/pi-web"

import { Button } from "@/components/ui/button"
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

export function ComposerPickers({
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
    const nextModels = [...availableModels].sort(
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
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
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
}
