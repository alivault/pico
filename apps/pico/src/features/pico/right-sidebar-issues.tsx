/**
 * The Issues tab: the GitHub issues of the project. Its layout follows the
 * Apple HIG: one toolbar line, rows like Mail, a split view when the panel is
 * wide, a navigation bar with one main action, and the comment field at the
 * bottom. The data and the writes are in `right-sidebar-issues-data.ts`.
 */
import * as React from "react"
import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  ChevronLeftIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  EyeIcon,
  HashIcon,
  InboxIcon,
  LinkIcon,
  ListFilterIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SquarePenIcon,
  TagIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import { MarkdownBlock } from "@/features/pico/markdown-renderer"
import {
  useGitHubLabels,
  useGitHubRepo,
  useIssue,
  useIssueActions,
  useIssueList,
  useIssueMutations,
  useIssueSaving,
  type AvailableRepo,
  type IssueActions,
  type IssueState,
} from "@/features/pico/right-sidebar-issues-data"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import { getErrorMessage } from "@/features/pico/right-sidebar-shared"
import { useIsMobile } from "@/hooks/use-mobile"
import type { GhIssueSummary, GhLabel } from "@/lib/pico/api"
import { toast } from "@/lib/pico/toast"
import { cn } from "@/lib/utils"

/** From this panel width, the list and the issue show side by side. */
const SPLIT_VIEW_MIN_WIDTH = 640
/** How far a row slides to show its swipe actions, in pixels. */
const SWIPE_ACTION_WIDTH = 76

// ---------------------------------------------------------------------------
// Small parts

function formatAge(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ""
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(days / 365)}y`
}

function ageText(value: string) {
  const age = formatAge(value)
  return age === "now" || !age ? age : `${age} ago`
}

function formatFullDate(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString() : ""
}

function labelColor(label: GhLabel) {
  return /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : "#888"
}

/** A label as a colored dot and its name: light enough for rows. */
function LabelDot({ label }: { label: GhLabel }) {
  return (
    <span
      title={label.description || label.name}
      className="inline-flex max-w-32 min-w-0 shrink-0 items-center gap-1"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: labelColor(label) }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  )
}

/** A label as a chip, for the pickers. */
function LabelChip({ label }: { label: GhLabel }) {
  const color = labelColor(label)
  return (
    <span
      title={label.description || label.name}
      className="inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium text-foreground"
      style={{ borderColor: `${color}99`, backgroundColor: `${color}26` }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  )
}

function IssueStateIcon({
  issue,
  className,
}: {
  issue: Pick<GhIssueSummary, "state" | "stateReason">
  className?: string
}) {
  if (issue.state === "OPEN") {
    return (
      <CircleDotIcon
        aria-label="Open"
        className={cn("size-4 shrink-0 text-emerald-500", className)}
      />
    )
  }
  if (issue.stateReason === "NOT_PLANNED") {
    return (
      <CircleSlashIcon
        aria-label="Closed as not planned"
        className={cn("size-4 shrink-0 text-muted-foreground", className)}
      />
    )
  }
  return (
    <CircleCheckIcon
      aria-label="Closed"
      className={cn("size-4 shrink-0 text-violet-500", className)}
    />
  )
}

function StatePill({
  issue,
}: {
  issue: Pick<GhIssueSummary, "state" | "stateReason">
}) {
  const open = issue.state === "OPEN"
  const notPlanned = issue.stateReason === "NOT_PLANNED"
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold",
        open
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : notPlanned
            ? "bg-muted text-muted-foreground"
            : "bg-violet-500/15 text-violet-700 dark:text-violet-300"
      )}
    >
      <IssueStateIcon issue={issue} className="size-3 text-current" />
      {open ? "Open" : notPlanned ? "Not planned" : "Closed"}
    </span>
  )
}

/** A centered message for an empty list or an empty detail. */
function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
      <div className="mb-1 text-muted-foreground/60 [&_svg]:size-8">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      {description ? (
        <div className="max-w-64 text-xs text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** Toolbar buttons are at least 44 pt on touch screens (HIG). */
function useToolbarButtonSize() {
  return useIsMobile() ? "size-11" : undefined
}

// ---------------------------------------------------------------------------
// Menus

function LabelPicker({
  labels,
  selected,
  onToggle,
  trigger,
}: {
  labels: Array<GhLabel>
  selected: Array<string>
  onToggle: (name: string) => void
  trigger: React.ReactElement
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="max-h-80 min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Labels</DropdownMenuLabel>
          {labels.length === 0 ? (
            <DropdownMenuItem disabled>No labels</DropdownMenuItem>
          ) : null}
          {labels.map((label) => (
            <DropdownMenuItem
              key={label.name}
              closeOnClick={false}
              onClick={() => onToggle(label.name)}
            >
              <CheckIcon
                className={cn(
                  "size-3.5",
                  !selected.includes(label.name) && "invisible"
                )}
              />
              <LabelChip label={label} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type MenuItemProps = {
  children?: React.ReactNode
  onClick?: () => void
  closeOnClick?: boolean
  disabled?: boolean
  render?: React.ReactElement
}

/** The parts of a menu: the same items go in a context menu and a ⋯ menu. */
type MenuParts = {
  Item: React.ComponentType<MenuItemProps>
  Separator: React.ComponentType
  Sub: React.ComponentType<{ children?: React.ReactNode }>
  SubTrigger: React.ComponentType<{ children?: React.ReactNode }>
  SubContent: React.ComponentType<{
    children?: React.ReactNode
    className?: string
  }>
}

const CONTEXT_MENU_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
}

const DROPDOWN_MENU_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}

function IssueMenuItems({
  parts,
  issue,
  repo,
  labels,
  actions,
  onOpen,
  showStartAgent,
}: {
  parts: MenuParts
  issue: GhIssueSummary
  repo: AvailableRepo
  labels: Array<GhLabel>
  actions: IssueActions
  /** Show "Open" (in the list, not on the issue page). */
  onOpen?: () => void
  showStartAgent: boolean
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = parts
  const selected = issue.labels.map((label) => label.name)
  return (
    <>
      {onOpen ? (
        <Item onClick={onOpen}>
          <EyeIcon />
          Open
        </Item>
      ) : null}
      {showStartAgent ? (
        <Item onClick={() => void actions.startAgent(issue)}>
          <BotIcon />
          Start agent
        </Item>
      ) : null}
      <Item onClick={() => actions.addToPrompt(issue)}>
        <MessageSquarePlusIcon />
        Add to prompt
      </Item>
      {repo.viewerCanWrite ? (
        <>
          <Separator />
          {issue.state === "OPEN" ? (
            <>
              <Item onClick={() => actions.close(issue.number, "completed")}>
                <CircleCheckIcon className="text-violet-500" />
                Close as completed
              </Item>
              <Item onClick={() => actions.close(issue.number, "not planned")}>
                <CircleSlashIcon />
                Close as not planned
              </Item>
            </>
          ) : (
            <Item onClick={() => actions.reopen(issue.number)}>
              <CircleDotIcon className="text-emerald-500" />
              Reopen
            </Item>
          )}
          <Sub>
            <SubTrigger>
              <TagIcon />
              Labels
            </SubTrigger>
            <SubContent className="max-h-80 min-w-48">
              {labels.length === 0 ? <Item disabled>No labels</Item> : null}
              {labels.map((label) => (
                <Item
                  key={label.name}
                  closeOnClick={false}
                  onClick={() => actions.toggleLabel(issue, label.name)}
                >
                  <CheckIcon
                    className={cn(
                      "size-3.5",
                      !selected.includes(label.name) && "invisible"
                    )}
                  />
                  <LabelChip label={label} />
                </Item>
              ))}
            </SubContent>
          </Sub>
        </>
      ) : null}
      <Separator />
      <Item render={<a href={issue.url} target="_blank" rel="noreferrer" />}>
        <ExternalLinkIcon />
        Open on GitHub
      </Item>
      <Item onClick={() => actions.copyLink(issue)}>
        <LinkIcon />
        Copy link
      </Item>
      <Item onClick={() => actions.copyReference(issue)}>
        <HashIcon />
        Copy {repo.nameWithOwner}#{issue.number}
      </Item>
    </>
  )
}

// ---------------------------------------------------------------------------
// New issue

function NewIssueDialog({
  open,
  onOpenChange,
  labels,
  pending,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: Array<GhLabel>
  pending: boolean
  onCreate: (input: {
    title: string
    body: string
    labels: Array<string>
  }) => Promise<boolean>
}) {
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [selected, setSelected] = React.useState<Array<string>>([])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || pending) return
    if (await onCreate({ title: title.trim(), body, labels: selected })) {
      setTitle("")
      setBody("")
      setSelected([])
    }
  }
  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New Issue</DialogTitle>
            <DialogDescription>
              Make an issue in the GitHub repository of this project.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            placeholder="Description (Markdown)"
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <LabelPicker
              labels={labels}
              selected={selected}
              onToggle={(name) =>
                setSelected((current) =>
                  current.includes(name)
                    ? current.filter((item) => item !== name)
                    : [...current, name]
                )
              }
              trigger={
                <Button type="button" size="sm" variant="outline">
                  <TagIcon data-icon="inline-start" />
                  Labels
                </Button>
              }
            />
            {labels
              .filter((label) => selected.includes(label.name))
              .map((label) => (
                <LabelChip key={label.name} label={label} />
              ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || pending}>
              {pending ? <Spinner /> : null}
              Create Issue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The list

const STATE_TITLES: Record<IssueState, string> = {
  open: "Open",
  closed: "Closed",
  all: "All",
}

function FilterMenu({
  repo,
  labels,
  state,
  label,
  onStateChange,
  onLabelChange,
  onRefresh,
  buttonClassName,
}: {
  repo: AvailableRepo
  labels: Array<GhLabel>
  state: IssueState
  label: string
  onStateChange: (state: IssueState) => void
  onLabelChange: (label: string) => void
  onRefresh: () => void
  buttonClassName?: string
}) {
  const filtered = state !== "open" || Boolean(label)
  return (
    <DropdownMenu>
      <TitleTooltip title="Filter">
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Filter issues"
              className={cn(
                buttonClassName,
                filtered && "bg-primary/10 text-primary hover:text-primary"
              )}
            >
              <ListFilterIcon />
            </Button>
          }
        />
      </TitleTooltip>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            {repo.nameWithOwner}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={state}
            onValueChange={(value) => onStateChange(value as IssueState)}
          >
            <DropdownMenuRadioItem value="open" closeOnClick>
              Open
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="closed" closeOnClick>
              Closed
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="all" closeOnClick>
              All
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TagIcon />
            <span className="flex-1">Label</span>
            {label ? (
              <span className="max-w-24 truncate text-xs text-muted-foreground">
                {label}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-48">
            <DropdownMenuItem onClick={() => onLabelChange("")}>
              <CheckIcon className={cn("size-3.5", label && "invisible")} />
              Any label
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {labels.map((item) => (
              <DropdownMenuItem
                key={item.name}
                onClick={() => onLabelChange(item.name)}
              >
                <CheckIcon
                  className={cn("size-3.5", label !== item.name && "invisible")}
                />
                <LabelChip label={item} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRefresh}>
          <RefreshCwIcon />
          Refresh
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a href={`${repo.url}/issues`} target="_blank" rel="noreferrer" />
          }
        >
          <ExternalLinkIcon />
          Open on GitHub
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A removable token for a filter that is not the default. */
function FilterToken({
  children,
  onRemove,
  label,
}: {
  children: React.ReactNode
  onRemove: () => void
  label: string
}) {
  return (
    <span className="inline-flex h-6 max-w-40 items-center gap-1 rounded-full bg-primary/10 pr-0.5 pl-2 text-xs font-medium text-primary">
      <span className="flex min-w-0 items-center gap-1 truncate">
        {children}
      </span>
      <button
        type="button"
        aria-label={`Remove the filter ${label}`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-primary/15"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}

/** A row like Mail: the title and age, then the number, labels and comments. */
function IssueRow({
  issue,
  selected,
  onOpen,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  issue: GhIssueSummary
  selected: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      {...props}
      onClick={onOpen}
      className={cn(
        "group/issue-row flex min-h-11 w-full min-w-0 items-start gap-2.5 rounded-lg pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected
          ? "bg-primary/10"
          : "hover:bg-muted/70 data-popup-open:bg-muted/70",
        className
      )}
    >
      <IssueStateIcon issue={issue} className="mt-2.5" />
      {/* The separator starts at the text, as in Mail (an inset separator). */}
      <span
        data-row-separator
        className="grid min-w-0 flex-1 gap-0.5 border-b border-border/60 py-2 pr-2.5"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-5 font-semibold wrap-break-word">
            {issue.title}
          </span>
          <span
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
            title={formatFullDate(issue.updatedAt)}
          >
            {formatAge(issue.updatedAt)}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">#{issue.number}</span>
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {issue.labels.map((label) => (
              <LabelDot key={label.name} label={label} />
            ))}
          </span>
          {issue.commentCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
              <MessageSquareIcon className="size-3" />
              {issue.commentCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

type SwipeAction = {
  label: string
  icon: React.ReactNode
  className: string
  onAction: () => void
}

/**
 * Swipe actions on touch screens: swipe right for the leading action, left
 * for the trailing one. A long swipe runs the action at once.
 */
function SwipeRow({
  open,
  onOpenChange,
  leading,
  trailing,
  children,
}: {
  /** The side that shows its action, or null. */
  open: "leading" | "trailing" | null
  onOpenChange: (open: "leading" | "trailing" | null) => void
  leading?: SwipeAction
  trailing?: SwipeAction
  children: React.ReactNode
}) {
  const [drag, setDrag] = React.useState<number | null>(null)
  const start = React.useRef<{ x: number; y: number; base: number } | null>(
    null
  )
  const horizontal = React.useRef<boolean | null>(null)
  const rowRef = React.useRef<HTMLDivElement>(null)
  const restOffset =
    open === "leading"
      ? SWIPE_ACTION_WIDTH
      : open === "trailing"
        ? -SWIPE_ACTION_WIDTH
        : 0
  const offset = drag ?? restOffset
  const clamp = (value: number) =>
    Math.max(trailing ? -1000 : 0, Math.min(leading ? 1000 : 0, value))

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return
    start.current = { x: touch.clientX, y: touch.clientY, base: restOffset }
    horizontal.current = null
  }
  const onTouchMove = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    if (!touch || !start.current) return
    const dx = touch.clientX - start.current.x
    const dy = touch.clientY - start.current.y
    if (horizontal.current === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      horizontal.current = Math.abs(dx) > Math.abs(dy)
    }
    if (!horizontal.current) return
    setDrag(clamp(start.current.base + dx))
  }
  const onTouchEnd = () => {
    const value = drag
    start.current = null
    setDrag(null)
    if (value === null || !horizontal.current) return
    const width = rowRef.current?.offsetWidth ?? 320
    // A long swipe runs the action, as in Mail.
    if (leading && value > width * 0.55) {
      onOpenChange(null)
      leading.onAction()
      return
    }
    if (trailing && value < -width * 0.55) {
      onOpenChange(null)
      trailing.onAction()
      return
    }
    onOpenChange(
      value > SWIPE_ACTION_WIDTH / 2
        ? "leading"
        : value < -SWIPE_ACTION_WIDTH / 2
          ? "trailing"
          : null
    )
  }

  const actionButton = (action: SwipeAction, side: "left" | "right") => (
    <button
      type="button"
      className={cn(
        "absolute inset-y-0 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-white",
        side === "left" ? "left-0 items-start pl-5" : "right-0 items-end pr-4",
        action.className
      )}
      style={{ width: Math.max(SWIPE_ACTION_WIDTH, Math.abs(offset)) }}
      onClick={() => {
        onOpenChange(null)
        action.onAction()
      }}
    >
      <span className="flex flex-col items-center gap-0.5 [&_svg]:size-5">
        {action.icon}
        {action.label}
      </span>
    </button>
  )

  return (
    <div ref={rowRef} className="relative overflow-hidden rounded-lg">
      {leading && offset > 0 ? actionButton(leading, "left") : null}
      {trailing && offset < 0 ? actionButton(trailing, "right") : null}
      <div
        className={cn(
          "relative bg-background",
          drag === null && "transition-transform duration-200"
        )}
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
        // Capture: the context menu trigger inside stops touch events.
        onTouchStartCapture={onTouchStart}
        onTouchMoveCapture={onTouchMove}
        onTouchEndCapture={onTouchEnd}
        onTouchCancelCapture={onTouchEnd}
        onClickCapture={(event) => {
          // A tap on a row with open actions closes them.
          if (open) {
            event.stopPropagation()
            event.preventDefault()
            onOpenChange(null)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

function IssueList({
  repo,
  labels,
  actions,
  issues,
  loading,
  error,
  stale,
  state,
  label,
  search,
  searchInput,
  selectedNumber,
  onSearchInputChange,
  onStateChange,
  onLabelChange,
  onRefresh,
  onOpenIssue,
  onNewIssue,
}: {
  repo: AvailableRepo
  labels: Array<GhLabel>
  actions: IssueActions
  issues: Array<GhIssueSummary> | undefined
  loading: boolean
  error: unknown
  /** The list of the old filter shows while the new one loads. */
  stale: boolean
  state: IssueState
  label: string
  search: string
  searchInput: string
  selectedNumber: number | null
  onSearchInputChange: (value: string) => void
  onStateChange: (state: IssueState) => void
  onLabelChange: (label: string) => void
  onRefresh: () => void
  onOpenIssue: (number: number) => void
  onNewIssue: () => void
}) {
  const isMobile = useIsMobile()
  const buttonSize = useToolbarButtonSize()
  const [swiped, setSwiped] = React.useState<{
    number: number
    side: "leading" | "trailing"
  } | null>(null)
  const labelInfo = labels.find((item) => item.name === label)

  const rowMenu = (issue: GhIssueSummary, row: React.ReactElement) => (
    <ContextMenu key={issue.number}>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="w-56">
        <IssueMenuItems
          parts={CONTEXT_MENU_PARTS}
          issue={issue}
          repo={repo}
          labels={labels}
          actions={actions}
          onOpen={() => onOpenIssue(issue.number)}
          showStartAgent
        />
      </ContextMenuContent>
    </ContextMenu>
  )

  const renderRow = (issue: GhIssueSummary) => {
    const row = (
      <IssueRow
        issue={issue}
        selected={selectedNumber === issue.number}
        onOpen={() => onOpenIssue(issue.number)}
      />
    )
    if (!isMobile) return rowMenu(issue, row)
    const canWrite = repo.viewerCanWrite
    return (
      <SwipeRow
        key={issue.number}
        open={swiped?.number === issue.number ? swiped.side : null}
        onOpenChange={(side) =>
          setSwiped(side ? { number: issue.number, side } : null)
        }
        leading={{
          label: "Agent",
          icon: <BotIcon />,
          className: "bg-primary",
          onAction: () => void actions.startAgent(issue),
        }}
        trailing={
          !canWrite
            ? undefined
            : issue.state === "OPEN"
              ? {
                  label: "Close",
                  icon: <CircleCheckIcon />,
                  className: "bg-violet-500",
                  onAction: () => actions.close(issue.number, "completed"),
                }
              : {
                  label: "Reopen",
                  icon: <CircleDotIcon />,
                  className: "bg-emerald-500",
                  onAction: () => actions.reopen(issue.number),
                }
        }
      >
        {rowMenu(issue, row)}
      </SwipeRow>
    )
  }

  const filtered = state !== "open" || Boolean(label)
  const emptyTitle = search
    ? `No Results for “${search}”`
    : state === "closed"
      ? "No Closed Issues"
      : state === "all"
        ? "No Issues"
        : "No Open Issues"

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5">
        <InputGroup className={cn("h-8 flex-1", isMobile && "h-11")}>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search issues"
            placeholder="Search"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchInput) {
                event.stopPropagation()
                onSearchInputChange("")
              }
            }}
          />
          {searchInput ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear the search"
                onClick={() => onSearchInputChange("")}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : loading ? (
            <InputGroupAddon align="inline-end">
              <Spinner size="xs" />
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <FilterMenu
          repo={repo}
          labels={labels}
          state={state}
          label={label}
          onStateChange={onStateChange}
          onLabelChange={onLabelChange}
          onRefresh={onRefresh}
          buttonClassName={buttonSize}
        />
        <TitleTooltip title="New issue">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="New issue"
            className={buttonSize}
            onClick={onNewIssue}
          >
            <SquarePenIcon />
          </Button>
        </TitleTooltip>
      </div>
      {filtered ? (
        <div className="flex shrink-0 flex-wrap gap-1 px-2 pb-1.5">
          {state !== "open" ? (
            <FilterToken
              label={STATE_TITLES[state]}
              onRemove={() => onStateChange("open")}
            >
              {STATE_TITLES[state]}
            </FilterToken>
          ) : null}
          {label ? (
            <FilterToken label={label} onRemove={() => onLabelChange("")}>
              {labelInfo ? <LabelDot label={labelInfo} /> : label}
            </FilterToken>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-1 pb-2 transition-opacity [&>*:last-child_[data-row-separator]]:border-transparent",
          stale && "opacity-50"
        )}
      >
        {loading && !issues ? (
          <GitSectionNote className="px-2 py-2">
            <Spinner /> Loading issues…
          </GitSectionNote>
        ) : error && !issues ? (
          <GitSectionNote tone="destructive" className="px-2 py-2">
            {getErrorMessage(error, "Failed to load issues")}
          </GitSectionNote>
        ) : issues && issues.length > 0 ? (
          issues.map(renderRow)
        ) : (
          <EmptyState
            icon={search ? <SearchIcon /> : <InboxIcon />}
            title={emptyTitle}
            description={
              search
                ? "Check the spelling or try a new search."
                : filtered
                  ? "No issues match the filter."
                  : undefined
            }
            action={
              search || filtered ? undefined : (
                <Button type="button" size="sm" onClick={onNewIssue}>
                  <PlusIcon data-icon="inline-start" />
                  New Issue
                </Button>
              )
            }
          />
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The issue

function IssueDetail({
  viewerContextId,
  cwd,
  repo,
  number,
  active,
  labels,
  mutations,
  actions,
  onBack,
}: {
  viewerContextId: string
  cwd: string
  repo: AvailableRepo
  number: number
  active: boolean
  labels: Array<GhLabel>
  mutations: ReturnType<typeof useIssueMutations>
  actions: IssueActions
  /** The back button; absent in the split view. */
  onBack?: () => void
}) {
  const buttonSize = useToolbarButtonSize()
  const [comment, setComment] = React.useState("")
  const issueQuery = useIssue({ viewerContextId, cwd, number, enabled: active })
  const issue = issueQuery.data
  const loadingRest = issueQuery.isPlaceholderData
  const saving = useIssueSaving(viewerContextId, cwd)

  const sendComment = () => {
    const body = comment.trim()
    if (!body) return
    setComment("")
    mutations.comment.mutate(
      { number, body, pendingId: `pending:${Date.now()}` },
      // Give the text back, so that it is not lost.
      { onError: () => setComment((current) => current || body) }
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("gap-0.5 px-1.5 text-primary", buttonSize && "h-11")}
            onClick={onBack}
          >
            <ChevronLeftIcon className="size-5" />
            Issues
          </Button>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-semibold tabular-nums",
            !onBack && "pl-1.5"
          )}
        >
          #{number}
        </span>
        {issueQuery.isFetching || saving ? <Spinner size="xs" /> : null}
        {issue ? (
          <>
            <Button
              type="button"
              size="sm"
              className={cn(buttonSize && "h-11")}
              disabled={loadingRest}
              onClick={() => void actions.startAgent(issue)}
            >
              <BotIcon data-icon="inline-start" />
              Start agent
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="More actions"
                    className={buttonSize}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <IssueMenuItems
                  parts={DROPDOWN_MENU_PARTS}
                  issue={issue}
                  repo={repo}
                  labels={labels}
                  actions={actions}
                  showStartAgent={false}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {issueQuery.isPending && !issue ? (
          <GitSectionNote className="px-4 py-3">
            <Spinner /> Loading issue…
          </GitSectionNote>
        ) : issueQuery.error && !issue ? (
          <GitSectionNote tone="destructive" className="px-4 py-3">
            {getErrorMessage(issueQuery.error, "Failed to load the issue")}
          </GitSectionNote>
        ) : issue ? (
          <article className="grid gap-3 px-4 pt-3 pb-4">
            <header className="grid gap-1.5">
              <h2 className="text-lg leading-6 font-semibold wrap-break-word">
                {issue.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <StatePill issue={issue} />
                <span title={formatFullDate(issue.createdAt)}>
                  {issue.author} opened {ageText(issue.createdAt)}
                </span>
                {issue.assignees.length > 0 ? (
                  <span>· assigned to {issue.assignees.join(", ")}</span>
                ) : null}
              </div>
              {issue.labels.length > 0 || repo.viewerCanWrite ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {issue.labels.map((label) => (
                    <LabelDot key={label.name} label={label} />
                  ))}
                  {repo.viewerCanWrite ? (
                    <LabelPicker
                      labels={labels}
                      selected={issue.labels.map((label) => label.name)}
                      onToggle={(name) => actions.toggleLabel(issue, name)}
                      trigger={
                        <button
                          type="button"
                          className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <TagIcon className="size-3" />
                          {issue.labels.length > 0 ? "Edit" : "Add label"}
                        </button>
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </header>
            {loadingRest ? (
              <GitSectionNote>
                <Spinner /> Loading the description…
              </GitSectionNote>
            ) : issue.body.trim() ? (
              <MarkdownBlock
                className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
                text={issue.body}
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description.
              </p>
            )}
            {issue.comments.length > 0 ? (
              <section className="mt-1 grid border-t border-border/60">
                <h3 className="pt-3 pb-1 text-xs font-semibold text-muted-foreground">
                  {issue.comments.length === 1
                    ? "1 Comment"
                    : `${issue.comments.length} Comments`}
                </h3>
                {issue.comments.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "grid gap-1 border-b border-border/60 py-3 last:border-b-0",
                      item.pending && "opacity-60"
                    )}
                  >
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="font-semibold">{item.author}</span>
                      <span
                        className="text-muted-foreground"
                        title={formatFullDate(item.createdAt)}
                      >
                        {item.pending ? "Sending…" : ageText(item.createdAt)}
                      </span>
                    </div>
                    <MarkdownBlock
                      className="[&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0"
                      text={item.body}
                    />
                  </div>
                ))}
              </section>
            ) : null}
          </article>
        ) : null}
      </div>
      {issue ? (
        <form
          className="flex shrink-0 items-end gap-2 border-t border-border/60 bg-background px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault()
            sendComment()
          }}
        >
          <Textarea
            aria-label="Comment"
            placeholder="Comment"
            rows={1}
            value={comment}
            className="field-sizing-content max-h-40 min-h-9 resize-none rounded-[18px] px-3.5 py-2"
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                sendComment()
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send the comment (⌘Enter)"
            className={cn("shrink-0 rounded-full", buttonSize ?? "size-9")}
            disabled={!comment.trim()}
          >
            <ArrowUpIcon />
          </Button>
        </form>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The panel

/** The width of an element, kept current. */
function useElementWidth() {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return { ref: setElement, width }
}

export function IssuesPanel({
  viewerContextId,
  cwd,
  active,
}: {
  viewerContextId: string
  cwd: string
  active: boolean
}) {
  const repoQuery = useGitHubRepo({ viewerContextId, cwd, enabled: active })
  const repo = repoQuery.data?.available ? repoQuery.data : undefined
  const [state, setState] = React.useState<IssueState>("open")
  const [label, setLabel] = React.useState("")
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [openNumber, setOpenNumber] = React.useState<number | null>(null)
  const [newIssueOpen, setNewIssueOpen] = React.useState(false)
  const { ref: panelRef, width } = useElementWidth()
  const split = width >= SPLIT_VIEW_MIN_WIDTH
  const mutations = useIssueMutations({
    viewerContextId,
    cwd,
    viewerLogin: repo?.viewerLogin ?? "",
  })
  const labelsQuery = useGitHubLabels(
    viewerContextId,
    cwd,
    Boolean(active && repo)
  )
  const labels = labelsQuery.data ?? []
  const actions = useIssueActions({
    viewerContextId,
    cwd,
    repo,
    labels,
    mutations,
  })
  const issuesQuery = useIssueList({
    viewerContextId,
    cwd,
    state,
    label,
    search,
    enabled: Boolean(active && repo),
  })

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  React.useEffect(() => {
    setOpenNumber(null)
    setLabel("")
    setSearchInput("")
    setSearch("")
  }, [cwd])

  const createIssue = async (input: {
    title: string
    body: string
    labels: Array<string>
  }) => {
    try {
      const created = await mutations.create.mutateAsync(input)
      setNewIssueOpen(false)
      toast.success(`Created issue #${created.issue.number}`)
      setOpenNumber(created.issue.number)
      return true
    } catch {
      return false
    }
  }

  let content: React.ReactNode
  if (!cwd) {
    content = (
      <GitSectionNote className="px-3 py-2.5">
        No directory selected.
      </GitSectionNote>
    )
  } else if (repoQuery.isPending) {
    content = (
      <GitSectionNote className="px-3 py-2.5">
        <Spinner /> Looking for the GitHub repository…
      </GitSectionNote>
    )
  } else if (repoQuery.error || !repo) {
    content = (
      <EmptyState
        icon={<InboxIcon />}
        title="GitHub Is Not Available"
        description={
          repoQuery.error
            ? getErrorMessage(repoQuery.error, "GitHub is not available")
            : repoQuery.data && !repoQuery.data.available
              ? repoQuery.data.reason
              : undefined
        }
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void repoQuery.refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Try Again
          </Button>
        }
      />
    )
  } else {
    const list = (
      <IssueList
        repo={repo}
        labels={labels}
        actions={actions}
        issues={issuesQuery.data}
        loading={issuesQuery.isFetching}
        error={issuesQuery.error}
        stale={issuesQuery.isPlaceholderData}
        state={state}
        label={label}
        search={search}
        searchInput={searchInput}
        selectedNumber={split ? openNumber : null}
        onSearchInputChange={setSearchInput}
        onStateChange={setState}
        onLabelChange={setLabel}
        onRefresh={() => {
          void issuesQuery.refetch()
          void labelsQuery.refetch()
        }}
        onOpenIssue={setOpenNumber}
        onNewIssue={() => setNewIssueOpen(true)}
      />
    )
    const detail =
      openNumber !== null ? (
        <IssueDetail
          key={openNumber}
          viewerContextId={viewerContextId}
          cwd={cwd}
          repo={repo}
          number={openNumber}
          active={active}
          labels={labels}
          mutations={mutations}
          actions={actions}
          onBack={split ? undefined : () => setOpenNumber(null)}
        />
      ) : null
    content = split ? (
      <div className="flex h-full min-h-0">
        <div className="h-full w-[clamp(260px,38%,380px)] shrink-0 border-r border-border/60">
          {list}
        </div>
        <div className="h-full min-w-0 flex-1">
          {detail ?? (
            <EmptyState
              icon={<CircleDotIcon />}
              title="No Issue Selected"
              description="Choose an issue in the list."
            />
          )}
        </div>
      </div>
    ) : (
      <>
        {/* Keep the list, with its scroll place, under the issue. */}
        <div className={cn("h-full", detail && "hidden")}>{list}</div>
        {detail}
      </>
    )
  }

  return (
    <div ref={panelRef} className="h-full min-h-0">
      {content}
      <NewIssueDialog
        open={newIssueOpen}
        onOpenChange={setNewIssueOpen}
        labels={labels}
        pending={mutations.create.isPending}
        onCreate={createIssue}
      />
    </div>
  )
}
