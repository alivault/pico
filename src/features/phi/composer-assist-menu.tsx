import { CheckIcon } from "lucide-react"

import type { CompletionItem } from "@/lib/phi/api"

import type { SlashCommandDescriptor } from "@/features/phi/composer-utils"
import type {
  ComposerSlashMenuState,
  ComposerVisibleCompletion,
} from "@/features/phi/use-composer-assist"

import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

function visibleCompletionLabel(item: CompletionItem) {
  return item.label || item.value
}

type ComposerAssistMenuProps = {
  visibleCompletion: ComposerVisibleCompletion | null
  slashMenuState: ComposerSlashMenuState | null
  slashSelectionIndex: number
  onHoverCompletion: (index: number) => void
  onApplyCompletion: (item: CompletionItem) => void
  onHoverSlashCommand: (index: number) => void
  onApplySlashSuggestion: (command: SlashCommandDescriptor) => void
}

export function ComposerAssistMenu({
  visibleCompletion,
  slashMenuState,
  slashSelectionIndex,
  onHoverCompletion,
  onApplyCompletion,
  onHoverSlashCommand,
  onApplySlashSuggestion,
}: ComposerAssistMenuProps) {
  if (!visibleCompletion && !slashMenuState) {
    return null
  }

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
      <div className="max-h-64 overflow-y-auto">
        {visibleCompletion ? (
          <div className="flex flex-col gap-1">
            {visibleCompletion.items.map((item, index) => {
              const selected = index === visibleCompletion.selectedIndex
              return (
                <button
                  key={`${item.value}:${item.description || item.label}`}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    selected ? "bg-muted" : "hover:bg-muted/70"
                  )}
                  onMouseEnter={() => {
                    onHoverCompletion(index)
                  }}
                  onClick={() => {
                    onApplyCompletion(item)
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {visibleCompletionLabel(item)}
                    </span>
                    {item.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? <CheckIcon className="mt-0.5 shrink-0" /> : null}
                </button>
              )
            })}
            <Separator />
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {visibleCompletion.query.kind === "file-reference"
                ? "@ file references"
                : "Path suggestions"}
            </div>
          </div>
        ) : slashMenuState ? (
          <div className="flex flex-col gap-1">
            {slashMenuState.commands.map((command, index) => {
              const selected = index === slashSelectionIndex
              return (
                <button
                  key={command.name}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    selected ? "bg-muted" : "hover:bg-muted/70"
                  )}
                  onMouseEnter={() => {
                    onHoverSlashCommand(index)
                  }}
                  onClick={() => {
                    onApplySlashSuggestion(command)
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      /{command.name}
                    </span>
                    {command.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {command.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? <CheckIcon className="mt-0.5 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
