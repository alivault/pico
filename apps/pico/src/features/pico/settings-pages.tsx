/**
 * Pages of the settings dialog. A setting with more parts, such as the agent
 * notifications, opens a page in the same dialog. Each page is a command
 * list: the arrow keys select, Return opens or toggles, Escape goes back.
 * Modules register their pages with `registerSettingsPage`.
 */
import * as React from "react"
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { getShellLayout } from "@/hooks/use-shell-layout"
import { cn } from "@/lib/utils"
import { settle } from "@/lib/settle"

export type SettingsPageRef = {
  key: string
  params?: Record<string, string>
  /** The item that was selected on this page, to select it again on return. */
  selected?: string
}

type SettingsNav = {
  push: (page: SettingsPageRef) => void
  pop: () => void
  selected: string | undefined
  setSelected: (value: string) => void
}

const SettingsNavContext = React.createContext<SettingsNav | null>(null)

function useSettingsNav() {
  const nav = React.use(SettingsNavContext)
  if (!nav) throw new Error("A settings page needs a SettingsPageHost")
  return nav
}

/** Open a page from a settings page. */
export function useOpenSettingsPage() {
  return useSettingsNav().push
}

/** Go back one page. */
export function useCloseSettingsPage() {
  return useSettingsNav().pop
}

export type SettingsPageProps = {
  viewerContextId: string
  params: Record<string, string>
}

type SettingsPageDefinition = {
  key: string
  Component: React.ComponentType<SettingsPageProps>
  /** Show the page in the settings list, as an item that opens it. */
  entry?: {
    group: string
    title: string
    description: string
    keywords: Array<string>
    order: number
    /** Show the entry only when the server of the machine has this feature. */
    feature?: string
  }
}

const settingsPages = new Map<string, SettingsPageDefinition>()

export function registerSettingsPage(definition: SettingsPageDefinition) {
  settingsPages.set(definition.key, definition)
}

/** The pages that the settings list shows as items, in order. */
export function settingsPageEntries() {
  return [...settingsPages.values()]
    .flatMap((page) => (page.entry ? [{ ...page.entry, key: page.key }] : []))
    .sort((left, right) => left.order - right.order)
}

export function SettingsPageHost({
  page,
  viewerContextId,
  onPush,
  onPop,
  onSelectedChange,
}: {
  page: SettingsPageRef
  viewerContextId: string
  onPush: (page: SettingsPageRef) => void
  onPop: () => void
  onSelectedChange: (value: string) => void
}) {
  const definition = settingsPages.get(page.key)
  const nav: SettingsNav = {
    push: onPush,
    pop: onPop,
    selected: page.selected,
    setSelected: onSelectedChange,
  }
  if (!definition) return null
  return (
    <SettingsNavContext value={nav}>
      <definition.Component
        viewerContextId={viewerContextId}
        params={page.params ?? {}}
      />
    </SettingsNavContext>
  )
}

function shouldAutoFocus() {
  return !getShellLayout().compact
}

/** A page: a fixed header with a back button, and the content under it. */
function SettingsPageFrame({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  const nav = useSettingsNav()
  return (
    <div
      role="presentation"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        nav.pop()
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={nav.pop}
          aria-label="Back"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle ? (
            <div className="truncate text-xs text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  )
}

/** A switch that only shows a state. The command item handles the input. */
export function SwitchIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-checked={checked ? "" : undefined}
      className="group/indicator inline-flex h-[18.4px] w-8 shrink-0 items-center rounded-full bg-input p-px transition-colors dark:bg-input/80 data-checked:bg-primary dark:data-checked:bg-primary"
    >
      <span className="block size-4 rounded-full bg-background transition-transform group-data-checked/indicator:translate-x-[calc(100%-2px)] dark:bg-foreground dark:group-data-checked/indicator:bg-primary-foreground" />
    </span>
  )
}

export type SettingsItem = {
  id: string
  title: string
  description?: string
  keywords?: Array<string>
  icon?: React.ReactNode
  /** An on/off setting shows a switch. */
  checked?: boolean
  /** The current value, on the right. */
  value?: string
  /** The item opens a page. */
  submenu?: boolean
  /** A check mark for the chosen option of a list. */
  chosen?: boolean
  destructive?: boolean
  disabled?: boolean
  busy?: boolean
  onSelect?: () => void
}

export type SettingsItemGroup = {
  heading?: string
  items: Array<SettingsItem>
}

/** The value, switch, or chevron on the right of a settings item. */
export function SettingsItemTrailing({
  busy,
  checked,
  submenu,
  value,
}: Pick<SettingsItem, "busy" | "checked" | "submenu" | "value">) {
  if (!busy && checked === undefined && !submenu && !value) return null
  return (
    <span
      // The command item hides its check mark next to a shortcut slot.
      data-slot="command-shortcut"
      className="flex shrink-0 items-center gap-2 self-center pl-2"
    >
      {busy ? <Spinner size="xs" /> : null}
      {value ? (
        <span className="max-w-48 truncate text-xs text-muted-foreground group-data-selected/command-item:text-foreground">
          {value}
        </span>
      ) : null}
      {checked !== undefined ? (
        <>
          <span className="sr-only">{checked ? "On" : "Off"}</span>
          <SwitchIndicator checked={checked} />
        </>
      ) : null}
      {submenu ? (
        <ChevronRightIcon className="text-muted-foreground group-data-selected/command-item:text-foreground" />
      ) : null}
    </span>
  )
}

/** Each search word must appear in the text of the item. */
export function settingsSearchFilter(
  value: string,
  search: string,
  keywords?: Array<string>
) {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  const text = [value, ...(keywords ?? [])].join(" ").toLowerCase()
  return words.every((word) => text.includes(word)) ? 1 : 0
}

function SettingsItemView({ item }: { item: SettingsItem }) {
  return (
    <CommandItem
      value={item.id}
      keywords={[item.title, item.description ?? "", ...(item.keywords ?? [])]}
      disabled={item.disabled}
      onSelect={() => item.onSelect?.()}
      data-checked={item.chosen ? true : undefined}
      className="items-start gap-3 py-2"
    >
      {item.icon ? (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {item.icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate font-medium",
            item.destructive && "text-destructive"
          )}
        >
          {item.title}
        </span>
        {item.description ? (
          <span className="line-clamp-2 text-xs break-words text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </div>
      <SettingsItemTrailing
        busy={item.busy}
        checked={item.checked}
        submenu={item.submenu}
        value={item.value}
      />
    </CommandItem>
  )
}

/** The key hints at the bottom of a page. */
export function SettingsFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden shrink-0 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
      {children}
    </div>
  )
}

/** A page with a searchable list of settings. */
export function SettingsListPage({
  title,
  subtitle,
  groups,
  loading = false,
  emptyText = "No settings found.",
  note,
}: {
  title: string
  subtitle?: string
  groups: Array<SettingsItemGroup>
  loading?: boolean
  emptyText?: string
  /** A short text under the list, for example where a setting comes from. */
  note?: React.ReactNode
}) {
  const nav = useSettingsNav()
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (shouldAutoFocus()) inputRef.current?.focus()
  }, [])

  return (
    <SettingsPageFrame title={title} subtitle={subtitle}>
      <Command
        shouldFilter
        filter={settingsSearchFilter}
        loop
        value={nav.selected}
        onValueChange={nav.setSelected}
        className="min-h-0 flex-1 rounded-none!"
      >
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder={`Search ${title.toLowerCase()}`}
          className="text-base md:text-sm"
          onKeyDown={(event) => {
            // Backspace in an empty search field goes back, as in Spotlight.
            if (event.key === "Backspace" && !query) {
              event.preventDefault()
              nav.pop()
            }
          }}
        />
        <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner size="xs" /> Loading…
            </div>
          ) : (
            <>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {groups
                .filter((group) => group.items.length > 0)
                .map((group, index) => (
                  <CommandGroup
                    key={group.heading ?? index}
                    heading={group.heading}
                  >
                    {group.items.map((item) => (
                      <SettingsItemView key={item.id} item={item} />
                    ))}
                  </CommandGroup>
                ))}
              {note ? (
                <div className="px-3 pt-1 pb-3 text-xs text-muted-foreground">
                  {note}
                </div>
              ) : null}
            </>
          )}
        </CommandList>
        <SettingsFooter>
          Use ↑/↓ to select, Return to open or toggle, and Esc to go back.
        </SettingsFooter>
      </Command>
    </SettingsPageFrame>
  )
}

/**
 * A page that changes one text value. Return saves and goes back; Escape
 * goes back without a change. `onSave` returns an error text when the value
 * is not valid.
 */
export function SettingsEditPage({
  title,
  description,
  initial,
  placeholder,
  multiline = false,
  inputMode,
  onSave,
  children,
}: {
  title: string
  description?: React.ReactNode
  initial: string
  placeholder?: string
  /** A text area. Command-Return or Control-Return saves. */
  multiline?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  onSave: (value: string) => Promise<string | undefined> | string | undefined
  children?: React.ReactNode
}) {
  const nav = useSettingsNav()
  const [value, setValue] = React.useState(initial)
  const [error, setError] = React.useState<string>()
  const [saving, setSaving] = React.useState(false)
  const fieldRef = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  React.useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.focus()
    field.select()
  }, [])

  const save = async () => {
    if (saving) return
    if (value === initial) {
      nav.pop()
      return
    }
    setSaving(true)
    // A promise, so that a throw in onSave is also an error result.
    const settled = await settle(Promise.resolve().then(() => onSave(value)))
    setSaving(false)
    if (!settled.ok) {
      const caught = settled.error
      setError(caught instanceof Error ? caught.message : String(caught))
      return
    }
    const problem = settled.value
    if (problem) setError(problem)
    else nav.pop()
  }

  const fieldProps = {
    value,
    placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-label": title,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setValue(event.target.value)
      setError(undefined)
    },
  }

  return (
    <SettingsPageFrame
      title={title}
      subtitle={initial && !multiline ? `Now: ${initial}` : undefined}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {multiline ? (
          <Textarea
            ref={fieldRef}
            {...fieldProps}
            className="max-h-[min(50vh,24rem)] min-h-40 font-mono text-xs md:text-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void save()
              }
            }}
          />
        ) : (
          <Input
            ref={fieldRef}
            {...fieldProps}
            inputMode={inputMode}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void save()
              }
            }}
          />
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {description ? (
          <div className="text-xs text-muted-foreground">{description}</div>
        ) : null}
        {children}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={nav.pop}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner size="xs" /> : null}
            Save
          </Button>
        </div>
      </div>
      <SettingsFooter>
        {multiline
          ? "Press ⌘/Ctrl-Return to save and Esc to go back."
          : "Press Return to save and Esc to go back."}
      </SettingsFooter>
    </SettingsPageFrame>
  )
}
