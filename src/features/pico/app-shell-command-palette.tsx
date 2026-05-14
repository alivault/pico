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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"

export type AppCommand = {
  id: string
  title: string
  description: string
  group: string
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

export type AppShellCommandPaletteHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

function commandValue(command: AppCommand) {
  return [command.title, command.description, ...(command.keywords ?? [])].join(
    " "
  )
}

function AppShellCommandPalette({
  open,
  onOpenChange,
  commands,
  onCommandError,
}: AppShellCommandPaletteProps) {
  const [query, setQuery] = React.useState("")
  const isMobile = useIsMobile()
  const commandGroups = React.useMemo(() => {
    const groups = new Map<string, Array<AppCommand>>()

    for (const command of commands) {
      const items = groups.get(command.group)
      if (items) {
        items.push(command)
      } else {
        groups.set(command.group, [command])
      }
    }

    return Array.from(groups.entries())
  }, [commands])

  React.useEffect(() => {
    if (!open && query) {
      setQuery("")
    }
  }, [open, query])

  const handleSelect = (command: AppCommand) => {
    onOpenChange(false)
    void Promise.resolve(command.onSelect()).catch((error: unknown) => {
      onCommandError?.(error)
    })
  }

  const commandPaletteBody = (
    <Command shouldFilter loop className="min-h-0 flex-1">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search commands"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>No commands found.</CommandEmpty>
        {commandGroups.map(([group, groupCommands]) => (
          <CommandGroup key={group} heading={group}>
            {groupCommands.map((command) => (
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
        ))}
      </CommandList>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Command palette</DrawerTitle>
            <DrawerDescription>
              Search for commands and session actions.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {commandPaletteBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search for commands and session actions."
      className="sm:max-w-2xl"
      initialFocus
    >
      {commandPaletteBody}
    </CommandDialog>
  )
}

type AppShellCommandPaletteControllerProps = Omit<
  AppShellCommandPaletteProps,
  "open" | "onOpenChange" | "commands"
> & {
  ref?: React.Ref<AppShellCommandPaletteHandle>
  openStateRef?: React.RefObject<boolean>
  commands?: Array<AppCommand>
  getCommandsRef?: React.RefObject<() => Array<AppCommand>>
}

export function AppShellCommandPaletteController({
  ref,
  openStateRef,
  commands,
  getCommandsRef,
  ...props
}: AppShellCommandPaletteControllerProps) {
  const [open, setOpen] = React.useState(false)
  const [openedCommands, setOpenedCommands] = React.useState<Array<AppCommand>>(
    () => commands ?? []
  )
  const openRef = React.useRef(open)

  const readCommands = () => getCommandsRef?.current() ?? commands ?? []

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    if (nextOpen) {
      setOpenedCommands(readCommands())
    }
    setOpen(nextOpen)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpenState(true)
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    []
  )

  return (
    <AppShellCommandPalette
      open={open}
      onOpenChange={setOpenState}
      commands={open ? openedCommands : []}
      {...props}
    />
  )
}
