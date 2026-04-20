import * as React from "react"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"

export type AppCommand = {
  id: string
  title: string
  description: string
  shortcut?: string
  keywords?: Array<string>
  onSelect: () => void | Promise<void>
}

type AppShellCommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Array<AppCommand>
  onCommandError?: (error: unknown) => void
}

function commandValue(command: AppCommand) {
  return [command.title, command.description, ...(command.keywords ?? [])].join(
    " "
  )
}

export function AppShellCommandPalette({
  open,
  onOpenChange,
  commands,
  onCommandError,
}: AppShellCommandPaletteProps) {
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    if (!open && query) {
      setQuery("")
    }
  }, [open, query])

  const handleSelect = React.useCallback(
    (command: AppCommand) => {
      onOpenChange(false)
      void Promise.resolve(command.onSelect()).catch((error: unknown) => {
        onCommandError?.(error)
      })
    },
    [onCommandError, onOpenChange]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search for commands and session actions."
      className="max-w-2xl"
    >
      <Command shouldFilter loop>
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search commands"
        />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Actions">
            {commands.map((command) => (
              <CommandItem
                key={command.id}
                value={commandValue(command)}
                onSelect={() => handleSelect(command)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{command.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </div>
                {command.shortcut ? (
                  <CommandShortcut>{command.shortcut}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
