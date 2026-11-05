import * as React from "react"
import { CheckIcon } from "lucide-react"

import type { AgentState, ModelOption } from "@/lib/pico"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMachineReadOnly } from "@/features/pico/machine-store"
import { modelFamilyPrefixes, withoutPrefix } from "@/features/pico/model-label"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"

export type AppShellModelDialogHandle = {
  open: () => void
}

const TITLE = "Model"
const DESCRIPTION = "Search the models and press Enter to use one."

function sameModelState(
  left: Pick<AgentState, "availableModels" | "model">,
  right: Pick<AgentState, "availableModels" | "model">
) {
  return (
    left.model === right.model && left.availableModels === right.availableModels
  )
}

/** A searchable list of the models, grouped by provider. Opens with Mod+M. */
export function AppShellModelDialog({
  agentStore,
  openRef,
  onSelectModel,
  ref,
}: {
  agentStore: PicoStore<AgentState>
  /** True while the dialog is open, so the app shortcuts stay off. */
  openRef: React.RefObject<boolean>
  onSelectModel: (value: string) => void
  ref?: React.Ref<AppShellModelDialogHandle>
}) {
  const isMobile = useIsMobile()
  // An offline machine is read-only until it is back.
  const disabled = useMachineReadOnly()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const { availableModels, model } = useSelector(
    agentStore,
    (state) => ({
      availableModels: state.availableModels,
      model: state.model,
    }),
    { compare: sameModelState }
  )

  const handleOpenChange = (next: boolean) => {
    if (next && disabled) return
    openRef.current = next
    setOpen(next)
    if (!next) setQuery("")
  }

  React.useImperativeHandle(ref, () => ({
    open: () => handleOpenChange(true),
  }))

  const shown = open && !disabled

  const currentValue = model ? `${model.provider}/${model.id}` : ""
  const normalizedQuery = query.trim().toLowerCase()
  const modelOptions =
    availableModels.length > 0 ? availableModels : model ? [model] : []
  const filteredModels = modelOptions
    .toSorted(
      (left, right) =>
        (left.provider || "").localeCompare(right.provider || "") ||
        (left.name || left.id).localeCompare(right.name || right.id)
    )
    .filter(
      (entry) =>
        !normalizedQuery ||
        `${entry.provider || ""} ${entry.name || ""} ${entry.id}`
          .toLowerCase()
          .includes(normalizedQuery)
    )
  const groupedModels = new Map<string, Array<ModelOption>>()
  for (const entry of filteredModels) {
    const provider = entry.provider || "Models"
    groupedModels.set(provider, [...(groupedModels.get(provider) ?? []), entry])
  }
  // From all models, so that the names do not change while the user types.
  const familyPrefixes = modelFamilyPrefixes(availableModels)

  const body = (
    <Command
      // Start on the current model, so Enter keeps it.
      defaultValue={currentValue}
      shouldFilter={false}
      loop
      className="min-h-0 flex-1"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search models"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>No models match your search.</CommandEmpty>
        {[...groupedModels].map(([provider, items]) => (
          <CommandGroup key={provider} heading={provider}>
            {items.map((entry) => {
              const value = `${entry.provider}/${entry.id}`
              return (
                <CommandItem
                  key={value}
                  value={value}
                  onSelect={() => {
                    if (disabled) return
                    onSelectModel(value)
                    handleOpenChange(false)
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
                      {value}
                    </span>
                  </div>
                  {value === currentValue ? <CheckIcon /> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={shown} onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>{TITLE}</DrawerTitle>
            <DrawerDescription>{DESCRIPTION}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={shown}
      onOpenChange={handleOpenChange}
      title={TITLE}
      description={DESCRIPTION}
      className="sm:max-w-xl"
      initialFocus
    >
      {body}
    </CommandDialog>
  )
}
